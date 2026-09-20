// AKSES FOTO NOTA/BUKTI FINANCE — tidak lagi publik-by-URL.
//
// Sebelumnya /media/finance-receipts/* disajikan express.static tanpa
// otorisasi apa pun. Sekarang setiap permintaan file harus salah satu dari:
//   1. Header `Authorization: Bearer …` (web/mobile) + izin finance, atau
//   2. URL bertanda-tangan berumur pendek (`?exp=…&sig=…`) — dipakai <img src>
//      di web yang tidak bisa mengirim header. Dibuat lewat
//      POST /api/finance/media/sign oleh pengguna yang berhak.
//
// Path lama /media/finance-receipts/<file> DIPERTAHANKAN (nilai receiptUrl di
// database tidak berubah), hanya kini terlindungi. Alias untuk klien native:
// GET /api/finance/media/receipts/<file>.
//
// Izin: FINANCE_READ melihat semua. Pemegang FINANCE_EXPENSE_SUBMIT saja hanya
// melihat foto pada dokumen pengeluaran/pembelian milik/ajuannya sendiri.

import express from "express";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db.js";
import { requireAuth, authenticateBearer } from "../middleware/auth.js";
import { hasPermission } from "../middleware/authorize.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { fileURLToPath } from "node:url";
import { RECEIPTS_DIR, RECEIPTS_URL_PREFIX } from "../services/finance/receipts.js";
import { FILE_PATTERN, MEDIA_SIGN_TTL_SECONDS, signFile, verifyFileSignature } from "../lib/mediaSigning.js";
import { createLimiter } from "../lib/rateLimit.js";

/** Nama file utama dari nama thumbnail (`abc_t.jpg` → `abc.jpg`). */
function fileUtama(file) {
  return file.replace(/_t\.jpg$/, ".jpg");
}

/** Boleh melihat foto ini? */
export async function bolehLihatBukti(user, file) {
  if (!user) return false;
  if (hasPermission(user, P.FINANCE_READ)) return true;
  if (hasPermission(user, P.FINANCE_EXPENSE_SUBMIT)) {
    const url = `${RECEIPTS_URL_PREFIX}/${fileUtama(file)}`;
    const milik = { receiptUrl: url, OR: [{ createdById: user.id }, { reimburseToId: user.id }] };
    const [e, p] = await Promise.all([
      prisma.finExpense.findFirst({ where: milik, select: { id: true } }),
      prisma.finPurchase.findFirst({ where: milik, select: { id: true } }),
    ]);
    return !!(e || p);
  }
  return false;
}

function fileDariUrl(url) {
  const s = String(url || "").split("?")[0];
  if (!s.startsWith(`${RECEIPTS_URL_PREFIX}/`)) return null;
  const file = s.slice(RECEIPTS_URL_PREFIX.length + 1);
  return FILE_PATTERN.test(file) ? file : null;
}

async function kirimFile(req, res) {
  const file = req.params.file;
  if (!FILE_PATTERN.test(file)) return res.status(404).json({ error: "Foto tidak ditemukan" });

  if (req.query.sig) {
    if (!verifyFileSignature(file, req.query.exp, req.query.sig)) {
      return res.status(403).json({ error: "Tautan foto tidak valid atau sudah kedaluwarsa" });
    }
  } else {
    const user = await authenticateBearer(req);
    if (!user) return res.status(401).json({ error: "Belum login" });
    if (!(await bolehLihatBukti(user, file))) {
      return res.status(403).json({ error: "Anda tidak punya akses untuk melihat foto ini" });
    }
  }

  const abs = path.join(RECEIPTS_DIR, file);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: "Foto tidak ditemukan" });

  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // private: jangan disimpan cache bersama (proxy/CDN); boleh di cache browser sebentar.
  res.setHeader("Cache-Control", "private, max-age=300");
  fs.createReadStream(abs).on("error", () => res.destroy()).pipe(res);
}

const handler = (req, res) => {
  kirimFile(req, res).catch((err) => {
    console.error("[financeMedia]", err);
    if (!res.headersSent) res.status(500).json({ error: "Terjadi kesalahan di server" });
  });
};

// Path lama (di-mount di /media/finance-receipts pada index.js).
export const financeReceiptsLegacyPathRouter = express.Router();
financeReceiptsLegacyPathRouter.get("/:file", handler);

