// FINANCE WORKSPACE — verifikasi penerimaan uang atas order yang sudah
// ditandai LUNAS oleh sales. Penjelasan & alasan desain lengkap ada di
// services/finance/penerimaanOrder.js.

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { daftarLunasBelumDicatat, verifikasiPenerimaan, tolakLunas, mintaBukti } from "../services/finance/penerimaanOrder.js";
import { daftarKlaimLunasResi, detailKlaimResi, pratinjauVerifikasiResi, verifikasiPenerimaanResi, tolakLunasResi, mintaBuktiResi } from "../services/finance/penerimaanResi.js";
import { wajibIdempotencyKey } from "../middleware/idempotency.js";
import { RECEIPTS_URL_PREFIX } from "../services/finance/receipts.js";
import { handleFinanceError } from "./finance.js";
import { daftarKlaimFinance, detailKlaimFinance, mintaBuktiKlaim, tolakKlaim, verifikasiKlaim, ringkasKlaimMenunggu, KlaimError } from "../services/finance/klaimLunas.js";
import { BerkasError } from "../services/finance/klaimLunasBerkas.js";

export const financePenerimaanRouter = express.Router();
financePenerimaanRouter.use(requireAuth);
// Idempotency-Key untuk command uang (opsional di web, wajib di token mobile).
financePenerimaanRouter.use(idempotency);

