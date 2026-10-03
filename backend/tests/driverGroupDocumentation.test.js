import test from "node:test";
import assert from "node:assert/strict";
import { buildDriverGroupCaption, isPodBroadcastActive } from "../src/services/driverGroupDocumentation.js";

test("dokumentasi POD aktif secara default dan bisa dimatikan lewat kill-switch", () => {
  assert.equal(isPodBroadcastActive(undefined), true);
  assert.equal(isPodBroadcastActive("true"), true);
  assert.equal(isPodBroadcastActive("false"), false);
});

test("caption dokumentasi memakai jenis aktivitas, nama customer, resi, dan ukuran kasur", () => {
  const job = {
    orderId: "order-fallback",
    order: { orderNumber: "RES-03102026-1042", customer: { name: "Ibu Rina" } },
    units: [
      { unit: { unitCode: "KM-1042-A", ukuran: "160x200 cm (Queen)" } },
      { unit: { unitCode: "KM-1042-B", ukuran: "180 × 200 cm" } },
    ],
  };
  assert.equal(
    buildDriverGroupCaption(job, "✅ Pengiriman selesai"),
    "✅ Pengiriman selesai\n*Customer:* Ibu Rina\n*Resi:* RES-03102026-1042\n*Ukuran kasur:* 160 × 200 cm, 180 × 200 cm",
  );
});

test("ukuran sama diringkas dengan jumlah unit dan ukuran order menjadi fallback", () => {
  assert.match(buildDriverGroupCaption({
    order: { orderNumber: "RES-2", customer: { name: "Bapak Dedi" } },
    units: [{ unit: { ukuran: "160x200" } }, { unit: { ukuran: "160x200" } }],
  }, "✅ Pengambilan selesai"), /\*Ukuran kasur:\* 2× 160 × 200 cm/);

  assert.equal(
    buildDriverGroupCaption({
      order: {
        orderNumber: "RES-LAMA", customer: { name: "Ibu Sari" },
        notes: JSON.stringify({ ukuranKasur: "Ukuran Custom", ukuranLebarCm: 145, ukuranPanjangCm: 205 }),
      },
      units: [],
    }, "✅ Pengambilan selesai"),
    "✅ Pengambilan selesai\n*Customer:* Ibu Sari\n*Resi:* RES-LAMA\n*Ukuran kasur:* 145 × 205 cm (Custom)",
  );
});

test("caption data lama tetap jujur ketika customer dan ukuran belum tersedia", () => {
  assert.equal(
    buildDriverGroupCaption({ orderId: "order-lama", units: [] }, "✅ Pengambilan selesai"),
    "✅ Pengambilan selesai\n*Customer:* Customer belum tersedia\n*Resi:* order-lama\n*Ukuran kasur:* Ukuran belum diisi",
  );
});
