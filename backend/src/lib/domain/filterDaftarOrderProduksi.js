// FILTER DAFTAR ORDER PRODUKSI (posisi unit · PIC · target selesai) — fungsi MURNI tanpa DB; diuji node --test.
// Dipakai listWorkOrders (daftar + ekspor) dan hitungKelengkapanDaftar dengan SATU definisi, sehingga jumlah hasil, "Muat berikutnya", hitungan, dan Excel selalu mengikuti filter yang sama.
// Filter bekerja atas baris yang SUDAH diperkaya (adopsi.posisi / adopsi.pic / adopsi.targetSelesai), jadi tidak ada query per unit dan tidak ada aturan bisnis baru: hanya membaca nilai yang sudah tampil di daftar.
//
// Hubungan antarfilter = AND (semua filter yang aktif harus cocok). Di dalam satu filter pilihan ganda (posisi unit) = OR (salah satu cocok).
import { startOfDayWIB } from "../../utils/wib.js";
import { lolosKelengkapan } from "./kelengkapanOrderProduksi.js";

/** Posisi fisik yang boleh disaring (urutan = urutan alur). Kunci = adopsi.posisi.key dari posisiUnitOf (productionWorkStatus.js). DIBATALKAN dan TIDAK_DIKETAHUI sengaja tidak ditawarkan (bukan lokasi fisik). */
export const POSISI_FILTER = Object.freeze([
  Object.freeze({ key: "MENUNGGU_DIJEMPUT", label: "Menunggu dijemput" }),
  Object.freeze({ key: "DALAM_PENJEMPUTAN", label: "Dalam penjemputan" }),
  Object.freeze({ key: "SUDAH_DIJEMPUT", label: "Sudah dijemput · belum diterima workshop" }),
  Object.freeze({ key: "DI_WORKSHOP", label: "Di workshop" }),
  Object.freeze({ key: "DI_WORKSHOP_TANPA_BUKTI", label: "Di workshop · penerimaan belum tercatat" }),
  Object.freeze({ key: "DI_WORKSHOP_SIAP", label: "Di workshop · siap diambil" }),
  Object.freeze({ key: "DALAM_PENGIRIMAN", label: "Dalam pengiriman" }),
  Object.freeze({ key: "DI_PELANGGAN", label: "Sudah di pelanggan" }),
]);
export const POSISI_KEYS = Object.freeze(POSISI_FILTER.map((p) => p.key));
/** Nilai khusus filter PIC: unit tanpa PIC. */
export const PIC_TANPA = "~tanpa";
/** Pilihan target selesai. Hari dihitung menurut kalender WIB. */
export const TARGET_FILTER = Object.freeze([
  Object.freeze({ key: "terlambat", label: "Terlambat", bantu: "Tanggal target sebelum hari ini (WIB) dan pekerjaan belum selesai. Unit Terkirim, Dibatalkan, atau berstatus kerja Selesai tidak dihitung terlambat." }),
  Object.freeze({ key: "hari_ini", label: "Hari ini", bantu: "Tanggal target = hari ini (WIB)." }),
  Object.freeze({ key: "tujuh_hari", label: "7 hari ke depan", bantu: "Tanggal target dari hari ini sampai 6 hari berikutnya (WIB)." }),
  Object.freeze({ key: "belum_ada", label: "Belum ada target", bantu: "Unit belum punya target selesai (opsional; bukan kekurangan data)." }),
]);
export const TARGET_KEYS = Object.freeze(TARGET_FILTER.map((t) => t.key));

function galat(pesan, code) { const e = new Error(pesan); e.statusCode = 400; e.code = code; return e; }
const csv = (v) => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((s) => String(s).trim().toUpperCase()).filter(Boolean);

