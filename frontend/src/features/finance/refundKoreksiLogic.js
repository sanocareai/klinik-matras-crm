// Logika murni dialog Koreksi Refund (bukti transfer + biaya admin). TIDAK ada kalkulasi uang di sini selain penjumlahan tampilan
// "Nominal refund + Biaya admin = Total keluar" — angka resmi (biaya preset, jurnal, saldo) selalu dari server (pratinjau/simpan).
import { bodyBiayaTransfer } from "./biayaTransfer.js";

export const MAKS_BYTE = 8 * 1024 * 1024;
export const MAKS_BUKTI = 10;
export const TIPE_BERKAS = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const EKSTENSI_BERKAS = ["jpg", "jpeg", "png", "webp", "pdf"];

export const MODE_BUKTI = [
  { kode: "LAMA", label: "Gunakan bukti lama", bantu: "Dokumen pengganti memakai bukti yang sama dengan dokumen lama." },
  { kode: "TAMBAH", label: "Tambah bukti baru", bantu: "Bukti lama tetap dipakai, ditambah bukti baru." },
  { kode: "GANTI", label: "Ganti bukti pada dokumen pengganti", bantu: "Dokumen pengganti hanya memakai bukti baru. Bukti lama tetap tersimpan di dokumen lama." },
];

export const formatUkuran = (byte) => {
  const n = Number(byte) || 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
};

/** Pemeriksaan DINI di browser (hemat unggahan sia-sia). Server tetap yang menentukan: tipe dibaca dari ISI berkas, bukan dari label ini. */
export function periksaBerkas(file) {
  if (!file) return { ok: false, pesan: "Berkas tidak ditemukan" };
  if (file.size > MAKS_BYTE) return { ok: false, pesan: `Ukuran ${formatUkuran(file.size)} melebihi batas 8 MB` };
  if (file.size === 0) return { ok: false, pesan: "Berkas kosong" };
  const ekstensi = String(file.name || "").split(".").pop().toLowerCase();
  const tipeOk = TIPE_BERKAS.includes(file.type) || (!file.type && EKSTENSI_BERKAS.includes(ekstensi));
  if (!tipeOk) return { ok: false, pesan: "Jenis berkas tidak diizinkan. Gunakan JPG, PNG, WEBP, atau PDF." };
  return { ok: true, pesan: "" };
}

/** Berkas dari kejadian paste (Ctrl+V): gambar tangkapan layar/salinan file. Nama dibuat bila browser tidak memberi. */
export function berkasDariPaste(event) {
  const items = Array.from(event?.clipboardData?.items || []);
  const berkas = [];
  for (const it of items) {
    if (it.kind !== "file") continue;
    const f = it.getAsFile?.();
    if (!f) continue;
    if (f.name) { berkas.push(f); continue; }
    const ext = (f.type.split("/")[1] || "png").replace("jpeg", "jpg");
    berkas.push(new File([f], `tempel-${Date.now()}-${berkas.length + 1}.${ext}`, { type: f.type }));
  }
  return berkas;
}

/** Jumlah bukti yang akan dimiliki dokumen pengganti. */
export function jumlahBuktiPengganti({ jumlahLama, mode, jumlahBaru }) {
  return (mode === "GANTI" ? 0 : jumlahLama) + (mode === "LAMA" ? 0 : jumlahBaru);
}

/** Kesiapan bukti: dokumen pengganti WAJIB punya minimal satu bukti; mode tambah/ganti wajib punya bukti baru. */
export function kesiapanBukti({ jumlahLama, mode, jumlahBaru, sedangUnggah = false }) {
  if (sedangUnggah) return { siap: false, pesan: "Tunggu unggahan bukti selesai." };
  if (mode !== "LAMA" && jumlahBaru < 1) return { siap: false, pesan: mode === "GANTI" ? "Unggah minimal satu bukti baru." : "Unggah minimal satu bukti baru untuk ditambahkan." };
  const total = jumlahBuktiPengganti({ jumlahLama, mode, jumlahBaru });
  if (total < 1) return { siap: false, pesan: "Dokumen pengganti wajib punya minimal satu bukti transfer." };
  if (total > MAKS_BUKTI) return { siap: false, pesan: `Maksimal ${MAKS_BUKTI} bukti per dokumen.` };
  return { siap: true, pesan: "" };
}

/** Mode bawaan: pakai bukti lama bila ada; bila tidak ada, wajib unggah (GANTI). */
export const modeBawaan = (jumlahLama) => (jumlahLama > 0 ? "LAMA" : "GANTI");

