// /api/atribusi/iklan — Fase 3: spend harian per Ad ID, target KPI, monitoring. HANYA ADMIN (router induk sudah memasang requireAuth + requireAdmin).
//
//   GET  /spend     ?dari&sampai (maks 93 hari; bawaan 7 hari WIB): ringkasan spend harian + riwayat impor (baca-saja)
//   POST /spend     impor spend per Ad ID (csv | rows). dryRun DEFAULT true; commit wajib zonaWaktuAkun WIB; totalSumber (opsional) wajib cocok bila diberikan
//   GET  /target    target KPI ADMIN (semua null sampai Owner mengisi)
//   PUT  /target    ubah target. HANYA label evaluasi: sistem TIDAK mengubah iklan, campaign, atau budget Meta.
//   GET  /monitor   snapshot monitoring + alarm (agregat; tanpa nomor/nama/chat/JID/clid/payload)
import { prisma } from "../db.js";
import { barisSpendDariCsv, jalankanImporSpend, ringkasanSpendHarian, sidikJari, MAKS_BARIS_SPEND, MAKS_HARI_IMPOR } from "../services/attribution/spend.js";
import { ambilSnapshotMonitor, ambilStatusWaha, evaluasiAlarm, levelGabungan, CFG_BAWAAN } from "../services/attribution/monitor.js";
import { normalisasiTarget } from "../services/attribution/biayaKpi.js";

const TGL = /^\d{4}-\d{2}-\d{2}$/;
const HARI = 86_400_000;

export function rentangSpend(q, sekarang = new Date()) {
  const fmt = (d) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
  const sampai = q.sampai ? String(q.sampai) : fmt(sekarang);
  const dari = q.dari ? String(q.dari) : fmt(new Date(Date.parse(`${sampai}T00:00:00Z`) - 6 * HARI));
  if (!TGL.test(dari) || !TGL.test(sampai) || dari > sampai) return null;
  if ((Date.parse(`${sampai}T00:00:00Z`) - Date.parse(`${dari}T00:00:00Z`)) / HARI + 1 > MAKS_HARI_IMPOR) return null;
  return { dari, sampai };
}

const KUNCI_TARGET = {
  maxCpl: "decimal", maxCostPerQualifiedLead: "decimal", maxCostPerCustomerOrder: "decimal", maxCpaClosing: "decimal",
  minBookedRoas: "decimal", minCashRoas: "decimal", minAcquisitionLeads: "int", minClosings: "int", minCohortAgeDays: "int", maxSpamSharePercent: "pct",
};

/** Validasi body PUT /target → { data } | { galat }. Murni (diuji). */
export function validasiTarget(b) {
  const data = {};
  for (const k of Object.keys(b || {})) if (!(k in KUNCI_TARGET)) return { galat: `kunci tidak dikenal: ${String(k).slice(0, 40)}` };
  for (const [k, jenis] of Object.entries(KUNCI_TARGET)) {
    if (!(k in (b || {}))) continue;
    const v = b[k];
    if (v === null || v === "") { data[k] = null; continue; }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return { galat: `${k} harus angka >= 0 atau null` };
    if (jenis === "int" && !Number.isInteger(n)) return { galat: `${k} harus bilangan bulat` };
    if (jenis === "pct" && n > 100) return { galat: `${k} maksimum 100` };
    if (n > 1e12) return { galat: `${k} terlalu besar` };
    data[k] = Math.round(n * 100) / 100;
  }
  if (Object.keys(data).length === 0) return { galat: "tidak ada target yang diubah" };
  return { data };
}

