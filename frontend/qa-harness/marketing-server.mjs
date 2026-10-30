// QA Marketing — server backend ASLI (buildTestApp + router atribusi ASLI) di atas database TERISOLASI (nama wajib mengandung "test"), dengan data FIXTURE deterministik. Bukan production.
//   TEST_DATABASE_URL=postgresql://klinik:...@localhost:5432/km_mkt_qa_test JWT_SECRET=qa-marketing PORT=4020 OUT=C:/tmp/km-mkt-qa node frontend/qa-harness/marketing-server.mjs
// Menulis OUT/tokens.json (ADMIN dan SALES) dan OUT/rekon.json (angka acuan hasil seed untuk rekonsiliasi). Semua nomor/nama adalah rekaan ("Pelanggan Uji"); tidak ada data customer nyata.
process.env.JWT_SECRET ||= "qa-marketing-jwt-secret";
import "../../backend/tests/integration/setup/env.js";
import fs from "node:fs"; import path from "node:path";
import { testPrisma, truncateAll } from "../../backend/tests/integration/setup/testDb.js";
import { createTestUser } from "../../backend/tests/integration/setup/fixtures.js";
import { buildTestApp } from "../../backend/tests/integration/setup/testApp.js";
import { benihMetaAds } from "../../backend/tests/integration/setup/metaAdsSeed.js";
const { attributionAdsRouter } = await import("../../backend/src/routes/attributionAds.js");

const PORT = Number(process.env.PORT || 4020); const OUT = process.env.OUT || "C:/tmp/km-mkt-qa";
fs.mkdirSync(OUT, { recursive: true });
await truncateAll();

const T = {};
for (const [k, roles, nama] of [["admin", ["ADMIN"], "Admin QA"], ["sales", ["SALES"], "Sales QA"]]) {
  const { user, token } = await createTestUser({ roles });
  await testPrisma.user.update({ where: { id: user.id }, data: { name: nama } });
  T[k] = { token, user: { id: user.id, name: nama, email: user.email, role: roles[0], roles } };
}
const admin = await testPrisma.user.findFirst({ where: { id: T.admin.user.id } });
await benihMetaAds({ testPrisma, admin });

// ── sumber lain (FIXTURE) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let n = 0;
const tel = () => `62857${String(++n).padStart(7, "0")}`;
const WIB = (ymd, jam = 10, menit = 0) => new Date(Date.parse(`${ymd}T00:00:00Z`) + (jam - 7) * 3600e3 + menit * 60e3);
const lead = (leadSource, ymd, o = {}) => testPrisma.customer.create({ data: { name: "Pelanggan Uji", phone: tel(), leadSource, createdAt: WIB(ymd, o.jam ?? 10, o.menit ?? 0), ...(o.data || {}) } });
const order = (customerId, ymd, value, o = {}) => testPrisma.order.create({ data: { customerId, createdAt: WIB(ymd, 14), value, status: "PROCESSING", ...o } });
const bayar = (orderId, ymd, amount) => testPrisma.payment.create({ data: { orderId, amount, method: "TRANSFER", recordedById: admin.id, createdAt: WIB(ymd, 15) } });
const M = (x) => x * 1_000_000;
const percakapan = async (cust, ymd, jam, menit, balasMenit) => {
  const c = await testPrisma.conversation.create({ data: { type: "INDIVIDUAL", customerId: cust.id, channel: "WHATSAPP", lastMessageAt: WIB(ymd, jam, menit), createdAt: WIB(ymd, jam, menit) } });
  await testPrisma.message.create({ data: { conversationId: c.id, direction: "INBOUND", content: "halo", createdAt: WIB(ymd, jam, menit) } });
  if (balasMenit != null) await testPrisma.message.create({ data: { conversationId: c.id, direction: "OUTBOUND", content: "baik kak", createdAt: new Date(WIB(ymd, jam, menit).getTime() + balasMenit * 60e3) } });
};
const hariKe = (i) => `2026-10-${String(i).padStart(2, "0")}`;

