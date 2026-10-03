import test from "node:test";
import assert from "node:assert/strict";
import { buildDriverGroupCaption, isPodBroadcastActive } from "../src/services/driverGroupDocumentation.js";

test("dokumentasi POD aktif secara default dan bisa dimatikan lewat kill-switch", () => {
  assert.equal(isPodBroadcastActive(undefined), true);
  assert.equal(isPodBroadcastActive("true"), true);
  assert.equal(isPodBroadcastActive("false"), false);
});

test("caption dokumentasi memakai jenis aktivitas, nomor order, dan semua unit", () => {
  const job = {
    orderId: "order-fallback",
    units: [
      { unit: { unitCode: "KM-1042-A", order: { orderNumber: "RES-03102026-1042" } } },
      { unit: { unitCode: "KM-1042-B", order: { orderNumber: "RES-03102026-1042" } } },
    ],
  };
  assert.equal(
    buildDriverGroupCaption(job, "✅ Pengiriman selesai"),
    "✅ Pengiriman selesai\n*RES-03102026-1042*\nKM-1042-A, KM-1042-B",
  );
});

test("caption tetap informatif untuk data lama yang tidak punya relasi unit lengkap", () => {
  assert.equal(
    buildDriverGroupCaption({ orderId: "order-lama", units: [] }, "✅ Pengambilan selesai"),
    "✅ Pengambilan selesai\n*order-lama*\nUnit tidak tersedia",
  );
});
