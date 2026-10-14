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
import { postPenjualanKaryawan, postPembayaranPenjualanKaryawan, entriPenjualanAktif, KEY } from "../services/finance/posting/penjualanKaryawan.js";
import { tanggalCutoff, sebelumCutoff, tampilCutoff } from "../services/finance/cutoff.js";
import { RECEIPTS_URL_PREFIX } from "../services/finance/receipts.js";
import { penjualanInclude, bentukPenjualan, hitungItems, ambilDaftar, ringkasanPerKaryawan } from "../services/finance/penjualanKaryawanManual.js";
import { pastikanKaryawanNonSales } from "../services/penjualanKaryawan.js";
import { handleFinanceError } from "./finance.js";
import { lockRowForUpdate } from "../services/inventoryLedger.js";
import { buatAtauTautkanOrder, lengkapiSpesifikasi, batalkanOrderBersamaPkr, rapikanAgregatCustomer, ringkasOrderPkr, dryRunPkrTanpaOrder } from "../services/penjualanKaryawanOrder.js";
import { muatKatalogItem, pratinjauItems, buatKategori, ubahKategori, buatProduk, ubahProduk, simpanKomposisi } from "../services/penjualanKaryawanItem.js";
import { pratinjauKoreksi, terapkanKoreksi } from "../services/penjualanKaryawanKoreksi.js";
import { siapkanTerpadu, tulisBarisPenjualan, pratinjauTerpadu } from "../services/penjualanKaryawanTerpadu.js";
import { pratinjauKoreksiBaris, terapkanKoreksiBaris } from "../services/penjualanKaryawanKoreksiBaris.js";
import { adaModeTerpadu } from "../lib/domain/pkrPenjualanItem.js";
import { cariCustomerTelepon } from "../services/penjualanKaryawanPembeli.js";
import { pratinjauKoreksiPembeli, terapkanKoreksiPembeli, dryRunPembeliLegacy, riwayatPerubahanPkr } from "../services/penjualanKaryawanPembeliKoreksi.js";

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

// ─── PEMBELI AKTUAL (Okt 2026): cari customer lewat nomor + dry-run relasi legacy ──────────────────────────────────────────
// Lookup HANYA membaca. Dedupe customer satu-satunya lewat nomor telepon ternormalisasi (nama sama bukan bukti orang yang sama).
financePenjualanKaryawanRouter.get(`${BASE}/pembeli/cari`, requirePermission(P.FINANCE_POST), async (req, res) => {
  try { res.json(await cariCustomerTelepon(prisma, req.query.telepon)); } catch (e) { handleFinanceError(e, res); }
});
// Dry-run (baca-saja): order PKR yang masih menunjuk profil internal karyawan + data apa yang tersedia/kosong. TIDAK ada backfill otomatis.
financePenjualanKaryawanRouter.get(`${BASE}/pembeli/dry-run`, requirePermission(P.FINANCE_READ), async (req, res) => {
  try { res.json(await dryRunPembeliLegacy(prisma, { batas: Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 2000) })); } catch (e) { handleFinanceError(e, res); }
});

