// Aturan murni usulan bahan & pemakaian sementara (tanpa database).
import test from "node:test";
import assert from "node:assert/strict";
import { MaterialUnit } from "@prisma/client";
import { SATUAN, adaKembarSama, cariKembar, kemiripanNama, kunciNama, normalisasiKeputusan, normalisasiPemakaianSementara, normalisasiRekonsiliasi, normalisasiUsulan, saranKode, subJenisKelompok } from "../src/lib/domain/bahanUsulan.js";
import { WORK_SOURCE, effectiveWorkStatus } from "../src/lib/domain/productionWorkStatus.js";

test("satuan usulan = enum MaterialUnit Gudang (tidak boleh bergeser)", () => {
  assert.deepEqual([...SATUAN].sort(), Object.values(MaterialUnit).sort());
});

test("kunciNama menyamakan spasi, huruf besar, tanda baca, angka+satuan menempel, dan aksen", () => {
  assert.equal(kunciNama("  Busa  HR 5cm "), "busa hr 5 cm");
  assert.equal(kunciNama("busa-hr/5 CM"), "busa hr 5 cm");
  assert.equal(kunciNama("Café Ñandú"), "cafe nandu");
});

test("kemiripanNama: SAMA, MIRIP (memuat / token tumpang-tindih), dan tidak mirip", () => {
  assert.equal(kemiripanNama(kunciNama("Busa HR 5cm"), kunciNama("busa hr 5 cm")), "SAMA");
  assert.equal(kemiripanNama("busa hr", "busa hr 5 cm"), "MIRIP");
  assert.equal(kemiripanNama(kunciNama("Kain Rajut Khusus"), kunciNama("Kain Jacquard")), null);
  assert.equal(kemiripanNama("", "busa"), null);
});

test("cariKembar: kode sama = SAMA walau nama beda; usulan terbuka ikut dibandingkan; SAMA didahulukan", () => {
  const bahan = [{ id: "m1", kode: "KAIN-X", nama: "Kain Jacquard", satuan: "METER", aktif: true }, { id: "m2", kode: "BUSA-1", nama: "Busa Latex 3 cm", satuan: "M3", aktif: true }];
  const hasil = cariKembar({ nama: "Kain Jacquard Premium", kode: "busa-1", bahan, usulanTerbuka: [{ id: "u1", name: "Kain Jacquard Premium", nameKey: "kain jacquard premium", unit: "METER" }] });
  assert.equal(hasil[0].tingkat, "SAMA");
  assert.ok(hasil.some((h) => h.jenis === "KATALOG" && h.kode === "BUSA-1" && h.alasan === "Kode sama"));
  assert.ok(hasil.some((h) => h.jenis === "USULAN" && h.proposalId === "u1"));
  assert.equal(adaKembarSama(cariKembar({ nama: "Pita Biru", bahan })), false);
});

test("normalisasiUsulan: nama/satuan/kategori divalidasi; sub-jenis harus cocok dengan kategori", () => {
  const ok = normalisasiUsulan({ name: "  Pegas   Spiral ", unit: "meter", kelompok: "pegas", itemGroup: "per bonnel" });
  assert.equal(ok.name, "Pegas Spiral"); assert.equal(ok.unit, "METER"); assert.equal(ok.kelompok, "PEGAS"); assert.equal(ok.itemGroup, "PER BONNEL");
  for (const salah of [{ name: "ab", unit: "PCS", kelompok: "KAIN" }, { name: "Kain", unit: "KOTAK", kelompok: "KAIN" }, { name: "Kain", unit: "PCS", kelompok: "BELUM" }, { name: "Kain", unit: "PCS", kelompok: "KAIN", itemGroup: "PER BONNEL" }]) {
    assert.throws(() => normalisasiUsulan(salah), (e) => e.statusCode === 400);
  }
  assert.ok(subJenisKelompok("PEGAS").includes("PER POCKET"));
});

