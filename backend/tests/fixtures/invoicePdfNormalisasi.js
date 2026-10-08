import crypto from "node:crypto";
/** PDF → teks stabil: buang tanggal dibuat (objek "(D:…Z)" dan /CreationDate) dan /ID (acak per render); konten halaman, font, dan gambar deterministik. */
export const normalisasiPdf = (buf) => buf.toString("latin1")
  .replace(/\(D:\d{14}Z?\)/g, "(D:X)").replace(/\/CreationDate \(D:[^)]*\)/g, "").replace(/\/ID \[[^\]]*\]/g, "");
export const hashPdf = (buf) => crypto.createHash("sha256").update(normalisasiPdf(buf), "latin1").digest("hex");
