// FINANCE WORKSPACE — PENJUALAN KARYAWAN (input manual di luar Order).
//
// Di-mount di prefix /api/finance. Karyawan non-Sales menjual ke kerabat; dicatat MANUAL oleh Finance/Admin. TIDAK membuat Order, Customer, unit produksi,
// atau job delivery — alur order customer tidak tersentuh. Model: FinPenjualanKaryawan (schema.prisma). Jurnal & alasannya: services/finance/posting/penjualanKaryawan.js.
//
// SINKRONISASI ORDER CRM (Okt 2026): setiap PKR yang dicatat otomatis melahirkan SATU Order CRM operasional (dokumen untuk Unit Produksi + Delivery) dalam transaksi yang SAMA.
// Order itu tidak membawa uang: nominal, cicilan, piutang, dan jurnal tetap di PKR. Detail + penjaga: services/penjualanKaryawanOrder.js. PKR lama diberi aksi eksplisit (tanpa backfill massal).
//
// Aturan yang ditegakkan di sini:
//  • Penjual = akun aktif NON-Sales (pastikanKaryawanNonSales). Pembeli = teks bebas.
//  • Total dihitung SERVER dari item (qty × harga). Klien tidak mengirim total.
//  • Pembayaran: tunai/transfer ke rekening perusahaan (rekening opsional bila tanggalnya sebelum cutoff saldo awal) atau potong gaji; tidak boleh melebihi sisa.
//  • Dokumen dengan pembayaran aktif tidak bisa dibatalkan — batalkan pembayarannya dulu. Pembatalan = jurnal dibalik + alasan.
//  • HPP TIDAK dibukukan (keputusan Owner 2 Okt 2026).

import express from "express";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";
import { requirePermission, PERMISSIONS as P, rolesOf } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { reverseJournal, generateDocumentNumber, toBookDate, todayBookDateWIB, findEntryByKey } from "../services/finance/journal.js";
import { toMoney } from "../services/finance/money.js";
import { postPenjualanKaryawan, postPembayaranPenjualanKaryawan, KEY } from "../services/finance/posting/penjualanKaryawan.js";
import { tanggalCutoff, sebelumCutoff, tampilCutoff } from "../services/finance/cutoff.js";
import { RECEIPTS_URL_PREFIX } from "../services/finance/receipts.js";
import { penjualanInclude, bentukPenjualan, hitungItems, ambilDaftar, ringkasanPerKaryawan } from "../services/finance/penjualanKaryawanManual.js";
import { pastikanKaryawanNonSales } from "../services/penjualanKaryawan.js";
import { handleFinanceError } from "./finance.js";
import { lockRowForUpdate } from "../services/inventoryLedger.js";
import { buatAtauTautkanOrder, lengkapiSpesifikasi, batalkanOrderBersamaPkr, rapikanAgregatCustomer, ringkasOrderPkr, dryRunPkrTanpaOrder } from "../services/penjualanKaryawanOrder.js";

export const financePenjualanKaryawanRouter = express.Router();
const BASE = "/penjualan-karyawan";
// Middleware dipasang HANYA di jalur modul ini: router ini di-mount di prefix /api/finance yang sama dengan router lain, dan use() tanpa jalur akan
// menjalankan requireAuth untuk SETIAP permintaan /api/finance/* yang lewat — pada token mobile itu menghitung dua kali di pembatas laju (120/menit).
financePenjualanKaryawanRouter.use(BASE, requireAuth, idempotency);

const err = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const METODE = ["TUNAI", "TRANSFER", "POTONG_GAJI"];

/** Tanggal buku dari input (YYYY-MM-DD) — default hari ini WIB; tidak boleh di masa depan. */
function tanggalBuku(date, label) {
  const t = date ? toBookDate(date) : todayBookDateWIB();
  if (t.getTime() > todayBookDateWIB().getTime()) throw err(`${label} tidak boleh di masa depan`);
  return t;
}