test("normalisasiPemakaianSementara: jumlah > 0, satuan dikenal, waktu tidak di masa depan / tidak terlalu lama", () => {
  const sekarang = new Date("2026-10-23T03:00:00Z");
  const ok = normalisasiPemakaianSementara({ name: "Lem Kontak", qty: "2.5", uom: "can", originNote: " Beli sendiri " }, { sekarang });
  assert.equal(ok.qty, 2.5); assert.equal(ok.uom, "CAN"); assert.equal(ok.originNote, "Beli sendiri"); assert.equal(ok.usedAt, sekarang);
  for (const salah of [{ name: "Lem", qty: 0, uom: "CAN" }, { name: "Lem", qty: 1, uom: "XX" }, { name: "Le", qty: 1, uom: "CAN" }, { name: "Lem", qty: 1, uom: "CAN", usedAt: "2026-10-24T03:00:00Z" }, { name: "Lem", qty: 1, uom: "CAN", usedAt: "2026-08-01T00:00:00Z" }]) {
    assert.throws(() => normalisasiPemakaianSementara(salah, { sekarang }), (e) => e.statusCode === 400);
  }
});

test("normalisasiKeputusan & normalisasiRekonsiliasi: alasan/kode/tautan wajib sesuai jenisnya", () => {
  assert.throws(() => normalisasiKeputusan({ keputusan: "TOLAK" }), (e) => e.code === "KEPUTUSAN_ALASAN_WAJIB");
  assert.throws(() => normalisasiKeputusan({ keputusan: "SETUJUI", kode: "a b" }), (e) => e.code === "KEPUTUSAN_KODE_INVALID");
  assert.equal(normalisasiKeputusan({ keputusan: "SETUJUI", kode: "per-spiral.01" }).kode, "PER-SPIRAL.01");
  assert.throws(() => normalisasiRekonsiliasi({ resolusi: "TANPA_STOK", catatan: "singkat" }), (e) => e.code === "REKONSILIASI_ALASAN_WAJIB");
  assert.throws(() => normalisasiRekonsiliasi({ resolusi: "TAUTKAN_ISSUE" }), (e) => e.code === "REKONSILIASI_PERGERAKAN_WAJIB");
  assert.throws(() => normalisasiRekonsiliasi({ resolusi: "LAIN" }), (e) => e.code === "REKONSILIASI_RESOLUSI_INVALID");
});

test("saranKode unik terhadap kode yang ada dan berawalan sesuai kelompok", () => {
  assert.equal(saranKode({ name: "Pegas Spiral", kelompok: "PEGAS" }), "PER-PEGAS-SPIRAL");
  assert.equal(saranKode({ name: "Pegas Spiral", kelompok: "PEGAS" }, new Set(["PER-PEGAS-SPIRAL"])), "PER-PEGAS-SPIRAL-2");
});

test("status kerja: bukti HANYA pemakaian sementara → Sudah dikerjakan bersumber 'Pemakaian sementara'; bila ada bukti lain/selesai → sumber biasa; manual Selesai tidak diturunkan", () => {
  const dasar = { unitStatus: "RECEIVED", pemakaian: { pertamaAt: "2026-10-22T03:00:00Z", terakhirAt: "2026-10-22T03:00:00Z" } };
  const s = effectiveWorkStatus({ ...dasar, pemakaian: { ...dasar.pemakaian, hanyaSementara: true } });
  assert.equal(s.key, "DIKERJAKAN"); assert.equal(s.source, WORK_SOURCE.PEMAKAIAN_SEMENTARA); assert.match(s.sourceLabel, /perlu rekonsiliasi Gudang/); assert.match(s.detail, /bukan Material Issue/);
  assert.equal(effectiveWorkStatus({ ...dasar, pemakaian: { ...dasar.pemakaian, hanyaSementara: false } }).source, WORK_SOURCE.PEMAKAIAN_BAHAN);
  const selesai = effectiveWorkStatus({ ...dasar, pemakaian: { ...dasar.pemakaian, hanyaSementara: true }, manual: { status: "SELESAI", createdAt: "2026-10-21T00:00:00Z", actor: { name: "X" } } });
  assert.equal(selesai.key, "SELESAI");
});
