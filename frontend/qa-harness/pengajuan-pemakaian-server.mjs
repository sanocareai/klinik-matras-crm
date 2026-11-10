// QA PENGAJUAN PEMAKAIAN BAHAN — server backend ASLI (buildTestApp) di atas database TERISOLASI (nama wajib mengandung "test") + data uji deterministik. Tidak menyentuh production.
//   TEST_DATABASE_URL=postgresql://klinik:...@localhost:5432/km_ppqa_test JWT_SECRET=... PORT=4041 OUT=C:/tmp/km-pp-qa node frontend/qa-harness/pengajuan-pemakaian-server.mjs
// Aturan (keputusan Owner Nov 2026): ADMIN mencatat → langsung; non-ADMIN → pengajuan (stok & HPP belum berubah) → diverifikasi ADMIN LAIN.
// Dunia: BUSA-QA (KG, saldo 100, harga 20.000), LATEX-QA (KG, saldo 30). Unit V1 RES-QA-101 (berjalan) + RES-QA-102 (berjalan, ada pengajuan DITAHAN).
//   Order BARU NEW-QA-201 di Aplikasi Meja: PIC Meja = Nadya QA, PIC Bahan = Operator QA, Gudang sudah menyerahkan BUSA 3 + LATEX 2.
// Menulis OUT/tokens.json dan OUT/ids.json.
import "../../backend/tests/integration/setup/env.js";
import fs from "node:fs"; import path from "node:path"; import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "../../backend/tests/integration/setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "../../backend/tests/integration/setup/fixtures.js";
import { buildTestApp } from "../../backend/tests/integration/setup/testApp.js";
import { V2_FLAGS } from "../../backend/src/services/v2FeatureFlags.js";

const PORT = Number(process.env.PORT || 4041); const OUT = process.env.OUT || "C:/tmp/km-pp-qa";
if (!/test/.test(process.env.TEST_DATABASE_URL || "")) throw new Error("TEST_DATABASE_URL wajib basis data uji");
fs.mkdirSync(OUT, { recursive: true });
await truncateAll();
const k = (p = "qa-pp") => `${p}-${randomUUID()}`;

const T = {}; const U = {};
for (const [kunci, roles, nama] of [["admin", ["ADMIN"], "Admin QA"], ["admin2", ["ADMIN"], "Admin Dua QA"], ["operator", ["PRODUCTION_WORKER"], "Operator QA"], ["nadya", ["WAREHOUSE", "PRODUCTION_WORKER"], "Nadya QA"],
  ["lead", ["PRODUCTION_LEAD"], "Lead QA"], ["finance", ["FINANCE"], "Finance QA"], ["qc", ["QC_LEAD"], "QC QA"], ["corner", ["PRODUCTION_WORKER"], "Corner QA"]]) {
  const { user, token } = await createTestUser({ roles });
  await testPrisma.user.update({ where: { id: user.id }, data: { name: nama } });
  T[kunci] = { token, user: { id: user.id, name: nama, email: user.email, role: roles[0], roles } }; U[kunci] = user;
}
fs.writeFileSync(path.join(OUT, "tokens.json"), JSON.stringify(T, null, 2));

const busa = await createTestMaterial({ code: "BUSA-QA", name: "Busa QA", unit: "KG" });
const latex = await createTestMaterial({ code: "LATEX-QA", name: "Latex QA", unit: "KG" });
await seedBalance(busa.id, 100, { unitCost: 20000 }); await seedBalance(latex.id, 30, { unitCost: 30000 });
const lalu = new Date(Date.now() - 30 * 86_400_000);
await testPrisma.materialHargaBerlaku.create({ data: { materialId: busa.id, unitPrice: "20000", satuan: "KG", effectiveFrom: lalu, createdAt: lalu, reason: "harga QA busa", idempotencyKey: k() } });
await testPrisma.materialHargaBerlaku.create({ data: { materialId: latex.id, unitPrice: "30000", satuan: "KG", effectiveFrom: lalu, createdAt: lalu, reason: "harga QA latex", idempotencyKey: k() } });

const id = { busa: busa.id, latex: latex.id };
const mkV1 = async (no) => {
  const { order, unit } = await createTestUnit({ status: "IN_PRODUCTION", createdAt: new Date(Date.now() - 5 * 86_400_000) });
  await testPrisma.order.update({ where: { id: order.id }, data: { orderNumber: no, status: "PROCESSING", value: 2_000_000, category: "LAYANAN" } });
  await testPrisma.unit.update({ where: { id: unit.id }, data: { unitCode: `${no}-U1` } });
  return unit;
};
id.u101 = (await mkV1("RES-QA-101")).id; id.u102 = (await mkV1("RES-QA-102")).id;