/** Catat SATU pembayaran atas satu dokumen aktif (dipakai jalur create-dengan-pembayaran dan endpoint pembayaran). Kunci baris dokumen dulu: dua pembayaran paralel tidak boleh melampaui sisa. */
async function catatPembayaran(tx, penjualanId, { date, amount, method, cashAccountId, receiptUrl, notes }, userId) {
  await lockRowForUpdate(tx, '"fin_penjualan_karyawan"', penjualanId);
  const p = await tx.finPenjualanKaryawan.findUnique({ where: { id: penjualanId }, include: { payments: { where: { cancelledAt: null } }, seller: { select: { name: true } } } });
  if (!p) throw err("Penjualan karyawan tidak ditemukan", 404);
  if (p.status !== "AKTIF") throw err(`${p.nomor} sudah dibatalkan`, 409);
  if (!METODE.includes(method)) throw err("Metode pembayaran harus Tunai, Transfer, atau Potong Gaji");

  const nominal = toMoney(amount, { field: "Nominal pembayaran" });
  if (nominal.lessThanOrEqualTo(0)) throw err("Nominal pembayaran harus lebih dari 0");
  const bayar = p.payments.reduce((acc, x) => acc.plus(toMoney(x.amount)), toMoney(0));
  const sisa = toMoney(p.total).minus(bayar);
  if (nominal.greaterThan(sisa)) throw err(`Nominal melebihi sisa tagihan ${p.nomor} (Rp${Number(sisa).toLocaleString("id-ID")})`);

  const tanggal = tanggalBuku(date, "Tanggal pembayaran");
  if (tanggal.getTime() < p.date.getTime()) throw err("Tanggal pembayaran tidak boleh sebelum tanggal penjualan");
  if (receiptUrl && !String(receiptUrl).startsWith(`${RECEIPTS_URL_PREFIX}/`)) throw err("Bukti harus diunggah lewat fitur upload");

  const cutoff = await tanggalCutoff(tx);
  const praSaldoAwal = method !== "POTONG_GAJI" && sebelumCutoff(tanggal.toISOString().slice(0, 10), cutoff);
  let rekening = null;
  if (method === "POTONG_GAJI") {
    if (cashAccountId) throw err("Potong gaji tidak memakai rekening");
  } else {
    // Rekening WAJIB untuk uang yang diterima sesudah cutoff; sebelum cutoff hanya keterangan (jurnalnya tidak menyentuh kas — lihat posting).
    if (!cashAccountId && !praSaldoAwal) throw err("Pilih dulu uangnya masuk ke rekening mana");
    if (cashAccountId) {
      rekening = await tx.finCashAccount.findUnique({ where: { id: cashAccountId }, select: { id: true, name: true, accountId: true, active: true } });
      if (!rekening || !rekening.active) throw err("Rekening tidak ditemukan atau nonaktif", 404);
    }
  }

  const pay = await tx.finPenjualanKaryawanPayment.create({
    data: { penjualanId, date: tanggal, amount: nominal, method, cashAccountId: rekening?.id ?? null, receiptUrl: receiptUrl || null, notes: notes?.trim() || null, createdById: userId },
  });
  await postPembayaranPenjualanKaryawan(tx, { paymentId: pay.id, userId });
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.FIN_PENJUALAN_KARYAWAN, entityId: penjualanId, eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: userId,
    metadata: { nomor: p.nomor, aksi: "pembayaran", method, amount: String(nominal), paymentId: pay.id, ...(praSaldoAwal && { sebelumSaldoAwal: `tanggal sebelum cutoff ${tampilCutoff(cutoff)} — tidak menambah saldo kas/bank` }) },
  });
  return pay;
}

