// Pencocokan Notion ↔ order (murni, data sintetis): normalisasi nama, kepercayaan tinggi/sedang/rendah, cicilan, satu pembayaran untuk beberapa order, ambiguitas.
import test from "node:test";
import assert from "node:assert/strict";
import { ekstrakNama, normalisasiNama, skorNama, subsetJumlah, cocokkan } from "../src/services/finance/cocokNotion.js";

test("ekstrakNama & normalisasi: kata transaksi, tag, gelar, kapital, spasi, singkatan, emoji", () => {
  assert.equal(ekstrakNama("Pembayaran Ibu Sari (cash)"), "Ibu Sari");
  assert.equal(ekstrakNama("Pelunasan DP  Bapak  Budi [Cs X]"), "Bapak Budi");
  assert.equal(ekstrakNama("pembayaran otoy"), "otoy");
  assert.equal(normalisasiNama("🦆 Ibu  SARI"), "sari");
  assert.equal(normalisasiNama("M. Rizki"), "muhammad rizki");
  assert.equal(normalisasiNama("Moh Rizki"), "muhammad rizki");
  assert.equal(normalisasiNama("Dr. Hj. Ani"), "ani");
});

test("skorNama: sama=1, urutan beda, saling memuat, typo ringan, beda total rendah", () => {
  assert.equal(skorNama("Ibu Sari", "SARI"), 1);
  assert.ok(skorNama("Budi Santoso", "Santoso Budi") >= 0.95);
  assert.ok(skorNama("Budi", "Budi Santoso") >= 0.9);
  assert.ok(skorNama("Andika Prasetyo", "Andhika Prasetyo") >= 0.84);
  assert.ok(skorNama("Sari", "Rahmat") < 0.6);
  assert.equal(skorNama("", "Sari"), 0);
});

test("subsetJumlah: kombinasi tepat, batas ukuran", () => {
  const it = [{ id: "a", nilai: 500 }, { id: "b", nilai: 700 }, { id: "c", nilai: 300 }];
  assert.deepEqual(subsetJumlah(it, 1200).sort(), [["a", "b"]]);
  assert.deepEqual(subsetJumlah(it, 800), [["a", "c"]]);
  assert.deepEqual(subsetJumlah(it, 999), []);
});

const O = (id, nama, nilai, dibuat = "2026-08-01", kirim = ["2026-08-05"], status = "DELIVERED") => ({ id, nomor: id, nama, nilai, dibuat, kirim, status });
const B = (id, deskripsi, nominal, tanggal = "2026-08-03") => ({ id, deskripsi, nominal, tanggal, rekening: "X" });

test("TINGGI: nama kuat + nominal tepat + tanggal dalam jendela + unik; typo/gelar tidak masalah", () => {
  const r = cocokkan([B("n1", "Pembayaran Ibu sari", 1_000_000)], [O("o1", "Sari", 1_000_000), O("o2", "Rahmat", 1_000_000)]);
  assert.equal(r.get("n1").kepercayaan, "TINGGI");
  assert.deepEqual(r.get("n1").orderIds, ["o1"]);
});

test("Cicilan: DP + pelunasan = satu order → keduanya TINGGI (CICILAN)", () => {
  const r = cocokkan([B("n1", "DP Budi", 400_000, "2026-08-01"), B("n2", "Pelunasan Budi", 600_000, "2026-08-06")], [O("o1", "Budi", 1_000_000)]);
  assert.equal(r.get("n1").kepercayaan, "TINGGI"); assert.equal(r.get("n1").jenis, "CICILAN");
  assert.equal(r.get("n2").kepercayaan, "TINGGI");
});

test("Satu pembayaran untuk beberapa order (GABUNGAN_ORDER) → TINGGI bila unik", () => {
  const r = cocokkan([B("n1", "Pembayaran Wati", 1_500_000)], [O("o1", "Wati", 1_000_000), O("o2", "Wati", 500_000)]);
  assert.equal(r.get("n1").jenis, "GABUNGAN_ORDER"); assert.equal(r.get("n1").kepercayaan, "TINGGI");
});

test("SEDANG: tidak unik (dua order senilai untuk nama sama), atau tanggal di luar jendela, atau nominal sebagian", () => {
  const dua = cocokkan([B("n1", "Pembayaran Dewi", 1_000_000)], [O("o1", "Dewi", 1_000_000), O("o2", "Dewi", 1_000_000)]);
  assert.equal(dua.get("n1").kepercayaan, "SEDANG");
  const luar = cocokkan([B("n1", "Pembayaran Dewi", 1_000_000, "2026-12-01")], [O("o1", "Dewi", 1_000_000)]);
  assert.equal(luar.get("n1").kepercayaan, "SEDANG");
  const dp = cocokkan([B("n1", "DP Dewi", 300_000)], [O("o1", "Dewi", 1_000_000)]);
  assert.equal(dp.get("n1").kepercayaan, "SEDANG"); assert.equal(dp.get("n1").jenis, "SEBAGIAN");
});

test("Dua penerimaan penuh untuk satu order → keduanya SEDANG (kemungkinan dobel), bukan TINGGI", () => {
  const r = cocokkan([B("n1", "Pembayaran Yani", 800_000, "2026-08-02"), B("n2", "Pembayaran Yani", 800_000, "2026-08-04")], [O("o1", "Yani", 800_000)]);
  assert.equal(r.get("n1").kepercayaan, "SEDANG"); assert.equal(r.get("n2").kepercayaan, "SEDANG");
});

test("RENDAH: hanya nama atau hanya nominal; TIDAK_ADA bila tak ada kandidat; order batal/nilai 0 diabaikan", () => {
  const nama = cocokkan([B("n1", "Pembayaran Tono", 123_000)], [O("o1", "Tono", 5_000_000)]);
  assert.equal(nama.get("n1").kepercayaan, "SEDANG"); // nominal lebih kecil → sebagian (sedang)
  const besar = cocokkan([B("n1", "Pembayaran Tono", 9_000_000)], [O("o1", "Tono", 5_000_000)]);
  assert.equal(besar.get("n1").kepercayaan, "RENDAH"); assert.equal(besar.get("n1").jenis, "NAMA_SAJA");
  const nom = cocokkan([B("n1", "Pembayaran Xyz", 2_000_000)], [O("o1", "Lain", 2_000_000)]);
  assert.equal(nom.get("n1").kepercayaan, "RENDAH"); assert.equal(nom.get("n1").jenis, "NOMINAL_SAJA");
  const tak = cocokkan([B("n1", "Pembayaran Xyz", 2_000_100)], [O("o1", "Lain", 2_000_000)]);
  assert.equal(tak.get("n1").kepercayaan, "TIDAK_ADA");
  const batal = cocokkan([B("n1", "Pembayaran Sari", 1_000_000)], [O("o1", "Sari", 1_000_000, "2026-08-01", [], "CANCELLED"), O("o2", "Sari", 0)]);
  assert.equal(batal.get("n1").kepercayaan, "TIDAK_ADA");
});
