// Aturan tiga waktu Stock Opname sesi model 2 + cakupan "saldo dilacak fisik" (murni, tanpa DB).
import test from "node:test";
import assert from "node:assert/strict";
import { klasifikasiPergerakan, hitungPembanding, ringkasProgres, bangunCakupan, memenuhiCakupan, bahanDiLuarCakupan, tanggalWib, KELAS, MAKS_BAHAN_CYCLE_COUNT } from "../src/services/opnameSesi.js";
import * as modul from "../src/services/opnameSesi.js";
import { sinyalDariJejak } from "../src/services/stokFisik.js";

const O = new Date("2026-11-01T03:00:00Z"); // pengamatan 10.00 WIB
const menit = (n) => new Date(O.getTime() + n * 60_000);

test("tidak ada lagi jendela tetap: modul tidak mengekspor JENDELA_RAGU_MENIT dan pergerakan 29 menit atau 5 jam sebelum pengamatan sama-sama 'sebelum'", () => {
  assert.equal(modul.JENDELA_RAGU_MENIT, undefined);
  assert.equal(klasifikasiPergerakan({ createdAt: menit(-29), observedAt: O }), KELAS.SEBELUM);
  assert.equal(klasifikasiPergerakan({ createdAt: menit(-300), observedAt: O }), KELAS.SEBELUM);
});

test("klasifikasi: SEBELUM (< pengamatan) otomatis; SERENTAK (= milidetik pengamatan); SAAT_HITUNG (antara pengamatan dan angka disimpan); SESUDAH_DISIMPAN; BERTANGGAL_MUNDUR mengalahkan keduanya", () => {
  const simpan = menit(40); // angka disimpan 10.40
  assert.equal(klasifikasiPergerakan({ createdAt: menit(-1), observedAt: O, savedAt: simpan }), KELAS.SEBELUM);
  assert.equal(klasifikasiPergerakan({ createdAt: menit(0), observedAt: O, savedAt: simpan }), KELAS.SERENTAK, "tepat di milidetik pengamatan: urutan tidak pasti → ditandai, tidak diputuskan diam-diam");
  assert.equal(klasifikasiPergerakan({ createdAt: menit(5), observedAt: O, savedAt: simpan }), KELAS.SAAT_HITUNG, "GR 10.05 saat barang dihitung 10.00 dan angka disimpan 10.40");
  assert.equal(klasifikasiPergerakan({ createdAt: menit(40), observedAt: O, savedAt: simpan }), KELAS.SAAT_HITUNG, "tepat saat angka disimpan masih dalam jendela hitung");
  assert.equal(klasifikasiPergerakan({ createdAt: menit(41), observedAt: O, savedAt: simpan }), KELAS.SESUDAH);
  assert.equal(klasifikasiPergerakan({ createdAt: menit(600), observedAt: O, savedAt: simpan }), KELAS.SESUDAH, "tanpa batas atas tetap: berhari-hari sesudahnya tetap ditandai");
  // diposting belakangan dengan tanggal kejadian pada/sebelum hari pengamatan → mungkin sudah ada di fisik
  assert.equal(klasifikasiPergerakan({ createdAt: menit(600), observedAt: O, savedAt: simpan, tanggalKejadian: "2026-10-30" }), KELAS.MUNDUR);
  assert.equal(klasifikasiPergerakan({ createdAt: menit(600), observedAt: O, savedAt: simpan, tanggalKejadian: "2026-11-01" }), KELAS.MUNDUR, "tanggal sama dengan hari pengamatan: jam tidak diketahui → konservatif");
  assert.equal(klasifikasiPergerakan({ createdAt: menit(2000), observedAt: O, savedAt: simpan, tanggalKejadian: "2026-11-02" }), KELAS.SESUDAH, "tanggal kejadian hari sesudahnya → bukan mundur");
  assert.equal(klasifikasiPergerakan({ createdAt: menit(5), observedAt: O, savedAt: simpan, tanggalKejadian: "2026-10-31" }), KELAS.MUNDUR);
  assert.equal(tanggalWib(new Date("2026-10-31T18:00:00Z")), "2026-11-01", "tanggal kalender memakai WIB (UTC+7)");
});

