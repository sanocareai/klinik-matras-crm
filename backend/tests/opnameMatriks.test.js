// Uji murni matriks pilot. Data di bawah SINTETIS (hanya untuk tes) — tidak ada hitungan fisik nyata di repo.
import test from "node:test";
import assert from "node:assert/strict";
import { bangunMatriksPilot, tindakanManusia } from "../src/services/opnameMatriks.js";

const pilot = [
  { kode: "A", nama: "Bahan A", satuan: "METER", peran: "A" },
  { kode: "B", nama: "Bahan B", satuan: "PCS", peran: "B" },
  { kode: "C", nama: "Bahan C", satuan: "CAN", peran: "D" },
];
const pvA = { kode: "A", satuan: "METER", fisikMilikSano: 18, ledgerSaatHitung: 20, delta: -2, statusAkhir: "SELISIH_KECIL", kelas: "SELISIH_KECIL", isu: [], bukti: ["F1"], penghitung: ["P1"], pemeriksa: ["P2"], pergerakanJendela: [{ at: "t", type: "RECEIPT", qty: 5, log: "TIDAK" }], pergerakanSetelahHitung: [], nilai: { status: "DITETAPKAN", unitCost: 1000, sumber: "FAKTUR", referensi: "INV-1", nilaiSelisih: -2000 } };
const pvB = { kode: "B", satuan: "PCS", fisikMilikSano: 12, ledgerSaatHitung: 10, delta: 2, statusAkhir: "PERLU_HITUNG_ULANG", kelas: "SELISIH_KECIL", isu: [{ level: "BLOCKER", kode: "SELISIH_TANPA_BUKTI" }], bukti: [], penghitung: ["P1"], pemeriksa: ["P2"], pergerakanJendela: [], pergerakanSetelahHitung: [], nilai: { status: "NILAI_BELUM_DITETAPKAN" } };

test("tanpa hasil hitung nyata: semua NO-GO 'BELUM DIHITUNG', angka fisik tidak dikarang (null), valuasi BELUM", () => {
  const { baris, ringkasan } = bangunMatriksPilot({ pilot });
  assert.equal(ringkasan.goKuantitas, 0); assert.equal(ringkasan.noGoKuantitas, 3);
  for (const b of baris) { assert.equal(b.fisik, null); assert.equal(b.selisih, null); assert.match(b.alasanNoGo.join(), /BELUM DIHITUNG/); assert.equal(b.valuasi, "BELUM"); }
  assert.deepEqual(ringkasan.selisihQtyPerSatuan, {});
});

test("GO kuantitas butuh: hasil hitung + tanpa BLOCKER + tanpa dokumen tertunda + keputusan Gudang TERIMA_FISIK", () => {
  const kep = new Map([["A", { gudang: "TERIMA_FISIK" }], ["B", { gudang: "TERIMA_FISIK" }]]);
  const fakta = new Map([["C", { dokumenTertunda: [{ dok: "GR-X", status: "SCHEDULED" }] }]]);
  const { baris } = bangunMatriksPilot({ pilot, preview: { materials: [pvA, pvB] }, keputusan: kep, fakta });
  const [a, b, c] = baris;
  assert.equal(a.keputusanKuantitas, "GO");
  assert.equal(b.keputusanKuantitas, "NO-GO"); assert.match(b.alasanNoGo.join(), /SELISIH_TANPA_BUKTI/);
  assert.equal(c.keputusanKuantitas, "NO-GO"); assert.match(c.alasanNoGo.join(), /GR-X/);
  const tanpaKep = bangunMatriksPilot({ pilot, preview: { materials: [pvA] } }).baris[0];
  assert.equal(tanpaKep.keputusanKuantitas, "NO-GO"); assert.match(tanpaKep.alasanNoGo.join(), /menunggu keputusan Gudang/);
  const hitungUlang = bangunMatriksPilot({ pilot, preview: { materials: [pvA] }, keputusan: new Map([["A", { gudang: "HITUNG_ULANG" }]]) }).baris[0];
  assert.equal(hitungUlang.keputusanKuantitas, "NO-GO");
});

test("valuasi terpisah dari kuantitas: GO kuantitas tanpa keputusan Finance → valuasi BELUM; nilai naik/turun terpisah, tidak di-offset", () => {
  const pvC = { ...pvA, kode: "C", satuan: "CAN", fisikMilikSano: 5, ledgerSaatHitung: 3, delta: 2, nilai: { status: "DITETAPKAN", unitCost: 649350, sumber: "FAKTUR", referensi: "INV-9", nilaiSelisih: 1298700 } };
  const kep = new Map([["A", { gudang: "TERIMA_FISIK", finance: "HARGA_DITETAPKAN" }], ["C", { gudang: "TERIMA_FISIK" }]]);
  const { baris, ringkasan } = bangunMatriksPilot({ pilot, preview: { materials: [pvA, pvC] }, keputusan: kep });
  assert.equal(baris[0].valuasi, "SIAP"); assert.equal(baris[2].valuasi, "BELUM"); assert.match(baris[2].alasanValuasi.join(), /menunggu keputusan Finance/);
  assert.equal(baris[2].keputusanKuantitas, "GO", "kuantitas GO walau valuasi belum");
  assert.equal(ringkasan.nilaiNaikRp, 0); assert.equal(ringkasan.nilaiTurunRp, -2000, "hanya baris valuasi siap; tidak ada offset");
  assert.deepEqual(ringkasan.selisihQtyPerSatuan, { METER: { naik: 0, turun: -2 }, CAN: { naik: 2, turun: 0 } });
});

test("tindakan manusia mencantumkan hitung, BLOCKER, dokumen tertunda, keputusan, dan harga Finance", () => {
  const { baris } = bangunMatriksPilot({ pilot, preview: { materials: [pvB] }, fakta: new Map([["B", { dokumenTertunda: [{ dok: "GR-Y", status: "DRAFT" }] }]]) });
  const t = tindakanManusia(baris[1]).join("\n");
  assert.match(t, /SELISIH_TANPA_BUKTI/); assert.match(t, /GR-Y/); assert.match(t, /keputusan/i); assert.match(t, /harga bersumber dokumen/);
  assert.match(tindakanManusia(baris[0]).join("\n"), /hitung fisik di aplikasi/);
});
