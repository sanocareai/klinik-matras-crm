// Logika PENYAJIAN halaman Ringkasan Keuangan (murni, tanpa React) — hanya menyusun ulang angka/teks yang SUDAH dikirim backend.
// TIDAK ada perhitungan akuntansi baru: tidak ada selisih yang dihitung klien, tidak ada saldo yang dijumlah/dikurangkan di sini.

const angka = (v) => Number(v) || 0;

/** Rapikan nama bank dari input bebas: trim + gabungkan spasi (termasuk spasi tak-terputus/tab). */
export function normalisasiBank(v) { return String(v ?? "").replace(/[\s\u00A0]+/g, " ").trim(); }

/** Jenis rekening untuk logo. HANYA dari `kind` dan `bankName` rekening — jangan menebak dari nama rekening/nama pemilik. */
export function jenisRekening(r) {
  if (r?.kind === "KAS") return { jenis: "TUNAI", namaBank: null };
  if (r?.kind === "EWALLET") return { jenis: "EWALLET", namaBank: null };
  // Normalisasi: trim, spasi berlebih → satu spasi, tanpa membedakan kapital (regex berflag i). Tidak menebak dari nama rekening.
  const bank = normalisasiBank(r?.bankName);
  if (/^(bca|bank\s+central\s+asia|pt\.?\s*bank\s+central\s+asia(\s+tbk\.?)?)$/i.test(bank)) return { jenis: "BCA", namaBank: "BCA" };
  if (/^(mandiri|bank\s+mandiri|pt\.?\s*bank\s+mandiri(\s*\(persero\)\s*tbk\.?)?)$/i.test(bank)) return { jenis: "MANDIRI", namaBank: "Mandiri" };
  return { jenis: "BANK_LAIN", namaBank: bank || null };
}

/** Teks identitas sekunder rekening: nama bank/jenis + nomor rekening (sama dengan tampilan lama). */
export function keteranganRekening(r) {
  const dasar = r.kind === "KAS" ? "Kas tunai" : r.kind === "BANK" ? (normalisasiBank(r.bankName) || "Bank") : "E-wallet";
  return r.accountNumber ? `${dasar} · ${r.accountNumber}` : dasar;
}

// ─── Strip status data ──────────────────────────────────────────────────────

export const TEKS_STRIP = Object.freeze({
  belumLengkap: { judul: "Data belum lengkap", isi: "Sebagian transaksi belum masuk pembukuan. Angka masih sementara." },
  sumberHilang: { judul: "Sebagian data tidak dapat dimuat", isi: "Angka di bawah masih sementara sampai data tersebut tersedia." },
  lengkap: { judul: "Tidak ada kekurangan pencatatan yang terdeteksi", isi: "Konfirmasi rekening dan pencocokan saldo diperiksa terpisah." },
});

/** Keadaan strip: ada butir bermasalah → "belumLengkap"; hanya sumber yang tidak termuat → "sumberHilang"; selain itu "lengkap". Kondisi sama dengan banner lama (kualitas.belumFinal). */
export function keadaanStrip(kualitas) {
  if (!kualitas?.belumFinal) return "lengkap";
  return kualitas.jumlahBermasalah > 0 ? "belumLengkap" : "sumberHilang";
}

/** Baris selisih rekening yang kondisinya bersih (tidak ada rekening berstatus SELISIH). BUKAN pernyataan bahwa semua saldo cocok: rekening belum dikonfirmasi dan dana tanpa sumber tidak termasuk. */
export const TEKS_TANPA_SELISIH = Object.freeze({
  label: "Tidak ada selisih tercatat",
  penjelasan: "Ini hanya menunjukkan selisih yang tercatat. Rekening yang belum dikonfirmasi dan dana yang sumbernya belum diketahui tetap perlu diperiksa.",
});

// ─── Panel "Perlu ditindaklanjuti" ──────────────────────────────────────────

/** Cakupan waktu tiap kelompok, hanya yang didukung sumbernya (antrean backend tidak memakai filter periode). */
export const CAKUPAN = Object.freeze({
  semuaPeriode: "Semua periode",
  posisiTerbaru: "Posisi terbaru",
});

const statusDari = (jumlah) => (jumlah === null || jumlah === undefined ? "tanpa-data" : jumlah === 0 ? "bersih" : "perlu");
const nilaiAtauNull = (v) => (v === null || v === undefined ? null : angka(v));

