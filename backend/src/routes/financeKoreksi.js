// PIN step-up Finance + riwayat versi dokumen (Edit & Koreksi Transaksi Aman).
//   GET  /pin/status              status PIN pengguna (sudah diatur? terkunci?)
//   POST /pin                     atur/ganti PIN — wajib password login
//   POST /pin/verifikasi          verifikasi PIN -> token step-up 5 menit (dikirim di header X-Finance-Stepup)
//   GET  /riwayat-versi/:jenis/:id  siapa/kapan/alasan/perubahan + rantai jurnal (asli -> dibalik -> pengganti)

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, requireAnyPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { handleFinanceError } from "./finance.js";
import { statusPin, aturPin, verifikasiPin, riwayatVersi, pastikanStepUp, KoreksiError } from "../services/finance/koreksiGate.js";
import { wajibIdempotencyKey, idempotency } from "../middleware/idempotency.js";
import { daftarPengakuan, detailPengakuan, pengakuanTerkendali, balikPengakuan, tetapkanHarga, jalankanPratinjau, OPSI_TX } from "../services/finance/koreksiDokumen/pengakuan.js";
import { daftarAtribusi, pratinjauKeputusan, putuskanAtribusi, cabutKeputusan, riwayatKeputusan } from "../services/finance/koreksiDokumen/atribusiDivisi.js";
import { syncCustomerOrderAggregate } from "../services/customerOrderAggregate.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

export const financeKoreksiRouter = express.Router();
// requireAuth dipasang PER RUTE (bukan router.use): router ini di-mount di /api/finance bersama router lain, dan
// router.use akan menjalankan requireAuth lagi untuk SETIAP request /api/finance/* yang lewat — limiter token mobile
// (120/menit) jadi menghitung dobel dan menolak permintaan sah (terbukti di tes Buku Besar).

financeKoreksiRouter.get("/pin/status", requireAuth, requireAnyPermission(P.FINANCE_ADMIN, P.PAYMENT_KOREKSI), async (req, res) => {
  try { res.json(await statusPin(prisma, req.user.id)); } catch (e) { handleFinanceError(e, res); }
});

financeKoreksiRouter.post("/pin", requireAuth, requireAnyPermission(P.FINANCE_ADMIN, P.PAYMENT_KOREKSI), async (req, res) => {
  try {
    await aturPin(prisma, { userId: req.user.id, password: req.body?.password, pin: req.body?.pin });
    await recordActivity(prisma, {
      entityType: ENTITY_TYPES.FIN_JOURNAL, entityId: req.user.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id,
      metadata: { aksi: "PIN Finance diatur/diganti" },
    });
    res.json({ ok: true, ...(await statusPin(prisma, req.user.id)) });
  } catch (e) { handleFinanceError(e, res); }
});

financeKoreksiRouter.post("/pin/verifikasi", requireAuth, requireAnyPermission(P.FINANCE_ADMIN, P.PAYMENT_KOREKSI), async (req, res) => {
  try { res.json(await verifikasiPin(prisma, { userId: req.user.id, pin: req.body?.pin })); } catch (e) { handleFinanceError(e, res); }
});

financeKoreksiRouter.get("/riwayat-versi/:jenis/:id", requireAuth, requirePermission(P.FINANCE_READ), async (req, res) => {
  try { res.json(await riwayatVersi(prisma, req.params.jenis, req.params.id)); } catch (e) { handleFinanceError(e, res); }
});

// ── KOREKSI PER DOKUMEN (Okt 2026): pengakuan pendapatan terkendali, harga order Rp0, keputusan atribusi divisi ──────────────────────────────────────────
// Baca = finance:read. Tulis = finance:admin (ADMIN/OWNER) + PIN step-up + Idempotency-Key + alasan; SATU dokumen per permintaan (tidak ada endpoint massal). Pratinjau memakai kode yang SAMA lalu di-rollback.
const UUID_DOK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idUuid = (req, res, next) => (UUID_DOK.test(req.params.id || "") ? next() : res.status(400).json({ error: "ID dokumen tidak valid", code: "ID_TIDAK_VALID" }));
const idOrder = (req, res, next) => (/^[A-Za-z0-9_-]{8,40}$/.test(req.params.orderId || "") ? next() : res.status(400).json({ error: "ID order tidak valid", code: "ID_TIDAK_VALID" }));
const kunciKecualiPratinjau = (req, res, next) => (req.body?.preview === true ? next() : wajibIdempotencyKey(req, res, next));
const stepUp = (req) => () => pastikanStepUp(prisma, req);
const status201 = (h) => (h?.dibuat ? 201 : 200);

