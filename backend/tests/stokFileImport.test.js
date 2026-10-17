import test from "node:test";
import assert from "node:assert/strict";
import { parseAngkaId, parseCsvText, bacaStockCsv, petakan, buatPratinjau, bangunRencanaDraft, kunciImpor, enumSatuan } from "../src/services/stokFileImport.js";

// ---- fixture CSV: 70 kolom, header persis seperti sheet Stock ----
const HEAD = Array(70).fill("");
const set = (arr, i, v) => { arr[i] = v; return arr; };
[[0, "KODE BANG"], [1, "NAMA BARANG"], [2, "SATUAN"], [3, "JENIS"], [4, "BARANG"], [5, "VENDOR"], [43, "HARGA ACT"], [44, "MASUK"], [45, "KELUAR"], [46, "SISA"], [47, "QTY SEP"], [48, "QTY Selisih"], [49, "SATUAN"],
  [52, "HARGA ACT"], [53, "MASUK"], [54, "KELUAR"], [55, "SISA"], [56, "QTY OKT"], [57, "QTY SELISIH"], [58, "SATUAN"]].forEach(([i, v]) => set(HEAD, i, v));
const baris = (o) => { const r = Array(70).fill(""); const m = { nama: 1, satuan: 2, jenis: 3, sisa: 46, sep: 47, selisih: 48, satSep: 49, masukOkt: 53, keluarOkt: 54, harga: 43 }; for (const [k, v] of Object.entries(o)) r[m[k]] = v; if (!("jenis" in o)) r[3] = "MATERIAL"; return r; };
const csv = (rows) => [["x"], ["y"], ["z"], HEAD, ...rows].map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(",")).join("\r\n");

test("angka format Indonesia: ribuan titik, desimal koma, kosong ≠ nol, #N/A galat, titik tunggal ambigu", () => {
  assert.deepEqual([parseAngkaId("1.176.000").nilai, parseAngkaId("71,5").nilai, parseAngkaId("-0,8").nilai, parseAngkaId("2.126,2").nilai, parseAngkaId("0").nilai], [1176000, 71.5, -0.8, 2126.2, 0]);
  assert.equal(parseAngkaId("").status, "KOSONG"); assert.equal(parseAngkaId("0").status, "OK"); assert.equal(parseAngkaId("#N/A").status, "GALAT_SHEET");
  assert.equal(parseAngkaId("1.100").status, "RIBUAN_DIASUMSIKAN"); assert.equal(parseAngkaId("5.5").status, "TIDAK_VALID"); assert.equal(parseAngkaId("abc").status, "TIDAK_VALID");
});

test("CSV: sel berkutip dengan koma, CRLF, tanda kutip ganda", () => {
  const r = parseCsvText('a,"b,c","d ""e"""\r\nx,,z');
  assert.deepEqual(r, [["a", "b,c", 'd "e"'], ["x", "", "z"]]);
});

test("layout kolom bergeser → galat (fail-closed), bukan menebak", () => {
  const salah = HEAD.slice(); salah[47] = "QTY SEPTEMBER";
  assert.throws(() => bacaStockCsv([["x"], salah].map((r) => r.join(",")).join("\n")), /Layout berubah/);
  assert.throws(() => bacaStockCsv("a,b\n1,2"), /KODE BANG/);
});

test("bacaStockCsv: QTY SEP kosong = belum diketahui; 0 eksplisit = nol fisik; harga hanya info", () => {
  const b = bacaStockCsv(csv([baris({ nama: "A", satuan: "PCS", sep: "" }), baris({ nama: "B", satuan: "PCS", sep: "0" }), baris({ nama: "C", satuan: "PCS", sep: "5", harga: "1.000" })]));
  assert.deepEqual(b.baris.map((x) => x.qtySep.status), ["KOSONG", "OK", "OK"]);
  assert.equal(b.baris[1].qtySep.nilai, 0); assert.equal(b.baris[2].hargaInfo, "1.000"); assert.equal(b.barisHeader, 4);
});

