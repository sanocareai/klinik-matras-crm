// Tes P8.2 (UI Polish) — penjelasan "Semua 595" vs "500 unit" di Work Order.
// Lihat src/lib/workOrderCounts.js untuk pembuktian penyebab (backend, baca saja).
import test from "node:test";
import assert from "node:assert/strict";

import { describeRowCount, WORK_ORDER_ROW_CAP } from "../src/lib/workOrderCounts.js";

test("tanpa filter, di bawah batas: pesan sederhana, tidak menyebut batas", () => {
  const s = describeRowCount({ rowCount: 42, hasActiveFilter: false });
  assert.match(s, /42 unit/);
  assert.doesNotMatch(s, /dibatasi/);
});

test("tanpa filter, TEPAT kena batas 500: pesan menjelaskan batas DAN bahwa angka tab tidak mengikuti filter", () => {
  const s = describeRowCount({ rowCount: WORK_ORDER_ROW_CAP, hasActiveFilter: false });
  assert.match(s, /500/);
  assert.match(s, /maksimum/);
  assert.match(s, /TOTAL seluruh unit/);
});

test("dengan filter aktif, di bawah batas: pesan tidak mengklaim itu total global", () => {
  const s = describeRowCount({ rowCount: 7, hasActiveFilter: true });
  assert.match(s, /7 unit ditemukan sesuai filter/);
  assert.doesNotMatch(s, /TOTAL seluruh unit/);
});

test("dengan filter aktif DAN kena batas 500: pesan memperingatkan mungkin ada lebih banyak", () => {
  const s = describeRowCount({ rowCount: WORK_ORDER_ROW_CAP, hasActiveFilter: true });
  assert.match(s, /mungkin masih ada/);
});

test("WORK_ORDER_ROW_CAP cocok dengan `take: 500` backend (routes/production.js, dibuktikan manual)", () => {
  assert.equal(WORK_ORDER_ROW_CAP, 500);
});
