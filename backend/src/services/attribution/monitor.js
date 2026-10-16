// ATRIBUSI META ADS FASE 3 — monitoring operasional (AGREGAT SAJA). Tidak pernah memuat nomor, nama, chat, JID, clid mentah, payload, atau data kesehatan.
//
//   ambilSnapshotMonitor(db, opsi) : kumpulkan angka (WAHA per sesi, inbound, touch, pemetaan, UNKNOWN, duplikat, capture Fase 0 vs touch, kesegaran referensi dan spend).
//   evaluasiAlarm(snapshot, cfg)    : MURNI. Kembalikan daftar kondisi { key, level: OK|WARN|CRIT, pesan, nilai } — tanpa efek samping.
//   levelGabungan(daftar)           : 0 sehat | 1 peringatan | 2 kritis (kode keluar skrip cron).
//   rencanaNotifikasi(daftar, state, now, cfg) : MURNI. Cooldown (tidak mengulang tiap menit) + pemberitahuan PULIH saat kembali sehat.
import fs from "fs";
import path from "path";
import { hitungKesehatanCapture } from "./captureHealth.js";
import { captureDir } from "../ctwaCapture.js";

export const CFG_BAWAAN = Object.freeze({
  inboundSepiMenit: 30,
  basisMinimalPer30Menit: 4,       // alarm "sepi" hanya bila rata-rata jam yang sama >= 4 pesan per 30 menit (P(0) < 2%) → malam hari tidak alarm palsu
  tertundaDetik: 600,
  unknownPersenMaks: 10,
  mappingPersenMin: 95,
  sampelMinimal: 30,
  tenggangCaptureMenit: 5,         // CTWA bersinyal yang baru < 5 menit belum dianggap hilang
  spendTertinggalHariMaks: 2,
  cooldownMenit: 60,
});

const MENIT = 60_000, JAM = 3_600_000;
const wibJam = (d) => new Date(new Date(d).getTime() + 7 * JAM).getUTCHours();

