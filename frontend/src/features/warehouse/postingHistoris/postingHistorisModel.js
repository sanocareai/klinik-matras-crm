// Model murni UI "Posting Pemakaian Historis" (tanpa React/DOM; diuji lewat node --test).
// Prinsip: SERVER yang memutuskan. UI hanya menampilkan manifest/dampak dari pratinjau, status batch dari server, dan mencegah tombol yang pasti ditolak.
// Status batch adalah milik server — UI mana pun (tab lain, setelah refresh, setelah tab ditutup) menampilkan status yang SAMA lewat GET.

export const ROLE_PENYETUJU_POSTING = Object.freeze(["OWNER", "FINANCE"]); // izin inventory:adjustment_approve (gerbang hash di server)
export const ROLE_PEMBACA_POSTING = Object.freeze(["ADMIN", "OWNER", "FINANCE"]);
const punya = (roles, daftar) => Array.isArray(roles) && roles.some((r) => daftar.includes(r));
export const bolehMulaiPosting = (roles) => punya(roles, ROLE_PENYETUJU_POSTING);
export const bolehLihatPosting = (roles) => punya(roles, ROLE_PEMBACA_POSTING);

export const KUNCI_BATCH_AKTIF = "postingHistoris.batchAktif";
export const KUNCI_DRAFT = "postingHistoris.draft";
export const SALURAN = "posting-historis";
export const STATUS_AKTIF = Object.freeze(["MENUNGGU", "BERJALAN", "TERPUTUS"]);
export const STATUS_SELESAI = Object.freeze(["SELESAI", "SELESAI_SEBAGIAN"]);

export const rupiah = (n) => (n == null || !Number.isFinite(Number(n)) ? "—" : `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`);
export const angka = (n) => (n == null || !Number.isFinite(Number(n)) ? "—" : Number(n).toLocaleString("id-ID", { maximumFractionDigits: 4 }));

export const STATUS_BATCH = Object.freeze({
  MENUNGGU: { label: "Menunggu dimulai", nada: "orange", teks: "Batch sudah diajukan dan menunggu pekerja di server." },
  BERJALAN: { label: "Sedang berjalan", nada: "accent", teks: "Server memposting order satu per satu. Aman menutup halaman ini — batch tetap berjalan." },
  TERPUTUS: { label: "Terputus", nada: "red", teks: "Pekerja berhenti (mis. server restart). Tekan Lanjutkan: order yang sudah diposting tidak diposting lagi." },
  DIHENTIKAN: { label: "Dihentikan", nada: "orange", teks: "Dihentikan oleh pengguna. Order yang sudah diposting tetap berlaku; Lanjutkan untuk meneruskan sisanya." },
  SELESAI: { label: "Selesai", nada: "green", teks: "Semua order diposting." },
  SELESAI_SEBAGIAN: { label: "Selesai sebagian", nada: "orange", teks: "Sebagian order tidak diposting karena stok/catatan berubah sejak disetujui. Lihat alasannya per order." },
});
export const labelStatusBatch = (s) => STATUS_BATCH[s] ?? { label: String(s ?? "—"), nada: "neutral", teks: "" };

export const STATUS_ORDER = Object.freeze({
  MENUNGGU: { label: "Menunggu", nada: "neutral" },
  DIPOSTING: { label: "Berhasil", nada: "green" },
  DILEWATI: { label: "Sudah diposting", nada: "green" },
  GAGAL: { label: "Gagal", nada: "red" },
});
export const labelStatusOrder = (s) => STATUS_ORDER[s] ?? { label: String(s ?? "—"), nada: "neutral" };

/** Alasan gagal yang bisa dibaca Admin (server mengirim kode + pesan). */
export function alasanGagal(kode, pesan) {
  const peta = {
    RENCANA_BERUBAH: "Catatan atau stok order ini berubah sejak manifest disetujui — tidak diposting. Muat manifest baru bila masih perlu.",
    CATATAN_BERUBAH: "Catatan order ini tidak lagi siap diposting (stok bahan sudah terpakai atau catatan dikoreksi).",
    SALDO_GARIS_WAKTU: "Stok bahan akan negatif pada tanggal pemakaian — tidak diposting.",
    SALDO_TIDAK_CUKUP: "Stok bahan tidak cukup saat diposting.",
  };
  return peta[kode] ?? (pesan || "Tidak diposting (alasan tidak dikenal).");
}

/** Hitung ringkasan progres dari status server. */
export function ringkasProgres(s) {
  if (!s) return { total: 0, berhasil: 0, gagal: 0, menunggu: 0, persen: 0 };
  const unit = Array.isArray(s.unit) ? s.unit : [];
  const total = s.totalUnit ?? unit.length;
  const berhasil = unit.filter((u) => u.status === "DIPOSTING" || u.status === "DILEWATI").length;
  const gagal = unit.filter((u) => u.status === "GAGAL").length;
  const menunggu = Math.max(0, total - berhasil - gagal);
  return { total, berhasil, gagal, menunggu, persen: total ? Math.round(((berhasil + gagal) / total) * 100) : 0 };
}

/** Filter daftar order batch. */
export function saringOrder(unit, filter) {
  const u = Array.isArray(unit) ? unit : [];
  if (filter === "berhasil") return u.filter((x) => x.status === "DIPOSTING" || x.status === "DILEWATI");
  if (filter === "gagal") return u.filter((x) => x.status === "GAGAL");
  if (filter === "menunggu") return u.filter((x) => x.status === "MENUNGGU");
  return u;
}

