// Filter daftar Order Produksi (posisi unit · PIC · target selesai): murni, tanpa DB. Membuktikan definisi, batas hari WIB, kombinasi AND, dan cakupan SELURUH hasil (bukan hanya halaman pertama).
import test from "node:test";
import assert from "node:assert/strict";
import { PIC_TANPA, POSISI_FILTER, POSISI_KEYS, TARGET_KEYS, adaFilterBaris, fasetPic, lolosFilterBaris, parseFilterBaris, saringDanHalaman, tanggalWib } from "../src/lib/domain/filterDaftarOrderProduksi.js";
import { posisiUnitOf } from "../src/lib/domain/productionWorkStatus.js";

const baris = (o = {}) => ({
  id: o.id ?? "u", status: o.status ?? "IN_PRODUCTION",
  adopsi: { posisi: { key: o.posisi ?? "DI_WORKSHOP" }, kerja: { key: o.kerja ?? "DIJADWALKAN" }, pic: o.pic === null ? null : { nama: o.pic ?? "Rahmat" }, targetSelesai: o.target === null ? null : { at: o.target ?? "2026-11-05T03:00:00.000Z" }, kelengkapan: { keys: o.kel ?? [] } },
});
const NOW = new Date("2026-11-02T05:00:00.000Z"); // 12.00 WIB, 2 Nov 2026

test("posisi unit yang ditawarkan = kunci yang benar-benar dihasilkan posisiUnitOf (tidak ada pilihan yang mustahil cocok)", () => {
  const dihasilkan = new Set();
  const status = ["AWAITING_PICKUP", "IN_TRANSIT_IN", "RECEIVED", "IN_PRODUCTION", "READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED", "CANCELLED"];
  for (const unitStatus of status) for (const receivedBasis of [null, "CUSTODY"]) for (const pickupInProgress of [false, true]) for (const started of [false, true]) dihasilkan.add(posisiUnitOf({ unitStatus, receivedBasis, pickupInProgress, started }).key);
  for (const k of POSISI_KEYS) assert.ok(dihasilkan.has(k), `${k} tidak pernah dihasilkan posisiUnitOf`);
  assert.equal(POSISI_FILTER.length, new Set(POSISI_KEYS).size);
});

test("parameter: nilai tidak dikenal ditolak 400 (bukan diabaikan); kosong = tidak ada filter", () => {
  assert.equal(adaFilterBaris(parseFilterBaris({})), false);
  assert.throws(() => parseFilterBaris({ posisi: "DI_WORKSHOP,SURGA" }), (e) => e.statusCode === 400 && e.code === "POSISI_TIDAK_VALID");
  assert.throws(() => parseFilterBaris({ target: "kapan_saja" }), (e) => e.statusCode === 400 && e.code === "TARGET_TIDAK_VALID");
  assert.throws(() => parseFilterBaris({ pic: "x".repeat(121) }), (e) => e.statusCode === 400 && e.code === "PIC_TIDAK_VALID");
  const f = parseFilterBaris({ posisi: "di_workshop, sudah_dijemput", pic: "  Sari Dewi ", target: "Terlambat" });
  assert.deepEqual(f, { posisi: ["DI_WORKSHOP", "SUDAH_DIJEMPUT"], pic: "Sari Dewi", target: "terlambat" });
  assert.equal(TARGET_KEYS.length, 4);
});

test("posisi unit: beberapa pilihan = OR; posisi fisik tidak disamakan dengan status order", () => {
  const f = parseFilterBaris({ posisi: "DI_WORKSHOP,SUDAH_DIJEMPUT" });
  assert.equal(lolosFilterBaris(baris({ posisi: "DI_WORKSHOP" }), f, NOW), true);
  assert.equal(lolosFilterBaris(baris({ posisi: "SUDAH_DIJEMPUT" }), f, NOW), true);
  assert.equal(lolosFilterBaris(baris({ posisi: "MENUNGGU_DIJEMPUT" }), f, NOW), false);
  // unit Siap Kirim (status order maju) tetap difilter menurut posisinya, bukan menurut status
  assert.equal(lolosFilterBaris(baris({ status: "READY_FOR_DELIVERY", posisi: "DI_WORKSHOP_SIAP" }), parseFilterBaris({ posisi: "DI_WORKSHOP" }), NOW), false);
});

