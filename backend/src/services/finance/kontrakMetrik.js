// KONTRAK METRIK KANONIS FINANCE (Fase 1 — Kontrak Angka dan Kejelasan UI, 1 Okt 2026).
//
// SATU tempat yang mendefinisikan SETIAP angka yang tampil di layar Finance, layar Sales, dan Export Excel: nama, definisi, rumus, sumber data, status yang dihitung, basis
// tanggal, apa yang termasuk/tidak termasuk, dan PASANGAN rekonsiliasinya (angka lain yang sering disalahartikan sama). Klien TIDAK menghitung atau mendefinisikan sendiri — layar
// (tooltip, basis tanggal, panel "Kenapa angkanya berbeda?") dan Excel (sheet "Definisi Angka") membaca kontrak ini lewat GET /api/finance/kontrak-metrik.
//
// TIGA JENIS BASIS TANGGAL — sumber utama kenapa dua angka "yang sama" berbeda:
//   TGL_PEMBAYARAN  tanggal catatan pembayaran (Payment.createdAt, WIB)
//   TGL_BUKU        tanggal jurnal buku besar (FinJournalEntry.date) — pengakuan akuntansi
//   TGL_LUNAS       tanggal order menjadi Lunas (Order.paidAt, WIB; basis komisi Sales)
//   TGL_DOKUMEN     tanggal dokumen sumber (pengeluaran, pembelian, kasbon, refund, tagihan)
//   POSISI          posisi (saldo) per tanggal akhir periode / hari ini — bukan arus
//
// Menambah/mengubah metrik: ubah di sini, lalu `node scripts/finance-kontrak-doc.js` memperbarui docs/FINANCE-KONTRAK-METRIK.md. Tes tata-kelola
// (tests/financeKontrakMetrik.test.js) menolak metrik tanpa definisi/rumus/sumber/basis, pasangan yang menunjuk metrik yang tidak ada, dan kartu UI yang memakai kunci yang tidak ada.

export const BASIS = Object.freeze({
  TGL_PEMBAYARAN: { kunci: "TGL_PEMBAYARAN", label: "Tanggal pembayaran diterima", teknis: "Payment.createdAt (WIB)" },
  TGL_BUKU: { kunci: "TGL_BUKU", label: "Tanggal buku (jurnal)", teknis: "FinJournalEntry.date" },
  TGL_LUNAS: { kunci: "TGL_LUNAS", label: "Tanggal order menjadi Lunas", teknis: "Order.paidAt (WIB)" },
  TGL_DOKUMEN: { kunci: "TGL_DOKUMEN", label: "Tanggal dokumen", teknis: "tanggal pada dokumen sumber" },
  POSISI: { kunci: "POSISI", label: "Posisi per tanggal", teknis: "saldo kumulatif sampai tanggal itu" },
});

export const KELOMPOK = Object.freeze({
  PELANGGAN: "Uang & penjualan pelanggan",
  SALES: "Sales & komisi",
  BIAYA: "Biaya, pembelian & utang",
  KAS: "Kas, bank & rekonsiliasi",
  ASET: "Aset, kasbon & persediaan",
  LAPORAN: "Laporan keuangan",
});

/**
 * Bentuk satu metrik:
 *  kunci, nama, kelompok, definisi (1–2 kalimat awam), rumus, sumber, status (yang DIHITUNG), basis (kunci BASIS), termasuk[], tidakTermasuk[], pasangan[] (kunci metrik terkait),
 *  halaman[] (tempat angka ini tampil), ekspor[] (modul export yang memuatnya; kosong = tidak diekspor).
 */
const m = (kunci, nama, kelompok, definisi, rumus, sumber, status, basis, termasuk, tidakTermasuk, pasangan, halaman, ekspor = []) => ({
  kunci, nama, kelompok, definisi, rumus, sumber, status, basis, termasuk, tidakTermasuk, pasangan, halaman, ekspor,
});

