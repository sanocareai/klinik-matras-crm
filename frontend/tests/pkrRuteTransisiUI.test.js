// Mode rute Produksi transisi (UI): logika murni + kontrak statis layar (Indonesia, tanpa memblokir, sebab + tindakan berikutnya).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { labelMode, modeBerikutnya, alasanModeValid, peringatanAlur, statusAlurUnit, labelSiapFisik, galatKesiapanFisik } from "../src/features/finance/pkrRuteLogic.js";
import { ringkasDampak } from "../src/features/finance/pkrKoreksiOrderLogic.js";

const baca = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("mode: label Indonesia, pilihan berikutnya, alasan minimal 5 huruf", () => {
  assert.equal(labelMode("TRANSISI"), "Transisi");
  assert.equal(labelMode("KETAT"), "Ketat");
  assert.equal(modeBerikutnya("TRANSISI"), "KETAT");
  assert.equal(modeBerikutnya("KETAT"), "TRANSISI");
  assert.equal(alasanModeValid("abcd"), false);
  assert.equal(alasanModeValid("  Produksi siap  "), true);
});

test("peringatan 'Menunggu penentuan alur Produksi' dikenali dari objek maupun teks; peringatan lain diabaikan", () => {
  const w = [
    { kode: "MENUNGGU_ALUR_PRODUKSI", pesan: "Item 1: Menunggu penentuan alur Produksi — rute belum dipetakan." },
    { kode: "CAMPURAN_PER_ITEM", pesan: "Order ini CAMPURAN" },
    "Item 2: Menunggu penentuan alur Produksi — layanan belum dipilih",
  ];
  assert.equal(peringatanAlur(w).length, 2);
  assert.deepEqual(peringatanAlur(null), []);
});

test("ringkasDampak Koreksi Order mengumpulkan 'menunggu alur' dari peringatan mana pun tanpa menjadikannya galat", () => {
  const pra = {
    valid: true,
    peringatan: [{ kode: "MENUNGGU_ALUR_PRODUKSI", pesan: "Item 1: Menunggu penentuan alur Produksi — rute belum dipetakan." }],
    bagian: [{ jenis: "TAMBAHAN", dampak: { unit: { dibuat: 1 }, peringatan: [{ kode: "MENUNGGU_ALUR_PRODUKSI", pesan: "Item 1: Menunggu penentuan alur Produksi — rute belum dipetakan." }, { kode: "X", pesan: "lain" }] } }],
  };
  const d = ringkasDampak(pra, null);
  assert.equal(d.menungguAlur.length, 1, "duplikat digabung");
  assert.match(d.menungguAlur[0], /Menunggu penentuan alur Produksi/);
  assert.equal(ringkasDampak({ valid: false }, null).menungguAlur.length, 0);
});

test("baris unit: status alur + siap fisik; tidak menggantikan status Produksi", () => {
  assert.deepEqual(statusAlurUnit({ alur: { status: "MENUNGGU_ALUR", tindakan: "Admin Produksi memetakan rute" } }), { menunggu: true, label: "Menunggu penentuan alur Produksi", tindakan: "Admin Produksi memetakan rute" });
  assert.equal(statusAlurUnit({ alur: { status: "JELAS" } }).menunggu, false);
  assert.equal(statusAlurUnit({}).menunggu, false);
  assert.match(labelSiapFisik({ kesiapanFisik: { dikonfirmasi: true } }), /status Produksi belum ditandai siap/);
  assert.equal(labelSiapFisik({ kesiapanFisik: { dikonfirmasi: false } }), null);
});

test("form kesiapan fisik: unit dipilih + alasan ≥5", () => {
  assert.match(galatKesiapanFisik({ unitIds: [], alasan: "Barang jadi" }), /Pilih minimal satu unit/);
  assert.match(galatKesiapanFisik({ unitIds: ["u1"], alasan: "ab" }), /minimal 5/);
  assert.equal(galatKesiapanFisik({ unitIds: ["u1"], alasan: "Barang jadi di workshop" }), null);
});

test("kontrak layar: panel mode di Katalog, dialog Koreksi menampilkan sebab+tindakan, badge unit, konfirmasi fisik di Delivery; semua teks Indonesia", () => {
  const panel = baca("features/finance/RuteProduksiPanel.jsx");
  assert.match(panel, /Mode rute Produksi/);
  assert.match(panel, /Menunggu penentuan alur Produksi/);
  assert.match(panel, /Alasan perubahan mode/);
  assert.match(panel, /api\.ubahPkrRuteMode\(/);
  assert.match(panel, /api\.terapkanPkrRute\(/);
  assert.match(baca("pages/bengkel/PkrKatalogItem.jsx"), /<RuteProduksiPanel bisaTulis=\{bisaTulis\} \/>/);
  const koreksi = baca("features/finance/KoreksiOrderPkr.jsx");
  assert.match(koreksi, /data-testid="menunggu-alur"/);
  assert.match(koreksi, /Menunggu penentuan alur Produksi/);
  const unit = baca("features/orders/PkrUnitBaris.jsx");
  assert.match(unit, /badge-menunggu-alur/); assert.match(unit, /badge-siap-fisik/);
  const delivery = baca("features/armada/components/PkrPengirimanPanel.jsx");
  assert.match(delivery, /Konfirmasi kesiapan fisik/);
  assert.match(delivery, /api\.konfirmasiKesiapanFisik\(orderId/);
  assert.match(delivery, /Status dan tahap Produksi tidak diubah/);
  const api = baca("api.js");
  assert.match(api, /konfirmasiKesiapanFisik: \(orderId, data, idempotencyKey\) => request\(`\/armada\/orders\/\$\{orderId\}\/kesiapan-fisik`/);
  for (const f of [panel, koreksi, delivery]) assert.doesNotMatch(f, /Production route|not mapped|Unmapped/i);
});
