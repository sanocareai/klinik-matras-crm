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
  lengkap: { judul: "Data lengkap menurut pemeriksaan otomatis", isi: "Semua angka di halaman ini dihitung dari jurnal yang sudah dibukukan." },
});

/** Keadaan strip: ada butir bermasalah → "belumLengkap"; hanya sumber yang tidak termuat → "sumberHilang"; selain itu "lengkap". Kondisi sama dengan banner lama (kualitas.belumFinal). */
export function keadaanStrip(kualitas) {
  if (!kualitas?.belumFinal) return "lengkap";
  return kualitas.jumlahBermasalah > 0 ? "belumLengkap" : "sumberHilang";
}

// ─── Panel "Perlu dibereskan" ───────────────────────────────────────────────

/**
 * Empat baris, TIDAK dijumlahkan (kelompoknya bisa saling tumpang tindih). Setiap baris: label, jumlah (null = tidak tersedia), nilai rupiah bila ada, keterangan, tujuan lama.
 * `status`: "tanpa-data" | "bersih" | "perlu".
 */
export function susunPerluDibereskan(kualitas) {
  if (!kualitas) return [];
  const per = new Map(kualitas.butir.map((b) => [b.id, b]));
  const st = (b) => (b.jumlah === null ? "tanpa-data" : b.jumlah === 0 ? "bersih" : "perlu");
  const baris = [];
  const b1 = per.get("pembayaran_belum_tercatat");
  if (b1) baris.push({ id: b1.id, label: "Pembayaran belum tercatat di pembukuan", satuanJumlah: "order", jumlah: b1.jumlah, nilai: b1.nilai, status: st(b1), tujuan: b1.tujuan,
    keterangan: "Lunas menurut CRM, tetapi belum ada catatan pembayaran dan rekening, jadi belum ada jurnal kas." });
  const b2 = per.get("order_belum_diakui");
  if (b2) baris.push({ id: b2.id, label: "Order belum diakui sebagai pendapatan", satuanJumlah: "order", jumlah: b2.jumlah, nilai: b2.nilai, status: st(b2), tujuan: b2.tujuan,
    keterangan: "Order sudah selesai diserahterimakan, tetapi pendapatannya belum dibukukan (data order lama belum dilengkapi)." });
  const b3 = per.get("transaksi_belum_lengkap");
  if (b3) baris.push({ id: b3.id, label: "Transaksi belum lengkap", satuanJumlah: "transaksi", jumlah: b3.jumlah, nilai: null, status: st(b3), tujuan: b3.tujuan,
    keterangan: "Tertahan karena datanya belum lengkap (mis. rekening belum dipetakan), jadi belum masuk buku besar." });
  // Selisih rekening: satu baris untuk semua rekening yang berstatus selisih; nilai per rekening tetap terbaca di keterangan.
  const selisih = kualitas.butir.filter((b) => b.id.startsWith("selisih_"));
  const nyata = selisih.filter((b) => b.id !== "selisih_rekening" && b.jumlah > 0);
  if (nyata.length > 0) {
    baris.push({ id: "selisih_rekening", label: "Selisih rekening yang perlu ditinjau", satuanJumlah: "rekening", jumlah: nyata.length, nilai: nyata.length === 1 ? Math.abs(nyata[0].nilai) : null, status: "perlu",
      tujuan: nyata.length === 1 ? nyata[0].tujuan : "/finance/reconciliation", keterangan: nyata.map((b) => b.label.replace(/^Selisih\s+/i, "")).join(", "), detailRupiah: nyata.map((b) => ({ label: b.label.replace(/^Selisih\s+/i, ""), nilai: b.nilai })) });
  } else if (selisih.some((b) => b.jumlah === null)) {
    baris.push({ id: "selisih_rekening", label: "Selisih rekening yang perlu ditinjau", satuanJumlah: "rekening", jumlah: null, nilai: null, status: "tanpa-data", tujuan: "/finance/reconciliation", keterangan: "Data saldo terkonfirmasi tidak dapat dimuat." });
  } else {
    baris.push({ id: "selisih_rekening", label: "Selisih rekening yang perlu ditinjau", satuanJumlah: "rekening", jumlah: 0, nilai: 0, status: "bersih", tujuan: "/finance/reconciliation", keterangan: "Saldo pembukuan sama dengan saldo terkonfirmasi pada tanggal acuan." });
  }
  return baris;
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
