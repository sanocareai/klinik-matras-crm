// Orkestrasi sinkronisasi Meta lewat Composio: cek | dry | commit | verify. Fakta spend masuk lewat importer yang sudah ada (jalankanImpor → jalankanImporSpend), bukan jalur tulis baru.
// Urutan satu potongan: tarik SEMUA data → rekonsiliasi per hari → referensi (dry lalu commit) → spend (dry lalu commit, totalSumber = Σ kontrol) → metrik tambahan.
// Hari dengan selisih kontrol atau konflik hierarki DITAHAN utuh (tidak ada hari parsial). Gagal tarik/respons kosong tidak menghapus apa pun. Tidak pernah menulis ke Meta dan
// tidak menyentuh customer, chat, touch, order, atau payment. Hari berjalan tidak ditarik: KPI biaya hanya memakai hari penuh.
import crypto from "crypto";
import { jalankanImporSpend } from "./spend.js";
import { jalankanImpor } from "./adReferensi.js";
import { ErrSinkron } from "./spendSyncMeta.js";
import { ATRIBUSI, BREAKDOWN, HOOK_RATE_DEFINISI, hookRate, FLAG_SYNC_COMPOSIO, TRANSPORT, barisDelivery, barisImporter, buatKlien, konfigurasiComposio, konfigurasiKurang, rekonsiliasiHarian, rpKeSen, senKeRp } from "./composioMeta.js";

export const HARI_ROLLING = 7;
const BASI_MENIT = 45;
const hariWib = (d) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
const tgl = (s) => new Date(`${s}T00:00:00Z`);
const geser = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export function daftarHari(dari, sampai) { const o = []; for (let h = dari; h <= sampai; h = geser(h, 1)) o.push(h); return o; }
export function rentangRolling(now = new Date(), hari = HARI_ROLLING) { const k = geser(hariWib(now), -1); return { dari: geser(k, -(hari - 1)), sampai: k }; }
export function potongRentang(dari, sampai, ukuran = 7) { const o = []; for (let a = dari; a <= sampai; a = geser(a, ukuran)) { const b = geser(a, ukuran - 1); o.push({ dari: a, sampai: b < sampai ? b : sampai }); } return o; }
const jsonAman = (x) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
const nInt = (v) => (v === null || v === undefined ? null : Number(v));
const jumlahRp = (lst) => senKeRp(lst.reduce((s, x) => s + (x === null ? 0n : rpKeSen(x) ?? 0n), 0n));

async function ambilKunci(db, akun, mode, dari, sampai) {
  await db.$executeRaw`UPDATE meta_sync_runs SET status='DITINGGALKAN', failure_code='RUN_BASI', finished_at=now() WHERE account_id=${akun} AND status='RUNNING' AND started_at < now() - make_interval(mins => ${BASI_MENIT}::int)`;
  const id = crypto.randomUUID();
  try {
    await db.$executeRaw`INSERT INTO meta_sync_runs (id, account_id, transport, mode, status, date_from, date_to, attribution) VALUES (${id}::uuid, ${akun}, ${TRANSPORT}, ${mode}, 'RUNNING', ${tgl(dari)}, ${tgl(sampai)}, ${JSON.stringify({ ...ATRIBUSI, hookRate: HOOK_RATE_DEFINISI })}::jsonb)`;
    return id;
  } catch (e) {
    if (/23505|meta_sync_runs_satu_berjalan/.test(`${e?.meta?.code ?? ""} ${e?.message ?? ""}`)) return null;
    throw e;
  }
}
async function tutupRun(db, id, r) {
  await db.$executeRaw`UPDATE meta_sync_runs SET status=${r.status}, failure_code=${r.failureCode ?? null}, checkpoint_date=${r.checkpoint ? tgl(r.checkpoint) : null}, complete_through=${r.lengkapSampai ? tgl(r.lengkapSampai) : null},
    control_spend=${r.kontrolSpend ?? null}::numeric, ad_spend=${r.adSpend ?? null}::numeric, selisih_spend=${r.selisih ?? null}::numeric, unmapped_ads=${r.unmapped ?? null}::int, days_reconciled=${r.hariCocok ?? null}::int, days_held=${r.hariDitahan ?? null}::int, summary=${jsonAman(r.ringkas ?? {})}::jsonb, finished_at=now() WHERE id=${id}::uuid`;
}

