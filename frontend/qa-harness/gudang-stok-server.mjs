// QA Redesain Gudang — Fase 2 Stok & Lokasi: server backend ASLI (buildTestApp, tanpa penjadwal) di atas database SANDBOX terisolasi (nama wajib mengandung "test"), data uji deterministik.
// Semua bahan berkode "SBX-…" = DATA SANDBOX. Keadaan yang tercakup: stok ada / menipis / terpesan penuh / nol menurut pergerakan / nol terverifikasi / minus / belum ada catatan, harga ada / belum ada / terjadwal,
// bahan nonaktif, belum dikelompokkan, nama & kode sangat panjang, satuan beragam (KG, METER, M3, PCS, PACK), presisi desimal (M3 0,152; KG 0,3333), dan >25 bahan agar halaman berikutnya ikut teruji
// (termasuk bahan minus yang SENGAJA berada di halaman terakhir).
//   TEST_DATABASE_URL=postgresql://klinik:…@localhost:5432/klinik_matras_test_gudang_stok_qa  JWT_SECRET=… PORT=4479 OUT=C:/tmp/gud-qa/stok node frontend/qa-harness/gudang-stok-server.mjs
// Rute /qa/* hanya ada di server uji ini (membaca DB untuk bukti: saldo, pergerakan, pengajuan koreksi, harga berlaku, jurnal).
import "../../backend/tests/integration/setup/env.js";
import fs from "node:fs"; import path from "node:path";
import { testPrisma, truncateAll } from "../../backend/tests/integration/setup/testDb.js";
import { createTestUser, createTestMaterial } from "../../backend/tests/integration/setup/fixtures.js";
import { buildTestApp } from "../../backend/tests/integration/setup/testApp.js";
import { ensureDefaultChartOfAccounts } from "../../backend/src/services/finance/accounts.js";

const PORT = Number(process.env.PORT || 4479); const OUT = process.env.OUT || "C:/tmp/gud-qa/stok";
fs.mkdirSync(OUT, { recursive: true });
await truncateAll();
await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
const hari = (n) => new Date(Date.now() - n * 86_400_000);
const gerak = (materialId, type, qty, createdAt = hari(5), note = "seed sandbox") => testPrisma.stockMovement.create({ data: { materialId, type, qty, note, createdAt } });

const T = {};
for (const [k, roles, nama] of [["gudang", ["WAREHOUSE"], "Gudang Sandbox"], ["owner", ["OWNER"], "Owner Sandbox"], ["finance", ["FINANCE"], "Finance Sandbox"], ["admin", ["ADMIN"], "Admin Sandbox"], ["sales", ["SALES"], "Sales Sandbox"], ["lihat", ["PRODUCTION_LEAD"], "Pemimpin Produksi Sandbox"]]) {
  const { user, token } = await createTestUser({ roles });
  await testPrisma.user.update({ where: { id: user.id }, data: { name: nama } });
  T[k] = { token, user: { id: user.id, name: nama, email: user.email, role: roles[0], roles, divisions: k === "gudang" ? ["WAREHOUSE"] : [] } };
}
fs.writeFileSync(path.join(OUT, "tokens.json"), JSON.stringify(T, null, 2));
const finId = T.finance.user.id;

