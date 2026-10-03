// FINANCE — PENGECUALIAN TANGGAL LUNAS (keputusan Owner, ber-riwayat). Di-mount di /api/finance. Logika & alasan: services/pengecualianPaidAt.js.
//   GET  /pengecualian-lunas                 riwayat (?aktif=1|0, ?q=)      — FINANCE_READ (Finance perlu tahu order mana yang dikunci sebelum memverifikasi)
//   POST /pengecualian-lunas                 { orderNumber, alasan, paidAtDikunci? }   — FINANCE_ADMIN (Admin/Owner)
//   POST /pengecualian-lunas/:id/cabut       { alasan }                    — FINANCE_ADMIN
// Tidak menyentuh Payment, jurnal, saldo, atau status bayar.
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { buatPengecualian, cabutPengecualian, daftarPengecualian, PengecualianError } from "../services/pengecualianPaidAt.js";
import { handleFinanceError } from "./finance.js";

export const financePengecualianLunasRouter = express.Router();
const BASE = "/pengecualian-lunas";
// Middleware hanya untuk jalur ini (lihat catatan di routes/financePenjualanKaryawan.js: use() tanpa jalur menghitung ganda di pembatas laju mobile).
financePengecualianLunasRouter.use(BASE, requireAuth, idempotency);

const kirimGalat = (e, res) => (e instanceof PengecualianError ? res.status(e.statusCode).json({ error: e.message, code: e.code }) : handleFinanceError(e, res));

financePengecualianLunasRouter.get(BASE, requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const aktif = req.query.aktif === "1" ? true : req.query.aktif === "0" ? false : undefined;
    const daftar = await daftarPengecualian(prisma, { aktif, q: req.query.q });
    // Kartu ringkasan dari SEMUA pengecualian aktif (bukan hanya baris yang tersaring) — dihitung di sini, bukan di layar.
    const semuaAktif = aktif === true && !req.query.q ? daftar : await daftarPengecualian(prisma, { aktif: true });
    res.json({
      pengecualian: daftar, jumlahAktif: semuaAktif.length,
      nilaiAktif: semuaAktif.reduce((s, d) => s + (d.order.nilai || 0), 0),
      tidakKonsisten: semuaAktif.filter((d) => d.konsisten === false).length,
    });
  } catch (e) { kirimGalat(e, res); }
});

financePengecualianLunasRouter.post(BASE, requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const nomor = String(req.body?.orderNumber ?? "").trim();
    if (!nomor) throw new PengecualianError("Nomor order wajib diisi");
    const order = await prisma.order.findFirst({ where: { orderNumber: nomor }, select: { id: true } });
    if (!order) throw new PengecualianError(`Order ${nomor} tidak ditemukan`, 404, "ORDER_TIDAK_ADA");
    const hasil = await prisma.$transaction((tx) => buatPengecualian(tx, { orderId: order.id, alasan: req.body?.alasan, paidAtDikunci: req.body?.paidAtDikunci || null, actorId: req.user.id }));
    res.status(201).json(hasil);
  } catch (e) { kirimGalat(e, res); }
});

financePengecualianLunasRouter.post(`${BASE}/:id/cabut`, requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const hasil = await prisma.$transaction((tx) => cabutPengecualian(tx, { pengecualianId: req.params.id, alasan: req.body?.alasan, actorId: req.user.id }));
    res.json(hasil);
  } catch (e) { kirimGalat(e, res); }
});
