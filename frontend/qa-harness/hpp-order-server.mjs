// QA HPP per Order — server backend ASLI (buildTestApp) di atas database TERISOLASI (nama wajib mengandung "test") + data uji deterministik. Tidak menyentuh production.
//   TEST_DATABASE_URL=postgresql://klinik:...@localhost:5432/km_hppqa_test JWT_SECRET=... PORT=4031 OUT=C:/tmp/km-hpp-qa node frontend/qa-harness/hpp-order-server.mjs
// Peran (keputusan Owner 10 Nov): non-ADMIN (operator, Production Lead) mencatat → menunggu verifikasi ADMIN; hanya ADMIN yang langsung berlaku. Finance tidak memverifikasi.
// Dunia: bahan bertaut SO (H-4) KAIN-QA (harga 15.000; berubah 16.000 pukul 13:00 WIB pada H-6), BENANG-QA tanpa harga. Empat unit terkirim H-1:
//   QA-001 belum ada pemakaian · QA-002 biaya disetujui (siap dikonfirmasi) · QA-003 biaya PERLU_KEPUTUSAN harga (menunggu) · QA-004 tanpa harga (biaya kosong).
// Menulis OUT/tokens.json dan OUT/ids.json.
import "../../backend/tests/integration/setup/env.js";
import fs from "node:fs"; import path from "node:path"; import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "../../backend/tests/integration/setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "../../backend/tests/integration/setup/fixtures.js";
import { buildTestApp } from "../../backend/tests/integration/setup/testApp.js";
import { tautkanSO } from "../../backend/src/services/pengamanHistorisPascaSO.js";
import { ensureDefaultChartOfAccounts } from "../../backend/src/services/finance/accounts.js";
import { setSetting, SETTING_KEYS } from "../../backend/src/services/finance/settings.js";
import { postJournal } from "../../backend/src/services/finance/journal.js";
import { postRevenueRecognition } from "../../backend/src/services/finance/posting/orderRevenue.js";
import { ajukanBiayaTanpaStok, setujuiBiayaTanpaStok } from "../../backend/src/services/finance/hppOrder.js";

const PORT = Number(process.env.PORT || 4031); const OUT = process.env.OUT || "C:/tmp/km-hpp-qa";
fs.mkdirSync(OUT, { recursive: true });
await truncateAll();
const HARI = 86_400_000;
const H = (n) => new Date(Date.now() + 7 * 3600_000 - n * HARI).toISOString().slice(0, 10);
const WIB = (t, jam = "10:00") => new Date(`${t}T${jam}:00+07:00`);
const k = () => `qa-hpp-${randomUUID()}`;
await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
await setSetting(testPrisma, SETTING_KEYS.SALDO_AWAL_CUTOFF, "2026-01-01");

const T = {}; const A = {};
for (const [kunci, roles, nama] of [["pic", ["PRODUCTION_LEAD"], "PIC Produksi QA"], ["operator", ["PRODUCTION_WORKER"], "Operator QA"], ["finance", ["FINANCE"], "Finance QA"], ["owner", ["OWNER"], "Owner QA"], ["sales", ["SALES"], "Sales QA"], ["admin", ["ADMIN"], "Admin Produksi QA"]]) {
  const { user, token } = await createTestUser({ roles });
  await testPrisma.user.update({ where: { id: user.id }, data: { name: nama } });
  T[kunci] = { token, user: { id: user.id, name: nama, email: user.email, role: roles[0], roles } }; A[kunci] = { id: user.id, name: nama, roles };
}
fs.writeFileSync(path.join(OUT, "tokens.json"), JSON.stringify(T, null, 2));

