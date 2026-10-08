// Jenis tagihan DP / TOTAL (6 Okt 2026). Bug: mode DP dulu hanya aktif bila sudah ada pembayaran di ledger, jadi invoice DP tidak muncul
// pada saat paling dibutuhkan — sebelum DP dibayar sama sekali.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { hitungNominal, tentukanJenisTagihan, normalisasiJenis } from "../src/services/invoice.js";

const ORDER = { value: 3_505_000, ongkir: 0, dpTarget: 1_500_000, paymentStatus: "BELUM_BAYAR" };

describe("hitungNominal — jenis tagihan", () => {
  test("REGRESI: DP disepakati tetapi BELUM ada pembayaran → invoice otomatis mode DP, Sisa DP = seluruh DP", () => {
    const n = hitungNominal(ORDER, []);
    assert.equal(n.modeDP, true);
    assert.equal(n.jenisTagihan, "DP");
    assert.equal(n.dpKurang, 1_500_000);
    assert.equal(n.bisaDP, true);
    assert.equal(n.totalTagihan, 3_505_000, "total order tidak berubah; hanya headline yang DP");
    assert.equal(n.sisa, 3_505_000);
  });

  test("sudah bayar sebagian dari DP → tetap mode DP dengan kekurangan yang benar", () => {
    const n = hitungNominal(ORDER, [{ amount: 500_000 }]);
    assert.equal(n.modeDP, true);
    assert.equal(n.dpKurang, 1_000_000);
  });

  test("DP terpenuhi → mode DP mati sendiri, tidak bisa ditagih lagi", () => {
    const n = hitungNominal(ORDER, [{ amount: 1_500_000 }]);
    assert.equal(n.modeDP, false);
    assert.equal(n.bisaDP, false);
    assert.equal(n.jenisTagihan, "TOTAL");
    assert.equal(n.dpKurang, 0);
  });

  test("tanpa dpTarget → TOTAL, DP tidak ditawarkan", () => {
    const n = hitungNominal({ ...ORDER, dpTarget: null }, []);
    assert.deepEqual([n.modeDP, n.bisaDP, n.jenisTagihan], [false, false, "TOTAL"]);
  });

  test("Sales memilih TOTAL: dokumen jadi total, tetapi dpTarget & kemampuan DP tetap tercatat (tidak dihapus)", () => {
    const n = hitungNominal(ORDER, [], { jenis: "TOTAL" });
    assert.equal(n.modeDP, false);
    assert.equal(n.jenisTagihan, "TOTAL");
    assert.equal(n.dpTarget, 1_500_000);
    assert.equal(n.bisaDP, true, "DP masih bisa dipilih kembali");
    assert.equal(n.dpKurang, 1_500_000);
  });

  test("jenis DP eksplisit sama dengan otomatis; DP diminta padahal tak bisa ditagih jatuh ke TOTAL", () => {
    assert.equal(hitungNominal(ORDER, [], { jenis: "DP" }).jenisTagihan, "DP");
    assert.equal(hitungNominal({ ...ORDER, dpTarget: null }, [], { jenis: "DP" }).jenisTagihan, "TOTAL");
    assert.equal(hitungNominal(ORDER, [{ amount: 2_000_000 }], { jenis: "DP" }).jenisTagihan, "TOTAL");
  });

  test("status DP manual tanpa nominal tercatat TIDAK dianggap belum bayar (jangan menagih ulang DP yang entah berapa)", () => {
    const n = hitungNominal({ ...ORDER, paymentStatus: "DP" }, []);
    assert.equal(n.dibayarTidakRinci, true);
    assert.equal(n.modeDP, false);
    assert.equal(n.bisaDP, false);
  });

  test("order lama LUNAS manual tanpa ledger dengan dpTarget → TOTAL (dianggap lunas), bukan menagih DP", () => {
    const n = hitungNominal({ ...ORDER, paymentStatus: "LUNAS" }, []);
    assert.equal(n.dibayar, 3_505_000);
    assert.equal(n.modeDP, false);
  });
});

describe("tentukanJenisTagihan / normalisasiJenis", () => {
  test("normalisasi: hanya DP/TOTAL (tanpa peduli huruf besar-kecil); lainnya = otomatis", () => {
    assert.equal(normalisasiJenis("dp"), "DP");
    assert.equal(normalisasiJenis("Total"), "TOTAL");
    for (const v of ["", "xx", null, undefined, 1, "DP;DROP"]) assert.equal(normalisasiJenis(v), null, String(v));
  });

  test("invoice gabungan: dpTarget dijumlah, dibayar dijumlah", () => {
    const r = tentukanJenisTagihan({ dpTarget: 3_000_000, dibayar: 1_000_000 });
    assert.deepEqual(r, { dpKurang: 2_000_000, bisaDP: true, jenisTagihan: "DP", modeDP: true });
  });

  test("dpTarget 0/negatif/NaN diperlakukan sebagai tidak ada", () => {
    for (const dpTarget of [0, -5, NaN, null, undefined, "abc"]) assert.equal(tentukanJenisTagihan({ dpTarget, dibayar: 0 }).bisaDP, false, String(dpTarget));
  });
});