/** Referensi dari baris fakta (Ad yang punya delivery). Nama = label; ID = kunci. */
const barisReferensi = (rows) => [...new Map(rows.map((r) => [r.adId, { adId: r.adId, adSetId: r.adSetId, campaignId: r.campaignId, adName: r.adName, adSetName: r.adSetName, campaignName: r.campaignName }])).values()];

async function simpanKontrol(db, akun, h, reconciled, runId, now) {
  await db.$executeRaw`INSERT INTO meta_account_daily_control (date_wib, account_id, status, control_spend, control_impressions, control_link_clicks, control_conversations, ad_spend, ad_rows, reconciled, evidence, transport, run_id, fetched_at)
    VALUES (${tgl(h.tanggal)}, ${akun}, ${h.status}, ${h.kontrolSpend}::numeric, ${nInt(h.kontrolImpressions)}::bigint, ${nInt(h.kontrolKlik)}::bigint, ${nInt(h.kontrolKonversasi)}::int, ${h.adSpend}::numeric, ${h.barisAd}::int, ${reconciled}, ${jsonAman(h.evidence ?? null)}::jsonb, ${TRANSPORT}, ${runId}::uuid, ${now})
    ON CONFLICT (date_wib, account_id) DO UPDATE SET status=EXCLUDED.status, control_spend=EXCLUDED.control_spend, control_impressions=EXCLUDED.control_impressions, control_link_clicks=EXCLUDED.control_link_clicks, control_conversations=EXCLUDED.control_conversations, ad_spend=EXCLUDED.ad_spend, ad_rows=EXCLUDED.ad_rows, reconciled=EXCLUDED.reconciled, evidence=EXCLUDED.evidence, run_id=EXCLUDED.run_id, fetched_at=EXCLUDED.fetched_at
      -- bukti lama tidak diturunkan: hari terbukti tidak ditimpa keadaan tidak lengkap, dan nol eksplisit/delivery tidak ditimpa respons kosong
      WHERE NOT (meta_account_daily_control.reconciled AND (EXCLUDED.status = 'DATA_TIDAK_LENGKAP' OR EXCLUDED.status = 'TIDAK_ADA_DELIVERY_TERAMATI' AND meta_account_daily_control.status <> 'TIDAK_ADA_DELIVERY_TERAMATI'))`;
}
async function simpanTambahan(db, klien, potongan, dataAd, hariBoleh, runId, now) {
  const akun = klien.akun; const peringatan = [];
  for (const d of barisDelivery(dataAd)) {
    await db.$executeRaw`INSERT INTO meta_ad_daily_delivery (date_wib, account_id, ad_id, video_3s_views, video_thruplays, impressions, transport, run_id, fetched_at) VALUES (${tgl(d.tanggal)}, ${akun}, ${d.adId}, ${nInt(d.video3s)}::bigint, ${nInt(d.thruplay)}::bigint, ${nInt(d.impressions)}::bigint, ${TRANSPORT}, ${runId}::uuid, ${now})
      ON CONFLICT (date_wib, account_id, ad_id) DO UPDATE SET video_3s_views=EXCLUDED.video_3s_views, video_thruplays=EXCLUDED.video_thruplays, impressions=EXCLUDED.impressions, run_id=EXCLUDED.run_id, fetched_at=EXCLUDED.fetched_at`;
  }
  for (const dim of Object.keys(BREAKDOWN)) {
    try {
      for (const x of await klien.breakdown(potongan.dari, potongan.sampai, dim)) {
        if (!hariBoleh.has(x.date_start)) continue;
        const key = BREAKDOWN[dim].map((f) => String(x[f] ?? "?")).join("|").slice(0, 120);
        await db.$executeRaw`INSERT INTO meta_account_daily_breakdowns (date_wib, account_id, dimension, dimension_key, spend, impressions, link_clicks, reach, transport, run_id, fetched_at) VALUES (${tgl(x.date_start)}, ${akun}, ${dim}, ${key}, ${String(x.spend)}::numeric, ${x.impressions ?? null}::bigint, ${x.inline_link_clicks ?? null}::bigint, ${x.reach ?? null}::bigint, ${TRANSPORT}, ${runId}::uuid, ${now})
          ON CONFLICT (date_wib, account_id, dimension, dimension_key) DO UPDATE SET spend=EXCLUDED.spend, impressions=EXCLUDED.impressions, link_clicks=EXCLUDED.link_clicks, reach=EXCLUDED.reach, run_id=EXCLUDED.run_id, fetched_at=EXCLUDED.fetched_at`;
      }
    } catch (e) { peringatan.push(`BREAKDOWN_${dim}:${e?.kode || "ERROR"}`); }
  }
  try {
    const { hasil, galat } = await klien.objekAd([...new Set(dataAd.map((x) => String(x.ad_id)))]);
    if (galat.length) peringatan.push(`CREATIVE_TIDAK_TERBACA:${galat.length}`);
    for (const [adId, o] of Object.entries(hasil)) {
      const c = o.creative || {};
      await db.$executeRaw`INSERT INTO meta_ad_creatives (ad_id, account_id, creative_id, creative_name, object_story_id, effective_object_story_id, video_id, transport, fetched_at) VALUES (${adId}, ${akun}, ${c.id ?? null}, ${c.name ? String(c.name).slice(0, 200) : null}, ${c.object_story_id ?? null}, ${c.effective_object_story_id ?? null}, ${c.video_id ?? null}, ${TRANSPORT}, ${now})
        ON CONFLICT (ad_id) DO UPDATE SET creative_id=EXCLUDED.creative_id, creative_name=EXCLUDED.creative_name, object_story_id=EXCLUDED.object_story_id, effective_object_story_id=EXCLUDED.effective_object_story_id, video_id=EXCLUDED.video_id, fetched_at=EXCLUDED.fetched_at`;
    }
  } catch (e) { peringatan.push(`CREATIVE:${e?.kode || "ERROR"}`); }
  return peringatan;
}

