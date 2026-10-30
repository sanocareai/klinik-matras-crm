// Logika murni layar pratinjau Harga Berlaku dari PO: kapan tombol Setujui boleh aktif, teks hasil yang jujur, format rupiah pecahan.
import test from "node:test";
import assert from "node:assert/strict";
import { bisaSetujuiHargaPO, ringkasHasilHargaPO, rpHarga, STATUS_HARGA_PO } from "../src/features/finance/hargaDariPOLogic.js";

const baris = (status, materialId = "m1") => ({ status, materialId });

test("tombol Setujui: nonaktif sebelum pratinjau termuat; aktif bila tak ada konflik dan penyetuju berizin", () => {
  assert.equal(bisaSetujuiHargaPO(null).bisa, false);
  assert.equal(bisaSetujuiHargaPO({ aktif: true, baris: [baris("NAIK")], ringkas: { akanMengubahHarga: 1 }, bolehSetujuiHarga: true }).bisa, true);
});

test("konflik harga/satuan menahan persetujuan sampai DILEWATI eksplisit (tidak ada pilihan diam-diam)", () => {
  for (const s of ["KONFLIK_HARGA_BEDA", "KONVERSI_TIDAK_ADA", "KONVERSI_TIDAK_SAH"]) {
    const pra = { aktif: true, baris: [baris(s, "m9"), baris("NAIK", "m1")], ringkas: { akanMengubahHarga: 1 }, bolehSetujuiHarga: true };
    const t = bisaSetujuiHargaPO(pra, new Set());
    assert.equal(t.bisa, false); assert.match(t.alasan, /1 bahan masih konflik/);
    assert.equal(bisaSetujuiHargaPO(pra, new Set(["m9"])).bisa, true);
    assert.equal(bisaSetujuiHargaPO(pra, new Set(["m1"])).bisa, false, "melewati bahan lain tidak menyelesaikan konflik");
  }
});

test("penyetuju tanpa izin harga: ditahan bila PO mengubah harga; boleh bila tidak ada perubahan harga", () => {
  const ubah = { aktif: true, baris: [baris("TURUN")], ringkas: { akanMengubahHarga: 1 }, bolehSetujuiHarga: false };
  assert.equal(bisaSetujuiHargaPO(ubah).bisa, false); assert.match(bisaSetujuiHargaPO(ubah).alasan, /Finance atau Owner/);
  assert.equal(bisaSetujuiHargaPO({ aktif: true, baris: [baris("SAMA")], ringkas: { akanMengubahHarga: 0 }, bolehSetujuiHarga: false }).bisa, true);
});

test("saklar mati: persetujuan tidak ditahan, dan hasil tidak mengklaim harga terbarui", () => {
  assert.equal(bisaSetujuiHargaPO({ aktif: false }).bisa, true);
  assert.match(ringkasHasilHargaPO({ aktif: false }), /dimatikan/);
});

test("ringkasan hasil hanya menyebut yang benar-benar tercatat", () => {
  assert.equal(ringkasHasilHargaPO(null), "PO disetujui.");
  assert.equal(ringkasHasilHargaPO({ aktif: true, diterapkan: [{}, {}], dilewati: [] }), "PO disetujui · 2 Harga Berlaku diperbarui.");
  assert.equal(ringkasHasilHargaPO({ aktif: true, diterapkan: [], dilewati: [{}] }), "PO disetujui · tidak ada Harga Berlaku yang berubah · 1 bahan dilewati (ubah manual).");
});

test("rupiah pecahan sampai 4 desimal; kosong = strip (bukan Rp0)", () => {
  assert.equal(rpHarga(8333.3333), "Rp8.333,3333"); assert.equal(rpHarga(49950), "Rp49.950"); assert.equal(rpHarga(null), "—");
  assert.ok(STATUS_HARGA_PO.KONFLIK_HARGA_BEDA.varian === "red" && STATUS_HARGA_PO.SAMA.teks.includes("tidak berubah"));
});