// ─── DAFTAR + RINGKASAN ──────────────────────────────────────────────────
financePenjualanKaryawanRouter.get(BASE, requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const [daftar, ringkasan, cutoff] = await Promise.all([
      ambilDaftar(prisma, req.query, { take: 500 }),
      ringkasanPerKaryawan(prisma),
      tanggalCutoff(prisma),
    ]);
    // cutoff dikirim agar layar tahu kapan rekening wajib (uang sebelum cutoff sudah tercakup saldo awal) — sumber kebenarannya tetap server.
    const sinkron = await ringkasOrderPkr(prisma, daftar.map((d) => d.id));
    res.json({ penjualan: daftar.map((d) => ({ ...d, sinkron: sinkron.get(d.id) ?? null })), ringkasan, terpotong: daftar.length === 500, cutoff });
  } catch (e) { handleFinanceError(e, res); }
});

// Pilihan karyawan penjual: akun aktif non-Sales.
financePenjualanKaryawanRouter.get(`${BASE}/karyawan`, requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const users = await prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, role: true, roles: { select: { role: true } } }, orderBy: { name: "asc" } });
    res.json({ karyawan: users.filter((u) => !rolesOf({ role: u.role, roles: u.roles.map((r) => r.role) }).includes("SALES")).map((u) => ({ id: u.id, name: u.name })) });
  } catch (e) { handleFinanceError(e, res); }
});

// Dry-run: PKR AKTIF yang belum punya order CRM (tidak menulis apa pun). Aksi per dokumen: POST /:id/order-crm. TIDAK ada backfill massal.
financePenjualanKaryawanRouter.get(`${BASE}/order-crm/dry-run`, requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const daftar = await dryRunPkrTanpaOrder(prisma);
    res.json({ jumlah: daftar.length, daftar, catatan: "Hanya pratinjau. Tidak ada order, unit, job, pembayaran, atau jurnal yang dibuat. Buat per dokumen lewat 'Buat/Tautkan Order CRM'." });
  } catch (e) { handleFinanceError(e, res); }
});

financePenjualanKaryawanRouter.get(`${BASE}/:id`, requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const p = await prisma.finPenjualanKaryawan.findUnique({ where: { id: req.params.id }, include: penjualanInclude });
    if (!p) throw err("Penjualan karyawan tidak ditemukan", 404);
    const sinkron = await ringkasOrderPkr(prisma, [p.id]);
    res.json({ ...bentukPenjualan(p), sinkron: sinkron.get(p.id) ?? null });
  } catch (e) { handleFinanceError(e, res); }
});

// ─── CATAT PENJUALAN (+ pembayaran awal opsional) ────────────────────────
financePenjualanKaryawanRouter.post(BASE, requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const { date, sellerId, buyerName, items, notes, pembayaran } = req.body || {};
    const pembeli = String(buyerName ?? "").trim().replace(/\s+/g, " ");
    if (pembeli.length < 2) throw err("Nama pembeli wajib diisi");
    if (!sellerId) throw err("Karyawan penjual wajib dipilih");
    const { items: baris, total } = hitungItems(items, err);
    const bayar = pembayaran == null ? [] : pembayaran;
    if (!Array.isArray(bayar) || bayar.length > 10) throw err("Daftar pembayaran awal tidak valid (maksimal 10)");

    const hasil = await prisma.$transaction(async (tx) => {
      const seller = await pastikanKaryawanNonSales(tx, sellerId);
      const tanggal = tanggalBuku(date, "Tanggal penjualan");
      const id = randomUUID();
      await tx.finPenjualanKaryawan.create({
        data: {
          id, nomor: await generateDocumentNumber(tx, "PKR", tanggal), date: tanggal, sellerId: seller.id, buyerName: pembeli.slice(0, 200),
          notes: notes?.trim() || null, total, createdById: req.user.id,
          items: { create: baris.map((b) => ({ name: b.name, quantity: b.quantity, unitPrice: b.unitPrice, sortOrder: b.sortOrder })) },
        },
      });
      await postPenjualanKaryawan(tx, { penjualanId: id, userId: req.user.id });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_PENJUALAN_KARYAWAN, entityId: id, eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: req.user.id,
        metadata: { aksi: "dicatat", seller: seller.name, buyerName: pembeli, total: String(total), jumlahItem: baris.length },
      });
      // PKR aktif = "disetujui" (tidak ada langkah persetujuan terpisah): lahirkan SATU order CRM operasional (+ unit) di transaksi yang sama. Gagal di mana pun = PKR, jurnal, dan order batal bersama.
      await buatAtauTautkanOrder(tx, { penjualanId: id, userId: req.user.id, spesifikasi: req.body?.orderCrm, sumber: "dibuat" });
      for (const b of bayar) await catatPembayaran(tx, id, b, req.user.id);
      return id;
    }, { timeout: 30000, maxWait: 10000 });
    const lengkap = await prisma.finPenjualanKaryawan.findUnique({ where: { id: hasil }, include: penjualanInclude });
    const sinkron = await ringkasOrderPkr(prisma, [hasil]);
    res.status(201).json({ ...bentukPenjualan(lengkap), sinkron: sinkron.get(hasil) ?? null });
  } catch (e) { handleFinanceError(e, res); }
});

