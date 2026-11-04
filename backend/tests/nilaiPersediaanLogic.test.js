// Nilai persediaan — logika MURNI (tanpa DB): klasifikasi baris & cakupan. Aturan inti: pengecualian TIDAK PERNAH bernilai Rp0; nol sah dipisah; cakupan satu sumber.
import test from "node:test";
import assert from "node:assert/strict";
import { klasifikasiBaris, ringkasCakupan, urutkanRisiko, hitungEstimasi, peranPelihatNominal, STATUS, STATUS_PENGECUALIAN } from "../src/services/nilaiPersediaan.js";

const bahan = (o = {}) => ({ id: "m1", code: "BHN-1", name: "Bahan Uji", unit: "KG", category: "RAW_MATERIAL", active: true, ...o });
const harga = (o = {}) => ({ harga: 5000, satuan: "KG", berlakuMulai: new Date("2026-10-01T00:00:00Z"), sumber: "MANUAL", label: "BELUM_DIDUKUNG_BUKTI", ...o });
const SO = (o = {}) => ({ id: "so1", jenis: "PENGAMATAN_SATUAN", jumlah: 13.5, satuan: "ROLL", soTanggal: "2026-11-04", soWaktu: null, sumber: "KIRIM GILANG.xlsx O4", alasan: "Hasil SO dalam ROLL", pelaku: { nama: "Gilang" }, revisi: 1, ...o });
const K = (o) => klasifikasiBaris({ bahan: bahan(), saldo: 10, jumlahPergerakan: 2, harga: harga(), ...o });

