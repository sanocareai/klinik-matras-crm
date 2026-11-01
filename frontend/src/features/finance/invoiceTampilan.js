// Logika PENYAJIAN halaman Invoice Pelanggan (murni, tanpa React). Hanya menyusun ulang field yang SUDAH dikirim GET /finance/invoices:
// tidak ada rumus, status, jatuh tempo, atau hak akses baru di sini. Nominal (totalTagihan/dibayar/sisa) dan status datang dari server apa adanya.

/** Status tampil dari server (statusEfektif): satu nilai yang mencampur tahap dokumen dan keadaan bayar. Label & nada sama dengan halaman lama. */
export const STATUS_INVOICE = Object.freeze({
  DRAFT: { label: "Draft", nada: "neutral" },
  SENT: { label: "Terkirim", nada: "biru" },
  VIEWED: { label: "Dilihat", nada: "biru" },
  PARTIALLY_PAID: { label: "Dibayar Sebagian", nada: "perhatian" },
  PAID: { label: "Lunas", nada: "green" },
  OVERDUE: { label: "Lewat Tempo", nada: "red" },
  CANCELLED: { label: "Dibatalkan", nada: "neutral" },
});

/** Tab jatuh tempo = filter SERVER (parameter jatuhTempo), sama dengan tombol pintas halaman lama. */
export const TAB_TEMPO = Object.freeze([
  { key: "", label: "Semua" },
  { key: "lewat", label: "Lewat jatuh tempo" },
  { key: "belum_diatur", label: "Belum ada jatuh tempo" },
]);

export const labelStatus = (status) => STATUS_INVOICE[status]?.label ?? (status || "—");
export const nadaStatus = (status) => STATUS_INVOICE[status]?.nada ?? "neutral";

/**
 * Status PEMBAYARAN, dipisah dari status dokumen. Diturunkan hanya dari field server yang sama dengan yang dipakai statusEfektif
 * (lunas, dibayar, dibayarTidakRinci). Penting karena "Lewat Tempo" di server mengalahkan "Dibayar Sebagian": tagihan yang telat tapi sudah
 * dibayar sebagian tampil "Lewat Tempo" saja; keadaan bayarnya tetap terbaca dari sini.
 */
export function statusBayar(inv) {
  if (inv?.status === "CANCELLED" || inv?.dibatalkan) return { kode: "dibatalkan", label: "Tidak ditagih", nada: "neutral" };
  if (inv?.lunas) return { kode: "lunas", label: "Lunas", nada: "green" };
  if (Number(inv?.dibayar) > 0 || inv?.dibayarTidakRinci) return { kode: "sebagian", label: "Dibayar sebagian", nada: "perhatian" };
  return { kode: "belum", label: "Belum dibayar", nada: "neutral" };
}

/** Keterangan bayar di bawah chip status di daftar; null bila hanya mengulang isi chip (Lunas / Dibayar Sebagian). */
export function keteranganBayar(inv) {
  const b = statusBayar(inv);
  if (inv?.status === "PAID" && b.kode === "lunas") return null;
  if (inv?.status === "PARTIALLY_PAID" && b.kode === "sebagian") return null;
  return b;
}

/** Tahap DOKUMEN (lifecycleStatus di server): draft → terkirim → dilihat, atau dibatalkan. Tidak mengatakan apa pun soal uang. */
export function statusDokumen(inv) {
  if (inv?.dibatalkan && inv?.lifecycleStatus !== "CANCELLED") return "Dibatalkan (semua order di invoice ini batal)";
  const peta = { DRAFT: "Draft — belum dikirim ke pelanggan", SENT: "Terkirim ke pelanggan", VIEWED: "Dilihat pelanggan", CANCELLED: "Dibatalkan" };
  return peta[inv?.lifecycleStatus] ?? labelStatus(inv?.lifecycleStatus);
}

/** Cara membaca sumber angka "dibayar": ledger pembayaran sungguhan vs status bayar manual di CRM (tanpa rincian siapa/kapan/berapa). */
export function sumberAngka(inv) {
  return inv?.sumber === "ledger"
    ? { kode: "ledger", label: "Ledger pembayaran", pendek: "Ledger", nada: "green" }
    : { kode: "manual", label: "Status manual di CRM", pendek: "Status manual", nada: "perhatian" };
}

/** Keadaan jatuh tempo untuk satu baris. `lewat` hanya bila server menghitung hari lewat > 0 dan invoice belum lunas (aturan halaman lama). */
export function keadaanTempo(inv) {
  if (!inv?.dueDate) return { diatur: false, lewat: 0 };
  return { diatur: true, lewat: inv.hariLewat > 0 && !inv.lunas ? inv.hariLewat : 0 };
}

/** Filter lokal (di browser) — SAMA dengan halaman lama: status tampil, sumber, sales, dan tempo sudah/belum diatur. */
export function filterInvoice(daftar, { fStatus, fSumber, fSales, fTempo }) {
  return daftar.filter((i) => {
    if (fStatus && i.status !== fStatus) return false;
    // Server mengirim sumber "ledger" atau "statusManual"; pilihan filter memakai "ledger" / "manual" (versi lama membandingkan mentah sehingga "Status manual" selalu kosong).
    if (fSumber && (i.sumber === "ledger" ? "ledger" : "manual") !== fSumber) return false;
    if (fSales && i.salesName !== fSales) return false;
    if (fTempo === "ada" && !i.dueDate) return false;
    if (fTempo === "belum" && i.dueDate) return false;
    return true;
  });
}

export const adaFilterLokal = ({ fStatus, fSumber, fSales, fTempo }) => !!(fStatus || fSumber || fSales || fTempo);

/** Jumlah filter di luar tab jatuh tempo yang sedang aktif (pencarian dipangkas) — untuk tombol "Atur ulang filter". */
export function jumlahFilterAktif({ q, fStatus, fSumber, fSales, fTempo, jatuhTempo }) {
  return [(q || "").trim(), fStatus, fSumber, fSales, fTempo, jatuhTempo].filter(Boolean).length;
}

/** Isi empat KPI dari respons server (nilai & populasi sama dengan halaman lama). */
export function kpiInvoice(data) {
  const r = data?.ringkasan;
  return {
    jumlah: r?.total ?? 0,
    sisaBelumLunas: r?.nilaiBelumLunas ?? 0,
    lewat: r?.lewatTempo ?? 0,
    tanpaTempo: r?.tanpaJatuhTempo ?? 0,
    manual: r?.dariStatusManual ?? 0,
    terpotong: !!data?.terpotong,
  };
}

/** Kalimat jumlah hasil + catatan batas data. Server memuat paling banyak 500 invoice terbaru (limit bawaan) dan menandai `terpotong`. */
export function kalimatHasil({ tampil, termuat, terpotong }) {
  const t = Number(tampil) || 0; const m = Number(termuat) || 0;
  const teks = t < m ? `${t.toLocaleString("id-ID")} dari ${m.toLocaleString("id-ID")} invoice` : `${t.toLocaleString("id-ID")} invoice`;
  return {
    teks,
    catatan: terpotong ? "Daftar memuat paling banyak 500 invoice terbaru, dan angka ringkasan di atas dihitung dari yang termuat itu. Gunakan pencarian untuk invoice yang lebih lama." : undefined,
    terpotong: !!terpotong,
  };
}
