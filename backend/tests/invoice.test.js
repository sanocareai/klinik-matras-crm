// Tes services/invoice.js#produkLineLabel — label produk satu baris dipakai
// broadcast WA rute (routes/armada.js#produkUntukBroadcast) & gambar Tabel
// Rute (services/routeSheetImage.js).
//
// FOKUS D-170 (15 September 2026, laporan owner: order SEWA menampilkan
// "Kasur Spring" di kartu/gambar rute — "karna kasur kita bukan spring",
// yang benar brand-nya "Sano"). Klinik Matras cuma menyewakan SATU jenis
// kasur (brand sendiri) — productType TIDAK PERNAH relevan untuk SEWA,
// jadi kategori ini SELALU pakai brand (merkKasur, dari Order.notes),
// bukan Lini+Jenis Produk, terlepas dari apa pun yang kebetulan tersimpan
// di kolom productType.

import test from "node:test";
import assert from "node:assert/strict";

import { produkLineLabel, parseOrderNotesForInvoice } from "../src/services/invoice.js";

test("kategori LAYANAN/BARU — perilaku lama TIDAK berubah (Lini + Jenis)", () => {
  assert.equal(
    produkLineLabel({ category: "LAYANAN", productLine: "KASUR", productType: "KASUR_SPRING" }),
    "Kasur Spring"
  );
  assert.equal(
    produkLineLabel({ category: "BARU", productLine: "SOFA", productType: "SOFA_L" }),
    "Sofa L"
  );
  // productType kosong -> jatuh ke Lini saja, tetap seperti sebelumnya.
  assert.equal(produkLineLabel({ category: "LAYANAN", productLine: "KASUR", productType: "" }), "Kasur");
});

// --- D-170: kategori SEWA -----------------------------------------------
test("kategori SEWA — SELALU pakai brand (merkKasur), BUKAN Lini+Jenis Produk", () => {
  const order = {
    category: "SEWA", productLine: "KASUR", productType: "",
    notes: JSON.stringify({ merkKasur: "Sano", ukuranKasur: "180x200 cm (King)" }),
  };
  assert.equal(produkLineLabel(order), "Sano");
});

test("kategori SEWA — order LAMA yang kebetulan masih menyimpan productType NYASAR tetap pakai brand, bukan productType itu", () => {
  // Skenario NYATA yang dilaporkan owner: order SWS-14092026-007 kebetulan
  // punya productType="KASUR_SPRING" tersimpan (data lama/nyasar, mungkin
  // dari sebelum aturan ini atau kategori diubah manual belakangan) —
  // produkLineLabel() TIDAK BOLEH membacanya lagi untuk SEWA.
  const order = {
    category: "SEWA", productLine: "KASUR", productType: "KASUR_SPRING",
    notes: JSON.stringify({ merkKasur: "Sano", ukuranKasur: "180x200 cm (King)" }),
  };
  assert.equal(produkLineLabel(order), "Sano");
});

test("kategori SEWA — merkKasur kosong/belum terisi jatuh ke default 'Sano', bukan string kosong", () => {
  // merkKasur SEHARUSNYA selalu terisi "Sano" (dikunci form order,
  // OrderSection.jsx) — default ini jaring pengaman untuk data lawas yang
  // notes-nya kosong/rusak, BUKAN jalur yang diharap sering kepakai.
  const order = { category: "SEWA", productLine: "KASUR", productType: "", notes: null };
  assert.equal(produkLineLabel(order), "Sano");
});

test("parseOrderNotesForInvoice tidak melempar untuk notes rusak/kosong", () => {
  assert.deepEqual(parseOrderNotesForInvoice(null), { merkKasur: "", ukuranKasur: "" });
  assert.deepEqual(parseOrderNotesForInvoice("teks polos lawas"), { merkKasur: "", ukuranKasur: "" });
});

// ─── Jatuh tempo dihitung per HARI KALENDER WIB ───────────────────────────
import { hariLewatTempo, statusEfektif } from "../src/services/invoice.js";

test("hariLewatTempo — hari jatuh tempo itu sendiri BELUM telat, sehari sesudahnya baru 1", () => {
  const due = new Date("2026-09-21T00:00:00.000Z"); // kolom DATE: 21 Sep
  assert.equal(hariLewatTempo(due, new Date("2026-09-21T20:00:00Z")), 1); // 22 Sep 03:00 WIB
  assert.equal(hariLewatTempo(due, new Date("2026-09-21T02:00:00Z")), 0); // 21 Sep 09:00 WIB
  assert.equal(hariLewatTempo(due, new Date("2026-09-20T18:00:00Z")), 0); // 21 Sep 01:00 WIB
  assert.equal(hariLewatTempo(due, new Date("2026-09-22T02:00:00Z")), 1);
  assert.equal(hariLewatTempo(null), null);
});

test("statusEfektif — OVERDUE hanya mulai sehari setelah jatuh tempo, sejalan dengan hariLewatTempo", () => {
  const invoice = { lifecycleStatus: "SENT", dueDate: new Date("2026-09-21T00:00:00.000Z") };
  const nominal = { lunas: false, dibayar: 0, dibayarTidakRinci: false };
  assert.equal(statusEfektif({ invoice, nominal, now: new Date("2026-09-21T10:00:00Z") }), "SENT"); // 17:00 WIB hari jatuh tempo
  assert.equal(statusEfektif({ invoice, nominal, now: new Date("2026-09-22T02:00:00Z") }), "OVERDUE");
});
