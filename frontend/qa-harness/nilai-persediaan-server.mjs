// QA Nilai Persediaan — server backend ASLI (buildTestApp, tanpa penjadwal) di atas database TERISOLASI (nama wajib mengandung "test") dengan data uji deterministik.
//   TEST_DATABASE_URL=postgresql://klinik:...@localhost:5432/klinik_matras_test_nilai_qa JWT_SECRET=... PORT=4490 OUT=C:/tmp/nilai-qa node frontend/qa-harness/nilai-persediaan-server.mjs
// Menulis OUT/tokens.json dan OUT/ids.json. Tidak menyentuh production. Data uji, BUKAN data nyata.
import "../../backend/tests/integration/setup/env.js";
import fs from "node:fs"; import path from "node:path";
import { testPrisma, truncateAll } from "../../backend/tests/integration/setup/testDb.js";
import { createTestUser, createTestMaterial } from "../../backend/tests/integration/setup/fixtures.js";
import { buildTestApp } from "../../backend/tests/integration/setup/testApp.js";
import { ensureDefaultChartOfAccounts, resolveAccount, SYSTEM_KEYS } from "../../backend/src/services/finance/accounts.js";
import { postJournal } from "../../backend/src/services/finance/journal.js";

const PORT = Number(process.env.PORT || 4490); const OUT = process.env.OUT || "C:/tmp/nilai-qa"; fs.mkdirSync(OUT, { recursive: true });
await truncateAll(); await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
const hari = (n) => new Date(Date.now() - n * 86_400_000);
const gerak = (materialId, type, qty, createdAt = hari(5), extra = {}) => testPrisma.stockMovement.create({ data: { materialId, type, qty, note: "seed QA", createdAt, ...extra } });
let n = 0; const harga = (materialId, unitPrice, satuan, mulai = hari(3), extra = {}) => testPrisma.materialHargaBerlaku.create({ data: { materialId, unitPrice, satuan, effectiveFrom: mulai, createdAt: mulai, reason: "Harga uji QA", idempotencyKey: `qa-${++n}-${materialId}`, ...extra } });

const T = {};
for (const [k, roles, nama] of [["finance", ["FINANCE"], "Finance QA"], ["gudang", ["WAREHOUSE"], "Gudang QA"], ["owner", ["OWNER"], "Owner QA"], ["sales", ["SALES"], "Sales QA"]]) {
  const { user, token } = await createTestUser({ roles }); await testPrisma.user.update({ where: { id: user.id }, data: { name: nama } });
  T[k] = { token, user: { id: user.id, name: nama, email: user.email, role: roles[0], roles } };
}
fs.writeFileSync(path.join(OUT, "tokens.json"), JSON.stringify(T, null, 2));

