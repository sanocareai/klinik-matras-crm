// LOGIKA MURNI LAPORAN KEUANGAN TERINCI (tanpa React/DOM supaya bisa dites langsung).
// Semua angka datang dari server (GET /finance/reports/income-statement/terinci & /drilldown) — di sini HANYA pelabelan, urutan, dan penyusunan parameter.
// JANGAN menghitung ulang angka laporan di klien: kartu, jembatan, HPP, dan beban divisi dihitung SATU kali di server dan dipakai juga oleh Export Excel.

export const METRIK_KARTU = Object.freeze(["pendapatan", "hpp", "laba_kotor", "beban_operasional", "laba_bersih"]);
export const LABEL_METRIK = Object.freeze({
  pendapatan: "Pendapatan Bersih", hpp: "Beban Pokok (HPP)", laba_kotor: "Laba Kotor", beban_operasional: "Beban Operasional", laba_bersih: "Laba Bersih",
});
export const SEKSI = Object.freeze([
  { key: "laporan", label: "Laba Rugi" },
  { key: "jembatan", label: "Jembatan Pendapatan" },
  { key: "pkr", label: "PKR" },
  { key: "hpp", label: "HPP & Mutu Margin" },
  { key: "divisi", label: "Beban per Divisi" },
  { key: "gap", label: "Gap Pembukuan" },
]);

export const TAB_DRILLDOWN = Object.freeze([
  { key: "akun", label: "Per akun" },
  { key: "jurnal", label: "Per jurnal" },
  { key: "divisi", label: "Per divisi" },
]);

/** Penanda mutu margin. `varian` = varian Badge. */
export function penandaMutu(hpp) {
  const s = hpp?.status;
  if (s === "LENGKAP") return { kunci: s, varian: "green", label: "HPP bahan lengkap", pesan: hpp.pesan, final: true };
  if (s === "BELUM_LENGKAP") return { kunci: s, varian: "orange", label: "HPP bahan belum lengkap — margin belum final", pesan: hpp.pesan, final: false };
  if (s === "TIDAK_BERLAKU") return { kunci: s, varian: "neutral", label: "Tidak ada unit terkirim", pesan: hpp.pesan, final: false };
  return { kunci: "TAK_DIKENAL", varian: "neutral", label: "Mutu margin belum dapat dinilai", pesan: "", final: false };
}

export const LABEL_SUMBER = Object.freeze({
  PENGAKUAN_PENDAPATAN: "Pengakuan pendapatan", PENJUALAN_KARYAWAN: "Penjualan karyawan", PEMBAYARAN_PENJUALAN_KARYAWAN: "Bayar penjualan karyawan", REFUND: "Refund", NOTA_KREDIT_ORDER: "Nota kredit",
  PENGELUARAN: "Pengeluaran", PEMBELIAN: "Pembelian", TAGIHAN_SUPPLIER: "Tagihan supplier", PEMBAYARAN_SUPPLIER: "Bayar supplier", PEMAKAIAN_BAHAN: "Pemakaian bahan",
  PENERIMAAN_BAHAN: "Penerimaan bahan", KASBON: "Kasbon", MANUAL: "Jurnal manual", REVERSAL: "Pembalik", BIAYA_KENDARAAN: "Biaya kendaraan", BIAYA_IKLAN: "Biaya iklan",
  INSENTIF_DRIVER: "Insentif driver", TRANSFER_KAS: "Transfer kas", UANG_MUKA_OPERASIONAL: "Uang muka operasional", SALDO_AWAL: "Saldo awal",
});
export const labelSumber = (s) => LABEL_SUMBER[s] ?? String(s ?? "").replace(/_/g, " ").toLowerCase();

export const LABEL_KELAS = Object.freeze({
  LUNAS_DIAKUI: "Lunas & diakui periode ini", LUNAS_DIAKUI_SEBELUM: "Lunas; diakui sebelum periode", LUNAS_BELUM_DISERAHKAN: "Lunas; belum diserahkan",
  LUNAS_DISERAHKAN_BELUM_DIAKUI: "Lunas & diserahkan; tak pernah diakui", DIAKUI_LUNAS_LAIN: "Diakui; lunas di periode lain", DIAKUI_BELUM_LUNAS: "Diakui; belum lunas (piutang)",
  PEMBALIK_PENGAKUAN_LAMA: "Pembalik pengakuan lama", LAIN_TERTAUT: "Order tertaut lain (periksa)",
});

