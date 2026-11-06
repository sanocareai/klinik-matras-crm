// Beranda Gudang (redesain 7 Nov 2026): logika murni — satu dokumen satu baris, aksi yang jujur untuk dokumen terblokir, hitungan tidak disajikan sebagai total bila data belum lengkap.
import test from "node:test";
import assert from "node:assert/strict";
import {
  susunPekerjaan, saringPekerjaan, ringkasHambatan, kartuRingkasan, sisaBelumDimuat, aksiHasilCari, ringkasPerhatian, waktuPembaruan, jumlahFilterAktif, adaFilter, hitungKelompok, tanggalDariTeks, cocokPenanda,
} from "../src/features/warehouse/beranda/berandaLogika.js";

const item = (o) => ({ jenis: "penerimaan", jenisLabel: "Penerimaan", id: o.nomor, kunci: `penerimaan:${o.nomor}`, judul: o.nomor, status: "Menunggu barang", aksi: null, ...o });
const DATA = {
  dihitungPada: "2026-11-06T17:21:00.000Z",
  izin: { tulis: true },
  ringkasan: { tertahan: 3 },
  antrean: [
    { kode: "PENERIMAAN_AKAN_DATANG", judul: "Menunggu kedatangan", jumlah: 2, lebih: 0, item: [
      item({ nomor: "GR-1", aksi: { kode: "CATAT_TIBA", label: "Catat barang tiba" } }),
      item({ nomor: "GR-2", aksi: { kode: "CATAT_TIBA", label: "Catat barang tiba" } }),
    ] },
    { kode: "PENERIMAAN_SIAP_STOK", judul: "Siap disimpan", jumlah: 1, lebih: 0, item: [
      item({ nomor: "GR-3", status: "Siap masuk stok", aksi: { kode: "SIMPAN_KE_STOK", label: "Simpan ke stok" } }),
    ] },
  ],
  tertahan: [
    { kode: "JADWAL_LEWAT", judul: "Melewati jadwal", jumlah: 2, lebih: 0, item: [
      item({ nomor: "GR-1", tertahan: { teks: "Jadwal 2026-10-12 sudah lewat 26 hari." } }),
      item({ nomor: "GR-2", tertahan: { teks: "Jadwal 2026-10-12 sudah lewat 26 hari." } }),
    ] },
    { kode: "DATA_WAJIB", judul: "Data wajib belum lengkap", jumlah: 1, lebih: 0, item: [
      item({ nomor: "GR-3", tertahan: { teks: "Tidak ada item dengan jumlah baik." } }),
    ] },
    { kode: "MENUNGGU_WORKSPACE", judul: "Menunggu pihak lain", jumlah: 1, lebih: 0, item: [
      item({ jenis: "unit", jenisLabel: "Unit", nomor: "U-9", kunci: "unit:U-9", status: "Menunggu diterima", tertahan: { teks: "Menunggu Delivery." } }),
    ] },
  ],
};

test("satu dokumen satu baris: dokumen di antrean DAN daftar tertahan tidak digandakan; yang lewat jadwal di atas", () => {
  const r = susunPekerjaan(DATA);
  assert.equal(r.length, 4);
  assert.equal(new Set(r.map((x) => x.kunci)).size, 4);
  assert.deepEqual(r.slice(0, 2).map((x) => x.nomor), ["GR-1", "GR-2"], "lewat jadwal lebih dulu");
  assert.equal(r[0].lewatHari, 26);
  assert.ok(r.find((x) => x.nomor === "U-9").hanyaTertahan, "dokumen yang hanya tertahan tetap muncul sebagai baris");
});

test("dokumen siap-simpan tanpa jumlah baik: aksi diarahkan ke Lengkapi pemeriksaan; status dan hambatan asli tidak diubah", () => {
  const g3 = susunPekerjaan(DATA).find((x) => x.nomor === "GR-3");
  assert.equal(g3.terblokirSimpan, true);
  assert.equal(g3.aksi.kode, "ISI_PEMERIKSAAN");
  assert.equal(g3.aksiAsli.kode, "SIMPAN_KE_STOK");
  assert.equal(g3.status, "Siap masuk stok");
  assert.equal(g3.hambatan[0].sebab, "DATA_WAJIB");
  const biasa = susunPekerjaan({ ...DATA, tertahan: [] }).find((x) => x.nomor === "GR-3");
  assert.equal(biasa.aksi.kode, "SIMPAN_KE_STOK", "tanpa hambatan data, aksi server dipertahankan");
});