// V2: Aplikasi Meja (order BARU kasur) — kohort, work center, operator, gudang
const wc = await testPrisma.workCenter.create({ data: { code: `WC-QA-${Date.now()}`, name: "Workshop QA" } });
const op = {};
for (const s of ["nadya", "operator", "corner"]) op[s] = await testPrisma.productionOperator.create({ data: { workLanes: ["TABLE", "CORNER"], userId: U[s].id, primaryWorkCenterId: wc.id } });
const wh = await testPrisma.warehouse.create({ data: { code: `WH-QA-${Date.now()}`, name: "Gudang QA" } });
await testPrisma.storageLocation.create({ data: { warehouseId: wh.id, zone: "FG", locationType: "FINISHED_GOODS_AREA", code: `FG-QA-${Date.now()}` } });
const cust = await testPrisma.customer.create({ data: { name: "Bu Custom QA" } });
const ord = await testPrisma.order.create({ data: { customerId: cust.id, orderNumber: "NEW-QA-201", value: 5_000_000, category: "BARU", status: "PROCESSING", productLine: "KASUR", productType: "KASUR_SPRING", beratBadan: 80, notes: "Ukuran 160x200", items: { create: [{ layananName: "Kasur Custom Pocket Spring 160x200", harga: 5_000_000 }] } } });
const u201 = await testPrisma.unit.create({ data: { unitCode: "NEW-QA-201-U1", orderId: ord.id, seq: 1, status: "RECEIVED", merk: "Custom", ukuran: "160x200" } });
id.u201 = u201.id;
for (const key of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) {
  const data = { enabled: true, scope: "GLOBAL", config: { unitIds: [u201.id] }, reason: "QA pengajuan pemakaian" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key }, create: { key, ...data }, update: data });
}

const app = buildTestApp();
app.get("/api/health", (req, res) => res.json({ ok: true }));
const server = app.listen(PORT, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const API = `http://127.0.0.1:${PORT}/api`;
const api = async (siapa, method, p, body, kunci = k()) => {
  const r = await fetch(API + p, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${T[siapa].token}`, "Idempotency-Key": kunci }, body: body ? JSON.stringify(body) : undefined });
  const b = await r.json().catch(() => null); if (r.status >= 400) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(b)}`); return b;
};
const V2 = "/production-v2"; const PL = "/production-planning";
const kartu = () => api("lead", "GET", `${V2}/runs/${id.run201}/card`);
// jadwal + PIC + Corner, BOM + serah Gudang, PIC Bahan, mulai pengerjaan
const tgl = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const plan = await api("lead", "POST", `${V2}/plans`, { unitId: u201.id, productionDate: tgl, stationCode: "TABLE_1", priority: 0, workCenterId: wc.id, operatorId: op.nadya.id, cornerOperatorId: op.corner.id });
id.run201 = (await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: u201.id } })).id;
await api("lead", "POST", `${V2}/runs/${id.run201}/build/corner`, { expectedRevision: (await kartu()).revision, required: true });
const pl = await api("lead", "GET", `${PL}/plans/${plan.planId}`);
const bom = await api("lead", "POST", `${PL}/plans/${plan.planId}/bom`, { lines: [{ materialId: busa.id, qty: 3 }, { materialId: latex.id, qty: 2 }], expectedRevision: pl.revision });
await api("nadya", "POST", `${PL}/plans/${plan.planId}/reserve`, { expectedRevision: bom.revision });
const mr = await api("nadya", "POST", `${PL}/plans/${plan.planId}/material-request`, {});
await api("nadya", "POST", `${PL}/material-requests/${mr.issueId}/pick`, { expectedRevision: 1 });
await api("lead", "POST", `${V2}/runs/${id.run201}/build/material-operator`, { operatorId: op.operator.id, expectedRevision: (await kartu()).revision });
await api("nadya", "POST", `${V2}/runs/${id.run201}/steps/6`, { expectedRevision: (await kartu()).revision, workCenterId: wc.id, payload: {}, media: [] });

// Pengajuan awal untuk antrean ADMIN: (1) operator RES-QA-101 BUSA 2 (menunggu); (2) operator RES-QA-102 LATEX 1, lalu ADMIN mencatat LATEX yang sama langsung → verifikasi = DITAHAN (GANDA)
const p1 = await api("operator", "POST", `/units/${id.u101}/materials`, { materialId: busa.id, qty: 2, note: "Lapisan bawah" });
const p2 = await api("lead", "POST", `/units/${id.u102}/materials`, { materialId: latex.id, qty: 1, note: "Lapisan atas" });
await api("admin", "POST", `/units/${id.u102}/materials`, { materialId: latex.id, qty: 1 });
const v = await api("admin2", "POST", "/production/pengajuan-pemakaian/verifikasi", { item: [{ id: p2.pengajuan.id }] });
if (v.hasil[0].status !== "DITAHAN") throw new Error("seed: pengajuan kedua seharusnya DITAHAN: " + JSON.stringify(v));
id.p1 = p1.pengajuan.id; id.p2 = p2.pengajuan.id;
fs.writeFileSync(path.join(OUT, "ids.json"), JSON.stringify(id, null, 2));
console.log(`[qa-pp] server siap di http://127.0.0.1:${PORT} — DB ${process.env.TEST_DATABASE_URL.split("/").pop()}`);
