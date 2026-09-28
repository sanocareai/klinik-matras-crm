// RESI GABUNGAN — Fase 1 ("Buat Resi"). Feature flag server-side: RESI_INPUT_AKTIF (fin_settings), DEFAULT MATI → POST menolak 403.
import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, requireAnyPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { idempotency, wajibIdempotencyKey } from "../middleware/idempotency.js";
import { resiAktif, buatResi, ResiError, DP_PERSEN, MAKS_ITEM_RESI } from "../services/resi.js";
import { resiPembayaranAktif, pratinjauPembayaranResi, catatPembayaranResi, klaimLunasResi, ringkasanPembayaranResi, ResiBayarError } from "../services/resiPembayaran.js";
import { resiPembatalanAktif, pratinjauPembatalanResi, batalkanChildResi } from "../services/resiPembatalan.js";

export const resiRouter = express.Router();
resiRouter.use(requireAuth);

// Klien bertanya apakah UI "Buat Resi" boleh tampil. Keputusan sebenarnya tetap di POST (server menolak bila mati).
resiRouter.get("/status", async (req, res) => {
  try {
    res.json({ aktif: await resiAktif(), pembayaranAktif: await resiPembayaranAktif(), pembatalanAktif: await resiPembatalanAktif(), dpPersen: DP_PERSEN, maksItem: MAKS_ITEM_RESI });
  } catch (err) {
    res.status(500).json({ error: "Gagal membaca status Resi Gabungan" });
  }
});

resiRouter.post("/", requirePermission(P.ORDER_WRITE), async (req, res) => {
  try {
    const { customerId } = req.body || {};
    if (!customerId) return res.status(400).json({ error: "Customer wajib dipilih" });
    const hasil = await buatResi(String(customerId), req.body, req.user?.id);
    res.status(201).json(hasil);
  } catch (err) {
    if (err instanceof ResiError) return res.status(err.statusCode).json({ error: err.message });
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error("[resi] gagal membuat resi:", err);
    res.status(500).json({ error: "Resi gagal dibuat, tidak ada order yang tersimpan. Coba lagi." });
  }
});