// TikTok: 9 lead (2 spam), 3 ber-order (1 lunas, 1 DP, 1 belum bayar). Biaya sumber harian LENGKAP 1–10 Okt (input manual).
for (let i = 0; i < 9; i++) {
  const c = await lead("TIKTOK_ADS", hariKe(2 + (i % 8)), { jam: 9 + (i % 9), data: i < 2 ? { pipelineStage: "SPAM" } : {} });
  if (i === 2) { const o = await order(c.id, hariKe(4), M(2), { paymentStatus: "LUNAS", paidAt: WIB(hariKe(5), 10) }); await bayar(o.id, hariKe(5), M(2)); }
  if (i === 3) { const o = await order(c.id, hariKe(5), M(3), { paymentStatus: "DP" }); await bayar(o.id, hariKe(5), M(1)); }
  if (i === 4) await order(c.id, hariKe(6), 1_500_000, { paymentStatus: "BELUM_BAYAR" });
  if (i % 2 === 0) await percakapan(c, hariKe(2 + (i % 8)), 9 + (i % 9), 5, 12 + i * 7);
}
for (let d = 1; d <= 10; d++) await testPrisma.adSourceSpendEntry.create({ data: { sourceId: "TIKTOK", kind: "HARIAN", dateFrom: new Date(`${hariKe(d)}T00:00:00Z`), dateTo: new Date(`${hariKe(d)}T00:00:00Z`), amount: "150000", reason: "FIXTURE QA biaya harian TikTok", status: "AKTIF", createdById: admin.id } });
// WhatsApp langsung: 14 lead (3 spam), 1 order lunas
for (let i = 0; i < 14; i++) {
  const c = await lead("WHATSAPP_DIRECT", hariKe(1 + (i % 10)), { jam: 8 + (i % 12), data: i < 3 ? { pipelineStage: "SPAM" } : {} });
  if (i === 5) { const o = await order(c.id, hariKe(3), M(2.5), { paymentStatus: "LUNAS", paidAt: WIB(hariKe(4), 10) }); await bayar(o.id, hariKe(4), M(2.5)); }
  if (i % 3 === 0) await percakapan(c, hariKe(1 + (i % 10)), 8 + (i % 12), 20, 3 + i * 11);
}
// Instagram organik: 5 lead, 1 order DP
for (let i = 0; i < 5; i++) {
  const c = await lead("INSTAGRAM", hariKe(2 + i), { jam: 19 });
  if (i === 1) { const o = await order(c.id, hariKe(4), M(1.8), { paymentStatus: "DP" }); await bayar(o.id, hariKe(4), 500_000); }
}
// Website organik: 4 lead tanpa order; Lainnya: 2 lead; B2B & penjualan karyawan (dikeluarkan dari semua sumber)
for (let i = 0; i < 4; i++) await lead("WEBSITE_ORGANIC", hariKe(3 + i), { jam: 13 });
for (let i = 0; i < 2; i++) await lead("OTHER", hariKe(6 + i), { jam: 16 });
await lead("B2B_DIRECT", hariKe(5)); await lead("B2B_DIRECT", hariKe(6)); await lead("PENJUALAN_KARYAWAN", hariKe(7));
// riwayat baseline lead akhir September (supaya baseline tren 7 hari terisi)
for (let d = 24; d <= 30; d++) for (let k = 0; k < 3 + (d % 3); k++) await lead("WHATSAPP_DIRECT", `2026-09-${d}`, { jam: 9 + k * 2 });
// percakapan lead Meta (respons)
const metaLeads = await testPrisma.customer.findMany({ where: { leadSource: "META_ADS" }, orderBy: { createdAt: "asc" }, take: 8 });
for (const [i, c] of metaLeads.entries()) { const d = new Date(c.createdAt.getTime() + 7 * 3600e3); await percakapan(c, d.toISOString().slice(0, 10), d.getUTCHours(), 2, 8 + i * 25); }

// angka acuan hasil seed (dibaca dari database, bukan dari layanan yang diuji) untuk rekonsiliasi
const q = async (sql, ...a) => (await testPrisma.$queryRawUnsafe(sql, ...a))[0];
const rekon = {
  periode: { dari: "2026-10-01", sampai: "2026-10-10" },
  customerDibuat: Number((await q(`select count(*)::int c from "Customer" where "createdAt" >= '2026-09-30T17:00:00Z' and "createdAt" < '2026-10-10T17:00:00Z'`)).c),
  spam: Number((await q(`select count(*)::int c from "Customer" where "createdAt" >= '2026-09-30T17:00:00Z' and "createdAt" < '2026-10-10T17:00:00Z' and "pipelineStage" = 'SPAM' and "leadSource" not in ('B2B_DIRECT','PENJUALAN_KARYAWAN')`)).c),
  b2bKaryawan: Number((await q(`select count(*)::int c from "Customer" where "createdAt" >= '2026-09-30T17:00:00Z' and "createdAt" < '2026-10-10T17:00:00Z' and "leadSource" in ('B2B_DIRECT','PENJUALAN_KARYAWAN')`)).c),
  tabel: { customer: Number((await q('select count(*)::int c from "Customer"')).c), order: Number((await q('select count(*)::int c from "Order"')).c), pembayaran: Number((await q("select count(*)::int c from payments")).c), touch: Number((await q("select count(*)::int c from attribution_touches")).c) },
  fixture: true,
};
fs.writeFileSync(path.join(OUT, "tokens.json"), JSON.stringify(T, null, 2));
fs.writeFileSync(path.join(OUT, "rekon.json"), JSON.stringify(rekon, null, 2));

const app = buildTestApp();
app.use("/api/atribusi/iklan", attributionAdsRouter);
app.get("/api/health", (req, res) => res.json({ ok: true, fixture: true }));
app.listen(PORT, "127.0.0.1", () => console.log(`[qa-marketing] server siap di http://127.0.0.1:${PORT} — DB ${process.env.TEST_DATABASE_URL.split("/").pop()} (FIXTURE)`));