/** Status sesi WAHA: hanya nama sesi + status (WORKING, FAILED, ...). Gagal terhubung → null. */
export async function ambilStatusWaha({ baseUrl = process.env.WAHA_BASE_URL || "http://localhost:3000", apiKey = process.env.WAHA_API_KEY || "", sesi = ["CS-1", "CS-2"], fetchFn = fetch, timeoutMs = 8000 } = {}) {
  try {
    const r = await fetchFn(`${baseUrl}/api/sessions?all=true`, { headers: apiKey ? { "X-Api-Key": apiKey } : {}, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { terjangkau: false, kode: `HTTP_${r.status}`, sesi: [] };
    const j = await r.json();
    const daftar = (Array.isArray(j) ? j : []).filter((x) => sesi.includes(x?.name)).map((x) => ({ nama: String(x.name), status: String(x.status || "UNKNOWN").toUpperCase() }));
    const ada = new Set(daftar.map((x) => x.nama));
    for (const s of sesi) if (!ada.has(s)) daftar.push({ nama: s, status: "TIDAK_ADA" });
    return { terjangkau: true, kode: null, sesi: daftar.sort((a, b) => (a.nama < b.nama ? -1 : 1)) };
  } catch (e) {
    return { terjangkau: false, kode: e?.name === "TimeoutError" ? "TIMEOUT" : "TIDAK_TERJANGKAU", sesi: [] };
  }
}

/** CTWA_AD bersinyal valid pada berkas capture Fase 0 (hanya hitungan; msgIdHash unik) dalam jendela [dari, sampai). */
export function hitungCaptureValid({ dari, sampai, dir = captureDir() }) {
  const ids = new Set();
  let berkas = [];
  try {
    for (const b of fs.readdirSync(dir)) {
      const p = path.join(dir, b);
      if (/^ctwa-capture-\d{4}-\d{2}-\d{2}\.jsonl$/.test(b)) berkas.push(p);
    }
  } catch { return { tersedia: false, jumlah: 0 }; }
  for (const f of berkas) {
    let teks; try { teks = fs.readFileSync(f, "utf8"); } catch { continue; }
    for (const l of teks.split("\n")) {
      if (!l.trim()) continue;
      let o; try { o = JSON.parse(l); } catch { continue; }
      if (o.verdict !== "CTWA_AD" || !/^\d{5,32}$/.test(String(o.values?.sourceId)) || o.values?.sourceType !== "ad") continue;
      const t = Date.parse(o.observedAt);
      if (!(t >= dari.getTime() && t < sampai.getTime())) continue;
      ids.add(o.msgIdHash);
    }
  }
  return { tersedia: true, jumlah: ids.size };
}

export async function ambilSnapshotMonitor(db, { now = new Date(), waha = null, sejak = null, hitungCapture = hitungCaptureValid, cfg = CFG_BAWAAN, timeoutMs = 10_000 } = {}) {
  const kes = await hitungKesehatanCapture(db, { now, timeoutMs });
  const t15 = new Date(now.getTime() - 15 * MENIT), t60 = new Date(now.getTime() - 60 * MENIT), t30 = new Date(now.getTime() - cfg.inboundSepiMenit * MENIT);
  const hariIniWib = new Date(new Date(now.getTime() + 7 * JAM).toISOString().slice(0, 10) + "T00:00:00Z");
  const awalHariUtc = new Date(hariIniWib.getTime() - 7 * JAM), awal14 = new Date(awalHariUtc.getTime() - 14 * 24 * JAM);
  const jamWib = wibJam(now);
  const d = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${Math.max(1000, Math.floor(timeoutMs))}`);
    const [m] = await tx.$queryRaw`
      SELECT count(*) FILTER (WHERE "createdAt" >= ${t15})::int AS m15, count(*) FILTER (WHERE "createdAt" >= ${t60})::int AS m60,
             count(*) FILTER (WHERE "createdAt" >= ${t30})::int AS m30, max("createdAt") AS terakhir
        FROM "Message" WHERE direction = 'INBOUND' AND "createdAt" >= ${awal14}`;
    const [b] = await tx.$queryRaw`
      SELECT count(*)::int AS n FROM "Message"
       WHERE direction = 'INBOUND' AND "createdAt" >= ${awal14} AND "createdAt" < ${awalHariUtc}
         AND extract(hour FROM ("createdAt" + interval '7 hours'))::int = ${jamWib}`;
    const [t] = await tx.$queryRaw`
      SELECT count(*) FILTER (WHERE t.evidence_source = 'CTWA_AD' AND t.created_at >= ${new Date(now.getTime() - 7 * 24 * JAM)})::int AS ctwa7,
             count(*) FILTER (WHERE t.evidence_source = 'CTWA_AD' AND t.customer_status_at_touch = 'UNKNOWN' AND t.created_at >= ${new Date(now.getTime() - 7 * 24 * JAM)})::int AS unknown7,
             count(*) FILTER (WHERE t.evidence_source = 'CTWA_AD' AND r.ad_id IS NOT NULL AND t.created_at >= ${new Date(now.getTime() - 7 * 24 * JAM)})::int AS mapped7,
             min(t.touch_at) AS pertama
        FROM attribution_touches t LEFT JOIN meta_ad_references r ON r.ad_id = t.ad_id`;
    const [dup] = await tx.$queryRaw`SELECT count(*)::int AS n FROM (SELECT message_id FROM attribution_touches WHERE message_id IS NOT NULL GROUP BY message_id HAVING count(*) > 1) x`;
    const [sp] = await tx.$queryRaw`SELECT max(date_wib)::text AS terakhir_tanggal, (SELECT max(created_at) FROM meta_spend_imports) AS terakhir_import FROM meta_ad_daily_spend`;
    return { m, b, t, dup, sp };
  }, { timeout: timeoutMs + 5_000, maxWait: 5_000 });

  const awalCek = sejak ? new Date(Math.max(new Date(sejak).getTime(), now.getTime() - 24 * JAM)) : (d.t.pertama ? new Date(Math.max(new Date(d.t.pertama).getTime() - MENIT, now.getTime() - 24 * JAM)) : null);
  const akhirCek = new Date(now.getTime() - cfg.tenggangCaptureMenit * MENIT);
  let captureValid = { tersedia: false, jumlah: 0 }, touchDalamJendela = 0;
  if (awalCek && awalCek < akhirCek) {
    captureValid = hitungCapture({ dari: awalCek, sampai: akhirCek });
    const [c] = await db.$queryRaw`SELECT count(*)::int AS n FROM attribution_touches WHERE evidence_source = 'CTWA_AD' AND created_at >= ${awalCek} AND created_at < ${akhirCek}`;
    touchDalamJendela = c.n;
  }
  const basis30 = d.b.n / 14 / 2;
  const sp = d.sp;
  const hariIni = hariIniWib.toISOString().slice(0, 10);
  const tertinggal = sp.terakhir_tanggal ? Math.round((Date.parse(`${hariIni}T00:00:00Z`) - Date.parse(`${sp.terakhir_tanggal}T00:00:00Z`)) / 86_400_000) : null;
  return {
    versi: 1, dihitungPada: now.toISOString(), jamWib,
    waha: waha ?? { terjangkau: null, kode: "TIDAK_DIPERIKSA", sesi: [] },
    inbound: { per15Menit: d.m.m15, perJam: d.m.m60, jendelaSepi: d.m.m30, menitSejakTerakhir: d.m.terakhir ? Math.round((now - new Date(d.m.terakhir)) / MENIT) : null, terakhirAt: d.m.terakhir ? new Date(d.m.terakhir).toISOString() : null, basisPer30Menit: Math.round(basis30 * 10) / 10 },
    touch: {
      captureAktif: kes.captureAktif, direkam: kes.proses.direkam, gagal: kes.proses.gagal, fallback: kes.proses.fallbackTransaksi, dipulihkan: kes.proses.dipulihkan, gagalPulih: kes.proses.gagalPulih,
      tertunda: kes.proses.tertunda, usiaTertundaTertuaDetik: kes.proses.usiaTertundaTertuaDetik, statusProses: { new: kes.proses.statusNew, existing: kes.proses.statusExisting, unknown: kes.proses.statusUnknown },
      total: kes.db.touchTotal, jam24: kes.db.touch24Jam, hari7: kes.db.touch7Hari,
      ctwa7Hari: d.t.ctwa7, unknown7Hari: d.t.unknown7, unknownPersen: d.t.ctwa7 > 0 ? Math.round((d.t.unknown7 / d.t.ctwa7) * 1000) / 10 : null,
      mapped7Hari: d.t.mapped7, coveragePemetaanPersen: d.t.ctwa7 > 0 ? Math.round((d.t.mapped7 / d.t.ctwa7) * 1000) / 10 : null,
      unmapped: kes.db.pendingPemetaan.touch, adIdUnmapped: kes.db.pendingPemetaan.adIdUnik, usiaUnmappedTertuaJam: kes.db.pendingPemetaan.usiaTertuaJam,
      duplikat: d.dup.n, pertamaAt: d.t.pertama ? new Date(d.t.pertama).toISOString() : null,
    },
    capture: { jendelaDari: awalCek ? awalCek.toISOString() : null, jendelaSampai: akhirCek.toISOString(), berkasTersedia: captureValid.tersedia, ctwaValidTercatat: captureValid.jumlah, touchCtwaDalamJendela: touchDalamJendela, ctwaValidTanpaTouch: captureValid.tersedia ? Math.max(0, captureValid.jumlah - touchDalamJendela) : null },
    referensi: { jumlah: kes.db.referensi.jumlah, sinkronTerakhir: kes.db.referensi.sinkronTerakhir, umurJam: kes.db.referensi.sinkronTerakhir ? Math.round(((now - new Date(kes.db.referensi.sinkronTerakhir)) / JAM) * 10) / 10 : null },
    spend: { terakhirTanggal: sp.terakhir_tanggal ?? null, tertinggalHari: tertinggal, terakhirImportAt: sp.terakhir_import ? new Date(sp.terakhir_import).toISOString() : null },
  };
}

const kondisi = (key, level, pesan, nilai) => ({ key, level, pesan, nilai });

export function evaluasiAlarm(s, cfg = CFG_BAWAAN) {
  const out = [];
  // 1. WAHA
  if (s.waha.terjangkau === false) out.push(kondisi("waha_session", "CRIT", `WAHA tidak terjangkau (${s.waha.kode})`, { kode: s.waha.kode }));
  else if (s.waha.terjangkau === true) {
    const buruk = s.waha.sesi.filter((x) => !["WORKING", "CONNECTED"].includes(x.status));
    out.push(buruk.length ? kondisi("waha_session", "CRIT", `Sesi WAHA tidak WORKING: ${buruk.map((x) => `${x.nama}=${x.status}`).join(", ")}`, { sesi: buruk }) : kondisi("waha_session", "OK", "Semua sesi WAHA WORKING", { sesi: s.waha.sesi }));
  }
  // 2. inbound sepi (memakai basis jam yang sama)
  const sepi = s.inbound.jendelaSepi === 0 && s.inbound.basisPer30Menit >= cfg.basisMinimalPer30Menit;
  out.push(sepi ? kondisi("inbound_sepi", "WARN", `Tidak ada inbound ${cfg.inboundSepiMenit} menit padahal basis jam ini ${s.inbound.basisPer30Menit}/30 menit`, { menitSejakTerakhir: s.inbound.menitSejakTerakhir, basis: s.inbound.basisPer30Menit })
    : kondisi("inbound_sepi", "OK", "Arus inbound wajar terhadap basis jam ini", { jendelaSepi: s.inbound.jendelaSepi, basis: s.inbound.basisPer30Menit }));
  const t = s.touch;
  // 3-5 kegagalan capture (penghitung proses; reset saat backend restart)
  out.push(t.gagal > 0 ? kondisi("touch_gagal", "CRIT", `${t.gagal} penulisan touch gagal sejak backend start`, { gagal: t.gagal }) : kondisi("touch_gagal", "OK", "Tidak ada touch gagal", {}));
  out.push(t.gagalPulih > 0 ? kondisi("touch_gagal_pulih", "CRIT", `${t.gagalPulih} touch gagal dipulihkan`, { gagalPulih: t.gagalPulih }) : kondisi("touch_gagal_pulih", "OK", "Tidak ada gagal-pulih", {}));
  const tertundaLama = t.tertunda > 0 && t.usiaTertundaTertuaDetik > cfg.tertundaDetik;
  out.push(tertundaLama ? kondisi("touch_tertunda", "CRIT", `${t.tertunda} touch tertunda, tertua ${t.usiaTertundaTertuaDetik} dtk`, { tertunda: t.tertunda, usiaDetik: t.usiaTertundaTertuaDetik }) : kondisi("touch_tertunda", "OK", "Tidak ada touch tertunda > 10 menit", { tertunda: t.tertunda }));
  // 6 UNMAPPED
  out.push(t.unmapped > 0 ? kondisi("ad_unmapped", "WARN", `${t.unmapped} touch pada ${t.adIdUnmapped} Ad ID belum terpetakan`, { touch: t.unmapped, adId: t.adIdUnmapped, usiaJam: t.usiaUnmappedTertuaJam }) : kondisi("ad_unmapped", "OK", "Semua Ad ID terpetakan", {}));
  // 7 duplikat
  out.push(t.duplikat > 0 ? kondisi("touch_duplikat", "CRIT", `${t.duplikat} pesan memiliki touch ganda`, { pesan: t.duplikat }) : kondisi("touch_duplikat", "OK", "Tidak ada touch ganda", {}));
  // 8 CTWA valid tanpa touch
  const hilang = s.capture.ctwaValidTanpaTouch;
  out.push(hilang === null ? kondisi("ctwa_tanpa_touch", "OK", "Pembanding capture Fase 0 tidak tersedia", {}) : hilang > 0 ? kondisi("ctwa_tanpa_touch", "CRIT", `${hilang} CTWA_AD bersourceID valid tidak punya touch`, { capture: s.capture.ctwaValidTercatat, touch: s.capture.touchCtwaDalamJendela }) : kondisi("ctwa_tanpa_touch", "OK", "Semua CTWA_AD valid memiliki touch", { capture: s.capture.ctwaValidTercatat, touch: s.capture.touchCtwaDalamJendela }));
  // 9 UNKNOWN
  const cukup = t.ctwa7Hari >= cfg.sampelMinimal;
  out.push(cukup && t.unknownPersen > cfg.unknownPersenMaks ? kondisi("unknown_tinggi", "WARN", `UNKNOWN ${t.unknownPersen}% dari ${t.ctwa7Hari} touch`, { persen: t.unknownPersen, sampel: t.ctwa7Hari }) : kondisi("unknown_tinggi", "OK", cukup ? `UNKNOWN ${t.unknownPersen}%` : `Sampel ${t.ctwa7Hari} < ${cfg.sampelMinimal}: belum dinilai`, { persen: t.unknownPersen, sampel: t.ctwa7Hari }));
  // 10 coverage pemetaan
  out.push(cukup && t.coveragePemetaanPersen < cfg.mappingPersenMin ? kondisi("coverage_pemetaan", "WARN", `Coverage pemetaan ${t.coveragePemetaanPersen}% < ${cfg.mappingPersenMin}%`, { persen: t.coveragePemetaanPersen, sampel: t.ctwa7Hari }) : kondisi("coverage_pemetaan", "OK", cukup ? `Coverage pemetaan ${t.coveragePemetaanPersen}%` : `Sampel ${t.ctwa7Hari} < ${cfg.sampelMinimal}: belum dinilai`, { persen: t.coveragePemetaanPersen, sampel: t.ctwa7Hari }));
  // tambahan: kesegaran spend (hanya bila sumber spend pernah masuk)
  if (s.spend.terakhirTanggal) out.push(s.spend.tertinggalHari > cfg.spendTertinggalHariMaks ? kondisi("spend_terlambat", "WARN", `Spend terakhir ${s.spend.terakhirTanggal} (tertinggal ${s.spend.tertinggalHari} hari)`, { terakhir: s.spend.terakhirTanggal }) : kondisi("spend_terlambat", "OK", `Spend terakhir ${s.spend.terakhirTanggal}`, {}));
  return out;
}

export function levelGabungan(daftar) {
  return daftar.some((x) => x.level === "CRIT") ? 2 : daftar.some((x) => x.level === "WARN") ? 1 : 0;
}

/**
 * Cooldown + pulih. `state`: Map key → { status, since, lastNotifiedAt }. Hasil: { notifikasi:[{jenis:ALERT|ULANG|PULIH,key,level,pesan}], stateBaru:Map }.
 * ALERT = baru bermasalah atau level naik; ULANG = masih bermasalah dan cooldown lewat; PULIH = kembali OK. Kondisi sehat yang tidak pernah bermasalah tidak menghasilkan apa pun.
 */
export function rencanaNotifikasi(daftar, state = new Map(), now = new Date(), cfg = CFG_BAWAAN) {
  const notifikasi = [], stateBaru = new Map();
  const cd = cfg.cooldownMenit * MENIT;
  for (const k of daftar) {
    const lama = state.get(k.key) || null;
    const statusLama = lama?.status ?? "OK";
    if (k.level === "OK") {
      if (statusLama !== "OK") notifikasi.push({ jenis: "PULIH", key: k.key, level: "OK", pesan: k.pesan, sejak: lama.since });
      stateBaru.set(k.key, { status: "OK", since: statusLama === "OK" && lama ? lama.since : now, lastNotifiedAt: statusLama !== "OK" ? now : (lama?.lastNotifiedAt ?? null), detail: k.pesan });
      continue;
    }
    const naik = statusLama === "OK" || (statusLama === "WARN" && k.level === "CRIT");
    const lewat = !lama?.lastNotifiedAt || now - new Date(lama.lastNotifiedAt) >= cd;
    const jenis = naik ? "ALERT" : lewat ? "ULANG" : null;
    if (jenis) notifikasi.push({ jenis, key: k.key, level: k.level, pesan: k.pesan, sejak: naik ? now : lama.since });
    stateBaru.set(k.key, { status: k.level, since: statusLama === "OK" || naik ? now : lama.since, lastNotifiedAt: jenis ? now : (lama?.lastNotifiedAt ?? null), detail: k.pesan });
  }
  return { notifikasi, stateBaru };
}