test("pembanding = saldo SEBELUM pengamatan + yang diputuskan SUDAH tercermin; BELUM tidak ikut; tanpa keputusan menahan; waktu simpan tidak dipakai sebagai acuan saldo", () => {
  const p = (id, qty, tanda = null, kelas = KELAS.SAAT_HITUNG) => ({ id, qty, tanda, kelas });
  const h0 = hitungPembanding({ saldoSebelum: 100, countedQty: 100, pergerakan: [p("gr", 20), p("mi", -6, null, KELAS.SESUDAH)] });
  assert.equal(h0.pembanding, 100, "GR 10.05 tidak diam-diam masuk pembanding fisik 10.00"); assert.equal(h0.selisih, 0); assert.equal(h0.belumDiputuskan.length, 2);
  const belum = hitungPembanding({ saldoSebelum: 100, countedQty: 100, pergerakan: [p("gr", 20, "BELUM_TERHITUNG"), p("mi", -6, "BELUM_TERHITUNG", KELAS.SESUDAH)] });
  assert.equal(belum.pembanding, 100); assert.equal(belum.belumDiputuskan.length, 0); assert.equal(belum.belumTercermin, 14); assert.equal(belum.berselisih, false);
  const sudah = hitungPembanding({ saldoSebelum: 100, countedQty: 120, pergerakan: [p("gr", 20, "SUDAH_TERHITUNG", KELAS.MUNDUR)] });
  assert.equal(sudah.pembanding, 120); assert.equal(sudah.selisih, 0, "fisik 120 sudah memuat GR bertanggal mundur: tidak ada selisih palsu"); assert.equal(sudah.sudahTercermin, 20);
  assert.equal(hitungPembanding({ saldoSebelum: 3, countedQty: 3 }).berselisih, false);
  assert.equal(hitungPembanding({ saldoSebelum: 0.1 + 0.2, countedQty: 0.3 }).berselisih, false, "pembulatan desimal tidak membuat selisih palsu");
  // invarian saldo akhir: akhir = fisik + Σ yang diputuskan BELUM (selisih ditulis sebagai penyesuaian)
  const gerak = [p("a", 20, "BELUM_TERHITUNG"), p("b", -6, "BELUM_TERHITUNG", KELAS.SESUDAH), p("c", 4, "SUDAH_TERHITUNG", KELAS.MUNDUR)];
  const fisik = 97; const saldoSebelum = 100; const h = hitungPembanding({ saldoSebelum, countedQty: fisik, pergerakan: gerak });
  const ledgerAkhir = saldoSebelum + gerak.reduce((s, x) => s + x.qty, 0) + h.selisih;
  assert.equal(ledgerAkhir, fisik + 20 - 6, "saldo akhir = fisik + pergerakan yang belum ikut terhitung");
});

test("progres: kosong ≠ 0, dikeluarkan tidak dihitung, perlu diperiksa per kelompok, hitungan tanpa waktu terhitung terpisah", () => {
  const r = ringkasProgres([{ kelompokKode: "BUSA", counted: 0 }, { kelompokKode: "BUSA", counted: null }, { kelompokKode: "KAIN", counted: 5, perluPeriksa: true, tanpaWaktu: true }, { kelompokKode: "KAIN", counted: null, excluded: true }]);
  assert.equal(r.total, 3); assert.equal(r.dihitung, 2, "0 eksplisit terhitung"); assert.equal(r.belum, 1); assert.equal(r.dikeluarkan, 1); assert.equal(r.perluPeriksa, 1); assert.equal(r.persen, 66.7); assert.equal(r.tanpaWaktu, 1);
  assert.deepEqual(r.perKelompok.map((k) => [k.kode, k.total, k.dihitung]), [["BUSA", 2, 1], ["KAIN", 1, 1]]);
});

