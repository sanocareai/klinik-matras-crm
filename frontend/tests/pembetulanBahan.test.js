import test from "node:test";
import assert from "node:assert/strict";
import { CARA, JALUR, PESAN, barisDampak, bolehKonfirmasi, daftarSudahTercatat, perluKonfirmasiGanda, sidikIsian, tglIndo, tubuhPembetulan, unitTerkirim, uraiDilaporkan, validasiPembetulan, validasiTanggal } from "../src/features/production/bahan/pembetulanModel.js";

const bahan = { materialId: "m1", nama: "BUSA", kode: "B-1", satuan: "KG" };
const SKR = new Date("2026-10-26T03:00:00Z"); // 26 Okt 2026 10:00 WIB

test("hanya unit TERKIRIM; unit dibatalkan dan aktif bukan", () => {
  assert.equal(unitTerkirim("DELIVERED"), true);
  for (const s of ["CANCELLED", "IN_PRODUCTION", "RECEIVED", undefined]) assert.equal(unitTerkirim(s), false);
});

test("jalur dipisah tegas: A catatan tanpa stok (layanan + tempat tampil dijelaskan) vs B pengeluaran stok", () => {
  assert.match(JALUR.CATATAN.badge, /Tidak mengubah stok, jurnal, atau HPP/); assert.match(JALUR.STOK.badge, /Mengubah stok & HPP/);
  assert.match(JALUR.CATATAN.teks, /Pemakaian sementara/); assert.match(JALUR.CATATAN.teks, /Komponen lama/); assert.match(JALUR.CATATAN.tampil, /Bahan belum ada di katalog/); assert.match(JALUR.CATATAN.tampil, /terpisah/);
  assert.deepEqual(CARA.filter((c) => c.grup === "CATATAN").map((c) => c.key), ["SEMENTARA", "KOMPONEN"]); assert.deepEqual(CARA.filter((c) => c.grup === "STOK").map((c) => c.key), ["TAMBAH", "KURANGI", "AJUKAN"]);
  assert.equal(CARA.find((c) => c.key === "AJUKAN").langsung, false, "koreksi jumlah butuh persetujuan");
  assert.match(CARA.find((c) => c.key === "TAMBAH").ringkas, /PENGELUARAN STOK/); assert.match(CARA.find((c) => c.key === "SEMENTARA").ringkas, /Hanya catatan/);
  assert.match(PESAN.tanggalPenjelas, /Waktu pencatatan/);
});

test("tanggal pemakaian dilaporkan: wajib, format valid, tidak di masa depan (hari WIB); label Indonesia; urai dari catatan baku", () => {
  assert.equal(validasiTanggal("", SKR).ok, false); assert.equal(validasiTanggal("20-10-2026", SKR).ok, false); assert.equal(validasiTanggal("2026-02-30", SKR).ok, false);
  assert.equal(validasiTanggal("2026-10-27", SKR).ok, false, "besok = masa depan"); assert.equal(validasiTanggal("2026-10-26", SKR).ok, true); assert.equal(validasiTanggal("2026-10-20", SKR).ok, true);
  assert.equal(validasiTanggal("2026-10-26", new Date("2026-10-25T18:00:00Z")).ok, true, "01:00 WIB tanggal 26 sudah hari ini");
  assert.equal(tglIndo("2026-10-20"), "20 Okt 2026"); assert.equal(tglIndo(null), "—");
  assert.equal(uraiDilaporkan("Pembetulan unit terkirim (RES-1-U1) [dilaporkan 2026-10-20]: alasan | x"), "2026-10-20"); assert.equal(uraiDilaporkan("catatan biasa"), null);
});

test("validasi: tanggal + alasan (min 5) wajib di semua jalur; jumlah > 0 untuk stok/sementara; komponen tanpa jumlah stok; koreksi jumlah boleh 0 tanpa tanggal; batas pengembalian", () => {
  const dasar = { cara: "TAMBAH", bahan, qty: "2", alasan: "Terlewat dicatat", tanggal: "2026-10-20", sekarang: SKR };
  assert.equal(validasiPembetulan({ ...dasar }).ok, true); assert.equal(validasiPembetulan({ ...dasar, tanggal: "" }).ok, false); assert.match(validasiPembetulan({ ...dasar, alasan: "abc" }).galat, /Alasan wajib/);
  assert.equal(validasiPembetulan({ ...dasar, bahan: null }).ok, false); assert.equal(validasiPembetulan({ ...dasar, qty: "0" }).ok, false); assert.equal(validasiPembetulan({ ...dasar, alasan: "x".repeat(501) }).ok, false);
  const ok = validasiPembetulan({ ...dasar, qty: "2,5", alasan: "  Terlewat dicatat  " }); assert.equal(ok.qty, 2.5); assert.equal(ok.alasan, "Terlewat dicatat"); assert.equal(ok.tanggal, "2026-10-20");
  assert.equal(validasiPembetulan({ ...dasar, cara: "SEMENTARA", bahan: null }).ok, true, "sementara: nama bahan bebas"); assert.equal(validasiPembetulan({ ...dasar, cara: "KOMPONEN", bahan: null, qty: "" }).ok, true);
  assert.equal(validasiPembetulan({ ...dasar, cara: "KOMPONEN", bahan: null, qty: "", tanggal: "" }).ok, false, "komponen lama juga wajib tanggal");
  assert.match(validasiPembetulan({ ...dasar, cara: "KURANGI", qty: "6", maks: 5 }).galat, /melebihi pemakaian bersih/); assert.equal(validasiPembetulan({ ...dasar, cara: "KURANGI", qty: "5", maks: 5 }).ok, true);
  assert.equal(validasiPembetulan({ ...dasar, cara: "AJUKAN", qty: "0", tanggal: "" }).ok, true, "koreksi jumlah: pemakaian benar boleh 0, tanpa tanggal tunggal");
});

