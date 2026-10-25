// Model murni UI "Posting Pemakaian Historis" (tanpa React/DOM; diuji lewat node --test).
// Prinsip: SERVER yang memutuskan. UI hanya menampilkan manifest/dampak dari pratinjau, status batch dari server, dan mencegah tombol yang pasti ditolak.
// Status batch adalah milik server — UI mana pun (tab lain, setelah refresh, setelah tab ditutup) menampilkan status yang SAMA lewat GET.

export const ROLE_PENYETUJU_POSTING = Object.freeze(["OWNER", "FINANCE"]); // izin inventory:adjustment_approve: boleh MENGHENTIKAN/MELANJUTKAN batch yang sudah ada
export const ROLE_PEMULAI_POSTING = Object.freeze(["OWNER"]); // SEMENTARA hanya Owner yang MEMULAI (Owner meninjau & mengonfirmasi manifest sendiri) — ditegakkan juga di server (403 HANYA_OWNER_MEMULAI)
export const ROLE_PEMBACA_POSTING = Object.freeze(["ADMIN", "OWNER", "FINANCE"]);
const punya = (roles, daftar) => Array.isArray(roles) && roles.some((r) => daftar.includes(r));
export const bolehMulaiPosting = (roles) => punya(roles, ROLE_PEMULAI_POSTING);
export const bolehKendaliBatch = (roles) => punya(roles, ROLE_PENYETUJU_POSTING);
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
  const penyetuju = bolehKendaliBatch(roles);
  const r = { lanjut: false, hentikan: false, mulaiBaru: false, alasan: "" };
  if (!penyetuju) { r.alasan = "Hanya Owner dan Finance yang dapat menghentikan atau melanjutkan batch (memulai: hanya Owner). Anda dapat memantau progres."; return r; }
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
  if (!bolehMulaiPosting(roles)) return { ok: false, alasan: "Sementara hanya akun Owner yang dapat memulai posting." };
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
      : hpp.status === "BELUM_ADA" ? "Belum ada transaksi yang diposting, jadi belum ada nilai." : "Seluruh transaksi bernilai.",
    jurnal: hpp.jurnalDibuat ? "Jurnal HPP dibuat" : "Jurnal HPP TIDAK dibuat — selisih ini belum masuk buku besar",
  };
}

/** Pilih HANYA order yang sedang tampil (hasil pencarian): semua tampil = seluruh manifest (null); tidak ada = kosong. */
export function pilihHanyaTampil(semua, tampil) {
  const t = (tampil ?? []).filter((id) => (semua ?? []).includes(id));
  return t.length === 0 ? [] : t.length >= (semua ?? []).length ? null : t;
}

/** Pilihan order (checkbox) → daftar unitIds untuk pratinjau/mulai. null = seluruh manifest. */
export function unitTerpilih(semua, terpilih) {
  const s = new Set(terpilih ?? []);
  if (!semua?.length || s.size === 0 || s.size >= semua.length) return null;
  return semua.filter((id) => s.has(id));
}

