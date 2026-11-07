// QA drawer riwayat Stok — data CAMPURAN satuan lama/baru. Backend ASLI (buildTestApp) di atas DB sandbox "test"; bukan production. Transisi memakai kode produksi (terapkanTransisi).
import fs from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
const B = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../backend"); const imp = (p) => import(pathToFileURL(path.join(B, p)).href);
await imp("tests/integration/setup/env.js");
const { testPrisma, truncateAll } = await imp("tests/integration/setup/testDb.js");
const { createTestUser, createTestMaterial, seedBalance } = await imp("tests/integration/setup/fixtures.js");
const { buildTestApp } = await imp("tests/integration/setup/testApp.js");
const { ensureDefaultChartOfAccounts } = await imp("src/services/finance/accounts.js");
const { pratinjauTransisi, terapkanTransisi } = await imp("src/services/transisiSatuanBahan.js");
const PORT = Number(process.env.PORT || 4491); const OUT = process.env.OUT || "C:/tmp/rs-qa/out"; fs.mkdirSync(OUT, { recursive: true });
await truncateAll(); await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
const hari = (n) => new Date(Date.now() - n * 86_400_000);
const T = {};
for (const [k, roles, nama] of [["gudang", ["WAREHOUSE"], "Gudang Sandbox"], ["owner", ["OWNER"], "Owner Sandbox"]]) {
  const { user, token } = await createTestUser({ roles }); await testPrisma.user.update({ where: { id: user.id }, data: { name: nama } });
  T[k] = { token, user: { id: user.id, name: nama, email: user.email, role: roles[0], roles, divisions: k === "gudang" ? ["WAREHOUSE"] : [] } };
}
fs.writeFileSync(path.join(OUT, "tokens.json"), JSON.stringify(T, null, 2));
const HASH = "f5d08fab2c0b38a0b84ebbf712a1655723133af599c69b64b758a626f5033a9d";
// bahan bertransisi ROLL → METER (riwayat lama dalam ROLL, baru dalam METER)
const wib = await createTestMaterial({ code: "SBX-LIST-WIBING-PUTIH", name: "LIST WIBING PUTIH (sandbox)", unit: "ROLL", itemGroup: "LIST", referenceUnitCost: 100000, referenceUnitCostMonth: "2026-08" });
await seedBalance(wib.id, 14, { type: "RECEIPT", createdAt: hari(40), note: "Penerimaan awal (ROLL)" });
await seedBalance(wib.id, -2, { type: "ISSUE", createdAt: hari(30), note: "Pemakaian lama (ROLL)" });
await seedBalance(wib.id, -1.5, { type: "ISSUE", createdAt: hari(12), note: "Pemakaian lama (ROLL)" });
await seedBalance(wib.id, 3, { type: "RETURN", createdAt: hari(5), note: "Retur lama (ROLL)" });
const owner = { id: T.owner.user.id, name: T.owner.user.name, roles: ["OWNER"] };
const minta = { materialId: wib.id, satuanBaru: "METER", saldoBaru: 1350 };
const p = await pratinjauTransisi(testPrisma, { aktor: owner, transisi: [minta] }); if (!p.bolehDiterapkan) throw new Error("pratinjau: " + JSON.stringify(p.transisi[0].penghalang));
await terapkanTransisi(testPrisma, { aktor: owner, transisi: [{ ...minta, hashPratinjau: p.transisi[0].hash }], sumber: "SO sandbox", alasan: "Satuan mengikuti Excel SO (sandbox)", rujukanHash: HASH, kunci: "qa-tr-" + Date.now(), tautan: { soTanggal: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), sumber: "SO sandbox", alasan: "Tautan SO sandbox", rujukanHash: HASH } });
await seedBalance(wib.id, 900, { type: "RECEIPT", createdAt: new Date(), note: "Penerimaan baru (METER)" });
await seedBalance(wib.id, -45, { type: "ISSUE", createdAt: new Date(), note: "Pemakaian baru (METER)" });
// pembanding tanpa transisi
const kain = await createTestMaterial({ code: "SBX-KAIN-METER", name: "Kain Oscar (METER asli)", unit: "METER", itemGroup: "KAIN" });
await seedBalance(kain.id, 120, { type: "RECEIPT", createdAt: hari(10), note: "Penerimaan" }); await seedBalance(kain.id, -8, { type: "ISSUE", createdAt: hari(3), note: "Pemakaian" });
fs.writeFileSync(path.join(OUT, "ids.json"), JSON.stringify({ wib: wib.id, kain: kain.id }, null, 2));
const app = buildTestApp();
app.get("/qa/state", async (_q, r) => { const rows = await testPrisma.$queryRawUnsafe("select m.code, sm.type::text t, sm.qty::float qty, sm.unit_at_entry::text u from stock_movements sm join materials m on m.id = sm.material_id order by m.code, sm.created_at, sm.id"); r.json(rows); });
app.listen(PORT, "127.0.0.1", () => console.log(`[qa-satuan] siap di http://127.0.0.1:${PORT}`));
