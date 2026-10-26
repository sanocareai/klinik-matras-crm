// Model MURNI Pembetulan Bahan pada unit TERKIRIM (diuji node --test tanpa React/DOM). Unit dibatalkan TIDAK termasuk.
// Dua jalur yang TIDAK boleh tercampur dalam bahasa maupun tombol:
//   (A) CATATAN tanpa stok       -> pemakaian sementara / komponen lama: stok, jurnal, HPP tidak berubah.
//   (B) PENGELUARAN STOK         -> tambah / kembalikan / ajukan koreksi jumlah: mengubah stok, nilai Finance, dan HPP order.
// Waktu: ada DUA waktu yang selalu terpisah — tanggal pemakaian yang DILAPORKAN (diisi pengguna) dan waktu PENCATATAN (saat konfirmasi). Waktu konfirmasi bukan waktu pekerjaan.
import { parseJumlah } from "../orderProduksiModel.js";

export const unitTerkirim = (status) => status === "DELIVERED";
export const unitSelesai = unitTerkirim; // nama lama; hanya DELIVERED (dibatalkan sengaja tidak diperluas)

export const JALUR = Object.freeze({
  CATATAN: {
    key: "CATATAN", judul: "A · Tambah catatan TANPA pengeluaran stok", badge: "Tidak mengubah stok, jurnal, atau HPP",
    teks: "Untuk bahan yang dipakai tetapi belum bisa/tidak perlu dikeluarkan dari stok. Layanan yang dipakai: Pemakaian sementara (bahan belum ada di katalog atau stok belum diketahui; status 'Perlu rekonsiliasi Gudang') dan Komponen lama dari kasur ini (milik pelanggan).",
    tampil: "Hasil tampil di order: kartu 'Bahan belum ada di katalog' / 'Komponen lama dari kasur ini' di drawer ini, Ringkasan, Riwayat, dan Excel (sheet Pemakaian Sementara). Tanggal dilaporkan dan waktu pencatatan tampil terpisah. Koreksi catatan Excel/historis ada di bagian 'Catatan pemakaian historis'.",
  },
  STOK: {
    key: "STOK", judul: "B · Pengeluaran stok baru atau pengembalian", badge: "Mengubah stok & HPP order",
    teks: "Menambah pengeluaran bahan dari Gudang yang terlewat, mengembalikan yang berlebih, atau mengajukan koreksi jumlah. Baris lama TIDAK diedit atau dihapus — pembetulan menjadi baris baru dengan alasan.",
    tampil: "Hasil tampil di order: kartu 'Bahan dari Gudang' (riwayat: waktu pencatatan + tanggal dilaporkan), HPP order, dan Riwayat unit.",
  },
});
export const CARA = Object.freeze([
  { key: "TAMBAH", grup: "STOK", label: "Tambah pengeluaran bahan", ringkas: "Membuat PENGELUARAN STOK baru", langsung: true },
  { key: "KURANGI", grup: "STOK", label: "Kembalikan sebagian (pengembalian baru)", ringkas: "Membuat PENGEMBALIAN stok baru", langsung: true },
  { key: "AJUKAN", grup: "STOK", label: "Ajukan koreksi jumlah (persetujuan orang lain)", ringkas: "Stok berubah setelah disetujui Owner/Finance", langsung: false },
  { key: "SEMENTARA", grup: "CATATAN", label: "Catat pemakaian sementara", ringkas: "Hanya catatan — tanpa stok", langsung: true },
  { key: "KOMPONEN", grup: "CATATAN", label: "Catat komponen lama", ringkas: "Hanya catatan — bukan stok Gudang", langsung: true },
]);
export const JENIS_PRATINJAU = Object.freeze({ TAMBAH: "TAMBAH", KURANGI: "KURANGI", SEMENTARA: "CATATAN_SEMENTARA", KOMPONEN: "KOMPONEN_LAMA" });