export const METRIK = Object.freeze([
  // ═══ UANG & PENJUALAN PELANGGAN ════════════════════════════════════════════════════════════════════════════════
  m("payment_tercatat", "Payment Tercatat", "PELANGGAN",
    "Semua catatan pembayaran pelanggan yang pernah dibuat, apa pun statusnya. Ini BUKAN uang masuk pasti: sebagian masih menunggu verifikasi, ditolak, atau dibatalkan.",
    "Σ Payment.amount (semua status)", "tabel payments", "menunggu, terverifikasi, ditolak, dibatalkan", "TGL_PEMBAYARAN",
    ["Pembayaran yang belum diverifikasi Finance", "Pembayaran yang kemudian dibatalkan"], ["Klaim Lunas yang belum menjadi Payment"],
    ["uang_masuk_terverifikasi", "klaim_lunas_menunggu"], ["Pembayaran & Verifikasi"], ["pembayaran"]),
  m("uang_masuk_terverifikasi", "Uang Masuk Terverifikasi", "PELANGGAN",
    "Uang pelanggan yang SUDAH diverifikasi Finance, dihitung per tanggal pembayaran diterima. Ini angka uang (sisi Finance), belum tentu sama dengan omzet order yang lunas bulan itu.",
    "Σ Payment.amount WHERE aktif (tidak dibatalkan) AND punya verifikasi, tanggal = Payment.createdAt WIB", "tabel payments + payment_verifications", "terverifikasi", "TGL_PEMBAYARAN",
    ["DP, cicilan, dan pelunasan", "Ongkir yang ikut dibayar", "Pembayaran sebelum tanggal saldo awal (tidak menambah kas)"], ["Pembayaran menunggu/ditolak/dibatalkan", "Klaim Lunas yang belum diverifikasi"],
    ["kas_masuk_pelanggan", "nilai_order_lunas_perusahaan", "payment_tercatat"], ["Pembayaran & Verifikasi", "Pemasukan (Uang Masuk)", "Rekonsiliasi Sales–Finance"], ["pembayaran", "pemasukan", "rekon-sales-finance"]),
  m("kas_masuk_pelanggan", "Kas Masuk dari Pelanggan (Menurut Buku)", "PELANGGAN",
    "Uang pelanggan yang benar-benar menambah saldo Kas/Bank di buku besar. Lebih kecil dari Uang Masuk Terverifikasi bila ada pembayaran sebelum tanggal saldo awal (sudah termasuk saldo bank asli).",
    "Σ debit akun Kas/Bank pada jurnal sumber PEMBAYARAN_ORDER (POSTED)", "tabel fin_journal_entries/lines", "terposting", "TGL_BUKU",
    ["Pembayaran setelah tanggal saldo awal yang sudah dibukukan"], ["Pembayaran sebelum saldo awal (dijurnal ke Laba Ditahan, kas tidak berubah)", "Pembayaran terverifikasi yang belum dibukukan (gap)"],
    ["uang_masuk_terverifikasi", "arus_kas_masuk"], ["Arus Kas", "Jembatan Uang Masuk → Kas"], []),
  m("klaim_lunas_menunggu", "Klaim Lunas Menunggu Verifikasi", "PELANGGAN",
    "Pengajuan Sales bahwa order sudah dibayar. Klaim BELUM mengubah status, Payment, jurnal, atau saldo — baru berubah setelah Finance memverifikasi.",
    "COUNT/Σ klaim berbukti status SUBMITTED + order berstatus Lunas lama tanpa Payment penuh", "tabel order_payment_claims + Order", "diajukan (menunggu), diminta bukti", "TGL_DOKUMEN",
    ["Klaim berbukti baru dari Sales", "Klaim lama (Lunas tanpa Payment, 'Bukti belum lengkap')"], ["Klaim yang sudah diverifikasi/ditolak/ditarik"],
    ["uang_masuk_terverifikasi", "order_lunas_terverifikasi"], ["Dashboard", "Pembayaran & Verifikasi (Klaim Lunas)"], ["pembayaran"]),
  m("order_lunas_terverifikasi", "Order Lunas Terverifikasi", "PELANGGAN",
    "Order yang statusnya Lunas karena Payment terverifikasi sudah mencapai tagihan (nilai order + ongkir yang ditagih). Status Lunas hanya dihasilkan sistem dari ledger setelah gerbang Klaim Lunas aktif.",
    "Order.paymentStatus = LUNAS AND Σ Payment terverifikasi ≥ tagihan kanonis", "tabel Order + payments", "lunas", "TGL_LUNAS",
    ["Order tunggal dan child Resi (alokasi)"], ["Order berstatus Lunas tanpa Payment (klaim lama)", "Order batal/pending/spam"],
    ["nilai_order_lunas_perusahaan", "klaim_lunas_menunggu"], ["Laporan Sales", "Rekonsiliasi Sales–Finance"], ["rekon-sales-finance"]),
  m("nilai_order_lunas_perusahaan", "Nilai Order yang Menjadi Lunas — Total Perusahaan", "PELANGGAN",
    "Nilai penuh semua order yang mencapai lunas pada periode (basis tanggal lunas), termasuk yang tanpa Sales. Tidak selalu sama dengan uang masuk karena DP, ongkir, dan pembayaran lintas periode.",
    "Σ Order.value WHERE paidAt di periode AND status bukan CANCELLED/PENDING AND pelanggan bukan SPAM", "tabel Order", "lunas", "TGL_LUNAS",
    ["Order tanpa atribusi Sales"], ["Ongkir (bukan nilai jasa)", "DP order yang belum lunas", "Order batal/pending/spam"],
    ["uang_masuk_terverifikasi", "nilai_lunas_tim_sales"], ["Rekonsiliasi Sales–Finance"], ["rekon-sales-finance"]),
  m("nilai_lunas_tim_sales", "Nilai Order yang Menjadi Lunas — Tim Sales", "SALES",
    "Angka kartu di Laporan Sales (dasar komisi): Total Perusahaan dikurangi order tanpa Sales, ditambah order yang dihitung untuk lebih dari satu Sales.",
    "nilai_order_lunas_perusahaan − tanpa_atribusi_sales + dihitung_ganda", "tabel Order + atribusi (salesOwnerId / percakapan)", "lunas", "TGL_LUNAS",
    ["Sales aktif dan closing Team Lead"], ["Order tanpa Sales", "Closing Admin/Owner selain Team Lead"],
    ["nilai_order_lunas_perusahaan", "tanpa_atribusi_sales"], ["Laporan Sales", "Rekonsiliasi Sales–Finance"], ["rekon-sales-finance"]),
  m("tanpa_atribusi_sales", "Tanpa Atribusi Sales", "SALES",
    "Order lunas yang tidak dimiliki Sales mana pun (order internal / pelanggan di luar percakapan Sales). Tetap masuk total perusahaan, tidak ditebak ke Sales.",
    "Σ Order.value lunas periode yang tidak punya pemilik Sales", "tabel Order", "lunas", "TGL_LUNAS", ["Order internal/Owner"], ["Order yang pemilik Sales-nya jelas"],
    ["nilai_lunas_tim_sales"], ["Rekonsiliasi Sales–Finance"], ["rekon-sales-finance"]),
  m("pendapatan_diakui", "Pendapatan Diakui", "PELANGGAN",
    "Omzet penjualan yang diakui di buku besar (saat order diserahkan), dikurangi retur & potongan. Bukan uang masuk: order bisa diakui sebelum dibayar (piutang) atau dibayar sebelum diakui (uang muka).",
    "Σ kredit − debit akun pendapatan order (Layanan/Produk/Sewa/Ongkir) − Retur & Potongan", "jurnal PENGAKUAN_PENDAPATAN + pembalikan/refund/retur", "terposting", "TGL_BUKU",
    ["Pengakuan pendapatan order", "Ongkir yang diakui"], ["Uang masuk/DP (kewajiban sampai diserahkan)", "Pemasukan lain di luar order", "Modal & pinjaman"],
    ["uang_masuk_terverifikasi", "piutang_usaha", "uang_muka_pelanggan"], ["Dashboard", "Pemasukan", "Laporan Keuangan (Laba Rugi)"], ["pemasukan"]),
  m("piutang_usaha", "Piutang Usaha", "PELANGGAN",
    "Sisa tagihan pelanggan yang sudah diakui sebagai pendapatan tetapi belum dibayar, menurut saldo akun Piutang Usaha. Posisi per tanggal, bukan arus.",
    "Σ debit − kredit akun Piutang Usaha sampai tanggal posisi", "jurnal akun 1-xxxx Piutang Usaha", "terposting", "POSISI",
    ["Piutang order yang sudah diserahkan", "Order berstatus Lunas yang masih menunggu verifikasi (ditampilkan terpisah)"], ["Order yang belum diakui pendapatannya", "Uang muka pelanggan"],
    ["pendapatan_diakui", "uang_masuk_terverifikasi"], ["Dashboard", "Piutang & Refund", "Pemasukan (Piutang masih tersisa)", "Neraca"], ["piutang-refund"]),
  m("uang_muka_pelanggan", "Uang Muka Pelanggan", "PELANGGAN",
    "DP/pembayaran yang diterima sebelum order diserahkan. Ini KEWAJIBAN (kita berutang barang/jasa), bukan pendapatan.",
    "Σ kredit − debit akun Uang Muka Pelanggan sampai tanggal posisi", "jurnal akun Uang Muka Pelanggan", "terposting", "POSISI",
    ["DP sebelum penyerahan"], ["Pendapatan diakui"], ["pendapatan_diakui", "piutang_usaha"], ["Neraca"], []),
  m("refund_diberikan", "Refund Diberikan", "PELANGGAN",
    "Uang yang dikembalikan ke pelanggan atas order tertentu. Mengurangi pendapatan/uang masuk bersih, tidak boleh melebihi uang yang pernah benar-benar masuk.",
    "Σ FinRefund.amount status DISETUJUI", "tabel fin_refunds + jurnal refund", "disetujui (diposting)", "TGL_DOKUMEN",
    ["Refund atas order lunas maupun yang kembali belum lunas"], ["Refund menunggu persetujuan/ditolak/dibatalkan"], ["uang_masuk_terverifikasi", "pendapatan_diakui"], ["Piutang & Refund"], ["piutang-refund"]),

  // ═══ BIAYA, PEMBELIAN & UTANG ═════════════════════════════════════════════════════════════════════════════════
  m("pengeluaran_aktif", "Pengeluaran (Aktif)", "BIAYA",
    "Biaya operasional yang masih berlaku: semua pengeluaran periode di luar yang Dibatalkan dan Ditolak. Satu pengeluaran dihitung sekali, baik sudah dibayar maupun belum.",
    "Σ FinExpense.amount WHERE status ∉ {DIBATALKAN, DITOLAK}", "tabel fin_expenses", "draf, menunggu persetujuan, disetujui, dibayar", "TGL_DOKUMEN",
    ["Pengeluaran langsung, reimbursement, dan yang memakai uang muka (pertanggungjawaban)"], ["Dibatalkan", "Ditolak", "Pembelian/aset dan tagihan supplier (modul terpisah)"],
    ["beban_diakui", "uang_keluar_kas", "uang_muka_operasional_saldo"], ["Pengeluaran"], ["pengeluaran"]),
  m("pembelian_aktif", "Pembelian (Aktif)", "BIAYA",
    "Pembelian bahan/aset tanpa tagihan resmi supplier yang masih berlaku (di luar Dibatalkan/Ditolak). Terpisah dari Pengeluaran supaya satu pembelian tidak dihitung dua kali.",
    "Σ FinPurchase.amount WHERE status ∉ {DIBATALKAN, DITOLAK}", "tabel fin_purchases", "menunggu persetujuan, disetujui, dibayar", "TGL_DOKUMEN",
    ["Bahan baku manual, aset tetap/tak berwujud, uang muka pembelian"], ["Dibatalkan", "Ditolak", "Tagihan supplier resmi (Supplier & Utang)"],
    ["utang_supplier", "pengeluaran_aktif", "persediaan_nilai"], ["Pembelian"], ["pembelian"]),
  m("beban_diakui", "Beban Diakui", "BIAYA",
    "Biaya yang diakui di Laba Rugi menurut jurnal (saat disetujui/diposting), terlepas sudah dibayar atau belum.",
    "Σ debit − kredit akun beban dan HPP pada periode", "jurnal akun tipe BEBAN/BEBAN_POKOK", "terposting", "TGL_BUKU",
    ["Beban dari pengeluaran, kendaraan, iklan, pemakaian bahan, insentif, admin bank"], ["Pembelian aset (menjadi aset/persediaan)", "Uang muka operasional sebelum dipertanggungjawabkan", "Kasbon (piutang karyawan)"],
    ["pengeluaran_aktif", "uang_keluar_kas"], ["Dashboard", "Laporan Keuangan"], []),
  m("uang_keluar_kas", "Uang Keluar (Kas/Bank)", "BIAYA",
    "Uang yang benar-benar keluar dari Kas/Bank menurut buku besar. Berbeda dari beban (yang bisa diakui sebelum dibayar) dan dari utang (yang dibayar kemudian).",
    "Σ kredit akun Kas/Bank (kecuali transfer antar rekening)", "jurnal akun Kas/Bank", "terposting", "TGL_BUKU",
    ["Pengeluaran langsung, pembelian, pembayaran supplier, kasbon, uang muka, refund, biaya admin transfer"], ["Transfer antar rekening sendiri", "Pertanggungjawaban uang muka (kas sudah keluar saat uang muka diberikan)"],
    ["beban_diakui", "utang_supplier", "arus_kas_keluar"], ["Arus Kas", "Kas & Bank"], []),
  m("utang_supplier", "Utang Supplier", "BIAYA",
    "Tagihan supplier yang sudah disetujui dan belum lunas dibayar. Posisi per tanggal. Pembayaran supplier MENGURANGI utang — bukan pengeluaran baru.",
    "Σ FinSupplierBill disetujui − Σ alokasi pembayaran supplier aktif (= saldo akun Utang Usaha)", "tabel fin_supplier_bills + alokasi pembayaran", "disetujui, dibayar sebagian", "POSISI",
    ["Tagihan dari penerimaan barang", "Tagihan bahan/biaya supplier"], ["Tagihan menunggu persetujuan/ditolak/dibatalkan", "Penerimaan barang yang belum ditagih (ditampilkan terpisah)"],
    ["pembelian_aktif", "komitmen_belum_dibayar"], ["Dashboard", "Supplier & Utang"], ["supplier-utang"]),
  m("komitmen_belum_dibayar", "Komitmen Belum Dibayar", "BIAYA",
    "Biaya yang sudah disetujui tetapi uangnya belum keluar (pengeluaran/pembelian Disetujui-belum-dibayar, tagihan supplier terbuka). Belum mengurangi kas, sebagian sudah menjadi beban/utang.",
    "Σ pengeluaran & pembelian status DISETUJUI (belum DIBAYAR) + utang_supplier", "tabel fin_expenses, fin_purchases, fin_supplier_bills", "disetujui belum dibayar", "TGL_DOKUMEN",
    ["Reimbursement karyawan yang disetujui"], ["Yang sudah dibayar", "Yang masih menunggu persetujuan (belum komitmen)"],
    ["utang_supplier", "uang_keluar_kas"], ["Pengeluaran", "Pembelian", "Supplier & Utang"], []),

  // ═══ KAS, BANK & REKONSILIASI ═════════════════════════════════════════════════════════════════════════════════
  m("kas_bank_buku", "Kas & Bank (Menurut Buku)", "KAS",
    "Saldo seluruh rekening Kas/Bank menurut buku besar pada tanggal posisi. Dapat berbeda dari saldo di koran bank sampai direkonsiliasi.",
    "Σ debit − kredit akun Kas/Bank sampai tanggal posisi", "jurnal akun Kas/Bank per rekening", "terposting", "POSISI",
    ["Semua rekening aktif termasuk kas tunai"], ["Dana belum teridentifikasi (kewajiban sementara)"], ["saldo_bank_koran", "arus_kas_saldo_akhir"], ["Dashboard", "Kas & Bank"], ["buku-besar", "jurnal-umum"]),
  m("saldo_bank_koran", "Saldo Menurut Bank (Koran)", "KAS",
    "Saldo menurut koran/mutasi bank pada periode rekonsiliasi. Selisihnya dengan buku harus dijelaskan oleh baris mutasi yang belum cocok.",
    "saldo akhir koran yang diinput + selisih terbuka = saldo buku − saldo koran", "tabel fin_bank_statements/lines", "periode rekonsiliasi", "POSISI",
    ["Mutasi yang sudah dicocokkan"], ["Mutasi yang diabaikan dengan alasan"], ["kas_bank_buku"], ["Rekonsiliasi"], ["rekonsiliasi"]),
  m("arus_kas_masuk", "Kas Masuk (Arus Kas)", "KAS",
    "Jumlah debit Kas/Bank pada jurnal periode di luar transfer antar rekening. Mencakup uang pelanggan DAN penyesuaian saldo awal, pembalikan, dan rekonsiliasi sementara — lihat rincian per sumber.",
    "Σ debit Kas/Bank jurnal periode, kecuali sumber TRANSFER_KAS", "jurnal akun Kas/Bank", "terposting + dibalik", "TGL_BUKU",
    ["Uang pelanggan", "Pemasukan lain", "Penyesuaian saldo awal (SALDO_AWAL)", "Jurnal pembalik (REVERSAL)", "Rekonsiliasi sementara"], ["Transfer antar rekening sendiri"],
    ["kas_masuk_pelanggan", "uang_masuk_terverifikasi"], ["Laporan Keuangan (Arus Kas)"], []),
  m("arus_kas_keluar", "Kas Keluar (Arus Kas)", "KAS",
    "Jumlah kredit Kas/Bank pada jurnal periode di luar transfer antar rekening, termasuk jurnal pembalik dan penyesuaian saldo awal.",
    "Σ kredit Kas/Bank jurnal periode, kecuali sumber TRANSFER_KAS", "jurnal akun Kas/Bank", "terposting + dibalik", "TGL_BUKU",
    ["Pengeluaran, pembelian, supplier, kasbon, refund"], ["Transfer antar rekening sendiri"], ["uang_keluar_kas"], ["Laporan Keuangan (Arus Kas)"], []),
  m("arus_kas_saldo_akhir", "Saldo Akhir Kas (Arus Kas)", "KAS",
    "Saldo awal periode ditambah arus bersih periode; harus sama dengan Kas & Bank menurut buku pada akhir periode.",
    "saldo awal (mutasi sebelum periode) + kas masuk − kas keluar", "jurnal akun Kas/Bank", "terposting + dibalik", "POSISI",
    [], [], ["kas_bank_buku"], ["Laporan Keuangan (Arus Kas)"], []),

  // ═══ ASET, KASBON & PERSEDIAAN ════════════════════════════════════════════════════════════════════════════════
  m("kasbon_diberikan", "Kasbon Diberikan", "ASET",
    "Uang muka gaji yang diberikan ke karyawan pada periode. Bukan beban: menjadi piutang karyawan sampai dipotong dari gaji.",
    "Σ Kasbon.amount (aktif) pada periode", "tabel fin_kasbon + jurnal Piutang Karyawan", "aktif, lunas", "TGL_DOKUMEN",
    ["Kasbon baru"], ["Kasbon dibatalkan"], ["kasbon_sisa", "uang_keluar_kas"], ["Kasbon"], ["kasbon"]),
  m("kasbon_sisa", "Kasbon Belum Dipotong", "ASET",
    "Sisa kasbon seluruh karyawan yang belum dipotong dari gaji, apa pun periodenya (posisi saat ini, tidak mengikuti filter periode).",
    "Σ (kasbon − potongan) semua kasbon aktif", "tabel fin_kasbon", "aktif", "POSISI", ["Semua kasbon aktif"], ["Kasbon lunas/dibatalkan"], ["kasbon_diberikan"], ["Kasbon"], ["kasbon"]),
  m("uang_muka_operasional_saldo", "Uang Muka Operasional (Saldo Aktif)", "ASET",
    "Uang yang dipegang driver/PIC untuk biaya operasional dan belum dipertanggungjawabkan. Kas keluar SEKALI saat diberikan; pertanggungjawaban memindahkan ke beban tanpa menyentuh kas lagi.",
    "Σ uang muka aktif − pertanggungjawaban − pengembalian", "tabel fin_operational_advances + settlements", "aktif", "POSISI",
    ["Uang muka yang belum habis dipertanggungjawabkan"], ["Uang muka lunas/dibatalkan"], ["pengeluaran_aktif", "uang_keluar_kas"], ["Uang Muka Operasional"], ["uang-muka"]),
  m("persediaan_nilai", "Nilai Persediaan", "ASET",
    "Nilai bahan/barang di gudang menurut buku (bertambah dari penerimaan barang, berkurang dari pemakaian produksi/susut/opname). Kuantitas milik Gudang; Finance hanya menilai rupiahnya.",
    "saldo akun Persediaan (penerimaan − HPP pemakaian ± opname)", "jurnal persediaan; kuantitas dari stock_movements", "terposting", "POSISI",
    ["Penerimaan barang bernilai", "Persediaan awal (cutover)"], ["Barang yang dipakai produksi (menjadi HPP)"], ["pembelian_aktif", "utang_supplier"], ["Persediaan Awal", "Neraca"], []),

  // ═══ LAPORAN KEUANGAN ════════════════════════════════════════════════════════════════════════════════════════
  m("laba_bersih_sementara", "Laba Bersih Sementara", "LAPORAN",
    "Pendapatan bersih dikurangi HPP dan beban operasional menurut jurnal pada periode. 'Sementara' karena belum semua pengakuan/penyesuaian periode ditutup.",
    "pendapatan bersih − beban pokok − beban operasional", "jurnal akun pendapatan, HPP, beban", "terposting", "TGL_BUKU",
    ["Semua beban yang diakui periode"], ["Aset/persediaan, kasbon, uang muka, pembayaran utang"], ["pendapatan_diakui", "beban_diakui"], ["Dashboard", "Laporan Keuangan"], []),
]);

