// Logika murni bagian Harga Berlaku otomatis di formulir PO.
import test from "node:test";
import assert from "node:assert/strict";
import { petaBarisHarga, teksDampakBaris, ringkasDampak, ringkasHasilSimpan, rpHarga, STATUS_HARGA_PO } from "../src/features/finance/hargaDariPOLogic.js";

const pra = { aktif: true, ringkas: { akanMenulis: 1, masalah: 0 }, baris: [
  { materialId: "a", barisPO: [1], status: "NAIK", hargaLama: 188800, hargaBaru: 212400, satuanStok: "SHEET", satuanBeli: "SHEET", masalah: false },
  { materialId: "b", barisPO: [2, 3], status: "KONFLIK_HARGA_BEDA", alasan: "Bahan ini ada di baris 2, 3 dengan harga berbeda", masalah: true },
] };

test("peta per nomor baris: konflik tampil di SEMUA baris bahan yang sama", () => {
  const p = petaBarisHarga(pra); assert.equal(p[1].tulis, true); assert.equal(p[2].masalahTeks, p[3].masalahTeks); assert.ok(p[2].masalahTeks.includes("baris 2, 3"));
});
test("kalimat dampak: harga lama → baru, harga pertama, sama, tidak diubah, konversi, masalah", () => {
  assert.equal(teksDampakBaris(petaBarisHarga(pra)[1]), "Saat disimpan, Harga Berlaku menjadi Rp188.800 → Rp212.400 / SHEET.");
  assert.match(teksDampakBaris({ status: "BARU", hargaLama: null, hargaBaru: 49950, satuanStok: "KG", satuanBeli: "CAN", faktor: 13 }), /Belum ada harga berlaku → Rp49\.950 \/ KG \(1 CAN = 13 KG\)/);
  assert.match(teksDampakBaris({ status: "SAMA", hargaBaru: 300, satuanStok: "PCS" }), /tidak ada perubahan/);
  assert.match(teksDampakBaris({ status: "TIDAK_DIUBAH" }), /tidak disentuh/);
  assert.equal(teksDampakBaris(null), "");
});
test("ringkasan: masalah menahan; tanpa masalah menyebut jumlah yang diperbarui; saklar mati jujur", () => {
  assert.deepEqual(ringkasDampak({ aktif: true, ringkas: { akanMenulis: 0, masalah: 2 } }).menahan, true);
  assert.match(ringkasDampak(pra).teks, /1 Harga Berlaku bahan akan diperbarui/); assert.equal(ringkasDampak(pra).menahan, false);
  assert.match(ringkasDampak({ aktif: true, ringkas: { akanMenulis: 0, masalah: 0 } }).teks, /Tidak ada Harga Berlaku yang berubah/);
  assert.match(ringkasDampak({ aktif: false }).teks, /dimatikan/); assert.equal(ringkasDampak(null).teks, "");
});
test("hasil simpan hanya menyebut yang benar-benar tercatat server", () => {
  assert.equal(ringkasHasilSimpan(null), ""); assert.equal(ringkasHasilSimpan({ aktif: false }), "");
  assert.equal(ringkasHasilSimpan({ aktif: true, diterapkan: [{}, {}] }), "PO disimpan · 2 Harga Berlaku diperbarui otomatis.");
  assert.equal(ringkasHasilSimpan({ aktif: true, diterapkan: [] }), "PO disimpan · tidak ada Harga Berlaku yang berubah.");
});
test("rupiah pecahan sampai 4 desimal; kosong = strip", () => {
  assert.equal(rpHarga(8333.3333), "Rp8.333,3333"); assert.equal(rpHarga(49950), "Rp49.950"); assert.equal(rpHarga(null), "—"); assert.equal(STATUS_HARGA_PO.KONFLIK_HARGA_BEDA.varian, "red");
});
