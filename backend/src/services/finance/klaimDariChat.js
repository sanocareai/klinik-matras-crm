// KLAIM LUNAS DARI CHAT (2 Okt 2026) — jalan pintas: Sales menekan foto bukti transfer di Inbox → "Catat Pembayaran" → foto itu langsung menjadi Bukti
// Pembayaran pada draf klaim order pelanggan yang sama. TIDAK ada alur baru: seluruh aturan (gerbang, kepemilikan, bukti, pengajuan, verifikasi Finance)
// tetap di services/finance/klaimLunas.js. File ini hanya MENYAMBUNGKAN pesan chat → berkas bukti → buatDraft + lampirkanBukti.
//
// Aturan yang dijaga di sini:
//  1. Foto HARUS dari chat pelanggan pemilik order itu sendiri (pesan.conversation.customerId === order.customerId). Tanpa ini, id pesan orang lain bisa
//     dilampirkan sebagai bukti order yang tidak berhubungan.
//  2. Berkas dibaca dari folder unggahan chat dengan nama yang divalidasi ketat (tanpa path traversal), lalu disalin ke penyimpanan KLAIM lewat jalur yang sama
//     dengan unggahan biasa (simpanBerkas: tipe dari ISI berkas, nama acak, batas 8 MB). Berkas chat asli TIDAK diubah/dipindah.
//  3. Hanya foto/PDF. Stiker, video, audio, kontak, lokasi tidak bisa jadi bukti.
//  4. Nominal/jenis/rekening/catatan TIDAK diisi di sini — itu verifikasi Sales di dialog klaim. Hanya metode "Transfer" dan tanggal pesan yang disarankan
//     (bisa diubah Sales); server tetap menolak pengajuan yang tidak lengkap.
//  5. Idempoten: draf aktif dipakai ulang (buatDraft), bukti dengan isi identik tidak digandakan (lampirkanBukti).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buatDraft, lampirkanBukti, klaimUntukOrder, KlaimError } from "./klaimLunas.js";
import { simpanBerkas, hapusBerkasDisk, deteksiTipe, MAKS_UKURAN_BYTE } from "./klaimLunasBerkas.js";
import { tanggalWIB } from "./cutoff.js";

/** Folder unggahan chat (sama dengan routes/conversations.js → backend/uploads). */
export const UPLOADS_DIR = process.env.CHAT_UPLOADS_DIR
  || path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../uploads");

const POLA_NAMA_UPLOAD = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
const TIPE_BISA_JADI_BUKTI = new Set(["image", "document"]);