const kain = await createTestMaterial({ code: "KAIN-QA", name: "Kain QA bertaut SO", unit: "METER" });
const benang = await createTestMaterial({ code: "BENANG-QA", name: "Benang QA tanpa harga", unit: "PCS" });
for (const m of [kain, benang]) await seedBalance(m.id, 50, { createdAt: WIB(H(40)) });
await testPrisma.materialHargaBerlaku.create({ data: { materialId: kain.id, unitPrice: "15000", satuan: "METER", effectiveFrom: WIB(H(30), "00:00"), createdAt: WIB(H(30), "00:00"), reason: "harga QA", idempotencyKey: k() } });
await testPrisma.materialHargaBerlaku.create({ data: { materialId: kain.id, unitPrice: "16000", satuan: "METER", effectiveFrom: WIB(H(6), "13:00"), createdAt: WIB(H(6), "13:00"), reason: "harga naik siang QA", idempotencyKey: k() } });
for (const m of [kain, benang]) await tautkanSO(testPrisma, { aktor: A.finance, materialId: m.id, soTanggal: H(4), sumber: "SO QA", alasan: "SO bahan QA ditautkan untuk uji", rujukanHash: "46cd9bcd0d763d9e5a2661d431ed998042257bb9eedc69eb9c1614cb5111a356", kunci: k() });

const id = { kain: kain.id, benang: benang.id, H6: H(6), H7: H(7), H8: H(8) };
const mk = async (no) => {
  const { order, unit } = await createTestUnit({ status: "DELIVERED" });
  await testPrisma.order.update({ where: { id: order.id }, data: { orderNumber: no, status: "DELIVERED", value: 2_000_000, category: "LAYANAN" } });
  await testPrisma.unit.update({ where: { id: unit.id }, data: { createdAt: WIB(H(20)), unitCode: `${no}-U1` } });
  const job = await testPrisma.job.create({ data: { type: "DELIVERY", orderId: order.id, status: "COMPLETED", completedAt: WIB(H(1), "15:00") } });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  return { order, unit };
};
const u = {};
for (const no of ["RES-QA-001", "RES-QA-002", "RES-QA-003", "RES-QA-004", "RES-QA-005"]) { u[no] = await mk(no); id[no] = u[no].unit.id; }
const dasar = (unitId, o) => ({ unitId, materialId: kain.id, qty: 2, tanggalPemakaian: H(8), sumberJenis: "LAPORAN_PIC", bukti: "Buku kerja meja 2 (QA)", alasan: "Pemakaian sebelum SO belum tercatat", ...o });
const e2 = await ajukanBiayaTanpaStok(testPrisma, A.operator, dasar(id["RES-QA-002"], { sumberRef: "lap pic qa 002" }), { kunci: k() });
await setujuiBiayaTanpaStok(testPrisma, A.admin, { id: e2.entri.id });
const e3 = await ajukanBiayaTanpaStok(testPrisma, A.operator, dasar(id["RES-QA-003"], { tanggalPemakaian: H(6), sumberRef: "lap pic qa 003" }), { kunci: k() }); id.entriKeputusan = e3.entri.id;
const e4 = await ajukanBiayaTanpaStok(testPrisma, A.operator, dasar(id["RES-QA-004"], { materialId: benang.id, qty: 3, sumberRef: "lap pic qa 004" }), { kunci: k() });
await setujuiBiayaTanpaStok(testPrisma, A.admin, { id: e4.entri.id });

// Jurnal untuk laporan: pengakuan pendapatan 2 order, upah, selisih opname sebelum & sesudah SO, pembelian langsung.
const akun = async (c) => (await testPrisma.finAccount.findFirst({ where: { code: c } })).id; const kas = await akun("1-1100");
for (const no of ["RES-QA-001", "RES-QA-002"]) await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: u[no].order.id, userId: A.finance.id, date: H(1) }));
const jur = (kode, nilai, tanggal = H(1)) => testPrisma.$transaction(async (tx) => postJournal(tx, { date: tanggal, description: `QA ${kode}`, source: "MANUAL", idempotencyKey: k(), userId: A.finance.id, lines: [{ accountId: await akun(kode), debit: nilai, description: "QA" }, { accountId: kas, credit: nilai, description: "QA" }] }));
await jur("5-1200", 300000); await jur("5-1960", 999999, H(5)); await jur("5-1960", 40000); await jur("5-1150", 70000);
fs.writeFileSync(path.join(OUT, "ids.json"), JSON.stringify(id, null, 2));

const app = buildTestApp();
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.listen(PORT, "127.0.0.1", () => console.log(`[qa-hpp] server siap di http://127.0.0.1:${PORT} — DB ${process.env.TEST_DATABASE_URL.split("/").pop()}`));