const id = {}; const mk = async (kunci, o) => { const m = await createTestMaterial(o); id[kunci] = m.id; return m; };
// ── bahan dinilai (berbagai ukuran nilai), sebagian dari harga PO ──
const dinilai = [["BUSA-ROLL-QA", "Busa roll HR foam N44", "KG", 320.2, 36000], ["KAIN-KNIT-QA", "Kain knitting premium", "METER", 318.5, 35000], ["PLASTIK-PE-QA", "Plastik PE UK 240", "KG", 234.94, 37740], ["PE-ENC-QA", "PE encasement 195X19X4", "PCS", 325, 24601], ["LEM-QA", "Lem fox qbond putih", "KG", 23.5, 25000], ["COT-QA", "Cotton sheet 0,5", "ROLL", 12, 410000]];
for (const [kode, nama, unit, saldo, h] of dinilai) { const m = await mk(kode, { code: kode, name: nama, unit }); await gerak(m.id, "RECEIPT", saldo, hari(9), { unitCost: Math.round(h * 0.9) }); await harga(m.id, h, unit, hari(6)); }
const po = await mk("PO-QA", { code: "VEL-QA", name: "Velcro (harga dari PO, belum diterima)", unit: "METER" }); await gerak(po.id, "RECEIPT", 27, hari(8)); await harga(po.id, 5000, "METER", hari(1), { idempotencyKey: `po-harga:qa:${po.id}:r1`, reason: "Dari PO PO-QA-1 — belum diterima" });
// ── pengecualian ──
await mk("kosong1", { code: "BENANG-HALUS-QA", name: "Benang halus hitam 40/2", unit: "ROLL" }); await mk("kosong2", { code: "BENANG-KASAR-QA", name: "Benang kasar putih 20/2", unit: "ROLL" });
const hk = await mk("hargaKosong", { code: "RODA-QA", name: "Roda", unit: "PCS" }); await gerak(hk.id, "RECEIPT", 130, hari(8));
const hk2 = await mk("hargaKosong2", { code: "LAKBAN-QA", name: "Lakban", unit: "PCS" }); await gerak(hk2.id, "RECEIPT", 72, hari(8));
const mn = await mk("minus", { code: "LIST-WIBING-QA", name: "List wibing abu", unit: "ROLL" }); await gerak(mn.id, "RECEIPT", 15, hari(9)); await gerak(mn.id, "ISSUE", -390, hari(5)); await harga(mn.id, 94350, "ROLL", hari(6));
const st = await mk("satuan", { code: "KAIN-SATUAN-QA", name: "Kain tabeng (harga dalam ROLL, stok METER)", unit: "METER" }); await gerak(st.id, "RECEIPT", 50, hari(8)); await harga(st.id, 900000, "ROLL", hari(6));
const lava = await mk("lava", { code: "KAIN-LAVA-QA", name: "Kain Lava B-Grade", unit: "METER" }); await gerak(lava.id, "RECEIPT", 19, hari(9)); await gerak(lava.id, "ISSUE", -19, hari(5)); await harga(lava.id, 25641, "METER", hari(6));
const tab = await mk("tabeng", { code: "KAI-003-QA", name: "Kain Tabeng 3C Abu", unit: "METER" }); await gerak(tab.id, "RECEIPT", 122, hari(9)); await harga(tab.id, 35500, "METER", hari(6));
await testPrisma.finSetting.create({ data: { key: "nilai_persediaan_pengamatan_fisik", value: JSON.stringify([{ kode: "KAIN-LAVA-QA", teks: "13,5 ROLL" }, { kode: "KAI-003-QA", teks: "1 ROLL" }]) } });
const nol = await mk("nol", { code: "SUDUT-QA", name: "Sudut gold (habis)", unit: "PCS" }); await gerak(nol.id, "RECEIPT", 4, hari(9)); await gerak(nol.id, "ISSUE", -4, hari(4)); await harga(nol.id, 1000, "PCS", hari(6));
for (let i = 1; i <= 30; i++) { const m = await createTestMaterial({ code: `BELUM-QA-${String(i).padStart(2, "0")}`, name: `Bahan belum ada catatan ${i}`, unit: "PCS" }); if (i === 1) id.belumCatatan = m.id; }
// ── Finance: persediaan awal DRAFT (belum diposting) + jurnal penerimaan GR ──
await testPrisma.finInventoryOpening.create({ data: { number: "PSA-QA-001", cutoverDate: new Date("2026-10-01"), countedAt: new Date("2026-09-30T16:59:00Z"), status: "DRAFT" } });
await testPrisma.$transaction(async (tx) => { const p = await resolveAccount(tx, SYSTEM_KEYS.PERSEDIAAN_BAHAN); const u = await resolveAccount(tx, SYSTEM_KEYS.UTANG_BELUM_DITAGIH);
  for (const [i, nilai] of [[1, 18318000], [2, 7240000], [3, 5709000]]) await postJournal(tx, { date: hari(10 - i), description: `Penerimaan barang GR-QA-${i}`, source: "PENERIMAAN_BAHAN", sourceId: `gr-qa-${i}`, idempotencyKey: `qa-gr-${i}`, lines: [{ accountId: p.id, debit: nilai }, { accountId: u.id, credit: nilai }] }); });
fs.writeFileSync(path.join(OUT, "ids.json"), JSON.stringify(id, null, 2));

const app = buildTestApp(); app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/qa/hitung", async (req, res) => res.json({ stok: await testPrisma.stockMovement.count(), harga: await testPrisma.materialHargaBerlaku.count(), jurnal: await testPrisma.finJournalEntry.count(), gr: await testPrisma.goodsReceipt.count(), adj: await testPrisma.stockAdjustmentRequest.count(), opening: await testPrisma.finInventoryOpening.count(), setelan: await testPrisma.finSetting.count() }));
app.listen(PORT, "127.0.0.1", () => console.log(`[qa-nilai] server siap di http://127.0.0.1:${PORT} — DB ${process.env.TEST_DATABASE_URL.split("/").pop()}`));
