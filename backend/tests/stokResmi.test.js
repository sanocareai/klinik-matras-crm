// Tes MURNI (tanpa DB) modul stok resmi: matriks jurnal, aturan penolakan, pembanding pemakaian PIC (informasi saja).
import test from "node:test";
import assert from "node:assert/strict";
import { MATRIKS, KODE, PESAN, SEMUA_JENIS, akunBebanUntuk, StokResmiError } from "../src/services/finance/stokResmi/matriks.js";
import { pemakaianPicPembanding, evaluasiAturan } from "../src/services/finance/stokResmi/pratinjau.js";

test("matriks: 4 jenis, 6 aksi, setiap aksi punya kunci jurnal/atribusi/pembatalan dan status posting valid", () => {
  assert.deepEqual([...SEMUA_JENIS].sort(), ["DAMAGED_STOCK", "RETURN_RECORD", "STOCK_ADJUSTMENT", "STOCK_COUNT"]);
  assert.equal(MATRIKS.length, 6);
  for (const m of MATRIKS) {
    assert.ok(["TERKUNCI", "DITOLAK"].includes(m.posting), `${m.jenis}/${m.aksi}`);
    for (const f of ["jenis", "aksi", "sumberNilai", "atribusi", "pembatalan", "ketergantungan"]) assert.ok(m[f] !== undefined, `${m.jenis}/${m.aksi} tanpa ${f}`);
  }
  assert.equal(MATRIKS.filter((m) => m.posting === "DITOLAK").length, 3);
});

test("setiap kode penolakan punya pesan Indonesia", () => {
  for (const kode of Object.values(KODE)) assert.ok(PESAN[kode] && PESAN[kode].length > 10, kode);
});

test("akun beban: susut/rusak/kedaluwarsa → Beban Susut; selisih opname & penyesuaian lain → Selisih Stok (keduanya agregat, bukan HPP order)", () => {
  assert.equal(akunBebanUntuk("DAMAGED_STOCK", {}), "BEBAN_SUSUT_BAHAN");
  assert.equal(akunBebanUntuk("STOCK_ADJUSTMENT", { adjustmentType: "DAMAGE" }), "BEBAN_SUSUT_BAHAN");
  assert.equal(akunBebanUntuk("STOCK_ADJUSTMENT", { adjustmentType: "EXPIRY" }), "BEBAN_SUSUT_BAHAN");
  assert.equal(akunBebanUntuk("STOCK_ADJUSTMENT", { adjustmentType: "COUNT_DIFFERENCE" }), "SELISIH_STOK");
  assert.equal(akunBebanUntuk("STOCK_COUNT", {}), "SELISIH_STOK");
});

test("StokResmiError membawa statusCode, code, dan detail (extra) untuk handleFinanceError", () => {
  const e = new StokResmiError("x", 422, "KODE_X", [{ a: 1 }]);
  assert.equal(e.statusCode, 422); assert.equal(e.code, "KODE_X"); assert.deepEqual(e.extra, { detail: [{ a: 1 }] });
});

test("evaluasiAturan: sakelar mati / tanggal mulai kosong / sebelum tanggal mulai / belum final = penolakan HANYA saat untukPosting; di pratinjau jadi catatan", () => {
  const d = { aturan: [], final: false, status: "WAITING_REVIEW", niat: [], tanggal: new Date("2026-09-30T05:00:00Z") };
  const mati = { aktif: false, sejak: null };
  const posting = evaluasiAturan(d, mati, { untukPosting: true }).penolakan.map((x) => x.kode);
  assert.ok(posting.includes(KODE.FITUR_BELUM_AKTIF) && posting.includes(KODE.TANGGAL_AKTIVASI_BELUM_DIISI) && posting.includes(KODE.DOKUMEN_BELUM_FINAL));
  const lihat = evaluasiAturan(d, mati);
  assert.equal(lihat.penolakan.length, 0); assert.ok(lihat.catatan.length >= 3);
  const final = { ...d, final: true, niat: [] };
  assert.ok(evaluasiAturan(final, { aktif: true, sejak: "2020-01-01" }).penolakan.some((x) => x.kode === KODE.TANPA_PERGERAKAN));
  assert.ok(evaluasiAturan({ ...final, niat: [1] }, { aktif: true, sejak: "2026-10-01" }, { untukPosting: true }).penolakan.some((x) => x.kode === KODE.DI_LUAR_PERIODE_AKTIVASI));
});

test("pemakaianPicPembanding: pemakaian PIC > tercatat di stok → selisih 'belumTercatat' sebagai INFORMASI; dokumen DOC_ & bahan lain diabaikan; tidak menulis", async () => {
  const MAT = "mat-1";
  const db = {
    productionStepEvidence: { findMany: async () => [
      { payload: { materials: [{ materialId: MAT, qty: 5 }, { materialId: "mat-lain", qty: 9 }] } },
      { payload: { materials: [{ materialId: MAT, qty: 2.5 }] } },
      { payload: {} },
    ] },
    stockMovement: { groupBy: async () => [{ materialId: MAT, _sum: { qty: -3 } }] },
  };
  const hasil = await pemakaianPicPembanding(db, [MAT], new Date("2026-09-01"), new Date("2026-09-30"));
  assert.deepEqual(hasil, [{ materialId: MAT, picQty: 7.5, tercatatDiStok: 3, belumTercatat: 4.5 }]);
  // PIC ≤ tercatat → tidak ada peringatan
  db.stockMovement.groupBy = async () => [{ materialId: MAT, _sum: { qty: -10 } }];
  assert.deepEqual(await pemakaianPicPembanding(db, [MAT], new Date("2026-09-01"), new Date("2026-09-30")), []);
  assert.deepEqual(await pemakaianPicPembanding(db, [], new Date("2026-09-01"), new Date("2026-09-30")), []);
});