/** Satu potongan rentang. Melempar ErrSinkron bila tarikan gagal: belum ada yang ditulis untuk potongan itu. */
async function prosesPotongan(db, klien, { potongan, zona, akunTerverifikasi, commit, runId, now }) {
  const akun = klien.akun;
  const dataAd = await klien.insightsAd(potongan.dari, potongan.sampai);
  const dataKontrol = await klien.kontrolAkun(potongan.dari, potongan.sampai);
  // Hari tanpa baris sama sekali: Rp0 hanya bila kontrol harian ditarik ulang, berhasil, lengkap, dan tetap kosong. Bila baris muncul, hari itu tidak lengkap.
  const hari = rekonsiliasiHarian(daftarHari(potongan.dari, potongan.sampai), dataAd, dataKontrol);
  const bukti = (h, tambahan) => ({ akun: akunTerverifikasi, tanggal: h.tanggal, versiTool: klien.versiTool, seluruhHalaman: true, ...tambahan });
  for (const h of hari) if (h.status === "NOL_TERVERIFIKASI") h.evidence = bukti(h, { dasar: "BARIS_KONTROL_SPEND_0" });
    else if (h.rekonsiliasi) h.evidence = bukti(h, { dasar: "KONTROL_SAMA_DENGAN_SIGMA_AD" });
  for (const h of hari.filter((x) => x.status === "PERLU_KONFIRMASI")) {
    const ulang = await klien.kontrolAkun(h.tanggal, h.tanggal);
    const ulangAd = await klien.insightsAd(h.tanggal, h.tanggal);
    const [{ n }] = await db.$queryRaw`SELECT count(*)::int AS n FROM meta_ad_daily_spend WHERE account_id=${akun} AND date_wib=${tgl(h.tanggal)} AND spend > 0`;   // spend tersimpan vs API kosong = kontradiksi, bukan nol
    // Respons kosong BUKAN angka nol: kontrol_spend tetap null, dasar disimpan. Lengkap hanya bila akun, tanggal, akses, seluruh halaman, dan data tersimpan semuanya tervalidasi.
    if (ulang.length === 0 && ulangAd.length === 0 && n === 0) Object.assign(h, { status: "TIDAK_ADA_DELIVERY_TERAMATI", rekonsiliasi: true, evidence: bukti(h, { dasar: "RESPONS_KOSONG_KONSISTEN", tarikanKontrolHarian: 0, tarikanAdHarian: 0, spendTersimpan: 0 }) });
    else Object.assign(h, { status: "DATA_TIDAK_LENGKAP", rekonsiliasi: false, evidence: bukti(h, { dasar: n > 0 ? "API_KOSONG_SPEND_TERSIMPAN_ADA" : "TARIKAN_ULANG_TIDAK_KONSISTEN", seluruhHalaman: true }) });
  }
  const rows = barisImporter(dataAd).map((r, i) => ({ ...r, baris: i + 1 }));
  const ditahan = new Map();
  for (const h of hari) if (!h.rekonsiliasi) ditahan.set(h.tanggal, "SELISIH_KONTROL");
  // referensi dahulu: konflik hierarki tidak ditimpa, hari yang memuat Ad itu ditahan
  const ref0 = barisReferensi(rows);
  const opsiRef = { sumber: "MARKETING_API", izinTransport: TRANSPORT, sekarang: now };
  const dryRef = ref0.length ? await jalankanImpor(db, { rows: ref0, dryRun: true, ...opsiRef }) : null;
  const adKonflik = new Set([...(dryRef?.rencana.konflik || []), ...(dryRef?.rencana.ditolak || [])].map((x) => String(x.adId)));
  for (const r of rows) if (adKonflik.has(String(r.adId)) && !ditahan.has(r.tanggal)) ditahan.set(r.tanggal, "KONFLIK_HIERARKI");
  const pilih = () => rows.filter((r) => !ditahan.has(r.tanggal));
  const opsiSpend = { source: "META_MARKETING_API", accountId: akun, zonaWaktuAkun: zona, sekarang: now };
  let drySpend = null;
  if (pilih().length) {
    drySpend = await jalankanImporSpend(db, { rows: pilih(), dryRun: true, ...opsiSpend });
    for (const x of [...drySpend.rencana.konflik, ...drySpend.rencana.ditolak]) if (x.tanggal && !ditahan.has(x.tanggal)) ditahan.set(x.tanggal, x.alasan);
  }
  const akhir = pilih();
  const hariBoleh = new Set(hari.filter((h) => !ditahan.has(h.tanggal)).map((h) => h.tanggal));
  const hasil = {
    potongan, hari: hari.map((h) => ({ ...h, status: !ditahan.has(h.tanggal) || ditahan.get(h.tanggal) === "SELISIH_KONTROL" ? h.status : "DITAHAN_KONFLIK", alasanTahan: ditahan.get(h.tanggal) ?? null })),
    barisAd: rows.length, adUnik: ref0.length, referensiDry: dryRef?.ringkasan ?? null, spendDry: drySpend?.ringkasan ?? null, peringatan: [], unmapped: drySpend?.ringkasan.adIdTidakTerpetakan ?? 0,
  };
  if (!commit) return hasil;
  const refBoleh = barisReferensi(akhir);
  if (refBoleh.length) {
    const rr = await jalankanImpor(db, { rows: refBoleh, dryRun: false, namaBerkas: `composio-${potongan.dari}-${potongan.sampai}`, ...opsiRef });
    await db.$executeRaw`UPDATE meta_ad_reference_imports SET transport=${TRANSPORT} WHERE id=${rr.importId}::uuid`;
    hasil.referensi = rr.ringkasan;
  }
  if (akhir.length) {
    const ulang = await jalankanImporSpend(db, { rows: akhir, dryRun: true, ...opsiSpend });
    if (ulang.ringkasan.baru + ulang.ringkasan.berubah > 0) {   // impor ulang tanpa perubahan tidak membuat catatan impor baru
      const total = jumlahRp(hari.filter((h) => hariBoleh.has(h.tanggal)).map((h) => h.kontrolSpend));
      const sp = await jalankanImporSpend(db, { rows: akhir, dryRun: false, declaredTotal: total, namaBerkas: `composio-${potongan.dari}-${potongan.sampai}`, ...opsiSpend });
      await db.$executeRaw`UPDATE meta_spend_imports SET transport=${TRANSPORT} WHERE id=${sp.importId}::uuid`;
      hasil.spend = sp.ringkasan;
    } else hasil.spend = ulang.ringkasan;
    hasil.unmapped = 0;   // referensi sudah ditulis sebelum spend
  }
  for (const h of hari) await simpanKontrol(db, akun, h, h.rekonsiliasi && !ditahan.has(h.tanggal), runId, now);
  hasil.peringatan = await simpanTambahan(db, klien, potongan, dataAd.filter((x) => hariBoleh.has(x.date_start)), hariBoleh, runId, now);
  return hasil;
}

