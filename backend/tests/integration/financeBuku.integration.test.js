// Read-model BUKU (Finance Mobile S9): jurnal (indikator seimbang, dokumen terkait, audit trail), buku besar (saldo awal + saldo berjalan dari server,
// identik dengan endpoint laporan lama), dan rekonsiliasi bank (saldo buku/koran/selisih, kandidat, cocokkan/lepas dengan row lock, tolak pasangan ganda,
// audit trail). Lewat endpoint ASLI dengan token mobile & peran sungguhan.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw, DEVICE } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postJournal } from "../../src/services/finance/journal.js";
import { toMoney } from "../../src/services/finance/money.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";

let server;
let raw;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); raw = makeRaw(server.baseUrl); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function masuk(roles) {
  const u = await createLoginUser({ roles });
  const r = await raw("POST", "/api/mobile/auth/login", { body: { email: u.email, password: u.password, device: DEVICE() } });
  assert.equal(r.status, 200, `${roles} → ${JSON.stringify(r.body)}`);
  return { ...u, token: r.body.accessToken };
}
const kunci = () => ({ "Idempotency-Key": randomUUID() });
const get = (u, path) => raw("GET", `/api/finance${path}`, { token: u.token });
const post = (u, path, body) => raw("POST", `/api/finance${path}`, { token: u.token, headers: kunci(), body: body ?? {} });

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "KEM Bank", kind: "BANK", accountId: akunBank.id } });
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Kas Kantor", kind: "KAS", accountId: akunKas.id } });
  await setSetting(testPrisma, SETTING_KEYS.CASH_ACCOUNT_CASH, kas.id);
  const modal = await testPrisma.finAccount.findFirst({ where: { code: "3-1100" } });
  const admin = await testPrisma.user.create({ data: { name: "Admin Seed", email: `seed-${Date.now()}@example.test`, passwordHash: "x", role: "ADMIN" } });
  const jurnal = (tanggal, no, baris) => testPrisma.$transaction((tx) => postJournal(tx, { date: new Date(`${tanggal}T00:00:00Z`), description: `Seed ${no}`, source: "SALDO_AWAL", idempotencyKey: `SEED:${no}:${Date.now()}`, userId: admin.id, lines: baris }));
  await jurnal("2025-12-20", "modal-2025", [{ accountId: akunBank.id, cashAccountId: bank.id, debit: toMoney(20_000_000) }, { accountId: modal.id, credit: toMoney(20_000_000) }]);
  await jurnal("2026-09-01", "modal-2026", [{ accountId: akunBank.id, cashAccountId: bank.id, debit: toMoney(30_000_000) }, { accountId: modal.id, credit: toMoney(30_000_000) }]);
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "SERVIS_KENDARAAN" } });
  return { bank, kas, kat, akunBank, modal, admin };
}

async function bayarPengeluaran(fin, approver, { bank, kat }, nominal, tanggal, ket) {
  const dok = await post(fin, "/expenses", { description: ket, amount: nominal, categoryId: kat.id, mode: "LANGSUNG", cashAccountId: bank.id, date: tanggal });
  assert.equal(dok.status, 201, JSON.stringify(dok.body));
  await testPrisma.finExpense.update({ where: { id: dok.body.id }, data: { receiptUrl: "/media/finance-receipts/ab12.jpg" } });
  const ok = await post(approver, `/expenses/${dok.body.id}/approve`);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  return dok.body;
}

