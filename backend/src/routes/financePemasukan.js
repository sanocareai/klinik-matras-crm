// PEMASUKAN TERPADU (read-model agregator) + DATA SEBELUM SISTEM (register historis non-posting).
//
//   GET  /api/finance/pemasukan/ringkasan?from&to                 ringkasan: pendapatan sistem, historis, gabungan, pembayaran masuk, piutang, pemasukan lain, dana masuk
//   GET  /api/finance/pemasukan?from&to&kategori&status&rekening&pihak&q&sumber&page&limit   daftar terklasifikasi (server)
//   GET  /api/finance/pemasukan/opsi                              kategori, status, rekening, cutoff, aksi pencatatan (hanya ke Pemasukan Lain)
//   GET  /api/finance/pemasukan/:jenis/:id                        detail (jenis = jurnal | pembayaran | historis) + klasifikasi
//   Data Sebelum Sistem (semua NON-POSTING; tidak menyentuh buku besar):
//   GET  /pemasukan/legacy/cutoff                                 cutoff yang diturunkan dari data produksi
//   GET  /pemasukan/legacy/batch · POST /pemasukan/legacy/batch (multipart "file": CSV/XLSX → pratinjau) · GET /pemasukan/legacy/batch/:id
//   POST /pemasukan/legacy/batch/:id/impor · POST /pemasukan/legacy/batch/:id/batal · POST /pemasukan/legacy/baris/:id/keputusan
//   GET  /pemasukan/legacy/rekonsiliasi · GET /pemasukan/legacy/proposal   (proposal jurnal migrasi: JSON saja, TIDAK diposting)
// Baca: FINANCE_READ. Tulis (unggah/impor/batal/keputusan): FINANCE_POST. Tidak ada endpoint yang membuat jurnal.

import express from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, hasPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { daftarPemasukan, detailPemasukan, opsiPemasukan, ringkasanPemasukan } from "../services/finance/pemasukan.js";
import { batalkanBatch, buatPratinjau, daftarBatch, detailBatch, hitungCutoff, komitBatch, proposalJurnal, putuskanBaris, rekonsiliasiLegacy } from "../services/finance/legacyPendapatan.js";
import { handleFinanceError } from "./finance.js";

export const financePemasukanRouter = express.Router();
financePemasukanRouter.use("/pemasukan", requireAuth, requirePermission(P.FINANCE_READ));

const unggah = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
const jalur = (fn) => async (req, res) => {
  try {
    const hasil = await fn(req);
    if (hasil === null) return res.status(404).json({ error: "Data tidak ditemukan" });
    res.json(hasil);
  } catch (e) {
    handleFinanceError(e, res);
  }
};
const tulis = requirePermission(P.FINANCE_POST);

financePemasukanRouter.get("/pemasukan/ringkasan", jalur((req) => ringkasanPemasukan(prisma, req.query)));
financePemasukanRouter.get("/pemasukan/opsi", jalur((req) => opsiPemasukan(prisma, req.user, hasPermission, P)));

// ── Data Sebelum Sistem (didaftarkan SEBELUM /:jenis/:id agar "legacy" tidak dianggap jenis) ─────────────────────
financePemasukanRouter.get("/pemasukan/legacy/cutoff", jalur(() => hitungCutoff(prisma)));
financePemasukanRouter.get("/pemasukan/legacy/batch", jalur(() => daftarBatch(prisma)));
financePemasukanRouter.get("/pemasukan/legacy/batch/:id", jalur((req) => detailBatch(prisma, req.params.id, req.query)));
financePemasukanRouter.get("/pemasukan/legacy/rekonsiliasi", jalur(() => rekonsiliasiLegacy(prisma)));
financePemasukanRouter.get("/pemasukan/legacy/proposal", jalur(() => proposalJurnal(prisma)));

financePemasukanRouter.post("/pemasukan/legacy/batch", tulis, (req, res, next) => {
  unggah.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Berkas terlalu besar (maksimal 8 MB)" : "Berkas tidak bisa dibaca" });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Berkas CSV atau XLSX wajib diunggah (field \"file\")" });
    const hasil = await buatPratinjau(prisma, { fileName: req.file.originalname, buffer: req.file.buffer, sumberData: req.body?.sumber ?? null, userId: req.user.id });
    res.status(hasil.sudahAda ? 200 : 201).json(hasil);
  } catch (e) {
    handleFinanceError(e, res);
  }
});
financePemasukanRouter.post("/pemasukan/legacy/batch/:id/impor", tulis, jalur((req) => komitBatch(prisma, { batchId: req.params.id, userId: req.user.id })));
financePemasukanRouter.post("/pemasukan/legacy/batch/:id/batal", tulis, jalur((req) => batalkanBatch(prisma, { batchId: req.params.id, alasan: req.body?.alasan, userId: req.user.id })));
financePemasukanRouter.post("/pemasukan/legacy/baris/:id/keputusan", tulis, jalur((req) => putuskanBaris(prisma, { rowId: req.params.id, keputusan: req.body?.keputusan, userId: req.user.id })));

// ── Agregator ─────────────────────────────────────────────────────────────────────────────────────────────────────
financePemasukanRouter.get("/pemasukan", jalur((req) => daftarPemasukan(prisma, req.query)));
financePemasukanRouter.get("/pemasukan/:jenis/:id", jalur((req) => detailPemasukan(prisma, req.user, req.params.jenis, req.params.id)));
