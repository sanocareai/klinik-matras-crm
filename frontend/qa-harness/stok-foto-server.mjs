// QA FOTO BAHAN (turunan stok-redesign-server.mjs; foto disajikan oleh router produksi /api/inventory/foto-bahan lewat buildTestApp, bertanda-tangan) — QA Redesain Stok & Lokasi — server backend ASLI (buildTestApp, tanpa penjadwal) di atas database SANDBOX terisolasi
// SEMUA bahan berkode "SBX-…" = DATA SANDBOX (bukan transaksi/produksi). Mencakup: stok ada / menipis / terpesan penuh / nol menurut pergerakan / nol terverifikasi / minus / belum ada catatan,
// harga ada / belum ada / terjadwal, bahan nonaktif, belum dikelompokkan, dan >25 bahan agar halaman berikutnya ikut teruji.
//   TEST_DATABASE_URL=postgresql://klinik:klinik123@localhost:55443/km_stok_redesign_qa_test JWT_SECRET=… PORT=4010 OUT=C:/tmp/km-stok-redesign-qa node frontend/qa-harness/stok-redesign-server.mjs
import "../../backend/tests/integration/setup/env.js";
import fs from "node:fs"; import path from "node:path";
import { testPrisma, truncateAll } from "../../backend/tests/integration/setup/testDb.js";
import { createTestUser, createTestMaterial } from "../../backend/tests/integration/setup/fixtures.js";
import { buildTestApp } from "../../backend/tests/integration/setup/testApp.js";

const PORT = Number(process.env.PORT || 4010); const OUT = process.env.OUT || "C:/tmp/km-stok-redesign-qa";
fs.mkdirSync(OUT, { recursive: true });
await truncateAll();
const hari = (n) => new Date(Date.now() - n * 86_400_000);
const gerak = (materialId, type, qty, createdAt = hari(5), note = "seed sandbox") => testPrisma.stockMovement.create({ data: { materialId, type, qty, note, createdAt } });

const T = {};
for (const [k, roles, nama] of [["owner", ["OWNER"], "Owner Sandbox"], ["owner2", ["OWNER"], "Owner Kedua Sandbox"], ["gudang", ["WAREHOUSE"], "Gudang Sandbox"], ["finance", ["FINANCE"], "Finance Sandbox"], ["admin", ["ADMIN"], "Admin Sandbox"], ["sales", ["SALES"], "Sales Sandbox"]]) {
  const { user, token } = await createTestUser({ roles });
  await testPrisma.user.update({ where: { id: user.id }, data: { name: nama } });
  T[k] = { token, user: { id: user.id, name: nama, email: user.email, role: roles[0], roles } };
}
fs.writeFileSync(path.join(OUT, "tokens.json"), JSON.stringify(T, null, 2));
const finId = T.finance.user.id;

const id = {};
const mk = async (kunci, kode, name, unit, itemGroup, extra = {}) => { const m = await createTestMaterial({ code: `SBX-${kode}`, name, unit, itemGroup, ...extra }); id[kunci] = m.id; return m; };
const harga = (materialId, satuan, nilai, { jadwalHari = 0, hariLalu = 3 } = {}) => {
  const t = jadwalHari ? new Date(Date.now() + jadwalHari * 86_400_000) : hari(hariLalu);
  return testPrisma.materialHargaBerlaku.create({ data: { materialId, jenis: "HARGA", unitPrice: String(nilai), satuan, effectiveFrom: t, createdAt: jadwalHari ? new Date() : t, reason: "Harga sandbox", createdById: finId, idempotencyKey: `sbx-${materialId}-${nilai}-${jadwalHari}` } });
};
const stokAda = async (m, qty, satuan, nilaiHarga, extra = {}) => { await gerak(m.id, "RECEIPT", qty); if (nilaiHarga) await harga(m.id, satuan, nilaiHarga, extra); };

