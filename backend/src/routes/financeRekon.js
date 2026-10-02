// FINANCE — REKONSILIASI BANK V2: mutasi rekening koran, pencocokan, panel rekonsiliasi, hitung fisik kas, exception jurnal tanpa rekening. Di-mount di /api/finance.
// Logika: services/finance/bankRekon/*. Sakelar rollout `bank_reconciliation_v2_active` (default MATI) menjaga SEMUA endpoint tulis di server; endpoint baca bekerja walau sakelar mati.
//
//   GET  /rekon-bank/kartu?to=                           kartu per rekening (saldo buku, saldo bank/kas, selisih, belum cocok, terakhir direkonsiliasi)  — FINANCE_READ
//   GET  /rekon-bank/exception-jurnal-tanpa-rekening     laporan exception jurnal lama tanpa rekening (mis. Fee Farhan)                               — FINANCE_READ
//   GET  /rekon-bank/:id/panel?to&saldoBankAkhir         panel rekonsiliasi (selisih + penjelasan + exception + periode)                              — FINANCE_READ
//   GET  /rekon-bank/:id/mutasi-bank?from&to&q&status    mutasi rekening koran + status pencocokan                                                    — FINANCE_READ
//   GET  /rekon-bank/:id/pencocokan?to&from              yang belum dicocokkan + saran + kelompok aktif                                               — FINANCE_READ
//   GET  /rekon-bank/:id/batch                           riwayat impor                                                                                — FINANCE_READ
//   POST /rekon-bank/:id/impor/pratinjau | /impor        multipart (file, pemetaan?)                                                                  — FINANCE_POST
//   POST /rekon-bank/batch/:batchId/batalkan             { alasan, lepasPencocokan? }                                                                 — FINANCE_APPROVE
//   POST /rekon-bank/:id/cocokkan-otomatis | /cocokkan   pencocokan                                                                                  — FINANCE_POST
//   POST /rekon-bank/:id/kecualikan                      pengecualian (alasan wajib)                                                                  — FINANCE_APPROVE
//   POST /rekon-bank/pencocokan/:groupId/lepas           batalkan pencocokan/pengecualian                                                             — FINANCE_POST
//   POST /rekon-bank/:id/opname                          hitung fisik Uang Kas                                                                        — FINANCE_POST
//   POST /rekon-bank/:id/periode/selesai | /periode/:periodeId/batalkan                                                                              — FINANCE_APPROVE
//   POST /rekon-bank/exception/:lineId/tinjau            tandai exception jurnal tanpa rekening ditinjau                                              — FINANCE_APPROVE
// Tidak ada endpoint yang membuat jurnal dari mutasi bank.
import express from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { handleFinanceError } from "./finance.js";
import { todayBookDateWIB } from "../services/finance/journal.js";
import { pratinjauImpor, jalankanImpor, batalkanBatch, daftarBatch } from "../services/finance/bankRekon/impor.js";
import { mutasiBank, daftarPencocokan, cocokkanManual, cocokkanOtomatis, kecualikan, lepasPencocokan } from "../services/finance/bankRekon/pencocokan.js";
import { hitungPanel, kartuRekening, laporanJurnalTanpaRekening, tinjauJurnalTanpaRekening, catatOpnameKas, selesaikanPeriode, batalkanPeriode } from "../services/finance/bankRekon/panel.js";
import { wajibRekonV2Aktif, tgl } from "../services/finance/bankRekon/shared.js";

export const financeRekonRouter = express.Router();
const BASE = "/rekon-bank";
// Middleware hanya untuk jalur ini (use() tanpa jalur menghitung ganda di pembatas laju mobile — lihat financePenjualanKaryawan.js).
financeRekonRouter.use(BASE, requireAuth, idempotency);

const unggah = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const unggahBerkas = (req, res, next) => unggah.single("file")(req, res, (err) => {
  if (!err) return next();
  const pesan = err.code === "LIMIT_FILE_SIZE" ? "Berkas terlalu besar (maks 5 MB)" : "Berkas tidak bisa diunggah";
  res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: pesan });
});

const hariIni = () => tgl(todayBookDateWIB());
const jalur = (fn, status = 200) => async (req, res) => {
  try { res.status(status).json(await fn(req)); } catch (e) { handleFinanceError(e, res); }
};
const pemetaanDari = (v) => {
  if (!v) return null;
  try { const o = typeof v === "string" ? JSON.parse(v) : v; return o && typeof o === "object" ? o : null; } catch { return { kolom: "tidak valid" }; }
};