function err(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function cekBukti(url) {
  if (url && !String(url).startsWith(`${RECEIPTS_URL_PREFIX}/`) && !String(url).startsWith("/media/payment-proofs/")) {
    throw err("Foto bukti harus diunggah lewat fitur upload");
  }
}

const MAKS_FOTO_BUKTI = 10;
/** Daftar foto bukti (opsional): array maksimal ${MAKS_FOTO_BUKTI} URL, tiap URL harus hasil unggahan sistem. Mengembalikan array bersih (unik). */
function cekBuktiBanyak(daftar) {
  if (daftar === undefined || daftar === null) return [];
  if (!Array.isArray(daftar)) throw err("Daftar foto bukti tidak valid");
  if (daftar.length > MAKS_FOTO_BUKTI) throw err(`Maksimal ${MAKS_FOTO_BUKTI} foto bukti`);
  for (const u of daftar) { if (typeof u !== "string") throw err("Daftar foto bukti tidak valid"); cekBukti(u); }
  return [...new Set(daftar)];
}

financePenerimaanRouter.get("/penerimaan/lunas-belum-dicatat", requirePermission(P.PAYMENT_READ), async (req, res) => {
  try {
    const daftar = await daftarLunasBelumDicatat(prisma);
    const resi = await daftarKlaimLunasResi(prisma); // Fase 3A: kosong bila RESI_PEMBAYARAN_AKTIF mati
    res.json(resi.aktif ? { ...daftar, resi: resi.items, ringkasResi: { jumlah: resi.jumlah, total: resi.total } } : daftar);
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Verifikasi SATU order: rekening + tanggal + (opsional) foto bukti.
financePenerimaanRouter.post("/penerimaan/verifikasi", requirePermission(P.PAYMENT_WRITE), async (req, res) => {
  try {
    const { orderId, mode, method, cashAccountId, date, amount, proofPhotoUrl } = req.body;
    if (!orderId) throw err("Order wajib dipilih");
    cekBukti(proofPhotoUrl);
    const proofPhotoUrls = cekBuktiBanyak(req.body.proofPhotoUrls);
    const hasil = await prisma.$transaction((tx) =>
      verifikasiPenerimaan(tx, { orderId, mode, method, cashAccountId, date, amount, proofPhotoUrl, proofPhotoUrls, verifierId: req.user.id })
    );
    res.status(201).json(hasil);
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Banyak order sekaligus dengan rekening/metode yang sama. Tiap order
// transaksinya sendiri: satu yang gagal tidak membatalkan yang lain, dan
// hasil per-order dikembalikan supaya UI bisa menunjukkan mana yang perlu
// dilihat ulang. Tanggal tiap order = tanggal sales menandainya lunas.
financePenerimaanRouter.post("/penerimaan/verifikasi-massal", requirePermission(P.PAYMENT_WRITE), async (req, res) => {
  try {
    const { orderIds, mode, method, cashAccountId, proofPhotoUrl } = req.body;
    if (!Array.isArray(orderIds) || orderIds.length === 0) throw err("Pilih minimal satu order");
    if (orderIds.length > 500) throw err("Maksimal 500 order sekali proses");
    cekBukti(proofPhotoUrl); // foto bukti (mis. bukti transfer gabungan) dilampirkan ke SEMUA pembayaran yang dibuat
    const proofPhotoUrls = cekBuktiBanyak(req.body.proofPhotoUrls);
    const hasil = [];
    for (const orderId of orderIds) {
      try {
        const r = await prisma.$transaction((tx) =>
          verifikasiPenerimaan(tx, { orderId, mode, method, cashAccountId, proofPhotoUrl, proofPhotoUrls, verifierId: req.user.id })
        );
        hasil.push({ orderId, ok: true, ...r });
      } catch (e) {
        hasil.push({ orderId, ok: false, error: e.message });
      }
    }
    res.status(201).json({ berhasil: hasil.filter((h) => h.ok).length, gagal: hasil.filter((h) => !h.ok).length, hasil });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Minta bukti pembayaran ke Sales atas klaim Lunas: hanya penanda + audit, tidak mengubah status order maupun keuangan.
financePenerimaanRouter.post("/penerimaan/minta-bukti", requirePermission(P.PAYMENT_WRITE), async (req, res) => {
  try {
    const { orderId, catatan } = req.body;
    if (!orderId) throw err("Order wajib dipilih");
    res.status(201).json(await prisma.$transaction((tx) => mintaBukti(tx, { orderId, catatan, userId: req.user.id })));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Uang ternyata belum masuk (Tolak Klaim) — kembalikan status order.
financePenerimaanRouter.post("/penerimaan/tolak", requirePermission(P.PAYMENT_WRITE), async (req, res) => {
  try {
    const { orderId, reason } = req.body;
    if (!orderId) throw err("Order wajib dipilih");
    res.json(await prisma.$transaction((tx) => tolakLunas(tx, { orderId, reason, userId: req.user.id })));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// ── Klaim Lunas Sales (1 Okt 2026) — antrean + keputusan Finance. Sales mengajukan lewat /api/klaim-lunas; di sini Finance memilih Minta Bukti / Tolak / Verifikasi.
// Verifikasi membuat TEPAT SATU Payment resmi (bukti klaim menjadi bukti Payment) lewat jalur verifikasiPenerimaan; status order dihitung dari ledger.
function galatKlaim(e, res) {
  if (e instanceof KlaimError || e instanceof BerkasError) {
    return res.status(e.statusCode).json({ error: e.message, ...(e.code && { code: e.code }), ...(e.kekurangan && { kekurangan: e.kekurangan }) });
  }
  return handleFinanceError(e, res);
}

financePenerimaanRouter.get("/penerimaan/klaim-lunas", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const semua = String(req.query.status || "") === "SEMUA";
    res.json(await daftarKlaimFinance(prisma, semua ? { status: ["SUBMITTED", "EVIDENCE_REQUESTED", "REJECTED", "VERIFIED"], take: 300 } : {}));
  } catch (e) { galatKlaim(e, res); }
});

financePenerimaanRouter.get("/penerimaan/klaim-lunas/ringkasan", requirePermission(P.FINANCE_READ), async (req, res) => {
  try { res.json(await ringkasKlaimMenunggu(prisma)); } catch (e) { galatKlaim(e, res); }
});

financePenerimaanRouter.get("/penerimaan/klaim-lunas/:id", requirePermission(P.FINANCE_READ), async (req, res) => {
  try { res.json(await detailKlaimFinance(prisma, req.params.id)); } catch (e) { galatKlaim(e, res); }
});

financePenerimaanRouter.post("/penerimaan/klaim-lunas/:id/minta-bukti", requirePermission(P.PAYMENT_WRITE), async (req, res) => {
  try {
    res.status(201).json(await prisma.$transaction((tx) => mintaBuktiKlaim(tx, { claimId: req.params.id, alasan: req.body?.alasan, versi: req.body?.versi, userId: req.user.id }), { maxWait: 15_000, timeout: 60_000 }));
  } catch (e) { galatKlaim(e, res); }
});

financePenerimaanRouter.post("/penerimaan/klaim-lunas/:id/tolak", requirePermission(P.PAYMENT_WRITE), async (req, res) => {
  try {
    res.json(await prisma.$transaction((tx) => tolakKlaim(tx, { claimId: req.params.id, alasan: req.body?.alasan, versi: req.body?.versi, userId: req.user.id }), { maxWait: 15_000, timeout: 60_000 }));
  } catch (e) { galatKlaim(e, res); }
});

financePenerimaanRouter.post("/penerimaan/klaim-lunas/:id/verifikasi", requirePermission(P.PAYMENT_WRITE), async (req, res) => {
  try {
    const { cashAccountId, date, amount, method, versi } = req.body || {};
    res.status(201).json(await prisma.$transaction(
      (tx) => verifikasiKlaim(tx, { claimId: req.params.id, verifierId: req.user.id, cashAccountId, date, amount, method, versi }),
      { maxWait: 15_000, timeout: 60_000 },
    ));
  } catch (e) { galatKlaim(e, res); }
});

// ── Resi Gabungan Fase 3A (flag RESI_PEMBAYARAN_AKTIF; 403 bila mati) ─────────────────────────────────────────────────────────────────────────────
// Pratinjau alokasi SEBELUM verifikasi (BACA-SAJA). Server menghitung; verifikasi menghitung ULANG di bawah kunci dan tidak memakai angka klien.
// Detail satu Resi (BACA-SAJA): total, ongkir tambahan, child, sisa, klaim, pembayaran tercatat (rekening + bukti bertanda tangan).
financePenerimaanRouter.get("/penerimaan/resi/:groupId", requirePermission(P.PAYMENT_READ), async (req, res) => {
  try {
    res.json(await detailKlaimResi(prisma, { groupId: req.params.groupId }));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financePenerimaanRouter.get("/penerimaan/resi/:groupId/pratinjau", requirePermission(P.PAYMENT_READ), async (req, res) => {
  try {
    res.json(await pratinjauVerifikasiResi(prisma, { groupId: req.params.groupId, amount: req.query.amount ?? null }));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Verifikasi SATU Resi: satu Payment anchor + alokasi otomatis ke child + jurnal per child. Idempotency-Key WAJIB. Field `alokasi` dari klien DIABAIKAN.
financePenerimaanRouter.post("/penerimaan/resi/:groupId/verifikasi", requirePermission(P.PAYMENT_WRITE), wajibIdempotencyKey, async (req, res) => {
  try {
    const { mode, method, cashAccountId, date, amount, proofPhotoUrl, versi } = req.body || {};
    cekBukti(proofPhotoUrl);
    const hasil = await prisma.$transaction(
      (tx) => verifikasiPenerimaanResi(tx, { groupId: req.params.groupId, mode, method, cashAccountId, date, amount, proofPhotoUrl, versi, verifierId: req.user.id }),
      { maxWait: 15_000, timeout: 60_000 },
    );
    res.status(201).json(hasil);
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financePenerimaanRouter.post("/penerimaan/resi/:groupId/minta-bukti", requirePermission(P.PAYMENT_WRITE), async (req, res) => {
  try {
    res.status(201).json(await prisma.$transaction((tx) => mintaBuktiResi(tx, { groupId: req.params.groupId, catatan: req.body?.catatan, userId: req.user.id })));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financePenerimaanRouter.post("/penerimaan/resi/:groupId/tolak", requirePermission(P.PAYMENT_WRITE), async (req, res) => {
  try {
    res.json(await prisma.$transaction((tx) => tolakLunasResi(tx, { groupId: req.params.groupId, reason: req.body?.reason, userId: req.user.id })));
  } catch (e) {
    handleFinanceError(e, res);
  }
});