const PETA = new Map(METRIK.map((x) => [x.kunci, x]));
export const metrik = (kunci) => PETA.get(kunci) ?? null;

/** Glosarium pembeda istilah — urutan tegas dari "uang" ke "pembukuan". Dipakai panel "Kenapa angkanya berbeda?" dan sheet Definisi Angka. */
export const GLOSARIUM = Object.freeze([
  ["Payment tercatat", "payment_tercatat", "Catatan pembayaran — belum tentu uang masuk."],
  ["Uang masuk terverifikasi", "uang_masuk_terverifikasi", "Payment yang sudah diverifikasi Finance."],
  ["Klaim Lunas", "klaim_lunas_menunggu", "Pengajuan Sales, belum mengubah apa pun."],
  ["Order Lunas terverifikasi", "order_lunas_terverifikasi", "Status Lunas dari ledger (Payment terverifikasi ≥ tagihan)."],
  ["Pendapatan diakui", "pendapatan_diakui", "Omzet menurut jurnal (saat diserahkan), bukan uang."],
  ["Piutang", "piutang_usaha", "Pendapatan diakui yang belum dibayar."],
  ["Uang muka pelanggan", "uang_muka_pelanggan", "DP sebelum diserahkan — kewajiban."],
  ["Beban diakui", "beban_diakui", "Biaya menurut jurnal, sudah dibayar atau belum."],
  ["Uang keluar", "uang_keluar_kas", "Kas/Bank yang benar-benar berkurang."],
  ["Utang supplier", "utang_supplier", "Tagihan disetujui yang belum dibayar."],
  ["Persediaan / aset", "persediaan_nilai", "Barang & aset bernilai — bukan beban sampai dipakai."],
  ["Komitmen belum dibayar", "komitmen_belum_dibayar", "Sudah disetujui, uang belum keluar."],
]);