// ── Baca ────────────────────────────────────────────────────────────────────────────────────────────────────────
financeRekonRouter.get(`${BASE}/kartu`, requirePermission(P.FINANCE_READ), jalur((req) => kartuRekening(prisma, { to: /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || "") ? req.query.to : hariIni() })));
financeRekonRouter.get(`${BASE}/exception-jurnal-tanpa-rekening`, requirePermission(P.FINANCE_READ), jalur((req) => laporanJurnalTanpaRekening(prisma, { sampai: /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || "") ? req.query.to : null })));
financeRekonRouter.get(`${BASE}/:id/panel`, requirePermission(P.FINANCE_READ), jalur((req) => hitungPanel(prisma, { cashAccountId: req.params.id, to: req.query.to || hariIni(), saldoBankAkhir: req.query.saldoBankAkhir ?? null, saldoBankAwal: req.query.saldoBankAwal ?? null })));
financeRekonRouter.get(`${BASE}/:id/mutasi-bank`, requirePermission(P.FINANCE_READ), jalur((req) => mutasiBank(prisma, { cashAccountId: req.params.id, from: req.query.from, to: req.query.to, q: req.query.q, status: req.query.status || null, page: req.query.page, limit: req.query.limit, arah: req.query.arah, urut: req.query.urut, arahUrut: req.query.arahUrut, nominalMin: req.query.nominalMin, nominalMaks: req.query.nominalMaks })));
financeRekonRouter.get(`${BASE}/:id/pencocokan`, requirePermission(P.FINANCE_READ), jalur((req) => daftarPencocokan(prisma, { cashAccountId: req.params.id, to: req.query.to || hariIni(), from: req.query.from || null })));
financeRekonRouter.get(`${BASE}/:id/batch`, requirePermission(P.FINANCE_READ), jalur((req) => daftarBatch(prisma, { cashAccountId: req.params.id })));

// ── Impor ───────────────────────────────────────────────────────────────────────────────────────────────────────
financeRekonRouter.post(`${BASE}/:id/impor/pratinjau`, requirePermission(P.FINANCE_POST), unggahBerkas, jalur(async (req) => {
  await wajibRekonV2Aktif(prisma);
  if (!req.file) { const e = new Error("Pilih berkas rekening koran (.xlsx atau .csv)"); e.statusCode = 400; throw e; }
  return pratinjauImpor(prisma, { cashAccountId: req.params.id, buffer: req.file.buffer, namaBerkas: req.file.originalname, pemetaan: pemetaanDari(req.body?.pemetaan) });
}));
financeRekonRouter.post(`${BASE}/:id/impor`, requirePermission(P.FINANCE_POST), unggahBerkas, jalur(async (req) => {
  if (!req.file) { const e = new Error("Pilih berkas rekening koran (.xlsx atau .csv)"); e.statusCode = 400; throw e; }
  return jalankanImpor(prisma, { cashAccountId: req.params.id, buffer: req.file.buffer, namaBerkas: req.file.originalname, pemetaan: pemetaanDari(req.body?.pemetaan), userId: req.user.id });
}, 201));
financeRekonRouter.post(`${BASE}/batch/:batchId/batalkan`, requirePermission(P.FINANCE_APPROVE), jalur((req) => batalkanBatch(prisma, { batchId: req.params.batchId, alasan: req.body?.alasan, lepasPencocokan: req.body?.lepasPencocokan === true, userId: req.user.id })));

// ── Pencocokan ──────────────────────────────────────────────────────────────────────────────────────────────────
financeRekonRouter.post(`${BASE}/:id/cocokkan-otomatis`, requirePermission(P.FINANCE_POST), jalur((req) => cocokkanOtomatis(prisma, { cashAccountId: req.params.id, to: req.body?.to || hariIni(), userId: req.user.id })));
financeRekonRouter.post(`${BASE}/:id/cocokkan`, requirePermission(P.FINANCE_POST), jalur((req) => cocokkanManual(prisma, { cashAccountId: req.params.id, bankLineIds: req.body?.bankLineIds, journalLineIds: req.body?.journalLineIds, alasan: req.body?.alasan, kategori: req.body?.kategori || null, userId: req.user.id }), 201));
financeRekonRouter.post(`${BASE}/:id/kecualikan`, requirePermission(P.FINANCE_APPROVE), jalur((req) => kecualikan(prisma, { cashAccountId: req.params.id, bankLineIds: req.body?.bankLineIds ?? [], journalLineIds: req.body?.journalLineIds ?? [], alasan: req.body?.alasan, userId: req.user.id }), 201));
financeRekonRouter.post(`${BASE}/pencocokan/:groupId/lepas`, requirePermission(P.FINANCE_POST), jalur((req) => lepasPencocokan(prisma, { groupId: req.params.groupId, alasan: req.body?.alasan, userId: req.user.id })));

// ── Kas fisik, exception, periode ───────────────────────────────────────────────────────────────────────────────
financeRekonRouter.post(`${BASE}/:id/opname`, requirePermission(P.FINANCE_POST), jalur((req) => catatOpnameKas(prisma, { cashAccountId: req.params.id, tanggal: req.body?.tanggal, jumlah: req.body?.jumlah, catatan: req.body?.catatan ?? null, userId: req.user.id }), 201));
financeRekonRouter.post(`${BASE}/exception/:lineId/tinjau`, requirePermission(P.FINANCE_APPROVE), jalur((req) => tinjauJurnalTanpaRekening(prisma, { lineId: req.params.lineId, catatan: req.body?.catatan, userId: req.user.id })));
financeRekonRouter.post(`${BASE}/:id/periode/selesai`, requirePermission(P.FINANCE_APPROVE), jalur((req) => selesaikanPeriode(prisma, { cashAccountId: req.params.id, to: req.body?.to, saldoBankAkhir: req.body?.saldoBankAkhir ?? null, saldoBankAwal: req.body?.saldoBankAwal ?? null, userId: req.user.id }), 201));
financeRekonRouter.post(`${BASE}/periode/:periodeId/batalkan`, requirePermission(P.FINANCE_APPROVE), jalur((req) => batalkanPeriode(prisma, { periodeId: req.params.periodeId, alasan: req.body?.alasan, userId: req.user.id })));