test("tubuh permintaan memuat alasan, tanggal dilaporkan, saldo yang dilihat; pengurangan = qty negatif; konfirmasi bukan-ganda hanya bila dicentang", () => {
  const pra = { stok: { saldoDilihat: 100 } };
  assert.deepEqual(tubuhPembetulan({ cara: "TAMBAH", bahan, qty: 3, alasan: " ok sekali ", tanggal: "2026-10-20", pra }), { materialId: "m1", qty: 3, alasanPembetulan: "ok sekali", tanggalPemakaian: "2026-10-20", saldoDilihat: 100 });
  const k = tubuhPembetulan({ cara: "KURANGI", bahan, qty: 2, alasan: "kelebihan", tanggal: "2026-10-20", pra, sudahPeriksa: true }); assert.equal(k.qty, -2); assert.equal(k.konfirmasiBukanGanda, true);
});

test("konfirmasi: setelah dampak dilihat, tanpa penghalang, isian belum berubah, dan (bila ada kemungkinan sudah tercatat) pernyataan pemeriksaan", () => {
  const a = { cara: "TAMBAH", bahan, qty: "3", alasan: "a b c d e", tanggal: "2026-10-20" };
  const s1 = sidikIsian(a); const s2 = sidikIsian({ ...a, qty: "4" }); const s3 = sidikIsian({ ...a, tanggal: "2026-10-21" });
  assert.notEqual(s1, s3, "mengubah tanggal = lihat dampak lagi");
  assert.equal(bolehKonfirmasi(null, s1, s1), false); assert.equal(bolehKonfirmasi({ boleh: false }, s1, s1), false); assert.equal(bolehKonfirmasi({ boleh: true }, s2, s1), false);
  assert.equal(bolehKonfirmasi({ boleh: true }, s1, s1), true);
  const ganda = { boleh: true, sudahTercatat: { perluKonfirmasi: true } };
  assert.equal(perluKonfirmasiGanda(ganda), true); assert.equal(bolehKonfirmasi(ganda, s1, s1), false, "kemungkinan ganda: tanpa pernyataan pemeriksaan tidak boleh"); assert.equal(bolehKonfirmasi(ganda, s1, s1, { sudahPeriksa: true }), true);
  assert.equal(sidikIsian({ ...a, cara: "AJUKAN", tanggal: "2026-10-01" }), sidikIsian({ ...a, cara: "AJUKAN", tanggal: "2026-10-02" }), "koreksi jumlah tidak bergantung tanggal");
});

test("pratinjau: tindakan (catatan saja vs stok baru) dan waktu terpisah tampil; kandidat ganda ditampilkan apa adanya (tertaut dulu) tanpa penautan otomatis", () => {
  const pra = { tindakan: { judul: "Membuat PENGELUARAN STOK BARU", teks: "Bukan sekadar catatan.", menulisStok: true }, waktu: { teks: "Tanggal pemakaian yang Anda laporkan: 2026-10-20." }, bahan: { satuan: "KG" },
    stok: { saldoSebelum: null, saldoSesudah: -3 }, pemakaianBersih: { sebelum: 0, sesudah: 3 }, finance: { hasil: "GAP_PERSEDIAAN_AWAL", teks: "TIDAK ada jurnal" }, hppOperasional: { teks: "Belum ada Harga Berlaku" },
    sudahTercatat: { tertaut: [{ kind: "PENGELUARAN_TERTAUT_UNIT", id: "t1", qty: 2, alasan: ["Sudah tertaut ke unit ini"] }], kemungkinan: [{ kind: "PENGELUARAN_TANPA_UNIT", id: "k1", qty: 3, alasan: ["Bahan sama"] }], perluKonfirmasi: true } };
  const b = barisDampak(pra); assert.equal(b[0].k, "tindakan"); assert.equal(b[0].tegas, true); assert.match(b[0].teks, /PENGELUARAN STOK BARU/); assert.equal(b[1].k, "waktu"); assert.equal(b.find((x) => x.k === "stok").teks, "belum diketahui → -3 KG");
  assert.equal(b.find((x) => x.k === "finance").teks, "TIDAK ada jurnal");
  const d = daftarSudahTercatat(pra); assert.deepEqual(d.map((x) => x.id), ["t1", "k1"]); assert.equal(d[0].tertaut, true); assert.equal(d[1].tertaut, false); assert.equal(d[1].jenisTeks, "Pengeluaran bahan sama TANPA unit");
  const catatan = barisDampak({ tindakan: { judul: "Hanya MENAMBAH CATATAN", teks: "Stok tidak berubah.", menulisStok: false }, waktu: { teks: "w" }, stok: null, finance: { hasil: "TIDAK_ADA", teks: "Tidak ada nilai atau jurnal" }, hppOperasional: { teks: "HPP tidak berubah" } });
  assert.equal(catatan[0].tegas, false); assert.equal(catatan.find((x) => x.k === "stok").teks, "Tidak berubah (hanya catatan)."); assert.deepEqual(barisDampak(null), []); assert.deepEqual(daftarSudahTercatat(null), []);
});