/**
 * Susun pekerjaan menjadi kelompok. TIDAK ada total gabungan antar kategori (bisa tumpang tindih; definisi berbeda).
 * Setiap baris: { id, judul, jumlah (null = tidak tersedia, BUKAN nol), satuan, nilai, status: perlu|bersih|tanpa-data, tujuan, penjelasan, labelBersih? }.
 * Hanya membaca angka yang sudah dikirim backend; tidak ada persetujuan/verifikasi otomatis.
 */
export function susunTindakLanjut({ antrean, kualitas, riil, bukti }) {
  const per = new Map((kualitas?.butir ?? []).map((b) => [b.id, b]));
  const baris = (o) => ({ nilai: null, ...o, status: statusDari(o.jumlah) });

  const b1 = per.get("pembayaran_belum_tercatat"), b2 = per.get("order_belum_diakui"), b3 = per.get("transaksi_belum_lengkap");
  const pencatatan = [
    baris({ id: "pembayaran_belum_tercatat", judul: "Pembayaran belum tercatat di pembukuan", jumlah: b1 ? b1.jumlah : null, satuan: "order", nilai: b1 ? b1.nilai : null, tujuan: b1?.tujuan ?? "/finance/payments",
      penjelasan: "Lunas menurut CRM, tetapi belum ada catatan pembayaran dan rekening, jadi belum ada jurnal kas." }),
    baris({ id: "order_belum_diakui", judul: "Order belum diakui sebagai pendapatan", jumlah: b2 ? b2.jumlah : null, satuan: "order", nilai: b2 ? b2.nilai : null, tujuan: b2?.tujuan ?? "/finance/pemasukan",
      penjelasan: `Order sudah selesai diserahterimakan, tetapi pendapatannya belum dibukukan (${ISTILAH.lengkapiOrderLama.tampil.toLowerCase()} belum dijalankan). Istilah asli: ${ISTILAH.lengkapiOrderLama.asli}.` }),
    baris({ id: "transaksi_belum_lengkap", judul: "Transaksi belum lengkap", jumlah: b3 ? b3.jumlah : null, satuan: "transaksi", tujuan: b3?.tujuan ?? "/finance/settings",
      penjelasan: "Tertahan karena datanya belum lengkap (mis. rekening belum dipetakan), jadi belum masuk buku besar." }),
  ];

  // Saldo rekening: tiga hal yang BERBEDA — selisih tercatat, rekening belum dikonfirmasi, dana tanpa sumber.
  const rek = riil?.rekening ?? [];
  const selisih = rek.filter((r) => r.status === "SELISIH");
  const dana = riil?.danaBelumTeridentifikasi;
  let selisihBaris;
  if (!riil) selisihBaris = baris({ id: "selisih_rekening", judul: "Selisih rekening yang perlu ditinjau", jumlah: null, satuan: "rekening", tujuan: "/finance/reconciliation", penjelasan: "Data saldo terkonfirmasi tidak dapat dimuat." });
  else if (selisih.length === 0) selisihBaris = baris({ id: "selisih_rekening", judul: "Selisih rekening yang perlu ditinjau", jumlah: 0, satuan: "rekening", tujuan: "/finance/reconciliation", labelBersih: TEKS_TANPA_SELISIH.label, penjelasan: TEKS_TANPA_SELISIH.penjelasan });
  else selisihBaris = baris({ id: "selisih_rekening", judul: "Selisih rekening yang perlu ditinjau", jumlah: selisih.length, satuan: "rekening", nilai: selisih.length === 1 ? Math.abs(angka(selisih[0].selisih)) : null,
    tujuan: selisih.length === 1 && selisih[0].periodeId ? `/finance/reconciliation?periode=${selisih[0].periodeId}` : "/finance/reconciliation",
    penjelasan: `${selisih.map((r) => `${r.name.replace(/\s*-\s*Sano Bank/i, "").trim()}: ${formatRp(r.selisih)}`).join(" · ")}. Selisih dibaca dari sistem pada tanggal acuan; positif = saldo pembukuan lebih tinggi dari saldo terkonfirmasi.` });
  const belumKonfirmasi = riil ? rek.filter((r) => r.status === "BELUM_DIKONFIRMASI").length : null;
  const rekeningDana = dana?.items ? new Set(dana.items.map((i) => i.rekening)).size : 0;
  const saldoRek = [
    selisihBaris,
    baris({ id: "belum_dikonfirmasi", judul: "Rekening belum dikonfirmasi", jumlah: belumKonfirmasi, satuan: "rekening", tujuan: "/finance/reconciliation",
      penjelasan: "Rekening ini belum punya saldo terkonfirmasi, jadi belum bisa dicocokkan. Ini bukan saldo Rp0 dan bukan berarti saldonya cocok." }),
    baris({ id: "dana_belum_diketahui", judul: "Dana belum diketahui sumbernya", jumlah: riil ? (angka(dana?.total) > 0 ? rekeningDana || 1 : 0) : null, satuan: "rekening", nilai: riil && angka(dana?.total) > 0 ? angka(dana.total) : null, tujuan: "/finance/reconciliation",
      penjelasan: `${KALIMAT.danaBelumDiketahui} Istilah asli: ${ISTILAH.sumberDanaBelumDiketahui.asli}.` }),
  ];

  const a = antrean ?? {};
  const persetujuan = [
    baris({ id: "pembayaran_belum_diverifikasi", judul: "Pembayaran menunggu verifikasi", jumlah: nilaiAtauNull(a.jumlahPembayaranBelumVerifikasi), satuan: "pembayaran", tujuan: "/finance/payments",
      penjelasan: "Uang yang tercatat diterima sales/driver tetapi belum dicocokkan dengan setoran nyata di rekening." }),
    baris({ id: "pengeluaran_menunggu", judul: "Pengeluaran menunggu persetujuan", jumlah: nilaiAtauNull(a.pengeluaranMenunggu), satuan: "pengeluaran", tujuan: "/finance/expenses",
      penjelasan: "Pengeluaran yang sudah diajukan tetapi belum disetujui — belum masuk buku besar." }),
    baris({ id: "pembelian_menunggu", judul: "Pembelian menunggu persetujuan", jumlah: nilaiAtauNull(a.pembelianMenunggu), satuan: "pembelian", tujuan: "/finance/purchases",
      penjelasan: "Pembelian bahan/aset/uang muka yang belum disetujui — belum masuk buku besar." }),
    baris({ id: "tagihan_supplier_menunggu", judul: "Tagihan supplier menunggu persetujuan", jumlah: nilaiAtauNull(a.tagihanMenunggu), satuan: "tagihan", tujuan: "/finance/suppliers",
      penjelasan: "Tagihan supplier yang sudah diinput tetapi belum disetujui — belum tercatat sebagai utang." }),
    baris({ id: "refund_menunggu", judul: "Refund menunggu persetujuan", jumlah: nilaiAtauNull(a.refundMenunggu), satuan: "refund", tujuan: "/finance/payments",
      penjelasan: "Permintaan refund yang belum disetujui — belum keluar dari kas." }),
  ];

  const nBukti = bukti ? bukti.items.length : null;
  const buktiBaris = baris({ id: "bukti_transaksi", judul: "Bukti transaksi perlu diperiksa", jumlah: nBukti, satuan: "bukti terdeteksi", tujuan: null,
    ringkas: bukti ? `${angkaID(bukti.belumDiverifikasi)} nota menunggu verifikasi · ${angkaID(bukti.tanpaNota)} transaksi wajib nota tetapi belum ada` : null,
    catatanBatas: bukti ? BATAS_DATA_BUKTI : null,
    penjelasan: bukti ? `${bukti.belumDiverifikasi} nota menunggu verifikasi orang lain · ${bukti.tanpaNota} transaksi wajib nota tetapi belum ada. Dihitung dari 200 pengeluaran dan 200 pembelian terbaru sejak kebijakan nota berlaku; bila lebih banyak, yang lebih lama tidak ikut terhitung.` : "Data bukti tidak dapat dimuat." });

  return [
    { id: "pencatatan", judul: "Pencatatan", cakupan: CAKUPAN.semuaPeriode, baris: pencatatan },
    { id: "saldo", judul: "Saldo rekening", cakupan: `${CAKUPAN.posisiTerbaru} · pencocokan per ${ISTILAH.tanggalAcuan.tampil.toLowerCase()}`, baris: saldoRek },
    { id: "persetujuan", judul: "Persetujuan", cakupan: CAKUPAN.semuaPeriode, baris: persetujuan },
    { id: "bukti", judul: "Bukti transaksi", cakupan: "Sejak kebijakan nota berlaku", baris: [buktiBaris] },
  ];
}

