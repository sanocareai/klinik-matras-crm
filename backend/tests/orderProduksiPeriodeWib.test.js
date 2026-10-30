// Periode Order Produksi: dasar tanggal = unit dibuat, hari kalender WIB, dari (termasuk) … sampai (termasuk SELURUH hari itu). Murni (tanpa DB).
import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkOrderWhere, periodeDariQuery } from "../src/services/productionOrderList.js";

test("periode = hari kalender WIB: awal hari dari (00:00 WIB) s.d. SEBELUM awal hari sesudah sampai — hari terakhir ikut penuh", () => {
  const w = buildWorkOrderWhere({ dari: "2026-10-30", sampai: "2026-10-30" }); // satu hari: 30 Okt 00:00–23:59:59.999 WIB
  assert.equal(w.createdAt.gte.toISOString(), "2026-10-29T17:00:00.000Z", "00:00 WIB = 17:00 UTC hari sebelumnya");
  assert.equal(w.createdAt.lt.toISOString(), "2026-10-30T17:00:00.000Z", "eksklusif = 00:00 WIB hari berikutnya");
  const rentang = buildWorkOrderWhere({ dari: "2026-10-01", sampai: "2026-10-15" });
  assert.equal(rentang.createdAt.gte.toISOString(), "2026-09-30T17:00:00.000Z"); assert.equal(rentang.createdAt.lt.toISOString(), "2026-10-15T17:00:00.000Z");
  // 23:59:59 WIB tanggal akhir MASUK; 00:00:00 WIB hari berikutnya TIDAK
  const t = (iso) => new Date(iso).getTime();
  assert.ok(t("2026-10-15T16:59:59.999Z") < rentang.createdAt.lt.getTime(), "23:59:59.999 WIB tanggal 15 masuk");
  assert.ok(!(t("2026-10-15T17:00:00.000Z") < rentang.createdAt.lt.getTime()), "00:00 WIB tanggal 16 tidak masuk");
  assert.ok(t("2026-09-30T16:59:59.999Z") < rentang.createdAt.gte.getTime(), "23:59:59 WIB tanggal 30 Sep tidak masuk");
});

test("tanpa periode (Semua waktu) tidak membatasi createdAt; hanya dari / hanya sampai tetap didukung; tanggal tidak valid dan terbalik ditolak", () => {
  assert.equal(buildWorkOrderWhere({}).createdAt, undefined);
  assert.ok(buildWorkOrderWhere({ dari: "2026-10-01" }).createdAt.gte && !buildWorkOrderWhere({ dari: "2026-10-01" }).createdAt.lt);
  assert.ok(buildWorkOrderWhere({ sampai: "2026-10-01" }).createdAt.lt && !buildWorkOrderWhere({ sampai: "2026-10-01" }).createdAt.gte);
  assert.throws(() => periodeDariQuery({ dari: "2026-13-45" }), (e) => e.statusCode === 400 && e.code === "PERIODE_TIDAK_VALID");
  assert.throws(() => periodeDariQuery({ dari: "2026-10-10", sampai: "2026-10-01" }), (e) => e.code === "PERIODE_TERBALIK");
});

test("periode tidak mengubah klasifikasi/status: hanya menambah createdAt pada filter yang sama (status, q, serviceLine tetap)", () => {
  const dasar = buildWorkOrderWhere({ displayStatus: "DIPROSES", q: "RES" });
  const dgn = buildWorkOrderWhere({ displayStatus: "DIPROSES", q: "RES", dari: "2026-10-01", sampai: "2026-10-15" });
  const { createdAt, ...sisa } = dgn; assert.ok(createdAt); assert.deepEqual(sisa, dasar);
});