test("PIC: nama persis; Belum ditugaskan = tanpa PIC; unit tanpa PIC tidak masuk filter nama", () => {
  assert.equal(lolosFilterBaris(baris({ pic: "Rahmat" }), parseFilterBaris({ pic: "Rahmat" }), NOW), true);
  assert.equal(lolosFilterBaris(baris({ pic: "Rahmat Hidayat" }), parseFilterBaris({ pic: "Rahmat" }), NOW), false, "bukan pencocokan sebagian");
  assert.equal(lolosFilterBaris(baris({ pic: null }), parseFilterBaris({ pic: "Rahmat" }), NOW), false);
  assert.equal(lolosFilterBaris(baris({ pic: null }), parseFilterBaris({ pic: PIC_TANPA }), NOW), true);
  assert.equal(lolosFilterBaris(baris({ pic: "Rahmat" }), parseFilterBaris({ pic: PIC_TANPA }), NOW), false);
});

test("target selesai: batas hari mengikuti kalender WIB (23.59 WIB vs 00.00 WIB)", () => {
  assert.equal(tanggalWib("2026-11-02T16:59:59.999Z"), "2026-11-02");
  assert.equal(tanggalWib("2026-11-02T17:00:00.000Z"), "2026-11-03");
  const hariIni = parseFilterBaris({ target: "hari_ini" });
  assert.equal(lolosFilterBaris(baris({ target: "2026-11-01T17:00:00.000Z" }), hariIni, NOW), true, "00.00 WIB 2 Nov = hari ini");
  assert.equal(lolosFilterBaris(baris({ target: "2026-11-02T16:59:59.999Z" }), hariIni, NOW), true, "23.59 WIB 2 Nov = hari ini");
  assert.equal(lolosFilterBaris(baris({ target: "2026-11-02T17:00:00.000Z" }), hariIni, NOW), false, "00.00 WIB 3 Nov = besok");
  assert.equal(lolosFilterBaris(baris({ target: "2026-11-01T16:59:59.999Z" }), hariIni, NOW), false, "23.59 WIB 1 Nov = kemarin");
  // "sekarang" sendiri memakai tanggal WIB: 23.59 WIB masih hari yang sama, 00.00 WIB sudah besok
  const hampirTengahMalam = new Date("2026-11-02T16:59:59.000Z"); const lewat = new Date("2026-11-02T17:00:00.000Z");
  assert.equal(lolosFilterBaris(baris({ target: "2026-11-02T10:00:00.000Z" }), hariIni, hampirTengahMalam), true);
  assert.equal(lolosFilterBaris(baris({ target: "2026-11-02T10:00:00.000Z" }), hariIni, lewat), false);
});

test("target 7 hari ke depan = hari ini sampai +6 hari (WIB); belum ada target dipisah dari terlambat", () => {
  const f = parseFilterBaris({ target: "tujuh_hari" });
  assert.equal(lolosFilterBaris(baris({ target: "2026-11-08T16:59:59.999Z" }), f, NOW), true, "8 Nov 23.59 WIB = hari ke-7");
  assert.equal(lolosFilterBaris(baris({ target: "2026-11-08T17:00:00.000Z" }), f, NOW), false, "9 Nov 00.00 WIB di luar");
  assert.equal(lolosFilterBaris(baris({ target: "2026-11-01T16:59:59.999Z" }), f, NOW), false, "kemarin bukan 7 hari ke depan");
  assert.equal(lolosFilterBaris(baris({ target: null }), f, NOW), false);
  assert.equal(lolosFilterBaris(baris({ target: null }), parseFilterBaris({ target: "belum_ada" }), NOW), true);
  assert.equal(lolosFilterBaris(baris({ target: null }), parseFilterBaris({ target: "terlambat" }), NOW), false, "tanpa target tidak pernah 'terlambat'");
});

test("terlambat: target sebelum hari ini dan pekerjaan belum selesai; Terkirim/Dibatalkan/Selesai tidak dihitung", () => {
  const f = parseFilterBaris({ target: "terlambat" }); const lalu = "2026-10-30T03:00:00.000Z";
  assert.equal(lolosFilterBaris(baris({ target: lalu, kerja: "DIJADWALKAN" }), f, NOW), true);
  assert.equal(lolosFilterBaris(baris({ target: lalu, kerja: "TERTUNDA" }), f, NOW), true);
  assert.equal(lolosFilterBaris(baris({ target: lalu, kerja: "SELESAI" }), f, NOW), false);
  assert.equal(lolosFilterBaris(baris({ target: lalu, status: "DELIVERED" }), f, NOW), false);
  assert.equal(lolosFilterBaris(baris({ target: lalu, status: "CANCELLED", kerja: "DIBATALKAN" }), f, NOW), false);
  assert.equal(lolosFilterBaris(baris({ target: "2026-11-02T10:00:00.000Z" }), f, NOW), false, "target hari ini belum terlambat");
  assert.equal(lolosFilterBaris(baris({ target: "2026-11-01T16:59:59.999Z" }), f, NOW), true, "23.59 WIB kemarin sudah lewat");
});

