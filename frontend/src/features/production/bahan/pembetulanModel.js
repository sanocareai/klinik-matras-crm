// Model MURNI Pembetulan Bahan pada unit yang sudah selesai/terkirim (diuji node --test tanpa React/DOM).
// Dua jalur yang TIDAK boleh tercampur dalam bahasa maupun tombol:
//   (A) CATATAN yang belum menjadi pengeluaran stok  -> koreksi catatan / catat sementara: TIDAK mengubah stok, jurnal, atau HPP.
//   (B) PENGELUARAN STOK yang sudah terjadi          -> tambah / kembalikan / ajukan koreksi jumlah: mengubah stok, nilai Finance, dan HPP order.
import { parseJumlah } from "../orderProduksiModel.js";

export const UNIT_SELESAI = Object.freeze(["DELIVERED", "CANCELLED"]);
export const unitSelesai = (status) => UNIT_SELESAI.includes(status);
export const KATA_STATUS = Object.freeze({ DELIVERED: "terkirim", CANCELLED: "dibatalkan" });

export const JALUR = Object.freeze({
  CATATAN: {
    key: "CATATAN", judul: "A · Catatan yang belum menjadi pengeluaran stok", badge: "Tidak mengubah stok",
    teks: "Koreksi atau kecualikan catatan pemakaian (Excel/historis), atau catat pemakaian sementara bila stok bahan belum diketahui. Stok, jurnal, dan HPP tidak berubah; nilai asli tetap tersimpan dan setiap perubahan berjejak.",
  },
  STOK: {
    key: "STOK", judul: "B · Pengeluaran stok yang sudah/akan terjadi", badge: "Mengubah stok & HPP order",
    teks: "Menambah pengeluaran bahan dari Gudang yang terlewat, mengembalikan yang berlebih, atau mengajukan koreksi jumlah. Baris lama TIDAK diedit atau dihapus — pembetulan menjadi baris baru dengan alasan.",
  },
});
export const CARA = Object.freeze([
  { key: "TAMBAH", label: "Tambah pengeluaran bahan", ringkas: "Stok berkurang sekarang", langsung: true },
  { key: "KURANGI", label: "Kembalikan sebagian (pengembalian baru)", ringkas: "Stok bertambah sekarang", langsung: true },
  { key: "AJUKAN", label: "Ajukan koreksi jumlah (persetujuan orang lain)", ringkas: "Stok berubah setelah disetujui Owner/Finance", langsung: false },
]);

/** Validasi isian sebelum meminta pratinjau/konfirmasi. maks = batas pengembalian (pemakaian bersih bahan pada unit). */
export function validasiPembetulan({ cara, bahan, qty, alasan, maks = null }) {
  if (!bahan?.materialId) return { ok: false, galat: "Pilih bahan lebih dulu." };
  const v = parseJumlah(qty);
  if (cara === "AJUKAN") { if (v === null || v < 0) return { ok: false, galat: "Isi pemakaian yang benar (angka 0 atau lebih)." }; }
  else if (v === null || v <= 0) return { ok: false, galat: "Isi jumlah lebih dari 0." };
  if (cara === "KURANGI" && maks !== null && v > maks + 0.00005) return { ok: false, galat: `Pengembalian melebihi pemakaian bersih bahan ini pada unit (${maks}).` };
  const t = String(alasan ?? "").trim();
  if (t.length < 5) return { ok: false, galat: "Alasan wajib diisi (minimal 5 karakter)." };
  if (t.length > 500) return { ok: false, galat: "Alasan maksimal 500 karakter." };
  return { ok: true, qty: Math.round(v * 10000) / 10000, alasan: t };
}

const koma = (n) => String(Math.round(Number(n) * 10000) / 10000).replace(".", ",");
/** Ringkas pratinjau server jadi baris yang dibaca pengguna. Tidak menambah angka sendiri. */
export function barisDampak(pra) {
  if (!pra) return [];
  const o = [];
  o.push({ k: "stok", label: "Stok", teks: `${pra.stok.saldoSebelum === null ? "belum diketahui" : koma(pra.stok.saldoSebelum)} → ${koma(pra.stok.saldoSesudah)} ${pra.bahan.satuan}` });
  o.push({ k: "pemakaian", label: "Pemakaian bahan pada unit", teks: `${koma(pra.pemakaianBersih.sebelum)} → ${koma(pra.pemakaianBersih.sesudah)} ${pra.bahan.satuan}` });
  o.push({ k: "finance", label: "Nilai & jurnal Finance", teks: pra.finance.teks, hasil: pra.finance.hasil });
  o.push({ k: "hpp", label: "HPP operasional (Harga Berlaku)", teks: pra.hppOperasional.teks });
  return o;
}
/** Konfirmasi hanya bila pratinjau ada, tidak ada penghalang, dan isian belum berubah sejak pratinjau. */
export const bolehKonfirmasi = (pra, sidikSekarang, sidikPratinjau) => !!pra && pra.boleh === true && sidikSekarang === sidikPratinjau;
export const sidikIsian = ({ cara, bahan, qty, alasan }) => JSON.stringify([cara, bahan?.materialId ?? null, String(qty ?? "").trim(), String(alasan ?? "").trim()]);
/** Tubuh permintaan ke layanan resmi (alasan pembetulan wajib untuk unit selesai; catatan baku dibentuk server). */
export function tubuhPembetulan({ cara, bahan, qty, alasan }) {
  const jumlah = Math.round(Number(qty) * 10000) / 10000;
  return { materialId: bahan.materialId, qty: cara === "KURANGI" ? -jumlah : jumlah, alasanPembetulan: String(alasan).trim() };
}
export const PESAN = Object.freeze({
  bukaSelesai: (status) => `Unit ini sudah ${KATA_STATUS[status] ?? "selesai"}. Pembetulan bahan tetap bisa dilakukan lewat layanan resmi yang sama; alasan wajib dan semua perubahan tersimpan di riwayat.`,
  tanpaIzin: "Akun Anda hanya bisa melihat pemakaian bahan.",
  batalTanpaPembetulan: "Unit dibatalkan: pemakaian sementara tidak dapat dicatat; pengeluaran stok tetap bisa dibetulkan dengan alasan.",
});