test("Jurnal: daftar (periode, cari, sumber, status, akun), seimbang, dokumen terkait, balik, paginasi; fixture TIDAK seimbang terdeteksi; detail beraudit", async () => {
  const s = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const approver = await masuk(["APPROVER"]);
  const dok = await bayarPengeluaran(fin, approver, s, "200000", "2026-09-10", "Servis truk");
  const jurnalDok = await testPrisma.finJournalEntry.findFirst({ where: { source: "PENGELUARAN", sourceId: dok.id } });

  const l = (await get(fin, "/buku/jurnal?from=2026-09-01&to=2026-09-30")).body;
  assert.equal(l.total, 2);
  const it = l.items.find((x) => x.id === jurnalDok.id);
  assert.equal(it.totalDebit, "200000.00");
  assert.equal(it.totalKredit, "200000.00");
  assert.equal(it.seimbang, true);
  assert.equal(it.selisih, "0.00");
  assert.deepEqual(it.dokumen, { modul: "pengeluaran", id: dok.id, nomor: dok.expenseNumber }, "dokumen sumber terhubung ke modul S6");
  assert.equal(it.sumber, "PENGELUARAN");
  assert.equal(l.tidakSeimbang, 0);
  assert.equal(l.hitung.POSTED, 2);

  // Filter: sumber, cari (nomor/keterangan/nominal), akun, periode lintas tahun
  assert.equal((await get(fin, "/buku/jurnal?source=PENGELUARAN")).body.total, 1);
  assert.equal((await get(fin, `/buku/jurnal?q=${jurnalDok.entryNumber}`)).body.total, 1);
  assert.equal((await get(fin, "/buku/jurnal?q=servis")).body.total, 1);
  assert.equal((await get(fin, "/buku/jurnal?q=200.000")).body.total, 1, "kata angka dicocokkan ke nominal baris");
  assert.equal((await get(fin, `/buku/jurnal?akunId=${s.akunBank.id}&from=2025-12-01&to=2026-09-30`)).body.total, 3, "lintas tahun, semua jurnal yang menyentuh Bank");
  assert.equal((await get(fin, "/buku/jurnal?from=2025-12-01&to=2025-12-31")).body.total, 1, "periode tahun lalu");
  assert.equal((await get(fin, "/buku/jurnal?from=2026-01-01&to=2026-08-31")).body.total, 0);
  assert.equal((await get(fin, "/buku/jurnal?limit=1&page=2")).body.items.length, 1);
  assert.equal((await get(fin, "/buku/jurnal?limit=1&page=3")).body.adaLagi, false);

  // Pembalikan: jurnal balik menautkan keduanya
  const { reverseJournal } = await import("../../src/services/finance/journal.js");
  const admin = await testPrisma.user.findFirst({ where: { name: "Admin Seed" } });
  await testPrisma.$transaction((tx) => reverseJournal(tx, { entryId: jurnalDok.id, reason: "salah input", userId: admin.id }));
  const setelah = (await get(fin, "/buku/jurnal?from=2026-09-01&to=2026-09-30")).body;
  const asli = setelah.items.find((x) => x.id === jurnalDok.id);
  assert.equal(asli.status, "REVERSED");
  assert.ok(asli.dibalikOleh?.nomor);
  const balik = setelah.items.find((x) => x.membalik?.id === jurnalDok.id);
  assert.equal(balik.sumber, "REVERSAL");
  assert.equal(balik.seimbang, true);
  assert.equal(setelah.hitung.REVERSED, 1);

  // FIXTURE tidak seimbang (lewat jalur di luar postJournal — keadaan darurat yang HARUS terdeteksi)
  const timpang = await testPrisma.finJournalEntry.create({
    data: { entryNumber: "JV-TIMPANG-001", date: new Date("2026-09-15T00:00:00Z"), description: "Fixture timpang", source: "MANUAL", status: "POSTED", postedAt: new Date(),
      lines: { create: [{ lineNo: 1, accountId: s.akunBank.id, debit: 100000, credit: 0 }, { lineNo: 2, accountId: s.modal.id, debit: 0, credit: 70000 }] } },
  });
  const l2 = (await get(fin, "/buku/jurnal?from=2026-09-01&to=2026-09-30")).body;
  const t = l2.items.find((x) => x.id === timpang.id);
  assert.equal(t.seimbang, false);
  assert.equal(t.selisih, "30000.00");
  assert.equal(l2.tidakSeimbang, 1);
  const dt = (await get(fin, `/buku/jurnal/${timpang.id}`)).body;
  assert.equal(dt.seimbang, false);
  assert.match(dt.catatan, /TIDAK seimbang/);
  assert.equal(dt.baris.length, 2);

  // Detail jurnal normal: baris beraturan, akun, audit trail
  const d = (await get(fin, `/buku/jurnal/${jurnalDok.id}`)).body;
  assert.equal(d.baris.length, 2);
  assert.ok(d.baris.every((b) => /^\d+\.\d{2}$/.test(b.debit) && /^\d+\.\d{2}$/.test(b.kredit)));
  assert.equal(d.alasanBalik, "salah input");
  assert.ok(d.riwayat.some((r) => r.label === "Dibuat"));
  assert.ok(d.riwayat.some((r) => /Dibalik oleh/.test(r.label)));
  assert.equal((await get(fin, `/buku/jurnal/${randomUUID()}`)).status, 404);
});