test("ringkasHambatan: memendekkan hanya pola yang dikenali; selain itu teks server dipakai utuh", () => {
  assert.deepEqual(ringkasHambatan({ sebab: "JADWAL_LEWAT", teks: "Jadwal 2026-10-12 sudah lewat 26 hari." }), { judul: "12 Okt 2026", ket: "Lewat 26 hari", tegas: true });
  assert.equal(ringkasHambatan({ sebab: "DATA_WAJIB", teks: "Tidak ada item dengan jumlah baik." }).judul, "Tidak ada jumlah baik");
  const lain = ringkasHambatan({ sebab: "STOK_KURANG", teks: "Saldo kurang untuk 2 bahan." });
  assert.equal(lain.ket, "Saldo kurang untuk 2 bahan.");
  assert.equal(tanggalDariTeks("tanpa tanggal"), null);
});

test("saringan: kelompok, jenis, penanda, kata kunci (semua kata cocok); reset = semua baris", () => {
  const r = susunPekerjaan(DATA);
  assert.deepEqual(saringPekerjaan(r, { penanda: "lewat" }).map((x) => x.nomor).sort(), ["GR-1", "GR-2"]);
  assert.deepEqual(saringPekerjaan(r, { jenis: ["unit"] }).map((x) => x.nomor), ["U-9"]);
  assert.deepEqual(saringPekerjaan(r, { q: "gr-3 jumlah baik" }).map((x) => x.nomor), ["GR-3"]);
  assert.deepEqual(saringPekerjaan(r, { q: "gr-3 tidak-ada" }), []);
  assert.deepEqual(saringPekerjaan(r, { antrean: ["PENERIMAAN_SIAP_STOK"] }).map((x) => x.nomor), ["GR-3"]);
  assert.equal(saringPekerjaan(r, {}).length, 4);
  assert.equal(cocokPenanda(r[0], "tanpa"), false);
  assert.equal(hitungKelompok(r).penerimaan, 3);
  assert.equal(jumlahFilterAktif({ jenis: ["unit"], penanda: "lewat" }), 2);
  assert.equal(adaFilter({ q: " ", kelompok: "semua" }), false);
  assert.equal(adaFilter({ q: "gr" }), true);
});

test("kartu ringkasan: angka = jumlah server (dokumen); kartu tumpang tindih tidak dijumlahkan; keterangan hanya bila data lengkap", () => {
  const r = susunPekerjaan(DATA);
  const lengkap = kartuRingkasan(DATA, r, true);
  assert.deepEqual(lengkap.map((k) => k.nilai), [2, 0, 1, 3]);
  assert.equal(lengkap[0].ket, "2 lewat jadwal");
  assert.equal(lengkap[2].ket, "1 perlu dilengkapi");
  assert.equal(lengkap[3].ket, null);
  const sebagian = kartuRingkasan(DATA, r, false);
  assert.equal(sebagian[0].ket, null, "belum lengkap: tidak menyajikan hitungan parsial sebagai total");
  assert.equal(sebagian[2].ket, null);
  assert.equal(sebagian[0].nilai, 2, "angka utama tetap dari server");
});

test("sisa belum dimuat: dihitung dari `lebih` server dikurangi halaman tambahan yang sudah dimuat", () => {
  const banyak = { antrean: [{ kode: "A", lebih: 84, item: [] }], tertahan: [{ kode: "T", lebih: 0, item: [] }] };
  assert.deepEqual(sisaBelumDimuat(banyak), { antrean: 84, tertahan: 0, ada: true });
  assert.equal(sisaBelumDimuat(banyak, { antrean: { A: new Array(84).fill({}) }, tertahan: {} }).ada, false);
  assert.equal(sisaBelumDimuat(null).ada, false);
});

test("hasil pencarian server tidak menawarkan Simpan ke stok; aksi lain tetap", () => {
  assert.equal(aksiHasilCari({ jenis: "penerimaan", aksi: { kode: "SIMPAN_KE_STOK" } }), null);
  assert.equal(aksiHasilCari({ jenis: "penerimaan", aksi: { kode: "CATAT_TIBA" } }).kode, "CATAT_TIBA");
  assert.equal(aksiHasilCari({ jenis: "penerimaan" }), null);
});

test("perhatian & waktu pembaruan: hanya sebab ber-jumlah; waktu WIB; tanggal tidak sah → null", () => {
  assert.deepEqual(ringkasPerhatian(DATA).map((p) => p.kode), ["JADWAL_LEWAT", "DATA_WAJIB", "MENUNGGU_WORKSPACE"]);
  assert.equal(ringkasPerhatian({ tertahan: [{ kode: "X", jumlah: 0 }] }).length, 0);
  assert.match(waktuPembaruan("2026-11-06T17:21:00.000Z"), /^7 Nov(?:\.)?, 00\.21$/);
  assert.equal(waktuPembaruan("bukan-tanggal"), null);
  assert.equal(waktuPembaruan(null), null);
});
