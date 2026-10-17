// Menjalankan blok REHEARSAL (uji aplikasi pada salinan restore) dan SMOKE dari scripts/release-koreksi-dokumen.sh — kode Node yang sama persis yang akan jalan di produksi — terhadap DB terisolasi
// berisi dataset mirip produksi. Tujuan: skrip rilis tidak boleh pertama kali dieksekusi di produksi.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postPaymentReceived, postRevenueRecognition } from "../../src/services/finance/posting/orderRevenue.js";
import { recomputeOrderPaymentStatus } from "../../src/services/paymentLedger.js";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const skrip = fs.readFileSync(path.resolve(backend, "../scripts/release-koreksi-dokumen.sh"), "utf8").replace(/\r\n/g, "\n");
const blok = (pembuka, penutup) => { const a = skrip.indexOf(pembuka); assert.ok(a > 0, `pembuka ${pembuka} tidak ada`); const mulai = skrip.indexOf("\n", a) + 1; const b = skrip.indexOf(`\n${penutup}\n`, mulai); assert.ok(b > 0, `penutup ${penutup} tidak ada`); return skrip.slice(mulai, b); };

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const D = (s) => new Date(`${s}T00:00:00.000Z`);
const WIB = (s, jam = 10) => new Date(`${s}T${String(jam).padStart(2, "0")}:00:00.000+07:00`);
const hariIni = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const bulanIni = hariIni.slice(0, 7);
let seq = 0;

async function order(w, { nilai, status = "DELIVERED", bayar = null, serah = null, transisi = null, itemHarga = null, nomorSufiks = "" }) {
  seq += 1;
  const c = await testPrisma.customer.create({ data: { phone: `62814${String(Date.now()).slice(-6)}${seq}`, name: `Pelanggan Smoke ${seq}`, pipelineStage: "TRANSACTION" } });
  const o = await testPrisma.order.create({ data: { customerId: c.id, value: nilai, category: "LAYANAN", status, orderNumber: `RES-SM-${String(seq).padStart(3, "0")}${nomorSufiks}` } });
  await testPrisma.orderItem.create({ data: { orderId: o.id, layananName: "Paket Upgrade", harga: itemHarga ?? nilai, sortOrder: 0 } });
  if (bayar) {
    const p = await testPrisma.payment.create({ data: { orderId: o.id, amount: bayar, method: "TRANSFER", recordedById: w.admin.id, cashAccountId: w.bank.id, createdAt: WIB(`${bulanIni}-05`) } });
    await testPrisma.paymentVerification.create({ data: { paymentId: p.id, verifiedById: w.admin.id } });
    await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: p.id, userId: w.admin.id }));
    await testPrisma.$transaction((tx) => recomputeOrderPaymentStatus(tx, o.id));
  }
  if (serah) await testPrisma.job.create({ data: { type: "DELIVERY", orderId: o.id, status: "COMPLETED", scheduledDate: D(serah), completedAt: WIB(serah, 14), podStatus: "VERIFIED" } });
  if (transisi) await testPrisma.orderStatusTransition.create({ data: { orderId: o.id, fromStatus: "SHIPPING", toStatus: status, changedById: w.admin.id, createdAt: WIB(transisi, 9) } });
  return o;
}

async function datasetProduksiMini() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const a = await createTestUser({ roles: ["ADMIN"] }); await createTestUser({ roles: ["SALES"] }); await createTestUser({ roles: ["FINANCE"] });
  const w = { bank, admin: a.user };
  const tgl = `${bulanIni}-06`;
  // perlu keputusan x3 (dua cukup untuk periode tertutup & paralel), Rp0 + gap, riwayat pra-buku, order sudah diakui (tidak ikut)
  await order(w, { nilai: 1_500_000, bayar: 1_500_000, serah: tgl, transisi: tgl });
  await order(w, { nilai: 800_000, serah: `${bulanIni}-07`, transisi: `${bulanIni}-07` });
  await order(w, { nilai: 600_000, serah: `${bulanIni}-08`, transisi: `${bulanIni}-08` });
  const nol = await order(w, { nilai: 0, itemHarga: 0, serah: `${bulanIni}-09`, transisi: `${bulanIni}-09` });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: nol.id, userId: w.admin.id, date: D(`${bulanIni}-09`) }));
  await order(w, { nilai: 500_000, serah: "2026-08-10", transisi: "2026-08-10" });
  const sudah = await order(w, { nilai: 900_000, serah: `${bulanIni}-04` });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: sudah.id, userId: w.admin.id, date: D(`${bulanIni}-04`) }));
  // konflik atribusi: BBM (kategori → Delivery) tetapi dokumen Produksi
  const k = makeClient(server.baseUrl, a.token);
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "BBM" } });
  const e = await k.post("/api/finance/expenses", { date: `${bulanIni}-03`, amount: 70_000, description: "BBM smoke", categoryId: kat.id, division: "PRODUKSI", mode: "LANGSUNG", cashAccountId: bank.id, receiptUrl: "/media/finance-receipts/tes.jpg" });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  assert.equal((await k.post(`/api/finance/expenses/${e.body.id}/approve`, {})).status, 200);
}
function jalankan(kode, env = {}) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, ["--input-type=module", "-"], { cwd: backend, env: { ...process.env, ...env } });
    let out = ""; c.stdout.on("data", (d) => { out += d; }); c.stderr.on("data", (d) => { out += d; });
    const t = setTimeout(() => c.kill(), 170000);
    c.on("close", (kode2) => { clearTimeout(t); resolve({ kode: kode2, out }); });
    c.stdin.end(kode);
  });
}
const hitung = async (q) => Number((await testPrisma.$queryRawUnsafe(q))[0].n);

