// Logika murni layar Pengeluaran Material & Transfer Stok (UX Gudang Tahap 2) — diuji tanpa DOM.
// Status, tahap, dan aksi datang dari server (`tampilan`); di sini hanya penyaringan daftar, pencarian, validasi isian jumlah, dan kalimat dampak stok.

export const TAHAP_FILTER_MI = Object.freeze([
  { key: "", label: "Semua" },
  { key: "draf", label: "Draf", statuses: ["DRAFT"] },
  { key: "menunggu", label: "Menunggu persetujuan", statuses: ["WAITING_APPROVAL"] },
  { key: "disiapkan", label: "Disetujui & disiapkan", statuses: ["APPROVED", "READY_TO_PICK", "PICKED"] },
  { key: "selesai", label: "Sudah dikeluarkan", statuses: ["ISSUED"] },
  { key: "batal", label: "Dibatalkan", statuses: ["CANCELLED"] },
]);

export const TAHAP_FILTER_ST = Object.freeze([
  { key: "", label: "Semua" },
  { key: "draf", label: "Draf", statuses: ["DRAFT"] },
  { key: "menunggu", label: "Menunggu persetujuan", statuses: ["WAITING_APPROVAL"] },
  { key: "disiapkan", label: "Disetujui & disiapkan", statuses: ["APPROVED", "PICKED"] },
  { key: "jalan", label: "Dalam perjalanan", statuses: ["IN_TRANSIT"] },
  { key: "selesai", label: "Selesai", statuses: ["COMPLETED"] },
  { key: "batal", label: "Dibatalkan", statuses: ["CANCELLED"] },
]);

export const filterTahap = (filters, rows, key) => {
  const t = filters.find((x) => x.key === key);
  return !t || !t.statuses ? rows : rows.filter((r) => t.statuses.includes(r.status));
};
export const hitungPerTahap = (filters, rows) => Object.fromEntries(filters.map((t) => [t.key, t.statuses ? rows.filter((r) => t.statuses.includes(r.status)).length : rows.length]));

const barisTeks = (lines = []) => lines.map((l) => `${l.material?.code ?? ""} ${l.material?.name ?? ""}`);
/** Teks yang dicari untuk satu baris daftar (huruf kecil). */
export function teksCariMI(r) {
  return [r.issueNumber, r.department, r.sourceReference, r.requestedBy?.name, r.unit?.unitCode, r.unit?.order?.orderNumber, r.unit?.order?.customer?.name, ...barisTeks(r.lines)].filter(Boolean).join(" ").toLowerCase();
}
export function teksCariST(r) {
  return [r.transferNumber, r.sourceLocation?.code, r.destinationLocation?.code, r.requestedBy?.name, r.notes, ...barisTeks(r.lines)].filter(Boolean).join(" ").toLowerCase();
}
export const cocokCari = (teks, q) => { const k = String(q ?? "").trim().toLowerCase(); return !k || k.split(/\s+/).every((p) => teks.includes(p)); };

export const angka = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
export const teksJumlah = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString("id-ID", { maximumFractionDigits: 4 }) : "—");

/** Galat isian jumlah per baris. `nilai` {lineId: teks}; `boleh0` untuk jumlah diterima (0 = hilang di jalan). "" = lolos. */
export function galatJumlah(baris, nilai, { boleh0 = false } = {}) {
  for (const l of baris) {
    const v = nilai?.[l.id];
    if (v === undefined || v === "") return `Jumlah untuk ${l.material?.code ?? "item"} wajib diisi`;
    const n = angka(v);
    if (!Number.isFinite(n)) return `Jumlah untuk ${l.material?.code ?? "item"} tidak valid`;
    if (n < 0 || (!boleh0 && n === 0)) return `Jumlah untuk ${l.material?.code ?? "item"} harus ${boleh0 ? "0 atau lebih" : "lebih dari 0"}`;
  }
  return "";
}

