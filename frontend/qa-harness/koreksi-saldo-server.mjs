// QA Koreksi Saldo — server backend ASLI (buildTestApp, tanpa penjadwal) di atas database TERISOLASI (nama wajib mengandung "test"), plus data uji deterministik.
//   TEST_DATABASE_URL=postgresql://klinik:klinik123@localhost:55442/km_koreksi_saldo_qa_test JWT_SECRET=... PORT=4010 OUT=C:/tmp/km-koreksi-qa node frontend/qa-harness/koreksi-saldo-server.mjs
// Menulis OUT/tokens.json (token + user per peran) dan OUT/ids.json (id bahan per skenario). Tidak menyentuh production.
import "../../backend/tests/integration/setup/env.js";
import fs from "node:fs"; import path from "node:path";
import { testPrisma, truncateAll } from "../../backend/tests/integration/setup/testDb.js";
import { createTestUser, createTestMaterial } from "../../backend/tests/integration/setup/fixtures.js";
import { buildTestApp } from "../../backend/tests/integration/setup/testApp.js";

const PORT = Number(process.env.PORT || 4010); const OUT = process.env.OUT || "C:/tmp/km-koreksi-qa";
fs.mkdirSync(OUT, { recursive: true });
await truncateAll();
const hari = (n) => new Date(Date.now() - n * 86_400_000);
const gerak = (materialId, type, qty, createdAt = hari(5), note = "seed QA") => testPrisma.stockMovement.create({ data: { materialId, type, qty, note, createdAt } });

const T = {};
for (const [k, roles, nama] of [["owner", ["OWNER"], "Owner QA"], ["owner2", ["OWNER"], "Owner Kedua QA"], ["gudang", ["WAREHOUSE"], "Gudang QA"], ["finance", ["FINANCE"], "Finance QA"], ["admin", ["ADMIN"], "Admin QA"], ["sales", ["SALES"], "Sales QA"]]) {
  const { user, token } = await createTestUser({ roles });
  await testPrisma.user.update({ where: { id: user.id }, data: { name: nama } });
  T[k] = { token, user: { id: user.id, name: nama, email: user.email, role: roles[0], roles } };
}
fs.writeFileSync(path.join(OUT, "tokens.json"), JSON.stringify(T, null, 2));

const id = {};
const mk = async (kunci, o) => { const m = await createTestMaterial({ itemGroup: "Busa", ...o }); id[kunci] = m.id; return m; };
const busa = await mk("saldo10", { code: "BUSA-QA-10", name: "Busa QA saldo 10", unit: "KG", itemGroup: "Busa" }); await gerak(busa.id, "RECEIPT", 10);
await testPrisma.materialHargaBerlaku.create({ data: { materialId: busa.id, jenis: "HARGA", unitPrice: "36000", satuan: "KG", effectiveFrom: hari(2), createdAt: hari(2), reason: "Harga pilot QA", createdById: (await testPrisma.user.findFirst()).id, idempotencyKey: "qa-harga-busa" } });
await mk("belumCatatan", { code: "BUSA-QA-KOSONG", name: "Busa QA belum ada catatan", unit: "KG", itemGroup: "Busa" });
const gerakNol = await mk("nolPergerakan", { code: "KAIN-QA-NOL-GERAK", name: "Kain QA nol menurut pergerakan", unit: "METER", itemGroup: "Kain" }); await gerak(gerakNol.id, "RECEIPT", 5, hari(6)); await gerak(gerakNol.id, "ISSUE", -5, hari(5));
const verif = await mk("nolTerverifikasi", { code: "KAIN-QA-NOL-VERIF", name: "Kain QA nol terverifikasi hitung fisik", unit: "METER", itemGroup: "Kain" }); await gerak(verif.id, "RECEIPT", 3, hari(6)); await gerak(verif.id, "ISSUE", -3, hari(5));
const sc = await testPrisma.stockCount.create({ data: { countNumber: "CC-QA-0001", countType: "CYCLE_COUNT", countMethod: "BY_ITEM", status: "COMPLETED", completedAt: hari(1), createdById: (await testPrisma.user.findFirst()).id } });
await testPrisma.stockCountLine.create({ data: { stockCountId: sc.id, materialId: verif.id, systemQty: 0, countedQty: 0 } });
const minus = await mk("minus", { code: "PEGAS-QA-MINUS", name: "Pegas QA saldo minus", unit: "PCS", itemGroup: "Pegas" }); await gerak(minus.id, "RECEIPT", 2, hari(6)); await gerak(minus.id, "ISSUE", -5, hari(5));
const lem = await mk("terpesan", { code: "LEM-QA-TERPESAN", name: "Lem QA terpesan 8 dari 10", unit: "PCS", itemGroup: "Lem" }); await gerak(lem.id, "RECEIPT", 10);
await testPrisma.materialIssue.create({ data: { issueNumber: "MI-QA-1", sourceType: "MANUAL", status: "APPROVED", lines: { create: [{ materialId: lem.id, requestedQty: 8 }] } } });
await mk("saldo4", { code: "BUSA-QA-04", name: "Busa QA saldo 4 (untuk uji saldo bergeser)", unit: "KG", itemGroup: "Busa" }).then((m) => gerak(m.id, "RECEIPT", 4));
await mk("saldo6", { code: "BUSA-QA-06", name: "Busa QA saldo 6 (untuk HP)", unit: "KG", itemGroup: "Busa" }).then((m) => gerak(m.id, "RECEIPT", 6));
fs.writeFileSync(path.join(OUT, "ids.json"), JSON.stringify(id, null, 2));

const app = buildTestApp();
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.listen(PORT, "127.0.0.1", () => console.log(`[qa-koreksi] server siap di http://127.0.0.1:${PORT} — DB ${process.env.TEST_DATABASE_URL.split("/").pop()}`));
