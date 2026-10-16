// ATRIBUSI META ADS FASE 3 — spend harian per Ad ID: parser CSV Ads Manager, validasi, rencana impor (murni), commit idempoten + revisi, rekonsiliasi total.
//
// PRINSIP: ID = string digit (kunci); nama = label. Tanggal = tanggal delivery pada zona waktu AKUN iklan; akun HARUS berzona WIB (UTC+7) karena spend harian
// tidak bisa dikonversi antar-zona tanpa data per jam. Mata uang hanya IDR. Spend >= 0, format ketat (tanpa pemisah ribuan/koma/notasi ilmiah).
// Tidak menyimpan token, respons mentah Meta, atau data pelanggan. Impor ulang hari yang sama memperbarui snapshot DAN menyimpan nilai lama di meta_ad_spend_revisions.
// Unik per (tanggal WIB, akun, Ad ID, sumber); laporan memilih SATU sumber per (tanggal, akun, Ad ID) menurut prioritas sehingga spend tidak pernah ganda.
import crypto from "crypto";
import { parseCsv } from "./adReferensi.js";

export const SUMBER_SPEND = Object.freeze(["ADS_MANAGER_CSV", "META_MARKETING_API", "WINDSOR_API"]);
export const PRIORITAS_SUMBER = Object.freeze({ META_MARKETING_API: 1, WINDSOR_API: 2, ADS_MANAGER_CSV: 3 });
export const ZONA_WIB = Object.freeze(["Asia/Jakarta", "Asia/Pontianak"]);
export const MAKS_BARIS_SPEND = 20_000;
export const MAKS_HARI_IMPOR = 93;
const ID_RE = /^\d{5,32}$/;
const TGL_RE = /^\d{4}-\d{2}-\d{2}$/;
const SPEND_RE = /^\d{1,13}(\.\d{1,2})?$/;
const INT_RE = /^\d{1,15}$/;

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
// kolom → { f: field kanonik, mata uang tersirat (dari judul kolom) }
const KOLOM = {
  day: { f: "tanggal" }, hari: { f: "tanggal" }, date: { f: "tanggal" }, tanggal: { f: "tanggal" }, reportingstarts: { f: "tanggal" }, mulaipelaporan: { f: "tanggal" },
  accountid: { f: "accountId" }, idakun: { f: "accountId" }, account: { f: "accountId" },
  campaignid: { f: "campaignId" }, idkampanye: { f: "campaignId" }, idcampaign: { f: "campaignId" },
  adsetid: { f: "adSetId" }, idsetiklan: { f: "adSetId" }, idadset: { f: "adSetId" },
  adid: { f: "adId" }, idiklan: { f: "adId" }, idad: { f: "adId" },
  campaignname: { f: "campaignName" }, namakampanye: { f: "campaignName" },
  adsetname: { f: "adSetName" }, namasetiklan: { f: "adSetName" },
  adname: { f: "adName" }, namaiklan: { f: "adName" },
  currency: { f: "currency" }, matauang: { f: "currency" }, accountcurrency: { f: "currency" },
  amountspent: { f: "spend" }, spend: { f: "spend" }, cost: { f: "spend" }, jumlahyangdibelanjakan: { f: "spend" }, biaya: { f: "spend" },
  impressions: { f: "impressions" }, tayangan: { f: "impressions" },
  reach: { f: "reach" }, jangkauan: { f: "reach" },
  linkclicks: { f: "linkClicks" }, klikpadatautan: { f: "linkClicks" },
  messagingconversationsstarted: { f: "platformConversations" }, percakapanmessagingdimulai: { f: "platformConversations" }, results: { f: "platformConversations" }, hasil: { f: "platformConversations" },
  messagingconversationsstarted7d: { f: "platformConversations" },
};
// judul kolom spend yang menyebut mata uang: "Amount spent (IDR)" → idr
const SPEND_MATA_UANG = /^(?:amountspent|jumlahyangdibelanjakan|spend|cost|biaya)([a-z]{3})$/;