test("cakupan: bawaan = bahan aktif yang saldonya DILACAK (bukti), bukan nama kategori; tak dilacak tampil dengan alasan; bisa diikutkan beralasan; Cycle Count dibatasi; di luar cakupan hanya yang memenuhi kriteria", () => {
  const mk = (i, itemGroup, extra = {}) => ({ id: `id${i}`, code: `M${i}`, name: `B${i}`, unit: "PCS", active: true, category: "RAW_MATERIAL", itemGroup, dilacak: true, sinyal: ["CATATAN_LEDGER"], ...extra });
  const bahan = [mk(1, "REBONDED"), mk(2, "KAIN"), mk(3, null), mk(4, "SUPPORT KAIN"), mk(5, "KAIN", { active: false }), mk(6, "KAIN", { category: "CONSUMABLE" }), mk(7, "KAIN", { category: "CONSUMABLE", dilacak: false, sinyal: [] }), mk(8, "KAIN", { dilacak: false, sinyal: [] })];
  const penuh = bangunCakupan(bahan, { mode: "FULL" });
  assert.equal(penuh.materialIds.length, 5, "id1,2,3,4 + id6 (Habis Pakai dengan jejak stok ikut); id7 (Habis Pakai tanpa jejak) dan id8 (bahan baku tanpa jejak) tidak");
  assert.ok(penuh.materialIds.includes("id6") && !penuh.materialIds.includes("id7") && !penuh.materialIds.includes("id8"), "kategori tidak menentukan: yang menentukan adalah bukti");
  assert.deepEqual(penuh.ringkasan.tidakDilacak.daftar.map((x) => x.kode), ["M7", "M8"]); assert.match(penuh.ringkasan.tidakDilacak.daftar[0].alasan, /Tidak ada jejak stok/); assert.equal(penuh.ringkasan.tidakDilacak.jumlah, 2);
  assert.equal(penuh.ringkasan.belumDikelompokkan.masuk, 2); assert.equal(penuh.ringkasan.nonaktif.jumlah, 1);
  assert.throws(() => bangunCakupan(bahan, { mode: "FULL", ikutkanTakDilacak: ["id8"] }), /Alasan mengikutkan/);
  const ikut = bangunCakupan(bahan, { mode: "FULL", ikutkanTakDilacak: ["id8"], ikutkanAlasan: "Ada barangnya di rak C" }); assert.equal(ikut.materialIds.length, 6); assert.equal(ikut.ringkasan.tidakDilacak.diikutkan, 1);
  assert.throws(() => bangunCakupan(bahan, { mode: "FULL", ikutkanTakDilacak: ["id5"], ikutkanAlasan: "uji" }), /tidak ditemukan atau nonaktif/);
  assert.equal(bangunCakupan(bahan, { mode: "FULL", excludeJenis: ["CONSUMABLE"] }).materialIds.length, 4);
  assert.throws(() => bangunCakupan(bahan, { mode: "FULL", excludeMaterialIds: ["id1"] }), /Alasan pengecualian/);
  assert.equal(bangunCakupan(bahan, { mode: "GROUP", groups: ["KAIN"] }).materialIds.length, 2, "dilacak & aktif: id2 + id6");
  assert.equal(bangunCakupan(bahan, { mode: "ITEMS", materialIds: ["id8"] }).ringkasan.peringatanItems.length, 1, "Cycle Count boleh memilih bahan tak dilacak, dengan peringatan");
  assert.throws(() => bangunCakupan(bahan, { mode: "ITEMS", materialIds: ["id5"] }), /nonaktif/);
  assert.throws(() => bangunCakupan(bahan, { mode: "ITEMS", materialIds: Array.from({ length: MAKS_BAHAN_CYCLE_COUNT + 1 }, (_, i) => `x${i}`) }), /dibatasi/);
  assert.equal(memenuhiCakupan(mk(9, "KAIN"), { mode: "GROUP", groups: ["KAIN"] }), true); assert.equal(memenuhiCakupan(mk(9, "KAIN"), { mode: "ITEMS" }), false);
  const sesi = { modelVersion: 2, scopeMode: "FULL", scopeInfo: { excludeJenis: ["CONSUMABLE"] }, lines: [{ materialId: "id1" }, { materialId: "id2" }] };
  assert.deepEqual(bahanDiLuarCakupan(bahan, sesi).map((m) => m.id), ["id3", "id4"], "dilacak, aktif, belum di sesi; consumable dikecualikan; tak dilacak & nonaktif tidak");
  assert.deepEqual(bahanDiLuarCakupan(bahan, sesi, new Set(["id3"])).map((m) => m.id), ["id4"], "yang sudah diputuskan diabaikan tidak muncul lagi");
  assert.deepEqual(bahanDiLuarCakupan(bahan, { ...sesi, scopeMode: "ITEMS" }), []); assert.deepEqual(bahanDiLuarCakupan(bahan, { ...sesi, modelVersion: 1 }), []);
});

test("sinyal stok: tiap jejak dikenali; tanpa satu pun = tidak dilacak", () => {
  assert.deepEqual(sinyalDariJejak({}), []);
  assert.deepEqual(sinyalDariJejak({ catatan: true, referensi: true, pesan_ulang: true, jenis_sku: true, dokumen: true, pernah_dihitung: true, bom: true }), ["CATATAN_LEDGER", "NILAI_REFERENSI", "TITIK_PESAN", "JENIS_SKU", "DOKUMEN_GUDANG", "PERNAH_DIHITUNG", "BOM_PRODUKSI"]);
  assert.deepEqual(sinyalDariJejak({ referensi: true }), ["NILAI_REFERENSI"]);
});