// ─── KATALOG ITEM PRODUKSI + PRATINJAU ORDER (multi-item) ────────────────────────────────────────────────────────────
// Katalog = data yang dikelola Admin (izin khusus pkr_catalog:manage — Owner/Admin; peran biasa hanya membaca/memilih); form membaca yang AKTIF + definisi bentuk isian. Pratinjau hanya MEMBACA: apa yang akan dibuat (unit, pickup, pengiriman,
// kelengkapan) dengan fungsi yang sama dengan pembuatan — masukan salah dikembalikan sebagai { valid:false, galat } supaya layar menampilkannya, bukan error HTTP.
financePenjualanKaryawanRouter.get(`${BASE}/katalog-item`, requirePermission(P.FINANCE_READ), async (_req, res) => {
  try { res.json(await muatKatalogItem(prisma)); } catch (e) { handleFinanceError(e, res); }
});
financePenjualanKaryawanRouter.get(`${BASE}/katalog-item/kelola`, requirePermission(P.PKR_CATALOG_MANAGE), async (_req, res) => {
  try { res.json(await muatKatalogItem(prisma, { semua: true })); } catch (e) { handleFinanceError(e, res); }
});
financePenjualanKaryawanRouter.post(`${BASE}/katalog-item/kategori`, requirePermission(P.PKR_CATALOG_MANAGE), async (req, res) => {
  try {
    const c = await prisma.$transaction((tx) => buatKategori(tx, { ...(req.body || {}), userId: req.user.id }));
    res.status(201).json(c);
  } catch (e) { handleFinanceError(e, res); }
});
financePenjualanKaryawanRouter.patch(`${BASE}/katalog-item/kategori/:id`, requirePermission(P.PKR_CATALOG_MANAGE), async (req, res) => {
  try { res.json(await prisma.$transaction((tx) => ubahKategori(tx, { ...(req.body || {}), id: req.params.id, userId: req.user.id }))); } catch (e) { handleFinanceError(e, res); }
});
financePenjualanKaryawanRouter.post(`${BASE}/katalog-item/produk`, requirePermission(P.PKR_CATALOG_MANAGE), async (req, res) => {
  try {
    const p = await prisma.$transaction((tx) => buatProduk(tx, { ...(req.body || {}), userId: req.user.id }));
    res.status(201).json(p);
  } catch (e) { handleFinanceError(e, res); }
});
financePenjualanKaryawanRouter.patch(`${BASE}/katalog-item/produk/:id`, requirePermission(P.PKR_CATALOG_MANAGE), async (req, res) => {
  try { res.json(await prisma.$transaction((tx) => ubahProduk(tx, { ...(req.body || {}), id: req.params.id, userId: req.user.id }))); } catch (e) { handleFinanceError(e, res); }
});
// Komposisi bundel (Set Kasur Lengkap = Kasur + Divan + Sandaran, dst). Mengganti SELURUH komposisi kategori (atau satu produknya) sekaligus, dengan audit sebelum/sesudah.
financePenjualanKaryawanRouter.put(`${BASE}/katalog-item/komposisi`, requirePermission(P.PKR_CATALOG_MANAGE), async (req, res) => {
  try {
    const { kategoriId, produkId, komponen } = req.body || {};
    const hasil = await prisma.$transaction((tx) => simpanKomposisi(tx, { kategoriId, produkId: produkId || null, komponen, userId: req.user.id }));
    res.json({ ...hasil, katalog: await muatKatalogItem(prisma, { semua: true }) });
  } catch (e) { handleFinanceError(e, res); }
});
financePenjualanKaryawanRouter.post(`${BASE}/order-crm/pratinjau`, requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const o = req.body?.orderCrm ?? req.body?.spesifikasi ?? {};
    if (adaModeTerpadu(req.body?.items)) {
      return res.json(await pratinjauTerpadu(prisma, { penjualanId: req.body?.penjualanId || null, items: req.body.items, alamat: typeof o.alamat === "string" && o.alamat.trim() ? o.alamat.trim() : null }));
    }
    res.json(await pratinjauItems(prisma, { penjualanId: req.body?.penjualanId || null, items: o.items, alamat: typeof o.alamat === "string" && o.alamat.trim() ? o.alamat.trim() : null }));
  } catch (e) { handleFinanceError(e, res); }
});

// ─── KOREKSI ITEM (sebelum unit dijadwalkan/diproses) ────────────────────────────────────────────────────────────────
// Pratinjau dampak = fungsi hitung yang SAMA dengan penerapan (tanpa menulis). Penerapan: alasan wajib, expectedRevision wajib (revisi optimistis), Idempotency-Key WAJIB,
// satu transaksi atomik, audit sebelum/sesudah di buku revisi. Item yang unitnya sudah dijadwalkan/diproses diblokir dengan arahan pembatalan resmi.
financePenjualanKaryawanRouter.post(`${BASE}/:id/koreksi-item/pratinjau`, requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    res.json(await pratinjauKoreksi(prisma, { penjualanId: req.params.id, operasi: req.body?.operasi, expectedRevision: req.body?.expectedRevision ?? null }));
  } catch (e) { handleFinanceError(e, res); }
});