test("Buku besar: saldo awal + saldo berjalan dari server, identik dengan endpoint laporan lama; saldo negatif utuh; akun tanpa mutasi; lintas tahun; paginasi", async () => {
  const s = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const approver = await masuk(["APPROVER"]);
  await bayarPengeluaran(fin, approver, s, "200000", "2026-09-10", "A");
  await bayarPengeluaran(fin, approver, s, "300000", "2026-09-12", "B");
  await bayarPengeluaran(fin, approver, s, "50500.50", "2026-09-15", "C");

  const url = `/buku/akun/${s.akunBank.id}/mutasi?from=2026-09-01&to=2026-09-30`;
  const bb = (await get(fin, url)).body;
  assert.equal(bb.saldoAwal, "20000000.00", "saldo awal = mutasi sebelum periode (2025)");
  assert.equal(bb.total, 4);
  assert.deepEqual(bb.baris.map((b) => b.saldo), ["50000000.00", "49800000.00", "49500000.00", "49449499.50"]);
  assert.equal(bb.saldoAkhir, "49449499.50");
  assert.equal(bb.totalDebit, "30000000.00");
  assert.equal(bb.totalKredit, "550500.50");

  // Identik dengan endpoint laporan yang dipakai web untuk periode yang sama
  const lama = (await get(fin, `/reports/ledger/${s.akunBank.id}?from=2026-09-01&to=2026-09-30`)).body;
  assert.equal(uang2(lama.saldoAwal), bb.saldoAwal);
  assert.equal(uang2(lama.saldoAkhir), bb.saldoAkhir);
  assert.deepEqual(lama.baris.map((b) => uang2(b.saldo)), bb.baris.map((b) => b.saldo));

  // Paginasi: saldo berjalan tetap benar di halaman ke-2
  const h2 = (await get(fin, `${url}&limit=2&page=2`)).body;
  assert.equal(h2.baris.length, 2);
  assert.equal(h2.baris[0].saldo, "49500000.00");
  assert.equal(h2.adaLagi, false);
  assert.equal((await get(fin, `${url}&limit=2&page=1`)).body.adaLagi, true);

  // Lintas tahun: dari Des 2025 → saldo awal 0, satu mutasi Des 2025
  const lt = (await get(fin, `/buku/akun/${s.akunBank.id}/mutasi?from=2025-12-01&to=2026-09-30`)).body;
  assert.equal(lt.saldoAwal, "0.00");
  assert.equal(lt.total, 5);
  assert.equal(lt.saldoAkhir, "49449499.50");

  // Saldo NEGATIF tampil utuh: rekening kas tanpa modal lalu dibayar keluar
  const bankKas = await testPrisma.finCashAccount.findFirst({ where: { name: "Kas Kantor" } });
  const dok = await post(fin, "/expenses", { description: "Tekor", amount: "70000", categoryId: s.kat.id, mode: "LANGSUNG", cashAccountId: bankKas.id, date: "2026-09-16" });
  await testPrisma.finExpense.update({ where: { id: dok.body.id }, data: { receiptUrl: "/media/finance-receipts/ab12.jpg" } });
  await post(approver, `/expenses/${dok.body.id}/approve`);
  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const neg = (await get(fin, `/buku/akun/${akunKas.id}/mutasi?from=2026-09-01&to=2026-09-30`)).body;
  assert.equal(neg.saldoAkhir, "-70000.00", "negatif tidak dipotong menjadi nol");
  assert.equal(neg.baris[0].saldo, "-70000.00");

  // Akun tanpa mutasi
  const kosong = await testPrisma.finAccount.findFirst({ where: { code: "6-1900" } });
  const nol = (await get(fin, `/buku/akun/${kosong.id}/mutasi?from=2026-01-01&to=2026-12-31`)).body;
  assert.equal(nol.total, 0);
  assert.equal(nol.saldoAwal, nol.saldoAkhir);
  assert.deepEqual(nol.baris, []);

  // Validasi
  assert.equal((await get(fin, `/buku/akun/${s.akunBank.id}/mutasi`)).status, 400, "periode wajib");
  assert.equal((await get(fin, `/buku/akun/${s.akunBank.id}/mutasi?from=2026-10-01&to=2026-09-01`)).status, 400);
  assert.equal((await get(fin, `/buku/akun/${randomUUID()}/mutasi?from=2026-09-01&to=2026-09-30`)).status, 404);
  const pil = (await get(fin, "/buku/akun?q=bank")).body.akun;
  assert.ok(pil.some((a) => a.id === s.akunBank.id));
});
const uang2 = (v) => Number(v).toFixed(2);