// ── Fase 3A: pembayaran/DP Resi (flag RESI_PEMBAYARAN_AKTIF, DEFAULT MATI; semua endpoint menolak 403 bila mati) ─────────────────────────────────────
function galatBayar(res, err, konteks) {
  if (err instanceof ResiBayarError || err?.statusCode) return res.status(err.statusCode || 400).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  console.error(`[resi] ${konteks}:`, err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

// Pratinjau alokasi (BACA-SAJA) — Sales/Finance. Server menghitung; penulisan menghitung ULANG di bawah kunci.
resiRouter.get("/:groupId/pembayaran/pratinjau", requireAnyPermission(P.ORDER_WRITE, P.PAYMENT_READ), async (req, res) => {
  try {
    res.json(await pratinjauPembayaranResi(prisma, { groupId: req.params.groupId, tipe: String(req.query.tipe || "TAGIHAN").toUpperCase(), nominal: req.query.nominal ?? null }));
  } catch (err) {
    galatBayar(res, err, "pratinjau pembayaran");
  }
});

// Catat pembayaran/DP Resi: SATU Payment anchor + alokasi otomatis ke child. Idempotency-Key WAJIB. Field `alokasi` dari klien DIABAIKAN.
resiRouter.post("/:groupId/pembayaran", requirePermission(P.ORDER_WRITE), wajibIdempotencyKey, idempotency, async (req, res) => {
  try {
    const { tipe = "TAGIHAN", nominal = null, method, cashAccountId = null, proofPhotoUrl = null } = req.body || {};
    const hasil = await catatPembayaranResi(prisma, { groupId: req.params.groupId, userId: req.user.id, tipe: String(tipe).toUpperCase(), nominal, method, cashAccountId, proofPhotoUrl });
    res.status(201).json(hasil);
  } catch (err) {
    galatBayar(res, err, "catat pembayaran");
  }
});

// Klaim Lunas Sales SEKALI di level Resi (semua child aktif). Tidak membuat Payment/jurnal; Finance memverifikasinya lewat satu antrean Resi.
resiRouter.post("/:groupId/klaim-lunas", requirePermission(P.ORDER_WRITE), wajibIdempotencyKey, idempotency, async (req, res) => {
  try {
    res.status(201).json(await klaimLunasResi(prisma, { groupId: req.params.groupId, userId: req.user.id }));
  } catch (err) {
    galatBayar(res, err, "klaim lunas");
  }
});

// Ringkasan pembayaran SEMUA Resi BARU milik satu customer (kartu Resi di profil — BACA-SAJA): total, ongkir tambahan, child, sisa, klaim.
// Flag mati → { aktif: false } dan UI menyembunyikan seluruh fitur. Group BACKFILL_BUNDLE tidak ikut.
resiRouter.get("/pelanggan/:customerId/pembayaran", requireAnyPermission(P.ORDER_READ, P.PAYMENT_READ), async (req, res) => {
  try {
    if (!(await resiPembayaranAktif())) return res.json({ aktif: false, resi: [] });
    const grup = await prisma.orderGroup.findMany({ where: { customerId: req.params.customerId, source: "BARU" }, orderBy: { createdAt: "desc" }, select: { id: true }, take: 50 });
    const resi = [];
    for (const g of grup) {
      try {
        resi.push(await ringkasanPembayaranResi(prisma, { groupId: g.id }));
      } catch (e) {
        if (!(e instanceof ResiBayarError)) throw e;
        resi.push({ aktif: true, layak: false, groupId: g.id, alasan: e.message, code: e.code ?? null });
      }
    }
    res.json({ aktif: true, resi });
  } catch (err) {
    galatBayar(res, err, "ringkasan pembayaran pelanggan");
  }
});

// Ringkasan pembayaran Resi untuk SATU order (tab Pembayaran di detail order child Resi — BACA-SAJA). Order tanpa Resi BARU / flag mati → aktif:false
// atau layak:false, dan UI menampilkan tab lama apa adanya.
resiRouter.get("/order/:orderId/pembayaran", requireAnyPermission(P.ORDER_READ, P.PAYMENT_READ), async (req, res) => {
  try {
    if (!(await resiPembayaranAktif())) return res.json({ aktif: false });
    const o = await prisma.order.findUnique({ where: { id: req.params.orderId }, select: { groupId: true, group: { select: { source: true } } } });
    if (!o?.groupId || o.group?.source !== "BARU") return res.json({ aktif: true, layak: false });
    const r = await ringkasanPembayaranResi(prisma, { groupId: o.groupId });
    res.json({ ...r, untukOrder: r.anak?.find((a) => a.orderId === req.params.orderId) ?? null });
  } catch (err) {
    galatBayar(res, err, "ringkasan pembayaran order");
  }
});

// ── Fase 3B: batalkan SATU child dari Resi (flag RESI_PEMBATALAN_AKTIF, DEFAULT MATI; menolak 403 bila mati) ──────────────────────────────────────
// Jalur BARU dan TERPISAH dari tombol "Batalkan Order"/dropdown status lama — lihat services/resiPembatalan.js. Permission: Finance/Admin/Owner
// (P.FINANCE_READ/FINANCE_POST — sama dengan gate refund manual yang sudah ada), BUKAN P.ORDER_WRITE (aksi ini memindahkan uang & bikin refund).

// Pratinjau dampak (BACA-SAJA): child yang dibatalkan, realokasi, kelebihan/refund, anchor baru, ongkir, total & DP baru, status tiap child.
resiRouter.get("/anak/:orderId/pembatalan/pratinjau", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    res.json(await pratinjauPembatalanResi(prisma, { orderId: req.params.orderId }));
  } catch (err) {
    galatBayar(res, err, "pratinjau pembatalan item Resi");
  }
});

// Konfirmasi pembatalan: realokasi + refund (bila ada kelebihan) + anchor/ongkir/invoice + DP target, satu transaksi. Idempotency-Key WAJIB.
resiRouter.post("/anak/:orderId/pembatalan", requirePermission(P.FINANCE_POST), wajibIdempotencyKey, idempotency, async (req, res) => {
  try {
    const { alasan, refundCashAccountId = null, versi = null } = req.body || {};
    const hasil = await batalkanChildResi(prisma, { orderId: req.params.orderId, userId: req.user.id, alasan, refundCashAccountId, versi });
    res.status(201).json(hasil);
  } catch (err) {
    galatBayar(res, err, "batalkan item Resi");
  }
});
