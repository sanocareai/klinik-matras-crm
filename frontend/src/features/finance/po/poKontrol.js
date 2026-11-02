// Logika murni untuk kontrol editor PO (tanggal, validasi bertahap, termin, kelayakan Catat faktur). Tanpa React/DOM.
// Tanggal PO adalah TANGGAL KALENDER (WIB) berformat "YYYY-MM-DD": semua hitungan memakai aritmetika UTC murni pada komponen y/m/d, tidak pernah mengonversi zona,
// sehingga hari tidak bergeser. Payload ke server tetap string yang sama dengan sebelumnya.
import { galatBaris, galatFormulir, galatMaterialBaru } from "../purchaseOrderLogic.js";
import { PILIHAN_TERMIN } from "../terminLogic.js";

export const BULAN_PENDEK = Object.freeze(["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]);
export const BULAN_PANJANG = Object.freeze(["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]);
export const HARI_PENDEK = Object.freeze(["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]); // minggu dimulai Senin
export const HARI_PANJANG = Object.freeze(["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]);

const POLA = /^(\d{4})-(\d{2})-(\d{2})$/;
const dua = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${String(y).padStart(4, "0")}-${dua(m + 1)}-${dua(d)}`;

/** "2026-11-02" → { y: 2026, m: 10 (0–11), d: 2 } atau null bila bukan tanggal kalender yang sah (mis. 2026-02-31). */
export function uraiTanggal(s) {
  const t = POLA.exec(String(s ?? ""));
  if (!t) return null;
  const y = Number(t[1]), m = Number(t[2]) - 1, d = Number(t[3]);
  const x = new Date(Date.UTC(y, m, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === m && x.getUTCDate() === d ? { y, m, d } : null;
}
/** "2 Nov 2026" (tanpa nol di depan hari); "" bila kosong/tidak sah. */
export function formatTanggalPO(s) {
  const p = uraiTanggal(s);
  return p ? `${p.d} ${BULAN_PENDEK[p.m]} ${p.y}` : "";
}
/** "Senin, 2 November 2026" untuk label aksesibilitas. */
export function labelTanggalPenuh(s) {
  const p = uraiTanggal(s);
  return p ? `${HARI_PANJANG[hariKe(s)]}, ${p.d} ${BULAN_PANJANG[p.m]} ${p.y}` : "";
}
/** Indeks hari Senin=0 … Minggu=6. */
export function hariKe(s) {
  const p = uraiTanggal(s);
  return p ? (new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay() + 6) % 7 : 0;
}
export const hariDalamBulan = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
export function tambahHari(s, n) {
  const p = uraiTanggal(s); if (!p) return s;
  const x = new Date(Date.UTC(p.y, p.m, p.d + n));
  return iso(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
}
/** Geser n bulan; tanggal 31 yang jatuh ke bulan pendek dijepit ke hari terakhir bulan itu. */
export function tambahBulan(s, n) {
  const p = uraiTanggal(s); if (!p) return s;
  const total = p.y * 12 + p.m + n;
  const y = Math.floor(total / 12), m = ((total % 12) + 12) % 12;
  return iso(y, m, Math.min(p.d, hariDalamBulan(y, m)));
}
/** Hari ini menurut WIB (UTC+7 tetap, tanpa DST) sebagai "YYYY-MM-DD". */
export function hariIniWIB(sekarang = Date.now()) {
  return new Date(sekarang + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
/** Sel kalender satu bulan, minggu mulai Senin: null = sel kosong, selain itu "YYYY-MM-DD". Panjang selalu kelipatan 7. */
export function selBulan(y, m) {
  const awal = iso(y, m, 1);
  const sel = Array(hariKe(awal)).fill(null);
  for (let d = 1; d <= hariDalamBulan(y, m); d++) sel.push(iso(y, m, d));
  while (sel.length % 7) sel.push(null);
  return sel;
}
/** Ketik "2026-11-02" ke teks; nilai tidak sah dikembalikan apa adanya agar tidak diam-diam diubah. */
export const nilaiTanggalAman = (s) => (uraiTanggal(s) ? s : (s ?? ""));

// ── Validasi bertahap: galat baru tampil setelah interaksi/percobaan simpan, dan fokus menuju field pertama yang bermasalah.
/**
 * Field pertama yang bermasalah, dengan urutan & pesan SAMA seperti galatFormulir (sumber kebenaran tetap di purchaseOrderLogic.js).
 * { kunci: "supplier" | "orderDate" | "expectedDate" | "baris", baris?: nomor 1-based, field?: "bahan"|"qty"|"harga"|"rinci"|"ganda", pesan }
 */
export function cariFieldBermasalah(f, unitMap = null) {
  const pesan = galatFormulir(f, unitMap);
  if (!pesan) return null;
  if (!f.supplierId) return { kunci: "supplier", pesan };
  if (!f.orderDate) return { kunci: "orderDate", pesan };
  if (f.expectedDate && f.expectedDate < f.orderDate) return { kunci: "expectedDate", pesan };
  if (f.lines.length === 0) return { kunci: "baris", baris: 1, field: "bahan", pesan };
  for (const [i, l] of f.lines.entries()) {
    const g = galatBaris(l, unitMap?.get?.(l.materialId) ?? null);
    if (g) return { kunci: "baris", baris: i + 1, field: fieldDariGalatBaris(l, g), pesan };
  }
  const m = /^Baris (\d+):/.exec(pesan);
  return { kunci: "baris", baris: m ? Number(m[1]) : 1, field: "ganda", pesan };
}
export function fieldDariGalatBaris(l, g) {
  if (!l.materialId && !l.materialBaru) return "bahan";
  if (l.materialBaru && galatMaterialBaru(l.materialBaru) === g) return "bahan";
  if (/^Jumlah (harus|maksimal)/.test(g)) return "qty";
  if (/^Harga satuan/.test(g)) return "harga";
  return "rinci"; // faktor konversi, jumlah pendamping, jumlah × faktor, harga per satuan stok
}
/** Baris kosong sama sekali (belum diisi apa pun) tidak boleh tampil merah di formulir baru. */
export const barisKosong = (l) => !(l.materialId || l.materialBaru || l.qty || l.unitPrice);

// ── Termin
/** Label ringkas untuk blok termin PO: "7 hari" / "Tunai/COD" / "Belum ditetapkan". Pilihan manual (ganti) mengalahkan default supplier. */
export function labelTerminRingkas(pr, value) {
  if (value?.ganti && value.pilihan) return PILIHAN_TERMIN.find((p) => p.nilai === value.pilihan)?.label ?? value.pilihan;
  if (value?.ganti && !value.pilihan) return "Belum diatur";
  if (!pr) return "";
  if (!pr.ada) return "Belum ditetapkan";
  return pr.label || "Belum ditetapkan";
}
/** Bantuan di bawah ringkasan termin sesuai data server (tanpa menjanjikan hal yang tidak dihitung PO). */
export function bantuanTermin(pr) {
  const dasar = "Tanggal jatuh tempo ditentukan saat faktur dicatat.";
  if (!pr) return { dasar, tambahan: "" };
  if (!pr.ada) return { dasar, tambahan: "Supplier ini belum punya termin; tanggal jatuh tempo diisi di formulir faktur. “Perkiraan datang” hanya perkiraan kedatangan barang, bukan jatuh tempo." };
  if (pr.jenis === "TANGGAL_KHUSUS") return { dasar, tambahan: "Tanggal khusus: tanggal jatuh tempo diisi saat faktur dicatat, bukan di PO." };
  if (pr.dasar === "TANGGAL_TIBA") return { dasar, tambahan: "Menunggu tanggal penerimaan: termin berjalan dari tanggal barang tiba (per penerimaan), bukan dari tanggal PO atau faktur." };
  return { dasar, tambahan: "" };
}

// ── Alur "Sudah menerima faktur supplier?" (bantuan alur, bukan data PO)
export const STATUS_BOLEH_CATAT_FAKTUR = Object.freeze(["DISETUJUI", "DITERIMA_SEBAGIAN", "SELESAI"]);
/** Sama dengan aturan di Rincian PO (aksiRincian): faktur hanya untuk PO yang sudah disetujui, dan perlu izin mencatat. */
export function bolehCatatFaktur(status, izin) {
  return STATUS_BOLEH_CATAT_FAKTUR.includes(status) && !!izin?.catat;
}
/** Teks langkah lanjutan setelah draf disimpan. `status` = status PO hasil simpan (editor selalu menyimpan DRAFT). */
export function langkahFakturSetelahSimpan(status, izin) {
  if (bolehCatatFaktur(status, izin)) return { siap: true, teks: "PO ini sudah bisa dicatatkan faktur supplier. Pencatatan faktur tetap langkah terpisah dengan konfirmasi sendiri." };
  if (STATUS_BOLEH_CATAT_FAKTUR.includes(status)) return { siap: false, teks: "Faktur supplier hanya bisa dicatat oleh Finance atau Akuntan." };
  return { siap: false, teks: "Faktur supplier dicatat setelah PO disetujui. Draf ini belum disetujui otomatis: setujui PO lebih dulu, lalu pilih Catat faktur supplier di rincian PO." };
}