financePenjualanKaryawanRouter.post(`${BASE}/:id/koreksi-item`, requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const hasil = await prisma.$transaction((tx) => terapkanKoreksi(tx, {
      penjualanId: req.params.id, operasi: req.body?.operasi, expectedRevision: req.body?.expectedRevision, alasan: req.body?.alasan,
      idempotencyKey: req.headers["idempotency-key"], userId: req.user.id,
    }), { timeout: 30000, maxWait: 10000 });
    if (!hasil.replayed) await rapikanAgregatCustomer(hasil.customerId);
    const sinkron = await ringkasOrderPkr(prisma, [req.params.id]);
    res.status(hasil.replayed ? 200 : 201).json({ ...hasil, sinkron: sinkron.get(req.params.id) ?? null });
  } catch (e) { handleFinanceError(e, res); }
});

// ─── KOREKSI BARIS PENJUALAN (Finance + operasional ATOMIK; PKR terpadu) ───────────────────────────────────────────────
// Mengubah jumlah/harga/ukuran/spesifikasi/kirim, menambah, atau menghapus baris — total, jurnal, item operasional, dan unit berubah dalam SATU transaksi. Setelah Produksi/Delivery berjalan
// hanya HARGA yang boleh berubah; sisanya diblokir dengan arahan pembatalan resmi. Dampak memuat harga: dijaga izin Finance (FINANCE_POST), sama seperti pencatatan.
financePenjualanKaryawanRouter.post(`${BASE}/:id/koreksi-baris/pratinjau`, requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    res.json(await pratinjauKoreksiBaris(prisma, { penjualanId: req.params.id, operasi: req.body?.operasi, expectedRevision: req.body?.expectedRevision ?? null }));
  } catch (e) { handleFinanceError(e, res); }
});

financePenjualanKaryawanRouter.post(`${BASE}/:id/koreksi-baris`, requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const hasil = await prisma.$transaction((tx) => terapkanKoreksiBaris(tx, {
      penjualanId: req.params.id, operasi: req.body?.operasi, expectedRevision: req.body?.expectedRevision, alasan: req.body?.alasan,
      idempotencyKey: req.headers["idempotency-key"], userId: req.user.id,
    }), { timeout: 30000, maxWait: 10000 });
    if (!hasil.replayed) await rapikanAgregatCustomer(hasil.customerId);
    const lengkap = await prisma.finPenjualanKaryawan.findUnique({ where: { id: req.params.id }, include: penjualanInclude });
    const sinkron = await ringkasOrderPkr(prisma, [req.params.id]);
    res.status(hasil.replayed ? 200 : 201).json({ ...hasil, penjualan: bentukPenjualan(lengkap), sinkron: sinkron.get(req.params.id) ?? null });
  } catch (e) { handleFinanceError(e, res); }
});

// ─── KOREKSI PEMBELI / KONTAK / ALAMAT / CATATAN + LENGKAPI-TAUTKAN CUSTOMER (order legacy) ────────────────────────────────────
// Tidak membuat Order/Unit/Job/Payment/invoice/jurnal. Pratinjau = fungsi hitung yang SAMA dengan penerapan. Alasan + Idempotency-Key + expectedRevision wajib.
financePenjualanKaryawanRouter.post(`${BASE}/:id/koreksi-pembeli/pratinjau`, requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    res.json(await pratinjauKoreksiPembeli(prisma, { penjualanId: req.params.id, masukan: req.body || {} }));
  } catch (e) { handleFinanceError(e, res); }
});

financePenjualanKaryawanRouter.post(`${BASE}/:id/koreksi-pembeli`, requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const { alasan, expectedRevision, ...masukan } = req.body || {};
    const hasil = await prisma.$transaction((tx) => terapkanKoreksiPembeli(tx, {
      penjualanId: req.params.id, masukan, expectedRevision, alasan, idempotencyKey: req.headers["idempotency-key"], userId: req.user.id,
    }), { timeout: 30000, maxWait: 10000 });
    if (!hasil.replayed) for (const cid of hasil.customerIds ?? []) await rapikanAgregatCustomer(cid);
    const lengkap = await prisma.finPenjualanKaryawan.findUnique({ where: { id: req.params.id }, include: penjualanInclude });
    const sinkron = await ringkasOrderPkr(prisma, [req.params.id]);
    res.status(hasil.replayed ? 200 : 201).json({ ...hasil, penjualan: bentukPenjualan(lengkap), sinkron: sinkron.get(req.params.id) ?? null });
  } catch (e) { handleFinanceError(e, res); }
});