/**
 * mode: cek (konfigurasi + akun, tanpa tulis) | dry (tarik + rencana) | commit (hanya bila flag ON) | verify (DB vs kontrol sekarang).
 * Rentang bawaan rolling 7 hari penuh sampai kemarin WIB; hari ini ditolak.
 */
export async function jalankanSinkronComposio(db, { mode = "cek", dari = null, sampai = null, env = process.env, fetchFn, tidurFn, now = new Date(), ukuranPotongan = 7 } = {}) {
  const c = konfigurasiComposio(env);
  const kurang = konfigurasiKurang(c);
  if (kurang.length) return { status: "TIDAK_SIAP", konfigurasiKurang: kurang };
  if (mode === "commit" && !c.aktif) return { status: "TIDAK_SIAP", alasan: `${FLAG_SYNC_COMPOSIO} tidak 'true'` };
  const r0 = rentangRolling(now); const d = dari || r0.dari, s = sampai || r0.sampai;
  if (s >= hariWib(now)) return { status: "DITOLAK", alasan: "HARI_BERJALAN_TIDAK_BOLEH_MASUK_KPI" };
  if (d > s) return { status: "DITOLAK", alasan: "RENTANG_TIDAK_VALID" };
  const klien = buatKlien({ env, ...(fetchFn ? { fetchFn } : {}), ...(tidurFn ? { tidurFn } : {}) });
  if (mode === "cek") {
    try { const project = await klien.periksaProject(); return { status: "SIAP", project, akun: await klien.verifikasiAkun(), flagAktif: c.aktif, atribusi: ATRIBUSI }; }
    catch (e) { if (e instanceof ErrSinkron) return { status: "GAGAL", failureCode: e.kode }; throw e; }
  }
  if (mode === "verify") return verifikasi(db, klien, d, s);
  const runId = await ambilKunci(db, klien.akun, mode, d, s);
  if (!runId) return { status: "SEDANG_BERJALAN" };
  const hasilPotongan = []; let checkpoint = null;
  try {
    const akun = await klien.verifikasiAkun();
    for (const p of potongRentang(d, s, ukuranPotongan)) {
      hasilPotongan.push(await prosesPotongan(db, klien, { potongan: p, zona: akun.zonaWaktu, akunTerverifikasi: akun, commit: mode === "commit", runId, now }));
      checkpoint = p.sampai;
      if (mode === "commit") await db.$executeRaw`UPDATE meta_sync_runs SET checkpoint_date=${tgl(checkpoint)} WHERE id=${runId}::uuid`;
    }
    const refTouch = await lengkapiReferensiTouch(db, klien, { commit: mode === "commit", now });
    const hari = hasilPotongan.flatMap((x) => x.hari); const ditahan = hari.filter((h) => h.alasanTahan);
    const bersih = hari.filter((h) => !h.alasanTahan);
    let lengkap = null; for (const h of hari) { if (h.alasanTahan) break; lengkap = h.tanggal; }   // lengkap sampai: hari tak-ditahan beruntun dari awal rentang
    const r = {
      status: ditahan.length ? "BELUM_DIREKONSILIASI" : mode === "dry" ? "DRY_RUN" : "SUKSES", checkpoint, lengkapSampai: mode === "commit" ? lengkap : null,
      kontrolSpend: jumlahRp(bersih.map((h) => h.kontrolSpend)), adSpend: jumlahRp(bersih.map((h) => h.adSpend)), selisih: jumlahRp(ditahan.map((h) => h.selisihSpend)),
      hariCocok: bersih.length, hariDitahan: ditahan.length, unmapped: hasilPotongan.reduce((a, x) => a + x.unmapped, 0),
      ringkas: { hari: hari.map((h) => ({ t: h.tanggal, s: h.status, ads: h.barisAd, kontrol: h.kontrolSpend, ad: h.adSpend, tahan: h.alasanTahan, selisihKonversasi: h.selisihKonversasi })), referensiTouch: refTouch, peringatan: hasilPotongan.flatMap((x) => x.peringatan), referensi: hasilPotongan.map((x) => x.referensi ?? x.referensiDry), spend: hasilPotongan.map((x) => x.spend ?? x.spendDry) },
    };
    await tutupRun(db, runId, r);
    return { runId, mode, rentang: { dari: d, sampai: s }, ...r, atribusi: ATRIBUSI };
  } catch (e) {
    const kode = e instanceof ErrSinkron ? e.kode : String(e?.code || e?.name || "ERROR").slice(0, 60);
    // gagal tarik: hari yang belum terbukti ditandai tidak lengkap; hari yang sudah terbukti tidak ditimpa dan tidak pernah menjadi Rp0
    if (mode === "commit") for (const t of daftarHari(checkpoint ? geser(checkpoint, 1) : d, s)) await db.$executeRaw`INSERT INTO meta_account_daily_control (date_wib, account_id, status, reconciled, transport, run_id, fetched_at) VALUES (${tgl(t)}, ${klien.akun}, 'DATA_TIDAK_LENGKAP', false, ${TRANSPORT}, ${runId}::uuid, ${now}) ON CONFLICT (date_wib, account_id) DO NOTHING`;
    await tutupRun(db, runId, { status: "GAGAL", failureCode: kode, checkpoint, ringkas: { potonganSelesai: hasilPotongan.length } });
    return { runId, mode, status: "GAGAL", failureCode: kode, checkpoint };
  }
}