financeKoreksiRouter.get("/koreksi/pengakuan", requireAuth, requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const kelas = typeof req.query.kelas === "string" && req.query.kelas ? String(req.query.kelas).toUpperCase() : null;
    if (kelas && !["PERLU_KEPUTUSAN", "NILAI_NOL", "RIWAYAT_PRA_BUKU", "LAIN"].includes(kelas)) return res.status(400).json({ error: "Kelas tidak dikenal", code: "KELAS_TIDAK_DIKENAL" });
    res.json(await prisma.$transaction((tx) => daftarPengakuan(tx, { kelas }), { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 60_000 }));
  } catch (e) { handleFinanceError(e, res); }
});
financeKoreksiRouter.get("/koreksi/pengakuan/:orderId", requireAuth, requirePermission(P.FINANCE_READ), idOrder, async (req, res) => {
  try { res.json(await detailPengakuan(prisma, req.params.orderId)); } catch (e) { handleFinanceError(e, res); }
});
financeKoreksiRouter.post("/koreksi/pengakuan/:orderId/harga", requireAuth, requirePermission(P.FINANCE_ADMIN), idOrder, kunciKecualiPratinjau, idempotency, async (req, res) => {
  const preview = req.body?.preview === true;
  const jalan = (tx) => tetapkanHarga(tx, { orderId: req.params.orderId, harga: req.body?.harga, buktiHarga: req.body?.buktiHarga, alasan: req.body?.alasan, userId: req.user.id, preview, stepUp: preview ? null : stepUp(req) });
  try {
    if (preview) return res.json({ pratinjau: await jalankanPratinjau(prisma, jalan) });
    const hasil = await prisma.$transaction(jalan, OPSI_TX);
    if (hasil.customerId) await syncCustomerOrderAggregate(hasil.customerId);
    res.status(status201(hasil)).json(hasil);
  } catch (e) { handleFinanceError(e, res); }
});
financeKoreksiRouter.post("/koreksi/pengakuan/:orderId/akui", requireAuth, requirePermission(P.FINANCE_ADMIN), idOrder, kunciKecualiPratinjau, idempotency, async (req, res) => {
  const preview = req.body?.preview === true;
  const jalan = (tx) => pengakuanTerkendali(tx, { orderId: req.params.orderId, input: req.body, userId: req.user.id, preview, stepUp: preview ? null : stepUp(req) });
  try {
    if (preview) return res.json({ pratinjau: await jalankanPratinjau(prisma, jalan) });
    const hasil = await prisma.$transaction(jalan, OPSI_TX);
    res.status(status201(hasil)).json(hasil);
  } catch (e) { handleFinanceError(e, res); }
});
financeKoreksiRouter.post("/koreksi/pengakuan/:orderId/balik", requireAuth, requirePermission(P.FINANCE_ADMIN), idOrder, kunciKecualiPratinjau, idempotency, async (req, res) => {
  const preview = req.body?.preview === true;
  const jalan = (tx) => balikPengakuan(tx, { orderId: req.params.orderId, alasan: req.body?.alasan, userId: req.user.id, preview, stepUp: preview ? null : stepUp(req) });
  try {
    if (preview) return res.json({ pratinjau: await jalankanPratinjau(prisma, jalan) });
    const hasil = await prisma.$transaction(jalan, OPSI_TX);
    res.status(status201(hasil)).json(hasil);
  } catch (e) { handleFinanceError(e, res); }
});

financeKoreksiRouter.get("/koreksi/atribusi", requireAuth, requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const hasil = await prisma.$transaction((tx) => daftarAtribusi(tx, { fromStr: String(req.query.from || ""), toStr: String(req.query.to || "") }), { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 90_000 });
    res.json(hasil);
  } catch (e) { handleFinanceError(e, res); }
});
financeKoreksiRouter.get("/koreksi/atribusi/:modul/:id", requireAuth, requirePermission(P.FINANCE_READ), idUuid, async (req, res) => {
  try {
    const scope = typeof req.query.scope === "string" && req.query.scope ? req.query.scope : null;
    res.json({ pratinjau: await pratinjauKeputusan(prisma, { modul: req.params.modul, documentId: req.params.id, scope }), riwayat: await riwayatKeputusan(prisma, req.params.modul, req.params.id) });
  } catch (e) { handleFinanceError(e, res); }
});
financeKoreksiRouter.post("/koreksi/atribusi/:modul/:id", requireAuth, requirePermission(P.FINANCE_ADMIN), idUuid, wajibIdempotencyKey, idempotency, async (req, res) => {
  try {
    await pastikanStepUp(prisma, req);
    const hasil = await prisma.$transaction((tx) => putuskanAtribusi(tx, { modul: req.params.modul, documentId: req.params.id, scope: String(req.body?.scope || ""), alasan: req.body?.alasan, userId: req.user.id }), OPSI_TX);
    res.status(status201(hasil)).json(hasil);
  } catch (e) { handleFinanceError(e, res); }
});
financeKoreksiRouter.post("/koreksi/atribusi/:modul/:id/cabut", requireAuth, requirePermission(P.FINANCE_ADMIN), idUuid, wajibIdempotencyKey, idempotency, async (req, res) => {
  try {
    await pastikanStepUp(prisma, req);
    const hasil = await prisma.$transaction((tx) => cabutKeputusan(tx, { modul: req.params.modul, documentId: req.params.id, alasan: req.body?.alasan, userId: req.user.id }), OPSI_TX);
    res.status(status201(hasil)).json(hasil);
  } catch (e) { handleFinanceError(e, res); }
});
void KoreksiError;
