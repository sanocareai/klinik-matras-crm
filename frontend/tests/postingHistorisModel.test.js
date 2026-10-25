// Model murni UI Posting Pemakaian Historis: izin, aksi per status, progres, HPP parsial, polling, galat.
import test from "node:test";
import assert from "node:assert/strict";
import { pilihHanyaTampil, aksiBatch, alasanGagal, bolehLihatPosting, bolehMulaiPosting, bolehTekanMulai, gabungStatus, intervalPolling, labelStatusBatch, pesanGalat, ringkasHpp, ringkasProgres, rupiah, saringOrder, unitTerpilih, validasiRujukan } from "../src/features/warehouse/postingHistoris/postingHistorisModel.js";

const unit = (status, o = {}) => ({ unitId: o.id ?? status, order: o.order ?? `O-${status}`, trx: 2, status, diposting: 0, kode: o.kode ?? null, pesan: o.pesan ?? null });
test("izin lihat: Admin/Owner/Finance boleh melihat; peran lain tidak (memulai: lihat tes izin memulai di bawah)", () => {
  assert.equal(bolehLihatPosting(["ADMIN"]), true); assert.equal(bolehMulaiPosting(["ADMIN"]), false);
  assert.equal(bolehMulaiPosting(["OWNER"]), true); assert.equal(bolehLihatPosting(["FINANCE"]), true);
  assert.equal(bolehLihatPosting(["WAREHOUSE"]), false); assert.equal(bolehLihatPosting(undefined), false);
});
test("aksi batch: tombol sesuai status + peran; tanpa izin tidak ada tombol dan ada alasan; sibuk mematikan semua (klik ganda)", () => {
  assert.deepEqual(aksiBatch({ status: "BERJALAN", roles: ["OWNER"] }), { lanjut: false, hentikan: true, mulaiBaru: false, alasan: "" });
  assert.equal(aksiBatch({ status: "TERPUTUS", roles: ["FINANCE"] }).lanjut, true); assert.equal(aksiBatch({ status: "DIHENTIKAN", roles: ["OWNER"] }).lanjut, true);
  assert.equal(aksiBatch({ status: "SELESAI", roles: ["OWNER"] }).mulaiBaru, true);
  const admin = aksiBatch({ status: "BERJALAN", roles: ["ADMIN"] }); assert.deepEqual([admin.lanjut, admin.hentikan, admin.mulaiBaru], [false, false, false]); assert.match(admin.alasan, /Owner dan Finance/);
  const sibuk = aksiBatch({ status: "TERPUTUS", roles: ["OWNER"], sibuk: true }); assert.deepEqual([sibuk.lanjut, sibuk.hentikan], [false, false]);
});
test("progres: berhasil+dilewati vs gagal vs menunggu; persen dihitung dari yang sudah diputuskan", () => {
  const p = ringkasProgres({ totalUnit: 5, unit: [unit("DIPOSTING"), unit("DILEWATI"), unit("GAGAL"), unit("MENUNGGU"), unit("MENUNGGU")] });
  assert.deepEqual(p, { total: 5, berhasil: 2, gagal: 1, menunggu: 2, persen: 60 });
  assert.deepEqual(ringkasProgres(null), { total: 0, berhasil: 0, gagal: 0, menunggu: 0, persen: 0 });
  assert.equal(saringOrder([unit("DIPOSTING"), unit("GAGAL"), unit("MENUNGGU")], "gagal").length, 1); assert.equal(saringOrder([unit("DILEWATI")], "berhasil").length, 1);
});
test("alasan gagal: kode dikenal dijelaskan; kode asing memakai pesan server", () => {
  assert.match(alasanGagal("RENCANA_BERUBAH"), /berubah sejak manifest disetujui/); assert.match(alasanGagal("SALDO_GARIS_WAKTU"), /negatif/);
  assert.equal(alasanGagal("ANEH", "pesan server"), "pesan server");
});
test("HPP: PARSIAL jika ada transaksi tanpa harga atau catatan tertahan; selisih belum dijurnal selalu tampil; jurnal tidak dibuat dinyatakan", () => {
  const h = ringkasHpp({ status: "PARSIAL", hppBerbukti: 2346600, trxTanpaHarga: 2, catatanTertahan: 5, selisihBelumDijurnal: 2346600, jurnalDibuat: false });
  assert.equal(h.label, "HPP PARSIAL"); assert.equal(h.nada, "orange"); assert.equal(h.belumDijurnal, "Rp2.346.600"); assert.match(h.penjelasan, /2 transaksi belum punya harga/); assert.match(h.penjelasan, /5 catatan masih tertahan/); assert.match(h.jurnal, /TIDAK dibuat/);
  assert.equal(ringkasHpp({ status: "LENGKAP", hppBerbukti: 100, selisihBelumDijurnal: 100 }).nada, "green"); assert.equal(ringkasHpp(null), null);
  assert.equal(ringkasHpp({ status: "BELUM_ADA", nilaiTercatat: 0, belumDijurnal: 0 }).label, "Belum ada nilai");
  assert.match(ringkasHpp({ status: "BELUM_ADA", nilaiTercatat: 0, belumDijurnal: 0 }).penjelasan, /Belum ada transaksi yang diposting/, "tidak boleh menyatakan 'seluruh transaksi bernilai' saat belum ada posting");
});
test("syarat tombol Mulai: izin, manifest ada, tidak ada batch aktif, tidak membuat stok negatif", () => {
  const pra = { jumlahTrx: 3, dampakStok: { bahanNegatifSesudah: 0 } };
  assert.equal(bolehTekanMulai({ pratinjau: pra, batchAktif: null, roles: ["OWNER"], memuat: false }).ok, true);
  assert.equal(bolehTekanMulai({ pratinjau: pra, batchAktif: null, roles: ["ADMIN"], memuat: false }).ok, false);
  assert.equal(bolehTekanMulai({ pratinjau: pra, batchAktif: { status: "BERJALAN" }, roles: ["OWNER"], memuat: false }).ok, false);
  assert.equal(bolehTekanMulai({ pratinjau: pra, batchAktif: { status: "SELESAI" }, roles: ["OWNER"], memuat: false }).ok, true);
  assert.equal(bolehTekanMulai({ pratinjau: { jumlahTrx: 0 }, batchAktif: null, roles: ["OWNER"], memuat: false }).ok, false);
  assert.match(bolehTekanMulai({ pratinjau: { jumlahTrx: 1, dampakStok: { bahanNegatifSesudah: 2 } }, batchAktif: null, roles: ["OWNER"], memuat: false }).alasan, /negatif/);
  assert.equal(bolehTekanMulai({ pratinjau: pra, batchAktif: null, roles: ["OWNER"], memuat: true }).ok, false);
});
test("rujukan minimal 8 karakter; pilihan order: semua → null, sebagian → daftar", () => {
  assert.equal(validasiRujukan("pendek").ok, false); assert.equal(validasiRujukan("  OWNER-2026-10  ").nilai, "OWNER-2026-10");
  assert.equal(unitTerpilih(["a", "b", "c"], ["a", "b", "c"]), null); assert.deepEqual(unitTerpilih(["a", "b", "c"], ["a", "c"]), ["a", "c"]); assert.equal(unitTerpilih(["a"], []), null);
});
test("pilih hanya yang tampil: sebagian → daftar, semua → null (manifest penuh), tidak ada → kosong (tombol Mulai mati)", () => {
  assert.deepEqual(pilihHanyaTampil(["a", "b", "c"], ["b"]), ["b"]); assert.equal(pilihHanyaTampil(["a", "b"], ["a", "b"]), null); assert.deepEqual(pilihHanyaTampil(["a", "b"], []), []); assert.deepEqual(pilihHanyaTampil(["a"], ["x"]), []);
});
test("HPP batch: PARSIAL bila order masih punya catatan tertahan walau transaksi batch bernilai", () => {
  const h = ringkasHpp({ status: "PARSIAL", nilaiTercatat: 284000, belumDijurnal: 284000, trxTanpaHarga: 0, catatanTertahan: 7, jurnalDibuat: false });
  assert.equal(h.label, "HPP PARSIAL"); assert.match(h.penjelasan, /7 catatan masih tertahan/); assert.equal(h.belumDijurnal, "Rp284.000");
});
test("polling: cepat saat aktif, lambat idle, berhenti saat tab tersembunyi, mundur eksponensial saat putus (maks 30 dtk)", () => {
  assert.equal(intervalPolling({ status: "BERJALAN", tersembunyi: false }), 2500); assert.equal(intervalPolling({ status: "SELESAI", tersembunyi: false }), 15000);
  assert.equal(intervalPolling({ status: "BERJALAN", tersembunyi: true }), null);
  assert.equal(intervalPolling({ status: "BERJALAN", tersembunyi: false, gagalBeruntun: 2 }), 10000); assert.equal(intervalPolling({ status: "BERJALAN", tersembunyi: false, gagalBeruntun: 9 }), 30000);
});
test("status basi: koneksi putus mempertahankan status terakhir dan menandainya", () => {
  assert.deepEqual(gabungStatus({ status: "BERJALAN" }, null), { status: "BERJALAN", basi: true }); assert.equal(gabungStatus({ status: "A" }, { status: "B" }).basi, false); assert.equal(gabungStatus(null, null), null);
});
test("galat: konflik hash, izin, persetujuan, koneksi", () => {
  assert.match(pesanGalat({ status: 409, code: "RENCANA_BERUBAH" }), /Muat ulang manifest/); assert.match(pesanGalat({ status: 403 }), /tidak punya izin/);
  assert.match(pesanGalat({ status: 403, code: "PERSETUJUAN_WAJIB", message: "Posting butuh hash" }), /hash/); assert.match(pesanGalat(new Error("Failed to fetch")), /Koneksi terputus/);
  assert.equal(pesanGalat(null), "");
});
test("format: rupiah, label status", () => {
  assert.equal(rupiah(2346600), "Rp2.346.600"); assert.equal(rupiah(null), "—"); assert.equal(labelStatusBatch("TERPUTUS").nada, "red"); assert.equal(labelStatusBatch("SELESAI_SEBAGIAN").label, "Selesai sebagian");
});