export const BATAS_DATA_BUKTI = "Dari maksimal 200 pengeluaran dan 200 pembelian terbaru.";
const angkaID = (n) => Number(n || 0).toLocaleString("id-ID");

/** Pisahkan baris yang terlihat (ada pekerjaan atau datanya tidak tersedia) dari yang bernilai nol. Nol tidak dibuang: tersedia lewat "Tampilkan semua kategori". */
export function pisahkanTindakLanjut(kelompok, tampilSemua) {
  return kelompok.map((g) => {
    const terlihat = g.baris.filter((b) => b.status !== "bersih");
    const nol = g.baris.filter((b) => b.status === "bersih");
    return { ...g, terlihat: tampilSemua ? g.baris : terlihat, nol };
  });
}

const formatRp = (n) => { const v = angka(n); return `${v < 0 ? "-" : ""}Rp${Math.abs(v).toLocaleString("id-ID")}`; };

// ─── Laba rugi: kondisi semua komponen nol ──────────────────────────────────

const KOMPONEN_LR = ["pendapatanBruto", "retur", "pendapatanBersih", "bebanPokok", "labaKotor", "bebanOperasional", "labaBersih"];
/** TRUE hanya bila data termuat dan SEMUA komponen perhitungan benar-benar 0 (komponen hilang/undefined = tidak diketahui, bukan nol). */
export function semuaKomponenNol(lr) {
  if (!lr) return false;
  return KOMPONEN_LR.every((k) => lr[k] !== undefined && lr[k] !== null && Number(lr[k]) === 0);
}
export const TEKS_LABA_NOL = "Seluruh komponen laba rugi bernilai Rp0 pada periode ini.";