test("beberapa filter digabung = AND", () => {
  const f = parseFilterBaris({ posisi: "DI_WORKSHOP", pic: "Rahmat", target: "hari_ini" });
  const cocok = baris({ posisi: "DI_WORKSHOP", pic: "Rahmat", target: "2026-11-02T03:00:00.000Z" });
  assert.equal(lolosFilterBaris(cocok, f, NOW), true);
  assert.equal(lolosFilterBaris({ ...cocok, adopsi: { ...cocok.adopsi, pic: { nama: "Sari" } } }, f, NOW), false);
  assert.equal(lolosFilterBaris(baris({ posisi: "DI_WORKSHOP_SIAP", pic: "Rahmat", target: "2026-11-02T03:00:00.000Z" }), f, NOW), false);
  assert.equal(lolosFilterBaris(baris({ posisi: "DI_WORKSHOP", pic: "Rahmat", target: "2026-11-03T03:00:00.000Z" }), f, NOW), false);
});

test("cakupan hasil: unit yang cocok di luar 50 pertama tetap ditemukan; total dan hasMore mengikuti filter", () => {
  // 130 unit; hanya unit ke-60, ke-95, dan ke-129 (indeks 59, 94, 128) yang berPIC "Dewi" dan terlambat
  const rows = Array.from({ length: 130 }, (_, i) => baris({ id: `u${i}`, pic: [59, 94, 128].includes(i) ? "Dewi" : "Rahmat", target: [59, 94, 128].includes(i) ? "2026-10-20T03:00:00.000Z" : "2026-11-20T03:00:00.000Z" }));
  const f = parseFilterBaris({ pic: "Dewi", target: "terlambat" });
  const h1 = saringDanHalaman(rows, { filterBaris: f, page: 1, pageSize: 50, now: NOW });
  assert.deepEqual(h1.rows.map((r) => r.id), ["u59", "u94", "u128"]);
  assert.equal(h1.total, 3); assert.equal(h1.hasMore, false);
  // tanpa filter: halaman bertahap, total = seluruh unit
  const p1 = saringDanHalaman(rows, { page: 1, pageSize: 50, now: NOW }); const p3 = saringDanHalaman(rows, { page: 3, pageSize: 50, now: NOW });
  assert.equal(p1.total, 130); assert.equal(p1.hasMore, true); assert.equal(p3.rows.length, 30); assert.equal(p3.hasMore, false);
  // filter yang cocok banyak: halaman 2 melanjutkan urutan yang sama tanpa duplikat
  const banyak = saringDanHalaman(rows, { filterBaris: parseFilterBaris({ pic: "Rahmat" }), page: 1, pageSize: 50, now: NOW });
  const banyak2 = saringDanHalaman(rows, { filterBaris: parseFilterBaris({ pic: "Rahmat" }), page: 2, pageSize: 50, now: NOW });
  assert.equal(banyak.total, 127); assert.equal(banyak.hasMore, true);
  assert.equal(new Set([...banyak.rows, ...banyak2.rows].map((r) => r.id)).size, 100);
  // filter kerja + kelengkapan tetap digabung (AND) dengan filter baru
  const gabung = saringDanHalaman(rows.map((r, i) => (i === 59 ? baris({ id: "u59", pic: "Dewi", kerja: "TERTUNDA", kel: ["BAHAN_BELUM_DICATAT"], target: "2026-10-20T03:00:00.000Z" }) : r)), { kerjaFilter: ["TERTUNDA"], kelFilter: ["BAHAN_BELUM_DICATAT"], filterBaris: f, now: NOW });
  assert.deepEqual(gabung.rows.map((r) => r.id), ["u59"]);
  // mode ekspor (semua) memuat seluruh hasil filter
  assert.equal(saringDanHalaman(rows, { filterBaris: parseFilterBaris({ pic: "Rahmat" }), semua: true, now: NOW }).rows.length, 127);
});

test("faset PIC: daftar nama + jumlah, unit tanpa PIC dihitung terpisah; nilai kosong tidak membuat nama palsu", () => {
  const r = fasetPic([baris({ pic: "Sari" }), baris({ pic: "Rahmat" }), baris({ pic: "Rahmat" }), baris({ pic: null }), baris({ pic: null })]);
  assert.deepEqual(r.pic, [{ nama: "Rahmat", jumlah: 2 }, { nama: "Sari", jumlah: 1 }]);
  assert.equal(r.tanpaPic, 2);
  assert.deepEqual(fasetPic([]), { pic: [], tanpaPic: 0 });
});