/** Nilai awal form dari dokumen refund (hanya kolom yang boleh dikoreksi). */
export function nilaiAwalRefund(refund) {
  return {
    amount: Number(refund?.amount) || 0,
    date: String(refund?.date || "").slice(0, 10),
    cashAccountId: refund?.cashAccountId || "",
    paymentMethod: refund?.paymentMethod || "TUNAI",
    transferFeeType: refund?.transferFeeType || "",
    transferFeeAmount: refund?.transferFeeType === "LAINNYA" ? Number(refund?.transferFeeAmount) || 0 : "",
    transferReference: refund?.transferReference || "",
  };
}

const biayaSama = (a, b) => (a.paymentMethod || "") === (b.paymentMethod || "")
  && (a.paymentMethod !== "TRANSFER" || ((a.transferFeeType || "") === (b.transferFeeType || "") && (a.transferFeeType !== "LAINNYA" || Number(a.transferFeeAmount) === Number(b.transferFeeAmount))));

/** Ada perubahan data dokumen (bukan hanya bukti)? Server menolak koreksi tanpa perubahan data. */
export function adaPerubahanRefund(awal, form) {
  return Number(awal.amount) !== Number(form.amount) || awal.date !== form.date || awal.cashAccountId !== form.cashAccountId
    || !biayaSama(awal, form) || String(awal.transferReference || "").trim() !== String(form.transferReference || "").trim();
}

/** Body koreksi: hanya kolom yang berubah + bukti + revisi optimistis + alasan. */
export function bodyKoreksiRefund({ awal, form, alasan, mode, idsBaru = [], expectedUpdatedAt, konfirmasiBiayaGanda = false, preview = false }) {
  const body = { reason: String(alasan || "").trim(), bukti: { mode, ids: mode === "LAMA" ? [] : idsBaru }, expectedUpdatedAt };
  if (Number(awal.amount) !== Number(form.amount)) body.amount = Number(form.amount);
  if (awal.date !== form.date) body.date = form.date;
  if (awal.cashAccountId !== form.cashAccountId) body.cashAccountId = form.cashAccountId;
  if (!biayaSama(awal, form) || awal.cashAccountId !== form.cashAccountId) Object.assign(body, bodyBiayaTransfer(form));
  if (String(awal.transferReference || "").trim() !== String(form.transferReference || "").trim()) body.transferReference = String(form.transferReference || "").trim();
  if (konfirmasiBiayaGanda) body.konfirmasiBiayaGanda = true;
  if (preview) body.preview = true;
  return body;
}

/** Ringkasan tampilan: nominal pelanggan, biaya admin bank, total keluar rekening (Total = Nominal + Biaya; biaya TIDAK ikut nominal pelanggan). */
export function ringkasUangRefund({ nominal, biayaAdmin }) {
  const n = Number(nominal) || 0;
  const b = Number(biayaAdmin) || 0;
  return { nominalRefund: n, biayaAdmin: b, totalKeluar: n + b };
}

// ─── "Lampirkan Bukti" (tanpa koreksi) ───────────────────────────────────────
export const KALIMAT_LAMPIR = "Tindakan ini hanya melampirkan bukti. Tidak mengubah jurnal atau saldo.";
export const MIN_ALASAN_LAMPIR = 5;

/** Kesiapan: ≥1 bukti baru, tak ada unggahan berjalan, alasan ≥5 karakter, total bukti ≤ batas. */
export function kesiapanLampir({ jumlahSudah = 0, jumlahBaru = 0, sedangUnggah = false, alasan = "" }) {
  if (sedangUnggah) return { siap: false, pesan: "Tunggu unggahan bukti selesai." };
  if (jumlahBaru < 1) return { siap: false, pesan: "Unggah minimal satu bukti untuk dilampirkan." };
  if (jumlahSudah + jumlahBaru > MAKS_BUKTI) return { siap: false, pesan: `Maksimal ${MAKS_BUKTI} bukti per dokumen (sudah ada ${jumlahSudah}).` };
  if (String(alasan).trim().length < MIN_ALASAN_LAMPIR) return { siap: false, pesan: `Isi alasan minimal ${MIN_ALASAN_LAMPIR} karakter.` };
  return { siap: true, pesan: "" };
}

/** Body lampir: HANYA alasan + id bukti. Tidak membawa nominal/biaya/rekening/tanggal apa pun (server pun tidak menerimanya). */
export const bodyLampirBukti = ({ alasan, ids }) => ({ reason: String(alasan || "").trim(), bukti: { ids: [...ids] } });

/** Boleh dilampiri bukti: refund aktif (DISETUJUI) atau versi lama yang sudah digantikan koreksi. Cermin server (server tetap penentu). */
export const bisaLampirBukti = (refund) => refund?.status === "DISETUJUI" || (refund?.status === "DIBATALKAN" && Boolean(refund?.replacedBy?.refundNumber ?? refund?.replacedBy));