// ─── Umur tagihan pelanggan ─────────────────────────────────────────────────

/** Dasar umur menurut data: tertua dihitung dari jatuh tempo invoice, atau dari tanggal order bila invoice tidak punya jatuh tempo. */
export function dasarUmurTertua(tertua) {
  if (!tertua) return null;
  return tertua.dariTanggalOrder ? "dihitung dari tanggal order (tanpa jatuh tempo)" : "dihitung dari jatuh tempo invoice";
}
export const KETERANGAN_UMUR = "Umur dihitung dari jatuh tempo invoice; bila invoice tidak punya jatuh tempo, dari tanggal order dibuat.";

// ─── Daftar bukti: tampilan awal ringkas, semua data tetap bisa dibuka ──────

export const BUKTI_AWAL = 5;
export const BUKTI_PER_HALAMAN = 15;
/** Potong daftar bukti. mode "awal" = BUKTI_AWAL entri; "semua" = halaman ke-n (BUKTI_PER_HALAMAN) dari SELURUH entri yang dimuat. */
export function potongBukti(items, mode, halaman = 0) {
  const total = items.length;
  if (mode !== "semua") return { baris: items.slice(0, BUKTI_AWAL), total, halaman: 0, jumlahHalaman: 1, adaLagi: total > BUKTI_AWAL };
  const jumlahHalaman = Math.max(1, Math.ceil(total / BUKTI_PER_HALAMAN));
  const h = Math.min(Math.max(0, halaman), jumlahHalaman - 1);
  return { baris: items.slice(h * BUKTI_PER_HALAMAN, (h + 1) * BUKTI_PER_HALAMAN), total, halaman: h, jumlahHalaman, adaLagi: false };
}

// ─── Tabel "Saldo rekening" ─────────────────────────────────────────────────

export const STATUS_PENCOCOKAN = Object.freeze({
  SESUAI: { label: "Sesuai", tone: "green" },
  SELISIH: { label: "Ada selisih", tone: "red" },
  BELUM_DIKONFIRMASI: { label: "Belum dikonfirmasi", tone: "neutral" },
  TIDAK_ADA_SALDO_RIIL: { label: "Tidak ada saldo terkonfirmasi", tone: "neutral" },
});

/**
 * Bahan tampilan satu baris rekening. `r` = baris kasBank dashboard (saldo = posisi sekarang); `x` = baris saldo-riil (saldoBuku = saldo pembukuan PADA tanggal acuan,
 * saldoRiil, selisih, status — semuanya dihitung server pada tanggal acuan yang sama); `riil` = respons saldo-riil utuh (null bila gagal dimuat).
 * Tidak ada pengurangan saldo di sini: selisih HANYA dibaca dari server.
 */