test("REHEARSAL (blok skrip rilis): uji aplikasi pada salinan — pengakuan sungguhan, harga Rp0, atribusi — lulus; semua pemeriksaan OK", async () => {
  await datasetProduksiMini();
  const kode = blok("<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\"", "REHNODE").split("/app/").join(`${pathToFileURL(backend).href}/`);
  const r = await jalankan(kode);
  assert.equal(r.kode, 0, r.out);
  assert.match(r.out, /PEMERIKSAAN=\d+ gagal=0/);
  assert.ok(!/^GAGAL/m.test(r.out), r.out);
  assert.ok((r.out.match(/^OK /gm) || []).length >= 14, r.out);
  assert.match(r.out, /pengakuan nyata RES-SM-\d+ .* dibuat/);
  assert.match(r.out, /paralel x4 .*tepat satu jurnal/);
  assert.match(r.out, /periode tertutup menolak/);
  assert.match(r.out, /keputusan: konflik dokumen itu hilang/);
});

test("SMOKE (blok skrip rilis): izin, penolakan tulis, parity SQL independen ↔ daftar ↔ laporan ↔ Excel, tanpa jejak tulis", async () => {
  await datasetProduksiMini();
  const kode = blok("<<'NODE' | tee \"$BK_DIR/smoke.log\" || die \"smoke test GAGAL\"", "NODE").split('const BASE = "http://127.0.0.1:4000";').join(`const BASE = "${server.baseUrl}";`);
  const env = {
    BASE_TIDAK_SEIMBANG: String(await hitung("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")),
    BASE_GANDA: "0", ORDER_N: String(await hitung('select count(*)::int n from "Order"')), JOB_N: String(await hitung("select count(*)::int n from jobs")),
    ENTRY_N: String(await hitung("select count(*)::int n from fin_journal_entries")), PENGAKUAN_N: String(await hitung("select count(*)::int n from fin_journal_entries where source::text='PENGAKUAN_PENDAPATAN'")),
  };
  const sebelum = { j: env.ENTRY_N, k: await hitung("select count(*)::int n from fin_attribution_decisions") };
  const r = await jalankan(kode, env);
  assert.equal(r.kode, 0, r.out);
  assert.match(r.out, /SMOKE_HASIL fail=0 skip=\d+/, r.out);
  assert.ok(!/FAIL /.test(r.out), r.out);
  assert.match(r.out, /DAFTAR YANG MASIH MENUNGGU BUKTI\/KEPUTUSAN OWNER/);
  assert.match(r.out, /PERLU_KEPUTUSAN RES-SM-/);
  assert.match(r.out, /pratinjau pengakuan RES-SM-\d+ \(di-rollback\)/);
  assert.equal(String(await hitung("select count(*)::int n from fin_journal_entries")), sebelum.j, "smoke tidak menulis jurnal (pratinjau di-rollback)");
  assert.equal(await hitung("select count(*)::int n from fin_attribution_decisions"), sebelum.k);
  assert.equal(await hitung("select count(*)::int n from activity_events where metadata->>'aksi' like 'KOREKSI_%' or metadata->>'aksi' like 'KEPUTUSAN_%' or metadata->>'aksi' like 'TETAPKAN_%'"), 0);
});

test("SMOKE gagal keras bila smoke menemukan jejak tulis palsu atau parity rusak (pengaman tidak ikut lolos diam-diam)", async () => {
  await datasetProduksiMini();
  const kode = blok("<<'NODE' | tee \"$BK_DIR/smoke.log\" || die \"smoke test GAGAL\"", "NODE").split('const BASE = "http://127.0.0.1:4000";').join(`const BASE = "${server.baseUrl}";`);
  // jurnal tidak seimbang baseline dipalsukan (-1) → pemeriksaan invarian harus gagal
  const r = await jalankan(kode, { BASE_TIDAK_SEIMBANG: "-1", BASE_GANDA: "0", ORDER_N: "0", JOB_N: "0", ENTRY_N: "0", PENGAKUAN_N: "0" });
  assert.notEqual(r.kode, 0, r.out);
  assert.match(r.out, /FAIL/);
});
