import test from "node:test";
import assert from "node:assert/strict";
import { bacaStockCsv, petakan } from "../src/services/stokFileImport.js";
import { rekonsiliasiCatatan, PRIORITAS } from "../src/services/stokRekonCatatan.js";

const HEAD = Array(70).fill("");
[[0, "KODE BANG"], [1, "NAMA BARANG"], [2, "SATUAN"], [3, "JENIS"], [4, "BARANG"], [5, "VENDOR"], [43, "HARGA ACT"], [44, "MASUK"], [45, "KELUAR"], [46, "SISA"], [47, "QTY SEP"], [48, "QTY Selisih"], [49, "SATUAN"],
  [52, "HARGA ACT"], [53, "MASUK"], [54, "KELUAR"], [55, "SISA"], [56, "QTY OKT"], [57, "QTY SELISIH"], [58, "SATUAN"]].forEach(([i, v]) => { HEAD[i] = v; });
const K = { nama: 1, satuan: 2, harga: 43, sep: 47, satSep: 49, masuk: 53, keluar: 54, sisa: 55, satOkt: 58 };
const baris = (o) => { const r = Array(70).fill(""); r[3] = "MATERIAL"; for (const [k, v] of Object.entries(o)) r[K[k]] = v; return r; };
const csv = (rows) => [["x"], HEAD, ...rows].map((r) => r.join(",")).join("\n");
const M = (id, code, name, unit) => ({ id, code, name, unit, active: true });
const mats = [M("a", "KAIN-A", "KAIN A", "METER"), M("b", "BUSA-B", "BUSA B", "SHEET"), M("c", "PE-C", "PE C", "PCS"), M("d", "LEM-D", "LEM D", "CAN"), M("e", "ZZ-E", "ZZ E", "PCS"), M("f", "KAIN-F", "KAIN F", "METER")];
const mv = (id, qty, at, extra = {}) => ({ id, type: qty > 0 ? "RECEIPT" : "ISSUE", qty, createdAt: new Date(at), dokumen: null, jalur: "GR", ...extra });
const ledger = new Map([
  ["a", [mv("a1", 100, "2026-09-05T00:00:00Z"), mv("a2", 50, "2026-10-09T01:00:00Z", { dokumen: "GR-A" })]],
  ["b", []], ["c", [mv("c1", 295, "2026-09-08T00:00:00Z")]], ["d", [mv("d1", 10, "2026-10-16T06:56:00Z", { dokumen: "GR-D" })]], ["e", [mv("e1", 5, "2026-09-08T00:00:00Z")]], ["f", [mv("f1", 3, "2026-09-08T00:00:00Z")]],
]);
const jalan = (rows, pending = []) => rekonsiliasiCatatan({ pemetaan: petakan(bacaStockCsv(csv(rows)), mats), materials: mats, ledger, pending });
const get = (h, kode) => h.bahan.find((x) => x.kode === kode);

test("GR di kedua sumber: pakai ledger, tidak dijumlah dua kali; selisih terurai awal+masuk−keluar", () => {
  const h = jalan([baris({ nama: "KAIN A", satuan: "METER", sep: "90", satSep: "METER", masuk: "50", keluar: "10", sisa: "130" })]);
  const a = get(h, "KAIN-A");
  assert.equal(a.flag.grDiKeduaSumber, "SAMA"); assert.ok(a.isu.some((i) => i.kode === "GR_DI_KEDUA_SUMBER"));
  assert.equal(a.perkiraanTanpaDobel, 130, "90 + max(50 file, 50 ledger) − 10");
  assert.equal(a.selisihAwal, -10); assert.equal(a.selisihMasuk, 0); assert.equal(a.selisihKeluar, 10);
  assert.equal(a.selisihTotal, a.selisihAwal + a.selisihMasuk - a.selisihKeluar, "uraian selisih konsisten");
  assert.equal(a.selisihTotal, -20);
  assert.equal(a.ledgerKini, 150); assert.ok(a.flag.pemakaianHanyaDiFile, "KELUAR 10 tidak ada di ledger");
});