const WIB_HARI = (d) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
/** Tanggal pemakaian dilaporkan: format YYYY-MM-DD, tidak di masa depan (hari WIB). Mencerminkan server; server yang memutuskan. */
export function validasiTanggal(tanggal, sekarang = new Date()) {
  const t = String(tanggal ?? "").trim();
  if (!t) return { ok: false, galat: "Isi tanggal pemakaian yang dilaporkan (kapan bahan itu sebenarnya dipakai)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(new Date(`${t}T00:00:00Z`).getTime()) || new Date(`${t}T00:00:00Z`).toISOString().slice(0, 10) !== t) return { ok: false, galat: "Tanggal pemakaian tidak valid." };
  if (t > WIB_HARI(sekarang)) return { ok: false, galat: "Tanggal pemakaian tidak boleh di masa depan." };
  return { ok: true, tanggal: t };
}
const BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const tglIndo = (t) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(t ?? "")); return m ? `${Number(m[3])} ${BLN[Number(m[2]) - 1]} ${m[1]}` : "—"; };
/** Tanggal pemakaian yang dilaporkan dari catatan baku "Pembetulan unit terkirim (kode) [dilaporkan YYYY-MM-DD]: …" (atau null). */
export const uraiDilaporkan = (note) => { const m = /\[dilaporkan (\d{4}-\d{2}-\d{2})\]/.exec(String(note ?? "")); return m ? m[1] : null; };

/** Validasi isian sebelum meminta pratinjau/konfirmasi. maks = batas pengembalian (pemakaian bersih bahan pada unit). Jalur A tidak butuh jumlah stok. */
export function validasiPembetulan({ cara, bahan, qty, alasan, tanggal, maks = null, sekarang = new Date() }) {
  const t = cara === "AJUKAN" ? { ok: true, tanggal: null } : validasiTanggal(tanggal, sekarang); if (!t.ok) return t; // koreksi jumlah berpersetujuan: pergerakan lahir saat disetujui, tidak ada tanggal pemakaian tunggal
  const a = String(alasan ?? "").trim();
  if (a.length < 5) return { ok: false, galat: "Alasan wajib diisi (minimal 5 karakter)." };
  if (a.length > 500) return { ok: false, galat: "Alasan maksimal 500 karakter." };
  if (cara === "KOMPONEN") return { ok: true, alasan: a, tanggal: t.tanggal };
  if (cara !== "SEMENTARA" && !bahan?.materialId) return { ok: false, galat: "Pilih bahan lebih dulu." };
  const v = parseJumlah(qty);
  if (cara === "AJUKAN") { if (v === null || v < 0) return { ok: false, galat: "Isi pemakaian yang benar (angka 0 atau lebih)." }; }
  else if (v === null || v <= 0) return { ok: false, galat: "Isi jumlah lebih dari 0." };
  if (cara === "KURANGI" && maks !== null && v > maks + 0.00005) return { ok: false, galat: `Pengembalian melebihi pemakaian bersih bahan ini pada unit (${maks}).` };
  return { ok: true, qty: Math.round(v * 10000) / 10000, alasan: a, tanggal: t.tanggal };
}