/** Baca & validasi parameter query. Nilai tidak dikenal DITOLAK (400), bukan diam-diam diabaikan — UI tidak boleh mengklaim filter yang tidak dipakai. */
export function parseFilterBaris(query = {}) {
  const posisi = [...new Set(csv(query.posisi))];
  const salah = posisi.filter((k) => !POSISI_KEYS.includes(k));
  if (salah.length) throw galat(`Posisi unit tidak dikenal: ${salah.join(", ")}.`, "POSISI_TIDAK_VALID");
  let pic = query.pic == null ? "" : String(Array.isArray(query.pic) ? query.pic[0] : query.pic).trim();
  if (pic.length > 120) throw galat("Nama PIC terlalu panjang.", "PIC_TIDAK_VALID");
  if (!pic) pic = null;
  const target = query.target ? String(query.target).trim().toLowerCase() : null;
  if (target && !TARGET_KEYS.includes(target)) throw galat(`Filter target tidak dikenal: ${target}.`, "TARGET_TIDAK_VALID");
  return { posisi, pic, target };
}
export const adaFilterBaris = (f) => !!(f && (f.posisi.length || f.pic || f.target));

const KERJA_TUTUP = new Set(["SELESAI", "DIBATALKAN"]);
const UNIT_TUTUP = new Set(["DELIVERED", "CANCELLED"]);
/** Tanggal kalender WIB (YYYY-MM-DD) dari satu instant. */
export const tanggalWib = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);

/** Apakah satu baris lolos filter? `now` disuntik agar batas hari WIB dapat diuji. */
export function lolosFilterBaris(row, f, now = new Date()) {
  if (!adaFilterBaris(f)) return true;
  const a = row?.adopsi ?? {};
  if (f.posisi.length && !f.posisi.includes(a.posisi?.key)) return false;
  if (f.pic) {
    if (f.pic === PIC_TANPA) { if (a.pic?.nama) return false; } else if (a.pic?.nama !== f.pic) return false;
  }
  if (f.target) {
    const at = a.targetSelesai?.at ?? null;
    if (f.target === "belum_ada") return !at;
    if (!at) return false;
    const hari = tanggalWib(at); const hariIni = tanggalWib(now);
    if (f.target === "hari_ini") return hari === hariIni;
    if (f.target === "tujuh_hari") { const batas = tanggalWib(new Date(startOfDayWIB(hariIni).getTime() + 7 * 86_400_000 - 1)); return hari >= hariIni && hari <= batas; }
    if (f.target === "terlambat") return hari < hariIni && !UNIT_TUTUP.has(row.status) && !KERJA_TUTUP.has(a.kerja?.key);
  }
  return true;
}

/** Daftar PIC yang muncul pada kumpulan baris (untuk pilihan filter) + jumlah unit tanpa PIC. Diurutkan menurut nama. */
export function fasetPic(rows) {
  const per = new Map(); let tanpa = 0;
  for (const r of rows) { const n = r?.adopsi?.pic?.nama; if (n) per.set(n, (per.get(n) || 0) + 1); else tanpa += 1; }
  return { pic: [...per.entries()].map(([nama, jumlah]) => ({ nama, jumlah })).sort((x, y) => x.nama.localeCompare(y.nama, "id")), tanpaPic: tanpa };
}


/**
 * Saring SELURUH baris yang cocok lalu potong satu halaman — satu-satunya jalur untuk daftar bertahap: `total` dan `hasMore` mengikuti filter yang SAMA dengan baris yang ditampilkan,
 * bukan halaman yang sudah dimuat. Urutan baris dipertahankan (halaman berikutnya selalu lanjutan yang sama).
 */
export function saringDanHalaman(rows, { kerjaFilter = [], kelFilter = [], filterBaris = null, page = 1, pageSize = 50, semua = false, now = new Date() } = {}) {
  let hasil = rows;
  if (kerjaFilter.length) hasil = hasil.filter((r) => kerjaFilter.includes(r.adopsi.kerja.key));
  if (adaFilterBaris(filterBaris)) hasil = hasil.filter((r) => lolosFilterBaris(r, filterBaris, now));
  if (kelFilter.length) hasil = hasil.filter((r) => lolosKelengkapan(r.adopsi.kelengkapan?.keys ?? [], kelFilter));
  const total = hasil.length;
  const halaman = semua ? hasil : hasil.slice((page - 1) * pageSize, page * pageSize);
  return { rows: halaman, total, hasMore: !semua && (page - 1) * pageSize + halaman.length < total };
}