export const LABEL_PEMENUHAN_PKR = Object.freeze({ DISERAHKAN: "Diserahkan", BELUM_DISERAHKAN: "Belum diserahkan", TANPA_ORDER_CRM: "Tanpa order CRM", DIBATALKAN: "Dibatalkan" });

export const LABEL_TAHAP_BUKTI = Object.freeze({
  EKSPLISIT: "Divisi tertulis di dokumen", RELASI: "Dari dokumen sumber", KATEGORI: "Dari pemetaan kategori", SHARED: "Biaya bersama", TIDAK_TERKLASIFIKASI: "Tidak ada bukti", BUKAN_BIAYA: "Bukan biaya divisi",
});

/** "Data dibaca 15 Okt 2026 08.32 WIB · buku terakhir 14 Okt 2026". */
export function formatCutoff(cutoff) {
  if (!cutoff?.diambilPadaWib) return "";
  const [tgl, jam] = String(cutoff.diambilPadaWib).split(" ");
  const bagian = [`Data dibaca ${tanggalPanjang(tgl)} ${String(jam || "").slice(0, 5).replace(":", ".")} WIB`];
  if (cutoff.tanggalBukuTerakhir) bagian.push(`buku terakhir ${tanggalPanjang(cutoff.tanggalBukuTerakhir)}`);
  if (cutoff.periodeMelewatiBuku) bagian.push("periode melewati data buku");
  return bagian.join(" · ");
}
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export function tanggalPanjang(t) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(t || ""));
  return m ? `${Number(m[3])} ${BULAN[Number(m[2]) - 1]} ${m[1]}` : String(t || "");
}

/** Ringkas kontrol parity: { ok, gagal:[label] }. */
export function ringkasKontrol(kontrol) {
  const daftar = kontrol?.daftar ?? [];
  return { ok: daftar.length > 0 && daftar.every((k) => k.ok), jumlah: daftar.length, gagal: daftar.filter((k) => !k.ok).map((k) => k.label) };
}

/** Parameter GET drilldown (nilai kosong dibuang oleh qsFinance di api.js). */
export function paramDrilldown(periode, metrik, filter = {}) {
  return { from: periode?.from, to: periode?.to, metrik, akun: filter.akun || "", divisi: filter.divisi || "", sumber: filter.sumber || "", q: (filter.q || "").trim() };
}

/** Body POST export yang membawa filter aktif + cutoff layar (supaya Excel mencetak cutoff yang sama dengan yang dilihat pengguna). */
export function bodyExport(periode, { metrik = null, filter = {}, cutoff = null } = {}) {
  const f = {};
  if (metrik) f.metrik = metrik;
  for (const k of ["akun", "divisi", "sumber", "q"]) if (filter[k]) f[k] = filter[k];
  if (cutoff?.diambilPadaWib) f.cutoffLayar = cutoff.diambilPadaWib;
  const label = [metrik ? `Metrik: ${LABEL_METRIK[metrik]}` : null, filter.akun ? `Akun: ${filter.akun}` : null, filter.divisi ? `Divisi: ${filter.divisi}` : null, filter.sumber ? `Sumber: ${filter.sumber}` : null, filter.q ? `Cari: ${filter.q}` : null].filter(Boolean).join("; ");
  return { periode: { from: periode.from, to: periode.to }, filter: f, filterLabel: label };
}

/** Tanda & kelas warna nominal bertanda pada langkah jembatan. */
export function gayaLangkah(l) {
  if (l.subtotal) return "subtotal";
  if (l.temuan) return "temuan";
  return l.nominal < 0 ? "kurang" : "biasa";
}

/** Daftar langkah jembatan dipecah per bagian (Sales | Buku Besar) untuk tampilan dua kolom di layar lebar. */
export function pecahJembatan(langkah = []) {
  return { sales: langkah.filter((l) => l.bagian === "SALES"), ledger: langkah.filter((l) => l.bagian === "LEDGER") };
}

/** Nama divisi urut seperti server; "Belum teratribusi" dan "Biaya Bersama" diberi penanda khusus. */
export function penandaDivisi(scope) {
  if (scope === "TIDAK_TERKLASIFIKASI") return { varian: "orange", label: "Belum teratribusi" };
  if (scope === "SHARED") return { varian: "neutral", label: "Biaya bersama" };
  return null;
}

/** Apakah tombol drilldown kartu boleh dibuka (butuh data terinci dari server). */
export const bisaDrilldown = (terinci) => Array.isArray(terinci?.kartu) && terinci.kartu.length === METRIK_KARTU.length;
