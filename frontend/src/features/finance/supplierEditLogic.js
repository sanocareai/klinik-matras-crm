// Edit Master Supplier — logika murni (tanpa React) supaya bisa dites. Server (PATCH /finance/suppliers/:id) yang memvalidasi & mencatat riwayat; klien hanya
// mengirim bidang yang BENAR-BENAR berubah dan menandai perubahan rekening bank.
import { nilaiPilihanTermin, payloadTerminSupplier } from "./terminLogic.js";

export const BIDANG_TEKS = ["name", "phone", "email", "address", "bankName", "bankAccount", "bankHolder", "notes"];
const norm = (v) => String(v ?? "").trim();

/** Nilai awal formulir dari baris supplier (semua string supaya input terkontrol). */
export function formDariSupplier(s) {
  const f = { code: s?.code ?? "" };
  for (const k of BIDANG_TEKS) f[k] = s?.[k] ?? "";
  f.paymentTermDays = s?.paymentTermDays ? String(s.paymentTermDays) : "";
  // Termin bawaan (Tunai/COD, 7/14/30/45/60 hari, tanggal khusus) — nilai <select>; hanya DEFAULT, dokumen menyimpan snapshot sendiri.
  f.paymentTermPilihan = nilaiPilihanTermin(s?.paymentTermType, s?.paymentTermDays);
  return f;
}

/** Hanya bidang yang berubah dibanding supplier awal. Kosong ("") untuk teks = hapus isian; termin kosong = null. Kode tidak pernah dikirim. */
export function payloadPerubahan(awal, form) {
  const out = {};
  for (const k of BIDANG_TEKS) if (norm(form[k]) !== norm(awal?.[k])) out[k] = norm(form[k]);
  const pilihanAwal = nilaiPilihanTermin(awal?.paymentTermType, awal?.paymentTermDays);
  if (form.paymentTermPilihan !== undefined && form.paymentTermPilihan !== pilihanAwal) {
    Object.assign(out, payloadTerminSupplier(form.paymentTermPilihan));
  } else {
    const terminAwal = awal?.paymentTermDays ? Number(awal.paymentTermDays) : null;
    const terminBaru = norm(form.paymentTermDays) === "" ? null : Number(form.paymentTermDays);
    if (terminBaru !== terminAwal) out.paymentTermDays = terminBaru;
  }
  return out;
}

/** Validasi ringan di klien (server tetap menjadi penjaga): pesan galat atau null. */
export function galatForm(form) {
  if (!norm(form.name)) return "Nama supplier wajib diisi";
  if (norm(form.email) && !/^\S+@\S+\.\S+$/.test(norm(form.email))) return "Format email tidak valid";
  const t = norm(form.paymentTermDays);
  if (t !== "" && (!/^\d+$/.test(t) || Number(t) > 365)) return "Termin pembayaran harus bilangan bulat 0–365 hari";
  return null;
}

/** Apakah perubahan menyentuh data rekening bank (bank / nomor / atas nama)? */
export function rekeningBerubah(awal, form) {
  return ["bankName", "bankAccount", "bankHolder"].some((k) => norm(form[k]) !== norm(awal?.[k]));
}

/** Supplier yang boleh dipilih untuk tagihan/pembayaran BARU: yang aktif, ditambah (opsional) supplier tagihan yang sedang diedit. */
export function supplierBisaDipilih(suppliers, { tetapSertakanId = null } = {}) {
  return (suppliers ?? []).filter((s) => s.active !== false || s.id === tetapSertakanId);
}