// Riwayat perubahan (sebelum/sesudah, pelaku, alasan). Baris Finance (nama/harga) hanya untuk yang berizin Finance.
financePenjualanKaryawanRouter.get(`${BASE}/:id/riwayat`, requirePermission(P.FINANCE_READ), async (req, res) => {
  try { res.json(await riwayatPerubahanPkr(prisma, req.params.id, { izinFinance: true })); } catch (e) { handleFinanceError(e, res); }
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
    // Jalur TERPADU (satu daftar item = penjualan + pemenuhan) atau jalur LAMA (item uang saja + orderCrm terpisah). Tidak boleh dicampur.
    const terpadu = adaModeTerpadu(items);
    if (terpadu && req.body?.orderCrm?.items !== undefined) throw Object.assign(err("Daftar item sudah mencakup pemenuhan — jangan kirim orderCrm.items lagi (input ganda)"), { code: "INPUT_GANDA" });
    const { items: baris, total } = terpadu ? { items: [], total: null } : hitungItems(items, err);
    const bayar = pembayaran == null ? [] : pembayaran;
    if (!Array.isArray(bayar) || bayar.length > 10) throw err("Daftar pembayaran awal tidak valid (maksimal 10)");

    const hasil = await prisma.$transaction(async (tx) => {
      const seller = await pastikanKaryawanNonSales(tx, sellerId);
      const tanggal = tanggalBuku(date, "Tanggal penjualan");
      const id = randomUUID();
      // Terpadu: item disiapkan di DALAM transaksi (katalog dibaca konsisten); total dari baris yang sama dengan item operasional.
      const s = terpadu ? await siapkanTerpadu(tx, items) : null;
      const totalDok = terpadu ? s.total : total;
      await tx.finPenjualanKaryawan.create({
        data: {
          id, nomor: await generateDocumentNumber(tx, "PKR", tanggal), date: tanggal, sellerId: seller.id, buyerName: pembeli.slice(0, 200),
          notes: notes?.trim() || null, total: totalDok, createdById: req.user.id,
          ...(!terpadu && { items: { create: baris.map((b) => ({ name: b.name, quantity: b.quantity, unitPrice: b.unitPrice, sortOrder: b.sortOrder })) } }),
        },
      });
      if (terpadu) await tulisBarisPenjualan(tx, id, s.baris);
      await postPenjualanKaryawan(tx, { penjualanId: id, userId: req.user.id });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_PENJUALAN_KARYAWAN, entityId: id, eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: req.user.id,
        metadata: { aksi: "dicatat", seller: seller.name, buyerName: pembeli, total: String(totalDok), jumlahItem: terpadu ? s.baris.length : baris.length, ...(terpadu && { terpadu: true }) },
      });
      // PKR aktif = "disetujui" (tidak ada langkah persetujuan terpisah): lahirkan SATU order CRM operasional (+ unit) di transaksi yang sama. Gagal di mana pun = PKR, jurnal, dan order batal bersama.
      if (!terpadu) await buatAtauTautkanOrder(tx, { penjualanId: id, userId: req.user.id, spesifikasi: req.body?.orderCrm, sumber: "dibuat", pembeli: req.body?.pembeli ?? null, pemenuhan: req.body?.orderCrm ?? null });
      else if (s.opItems.length) {
        // Hanya alamat/kota/tanggal kirim dari orderCrm; daftar item operasional = turunan baris penjualan yang sama. Tanpa item Produksi/Pickup, Order CRM tidak dibuat.
        const { alamat, kota, tanggalKirim } = req.body?.orderCrm ?? {};
        await buatAtauTautkanOrder(tx, {
          penjualanId: id, userId: req.user.id, spesifikasi: { alamat, kota, tanggalKirim }, sumber: "dibuat", itemsSiap: s.opItems, nonProduksi: s.nonProduksi,
          pembeli: req.body?.pembeli ?? null, pemenuhan: req.body?.orderCrm ?? null,
        });
      }
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
      pembeli: req.body?.pembeli ?? null, pemenuhan: req.body?.spesifikasi ?? req.body?.orderCrm ?? null,
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
      const entry = await entriPenjualanAktif(tx, p.id); // jurnal asli, atau pengganti terakhir bila nilai pernah dikoreksi
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