test("Rekonsiliasi: saldo buku/koran/selisih, kandidat nominal sama, cocokkan/lepas (double-tap & paralel aman), pasangan ganda ditolak, periode selesai terkunci, izin & audit", async () => {
  const s = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const approver = await masuk(["APPROVER"]);
  await bayarPengeluaran(fin, approver, s, "200000", "2026-09-10", "Servis truk");
  await bayarPengeluaran(fin, approver, s, "200000", "2026-09-11", "Servis motor");

  const st = await post(fin, "/bank-statements", {
    cashAccountId: s.bank.id, periodStart: "2026-09-01", periodEnd: "2026-09-30", openingBalance: "20000000", closingBalance: "49600000",
    lines: [
      { date: "2026-09-01", description: "Setoran modal", amount: "30000000" },
      { date: "2026-09-10", description: "TRF servis truk", amount: "-200000" },
      { date: "2026-09-11", description: "TRF servis motor", amount: "-200000" },
      { date: "2026-09-20", description: "Biaya admin bank", amount: "-2500" },
    ],
  });
  assert.equal(st.status, 201, JSON.stringify(st.body));

  const daftar = (await get(fin, "/buku/rekon")).body;
  assert.equal(daftar.items.length, 1);
  assert.equal(daftar.items[0].saldoBuku, "49600000.00");
  assert.equal(daftar.items[0].saldoKoran, "49600000.00");
  assert.equal(daftar.items[0].selisih, "0.00");
  assert.equal(daftar.items[0].belumCocok, 4);

  const d = (await get(fin, `/buku/rekon/${st.body.id}`)).body;
  assert.equal(d.saldoBuku, "49600000.00");
  assert.equal(d.status, "DRAFT");
  assert.equal(d.ringkasan.belumCocok, 4);
  assert.equal(d.ringkasan.mutasiBukuBelumDipasangkan, 3);
  const modalBaris = d.baris.find((b) => b.keterangan === "Setoran modal");
  const trf1 = d.baris.find((b) => b.keterangan === "TRF servis truk");
  const admin = d.baris.find((b) => b.keterangan === "Biaya admin bank");
  assert.equal(trf1.kandidat.length, 2, "dua mutasi buku dengan nominal & arah yang sama");
  assert.equal(admin.kandidat.length, 0);
  assert.equal(admin.aksi.cocokkan.boleh, false);
  assert.match(admin.aksi.cocokkan.alasan, /penyesuaian sebagai jurnal/i);
  assert.equal(trf1.aksi.cocokkan.boleh, true);
  assert.equal(trf1.aksi.cocokkan.path, `/finance/bank-lines/${trf1.id}/match`);
  assert.equal(modalBaris.kandidat.length, 1);

  // Akun penyetuju membaca tetapi tidak boleh mencocokkan
  const dApp = (await get(approver, `/buku/rekon/${st.body.id}`)).body;
  assert.equal(dApp.baris.find((b) => b.id === trf1.id).aksi.cocokkan.boleh, false);
  assert.match(dApp.baris.find((b) => b.id === trf1.id).aksi.cocokkan.alasan, /tidak boleh/i);

  // Cocokkan; ulang dengan kunci sama → diputar ulang; baris yang sama lagi (kunci baru) → 409
  const h = kunci();
  const c1 = await raw("POST", `/api/finance/bank-lines/${trf1.id}/match`, { token: fin.token, headers: h, body: { journalLineId: trf1.kandidat[0].lineId } });
  assert.equal(c1.status, 200, JSON.stringify(c1.body));
  const ulang = await raw("POST", `/api/finance/bank-lines/${trf1.id}/match`, { token: fin.token, headers: h, body: { journalLineId: trf1.kandidat[0].lineId } });
  assert.equal(ulang.status, 200);
  assert.equal(ulang.headers.get("idempotent-replayed"), "true");
  const lagi = await post(fin, `/bank-lines/${trf1.id}/match`, { journalLineId: trf1.kandidat[0].lineId });
  assert.equal(lagi.status, 409);

  // Pasangan ganda: baris koran lain (nominal sama) tidak boleh memakai baris jurnal yang sudah terpakai — dan paralel hanya satu yang menang
  const d2 = (await get(fin, `/buku/rekon/${st.body.id}`)).body;
  assert.equal(d2.baris.find((b) => b.id === trf1.id).status, "COCOK");
  assert.equal(d2.baris.find((b) => b.id === trf1.id).cocokDengan.nilai, "-200000.00");
  const trf2 = d2.baris.find((b) => b.keterangan === "TRF servis motor");
  assert.equal(trf2.kandidat.length, 1, "kandidat yang sudah terpakai tidak ditawarkan lagi");
  const jurnalTerpakai = d2.baris.find((b) => b.id === trf1.id).cocokDengan.lineId;
  const dobel = await post(fin, `/bank-lines/${trf2.id}/match`, { journalLineId: jurnalTerpakai });
  assert.equal(dobel.status, 409);
  assert.match(dobel.body.error, /sudah dicocokkan dengan baris koran lain/);
  const [p1, p2] = await Promise.all([
    post(fin, `/bank-lines/${trf2.id}/match`, { journalLineId: trf2.kandidat[0].lineId }),
    post(fin, `/bank-lines/${trf2.id}/match`, { journalLineId: trf2.kandidat[0].lineId }),
  ]);
  assert.deepEqual([p1.status, p2.status].sort(), [200, 409], `${p1.status}/${p2.status}`);

  // Lepas; melepas baris yang tidak sedang cocok → 409
  assert.equal((await post(fin, `/bank-lines/${trf1.id}/unmatch`)).status, 200);
  assert.equal((await post(fin, `/bank-lines/${trf1.id}/unmatch`)).status, 409);
  const d3 = (await get(fin, `/buku/rekon/${st.body.id}`)).body;
  assert.equal(d3.baris.find((b) => b.id === trf1.id).status, "BELUM_COCOK");
  assert.ok(d3.riwayat.some((r) => r.label === "Baris koran dicocokkan"), JSON.stringify(d3.riwayat));
  assert.ok(d3.riwayat.some((r) => r.label === "Pencocokan baris koran dilepas"));

  // Periode selesai terkunci: baris tidak bisa dicocokkan / aksi mati
  await testPrisma.finBankStatement.update({ where: { id: st.body.id }, data: { status: "SELESAI", completedAt: new Date() } });
  const kunciDetail = (await get(fin, `/buku/rekon/${st.body.id}`)).body;
  assert.equal(kunciDetail.baris.find((b) => b.id === trf1.id).aksi.cocokkan.boleh, false);
  assert.equal((await post(fin, `/bank-lines/${trf1.id}/match`, { journalLineId: trf1.kandidat[0].lineId })).status, 409);

  // Izin baca: tanpa FINANCE_READ ditolak
  const sales = await createLoginUser({ roles: ["SALES"] });
  const login = await raw("POST", "/api/auth/login", { body: { email: sales.email, password: sales.password } });
  if (login.body?.token) assert.equal((await raw("GET", "/api/finance/buku/jurnal", { token: login.body.token })).status, 403);
  assert.equal((await raw("GET", "/api/finance/buku/jurnal")).status, 401);
});

