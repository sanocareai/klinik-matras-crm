// KLAIM LUNAS SALES — logika murni (tanpa React) supaya bisa dites. Cermin dari aturan server (backend/src/services/finance/klaimLunas.js,
// kekuranganKlaim): UI hanya MEMBANTU — penegak sebenarnya tetap server, yang menolak pengajuan tidak lengkap walau UI dilewati.

export const METODE_KLAIM = Object.freeze([
  { value: "TRANSFER", label: "Transfer" },
  { value: "QRIS", label: "QRIS" },
  { value: "CASH", label: "Tunai" },
  { value: "CARD", label: "Kartu" },
]);

export const STATUS_KLAIM_LABEL = Object.freeze({
  DRAFT: "Draft (belum diajukan)",
  SUBMITTED: "Menunggu verifikasi Finance",
  EVIDENCE_REQUESTED: "Finance meminta bukti tambahan",
  REJECTED: "Ditolak Finance",
  VERIFIED: "Terverifikasi",
  CANCELLED: "Ditarik",
});

/** Status klaim yang masih boleh diisi Sales (sebelum diajukan / setelah diminta lengkapi / ditolak). */
export const STATUS_BISA_DIEDIT = Object.freeze(["DRAFT", "EVIDENCE_REQUESTED", "REJECTED"]);

export const MAKS_BUKTI = 10;
export const MAKS_UKURAN_MB = 8;
export const TIPE_BUKTI_DITERIMA = "image/jpeg,image/png,image/webp,application/pdf";

/** Sales tidak melihat opsi "Lunas" di dropdown status bayar (server juga menolaknya); Admin tetap. Nilai aktif yang sudah Lunas tetap tampil. */
export function opsiStatusBayar(semuaStatus, nilaiSekarang, isAdmin) {
  if (isAdmin) return semuaStatus;
  return semuaStatus.filter((s) => s !== "LUNAS" || nilaiSekarang === "LUNAS");
}

/**
 * Kekurangan isian klaim. `bukti` = daftar { status: "mengunggah" | "tersimpan" | "gagal" }. Mengembalikan daftar { field, pesan }.
 * Bukti dihitung SAH hanya yang statusnya "tersimpan" (server sudah mengonfirmasi berkas tersimpan) — bukan yang masih diunggah / gagal.
 */
export function kekuranganForm(form, bukti = []) {
  const k = [];
  const nominal = Number(form?.amount);
  if (!form?.paymentDate) k.push({ field: "paymentDate", pesan: "Tanggal pembayaran wajib diisi" });
  if (!Number.isInteger(nominal) || nominal <= 0) k.push({ field: "amount", pesan: "Nominal yang diklaim wajib diisi" });
  if (!form?.method) k.push({ field: "method", pesan: "Metode pembayaran wajib dipilih" });
  if (form?.method === "TRANSFER" && !form?.cashAccountId) k.push({ field: "cashAccountId", pesan: "Rekening tujuan wajib dipilih untuk pembayaran Transfer" });
  if (!form?.note || form.note.trim().length < 3) k.push({ field: "note", pesan: "Catatan pembayaran wajib diisi" });
  if (!bukti.some((b) => b.status === "tersimpan")) k.push({ field: "evidence", pesan: "Unggah minimal satu Bukti Pembayaran" });
  return k;
}

/** Tombol "Ajukan Klaim Lunas" aktif HANYA bila isian lengkap, tidak ada unggahan yang masih berjalan, dan tidak sedang mengirim. */
export function bisaDiajukan(form, bukti = [], { mengirim = false } = {}) {
  if (mengirim) return false;
  if (bukti.some((b) => b.status === "mengunggah")) return false;
  return kekuranganForm(form, bukti).length === 0;
}

/** Alasan singkat mengapa tombol nonaktif (untuk teks bantu di bawah tombol). null = aktif. */
export function alasanNonaktif(form, bukti = [], { mengirim = false } = {}) {
  if (mengirim) return "Sedang mengirim…";
  if (bukti.some((b) => b.status === "mengunggah")) return "Menunggu unggahan bukti selesai…";
  const k = kekuranganForm(form, bukti);
  return k.length ? k[0].pesan : null;
}

/** Berkas yang diizinkan diunggah (cermin batas server: JPG/PNG/WEBP/PDF, maks 8 MB). Mengembalikan pesan galat atau null. */
export function cekBerkas(file) {
  if (!file) return "Berkas tidak ditemukan";
  const ok = /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type || "") || /\.(jpe?g|png|webp|pdf)$/i.test(file.name || "");
  if (!ok) return "Jenis berkas tidak diizinkan. Gunakan foto (JPG, PNG, WEBP) atau PDF.";
  if (file.size > MAKS_UKURAN_MB * 1024 * 1024) return `Ukuran berkas maksimal ${MAKS_UKURAN_MB} MB`;
  return null;
}

/** Isi form dari klaim di server (atau default untuk klaim baru: tanggal hari ini WIB, nominal = sisa tagihan). */
export function formDariKlaim(klaim, { sisa = 0, hariIni } = {}) {
  return {
    paymentDate: klaim?.paymentDate || hariIni || "",
    amount: klaim?.amount != null ? String(klaim.amount) : sisa > 0 ? String(sisa) : "",
    method: klaim?.method || "TRANSFER",
    cashAccountId: klaim?.cashAccountId || "",
    note: klaim?.note || "",
  };
}

export const buktiDariKlaim = (klaim) => (klaim?.bukti || []).map((b) => ({ key: b.id, id: b.id, nama: b.nama, mime: b.mime, url: b.url, status: "tersimpan" }));

export function hariIniWIB(now = Date.now()) {
  return new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
