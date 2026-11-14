// Dokumentasi tambahan unit (14 Nov 2026): kapan jalurnya aktif, dan susunan kategorinya. Murni — tanpa database.
import test from "node:test";
import assert from "node:assert/strict";
import { PESAN_DOK_TAMBAHAN, putusanDokumentasiTambahan, susunKategori } from "../src/services/unitDocumentationService.js";
import { DOC_CATEGORIES } from "../src/lib/domain/productionDocumentation.js";

const run = (status = "COMPLETED") => ({ id: "r1", status });

test("unit tanpa pekerjaan V2 (mis. order lama terkirim) memakai dokumentasi tambahan", () => {
  assert.deepEqual(putusanDokumentasiTambahan({ unitStatus: "DELIVERED", run: null, bacaOn: true, tulisOn: true, izinTulis: true }), { aktif: true, bolehUnggah: true, alasan: null });
});

test("unit dengan pekerjaan V2 tetapi V2 belum menyala → dokumentasi tambahan (satu tujuan unggah)", () => {
  assert.equal(putusanDokumentasiTambahan({ unitStatus: "DELIVERED", run: run(), bacaOn: false, tulisOn: false, izinTulis: true }).aktif, true);
  assert.equal(putusanDokumentasiTambahan({ unitStatus: "DELIVERED", run: run(), bacaOn: true, tulisOn: false, izinTulis: true }).aktif, true);
});

test("V2 bisa menerima foto → jalur tambahan TIDAK aktif (foto tidak terpecah di dua tempat)", () => {
  assert.deepEqual(putusanDokumentasiTambahan({ unitStatus: "IN_PRODUCTION", run: run("ACTIVE"), bacaOn: true, tulisOn: true, izinTulis: true }), { aktif: false, bolehUnggah: false, alasan: PESAN_DOK_TAMBAHAN.V2 });
});

test("dibatalkan → tidak bisa ditambah, dari unit maupun pekerjaannya", () => {
  for (const x of [{ unitStatus: "CANCELLED", run: null }, { unitStatus: "DELIVERED", run: run("CANCELLED") }]) {
    assert.deepEqual(putusanDokumentasiTambahan({ ...x, bacaOn: false, tulisOn: false, izinTulis: true }), { aktif: false, bolehUnggah: false, alasan: PESAN_DOK_TAMBAHAN.DIBATALKAN });
  }
});

test("akun tanpa izin tulis tetap bisa melihat, tidak bisa mengunggah", () => {
  assert.deepEqual(putusanDokumentasiTambahan({ unitStatus: "DELIVERED", run: null, bacaOn: false, tulisOn: false, izinTulis: false }), { aktif: true, bolehUnggah: false, alasan: PESAN_DOK_TAMBAHAN.HANYA_LIHAT });
});

test("susunKategori: semua kategori DOC_CATEGORIES dalam urutan yang sama, foto dikelompokkan, URL /media/unit-photos/", () => {
  const rows = [
    { id: "a", category: "FINAL_RESULT", storageKey: "aa.jpg", uploadedById: "u1", createdAt: new Date("2026-11-10T01:00:00Z") },
    { id: "b", category: "FINAL_RESULT", storageKey: "bb.png", uploadedById: "u2", createdAt: new Date("2026-11-10T02:00:00Z") },
    { id: "c", category: "INITIAL_CONDITION", storageKey: "cc.webp", uploadedById: "u1", createdAt: new Date("2026-11-09T01:00:00Z") },
  ];
  const k = susunKategori(rows, new Map([["u1", "Natasha"]]));
  assert.deepEqual(k.map((x) => x.key), DOC_CATEGORIES.map((c) => c.key));
  const akhir = k.find((x) => x.key === "FINAL_RESULT");
  assert.equal(akhir.count, 2);
  assert.deepEqual(akhir.items.map((i) => i.url), ["/media/unit-photos/aa.jpg", "/media/unit-photos/bb.png"]);
  assert.deepEqual(akhir.items.map((i) => i.oleh), ["Natasha", null]);
  assert.equal(k.find((x) => x.key === "QC").count, 0);
});
