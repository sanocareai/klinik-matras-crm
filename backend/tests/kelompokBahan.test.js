// Kelompok bahan operasional (UX Gudang Tahap 3): turunan dari itemGroup lewat tabel eksplisit — TIDAK dari nama bahan; yang tidak jelas = "Belum dikelompokkan".
import test from "node:test";
import assert from "node:assert/strict";
import { kelompokDariItemGroup, ringkasKelompok, normalkanGrup, grupTerpetakan, GRUP_PERLU_KEPUTUSAN, KELOMPOK_BELUM, URUTAN_KELOMPOK } from "../src/constants/kelompokBahan.js";

test("pemetaan per itemGroup: huruf besar/kecil dan spasi tidak membedakan; hasil membawa sumber", () => {
  for (const [g, kode] of [["REBONDED", "BUSA"], ["Kain", "KAIN"], ["KAIN", "KAIN"], ["  hr  foam ", "BUSA"], ["PER POCKET", "PEGAS"], ["TRIPLEK", "KAYU"], ["Lem", "LEM_KIMIA"], ["PAKU", "AKSESORI"], ["PE", "LAINNYA"], ["STOCK PASAMEBEL", "LAINNYA"]]) {
    const k = kelompokDariItemGroup(g); assert.equal(k.kode, kode, g); assert.equal(k.sumber, "item_group");
  }
  assert.equal(kelompokDariItemGroup("Kain").label, "Kain");
});

test("TIDAK menebak dari nama: grup kosong, grup campuran, dan grup yang belum dikenal = Belum dikelompokkan dengan alasan", () => {
  for (const g of [null, undefined, "", "   "]) { const k = kelompokDariItemGroup(g); assert.equal(k.kode, KELOMPOK_BELUM); assert.equal(k.sumber, "belum"); assert.match(k.alasan, /tidak punya itemGroup/); }
  for (const g of GRUP_PERLU_KEPUTUSAN) { const k = kelompokDariItemGroup(g); assert.equal(k.kode, KELOMPOK_BELUM, g); assert.match(k.alasan, /perlu keputusan manual/); }
  const baru = kelompokDariItemGroup("GRUP BARU DARI EXCEL"); assert.equal(baru.kode, KELOMPOK_BELUM); assert.match(baru.alasan, /belum ada di tabel pemetaan/);
  // fungsi hanya menerima itemGroup: nama bahan tidak ikut campur
  assert.equal(kelompokDariItemGroup.length, 1);
});

test("tabel eksplisit: tidak ada grup yang dipetakan sekaligus ke dua kelompok dan tidak bentrok dengan daftar keputusan manual", () => {
  const terpetakan = grupTerpetakan(); assert.equal(new Set(terpetakan).size, terpetakan.length);
  for (const g of GRUP_PERLU_KEPUTUSAN) assert.ok(!terpetakan.includes(g), g);
  for (const g of terpetakan) assert.equal(g, normalkanGrup(g));
  assert.deepEqual(URUTAN_KELOMPOK, ["BUSA", "KAIN", "BENANG", "PEGAS", "KAYU", "LEM_KIMIA", "AKSESORI", "LAINNYA", "BELUM"]);
});

test("ringkasan jujur: total aktif, diketahui, belum diketahui (bukan habis), minus, nol; nonaktif terpisah; kategori kosong tetap tampil", () => {
  const baris = [
    { aktif: true, saldo: 5, kategori: "RAW_MATERIAL", kelompok: { kode: "BUSA" } }, { aktif: true, saldo: -2, kategori: "RAW_MATERIAL", kelompok: { kode: "BUSA" } },
    { aktif: true, saldo: null, kategori: "RAW_MATERIAL", kelompok: { kode: "BUSA" } }, { aktif: true, saldo: 0, kategori: "FINISHED_GOODS", kelompok: { kode: "LAINNYA" } },
    { aktif: false, saldo: null, kategori: null, kelompok: { kode: "BELUM" } }, { aktif: true, saldo: null, kategori: null, kelompok: { kode: "BELUM" } },
  ];
  const r = ringkasKelompok(baris); const k = (kode) => r.kelompok.find((x) => x.kode === kode); const j = (kode) => r.jenis.find((x) => x.kode === kode);
  assert.deepEqual({ ...k("BUSA") }, { kode: "BUSA", label: "Busa", total: 3, diketahui: 2, belumDiketahui: 1, minus: 1, nol: 0, nonaktif: 0 });
  assert.equal(k("LAINNYA").nol, 1); assert.equal(k("BELUM").total, 1); assert.equal(k("BELUM").nonaktif, 1); assert.equal(k("KAIN").total, 0, "kelompok kosong tetap ada");
  assert.equal(j("NONE").total, 1); assert.equal(j("NONE").nonaktif, 1); assert.equal(j("WIP").total, 0); assert.equal(r.kelompok.length, 9);
});