export function pasangRuteSpend(router) {
  router.get("/spend", async (req, res) => {
    const r = rentangSpend(req.query);
    if (!r) return res.status(400).json({ error: `dari/sampai harus YYYY-MM-DD (WIB), dari <= sampai, maks ${MAKS_HARI_IMPOR} hari` });
    try {
      res.set("Cache-Control", "no-store");
      return res.json(await ringkasanSpendHarian(prisma, r));
    } catch (err) {
      console.error("atribusi/iklan/spend error:", err?.code || err?.name || "ERROR");
      return res.status(500).json({ error: "Gagal memuat ringkasan spend" });
    }
  });

  router.post("/spend", async (req, res) => {
    try {
      const b = req.body || {};
      let rows = b.rows, sidik = null, mataUangKolom = null;
      if (typeof b.csv === "string") {
        if (b.csv.length > 6_000_000) return res.status(413).json({ error: "berkas terlalu besar" });
        const p = barisSpendDariCsv(b.csv);
        if (p.galat) return res.status(400).json({ error: `CSV tidak dapat dibaca: ${p.galat}`, code: p.galat });
        rows = p.baris; sidik = sidikJari(b.csv); mataUangKolom = p.mataUangKolom;
      }
      if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: "kirim `csv` (teks) atau `rows` (array)" });
      if (rows.length > MAKS_BARIS_SPEND) return res.status(413).json({ error: `maksimum ${MAKS_BARIS_SPEND} baris` });
      const hasil = await jalankanImporSpend(prisma, {
        rows, source: b.sumber || "ADS_MANAGER_CSV", accountId: b.accountId, zonaWaktuAkun: b.zonaWaktuAkun || null, dryRun: b.dryRun !== false,
        declaredTotal: b.totalSumber ?? null, namaBerkas: b.namaBerkas, sidik, mataUangKolom, userId: req.user?.id || null,
      });
      const { rencana, ...inti } = hasil;
      return res.json({
        ...inti,
        ditolak: rencana.ditolak.slice(0, 200), konflik: rencana.konflik.slice(0, 200), adIdTidakTerpetakan: [...rencana.tidakTerpetakan].slice(0, 100),
        catatan: hasil.dryRun ? "DRY-RUN: tidak ada yang ditulis. Kirim dryRun:false (dan zonaWaktuAkun) untuk commit." : "Tersimpan. Impor ulang hari yang sama memperbarui snapshot dan menyimpan nilai lama di jejak revisi.",
      });
    } catch (err) {
      if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message, code: err.code, ...(err.detail ? { ringkasan: err.detail.ringkasan, rekonsiliasi: err.detail.rekonsiliasi } : {}) });
      console.error("atribusi/iklan/spend POST error:", err?.code || err?.name || "ERROR");
      return res.status(500).json({ error: "Gagal memproses impor spend" });
    }
  });

  router.get("/target", async (_req, res) => {
    try {
      const t = await prisma.attributionKpiTarget.findUnique({ where: { id: 1 } });
      res.set("Cache-Control", "no-store");
      return res.json({ target: normalisasiTarget(t), diatur: !!t, diperbaruiAt: t?.updatedAt ?? null, catatan: "Semua target null sampai Owner mengisinya. Hanya dipakai untuk label evaluasi; sistem tidak mengubah iklan atau budget." });
    } catch (err) {
      console.error("atribusi/iklan/target error:", err?.code || err?.name || "ERROR");
      return res.status(500).json({ error: "Gagal memuat target" });
    }
  });

  router.put("/target", async (req, res) => {
    const v = validasiTarget(req.body);
    if (v.galat) return res.status(400).json({ error: v.galat });
    try {
      const uid = req.user?.id || null;
      const t = await prisma.attributionKpiTarget.upsert({ where: { id: 1 }, create: { id: 1, ...v.data, updatedById: uid }, update: { ...v.data, updatedById: uid, updatedAt: new Date() } });
      return res.json({ target: normalisasiTarget(t), diperbaruiAt: t.updatedAt });
    } catch (err) {
      console.error("atribusi/iklan/target PUT error:", err?.code || err?.name || "ERROR");
      return res.status(500).json({ error: "Gagal menyimpan target" });
    }
  });

  router.get("/monitor", async (req, res) => {
    try {
      const waha = await ambilStatusWaha();
      const sejak = req.query.sejak && !Number.isNaN(Date.parse(String(req.query.sejak))) ? new Date(String(req.query.sejak)) : null;
      const snapshot = await ambilSnapshotMonitor(prisma, { waha, sejak });
      const alarm = evaluasiAlarm(snapshot, CFG_BAWAAN);
      const level = levelGabungan(alarm);
      const state = await prisma.attributionAlertState.findMany({ select: { key: true, status: true, since: true, lastNotifiedAt: true } });
      res.set("Cache-Control", "no-store");
      return res.json({ status: level === 0 ? "SEHAT" : level === 1 ? "PERINGATAN" : "KRITIS", kodeKeluar: level, snapshot, alarm, state, ambang: CFG_BAWAAN });
    } catch (err) {
      console.error("atribusi/iklan/monitor error:", err?.code || err?.name || "ERROR");
      return res.status(500).json({ error: "Gagal memuat monitoring" });
    }
  });
}