// ── Bukti pembayaran pelanggan (/media/payment-proofs, diunggah sales/driver) ─────────────────────────────
// File statis publik /media/payment-proofs DIPERTAHANKAN untuk web CRM (belum dimigrasi). Untuk klien native tersedia jalur
// terlindungi: Bearer + izin FINANCE_READ ATAU URL bertanda-tangan (exp/sig, 10 menit).
const PAYMENT_PROOFS_DIR = process.env.PAYMENT_PROOFS_DIR
  || path.join(path.dirname(fileURLToPath(import.meta.url)), "../../data/payment-proofs");
const NAMA_BUKTI = /^[A-Za-z0-9._-]{3,200}$/;
const TIPE_BUKTI = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf" };

async function kirimBuktiPembayaran(req, res) {
  const file = req.params.file;
  const tipe = TIPE_BUKTI[path.extname(file).toLowerCase()];
  if (!NAMA_BUKTI.test(file) || file.includes("..") || !tipe) return res.status(404).json({ error: "Bukti tidak ditemukan" });

  if (req.query.sig) {
    if (!verifyFileSignature(file, req.query.exp, req.query.sig)) {
      return res.status(403).json({ error: "Tautan bukti tidak valid atau sudah kedaluwarsa" });
    }
  } else {
    const user = await authenticateBearer(req);
    if (!user) return res.status(401).json({ error: "Belum login" });
    // FINANCE_READ, bukan PAYMENT_READ: SALES memegang PAYMENT_READ tetapi bukan tim Finance.
    if (!hasPermission(user, P.FINANCE_READ)) {
      return res.status(403).json({ error: "Anda tidak punya akses untuk melihat bukti ini" });
    }
  }
  const abs = path.join(PAYMENT_PROOFS_DIR, file);
  if (!abs.startsWith(path.resolve(PAYMENT_PROOFS_DIR)) || !fs.existsSync(abs)) return res.status(404).json({ error: "Bukti tidak ditemukan" });
  res.setHeader("Content-Type", tipe);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=300");
  fs.createReadStream(abs).on("error", () => res.destroy()).pipe(res);
}

// Jalur publik bertanda-tangan (di luar /api, seperti /media/finance-receipts): router-router finance memasang requireAuth
// global pada /api/finance sehingga URL bertanda-tangan tanpa Bearer TIDAK bisa hidup di bawah prefix itu.
export const financePaymentProofsPathRouter = express.Router();
financePaymentProofsPathRouter.get("/:file", (req, res) => {
  kirimBuktiPembayaran(req, res).catch((err) => {
    console.error("[financeMedia] bukti-pembayaran:", err);
    if (!res.headersSent) res.status(500).json({ error: "Terjadi kesalahan di server" });
  });
});

// Router di bawah /api/finance.
export const financeMediaRouter = express.Router();

financeMediaRouter.get("/media/payment-proofs/:file", (req, res) => {
  kirimBuktiPembayaran(req, res).catch((err) => {
    console.error("[financeMedia] payment-proofs:", err);
    if (!res.headersSent) res.status(500).json({ error: "Terjadi kesalahan di server" });
  });
});

financeMediaRouter.get("/media/receipts/:file", handler);

const signLimiter = createLimiter({
  windowMs: 60_000,
  max: 60,
  keyFn: (req) => (req.user?.id ? `media-sign:${req.user.id}` : null),
  message: "Terlalu banyak permintaan. Coba lagi sebentar lagi.",
});

// Minta URL bertanda-tangan untuk daftar foto (dipakai web untuk <img>).
financeMediaRouter.post("/media/sign", requireAuth, signLimiter, async (req, res) => {
  try {
    const urls = Array.isArray(req.body?.urls) ? req.body.urls : null;
    if (!urls) return res.status(400).json({ error: "urls wajib berupa daftar" });
    if (urls.length > 60) return res.status(400).json({ error: "Maksimal 60 foto per permintaan" });

    const expiresAt = new Date(Date.now() + MEDIA_SIGN_TTL_SECONDS * 1000).toISOString();
    const signed = {};
    for (const url of urls) {
      const file = fileDariUrl(url);
      if (!file) continue;
      if (!(await bolehLihatBukti(req.user, file))) continue;
      const thumb = file.replace(/\.jpg$/, "_t.jpg");
      const a = signFile(file);
      const b = signFile(thumb);
      signed[url] = {
        url: `${RECEIPTS_URL_PREFIX}/${file}?exp=${a.exp}&sig=${a.sig}`,
        thumbUrl: `${RECEIPTS_URL_PREFIX}/${thumb}?exp=${b.exp}&sig=${b.sig}`,
        expiresAt,
      };
    }
    res.json({ signed });
  } catch (err) {
    console.error("[financeMedia] sign:", err);
    res.status(500).json({ error: "Terjadi kesalahan di server" });
  }
});