export function bahanBarisRekening(r, x, riil) {
  const tanggalAcuan = riil?.cutoffLabel ?? null;
  const bukuBerbeda = !!x && Math.abs(angka(x.saldoBuku) - angka(r.saldo)) >= 1;
  let terkonfirmasi;
  if (!riil) terkonfirmasi = { keadaan: "tidak-tersedia", nilai: null, keterangan: "Data tidak dapat dimuat" };
  else if (!x || x.saldoRiil === null || x.saldoRiil === undefined) terkonfirmasi = { keadaan: "belum", nilai: null, keterangan: "Tanggal acuan belum ada" };
  else terkonfirmasi = { keadaan: "ada", nilai: x.saldoRiil, keterangan: tanggalAcuan ? `Per ${tanggalAcuan}` : "Tanggal acuan tidak tersedia" };
  const status = x ? STATUS_PENCOCOKAN[x.status] ?? null : null;
  const perluTindakan = x?.status === "SELISIH";
  // Kalimat penjelas: APA yang dicocokkan dan PADA tanggal mana — tanpa menghitung angka baru.
  const baris = [];
  if (x && x.saldoRiil !== null && x.saldoRiil !== undefined && tanggalAcuan) {
    baris.push({ k: "acuan", teks: `Pencocokan dilakukan pada tanggal acuan ${tanggalAcuan}: saldo pembukuan pada tanggal itu dibandingkan dengan saldo terkonfirmasi.` });
    baris.push({ k: "bukuAcuan", nilai: x.saldoBuku, label: "Saldo pembukuan pada tanggal acuan" });
    baris.push({ k: "riil", nilai: x.saldoRiil, label: "Saldo terkonfirmasi" });
    baris.push({ k: "selisih", nilai: x.selisih, label: "Selisih pada tanggal acuan", catatan: "Positif = saldo pembukuan lebih tinggi dari saldo terkonfirmasi." });
    if (bukuBerbeda) baris.push({ k: "berbeda", teks: "Saldo pembukuan di tabel adalah posisi terbaru, jadi bisa berbeda dari saldo pada tanggal acuan karena ada transaksi setelahnya. Selisih tidak dihitung dari dua saldo tersebut." });
  } else if (riil) {
    if (x && bukuBerbeda) baris.push({ k: "bukuAcuan", nilai: x.saldoBuku, label: tanggalAcuan ? `Saldo pembukuan pada tanggal acuan (${tanggalAcuan})` : "Saldo pembukuan pada tanggal acuan" });
    baris.push({ k: "belum", teks: "Saldo terkonfirmasi untuk rekening ini belum ada, jadi pencocokan belum bisa dilakukan. Ini bukan saldo Rp0." });
  } else {
    baris.push({ k: "hilang", teks: "Data saldo terkonfirmasi tidak dapat dimuat saat ini." });
  }
  return { terkonfirmasi, status, perluTindakan, bukuBerbeda, tanggalAcuan, baris, danaBelumDikenal: angka(x?.danaBelumTeridentifikasi) };
}

/** Bahasa sederhana untuk istilah akuntansi; istilah asli tetap tersedia sebagai tooltip. */
export const ISTILAH = Object.freeze({
  pencocokanSaldo: { tampil: "Pencocokan saldo", asli: "Rekonsiliasi rekening" },
  tanggalAcuan: { tampil: "Tanggal acuan", asli: "Cutoff" },
  lengkapiOrderLama: { tampil: "Melengkapi data order lama", asli: "Backfill order" },
  sumberDanaBelumDiketahui: { tampil: "Sumber dana belum diketahui", asli: "Menunggu identifikasi dana" },
  penyesuaianPengurangBiaya: { tampil: "Penyesuaian pengurang biaya", asli: "Pembalik beban" },
});

export const KALIMAT = Object.freeze({
  penjelasanBanner: "Pendapatan 2026 masih dicocokkan dengan data sebelum sistem dipakai, dan data order lama masih dilengkapi. Angka belum final.",
  penjelasanPencocokan: "Pencocokan sementara tanpa rekening koran. Saldo akhir sudah dikonfirmasi pemilik, tetapi mutasi satu per satu belum semuanya diperiksa.",
  danaBelumDiketahui: "Dana ini ditampung di akun sementara “Dana Masuk Belum Teridentifikasi” (2-1700): bukan pendapatan dan bukan periode pencocokan yang selesai. Sumbernya perlu dibuktikan (rekening koran) sebelum dipindahkan ke akun yang benar.",
  penyesuaianBiaya: "Ada penyesuaian yang mengurangi biaya.",
});

/** KPI saldo/tagihan/utang: server TIDAK mengirim tanggal posisi, jadi tidak ada tanggal yang ditampilkan (jam perangkat bukan tanggal terverifikasi server). */
export const LABEL_POSISI = "Posisi terbaru dalam pembukuan";
export const CATATAN_POSISI = "Angka ini mengikuti tanggal buku hari ini (WIB) menurut server, bukan rentang tanggal laba di atas. Mengubah periode tidak mengubah angka ini.";
export const LABEL_RENTANG_LABA = "Rentang periode yang dipilih";