const koma = (n) => String(Math.round(Number(n) * 10000) / 10000).replace(".", ",");
/** Ringkas pratinjau server jadi baris yang dibaca pengguna. Tidak menambah angka sendiri. */
export function barisDampak(pra) {
  if (!pra) return [];
  const o = [{ k: "tindakan", label: "Tindakan", teks: `${pra.tindakan.judul}. ${pra.tindakan.teks}`, tegas: pra.tindakan.menulisStok }];
  o.push({ k: "waktu", label: "Waktu", teks: pra.waktu.teks });
  if (pra.stok) {
    o.push({ k: "stok", label: "Stok", teks: `${pra.stok.saldoSebelum === null ? "belum diketahui" : koma(pra.stok.saldoSebelum)} → ${koma(pra.stok.saldoSesudah)} ${pra.bahan.satuan}` });
    o.push({ k: "pemakaian", label: "Pemakaian bahan pada unit", teks: `${koma(pra.pemakaianBersih.sebelum)} → ${koma(pra.pemakaianBersih.sesudah)} ${pra.bahan.satuan}` });
  } else o.push({ k: "stok", label: "Stok", teks: "Tidak berubah (hanya catatan)." });
  o.push({ k: "finance", label: "Nilai & jurnal Finance", teks: pra.finance.teks, hasil: pra.finance.hasil });
  o.push({ k: "hpp", label: "HPP operasional (Harga Berlaku)", teks: pra.hppOperasional.teks });
  return o;
}
const NAMA_KANDIDAT = Object.freeze({
  PENGELUARAN_TERTAUT_UNIT: "Sudah tertaut ke unit ini", PENGELUARAN_TANPA_UNIT: "Pengeluaran bahan sama TANPA unit", PENGELUARAN_UNIT_LAIN: "Pengeluaran sama pada UNIT LAIN",
  MATERIAL_ISSUE_BELUM_FINAL: "Material Issue unit ini belum final", CATATAN_HISTORIS: "Catatan pemakaian historis", PEMAKAIAN_SEMENTARA: "Pemakaian sementara menunggu rekonsiliasi",
});
/** Daftar yang ditampilkan untuk diperiksa pengguna (tertaut dulu, lalu kandidat). Tidak menyamakan atau menautkan apa pun. */
export function daftarSudahTercatat(pra) {
  const s = pra?.sudahTercatat; if (!s) return [];
  return [...s.tertaut, ...s.kemungkinan].map((x) => ({ ...x, jenisTeks: NAMA_KANDIDAT[x.kind] ?? x.kind, tertaut: x.kind === "PENGELUARAN_TERTAUT_UNIT" }));
}
export const perluKonfirmasiGanda = (pra) => !!pra?.sudahTercatat?.perluKonfirmasi;
/** Konfirmasi hanya bila pratinjau ada, tidak ada penghalang, isian belum berubah sejak pratinjau, dan (bila ada kemungkinan ganda) pengguna menyatakan ini pengeluaran BARU. */
export const bolehKonfirmasi = (pra, sidikSekarang, sidikPratinjau, { sudahPeriksa = false } = {}) => !!pra && pra.boleh === true && sidikSekarang === sidikPratinjau && (!perluKonfirmasiGanda(pra) || sudahPeriksa === true);
export const sidikIsian = ({ cara, bahan, qty, alasan, tanggal }) => JSON.stringify([cara, bahan?.materialId ?? null, String(qty ?? "").trim(), String(alasan ?? "").trim(), cara === "AJUKAN" ? "" : String(tanggal ?? "").trim()]);
/** Tubuh permintaan POST /units/:id/materials (pengeluaran/pengembalian): alasan, tanggal dilaporkan, saldo yang dilihat, dan konfirmasi bukan-ganda dikirim ke server yang menegakkannya. */
export function tubuhPembetulan({ cara, bahan, qty, alasan, tanggal, pra, sudahPeriksa = false }) {
  const jumlah = Math.round(Number(qty) * 10000) / 10000;
  return { materialId: bahan.materialId, qty: cara === "KURANGI" ? -jumlah : jumlah, alasanPembetulan: String(alasan).trim(), tanggalPemakaian: tanggal, saldoDilihat: pra?.stok?.saldoDilihat, ...(sudahPeriksa ? { konfirmasiBukanGanda: true } : {}) };
}
export const PESAN = Object.freeze({
  bukaSelesai: "Unit ini sudah terkirim. Pembetulan bahan tetap bisa dilakukan lewat layanan resmi yang sama. Alasan dan tanggal pemakaian wajib; setiap perubahan tersimpan di riwayat, dan baris lama tidak diubah.",
  tanpaIzin: "Akun Anda hanya bisa melihat pemakaian bahan.",
  tanggalPenjelas: "Tanggal pemakaian = kapan bahan itu sebenarnya dipakai (yang Anda laporkan). Waktu pencatatan = saat Anda menekan konfirmasi. Keduanya disimpan terpisah.",
  periksaGanda: "Saya sudah memeriksa daftar di atas. Ini pengeluaran BARU, bukan pemakaian yang sudah tercatat.",
});