/** Tombol yang boleh tampil menurut status batch + peran. `alasan` menjelaskan kenapa tombol tidak ada. */
export function aksiBatch({ status, roles, sibuk = false }) {
  const penyetuju = bolehMulaiPosting(roles);
  const r = { lanjut: false, hentikan: false, mulaiBaru: false, alasan: "" };
  if (!penyetuju) { r.alasan = "Hanya akun dengan izin persetujuan penyesuaian stok (Owner/Finance) yang dapat memulai, menghentikan, atau melanjutkan batch. Anda dapat memantau progres."; return r; }
  if (sibuk) return r;
  if (status === "BERJALAN" || status === "MENUNGGU") r.hentikan = true;
  if (status === "TERPUTUS" || status === "DIHENTIKAN") r.lanjut = true;
  if (!status || STATUS_SELESAI.includes(status)) r.mulaiBaru = true;
  return r;
}

export function validasiRujukan(teks) {
  const t = String(teks ?? "").trim();
  if (t.length < 8) return { ok: false, pesan: "Rujukan persetujuan Owner minimal 8 karakter (mis. nomor persetujuan)." };
  if (t.length > 200) return { ok: false, pesan: "Rujukan terlalu panjang." };
  return { ok: true, nilai: t };
}

/** Syarat tombol "Mulai batch" aktif: manifest ada, tidak kosong, belum ada batch aktif, peran sah. */
export function bolehTekanMulai({ pratinjau, batchAktif, roles, memuat }) {
  if (!bolehMulaiPosting(roles)) return { ok: false, alasan: "Akun Anda tidak punya izin memulai posting." };
  if (memuat) return { ok: false, alasan: "Memuat manifest…" };
  if (batchAktif && STATUS_AKTIF.includes(batchAktif.status)) return { ok: false, alasan: "Ada batch yang masih berjalan — pantau atau hentikan dulu." };
  if (!pratinjau || !pratinjau.jumlahTrx) return { ok: false, alasan: "Tidak ada transaksi siap posting." };
  if (pratinjau.dampakStok?.bahanNegatifSesudah > 0) return { ok: false, alasan: "Manifest akan membuat stok bahan negatif — jangan dimulai; periksa dampak stok." };
  return { ok: true, alasan: "" };
}

/** Ringkasan HPP untuk kartu: PARSIAL harus selalu jelas dan angka selisih belum dijurnal tidak pernah disembunyikan. */
export function ringkasHpp(hpp) {
  if (!hpp) return null;
  const parsial = hpp.status === "PARSIAL";
  const belum = hpp.selisihBelumDijurnal ?? hpp.belumDijurnal ?? 0;
  const nilai = hpp.hppBerbukti ?? hpp.nilaiTercatat ?? 0;
  const tanpa = hpp.trxTanpaHarga ?? 0;
  return {
    label: parsial ? "HPP PARSIAL" : hpp.status === "BELUM_ADA" ? "Belum ada nilai" : "HPP lengkap",
    nada: parsial ? "orange" : hpp.status === "BELUM_ADA" ? "neutral" : "green",
    nilai: rupiah(nilai), belumDijurnal: rupiah(belum), tanpaHarga: tanpa, tertahan: hpp.catatanTertahan ?? 0,
    penjelasan: parsial
      ? `${tanpa ? `${tanpa} transaksi belum punya harga; ` : ""}${hpp.catatanTertahan ? `${hpp.catatanTertahan} catatan masih tertahan; ` : ""}nilai ini BELUM final.`
      : "Seluruh transaksi bernilai.",
    jurnal: hpp.jurnalDibuat ? "Jurnal HPP dibuat" : "Jurnal HPP TIDAK dibuat — selisih ini belum masuk buku besar",
  };
}

/** Pilihan order (checkbox) → daftar unitIds untuk pratinjau/mulai. null = seluruh manifest. */
export function unitTerpilih(semua, terpilih) {
  const s = new Set(terpilih ?? []);
  if (!semua?.length || s.size === 0 || s.size >= semua.length) return null;
  return semua.filter((id) => s.has(id));
}

/** Gabung kemajuan terbaru dengan yang lama saat koneksi putus: tampilkan yang terakhir diketahui, tandai basi. */
export function gabungStatus(lama, baru) {
  if (!baru) return lama ? { ...lama, basi: true } : lama;
  return { ...baru, basi: false };
}

/** Interval polling (ms): cepat saat batch aktif dan tab terlihat, lambat saat idle, berhenti saat tab tersembunyi; mundur eksponensial saat galat. */
export function intervalPolling({ status, tersembunyi, gagalBeruntun = 0 }) {
  if (tersembunyi) return null;
  const dasar = STATUS_AKTIF.includes(status) ? 2500 : 15000;
  if (!gagalBeruntun) return dasar;
  return Math.min(30000, dasar * 2 ** Math.min(gagalBeruntun, 4));
}

/** Pesan galat ringkas untuk banner (koneksi / izin / konflik). */
export function pesanGalat(e) {
  if (!e) return "";
  if (e.code === "RENCANA_BERUBAH") return "Manifest berubah sejak dimuat (stok/catatan bergeser). Muat ulang manifest lalu periksa lagi sebelum memulai.";
  if (e.code === "RENCANA_KOSONG") return "Tidak ada transaksi siap posting.";
  if (e.code === "PERSETUJUAN_WAJIB") return e.message || "Persetujuan tidak lengkap (hash, rujukan, dan nama penyetuju wajib).";
  if (e.status === 403) return "Akun Anda tidak punya izin untuk aksi ini.";
  if (e.status === 0 || /timeout|Failed to fetch|terputus|NetworkError/i.test(e.message || "")) return "Koneksi terputus. Status terakhir tetap ditampilkan; mencoba lagi otomatis.";
  return e.message || "Terjadi kesalahan.";
}