/** Nama berkas aman dari mediaUrl "/uploads/<nama>"; null bila bentuknya lain (URL luar, path bertingkat, "..", dsb). */
export function namaBerkasUpload(mediaUrl) {
  const m = /^\/uploads\/([^/?#]+)$/.exec(String(mediaUrl || ""));
  if (!m) return null;
  const nama = m[1];
  if (nama.includes("..") || !POLA_NAMA_UPLOAD.test(nama)) return null;
  return nama;
}

/** Pesan yang boleh jadi bukti: foto atau dokumen (PDF) yang berkasnya sudah tersimpan di server. */
export function bisaJadiBukti(pesan) {
  return !!pesan && TIPE_BISA_JADI_BUKTI.has(pesan.mediaType) && !!namaBerkasUpload(pesan.mediaUrl);
}

async function muatPesan(db, messageId) {
  const id = String(messageId || "");
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new KlaimError("Pesan tidak valid", 400, "PESAN_TIDAK_VALID");
  const pesan = await db.message.findUnique({
    where: { id },
    select: { id: true, mediaType: true, mediaUrl: true, createdAt: true, direction: true, conversation: { select: { customerId: true, type: true } } },
  });
  if (!pesan) throw new KlaimError("Pesan tidak ditemukan", 404, "PESAN_TIDAK_ADA");
  if (!pesan.conversation?.customerId) throw new KlaimError("Pesan ini bukan dari chat pelanggan (grup tidak didukung)", 400, "PESAN_BUKAN_CHAT_PELANGGAN");
  if (!bisaJadiBukti(pesan)) throw new KlaimError("Hanya foto atau PDF yang bisa dijadikan bukti pembayaran", 400, "PESAN_BUKAN_BUKTI");
  return pesan;
}

/**
 * Order milik pelanggan di chat itu yang relevan untuk dicatat pembayarannya — dipakai pemilih order di UI.
 * Setiap baris membawa `bolehDiklaim`/`alasanTidakBisa` dari klaimUntukOrder (aturan yang SAMA dengan panel klaim), jadi UI tidak menebak sendiri.
 */
export async function kandidatOrderDariPesan(db, { messageId, user }, deps = {}) {
  const ambilKlaim = deps.klaimUntukOrder || klaimUntukOrder;
  const pesan = await muatPesan(db, messageId);
  const order = await db.order.findMany({
    where: { customerId: pesan.conversation.customerId, status: { not: "CANCELLED" }, value: { gt: 0 } },
    orderBy: { createdAt: "desc" }, take: 8,
    select: { id: true, orderNumber: true, category: true, status: true, paymentStatus: true, value: true, createdAt: true },
  });
  const daftar = [];
  for (const o of order) {
    const info = await ambilKlaim(db, { orderId: o.id, user, lihatSemua: false });
    daftar.push({
      id: o.id, orderNumber: o.orderNumber, category: o.category, status: o.status, paymentStatus: o.paymentStatus, value: o.value, createdAt: o.createdAt,
      tagihan: info.tagihan, dibayar: info.dibayar, sisa: info.sisa,
      bolehDiklaim: info.bolehDiklaim, alasanTidakBisa: info.alasanTidakBisa, klaimAktifId: info.klaimAktifId,
    });
  }
  return { pesan: { id: pesan.id, tipe: pesan.mediaType, dibuat: pesan.createdAt }, order: daftar };
}

/**
 * Jadikan foto chat sebagai Bukti Pembayaran pada draf klaim `orderId` (draf dibuat bila belum ada).
 * Mengembalikan { klaimId, dibuatBaru, bukti, duplikat } — UI lalu membuka dialog klaim biasa, yang memuat draf + bukti ini dari server.
 */
export async function lampirkanDariPesan(db, { orderId, messageId, user }, deps = {}) {
  const d = {
    buatDraft, lampirkanBukti, simpanBerkas, hapusBerkasDisk, deteksiTipe, uploadsDir: UPLOADS_DIR, bacaBerkas: (p) => fs.readFileSync(p), ...deps,
  };
  const pesan = await muatPesan(db, messageId);
  const order = await db.order.findUnique({ where: { id: String(orderId) }, select: { id: true, customerId: true } });
  if (!order) throw new KlaimError("Order tidak ditemukan", 404, "ORDER_TIDAK_ADA");
  if (order.customerId !== pesan.conversation.customerId) {
    throw new KlaimError("Foto ini bukan dari chat pelanggan order tersebut", 403, "PESAN_BUKAN_MILIK_ORDER");
  }

  const nama = namaBerkasUpload(pesan.mediaUrl);
  let buffer;
  try { buffer = d.bacaBerkas(path.join(d.uploadsDir, nama)); } catch (e) {
    if (e?.code === "ENOENT") throw new KlaimError("File foto tidak ditemukan di server — minta pelanggan kirim ulang atau unggah manual", 404, "BERKAS_PESAN_TIDAK_ADA");
    throw e;
  }
  // Periksa SEBELUM membuat draf, supaya foto yang pasti ditolak (HEIC/terlalu besar) tidak meninggalkan draf kosong.
  if (buffer.length > MAKS_UKURAN_BYTE) throw new KlaimError(`Ukuran berkas maksimal ${MAKS_UKURAN_BYTE / 1024 / 1024} MB`, 413, "BERKAS_TERLALU_BESAR");
  if (!d.deteksiTipe(buffer)) throw new KlaimError("Jenis berkas tidak diizinkan. Gunakan foto (JPG, PNG, WEBP) atau PDF.", 415, "TIPE_TIDAK_DIIZINKAN");

  // Saran awal (hanya dipakai bila draf BARU dibuat; draf yang sudah ada tidak ditimpa): metode Transfer + tanggal pesan.
  const saran = { method: "TRANSFER", paymentDate: tanggalWIB(pesan.createdAt) };
  const { klaim, dibuatBaru } = await d.buatDraft(db, { orderId: order.id, user, data: saran });

  const tersimpan = d.simpanBerkas({ buffer, originalname: nama });
  let hasil;
  try {
    hasil = await d.lampirkanBukti(db, { claimId: klaim.id, user, berkas: tersimpan });
  } catch (e) {
    d.hapusBerkasDisk(tersimpan.storedName); // gagal mencatat → tidak meninggalkan berkas tanpa baris
    throw e;
  }
  if (hasil.duplikat) d.hapusBerkasDisk(tersimpan.storedName); // isi identik sudah ada pada klaim ini
  return { klaimId: klaim.id, dibuatBaru, bukti: hasil.bukti, duplikat: !!hasil.duplikat };
}