/** CSV (teks) → { baris:[{baris, tanggal, accountId, ...}], galat, mataUangKolom } */
export function barisSpendDariCsv(teks) {
  const t = parseCsv(teks);
  if (t.length === 0) return { baris: [], galat: "BERKAS_KOSONG", mataUangKolom: null };
  let mataUangKolom = null;
  const peta = t[0].map((h) => {
    const n = norm(h);
    const m = SPEND_MATA_UANG.exec(n);
    if (m) { mataUangKolom = m[1].toUpperCase(); return "spend"; }
    return KOLOM[n]?.f || null;
  });
  for (const wajib of ["tanggal", "adId", "adSetId", "campaignId", "spend"]) if (!peta.includes(wajib)) return { baris: [], galat: `KOLOM_WAJIB_HILANG:${wajib}`, mataUangKolom };
  const baris = t.slice(1).map((r, i) => {
    const o = { baris: i + 2 };
    r.forEach((v, j) => { if (peta[j]) o[peta[j]] = v; });
    return o;
  });
  return { baris, galat: null, mataUangKolom };
}

const label = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return s === "" ? null : s;
};
const idBersih = (v) => {
  const s = String(v ?? "").trim();
  if (s === "") return { ok: false, alasan: "KOSONG" };
  if (/[eE][+-]?\d/.test(s) || /^\d+[.,]\d+$/.test(s)) return { ok: false, alasan: "NOTASI_ILMIAH_ATAU_DESIMAL" };
  if (!ID_RE.test(s)) return { ok: false, alasan: "BUKAN_ID_DIGIT" };
  return { ok: true, id: s };
};
const bersihkanAkun = (v) => String(v ?? "").trim().replace(/^act_/i, "");
const intOpsional = (v) => {
  const s = String(v ?? "").trim();
  if (s === "") return { ok: true, nilai: null };
  if (!INT_RE.test(s)) return { ok: false };
  return { ok: true, nilai: Number(s) };
};
const tanggalValid = (s) => {
  if (!TGL_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** Sidik checksum nilai angka satu baris (deteksi perubahan snapshot). */
export function checksumBaris(r) {
  return crypto.createHash("sha256").update([r.spend, r.impressions ?? "", r.reach ?? "", r.linkClicks ?? "", r.platformConversations ?? ""].join("|")).digest("hex");
}

/**
 * Validasi + normalisasi satu baris mentah → { ok:true, row } | { ok:false, alasan }.
 * ctx: { accountId, currency, mataUangKolom }
 */
export function validasiBarisSpend(b, ctx = {}) {
  const tanggal = String(b.tanggal ?? "").trim();
  if (!tanggalValid(tanggal)) return { ok: false, alasan: "TANGGAL_TIDAK_VALID_ISO" };
  const akunMentah = bersihkanAkun(b.accountId ?? ctx.accountId);
  const akun = idBersih(akunMentah);
  if (!akun.ok) return { ok: false, alasan: `ACCOUNT_ID_${akun.alasan}` };
  if (ctx.accountId && akun.id !== bersihkanAkun(ctx.accountId)) return { ok: false, alasan: "ACCOUNT_ID_BEDA_DARI_PARAMETER" };
  const a = idBersih(b.adId), s = idBersih(b.adSetId), c = idBersih(b.campaignId);
  if (!a.ok) return { ok: false, alasan: `AD_ID_${a.alasan}` };
  if (!s.ok) return { ok: false, alasan: `AD_SET_ID_${s.alasan}` };
  if (!c.ok) return { ok: false, alasan: `CAMPAIGN_ID_${c.alasan}` };
  if (a.id === s.id || a.id === c.id || s.id === c.id) return { ok: false, alasan: "ID_BERTINGKAT_SAMA" };
  // semua petunjuk mata uang (kolom baris, judul kolom spend, parameter) harus IDR; satu saja yang lain = tolak
  const petunjuk = [b.currency, ctx.mataUangKolom, ctx.currency].map((x) => String(x ?? "").trim().toUpperCase()).filter((x) => x !== "");
  if (petunjuk.length === 0) return { ok: false, alasan: "MATA_UANG_TIDAK_ADA" };
  if (petunjuk.some((x) => x !== "IDR")) return { ok: false, alasan: "MATA_UANG_BUKAN_IDR" };
  const sp = String(b.spend ?? "").trim();
  if (sp === "") return { ok: false, alasan: "SPEND_KOSONG" };
  if (/^-/.test(sp)) return { ok: false, alasan: "SPEND_NEGATIF" };
  if (/[eE][+-]?\d/.test(sp)) return { ok: false, alasan: "SPEND_NOTASI_ILMIAH" };
  if (!SPEND_RE.test(sp)) return { ok: false, alasan: "SPEND_FORMAT_TIDAK_DIKENAL" };
  const spend = Math.round(Number(sp) * 100) / 100;
  const imp = intOpsional(b.impressions), rea = intOpsional(b.reach), klik = intOpsional(b.linkClicks), konv = intOpsional(b.platformConversations);
  if (!imp.ok) return { ok: false, alasan: "IMPRESSIONS_TIDAK_VALID" };
  if (!rea.ok) return { ok: false, alasan: "REACH_TIDAK_VALID" };
  if (!klik.ok) return { ok: false, alasan: "LINK_CLICKS_TIDAK_VALID" };
  if (!konv.ok) return { ok: false, alasan: "KONVERSASI_PLATFORM_TIDAK_VALID" };
  const row = {
    tanggal, accountId: akun.id, campaignId: c.id, adSetId: s.id, adId: a.id,
    campaignName: label(b.campaignName), adSetName: label(b.adSetName), adName: label(b.adName),
    currency: "IDR", spend, impressions: imp.nilai, reach: rea.nilai, linkClicks: klik.nilai, platformConversations: konv.nilai,
    platformResultType: label(b.platformResultType) ? String(label(b.platformResultType)).slice(0, 80) : null,
    sourceUpdatedAt: b.sourceUpdatedAt ?? null,
  };
  row.checksum = checksumBaris(row);
  return { ok: true, row };
}

const kunciHari = (r) => `${r.tanggal}|${r.accountId}|${r.adId}`;

/**
 * Rencana impor (MURNI). `ada`: Map `${tanggal}|${akun}|${adId}` → baris tersimpan (sumber SAMA). `referensi`: Map adId → { adSetId, campaignId }.
 * Hasil: { baru, berubah, sama, konflik, ditolak, tidakTerpetakan:Set } — konflik: hierarki menyimpang dari referensi atau dari spend tersimpan Ad yang sama.
 */
export function rencanaSpend(rows, { ctx = {}, ada = new Map(), referensi = new Map(), hierarkiTersimpan = new Map() } = {}) {
  const ditolak = [], valid = [];
  for (const b of rows) {
    const v = validasiBarisSpend(b, ctx);
    if (!v.ok) ditolak.push({ baris: b.baris ?? null, adId: String(b.adId ?? "").slice(0, 32) || null, tanggal: String(b.tanggal ?? "").slice(0, 10) || null, alasan: v.alasan });
    else valid.push({ baris: b.baris ?? null, ...v.row });
  }
  // duplikat dalam berkas: identik → satu; bertentangan → keduanya ditolak
  const grup = new Map();
  for (const r of valid) (grup.get(kunciHari(r)) || grup.set(kunciHari(r), []).get(kunciHari(r))).push(r);
  const unik = [];
  for (const [, lst] of grup) {
    const sama = lst.every((x) => x.checksum === lst[0].checksum && x.adSetId === lst[0].adSetId && x.campaignId === lst[0].campaignId);
    if (!sama) { for (const x of lst) ditolak.push({ baris: x.baris, adId: x.adId, tanggal: x.tanggal, alasan: "DUPLIKAT_BERTENTANGAN" }); continue; }
    unik.push(lst[0]);
  }
  const hasil = { baru: [], berubah: [], sama: [], konflik: [], ditolak, tidakTerpetakan: new Set() };
  for (const r of unik) {
    const ref = referensi.get(r.adId);
    if (ref && (ref.adSetId !== r.adSetId || ref.campaignId !== r.campaignId)) { hasil.konflik.push({ baris: r.baris, adId: r.adId, tanggal: r.tanggal, alasan: "HIERARKI_BEDA_DARI_REFERENSI" }); continue; }
    const h = hierarkiTersimpan.get(r.adId);
    if (h && (h.adSetId !== r.adSetId || h.campaignId !== r.campaignId)) { hasil.konflik.push({ baris: r.baris, adId: r.adId, tanggal: r.tanggal, alasan: "HIERARKI_BEDA_DARI_SPEND_TERSIMPAN" }); continue; }
    if (!ref) hasil.tidakTerpetakan.add(r.adId);
    const lama = ada.get(kunciHari(r));
    if (!lama) hasil.baru.push(r);
    else if (lama.rowChecksum === r.checksum) hasil.sama.push({ ...r, lamaId: lama.id });
    else hasil.berubah.push({ ...r, lama });
  }
  return hasil;
}

export const sidikJari = (teks) => crypto.createHash("sha256").update(String(teks ?? "")).digest("hex");
const bulat2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const hariAntara = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

class ErrSpend extends Error { constructor(msg, statusCode, code) { super(msg); this.statusCode = statusCode; this.code = code; } }

/**
 * Impor/sinkron spend. dryRun DEFAULT true (tidak menulis). Satu transaksi; kunci advisory per akun mencegah dua proses menimpa periode yang sama.
 * @param {object} p { rows, source, accountId, zonaWaktuAkun, dryRun, declaredTotal, namaBerkas, sidik, userId, mataUangKolom, sekarang }
 */
export async function jalankanImporSpend(db, p) {
  const { rows, source = "ADS_MANAGER_CSV", accountId, zonaWaktuAkun = null, dryRun = true, declaredTotal = null, namaBerkas = null, sidik = null, userId = null, mataUangKolom = null, sekarang = new Date() } = p;
  if (!SUMBER_SPEND.includes(source)) throw new ErrSpend("sumber tidak dikenal", 400, "SUMBER_TIDAK_DIKENAL");
  const akun = idBersih(bersihkanAkun(accountId));
  if (!akun.ok) throw new ErrSpend("accountId wajib berupa string digit (tanpa act_)", 400, "ACCOUNT_ID_TIDAK_VALID");
  if (!Array.isArray(rows) || rows.length === 0) throw new ErrSpend("tidak ada baris untuk diimpor", 400, "TANPA_BARIS");
  if (rows.length > MAKS_BARIS_SPEND) throw new ErrSpend(`maksimum ${MAKS_BARIS_SPEND} baris per impor`, 413, "TERLALU_BANYAK_BARIS");
  const zonaOk = zonaWaktuAkun ? ZONA_WIB.includes(zonaWaktuAkun) : null;
  if (zonaWaktuAkun && !zonaOk) throw new ErrSpend(`zona waktu akun ${String(zonaWaktuAkun).slice(0, 40)} bukan WIB; spend harian tidak dapat dikonversi tanpa data per jam`, 422, "ZONA_WAKTU_BUKAN_WIB");
  if (!dryRun && !zonaOk) throw new ErrSpend("commit wajib menyebut zonaWaktuAkun (Asia/Jakarta): verifikasi zona waktu akun iklan di Ads Manager", 400, "ZONA_WAKTU_WAJIB");
  let decl = null;
  if (declaredTotal !== null && declaredTotal !== undefined && String(declaredTotal).trim() !== "") {
    if (!SPEND_RE.test(String(declaredTotal).trim())) throw new ErrSpend("totalSumber harus angka rupiah polos (mis. 1234567.50)", 400, "TOTAL_SUMBER_TIDAK_VALID");
    decl = bulat2(declaredTotal);
  }

  const ctx = { accountId: akun.id, mataUangKolom };
  // muat keadaan tersimpan yang relevan (baca)
  const adIds = [...new Set(rows.map((r) => String(r.adId ?? "").trim()).filter((x) => ID_RE.test(x)))];
  const tgl = rows.map((r) => String(r.tanggal ?? "").trim()).filter(tanggalValid).sort();
  const dari = tgl[0] ?? null, sampai = tgl[tgl.length - 1] ?? null;
  if (dari && hariAntara(dari, sampai) + 1 > MAKS_HARI_IMPOR) throw new ErrSpend(`rentang tanggal berkas maksimum ${MAKS_HARI_IMPOR} hari`, 422, "RENTANG_TERLALU_PANJANG");
  const ambil = async (tx) => {
    const refs = adIds.length ? await tx.metaAdReference.findMany({ where: { adId: { in: adIds } }, select: { adId: true, adSetId: true, campaignId: true } }) : [];
    const tersimpan = adIds.length && dari ? await tx.metaAdDailySpend.findMany({ where: { adId: { in: adIds }, accountId: akun.id, source, dateWib: { gte: new Date(`${dari}T00:00:00Z`), lte: new Date(`${sampai}T00:00:00Z`) } } }) : [];
    const hier = adIds.length ? await tx.metaAdDailySpend.findMany({ where: { adId: { in: adIds } }, distinct: ["adId"], select: { adId: true, adSetId: true, campaignId: true } }) : [];
    return {
      referensi: new Map(refs.map((r) => [r.adId, r])),
      ada: new Map(tersimpan.map((r) => [`${r.dateWib.toISOString().slice(0, 10)}|${r.accountId}|${r.adId}`, r])),
      hierarkiTersimpan: new Map(hier.map((r) => [r.adId, r])),
    };
  };
  const ringkas = (rencana) => {
    const diterima = [...rencana.baru, ...rencana.berubah, ...rencana.sama];
    const totalImpor = bulat2(diterima.reduce((s, r) => s + r.spend, 0));
    const perTanggalMap = new Map();
    for (const r of diterima) { const x = perTanggalMap.get(r.tanggal) || { tanggal: r.tanggal, spend: 0, ads: 0 }; x.spend = bulat2(x.spend + r.spend); x.ads++; perTanggalMap.set(r.tanggal, x); }
    const rek = { totalImpor, totalSumber: decl, selisih: decl === null ? null : bulat2(totalImpor - decl), cocok: decl === null ? null : bulat2(totalImpor - decl) === 0 };
    return {
      ringkasan: { total: rows.length, diterima: diterima.length, baru: rencana.baru.length, berubah: rencana.berubah.length, tidakBerubah: rencana.sama.length, konflik: rencana.konflik.length, ditolak: rencana.ditolak.length, adIdTidakTerpetakan: rencana.tidakTerpetakan.size },
      rekonsiliasi: rek, perTanggal: [...perTanggalMap.values()].sort((a, b) => (a.tanggal < b.tanggal ? -1 : 1)), totalImpor,
    };
  };

  if (dryRun) {
    const st = await ambil(db);
    const rencana = rencanaSpend(rows, { ctx, ...st });
    const r = ringkas(rencana);
    return { dryRun: true, ...r, rencana, zonaWaktu: { diberikan: zonaWaktuAkun, valid: zonaOk, aturan: "Akun iklan wajib berzona waktu WIB (Asia/Jakarta); tanggal Meta mengikuti zona akun." } };
  }

  return db.$transaction(async (tx) => {
    const [{ locked }] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${"meta_spend_import:" + akun.id})) AS locked`;
    if (!locked) throw new ErrSpend("impor/sinkronisasi spend untuk akun ini sedang berjalan", 409, "SEDANG_DIIMPOR");
    const st = await ambil(tx);
    const rencana = rencanaSpend(rows, { ctx, ...st });
    const r = ringkas(rencana);
    if (decl !== null && !r.rekonsiliasi.cocok) throw Object.assign(new ErrSpend(`total impor ${r.rekonsiliasi.totalImpor} ≠ total sumber ${decl} (selisih ${r.rekonsiliasi.selisih}); tidak ada yang ditulis`, 409, "TOTAL_TIDAK_COCOK"), { detail: r });
    const imp = await tx.metaSpendImport.create({
      data: {
        source, accountId: akun.id, fileName: namaBerkas ? String(namaBerkas).slice(0, 120) : null, contentSha256: sidik || sidikJari(JSON.stringify(rows)),
        dateFrom: dari ? new Date(`${dari}T00:00:00Z`) : null, dateTo: sampai ? new Date(`${sampai}T00:00:00Z`) : null, accountTimezone: zonaWaktuAkun,
        rowsTotal: r.ringkasan.total, rowsAccepted: r.ringkasan.diterima, rowsRejected: r.ringkasan.ditolak + r.ringkasan.konflik,
        rowsNew: r.ringkasan.baru, rowsUpdated: r.ringkasan.berubah, rowsUnchanged: r.ringkasan.tidakBerubah,
        spendTotal: r.totalImpor, declaredTotal: decl, createdById: userId,
      },
      select: { id: true },
    });
    const data = (x) => ({
      campaignId: x.campaignId, adSetId: x.adSetId, campaignName: x.campaignName, adSetName: x.adSetName, adName: x.adName, currency: "IDR", spend: x.spend,
      impressions: x.impressions, reach: x.reach, linkClicks: x.linkClicks, platformConversations: x.platformConversations, platformResultType: x.platformResultType,
      accountTimezone: zonaWaktuAkun, sourceUpdatedAt: x.sourceUpdatedAt ? new Date(x.sourceUpdatedAt) : null, importedAt: sekarang, importId: imp.id, rowChecksum: x.checksum,
    });
    for (const x of rencana.baru) {
      await tx.metaAdDailySpend.create({ data: { dateWib: new Date(`${x.tanggal}T00:00:00Z`), accountId: akun.id, adId: x.adId, source, revision: 1, ...data(x) } });
    }
    for (const x of rencana.berubah) {
      const l = x.lama;
      await tx.metaAdSpendRevision.create({
        data: { spendId: l.id, revision: l.revision, prevSpend: l.spend, prevImpressions: l.impressions, prevReach: l.reach, prevLinkClicks: l.linkClicks, prevPlatformConversations: l.platformConversations, prevChecksum: l.rowChecksum, prevImportId: l.importId, prevImportedAt: l.importedAt, newImportId: imp.id },
      });
      await tx.metaAdDailySpend.update({ where: { id: l.id }, data: { ...data(x), revision: l.revision + 1 } });
    }
    return { dryRun: false, importId: imp.id, ...r, rencana };
  }, { timeout: 60_000, maxWait: 5_000 });
}

/** Spend per Ad dalam rentang tanggal WIB: SATU sumber per (tanggal, akun, Ad ID) menurut prioritas. READ-ONLY (dipanggil dalam transaksi laporan). */
export async function muatSpendPerAd(tx, { dari, sampai }) {
  const d1 = new Date(`${dari}T00:00:00Z`), d2 = new Date(`${sampai}T00:00:00Z`);
  const baris = await tx.$queryRaw`
    WITH terpilih AS (
      SELECT DISTINCT ON (date_wib, account_id, ad_id) date_wib, account_id, ad_id, spend, impressions, link_clicks, platform_conversations
        FROM meta_ad_daily_spend
       WHERE date_wib >= ${d1} AND date_wib <= ${d2}
       ORDER BY date_wib, account_id, ad_id, CASE source WHEN 'META_MARKETING_API' THEN 1 WHEN 'WINDSOR_API' THEN 2 ELSE 3 END)
    SELECT ad_id, sum(spend)::text AS spend, sum(impressions)::text AS impressions, sum(link_clicks)::text AS link_clicks,
           sum(platform_conversations)::text AS konversasi, count(DISTINCT date_wib)::int AS hari
      FROM terpilih GROUP BY ad_id`;
  const [kes] = await tx.$queryRaw`
    SELECT (SELECT max(date_wib)::text FROM meta_ad_daily_spend) AS terakhir_tanggal,
           (SELECT max(created_at) FROM meta_spend_imports) AS terakhir_import,
           (SELECT count(*)::int FROM meta_ad_daily_spend WHERE date_wib >= ${d1} AND date_wib <= ${d2}) AS baris_di_rentang`;
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  return {
    spendPerAd: baris.map((b) => ({ adId: b.ad_id, spend: bulat2(b.spend), impressions: num(b.impressions), linkClicks: num(b.link_clicks), platformConversations: num(b.konversasi), hariAdaSpend: b.hari })),
    kesegaranMentah: { terakhirTanggal: kes.terakhir_tanggal ?? null, terakhirImportAt: kes.terakhir_import ? new Date(kes.terakhir_import).toISOString() : null, adaDataDiRentang: kes.baris_di_rentang > 0 },
  };
}

/** Ringkasan harian spend (untuk endpoint /spend): per tanggal, per sumber, Σ spend, jumlah Ad, dan Ad yang belum punya referensi. Read-only. */
export async function ringkasanSpendHarian(db, { dari, sampai }) {
  const d1 = new Date(`${dari}T00:00:00Z`), d2 = new Date(`${sampai}T00:00:00Z`);
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const harian = await tx.$queryRaw`
      WITH terpilih AS (
        SELECT DISTINCT ON (date_wib, account_id, ad_id) date_wib, account_id, ad_id, ad_set_id, campaign_id, spend, source
          FROM meta_ad_daily_spend WHERE date_wib >= ${d1} AND date_wib <= ${d2}
         ORDER BY date_wib, account_id, ad_id, CASE source WHEN 'META_MARKETING_API' THEN 1 WHEN 'WINDSOR_API' THEN 2 ELSE 3 END)
      SELECT t.date_wib::text AS tanggal, count(*)::int AS ads, count(DISTINCT t.ad_set_id)::int AS adsets, count(DISTINCT t.campaign_id)::int AS campaigns,
             sum(t.spend)::text AS spend, sum(t.spend) FILTER (WHERE r.ad_id IS NULL)::text AS spend_unmapped,
             string_agg(DISTINCT t.source, ',') AS sumber
        FROM terpilih t LEFT JOIN meta_ad_references r ON r.ad_id = t.ad_id GROUP BY t.date_wib ORDER BY t.date_wib`;
    const imp = await tx.$queryRaw`SELECT id::text, source, account_id, date_from::text, date_to::text, rows_total, rows_accepted, rows_rejected, rows_new, rows_updated, rows_unchanged, spend_total::text, declared_total::text, created_at FROM meta_spend_imports ORDER BY created_at DESC LIMIT 10`;
    const [kes] = await tx.$queryRaw`SELECT max(date_wib)::text AS terakhir_tanggal, count(*)::int AS baris FROM meta_ad_daily_spend`;
    return {
      rentang: { dari, sampai },
      harian: harian.map((h) => ({ tanggal: h.tanggal, ads: h.ads, adSets: h.adsets, campaigns: h.campaigns, spend: bulat2(h.spend), spendUnmapped: bulat2(h.spend_unmapped), sumber: h.sumber.split(",") })),
      totalSpend: bulat2(harian.reduce((s, h) => s + bulat2(h.spend), 0)),
      impor: imp.map((i) => ({ id: i.id, sumber: i.source, akun: i.account_id, dari: i.date_from, sampai: i.date_to, baris: i.rows_total, diterima: i.rows_accepted, ditolak: i.rows_rejected, baru: i.rows_new, diperbarui: i.rows_updated, tidakBerubah: i.rows_unchanged, spendTotal: bulat2(i.spend_total), totalSumber: i.declared_total === null ? null : bulat2(i.declared_total), waktu: new Date(i.created_at).toISOString() })),
      kesegaran: { terakhirTanggal: kes.terakhir_tanggal ?? null, barisTersimpan: kes.baris },
    };
  });
}

export { ErrSpend };