/** Metrik untuk satu halaman (nama halaman persis seperti di field `halaman`). */
export const metrikUntukHalaman = (halaman) => METRIK.filter((x) => x.halaman.some((h) => h.toLowerCase().startsWith(String(halaman).toLowerCase())));

/** Metrik yang dimuat sebuah modul export (kunci modul = registry export). */
export const metrikUntukModulExport = (modul) => METRIK.filter((x) => x.ekspor.includes(modul));

/** Label basis tanggal (unik, berurutan) untuk modul export — dicetak di kepala sheet supaya pembaca tahu "tanggal" yang mana. */
export function basisTanggalModul(modul) {
  const daftar = [...new Set(metrikUntukModulExport(modul).map((x) => BASIS[x.basis]?.label).filter(Boolean))];
  return daftar.length ? daftar.join(" · ") : "Tanggal pada baris sumber";
}

/**
 * Sheet "Definisi Angka" untuk export: tiap angka yang tampil di layar modul itu beserta definisi, rumus, sumber, basis tanggal, dan pasangan rekonsiliasinya —
 * dibangun dari kontrak yang SAMA dengan tooltip layar (satu sumber). Bentuk sesuai export/excel.js (kolom + baris).
 */
export function sheetDefinisiAngka(modul) {
  const nama = (k) => metrik(k)?.nama ?? k;
  const baris = metrikUntukModulExport(modul).map((x) => ({
    nama: x.nama, definisi: x.definisi, rumus: x.rumus, sumber: x.sumber, status: x.status, basis: BASIS[x.basis]?.label ?? x.basis,
    termasuk: x.termasuk.join("; "), tidakTermasuk: x.tidakTermasuk.join("; "), pasangan: x.pasangan.map(nama).join("; "),
  }));
  return {
    nama: "Definisi Angka", judul: "Definisi Angka",
    kolom: [
      { key: "nama", header: "Angka", lebar: 30 }, { key: "definisi", header: "Definisi", lebar: 60 }, { key: "rumus", header: "Rumus", lebar: 44 },
      { key: "sumber", header: "Sumber data", lebar: 30 }, { key: "status", header: "Status yang dihitung", lebar: 26 }, { key: "basis", header: "Basis tanggal", lebar: 26 },
      { key: "termasuk", header: "Termasuk", lebar: 44 }, { key: "tidakTermasuk", header: "Tidak termasuk", lebar: 44 }, { key: "pasangan", header: "Dibandingkan dengan", lebar: 36 },
    ],
    baris,
    catatan: ["Zona waktu seluruh tanggal: WIB (UTC+7). Angka di sheet lain sama dengan yang tampil di layar pada periode & filter yang sama.", "Kenapa dua angka berbeda? Lihat panel \"Kenapa angkanya berbeda?\" di layar Finance — jembatan (bridge) dihitung server dengan residual Rp0."],
  };
}

/** Bentuk ringkas untuk klien: tanpa field internal; basis diperluas dengan labelnya. */
export function kontrakUntukKlien() {
  return {
    versi: "2026-10-01",
    zonaWaktu: "Asia/Jakarta (WIB, UTC+7)",
    basis: Object.values(BASIS),
    kelompok: KELOMPOK,
    glosarium: GLOSARIUM.map(([istilah, kunci, arti]) => ({ istilah, kunci, arti })),
    metrik: METRIK.map((x) => ({ ...x, basisLabel: BASIS[x.basis]?.label ?? x.basis, kelompokLabel: KELOMPOK[x.kelompok] ?? x.kelompok })),
  };
}