async function verifikasi(db, klien, d, s) {
  try {
    await klien.verifikasiAkun();
    const kontrol = await klien.kontrolAkun(d, s);
    const db1 = await db.$queryRaw`SELECT date_wib::text AS t, sum(spend)::text AS spend, count(*)::int AS ads FROM (SELECT DISTINCT ON (date_wib, account_id, ad_id) date_wib, spend FROM meta_ad_daily_spend WHERE account_id=${klien.akun} AND date_wib>=${tgl(d)} AND date_wib<=${tgl(s)} ORDER BY date_wib, account_id, ad_id, CASE source WHEN 'META_MARKETING_API' THEN 1 WHEN 'WINDSOR_API' THEN 2 ELSE 3 END) x GROUP BY 1`;
    const nolTersimpan = new Map((await db.$queryRaw`SELECT date_wib::text AS t, status FROM meta_account_daily_control WHERE account_id=${klien.akun} AND reconciled AND status IN ('NOL_TERVERIFIKASI','TIDAK_ADA_DELIVERY_TERAMATI') AND date_wib>=${tgl(d)} AND date_wib<=${tgl(s)}`).map((x) => [x.t, x.status]));
    const perDb = new Map(db1.map((x) => [x.t, x])); const perK = new Map(kontrol.map((k) => [k.date_start, k]));
    const hari = daftarHari(d, s).map((t) => {
      const a = perDb.get(t), k = perK.get(t); const sa = a ? rpKeSen(Number(a.spend).toFixed(2)) : null, sk = k ? rpKeSen(k.spend) : null;
      const status = !a && !k ? (nolTersimpan.get(t) ?? "DATA_TIDAK_LENGKAP") : !a ? "DATA_HILANG" : !k ? "DB_ADA_KONTROL_TIDAK" : sa === sk ? "COCOK" : "SELISIH";
      return { tanggal: t, status, db: a ? senKeRp(sa) : null, kontrol: k ? senKeRp(sk) : null, ads: a?.ads ?? 0 };
    });
    return { status: hari.every((h) => ["COCOK", "NOL_TERVERIFIKASI", "TIDAK_ADA_DELIVERY_TERAMATI"].includes(h.status)) ? "TERVERIFIKASI" : "BELUM_TERVERIFIKASI", rentang: { dari: d, sampai: s }, hari };
  } catch (e) { if (e instanceof ErrSinkron) return { status: "GAGAL", failureCode: e.kode }; throw e; }
}