/** Ringkasan dampak stok sebelum Konfirmasi keluar: satu kalimat per baris. */
export function dampakKeluar(baris, jumlahKeluar, satuan = (u) => u) {
  return baris.map((l) => {
    const diminta = Number(l.requestedQty); const n = angka(jumlahKeluar?.[l.id] ?? l.requestedQty);
    const sel = Number.isFinite(n) && n !== diminta ? ` (diminta ${teksJumlah(diminta)})` : "";
    return `${l.material.code}: stok berkurang ${Number.isFinite(n) ? teksJumlah(n) : "?"} ${satuan(l.material.unit)}${sel}`;
  });
}
export function dampakKirim(baris, satuan = (u) => u) {
  return baris.map((l) => `${l.material.code}: saldo berkurang ${teksJumlah(l.qtySent)} ${satuan(l.material.unit)} saat dikirim`);
}
/** Dampak saat barang diterima; selisih = dikirim − diterima (hilang dari saldo). */
export function dampakTerima(baris, jumlahTerima, satuan = (u) => u) {
  return baris.map((l) => {
    const n = angka(jumlahTerima?.[l.id] ?? l.qtySent); const selisih = Number.isFinite(n) ? Math.round((Number(l.qtySent) - n) * 10000) / 10000 : 0;
    return `${l.material.code}: saldo bertambah ${Number.isFinite(n) ? teksJumlah(n) : "?"} ${satuan(l.material.unit)}${selisih > 0 ? ` — selisih ${teksJumlah(selisih)} dari ${teksJumlah(l.qtySent)} yang dikirim TIDAK masuk saldo` : selisih < 0 ? ` — lebih ${teksJumlah(-selisih)} dari yang dikirim` : ""}`;
  });
}

export const adaSelisihTerima = (baris, jumlahTerima) => baris.some((l) => { const n = angka(jumlahTerima?.[l.id] ?? l.qtySent); return Number.isFinite(n) && n !== Number(l.qtySent); });
export const adaKurangStok = (ketersediaan = []) => ketersediaan.some((k) => k.cukup === false);

/** Kalimat ketersediaan satu baris untuk layar. */
export function kalimatKetersediaan(k, satuan = "") {
  if (!k || k.saldo === null) return "Saldo belum diketahui";
  const u = satuan ? ` ${satuan}` : "";
  return `Saldo total ${teksJumlah(k.saldo)}${u} · dicadangkan dokumen lain ${teksJumlah(k.dicadangLain)}${u} · tersedia ${teksJumlah(k.tersedia)}${u}`;
}

export const tanggalPendek = (d) => (d ? new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—");
export const waktuTeks = (d) => (d ? new Date(d).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

/** Cakupan batas minimum bahan aktif (baris dari /inventory/beranda/stok: { aktif, batasMinimum }). Dipakai Restok agar "tidak ada saran" tidak dibaca sebagai "stok aman". */
export function cakupanBatasMinimum(rows = []) {
  const aktif = rows.filter((r) => r.aktif !== false); const diatur = aktif.filter((r) => r.batasMinimum !== null && r.batasMinimum !== undefined).length;
  return { total: aktif.length, diatur, belum: aktif.length - diatur };
}
export function kalimatCakupanBatasMinimum(c) {
  if (!c || c.total === 0) return null;
  if (c.diatur === 0) return `Tidak ada saran restok karena batas minimum belum diatur untuk satu pun dari ${c.total} bahan aktif. Daftar kosong ini BUKAN bukti stok aman.`;
  if (c.belum === 0) return "Tidak ada bahan yang perlu direstok saat ini (semua bahan aktif sudah punya batas minimum).";
  return `Tidak ada saran untuk ${c.diatur} bahan yang punya batas minimum. ${c.belum} dari ${c.total} bahan aktif belum punya batas minimum, jadi tidak pernah muncul di sini — daftar kosong ini BUKAN bukti semua stok aman.`;
}