test("P1 menghambat: sistem 0 tetapi catatan menyatakan ada; kosong ≠ nol: SEP kosong → tanpa angka, bukan nol", () => {
  const h = jalan([baris({ nama: "BUSA B", satuan: "LEMBAR", sep: "8", satSep: "LEMBAR", masuk: "", keluar: "1", sisa: "7" }), baris({ nama: "KAIN F", satuan: "METER", sep: "", masuk: "", keluar: "2", sisa: "-2" })]);
  const b = get(h, "BUSA-B"); assert.equal(b.prioritas, PRIORITAS.P1_MENGHAMBAT); assert.equal(b.perkiraanTanpaDobel, 7);
  const f = get(h, "KAIN-F");
  assert.equal(f.sep, null); assert.equal(f.perkiraanTanpaDobel, null); assert.equal(f.prioritas, PRIORITAS.P6_TANPA_ANGKA_FILE);
  assert.ok(f.isu.some((i) => i.kode === "SEP_KOSONG_TAPI_ADA_GERAK_OKTOBER"));
});

test("P2 risiko: sistem positif, catatan habis/negatif; saldo catatan negatif ditandai", () => {
  const h = jalan([baris({ nama: "PE C", satuan: "PCS", sep: "17", satSep: "PCS", masuk: "", keluar: "238", sisa: "-221" })]);
  const c = get(h, "PE-C"); assert.equal(c.prioritas, PRIORITAS.P2_RISIKO); assert.ok(c.isu.some((i) => i.kode === "SISA_FILE_NEGATIF"));
  assert.equal(c.ledgerKini, 295); assert.equal(c.perkiraanTanpaDobel, -221);
});

test("satuan beda: tidak dibandingkan/dikonversi (selisih null), BLOCKER; faktor rasio hanya ditandai kemungkinan", () => {
  const h = jalan([baris({ nama: "LEM D", satuan: "BLEK", sep: "52", satSep: "KG", masuk: "130", keluar: "", sisa: "182", satOkt: "KG" })]);
  const d = get(h, "LEM-D");
  assert.ok(d.isu.some((i) => i.kode === "SATUAN_BEDA" && i.level === "BLOCKER")); assert.equal(d.selisihTotal, null); assert.equal(d.selisihAwal, null);
  assert.equal(d.flag.grDiKeduaSumber, "BEDA_SATUAN_KEMUNGKINAN"); assert.match(d.isu.find((i) => i.kode === "GR_DI_KEDUA_SUMBER").pesan, /BELUM dikonfirmasi, tidak dikonversi/);
});

test("masuk hanya di file / hanya di ledger; tanpa angka file; harga file tidak muncul di keluaran", () => {
  const h = jalan([baris({ nama: "BUSA B", satuan: "LEMBAR", sep: "5", satSep: "LEMBAR", masuk: "4", keluar: "", sisa: "9", harga: "999.999" }), baris({ nama: "ZZ E", satuan: "PCS" })]);
  assert.ok(get(h, "BUSA-B").flag.masukHanyaDiFile);
  assert.equal(get(h, "ZZ-E").prioritas, PRIORITAS.P6_TANPA_ANGKA_FILE);
  assert.ok(!JSON.stringify(h).includes("999.999"), "harga file tidak ikut keluaran");
  assert.ok(h.masterTanpaBarisFile.some((x) => x.kode === "PE-C"));
});

test("Oktober file #N/A: tidak dihitung, bukan dianggap nol", () => {
  const h = jalan([baris({ nama: "KAIN A", satuan: "METER", sep: "90", satSep: "METER", masuk: "", keluar: "#N/A", sisa: "#N/A" })]);
  const a = get(h, "KAIN-A");
  assert.ok(a.isu.some((i) => i.kode === "ANGKA_OKTOBER_GALAT_SHEET") && a.isu.some((i) => i.kode === "SISA_FILE_GALAT_SHEET"));
  assert.equal(a.sisaHitungUlang, null); assert.equal(a.perkiraanTanpaDobel, null); assert.equal(a.prioritas, PRIORITAS.P6_TANPA_ANGKA_FILE);
});