/** Ad ber-touch tanpa referensi: ambil hierarki resmi per ID (juga Ad tanpa spend), lewat importer. Konflik tidak ditimpa; Ad tak terbaca dilaporkan. */
export async function lengkapiReferensiTouch(db, klien, { commit = false, now = new Date() } = {}) {
  const baris = await db.$queryRaw`SELECT DISTINCT t.ad_id FROM attribution_touches t LEFT JOIN meta_ad_references r ON r.ad_id = t.ad_id WHERE t.ad_id IS NOT NULL AND r.ad_id IS NULL`;
  const ids = baris.map((x) => String(x.ad_id)).filter((x) => /^\d{5,32}$/.test(x)).sort();
  if (!ids.length) return { kandidat: 0, terbaca: 0, tidakTerbaca: 0, ringkasan: null };
  const { rows, galat } = await klien.hierarkiAd(ids);
  const hasil = rows.length ? await jalankanImpor(db, { rows, sumber: "MARKETING_API", dryRun: !commit, izinTransport: TRANSPORT, namaBerkas: "composio-referensi-touch", sekarang: now }) : null;
  if (commit && hasil?.importId) await db.$executeRaw`UPDATE meta_ad_reference_imports SET transport=${TRANSPORT} WHERE id=${hasil.importId}::uuid`;
  return { kandidat: ids.length, terbaca: rows.length, tidakTerbaca: galat.length, ringkasan: hasil?.ringkasan ?? null };
}