// ── konfirmasi manifest (insiden 25 Okt 2026) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
import { BATAS_KONTROL, ambilNomorOrder, bacaSyaratSaldo, bangunKonfirmasiManifest, bolehKendaliBatch, isiTransaksiDari, normalHash, periksaKonfirmasiLayar, saldoManifestDari } from "../src/features/warehouse/postingHistoris/postingHistorisModel.js";
const H1 = "3".repeat(64); const H2 = "4".repeat(64);
const manifest = (o = {}) => ({
  hash: H1, jumlahOrder: 2, jumlahTrx: 3, unitIds: ["u1", "u2"], digestIsi: "d".repeat(64),
  order: [{ orderNumber: "RES-01102026-005", unitId: "u1", trx: [{ kodeBahan: "SPANBON-75GRAM", qty: 2, satuan: "METER", tanggal: "2026-10-05" }] }, { orderNumber: "NEW-02102026-007", unitId: "u2", trx: [{ kodeBahan: "SUDUT-GOLD", qty: 4, satuan: "PCS", tanggal: "2026-10-10" }, { kodeBahan: "SPANBON-75GRAM", qty: 1.2, satuan: "METER", tanggal: "2026-10-10" }] }],
  bahan: [{ kode: "SPANBON-75GRAM", saldoSekarang: 291, materialId: "m1" }, { kode: "SUDUT-GOLD", saldoSekarang: 86, materialId: "m2" }], ...o,
});
test("izin memulai: HANYA Owner (sementara); Finance/Admin memantau; Owner dan Finance mengendalikan batch yang ada", () => {
  assert.equal(bolehMulaiPosting(["OWNER"]), true); assert.equal(bolehMulaiPosting(["FINANCE"]), false); assert.equal(bolehMulaiPosting(["ADMIN"]), false); assert.equal(bolehMulaiPosting(["ADMIN", "FINANCE", "OWNER"]), true);
  assert.equal(bolehKendaliBatch(["FINANCE"]), true); assert.equal(bolehKendaliBatch(["OWNER"]), true); assert.equal(bolehKendaliBatch(["ADMIN"]), false);
  assert.equal(bolehTekanMulai({ pratinjau: { jumlahTrx: 1 }, batchAktif: null, roles: ["FINANCE"], memuat: false }).ok, false);
  assert.match(bolehTekanMulai({ pratinjau: { jumlahTrx: 1 }, batchAktif: null, roles: ["FINANCE"], memuat: false }).alasan, /hanya akun Owner/);
  assert.match(BATAS_KONTROL, /bukan persetujuan Owner yang tercatat terpisah/); assert.match(BATAS_KONTROL, /hanya akun Owner/);
});
test("konfirmasi: nomor order dikenali dari teks bebas (huruf besar, unik), syarat saldo dibaca per baris", () => {
  assert.deepEqual(ambilNomorOrder("Disetujui: res-01102026-005, RES-01102026-005\nNEW-02102026-007."), ["RES-01102026-005", "NEW-02102026-007"]);
  assert.deepEqual(ambilNomorOrder("tanpa order"), []); assert.deepEqual(ambilNomorOrder(null), []);
  const s = bacaSyaratSaldo("SPANBON-75GRAM=300\nSUDUT-GOLD: 90 pcs\nKAI-003 = 122,5"); assert.equal(s.ok, true); assert.deepEqual(s.daftar, [{ kode: "SPANBON-75GRAM", saldo: 300 }, { kode: "SUDUT-GOLD", saldo: 90 }, { kode: "KAI-003", saldo: 122.5 }]);
  const buruk = bacaSyaratSaldo("salah ini\nOK=1"); assert.equal(buruk.ok, false); assert.deepEqual(buruk.galat, ["salah ini"]); assert.equal(bacaSyaratSaldo("").ok, true);
});
test("konfirmasi: cocok bila hash, daftar order, jumlah order & transaksi sama dengan manifest di layar", () => {
  assert.deepEqual(periksaKonfirmasiLayar({ manifest: manifest(), hash: ` ${H1.toUpperCase()} `, daftarOrder: ["RES-01102026-005", "NEW-02102026-007"], jumlahOrder: "2", jumlahTrx: "3" }), []);
});
test("konfirmasi: insiden — jumlah order sama tetapi order/hash berbeda terbaca sebagai selisih yang jelas", () => {
  const beda = periksaKonfirmasiLayar({ manifest: manifest(), hash: H2, daftarOrder: ["RES-01102026-005", "RES-09092026-047"], jumlahOrder: "2", jumlahTrx: "3" });
  assert.ok(beda.some((x) => /BERBEDA dari manifest di layar/.test(x))); assert.ok(beda.some((x) => /Order di layar yang TIDAK ada di daftar Anda \(1\): NEW-02102026-007/.test(x))); assert.ok(beda.some((x) => /Order di daftar Anda yang TIDAK dipilih di layar \(1\): RES-09092026-047/.test(x)));
  assert.deepEqual(periksaKonfirmasiLayar({ manifest: manifest(), hash: H1, daftarOrder: ["RES-01102026-005", "NEW-02102026-007"], jumlahOrder: "2", jumlahTrx: "13" }), ["Jumlah transaksi yang Anda ketik 13 ≠ manifest 3."]);
});
test("konfirmasi: kolom kosong/tidak valid tidak pernah dianggap cocok", () => {
  assert.equal(periksaKonfirmasiLayar({ manifest: manifest(), hash: "", daftarOrder: [], jumlahOrder: "", jumlahTrx: "" }).length, 4);
  assert.ok(periksaKonfirmasiLayar({ manifest: manifest(), hash: "pendek", daftarOrder: ["RES-01102026-005", "NEW-02102026-007"], jumlahOrder: "2", jumlahTrx: "3" }).some((x) => /64 karakter hex/.test(x)));
  assert.ok(periksaKonfirmasiLayar({ manifest: manifest(), hash: H1, daftarOrder: ["RES-01102026-005", "NEW-02102026-007"], jumlahOrder: "2.0", jumlahTrx: "3" }).some((x) => /Isi jumlah order/.test(x)));
  assert.deepEqual(periksaKonfirmasiLayar({ manifest: null }), ["Manifest belum dimuat."]);
});
test("konfirmasi: isi transaksi lengkap (ID unit, order, bahan, qty, satuan, tanggal) dan saldo yang ditinjau diambil dari manifest yang tampil", () => {
  assert.deepEqual(isiTransaksiDari(manifest()), [
    { unitId: "u1", orderNumber: "RES-01102026-005", kodeBahan: "SPANBON-75GRAM", qty: 2, satuan: "METER", tanggal: "2026-10-05" },
    { unitId: "u2", orderNumber: "NEW-02102026-007", kodeBahan: "SUDUT-GOLD", qty: 4, satuan: "PCS", tanggal: "2026-10-10" },
    { unitId: "u2", orderNumber: "NEW-02102026-007", kodeBahan: "SPANBON-75GRAM", qty: 1.2, satuan: "METER", tanggal: "2026-10-10" }]);
  assert.deepEqual(saldoManifestDari(manifest()), [{ kode: "SPANBON-75GRAM", saldo: 291 }, { kode: "SUDUT-GOLD", saldo: 86 }]); assert.deepEqual(isiTransaksiDari(null), []);
});
test("konfirmasi: badan yang dikirim membawa nilai yang diketik + unit terpilih + isi transaksi + saldo ditinjau; rujukan dipangkas; syarat saldo hanya bila ada", () => {
  const b = bangunKonfirmasiManifest({ manifest: manifest(), hash: ` ${H1.toUpperCase()} `, daftarOrder: ["RES-01102026-005", "NEW-02102026-007"], jumlahOrder: "2", jumlahTrx: "3", rujukan: "  OWNER-QTY-5ORDER-20261025 ", saldoSyarat: [] });
  assert.equal(b.hash, H1); assert.deepEqual(b.unitIds, ["u1", "u2"]); assert.equal(b.jumlahOrder, 2); assert.equal(b.jumlahTrx, 3); assert.equal(b.rujukan, "OWNER-QTY-5ORDER-20261025"); assert.equal(b.isiTransaksi.length, 3); assert.equal(b.saldoManifest.length, 2); assert.ok(!("saldoSyarat" in b));
  assert.deepEqual(bangunKonfirmasiManifest({ manifest: manifest(), hash: H1, daftarOrder: [], jumlahOrder: "2", jumlahTrx: "3", rujukan: "x", saldoSyarat: [{ kode: "A", saldo: 1 }] }).saldoSyarat, [{ kode: "A", saldo: 1 }]);
  assert.equal(normalHash(` ${H1.toUpperCase()} `), H1);
});
test("pesan galat: konfirmasi tidak cocok memuat selisih; klien lama diminta muat ulang; bukan Owner dijelaskan", () => {
  assert.match(pesanGalat({ code: "KONFIRMASI_MANIFEST_TIDAK_COCOK", detail: ["hash manifest: a ≠ b", "jumlah transaksi: 5 ≠ 13"] }), /tidak ada yang diposting\. hash manifest: a ≠ b · jumlah transaksi: 5 ≠ 13/i);
  assert.match(pesanGalat({ code: "KONFIRMASI_MANIFEST_WAJIB" }), /Muat ulang/); assert.match(pesanGalat({ code: "KONFIRMASI_MANIFEST_TIDAK_COCOK" }), /TIDAK COCOK/); assert.match(pesanGalat({ code: "HANYA_OWNER_MEMULAI" }), /hanya akun Owner/);
});
