// TRANSAKSI FINANCE MOBILE (S6–S8) — read-model gabungan, hanya membaca. Perintah (buat/ajukan/bayar/batal) tetap lewat endpoint milik tiap dokumen di
// routes/financeTransactions.js dan routes/financeKasbon.js (Idempotency-Key, row lock, jurnal, approval); path perintah dikirim server di `aksi`.
//
//   GET /api/finance/transaksi/ringkasan                 jumlah per modul (kartu di tab Transaksi)
//   GET /api/finance/transaksi/opsi                      pilihan formulir (kategori, rekening + saldo, supplier, karyawan, akun pemasukan lain)
//   GET /api/finance/transaksi/opsi/order?q=             cari order untuk refund (+ sisa yang boleh dikembalikan)
//   GET /api/finance/transaksi/:modul?tab=&q=&from=&to=&page=&limit=[&supplierId=&jatuhTempo=lewat]
//   GET /api/finance/transaksi/:modul/:id                detail + lampiran bertanda-tangan + riwayat
//   modul: pengeluaran | pembelian | kasbon | pemasukan | piutang | refund | supplier | tagihan | pembayaran-supplier
// Semua butuh FINANCE_READ.

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { cariOrderRefund, daftarTransaksi, detailTransaksi, opsiForm, ringkasanTransaksi } from "../services/finance/transaksi.js";
import { handleFinanceError } from "./finance.js";

export const financeTransaksiRouter = express.Router();
// Dibatasi ke /transaksi (lihat catatan yang sama di financePembayaran.js): router lain berbagi prefix /api/finance.
financeTransaksiRouter.use("/transaksi", requireAuth, requirePermission(P.FINANCE_READ));

financeTransaksiRouter.get("/transaksi/ringkasan", async (_req, res) => {
  try {
    res.json(await ringkasanTransaksi(prisma));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTransaksiRouter.get("/transaksi/opsi", async (req, res) => {
  try {
    res.json(await opsiForm(prisma, req.user));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTransaksiRouter.get("/transaksi/opsi/order", async (req, res) => {
  try {
    res.json({ orders: await cariOrderRefund(prisma, req.query.q) });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTransaksiRouter.get("/transaksi/:modul", async (req, res) => {
  try {
    const { tab, q, from, to, page, limit, supplierId, jatuhTempo } = req.query;
    res.json(await daftarTransaksi(prisma, req.user, req.params.modul, { tab, q, from, to, page, limit, supplierId, jatuhTempo }));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTransaksiRouter.get("/transaksi/:modul/:id", async (req, res) => {
  try {
    const detail = await detailTransaksi(prisma, req.user, req.params.modul, req.params.id);
    if (!detail) return res.status(404).json({ error: "Data tidak ditemukan" });
    res.json(detail);
  } catch (e) {
    handleFinanceError(e, res);
  }
});