// ─── ORDER CRM (buat/tautkan untuk PKR lama; lengkapi spesifikasi, alamat, jadwal) ─────────────────────────────────────────────────────
// Idempoten: bila PKR sudah punya order, mengembalikan yang ada (tidak membuat order/customer/unit kedua). Aman terhadap klik/permintaan paralel (kunci baris PKR).
financePenjualanKaryawanRouter.post(`${BASE}/:id/order-crm`, requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const hasil = await prisma.$transaction((tx) => buatAtauTautkanOrder(tx, {
      penjualanId: req.params.id, userId: req.user.id, spesifikasi: req.body?.spesifikasi ?? req.body?.orderCrm, orderId: req.body?.orderId || null, sumber: "dibuat_lama",
    }), { timeout: 30000, maxWait: 10000 });
    const sinkron = await ringkasOrderPkr(prisma, [req.params.id]);
    res.status(hasil.dibuat ? 201 : 200).json({ ...hasil, sinkron: sinkron.get(req.params.id) ?? null });
  } catch (e) { handleFinanceError(e, res); }
});

financePenjualanKaryawanRouter.put(`${BASE}/:id/order-crm`, requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const hasil = await prisma.$transaction((tx) => lengkapiSpesifikasi(tx, { penjualanId: req.params.id, userId: req.user.id, masukan: req.body || {} }), { timeout: 30000, maxWait: 10000 });
    const sinkron = await ringkasOrderPkr(prisma, [req.params.id]);
    res.json({ ...hasil, sinkron: sinkron.get(req.params.id) ?? null });
  } catch (e) { handleFinanceError(e, res); }
});

// ─── PEMBAYARAN ──────────────────────────────────────────────────────────
financePenjualanKaryawanRouter.post(`${BASE}/:id/pembayaran`, requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    await prisma.$transaction((tx) => catatPembayaran(tx, req.params.id, req.body || {}, req.user.id));
    const lengkap = await prisma.finPenjualanKaryawan.findUnique({ where: { id: req.params.id }, include: penjualanInclude });
    const sinkron = await ringkasOrderPkr(prisma, [req.params.id]);
    res.status(201).json({ ...bentukPenjualan(lengkap), sinkron: sinkron.get(req.params.id) ?? null });
  } catch (e) { handleFinanceError(e, res); }
});