const M = (id, code, name, unit, active = true) => ({ id, code, name, unit, active });
const materials = [M("m1", "KAIN-A", "KAIN A", "METER"), M("m2", "LEM-1", "LEM I-SR 1037 13 KG", "CAN"), M("m3", "WIB-ABU", "LIST WIBING ABU", "ROLL"), M("m4", "BUSA-X", "BUSA X (D22)", "SHEET"), M("m5", "KAIN-B", "KAIN B", "METER")];
const T0 = new Date("2026-10-01T02:00:00Z");
const mv = (id, qty, at, extra = {}) => ({ id, type: qty > 0 ? "RECEIPT" : "ISSUE", qty, createdAt: new Date(at), dokumen: null, grArrivedDate: null, jalur: "GR", ...extra });
const ledger = new Map([
  ["m1", [mv("a", 100, "2026-09-05T00:00:00Z"), mv("b", -10, "2026-09-08T00:00:00Z"), mv("c", 50, "2026-10-09T01:00:00Z", { dokumen: "GR-091026-03", grArrivedDate: "2026-10-09" })]],
  ["m2", [mv("d", -41.5, "2026-09-08T00:00:00Z")]], ["m3", [mv("e", 5, "2026-09-08T00:00:00Z")]], ["m4", [mv("f", 20, "2026-09-08T00:00:00Z"), mv("g", 5, "2026-10-09T01:00:00Z", { dokumen: "GR-X", grArrivedDate: "2026-09-29" })]], ["m5", []],
]);
const buktiLengkap = { waktuHitung: T0, sumberWaktu: "Foto form opname #1 (WA 1 Okt 09:00)", penghitung: "Petugas A", pemeriksa: "Petugas B", buktiPetugas: "Foto form #1" };
const fileCsv = csv([
  baris({ nama: "KAIN A", satuan: "METER", sep: "85", satSep: "METER", masukOkt: "50" }),
  baris({ nama: "LEM I-SR 1037 13 KG", satuan: "BLEK", sep: "52", satSep: "KG" }),
  baris({ nama: "LIST WIBING ABU", satuan: "ROLL", sep: "450", satSep: "METER" }),
  baris({ nama: "BUSA X D22", satuan: "LEMBAR", sep: "30", satSep: "LEMBAR" }),
  baris({ nama: "KAIN B", satuan: "METER", sep: "" }),
  baris({ nama: "BARANG TAK DIKENAL", satuan: "PCS", sep: "9", satSep: "PCS" }),
  baris({ nama: "FG COVER", satuan: "PCS", sep: "3", jenis: "FINISHGOOD" }),
]);
const pet = () => petakan(bacaStockCsv(fileCsv), materials);

test("pemetaan: nama sama, tanpa tanda baca, kandidat TIDAK dipakai, alias manusia dipakai", () => {
  const p = pet();
  const k = Object.fromEntries(p.map((x) => [x.nama, x.kelasPemetaan]));
  assert.equal(k["KAIN A"], "NAMA_SAMA"); assert.equal(k["BUSA X D22"], "NAMA_SAMA_TANPA_TANDA_BACA"); assert.equal(k["BARANG TAK DIKENAL"], "TANPA_PASANGAN");
  const alias = petakan(bacaStockCsv(fileCsv), materials, new Map([[10, "KAIN-B"]]));
  assert.equal(alias.find((x) => x.nama === "BARANG TAK DIKENAL").material.code, "KAIN-B");
  const kand = petakan(bacaStockCsv(csv([baris({ nama: "KAIN A BARU", satuan: "METER", sep: "1", satSep: "METER" })])), materials);
  assert.equal(kand[0].kelasPemetaan, "KANDIDAT_BELUM_PASTI"); assert.equal(kand[0].material, null);
});

test("tanpa bukti waktu & petugas: SEMUA baris berangka BLOCKER; header QTY SEP bukan bukti; skenario hanya informatif", () => {
  const pr = buatPratinjau({ pemetaan: pet(), materials, ledger, skenario: T0 });
  const kain = pr.bahan.find((x) => x.kode === "KAIN-A");
  assert.equal(kain.status, "BLOCKER");
  assert.ok(kain.isu.some((i) => i.kode === "WAKTU_HITUNG_TIDAK_TERBUKTI") && kain.isu.some((i) => i.kode === "BUKTI_PETUGAS_TIDAK_ADA"));
  assert.equal(kain.waktuHitung, null); assert.ok(kain.waktuSkenario);
  assert.ok(!pr.bahan.some((x) => x.status === "SIAP_DITINJAU"));
  assert.throws(() => bangunRencanaDraft(pr, { waktuHitung: null }), /waktu hitung BERBUKTI/);
  assert.equal(pr.bahan.find((x) => x.kode === "KAIN-B").status, "BELUM_DIHITUNG", "kosong = belum dihitung, bukan nol");
  assert.equal(pr.ringkasan.layakStrukturTanpaBukti, 1, "hanya KAIN-A; BUSA-X kena GR_TIBA_SEBELUM_HITUNG, LEM & WIBING satuan beda");
});

