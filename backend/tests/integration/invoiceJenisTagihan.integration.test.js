// Jenis tagihan invoice DP/TOTAL (6 Okt 2026) — buildInvoiceView + PDF pada database nyata. Unit test murni ada di tests/invoiceDp.test.js; test ini
// ada karena bug nyata ("opts is not defined" di buildSingleOrderView) lolos dari unit test: fungsinya butuh DB.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildInvoiceView } from "../../src/services/invoice.js";
import { renderInvoicePdf } from "../../src/services/invoicePdf.js";
import { PDFParse } from "pdf-parse";

test.before(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

async function buatOrder({ dpTarget = 1_500_000, value = 3_505_000 } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Susi", phone: `62812${Math.floor(Math.random() * 1e8)}` } });
  return testPrisma.order.create({
    data: { customerId: customer.id, value, category: "LAYANAN", orderNumber: `RES-${Math.random().toString(36).slice(2, 8)}`, status: "PENDING", paymentStatus: "BELUM_BAYAR", dpTarget },
  });
}
async function bayar(orderId, amount) {
  const u = await createTestUser({ roles: ["SALES"] });
  await testPrisma.payment.create({ data: { orderId, amount, method: "TRANSFER", recordedById: u.user.id } });
}
const teksPdf = async (view) => {
  const p = new PDFParse({ data: new Uint8Array(await renderInvoicePdf(view)) });
  const r = await p.getText();
  await p.destroy?.();
  return r.text.replace(/\s+/g, " ");
};

test("REGRESI: DP disepakati & BELUM ada pembayaran → view otomatis DP; PDF memuat 'Tagihan DP' dan syarat DP (bukan 'Tidak ada pembayaran di muka')", async () => {
  const o = await buatOrder();
  const v = await buildInvoiceView(o.id, {});
  assert.equal(v.nominal.jenisTagihan, "DP");
  assert.equal(v.nominal.modeDP, true);
  assert.equal(v.nominal.dpKurang, 1_500_000);
  const t = await teksPdf(v);
  assert.match(t, /Tagihan DP/);
  assert.match(t, /Sisa DP/);
  assert.match(t, /DP dibayarkan sebesar Tagihan DP/);
  assert.doesNotMatch(t, /Tidak ada pembayaran di muka/);
});

test("jenis TOTAL: view & PDF total; dpTarget tetap tersimpan di order; syarat asli dipakai", async () => {
  const o = await buatOrder();
  const v = await buildInvoiceView(o.id, { jenis: "TOTAL" });
  assert.equal(v.nominal.jenisTagihan, "TOTAL");
  assert.equal(v.nominal.bisaDP, true);
  assert.equal((await testPrisma.order.findUnique({ where: { id: o.id } })).dpTarget, 1_500_000);
  const t = await teksPdf(v);
  assert.doesNotMatch(t, /Tagihan DP/);
  assert.match(t, /Tidak ada pembayaran di muka/);
  assert.doesNotMatch(t, /terpenuhi/, "memilih Total tidak boleh mencetak 'DP terpenuhi'");
});

test("sebagian dibayar → tetap DP dengan sisa benar; DP terpenuhi → otomatis Total & jenis DP yang diminta jatuh ke Total", async () => {
  const o = await buatOrder();
  await bayar(o.id, 500_000);
  const sebagian = await buildInvoiceView(o.id, {});
  assert.deepEqual([sebagian.nominal.jenisTagihan, sebagian.nominal.dpKurang], ["DP", 1_000_000]);
  await bayar(o.id, 1_000_000);
  const penuh = await buildInvoiceView(o.id, { jenis: "DP" });
  assert.equal(penuh.nominal.jenisTagihan, "TOTAL");
  assert.equal(penuh.nominal.bisaDP, false);
});

test("tanpa dpTarget → TOTAL; jenis tidak dikenal diabaikan", async () => {
  const o = await buatOrder({ dpTarget: null });
  assert.equal((await buildInvoiceView(o.id, {})).nominal.jenisTagihan, "TOTAL");
  assert.equal((await buildInvoiceView(o.id, { jenis: "DP" })).nominal.jenisTagihan, "TOTAL");
});
