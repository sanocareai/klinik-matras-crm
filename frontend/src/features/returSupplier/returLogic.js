// RETUR SUPPLIER & DEBIT NOTE — logika layar (murni). Angka, kapasitas, blokir, dan dampak keuangan SEMUA dari server (pratinjau); layar tidak menghitung ulang.
// Dua keputusan yang jangan dicampur: MINTA PENGGANTI memakai alur penolakan + pengiriman pengganti PO (tidak ada dokumen retur, nilai tagihan tidak berubah);
// RETUR UNTUK KREDIT = dokumen Retur Supplier (halaman ini).

export const ALASAN_RETUR = [
  { kode: "RUSAK", label: "Barang rusak / cacat" },
  { kode: "TIDAK_SESUAI", label: "Tidak sesuai spesifikasi atau pesanan" },
  { kode: "KUALITAS", label: "Kualitas buruk (ditemukan setelah masuk stok)" },
  { kode: "KELEBIHAN", label: "Kelebihan kirim" },
  { kode: "LAINNYA", label: "Alasan lain (jelaskan)" },
];

export const STATUS_RETUR = {
  DRAFT: { label: "Draf — barang belum keluar", variant: "neutral" },
  KELUAR: { label: "Barang sudah keluar", variant: "accent" },
  SELESAI: { label: "Selesai", variant: "green" },
  DIBATALKAN: { label: "Dibatalkan", variant: "red" },
};
export const STATUS_DEBIT_NOTE = {
  MENUNGGU: { label: "Menunggu persetujuan Finance", variant: "orange" },
  DISETUJUI: { label: "Disetujui", variant: "green" },
  DIBATALKAN: { label: "Dibatalkan", variant: "red" },
};
export const TEKS_KEPUTUSAN = {
  pengganti: "Minta pengganti: gunakan alur penolakan saat pemeriksaan dan pengiriman pengganti di Barang Akan Datang. Nilai tagihan tidak berubah dan tidak ada dokumen retur.",
  kredit: "Retur untuk kredit: barang keluar dari gudang ke supplier. Nilai tagihan dikurangi lewat Debit Note (faktur lama tidak diubah); kelebihan menjadi saldo kredit supplier — tidak ada uang kembali otomatis.",
};

export const jumlahTeks = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString("id-ID", { maximumFractionDigits: 3 }) : "—";
};
export const rupiahTeks = (n) => `Rp${Math.round(Number(n) || 0).toLocaleString("id-ID")}`;
export const tanggalTeks = (iso) => {
  if (!iso) return "—";
  const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
};

/** Isian awal formulir retur dari kandidat server (satu input jumlah per baris yang boleh diretur). */
export function formReturAwal() {
  return { poId: "", reasonCode: "RUSAK", reason: "", note: "", evidenceUrls: [], jumlah: {} };
}

/** Baris yang diisi jumlahnya (> 0) → body server. */
export function bodyRetur(f) {
  return {
    reasonCode: f.reasonCode, reason: String(f.reason ?? "").trim(), note: String(f.note ?? "").trim() || undefined, evidenceUrls: f.evidenceUrls,
    lines: Object.entries(f.jumlah).filter(([, v]) => v !== "" && Number(v) > 0).map(([goodsReceiptLineId, v]) => ({ goodsReceiptLineId, qty: Number(v) })),
  };
}

/** Galat dini (null = siap dipratinjau). Aturan nyata (kapasitas, blokir, stok) ditegakkan server; ini hanya mencegah permintaan yang pasti ditolak. */
export function galatRetur(f, kandidat = []) {
  if (!f.poId) return "Pilih PO terlebih dulu";
  if (String(f.reason ?? "").trim().length < 5) return "Jelaskan alasan retur (minimal 5 karakter)";
  if (!f.evidenceUrls?.length) return "Lampirkan minimal satu foto bukti kondisi barang";
  const baris = Object.entries(f.jumlah).filter(([, v]) => v !== "" && Number(v) !== 0);
  if (baris.length === 0) return "Isi jumlah retur minimal satu baris";
  for (const [id, v] of baris) {
    const n = Number(v);
    if (!(n > 0)) return "Jumlah retur harus lebih dari 0";
    if (Math.abs(n * 1000 - Math.round(n * 1000)) > 1e-6) return "Jumlah retur maksimal 3 angka di belakang koma";
    const k = kandidat.find((x) => x.goodsReceiptLineId === id);
    if (k && n > Number(k.bolehDiretur) + 1e-9) return `${k.kode} pada ${k.nomorPenerimaan}: jumlah retur (${jumlahTeks(n)}) melebihi yang boleh diretur (${jumlahTeks(k.bolehDiretur)} ${k.satuan})`;
  }
  return null;
}

export function galatKeluar(f) {
  if (String(f.pic ?? "").trim().length < 2) return "Isi PIC yang menyerahkan barang";
  if (!f.tanggal) return "Isi tanggal barang keluar";
  return null;
}

/** Rangkuman satu pratinjau debit note (server) untuk kalimat konfirmasi. */
export function kalimatDampakDebitNote(p) {
  if (!p) return "";
  const bagian = [`Nilai debit note ${rupiahTeks(p.nilai)}`];
  if (p.kurangiSisaUtang > 0) bagian.push(`mengurangi sisa utang faktur ${rupiahTeks(p.kurangiSisaUtang)}`);
  if (p.jadiSaldoKredit > 0) bagian.push(`menjadi saldo kredit supplier ${rupiahTeks(p.jadiSaldoKredit)} (bukan refund kas)`);
  return `${bagian.join("; ")}.`;
}