/** Hook rate rentang tanggal dari data tersimpan (definisi terkunci). Baca-saja. */
export async function ringkasHookRate(db, { dari, sampai }) {
  const rows = await db.$queryRaw`SELECT d.video_3s_views AS v, d.impressions AS i, r.campaign_id AS camp, CASE WHEN c.ad_id IS NULL THEN 'TIDAK_DIKETAHUI' WHEN c.video_id IS NULL THEN 'BUKAN_VIDEO' ELSE 'VIDEO' END AS jenis
    FROM meta_ad_daily_delivery d LEFT JOIN meta_ad_creatives c ON c.ad_id = d.ad_id LEFT JOIN meta_ad_references r ON r.ad_id = d.ad_id WHERE d.date_wib >= ${tgl(dari)} AND d.date_wib <= ${tgl(sampai)}`;
  const b = rows.map((x) => ({ video3s: x.v, impressions: x.i, jenis: x.jenis, camp: x.camp ?? "UNMAPPED" }));
  const perCampaign = Object.fromEntries([...new Set(b.map((x) => x.camp))].sort().map((c) => [c, hookRate(b.filter((x) => x.camp === c))]));
  return { definisi: HOOK_RATE_DEFINISI, rentang: { dari, sampai }, total: hookRate(b), perCampaign };
}

/** MURNI. Satu keadaan untuk panel, urutan sesuai yang paling perlu tindakan. */
export function keadaanSinkron({ konfigKurang, aktif, coba, lengkapSampai, kemarin, adaBelumRekon }) {
  if (coba?.status === "RUNNING") return "BERJALAN";
  if (konfigKurang.length) return "BELUM_DIKONFIGURASI";
  if (!aktif) return "NONAKTIF";
  if (!coba) return "BELUM_PERNAH_BERJALAN";
  if (coba.status === "GAGAL" || coba.status === "DITINGGALKAN") return "GAGAL";
  if (coba.status === "BELUM_DIREKONSILIASI" || adaBelumRekon) return "SELISIH_KONTROL";
  if (!lengkapSampai || lengkapSampai < kemarin) return "DATA_TERLAMBAT";
  return "SUKSES";
}

/** Status untuk laporan/kesehatan: baca-saja, tidak memanggil Composio. Nama konfigurasi yang kurang boleh tampil; nilainya tidak pernah. */
export async function statusSinkronMeta(db, { env = process.env, now = new Date() } = {}) {
  const [coba] = await db.$queryRaw`SELECT status, mode, started_at, finished_at, failure_code, selisih_spend::text AS selisih, unmapped_ads, days_held FROM meta_sync_runs ORDER BY started_at DESC LIMIT 1`;
  const [sukses] = await db.$queryRaw`SELECT finished_at, complete_through::text AS lengkap FROM meta_sync_runs WHERE mode='commit' AND status='SUKSES' ORDER BY finished_at DESC LIMIT 1`;
  const belum = await db.$queryRaw`SELECT date_wib::text AS tanggal, status FROM meta_account_daily_control WHERE NOT reconciled ORDER BY date_wib DESC LIMIT 30`;
  const c = konfigurasiComposio(env); const konfigKurang = konfigurasiKurang(c); const kemarin = geser(hariWib(now), -1);
  return {
    keadaan: keadaanSinkron({ konfigKurang, aktif: c.aktif, coba, lengkapSampai: sukses?.lengkap ?? null, kemarin, adaBelumRekon: belum.length > 0 }), flagAktif: c.aktif, konfigurasiKurang: konfigKurang, kemarin,
    transport: TRANSPORT, sumber: "META_MARKETING_API", pernahBerjalan: !!coba,
    terakhirDicoba: coba ? { waktu: coba.started_at, selesai: coba.finished_at, mode: coba.mode, status: coba.status, alasanGagal: coba.failure_code, selisihSpend: coba.selisih === null ? null : Number(coba.selisih), unmapped: coba.unmapped_ads, hariDitahan: coba.days_held } : null,
    terakhirSukses: sukses ? { waktu: sukses.finished_at } : null, dataLengkapSampai: sukses?.lengkap ?? null, hariBelumRekonsiliasi: belum,
  };
}