// ── KONFIRMASI MANIFEST (insiden 25 Okt 2026) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// BATAS KONTROL: nilai yang diketik di dialog (hash, daftar order, jumlah) adalah KONFIRMASI MANIFEST oleh Owner yang menjalankan — BUKAN bukti persetujuan Owner yang tercatat terpisah.
// Sementara itu hanya akun Owner yang boleh memulai posting; Owner meninjau dan mengonfirmasi manifest sendiri. Server membandingkan konfirmasi dengan rencana (hash, ID unit, isi transaksi, saldo ditinjau) dan menolak selisih (409)
// sebelum ada tulisan. Pemeriksaan di sini hanya agar tombol tidak ditekan sia-sia dan selisihnya terbaca.
export const BATAS_KONTROL = "Konfirmasi manifest ini dilakukan oleh Owner yang menjalankan — bukan persetujuan Owner yang tercatat terpisah. Sementara hanya akun Owner yang dapat memulai posting; Finance dan Admin dapat memantau, dan Finance dapat menghentikan atau melanjutkan batch yang sudah ada.";
const POLA_ORDER = /\b[A-Za-z]{2,6}-\d{8}-\d{1,4}\b/g;
export const normalHash = (t) => String(t ?? "").trim().toLowerCase();
/** Nomor order unik (huruf besar, urut kemunculan) dari teks yang ditempel (daftar bebas: baris, koma, atau kalimat keputusan). */
export function ambilNomorOrder(teks) { return [...new Set((String(teks ?? "").match(POLA_ORDER) ?? []).map((x) => x.toUpperCase()))]; }
/** Syarat saldo opsional: satu per baris "KODE=angka" (atau "KODE: angka"), boleh diikuti satuan. */
export function bacaSyaratSaldo(teks) {
  const daftar = []; const galat = [];
  for (const baris of String(teks ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
    const m = baris.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*[=:]\s*(-?\d+(?:[.,]\d+)?)\s*(?:[A-Za-z]+)?$/);
    if (!m) { galat.push(baris); continue; }
    daftar.push({ kode: m[1], saldo: Number(m[2].replace(",", ".")) });
  }
  return { ok: galat.length === 0, daftar, galat };
}
const bulat = (t) => { const s = String(t ?? "").trim(); return /^\d+$/.test(s) ? Number(s) : null; };
const r4 = (n) => Math.round(Number(n) * 1e4) / 1e4;
/** Isi transaksi lengkap persis seperti yang tampil di dialog (ID unit, order, bahan, kuantitas, satuan, tanggal). */
export function isiTransaksiDari(manifest) {
  return (manifest?.order ?? []).flatMap((o) => (o.trx ?? []).map((t) => ({ unitId: o.unitId, orderNumber: o.orderNumber, kodeBahan: t.kodeBahan, qty: r4(t.qty), satuan: t.satuan, tanggal: t.tanggal })));
}
/** Saldo bahan yang tampil di dialog (sebelum posting) — dikirim agar server menolak bila saldo bergeser sejak ditinjau. */
export const saldoManifestDari = (manifest) => (manifest?.bahan ?? []).map((b) => ({ kode: b.kode, saldo: r4(b.saldoSekarang) }));
/** Bandingkan konfirmasi yang diketik dengan manifest di layar. Mengembalikan daftar selisih (kosong = cocok). */
export function periksaKonfirmasiLayar({ manifest, hash, daftarOrder, jumlahOrder, jumlahTrx }) {
  const beda = []; if (!manifest) return ["Manifest belum dimuat."];
  const h = normalHash(hash);
  if (!h) beda.push("Tempel hash manifest yang dimaksud (64 karakter).");
  else if (!/^[0-9a-f]{64}$/.test(h)) beda.push("Hash harus 64 karakter hex — tempel utuh dari keputusan Owner.");
  else if (h !== manifest.hash) beda.push(`Hash yang Anda ketik (${h.slice(0, 10)}…) BERBEDA dari manifest di layar (${manifest.hash.slice(0, 10)}…). Pilihan order tidak sama dengan yang dimaksud.`);
  const dimaksud = new Set(daftarOrder ?? []); const dilayar = new Set((manifest.order ?? []).map((o) => o.orderNumber));
  if (!dimaksud.size) beda.push("Tempel daftar order yang dimaksud.");
  const lebihLayar = [...dilayar].filter((x) => !dimaksud.has(x)); const lebihDimaksud = [...dimaksud].filter((x) => !dilayar.has(x));
  if (dimaksud.size && lebihLayar.length) beda.push(`Order di layar yang TIDAK ada di daftar Anda (${lebihLayar.length}): ${lebihLayar.slice(0, 6).join(", ")}${lebihLayar.length > 6 ? "…" : ""}`);
  if (dimaksud.size && lebihDimaksud.length) beda.push(`Order di daftar Anda yang TIDAK dipilih di layar (${lebihDimaksud.length}): ${lebihDimaksud.slice(0, 6).join(", ")}${lebihDimaksud.length > 6 ? "…" : ""}`);
  const jo = bulat(jumlahOrder); const jt = bulat(jumlahTrx);
  if (jo === null) beda.push("Isi jumlah order."); else if (jo !== manifest.jumlahOrder) beda.push(`Jumlah order yang Anda ketik ${jo} ≠ manifest ${manifest.jumlahOrder}.`);
  if (jt === null) beda.push("Isi jumlah transaksi."); else if (jt !== manifest.jumlahTrx) beda.push(`Jumlah transaksi yang Anda ketik ${jt} ≠ manifest ${manifest.jumlahTrx}.`);
  return beda;
}
/** Badan konfirmasiManifest untuk server: nilai yang diketik + unit terpilih + isi transaksi lengkap + saldo yang ditinjau. */
export function bangunKonfirmasiManifest({ manifest, hash, daftarOrder, jumlahOrder, jumlahTrx, rujukan, saldoSyarat }) {
  return { hash: normalHash(hash), unitIds: manifest.unitIds, daftarOrder, jumlahOrder: bulat(jumlahOrder), jumlahTrx: bulat(jumlahTrx), rujukan: String(rujukan ?? "").trim(), isiTransaksi: isiTransaksiDari(manifest), saldoManifest: saldoManifestDari(manifest), digestIsi: manifest.digestIsi, ...(saldoSyarat?.length ? { saldoSyarat } : {}) };
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
  if (e.code === "PERSETUJUAN_WAJIB") return e.message || "Konfirmasi tidak lengkap (hash, rujukan, dan nama pelaksana wajib).";
  if (e.code === "HANYA_OWNER_MEMULAI") return "Sementara hanya akun Owner yang dapat memulai posting. Tidak ada yang diposting.";
  if (e.code === "KONFIRMASI_MANIFEST_WAJIB") return "Halaman ini versi lama. Muat ulang (Ctrl+F5) lalu ulangi dari dialog konfirmasi. Tidak ada yang diposting.";
  if (e.code === "KONFIRMASI_MANIFEST_TIDAK_COCOK") return `Konfirmasi manifest TIDAK COCOK dengan rencana — tidak ada yang diposting. ${(Array.isArray(e.detail) ? e.detail : []).slice(0, 4).join(" · ")}`;
  if (e.status === 403) return "Akun Anda tidak punya izin untuk aksi ini.";
  if (e.status === 0 || /timeout|Failed to fetch|terputus|NetworkError/i.test(e.message || "")) return "Koneksi terputus. Status terakhir tetap ditampilkan; mencoba lagi otomatis.";
  return e.message || "Terjadi kesalahan.";
}