financePenjualanKaryawanRouter.post(`${BASE}/:id/pembayaran/:pid/batal`, requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const reason = req.body?.reason?.trim();
    if (!reason) throw err("Alasan pembatalan wajib diisi");
    await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, '"fin_penjualan_karyawan"', req.params.id);
      const pay = await tx.finPenjualanKaryawanPayment.findUnique({ where: { id: req.params.pid }, include: { penjualan: true } });
      if (!pay || pay.penjualanId !== req.params.id) throw err("Pembayaran tidak ditemukan", 404);
      if (pay.cancelledAt) throw err("Pembayaran ini sudah dibatalkan", 409);
      const entry = await findEntryByKey(tx, KEY.pembayaran(pay.id));
      if (entry && entry.status === "POSTED") {
        await reverseJournal(tx, { entryId: entry.id, reason: `Pembayaran ${pay.penjualan.nomor} dibatalkan — ${reason}`, userId: req.user.id });
      }
      await tx.finPenjualanKaryawanPayment.update({ where: { id: pay.id }, data: { cancelledAt: new Date(), cancelReason: reason } });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_PENJUALAN_KARYAWAN, entityId: pay.penjualanId, eventType: EVENT_TYPES.DOCUMENT_CANCELLED, actorId: req.user.id,
        metadata: { nomor: pay.penjualan.nomor, aksi: "batal_pembayaran", reason, amount: String(pay.amount), method: pay.method },
      });
    });
    const lengkap = await prisma.finPenjualanKaryawan.findUnique({ where: { id: req.params.id }, include: penjualanInclude });
    const sinkron = await ringkasOrderPkr(prisma, [req.params.id]);
    res.json({ ...bentukPenjualan(lengkap), sinkron: sinkron.get(req.params.id) ?? null });
  } catch (e) { handleFinanceError(e, res); }
});

// ─── BATALKAN PENJUALAN ──────────────────────────────────────────────────
financePenjualanKaryawanRouter.post(`${BASE}/:id/batal`, requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const reason = req.body?.reason?.trim();
    if (!reason) throw err("Alasan pembatalan wajib diisi");
    let customerOrder = null;
    await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, '"fin_penjualan_karyawan"', req.params.id);
      const p = await tx.finPenjualanKaryawan.findUnique({ where: { id: req.params.id }, include: { payments: { where: { cancelledAt: null } } } });
      if (!p) throw err("Penjualan karyawan tidak ditemukan", 404);
      if (p.status === "DIBATALKAN") throw err("Penjualan ini sudah dibatalkan", 409);
      if (p.payments.length > 0) throw err("Penjualan ini sudah ada pembayarannya — batalkan pembayarannya dulu", 409);
      // Order CRM: belum diproses → ikut dibatalkan lewat jalur baku (unit CANCELLED, job dibatalkan, riwayat tetap). Produksi/Delivery sudah berjalan → pembatalan DIBLOKIR (409), tidak ada yang berubah.
      customerOrder = await batalkanOrderBersamaPkr(tx, { penjualanId: p.id, userId: req.user.id, alasan: reason });
      const entry = await findEntryByKey(tx, KEY.penjualan(p.id));
      if (entry && entry.status === "POSTED") {
        await reverseJournal(tx, { entryId: entry.id, reason: `Penjualan karyawan ${p.nomor} dibatalkan — ${reason}`, userId: req.user.id });
      }
      await tx.finPenjualanKaryawan.update({ where: { id: p.id }, data: { status: "DIBATALKAN", cancelledAt: new Date(), cancelReason: reason } });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_PENJUALAN_KARYAWAN, entityId: p.id, eventType: EVENT_TYPES.DOCUMENT_CANCELLED, actorId: req.user.id,
        metadata: { nomor: p.nomor, reason, total: String(p.total), orderDibatalkan: Boolean(customerOrder?.dibatalkan) },
      });
    }, { timeout: 30000, maxWait: 10000 });
    await rapikanAgregatCustomer(customerOrder?.customerId);
    const lengkap = await prisma.finPenjualanKaryawan.findUnique({ where: { id: req.params.id }, include: penjualanInclude });
    const sinkron = await ringkasOrderPkr(prisma, [req.params.id]);
    res.json({ ...bentukPenjualan(lengkap), sinkron: sinkron.get(req.params.id) ?? null });
  } catch (e) { handleFinanceError(e, res); }
});