test("Kontrak klien: /buku/* dan /reports/* menjawab 200 dengan bentuk yang dipetakan mobile; DUMP_BUKU=1 menyimpan fixture", async () => {
  const s = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const approver = await masuk(["APPROVER"]);
  await bayarPengeluaran(fin, approver, s, "200000", "2026-09-10", "Servis truk");
  const stx = await post(fin, "/bank-statements", { cashAccountId: s.bank.id, periodStart: "2026-09-01", periodEnd: "2026-09-30", openingBalance: "20000000", closingBalance: "49800000", lines: [{ date: "2026-09-10", description: "TRF servis truk", amount: "-200000" }] });
  assert.equal(stx.status, 201, JSON.stringify(stx.body));
  const akunResp = (await get(fin, "/buku/akun")).body;
  const akun = akunResp.akun;
  const bankAkun = akun.find((a) => a.id === s.akunBank.id) ?? akun[0];
  const hasil = { generatedBy: "financeBuku.integration.test.js (DUMP_BUKU=1)", akunId: s.akunBank.id, jurnal: (await get(fin, "/buku/jurnal?from=2026-09-01&to=2026-09-30")).body, akun: akunResp, mutasi: (await get(fin, `/buku/akun/${bankAkun.id}/mutasi?from=2026-09-01&to=2026-09-30`)).body, rekon: (await get(fin, "/buku/rekon")).body, laporan: {} };
  assert.ok(hasil.rekon.items.length >= 1);
  hasil.rekonDetail = (await get(fin, `/buku/rekon/${hasil.rekon.items[0].id}`)).body;
  hasil.jurnalDetail = (await get(fin, `/buku/jurnal/${hasil.jurnal.items[0].id}`)).body;
  for (const [nama, q] of [["income-statement", "?from=2026-09-01&to=2026-09-30"], ["balance-sheet", "?to=2026-09-30"], ["cash-flow", "?from=2026-09-01&to=2026-09-30"], ["trial-balance", "?from=2026-09-01&to=2026-09-30"], ["receivables", "?to=2026-09-30"], ["payables", "?to=2026-09-30"]]) {
    resetRateLimits();
    const r = await get(fin, `/reports/${nama}${q}`);
    assert.equal(r.status, 200, `${nama}: ${JSON.stringify(r.body)}`);
    hasil.laporan[nama] = r.body;
  }
  assert.equal(hasil.laporan["balance-sheet"].ringkasan.seimbang, true);
  if (process.env.DUMP_BUKU) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    mkdirSync(fileURLToPath(new URL("../../../finance-mobile/src/__tests__/fixtures/", import.meta.url)), { recursive: true });
    const stabil = JSON.stringify(hasil, (k, v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? "2026-09-21T00:00:00.000Z" : v), 1);
    writeFileSync(fileURLToPath(new URL("../../../finance-mobile/src/__tests__/fixtures/buku-real.json", import.meta.url)), stabil);
  }
});