const id = {};
const mk = async (kunci, kode, name, unit, itemGroup, extra = {}) => { const m = await createTestMaterial({ code: `SBX-${kode}`, name, unit, itemGroup, ...extra }); id[kunci] = m.id; return m; };
const harga = (materialId, satuan, nilai, { jadwalHari = 0, hariLalu = 3 } = {}) => {
  const t = jadwalHari ? new Date(Date.now() + jadwalHari * 86_400_000) : hari(hariLalu);
  return testPrisma.materialHargaBerlaku.create({ data: { materialId, jenis: "HARGA", unitPrice: String(nilai), satuan, effectiveFrom: t, createdAt: jadwalHari ? new Date() : t, reason: "Harga sandbox", createdById: finId, idempotencyKey: `sbx-${Math.random().toString(36).slice(2)}-${Date.now()}` } });
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
const des = await mk("desimalM3", "BUSA-M3", "Busa Lembaran Kubik", "M3", "BUSA"); await stokAda(des, 0.152, "M3", 1200000);
const des2 = await mk("desimalKg", "KG-3333", "Resin Cair Takaran", "KG", "LEM"); await stokAda(des2, 0.3333, "KG");
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
// ── Lainnya + belum dikelompokkan + nonaktif + nama panjang
await mk("belumKelompok", "CAMPUR-1", "Bahan campur sample", "PCS", null).then((m) => gerak(m.id, "RECEIPT", 3));
await mk("nonaktif", "LAMA-1", "Busa Lama (nonaktif)", "KG", "BUSA", { active: false }).then((m) => gerak(m.id, "RECEIPT", 2));
const panjang = await mk("panjang", "PANJANG-0123456789-ABCDEFGHIJ-KLMNOPQRSTUVWXYZ", "Busa Rebonded Super Padat Densitas 40 Premium Ekspor Edisi Khusus Lembaran Besar 200x200x10 cm Warna Abu-abu Kehijauan", "PCS", "REBONDED", { vendor: "PT Sumber Busa Sejahtera Makmur Abadi Jaya Sentosa Internasional" });
await gerak(panjang.id, "RECEIPT", 1234567.1234); await harga(panjang.id, "PCS", 1234567.89);
// ── Pengisi supaya ada lebih dari satu halaman (25 baris per halaman); satu bahan MINUS dan satu BELUM-DIKETAHUI sengaja di ujung daftar
for (let i = 1; i <= 38; i++) { const m = await mk(`paku${i}`, `PAKU-${String(i).padStart(2, "0")}`, `Paku ${i} cm`, "PACK", "PAKU"); await stokAda(m, 10 + i, "PACK", i % 4 === 0 ? 0 : 5000 + i * 100); }
const zMinus = await mk("zMinus", "ZZ-MINUS-AKHIR", "Zzz Bahan Minus Paling Akhir", "PACK", "PAKU"); await gerak(zMinus.id, "RECEIPT", 2, hari(9)); await gerak(zMinus.id, "ISSUE", -7, hari(6));
await mk("zBelum", "ZZ-BELUM-AKHIR", "Zzz Bahan Belum Diketahui Paling Akhir", "PACK", "PAKU");

fs.writeFileSync(path.join(OUT, "ids.json"), JSON.stringify(id, null, 2));
const app = buildTestApp();
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/qa/state", async (req, res) => {
  const mats = await testPrisma.material.findMany({ where: { code: { startsWith: "SBX-" } }, select: { id: true, code: true, name: true, unit: true, active: true, reorderPoint: true, reorderQty: true, category: true, serviceLine: true } });
  const gr = await testPrisma.stockMovement.findMany({ where: { materialId: { in: mats.map((m) => m.id) } }, select: { materialId: true, type: true, qty: true } });
  const stok = {}; for (const m of mats) { const mm = gr.filter((x) => x.materialId === m.id); stok[m.code] = { id: m.id, nama: m.name, satuan: m.unit, aktif: m.active, saldo: mm.reduce((a, x) => a + Number(x.qty), 0), gerakan: mm.length, reorderPoint: m.reorderPoint === null ? null : Number(m.reorderPoint), reorderQty: m.reorderQty === null ? null : Number(m.reorderQty), kategori: m.category, lini: m.serviceLine }; }
  const pengajuan = await testPrisma.stockAdjustmentRequest.findMany({ select: { id: true, status: true, materialId: true, beforeQty: true, adjustmentQty: true, reason: true, requestedById: true }, orderBy: { createdAt: "asc" } });
  const hargaRows = await testPrisma.materialHargaBerlaku.findMany({ where: { materialId: { in: mats.map((m) => m.id) } }, select: { materialId: true, unitPrice: true, satuan: true, reason: true, jenis: true, createdById: true }, orderBy: { createdAt: "asc" } }).catch(() => []);
  const jurnal = await testPrisma.finJournalEntry.count();
  res.json({ stok, bahanTotal: mats.length, pengajuan, harga: hargaRows.map((h) => ({ ...h, unitPrice: Number(h.unitPrice) })), jurnal, gerakanTotal: gr.length });
});
app.listen(PORT, "127.0.0.1", () => console.log(`[qa-stok] server siap di http://127.0.0.1:${PORT} — DB ${process.env.TEST_DATABASE_URL.split("/").pop()}`));