test("dengan bukti: selisih terhadap ledger PADA waktu hitung; penerimaan sesudahnya dipertahankan (tidak dua kali); satuan beda diblokir tanpa konversi", () => {
  const pr = buatPratinjau({ pemetaan: pet(), materials, ledger, bukti: buktiLengkap });
  const kain = pr.bahan.find((x) => x.kode === "KAIN-A");
  assert.equal(kain.ledgerSaatHitung, 90); assert.equal(kain.fisik, 85); assert.equal(kain.delta, -5);
  assert.equal(kain.ledgerKini, 140); assert.equal(kain.proyeksiKini, 135, "85 fisik + 50 GR sesudah hitung");
  assert.equal(kain.proyeksiKini - kain.ledgerKini, kain.delta, "proyeksi − ledger kini = selisih (GR tidak dihitung dua kali)");
  assert.equal(kain.status, "SIAP_DITINJAU");
  assert.ok(kain.isu.some((i) => i.kode === "MASUK_OKTOBER_FILE_DAN_LEDGER" && i.level === "PERINGATAN"));
  assert.equal(kain.jendelaHasilSama.dari, "2026-09-08T00:00:00.000Z"); assert.equal(kain.jendelaHasilSama.sampaiSebelum, "2026-10-09T01:00:00.000Z");
  const lem = pr.bahan.find((x) => x.kode === "LEM-1"); const wib = pr.bahan.find((x) => x.kode === "WIB-ABU");
  assert.ok(lem.isu.some((i) => i.kode === "SATUAN_BEDA") && wib.isu.some((i) => i.kode === "SATUAN_BEDA")); assert.equal(lem.status, "BLOCKER"); assert.equal(wib.status, "BLOCKER");
  assert.equal(lem.ledgerSaatHitung, -41.5);
});

test("GR yang barangnya tiba SEBELUM tanggal hitung tapi diposting sesudahnya → BLOCKER (bisa terhitung dua kali)", () => {
  const pr = buatPratinjau({ pemetaan: pet(), materials, ledger, bukti: buktiLengkap });
  const busa = pr.bahan.find((x) => x.kode === "BUSA-X");
  assert.ok(busa.isu.some((i) => i.kode === "GR_TIBA_SEBELUM_HITUNG" && i.level === "BLOCKER")); assert.equal(busa.status, "BLOCKER");
});

test("dokumen tertunda = BLOCKER; petugas sama = bukti petugas tidak sah; baris ganda berangka dua = BLOCKER (tidak dijumlah)", () => {
  const pend = [{ materialCode: "KAIN-A", dok: "GR-1", status: "DRAFT" }];
  const a = buatPratinjau({ pemetaan: pet(), materials, ledger, pending: pend, bukti: buktiLengkap }).bahan.find((x) => x.kode === "KAIN-A");
  assert.ok(a.isu.some((i) => i.kode === "DOKUMEN_TERTUNDA")); assert.equal(a.status, "BLOCKER");
  const sama = buatPratinjau({ pemetaan: pet(), materials, ledger, bukti: { ...buktiLengkap, pemeriksa: "petugas a" } }).bahan.find((x) => x.kode === "KAIN-A");
  assert.ok(sama.isu.some((i) => i.kode === "BUKTI_PETUGAS_TIDAK_ADA"));
  const dobel = petakan(bacaStockCsv(csv([baris({ nama: "KAIN A", satuan: "METER", sep: "10", satSep: "METER" }), baris({ nama: "KAIN A", satuan: "METER", sep: "12", satSep: "METER" })])), materials);
  const g = buatPratinjau({ pemetaan: dobel, materials, ledger, bukti: buktiLengkap }).bahan[0];
  assert.ok(g.isu.some((i) => i.kode === "NAMA_GANDA_DI_FILE" && i.level === "BLOCKER")); assert.equal(g.status, "BLOCKER");
});

test("rencana DRAFT: hanya SIAP_DITINJAU dengan selisih ≠ 0; kunci stabil per tanggal hitung; tanpa harga/nilai", () => {
  const pr = buatPratinjau({ pemetaan: pet(), materials, ledger, bukti: buktiLengkap });
  const rencana = bangunRencanaDraft(pr, buktiLengkap);
  assert.deepEqual(rencana.map((x) => x.kode), ["KAIN-A"]); assert.equal(rencana[0].key, kunciImpor(T0, "KAIN-A")); assert.equal(rencana[0].key, "IMPOR-STOK-2026-10-01:KAIN-A");
  assert.equal(rencana[0].delta, -5); assert.ok(!("harga" in rencana[0]) && !("nilai" in rencana[0]));
  assert.throws(() => bangunRencanaDraft(pr, { ...buktiLengkap, pemeriksa: "" }), /penghitung, pemeriksa/);
});

test("alias satuan: LEMBAR→SHEET, BLEK→CAN, M→METER; tak dikenal → null (tidak ditebak)", () => {
  assert.deepEqual([enumSatuan("LEMBAR"), enumSatuan("blek"), enumSatuan("M"), enumSatuan("ZZZ"), enumSatuan("")], ["SHEET", "CAN", "METER", null, null]);
});