// ── Busa
const n44 = await mk("n44", "HR-N44", "Busa HR Foam N44", "KG", "HR FOAM", { vendor: "PT Busa Nusantara", reorderPoint: 20 }); await stokAda(n44, 50, "KG", 36000);
const kulit = await mk("kulit", "HR-KULIT", "Busa HR Foam Kulit", "KG", "HR FOAM", { vendor: "PT Busa Nusantara" }); await stokAda(kulit, 24, "KG", 34000);
const reb = await mk("nolVerif", "REB-120", "Busa Rebonded 120", "KG", "REBONDED"); await gerak(reb.id, "RECEIPT", 6, hari(8)); await gerak(reb.id, "ISSUE", -6, hari(7)); await harga(reb.id, "KG", 18000);
const sc = await testPrisma.stockCount.create({ data: { countNumber: "CC-SBX-0001", countType: "CYCLE_COUNT", countMethod: "BY_ITEM", status: "COMPLETED", completedAt: hari(1), createdById: finId } });
await testPrisma.stockCountLine.create({ data: { stockCountId: sc.id, materialId: reb.id, systemQty: 0, countedQty: 0 } });
await mk("belumCatatan", "SOFT-D23", "Soft Foam D23", "KG", "SOFT FOAM"); // tanpa pergerakan, tanpa harga
const latex = await mk("minus", "LATEX-7", "Busa Latex 7 cm", "M3", "BUSA LATEX"); await gerak(latex.id, "RECEIPT", 1, hari(9)); await gerak(latex.id, "ISSUE", -3, hari(6));
const mem = await mk("menipis", "MEMORY", "Memory Foam Premium", "KG", "MEMORY FOAM", { reorderPoint: 20, vendor: "CV Lelap" }); await stokAda(mem, 8, "KG", 52000);
// ── Kain
const span = await mk("spanbon", "SPANBON-75", "Spanbon 75 gram", "METER", "SPUNBON", { vendor: "Toko Kain Jaya" }); await stokAda(span, 291, "METER", 6700);
const oscar = await mk("oscar", "OSCAR-BLACK", "Kain Oscar Proton Black", "METER", "KAIN"); await stokAda(oscar, 18, "METER", 27000);
const knit = await mk("nolGerak", "KNIT-ABU", "Kain Knitting Abu", "METER", "KAIN KNITTING"); await gerak(knit.id, "RECEIPT", 4, hari(9)); await gerak(knit.id, "ISSUE", -4, hari(5));
await mk("hargaJadwal", "KNIT-HIJAU", "Kain Knitting Hijau", "METER", "KAIN KNITTING").then(async (m) => { await gerak(m.id, "RECEIPT", 30); await harga(m.id, "METER", 31000, { jadwalHari: 3 }); });
// ── Pegas, lem, kayu, aksesori
const bon = await mk("bonnel", "BONNEL-22", "Per Bonnel 2,2 mm", "PCS", "PER BONNEL", { vendor: "PT Pegas Prima" }); await stokAda(bon, 400, "PCS", 1800);
const lem = await mk("terpesan", "LEM-AIBON", "Lem Aibon 5 kg", "PCS", "LEM"); await stokAda(lem, 5, "PCS", 185000);
await testPrisma.materialIssue.create({ data: { issueNumber: "MI-SBX-1", sourceType: "MANUAL", status: "APPROVED", lines: { create: [{ materialId: lem.id, requestedQty: 5 }] } } });
const kayu = await mk("kayu", "RACUK-3X5", "Kayu Racuk 3x5", "PCS", "KAYU RACUK"); await stokAda(kayu, 60, "PCS", 24000);
const webing = await mk("webing", "WEBING-5", "Webing 5 cm", "ROLL", "WEBING"); await stokAda(webing, 14, "ROLL", 95000);
// ── Lainnya + belum dikelompokkan
const pe = await mk("pe", "PE-ENC-195", "PE Encasement 195×190×4", "PCS", "PE"); await stokAda(pe, 12, "PCS", 24601);
await mk("guard", "SANO-GUARD-150", "SANO GUARD 150×190×4", "PCS", "COVER KASUR", { vendor: "Internal" }).then((m) => harga(m.id, "PCS", 101000)); // belum ada catatan stok, ada harga
await mk("belumKelompok", "CAMPUR-1", "Bahan campur sample", "PCS", null).then((m) => gerak(m.id, "RECEIPT", 3));
await mk("nonaktif", "LAMA-1", "Busa Lama (nonaktif)", "KG", "BUSA", { active: false }).then((m) => gerak(m.id, "RECEIPT", 2));
// ── Pengisi supaya ada lebih dari satu halaman (25 baris per halaman)
for (let i = 1; i <= 38; i++) { const m = await mk(`paku${i}`, `PAKU-${String(i).padStart(2, "0")}`, `Paku ${i} cm`, "PACK", "PAKU"); await stokAda(m, 10 + i, "PACK", i % 4 === 0 ? 0 : 5000 + i * 100); }

fs.writeFileSync(path.join(OUT, "ids.json"), JSON.stringify(id, null, 2));
const app = buildTestApp();
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.listen(PORT, "127.0.0.1", () => console.log(`[qa-stok] server siap di http://127.0.0.1:${PORT} — DB ${process.env.TEST_DATABASE_URL.split("/").pop()}`));
