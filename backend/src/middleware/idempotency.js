// IDEMPOTENCY-KEY untuk command uang di /api/finance/*.
//
// Masalah nyata: koneksi HP putus setelah request terkirim → klien mencoba lagi
// → dokumen ganda (preseden: 22 pengeluaran ganda yang harus dibatalkan).
//
// Cara kerja (header `Idempotency-Key: <8–128 karakter>`):
//   • kunci baru               → request diproses normal; respons 2xx disimpan.
//   • kunci sama + isi sama    → respons pertama diputar ulang
//                                (header `Idempotent-Replayed: true`), TIDAK
//                                dieksekusi ulang.
//   • kunci sama + isi BEDA    → 422 (kunci dipakai untuk permintaan lain).
//   • kunci sama masih diproses → 409 (coba lagi sebentar).
//   • respons bukan 2xx        → kunci dilepas supaya klien boleh mencoba lagi.
//
// KOMPATIBEL WEB: header bersifat OPSIONAL untuk token web (tanpa header =
// perilaku lama persis). Untuk token MOBILE header WAJIB pada command uang
// (428 bila hilang) — klien native tidak boleh lupa.
//
// Berlaku untuk POST/PUT/PATCH/DELETE. Dikecualikan: unggah foto (multipart,
// sudah idempoten lewat nama = hash isi) dan penandatanganan URL media.
// Kunci dilingkupi per pengguna; masa berlaku 24 jam.

import { createHash } from "node:crypto";
import { prisma } from "../db.js";

const METODE_UBAH = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const POLA_KUNCI = /^[A-Za-z0-9_\-:.]{8,128}$/;
const TTL_MS = 24 * 3600 * 1000;
const PROCESSING_STALE_MS = 60_000;
const DIKECUALIKAN = [/\/receipts\/upload$/, /\/media\/sign$/];

function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
}

function requestHash(req) {
  const path = String(req.originalUrl || "").split("?")[0];
  const query = String(req.originalUrl || "").split("?")[1] || "";
  return createHash("sha256").update(`${req.method} ${path}?${query}\n${stableStringify(req.body ?? null)}`).digest("hex");
}

let terakhirBersih = 0;
async function bersihkanKedaluwarsa() {
  const now = Date.now();
  if (now - terakhirBersih < 10 * 60_000) return;
  terakhirBersih = now;
  try {
    await prisma.apiIdempotencyKey.deleteMany({ where: { createdAt: { lt: new Date(now - 2 * TTL_MS) } } });
  } catch (err) {
    console.warn("[idempotency] pembersihan gagal:", err.message);
  }
}

export async function idempotency(req, res, next) {
  if (!METODE_UBAH.has(req.method)) return next();
  if (req._idempotencyHandled) return next(); // beberapa router berbagi prefix /api/finance
  req._idempotencyHandled = true;

  const path = String(req.originalUrl || "").split("?")[0];
  if (DIKECUALIKAN.some((re) => re.test(path))) return next();

  const userId = req.user?.id;
  const key = req.headers["idempotency-key"];
  const isMobile = req.user?.typ === "mobile";

  if (!key) {
    if (isMobile) {
      return res.status(428).json({
        error: "Header Idempotency-Key wajib untuk perintah keuangan dari aplikasi mobile",
        code: "IDEMPOTENCY_KEY_REQUIRED",
      });
    }
    return next();
  }
  if (!userId) return next(); // requireAuth sudah menolak; jaga-jaga
  if (!POLA_KUNCI.test(String(key))) {
    return res.status(400).json({ error: "Idempotency-Key harus 8–128 karakter (huruf, angka, - _ : .)", code: "IDEMPOTENCY_KEY_INVALID" });
  }

  const hash = requestHash(req);
  try {
    let baris = null;
    for (let percobaan = 0; percobaan < 2 && !baris; percobaan++) {
      try {
        baris = await prisma.apiIdempotencyKey.create({
          data: { userId, key: String(key), method: req.method, path, requestHash: hash },
        });
        baris = { ...baris, baru: true };
      } catch (err) {
        if (err?.code !== "P2002") throw err;
        const ada = await prisma.apiIdempotencyKey.findUnique({ where: { userId_key: { userId, key: String(key) } } });
        if (!ada) continue; // dihapus di sela — coba buat lagi
        const umur = Date.now() - ada.createdAt.getTime();
        if (umur > TTL_MS) {
          await prisma.apiIdempotencyKey.deleteMany({ where: { id: ada.id } });
          continue;
        }
        if (ada.requestHash !== hash) {
          return res.status(422).json({
            error: "Idempotency-Key ini sudah dipakai untuk permintaan yang berbeda. Buat kunci baru untuk perintah baru.",
            code: "IDEMPOTENCY_KEY_REUSED",
          });
        }
        if (ada.state === "DONE") {
          res.setHeader("Idempotent-Replayed", "true");
          return res.status(ada.responseStatus || 200).json(ada.responseBody);
        }
        if (umur > PROCESSING_STALE_MS) {
          // Proses sebelumnya mati di tengah jalan — ambil alih.
          await prisma.apiIdempotencyKey.update({ where: { id: ada.id }, data: { createdAt: new Date() } });
          baris = { ...ada, baru: true };
        } else {
          res.setHeader("Retry-After", "2");
          return res.status(409).json({
            error: "Permintaan yang sama sedang diproses. Tunggu sebentar lalu cek hasilnya.",
            code: "IDEMPOTENCY_IN_PROGRESS",
          });
        }
      }
    }
    if (!baris) return next();

    // Tangkap respons untuk disimpan.
    let tertangkap;
    const jsonAsli = res.json.bind(res);
    res.json = (body) => { tertangkap = body; return jsonAsli(body); };

    res.on("finish", () => {
      const sukses = res.statusCode >= 200 && res.statusCode < 300;
      const tugas = sukses
        ? prisma.apiIdempotencyKey.update({
            where: { id: baris.id },
            data: {
              state: "DONE",
              responseStatus: res.statusCode,
              responseBody: tertangkap === undefined ? null : JSON.parse(JSON.stringify(tertangkap)),
              completedAt: new Date(),
            },
          })
        : prisma.apiIdempotencyKey.deleteMany({ where: { id: baris.id } });
      tugas.catch((err) => console.error("[idempotency] gagal menyimpan hasil:", err.message));
    });
    res.on("close", () => {
      // Koneksi putus sebelum respons selesai: lepas kunci bila belum DONE.
      if (!res.writableEnded) prisma.apiIdempotencyKey.deleteMany({ where: { id: baris.id, state: "PROCESSING" } }).catch(() => {});
    });

    bersihkanKedaluwarsa();
    next();
  } catch (err) {
    console.error("[idempotency] error:", err);
    return res.status(500).json({ error: "Terjadi kesalahan di server" });
  }
}
