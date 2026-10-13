// NOTA KREDIT / KERINGANAN ORDER — logika murni layar (tanpa React) supaya bisa dites.
// Semua ANGKA datang dari server (ringkasan & pratinjau); modul ini hanya memeriksa kesiapan isian, menyusun query/body, dan melabeli.
// Definisi server (services/finance/notaKredit.js): tagihan bersih = nilai + ongkir − nota aktif · pembayaran bersih = diterima − refund disetujui ·
// sisa = tagihan bersih − pembayaran bersih · LUNAS ⇔ sisa ≤ 0.

export const JENIS_NOTA = [["POTONGAN_HARGA", "Potongan harga"], ["KERINGANAN", "Keringanan"]];
export const SUMBER_NOTA = [
  ["MANDIRI", "Potongan/Keringanan Mandiri"],
  ["TERTAUT_REFUND", "Tertaut Refund"],
];
export const LABEL_STATUS_BAYAR_SERVER = { BELUM_BAYAR: "Belum dibayar", DP: "Dibayar sebagian", LUNAS: "Lunas" };

export const KALIMAT_MANDIRI = "Nota Kredit mandiri mengurangi tagihan order dan mencatat jurnal: Dr Retur & Potongan Penjualan, Cr Piutang Usaha. Kas/Bank tidak berubah.";
export const KALIMAT_TERTAUT = "Nota Kredit tertaut refund TIDAK membuat jurnal baru — potongan ini sudah dicatat oleh refund. Kas/Bank, Piutang, Pendapatan, dan jurnal refund tidak berubah; hanya tagihan bersih dan status bayar yang dihitung ulang.";
export const KALIMAT_KONFIRMASI = {
  MANDIRI: "Saya paham nota ini mengurangi tagihan order dan mencatat jurnal Retur & Potongan terhadap Piutang Usaha.",
  TERTAUT_REFUND: "Saya paham nota ini tidak membuat jurnal baru dan hanya mengakui refund yang sudah ada sebagai potongan atas tagihan.",
};
export const TANPA_JURNAL = "Tanpa jurnal—sudah dicatat oleh refund";
export const KALIMAT_BATAL = "Pembatalan membalik jurnal nota (bila ada) dengan jurnal pembalik — tidak ada yang dihapus. Tagihan bersih dan status bayar dihitung ulang.";

export const labelStatusBayar = (s) => LABEL_STATUS_BAYAR_SERVER[s] || s || "—";
export const labelJenis = (k) => (JENIS_NOTA.find(([v]) => v === k) || [])[1] || k || "—";
export const labelSumber = (k) => (SUMBER_NOTA.find(([v]) => v === k) || [])[1] || k || "—";

/** Tanggal hari ini menurut WIB (YYYY-MM-DD). */
export function hariIniWIB(sekarang = new Date()) {
  return new Date(sekarang.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

const angka = (v) => Math.round(Number(v) || 0);

/**
 * Kesiapan isian membuat nota. Aturan angka final tetap server; ini hanya mencegah klik yang pasti ditolak.
 * @param f { sumber, amount, alasan, refundId, date, konfirmasi }
 * @param konteks { kandidat: [{id, potongan, layak}], pratinjau, memuatPratinjau, galatPratinjau }
 */
export function kesiapanNotaKredit(f, { kandidat = [], pratinjau = null, memuatPratinjau = false, galatPratinjau = "" } = {}) {
  if (!["MANDIRI", "TERTAUT_REFUND"].includes(f.sumber)) return { siap: false, pesan: "Pilih jenis nota kredit." };
  if (f.sumber === "TERTAUT_REFUND") {
    if (!f.refundId) return { siap: false, pesan: "Pilih refund sumber." };
    const r = kandidat.find((k) => k.id === f.refundId);
    if (!r || !r.layak) return { siap: false, pesan: "Refund yang dipilih tidak bisa ditautkan." };
    if (angka(f.amount) > angka(r.potongan)) return { siap: false, pesan: "Nominal melebihi bagian refund yang menjadi potongan." };
  }
  if (!(angka(f.amount) > 0)) return { siap: false, pesan: "Isi nominal nota lebih dari 0." };
  if (String(f.alasan || "").trim().length < 5) return { siap: false, pesan: "Alasan minimal 5 karakter." };
  if (memuatPratinjau) return { siap: false, pesan: "Menghitung dampak di server…" };
  if (galatPratinjau) return { siap: false, pesan: galatPratinjau };
  if (!pratinjau) return { siap: false, pesan: "Dampak belum dihitung." };
  if (!f.konfirmasi) return { siap: false, pesan: "Centang konfirmasi dampak terlebih dahulu." };
  return { siap: true, pesan: "" };
}

/** Query pratinjau; null bila isian belum cukup untuk dihitung server. */
export function paramPratinjau(f) {
  if (!(angka(f.amount) > 0)) return null;
  if (f.sumber === "TERTAUT_REFUND" && !f.refundId) return null;
  const p = { amount: angka(f.amount), kind: f.jenis || "POTONGAN_HARGA" };
  if (f.sumber === "TERTAUT_REFUND") p.refundId = f.refundId;
  if (f.date) p.date = f.date;
  return p;
}

/** Body simpan — token revisi berasal dari pratinjau terakhir (server menolak bila data order sudah bergeser). */
export function bodySimpanNota(f, revisi) {
  return {
    amount: angka(f.amount), kind: f.jenis || "POTONGAN_HARGA", reason: String(f.alasan || "").trim(),
    ...(f.sumber === "TERTAUT_REFUND" ? { refundId: f.refundId } : {}),
    ...(f.date ? { date: f.date } : {}),
    revisi,
  };
}

/** Baris tabel dampak sebelum → sesudah, dari pratinjau server. */
export function barisDampak(p) {
  if (!p?.sebelum || !p?.sesudah) return [];
  const s = p.sebelum; const t = p.sesudah;
  return [
    { kunci: "tagihan", label: "Tagihan bersih", sebelum: s.tagihanBersih, sesudah: t.tagihanBersih, uang: true },
    { kunci: "bayar", label: "Pembayaran bersih", sebelum: s.pembayaranBersih, sesudah: t.pembayaranBersih, uang: true },
    { kunci: "sisa", label: "Sisa setelah nota", sebelum: s.sisa, sesudah: t.sisa, uang: true },
    { kunci: "status", label: "Status bayar", sebelum: labelStatusBayar(s.status), sesudah: labelStatusBayar(t.status), uang: false },
    { kunci: "paidAt", label: "Tanggal lunas (paidAt)", sebelum: s.paidAt || null, sesudah: t.paidAt || null, tanggal: true },
  ];
}

/** Keterangan jurnal sebuah nota di riwayat. */
export function keteranganJurnal(nota) {
  if (nota.jurnal) return `Jurnal ${nota.jurnal}${nota.jurnalBalik ? ` · dibalik ${nota.jurnalBalik}` : ""}`;
  return TANPA_JURNAL;
}

/** Siapkan teks galat server yang ramah (kode → kalimat Indonesia) untuk pratinjau/simpan. */
export function pesanGalatNota(e) {
  const kode = e?.code || e?.data?.code;
  const dasar = e?.message || "Gagal menghitung dampak nota kredit";
  if (kode === "REVISI_BERUBAH") return "Data order berubah sejak layar dibuka. Dampak dihitung ulang — periksa lagi sebelum menyimpan.";
  return dasar;
}
