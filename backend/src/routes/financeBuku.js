// BUKU (Finance Mobile S9) — read-model jurnal, buku besar, dan rekonsiliasi bank. Hanya membaca; perintah pencocokan memakai endpoint yang sudah ada.
//
//   GET /api/finance/buku/jurnal?from&to&q&source&status&akunId&page&limit       daftar + indikator seimbang + jumlah per status
//   GET /api/finance/buku/jurnal/:id                                              detail baris, dokumen terkait, audit trail
//   GET /api/finance/buku/akun?q=                                                 pilihan akun (yang bisa diposting)
//   GET /api/finance/buku/akun/:id/mutasi?from&to&page&limit                      buku besar: saldo awal, mutasi, saldo berjalan (server)
//   GET /api/finance/buku/rekon[?cashAccountId&status]                            daftar rekonsiliasi (saldo buku, saldo koran, selisih)
//   GET /api/finance/buku/rekon/:id                                               detail: baris koran, kandidat, aksi cocokkan/lepas, riwayat
// Semua FINANCE_READ. Jurnal manual, reversal, edit jurnal, tutup periode, dan koreksi saldo TIDAK tersedia di sini (hanya web).

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { daftarAkun, daftarJurnal, daftarRekon, detailJurnal, detailRekon, mutasiAkun } from "../services/finance/buku.js";
import { handleFinanceError } from "./finance.js";

export const financeBukuRouter = express.Router();
financeBukuRouter.use("/buku", requireAuth, requirePermission(P.FINANCE_READ));

const jalur = (fn) => async (req, res) => {
  try {
    const hasil = await fn(req);
    if (hasil === null) return res.status(404).json({ error: "Data tidak ditemukan" });
    res.json(hasil);
  } catch (e) {
    handleFinanceError(e, res);
  }
};

financeBukuRouter.get("/buku/jurnal", jalur((req) => daftarJurnal(prisma, req.query)));
financeBukuRouter.get("/buku/jurnal/:id", jalur((req) => detailJurnal(prisma, req.user, req.params.id)));
financeBukuRouter.get("/buku/akun", jalur((req) => daftarAkun(prisma, req.query)));
financeBukuRouter.get("/buku/akun/:id/mutasi", jalur((req) => mutasiAkun(prisma, { accountId: req.params.id, from: req.query.from, to: req.query.to, page: req.query.page, limit: req.query.limit })));
financeBukuRouter.get("/buku/rekon", jalur((req) => daftarRekon(prisma, req.query)));
financeBukuRouter.get("/buku/rekon/:id", jalur((req) => detailRekon(prisma, req.user, req.params.id)));