test("N1. dinilai = saldo × harga; satuan sama tidak peduli huruf besar/kecil", () => {
  const b = K({}); assert.equal(b.status, STATUS.DINILAI); assert.equal(b.nilai, 50000);
  assert.equal(K({ harga: harga({ satuan: "kg" }) }).status, STATUS.DINILAI);
  assert.equal(K({ saldo: 2.5, harga: harga({ harga: 3333.3333 }) }).nilai, 8333.3333);
});
test("N2. pengecualian TIDAK pernah bernilai Rp0 (nilai null) dan tidak hilang dari cakupan", () => {
  const kasus = [K({ jumlahPergerakan: 0, saldo: 0 }), K({ saldo: -3 }), K({ harga: null }), K({ harga: harga({ satuan: "ROLL" }) }), K({ hasilSO: SO() })];
  assert.deepEqual(kasus.map((b) => b.status), [STATUS.STOK_BELUM_DIKETAHUI, STATUS.SALDO_MINUS, STATUS.HARGA_KOSONG, STATUS.SATUAN_TIDAK_COCOK, STATUS.PENGAMATAN_FISIK]);
  for (const b of kasus) { assert.equal(b.nilai, null, b.status); assert.ok(STATUS_PENGECUALIAN.includes(b.status)); assert.ok(b.keterangan.length > 5); }
  const c = ringkasCakupan(kasus); assert.equal(c.pengecualian, 5); assert.equal(c.relevan, 5); assert.equal(c.dinilai, 0); assert.equal(c.persenDinilai, 0);
});
test("N3. belum ada catatan ≠ nol; nol menurut pergerakan = saldo nol sah (Rp0 benar) dan bukan pengecualian", () => {
  const belum = K({ jumlahPergerakan: 0, saldo: 0 }); assert.equal(belum.saldo, null, "saldo belum diketahui ditampilkan null, bukan 0"); assert.equal(belum.status, STATUS.STOK_BELUM_DIKETAHUI);
  const nol = K({ saldo: 0, jumlahPergerakan: 3 }); assert.equal(nol.status, STATUS.SALDO_NOL); assert.equal(nol.nilai, 0);
  const ver = K({ saldo: 0, jumlahPergerakan: 0, nolTerverifikasi: true }); assert.equal(ver.status, STATUS.SALDO_NOL);
  const c = ringkasCakupan([belum, nol, ver]); assert.equal(c.saldoNol, 2); assert.equal(c.pengecualian, 1); assert.equal(c.relevan, 1);
});
test("N4. terukur dalam satuan lain (ROLL): saldo sistem tampil, TIDAK dinilai dari pengamatan, tidak dikonversi; keterangan menyebut ROLL terukur dan METER belum terukur", () => {
  const b = K({ saldo: 122, bahan: bahan({ unit: "METER" }), harga: harga({ satuan: "METER", harga: 35500 }), hasilSO: SO({ jumlah: 1, satuan: "ROLL" }) });
  assert.equal(b.status, STATUS.PENGAMATAN_FISIK); assert.equal(b.nilai, null); assert.equal(b.saldo, 122, "saldo sistem tampil apa adanya"); assert.equal(b.hasilSOBermasalah, true);
  assert.match(b.keterangan, /Terukur dalam ROLL: 1 ROLL/); assert.ok(b.keterangan.includes("belum terukur dalam satuan stok (METER)")); assert.match(b.keterangan, /Tidak dikonversi/); assert.equal(b.nilaiLedger, 122 * 35500, "estimasi berbasis ledger tetap dihitung, terpisah");
  const lava = K({ saldo: 0, jumlahPergerakan: 3, bahan: bahan({ unit: "METER" }), hasilSO: SO() }); assert.equal(lava.status, STATUS.PENGAMATAN_FISIK); assert.equal(lava.nilaiLedger, null); assert.equal(lava.pengamatan, "13,5 ROLL");
});
test("N4b. nol dikonfirmasi pada bahan TANPA ledger: label 'fisik nol dikonfirmasi, belum tercatat sebagai hasil SO' — bukan 'sudah sesuai', tetap stok belum diketahui, tidak dinilai, bukan Rp0", () => {
  const b = K({ jumlahPergerakan: 0, saldo: 0, hasilSO: SO({ jenis: "NOL_DIKONFIRMASI", jumlah: 0, satuan: "KG" }) });
  assert.equal(b.status, STATUS.STOK_BELUM_DIKETAHUI); assert.equal(b.nilai, null); assert.equal(b.saldo, null); assert.match(b.keterangan, /Fisik nol dikonfirmasi/); assert.match(b.keterangan, /belum tercatat sebagai hasil SO di ledger/); assert.match(b.keterangan, /bukan "sudah sesuai"/);
  assert.equal(b.hasilSOBermasalah, false, "tidak bertentangan dengan ledger (tidak ada ledger)"); assert.equal(ringkasCakupan([b]).nolDikonfirmasiBelumDiLedger, 1);
});
test("N4c. nol dikonfirmasi tetapi ledger masih berisi: tetap dinilai dari ledger, DITANDAI bermasalah, dikecualikan dari estimasi 'tanpa hasil SO bermasalah'", () => {
  const baik = K({ saldo: 10 }), konflik = K({ saldo: 4, hasilSO: SO({ jenis: "NOL_DIKONFIRMASI", jumlah: 0, satuan: "KG" }) }), minus = K({ saldo: -2, hasilSO: SO({ jenis: "NOL_DIKONFIRMASI", jumlah: 0, satuan: "KG" }) });
  assert.equal(konflik.status, STATUS.DINILAI); assert.equal(konflik.hasilSOBermasalah, true); assert.match(konflik.keterangan, /selisih belum direkonsiliasi/); assert.equal(minus.status, STATUS.SALDO_MINUS); assert.equal(minus.hasilSOBermasalah, true);
  const e = hitungEstimasi([baik, konflik, minus]); assert.equal(e.nilaiLedger, 50000 + 20000); assert.equal(e.nilaiTanpaHasilSOBermasalah, 50000); assert.equal(e.bahanHasilSOBermasalah, 2); assert.equal(e.nilaiHasilSOBermasalah, 20000);
});
test("N4d. nol dikonfirmasi yang sejalan dengan saldo nol tidak bermasalah; peran pelihat nominal dihitung dari peta izin (finance:read ∩ inventory:read)", () => {
  const sejalan = K({ saldo: 0, jumlahPergerakan: 2, hasilSO: SO({ jenis: "NOL_DIKONFIRMASI", jumlah: 0, satuan: "KG" }) }); assert.equal(sejalan.status, STATUS.SALDO_NOL); assert.equal(sejalan.hasilSOBermasalah, false); assert.match(sejalan.keterangan, /Sejalan dengan hasil SO nol/);
  const peran = peranPelihatNominal(); for (const r of ["ADMIN", "OWNER", "FINANCE"]) assert.ok(peran.includes(r), r); for (const r of ["WAREHOUSE", "SALES", "DRIVER"]) assert.ok(!peran.includes(r), r);
});
test("N5. harga kosong dengan saldo nol tetap saldo nol (tidak dilaporkan sebagai harga kosong)", () => {
  assert.equal(K({ saldo: 0, jumlahPergerakan: 2, harga: null }).status, STATUS.SALDO_NOL);
});
test("N6. cakupan: partisi lengkap, persentase, dan harga dari PO dihitung terpisah", () => {
  const baris = [K({}), K({ harga: harga({ sumber: "PO" }) }), K({ harga: null }), K({ saldo: -1 }), K({ saldo: 0, jumlahPergerakan: 1 })];
  const c = ringkasCakupan(baris); assert.equal(c.universe, 5); assert.equal(c.dinilai, 2); assert.equal(c.pengecualian, 2); assert.equal(c.saldoNol, 1); assert.equal(c.relevan, 4); assert.equal(c.persenDinilai, 50); assert.equal(c.dariPO, 1);
  assert.equal(Object.values(c.perStatus).reduce((a, v) => a + v, 0), c.universe, "tidak ada bahan terhitung dua kali / hilang");
});
test("N7. urutan tabel: yang berisiko dulu, pengecualian tidak tenggelam", () => {
  const baris = [K({ saldo: 0, jumlahPergerakan: 1 }), K({}), K({ saldo: -1 }), K({ jumlahPergerakan: 0, saldo: 0 }), K({ harga: null })];
  assert.deepEqual(urutkanRisiko(baris).map((b) => b.status), [STATUS.DINILAI, STATUS.SALDO_MINUS, STATUS.HARGA_KOSONG, STATUS.STOK_BELUM_DIKETAHUI, STATUS.SALDO_NOL]);
});
