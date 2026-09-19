// URL BERTANDA-TANGAN untuk foto nota/bukti finance.
//
// Foto nota tidak lagi disajikan sebagai file statis publik. Akses sah ada dua:
//   1. Header Authorization (klien native/fetch) + izin finance, atau
//   2. URL bertanda-tangan berumur pendek (untuk <img src> di web yang tidak
//      bisa mengirim header) — dibuat lewat POST /api/finance/media/sign.
//
// Tanda tangan = HMAC-SHA256(file + "." + exp) dengan kunci turunan. Kunci
// memakai MEDIA_SIGNING_SECRET bila diisi; bila tidak, diturunkan dari
// JWT_SECRET (tanpa env baru yang wajib) dengan label terpisah, sehingga
// tanda tangan media tidak bisa dipakai sebagai token login atau sebaliknya.

import { createHmac, timingSafeEqual } from "node:crypto";

export const MEDIA_SIGN_TTL_SECONDS = 10 * 60;
export const FILE_PATTERN = /^[a-f0-9]{40}(_t)?\.jpg$/;

function secret() {
  const s = process.env.MEDIA_SIGNING_SECRET || process.env.JWT_SECRET;
  if (!s) throw new Error("MEDIA_SIGNING_SECRET/JWT_SECRET belum diisi");
  return createHmac("sha256", s).update("finance-media-v1").digest();
}

function mac(file, exp) {
  return createHmac("sha256", secret()).update(`${file}.${exp}`).digest("hex");
}

/** Query string `exp=...&sig=...` untuk satu nama file (bukan URL penuh). */
export function signFile(file, { ttlSeconds = MEDIA_SIGN_TTL_SECONDS, now = Date.now() } = {}) {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  return { exp, sig: mac(file, exp) };
}

export function verifyFileSignature(file, exp, sig, { now = Date.now() } = {}) {
  const expNum = Number(exp);
  if (!file || !sig || !Number.isInteger(expNum)) return false;
  if (expNum < Math.floor(now / 1000)) return false;
  const expected = Buffer.from(mac(file, expNum), "hex");
  let given;
  try { given = Buffer.from(String(sig), "hex"); } catch { return false; }
  return given.length === expected.length && timingSafeEqual(given, expected);
}
