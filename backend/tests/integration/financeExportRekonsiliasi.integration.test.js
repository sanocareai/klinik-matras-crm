// EXPORT EXCEL FINANCE — REKONSILIASI BANK (B3.9). Yang dikunci: berkas = data yang SAMA dengan layar (GET /bank-statements dan
// GET /bank-statements/:id — saldo buku, selisih, mutasi, pasangan jurnal), periode yang sedang dibuka diikuti (statementId + lineIds),
// kartu Detail Periode sesuai layar, nominal ANGKA, izin (401/403), kolom sensitif hanya Admin Keuangan, tanggal WIB, formula dinetralkan.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { unduhExport, bacaSheet } from "./setup/exportHelper.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postJournal } from "../../src/services/finance/journal.js";
import { toMoney } from "../../src/services/finance/money.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const pt = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: akunBank.id } });
  const mandiri = await testPrisma.finCashAccount.create({ data: { name: "Mandiri", kind: "BANK", accountId: akunBank.id } });
  const modal = await testPrisma.finAccount.findFirst({ where: { code: "3-1100" } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  const a = makeClient(server.baseUrl, admin.token);

  const jurnal = (tanggal, nilai, description) => testPrisma.$transaction((tx) => postJournal(tx, {
    date: tanggal, description, source: "MANUAL", userId: admin.user.id,
    lines: [
      { accountId: pt.accountId, cashAccountId: pt.id, ...(nilai > 0 ? { debit: toMoney(nilai) } : { credit: toMoney(-nilai) }) },
      { accountId: modal.id, ...(nilai > 0 ? { credit: toMoney(nilai) } : { debit: toMoney(-nilai) }) },
    ],
  }));
  await jurnal("2026-09-20", 1_000_000, "Setoran modal");
  await jurnal("2026-09-21", -250_000, "Bayar supplier");
  await jurnal("2026-09-22", 75_000, "Bunga");

  const s1 = (await a.post("/api/finance/bank-statements", {
    cashAccountId: pt.id, periodStart: "2026-09-20", periodEnd: "2026-09-30", openingBalance: 0, closingBalance: 900_000, note: "=CATATAN PERIODE",
    lines: [
      { date: "2026-09-20", description: "SETORAN TUNAI", amount: 1_000_000, reference: "REF-1" },
      { date: "2026-09-21", description: "=TRSF SUPPLIER", amount: -250_000 },
      { date: "2026-09-22", description: "BUNGA", amount: 75_000 },
      { date: "2026-09-23", description: "BIAYA ADM", amount: -25_000 },
    ],
  })).body;
  const s2 = (await a.post("/api/finance/bank-statements", { cashAccountId: mandiri.id, periodStart: "2026-09-01", periodEnd: "2026-09-30", openingBalance: 0, closingBalance: 0 })).body;
  assert.ok(s1.id && s2.id, "periode terbuat");

  // cocokkan 2 baris pertama dengan jurnal, abaikan baris BIAYA ADM, biarkan BUNGA belum cocok
  const det = (await a.get(`/api/finance/bank-statements/${s1.id}`)).body;
  const baris = (desc) => det.statement.lines.find((l) => l.description === desc);
  for (const [desc, nilai] of [["SETORAN TUNAI", 1_000_000], ["=TRSF SUPPLIER", -250_000]]) {
    const kand = det.kandidat.find((k) => k.nilai === nilai);
    assert.ok(kand, `kandidat ${desc}`);
    const m = await a.post(`/api/finance/bank-lines/${baris(desc).id}/match`, { journalLineId: kand.id });
    assert.equal(m.status, 200, JSON.stringify(m.body));
  }
  const ig = await a.post(`/api/finance/bank-lines/${baris("BIAYA ADM").id}/ignore`, { note: "=biaya admin belum dicatat" });
  assert.equal(ig.status, 200, JSON.stringify(ig.body));
  return { pt, mandiri, admin, finance, sales, a, s1, s2 };
}

const P = { rek: "Rekening", saldoAkhir: "Saldo Akhir Bank (Rp)", buku: "Saldo Buku Akhir (Rp)", selisih: "Selisih Terbuka (Rp)" };

test("Tabel Periode (tanpa ids) = GET /bank-statements: urutan, saldo awal/akhir/buku, selisih & arah, mutasi, belum cocok, status; nominal ANGKA; tanggal", async () => {
  const ctx = await siapkan();
  const layar = (await ctx.a.get("/api/finance/bank-statements")).body.statements;
  const r = await unduhExport(server.baseUrl, ctx.admin.token, "rekonsiliasi", {});
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition"), /filename="Finance_Rekonsiliasi_Bank_per_\d{4}-\d{2}-\d{2}\.xlsx"/);
  const s = bacaSheet(r.wb, "Rekonsiliasi");
  assert.equal(s.baris.length, layar.length);
  assert.deepEqual(s.baris.map((b) => b[P.rek]), layar.map((x) => x.cashAccount.name), "urutan = urutan layar");
  for (const st of layar) {
    const x = s.baris.find((b) => b[P.rek] === st.cashAccount.name);
    assert.equal(typeof x[P.saldoAkhir], "number");
    assert.equal(x[P.saldoAkhir], st.closingBalance); assert.equal(x["Saldo Awal Bank (Rp)"], st.openingBalance);
    assert.equal(x[P.buku], st.saldoBuku);
    assert.equal(x[P.selisih], Math.abs(st.selisih));
    assert.equal(x["Jumlah Mutasi"], st.jumlahBaris);
  }
  const x1 = s.baris.find((b) => b[P.rek] === "PT Sano");
  assert.equal(x1[P.buku], 825_000);
  assert.equal(x1[P.selisih], 75_000);
  assert.equal(x1["Arah Selisih"], "Bank lebih tinggi");
  assert.equal(x1["Jumlah Mutasi"], 4);
  assert.equal(x1["Belum Cocok"], 1);
  assert.equal(x1["Status"], "Sedang dicocokkan");
  assert.ok(x1["Periode Mulai"] instanceof Date && x1["Periode Mulai"].toISOString().slice(0, 10) === "2026-09-20");
  assert.equal(x1["Status Snapshot"], "Belum ada snapshot");
  const x2 = s.baris.find((b) => b[P.rek] === "Mandiri");
  assert.equal(x2["Arah Selisih"], "Cocok"); assert.equal(x2[P.selisih], 0);
  assert.equal(x2["Belum Cocok"], null, "tanpa mutasi: kolom kosong seperti layar ('—')");
  assert.equal(s.total["Jumlah Mutasi"], 4);
  assert.throws(() => bacaSheet(r.wb, "Mutasi"), /tidak ada/, "tanpa periode dibuka tidak ada sheet detail");
});

test("Mode ids (periode yang tampil setelah filter klien) + filter server rekening; ids kosong = tabel kosong", async () => {
  const ctx = await siapkan();
  const ids = await unduhExport(server.baseUrl, ctx.admin.token, "rekonsiliasi", { ids: [ctx.s2.id, ctx.s1.id] });
  assert.deepEqual(bacaSheet(ids.wb, "Rekonsiliasi").baris.map((b) => b[P.rek]), ["Mandiri", "PT Sano"], "urutan ids dihormati");
  const satu = await unduhExport(server.baseUrl, ctx.admin.token, "rekonsiliasi", { ids: [ctx.s1.id], filterLabel: "Rekening: PT Sano" });
  const ss = bacaSheet(satu.wb, "Rekonsiliasi");
  assert.equal(ss.baris.length, 1);
  assert.match(ss.kepala[2], /Filter: Rekening: PT Sano/);
  const rek = await unduhExport(server.baseUrl, ctx.admin.token, "rekonsiliasi", { filter: { cashAccountId: ctx.mandiri.id } });
  assert.deepEqual(bacaSheet(rek.wb, "Rekonsiliasi").baris.map((b) => b[P.rek]), ["Mandiri"]);
  const kosong = await unduhExport(server.baseUrl, ctx.admin.token, "rekonsiliasi", { ids: [] });
  assert.equal(kosong.status, 200);
  assert.equal(bacaSheet(kosong.wb, "Rekonsiliasi").baris.length, 0);
});

test("Periode dibuka (statementId) = GET /bank-statements/:id: kartu Detail Periode, Mutasi (nominal, status, pasangan jurnal), total bersih, lineIds & urutan layar", async () => {
  const ctx = await siapkan();
  const det = (await ctx.a.get(`/api/finance/bank-statements/${ctx.s1.id}`)).body;
  const r = await unduhExport(server.baseUrl, ctx.admin.token, "rekonsiliasi", { ids: [ctx.s1.id], filter: { statementId: ctx.s1.id } });
  assert.equal(r.status, 200);
  const d = bacaSheet(r.wb, "Detail Periode");
  const rowOf = (t) => d.baris.find((b) => String(b["Indikator"]).startsWith(t));
  assert.equal(rowOf("Saldo Menurut Buku")["Nilai (Rp)"], det.rekonsiliasi.saldoBuku);
  assert.equal(rowOf("Saldo Menurut Bank")["Nilai (Rp)"], det.rekonsiliasi.saldoKoran);
  assert.equal(rowOf("Selisih Terbuka")["Nilai (Rp)"], Math.abs(det.rekonsiliasi.selisih));
  assert.match(rowOf("Selisih Terbuka")["Keterangan"], /bank lebih tinggi/i);
  assert.equal(rowOf("Baris Belum Cocok")["Keterangan"], String(det.rekonsiliasi.belumCocok));
  assert.match(bacaSheet(r.wb, "Rekonsiliasi").kepala[1], /Periode: 20 Sep 2026 – 30 Sep 2026/);

  const m = bacaSheet(r.wb, "Mutasi");
  assert.deepEqual(m.baris.map((b) => b["Keterangan Bank"]), det.statement.lines.map((l) => l.description).map((x) => (x.startsWith("=") ? `'${x}` : x)), "urutan = urutan layar (tanggal naik)");
  for (const l of det.statement.lines) {
    const desc = l.description.startsWith("=") ? `'${l.description}` : l.description;
    const x = m.baris.find((b) => b["Keterangan Bank"] === desc);
    assert.equal(typeof x["Nominal (Rp)"], "number");
    assert.equal(x["Nominal (Rp)"], l.amount);
    assert.equal(x["Status"], { COCOK: "Cocok", BELUM_COCOK: "Belum Cocok", DIABAIKAN: "Diabaikan" }[l.status]);
    assert.equal(x["Arah"], l.amount > 0 ? "Masuk" : "Keluar");
    if (l.matchedLine) {
      assert.equal(x["No. Jurnal Pasangan"], l.matchedLine.entry.entryNumber);
      assert.equal(x["Nilai Jurnal (Rp)"], l.matchedLine.debit - l.matchedLine.credit);
    } else assert.ok([null, ""].includes(x["No. Jurnal Pasangan"]), "tanpa pasangan = sel kosong");
  }
  assert.equal(m.total["Nominal (Rp)"], 800_000);
  const setoran = m.baris.find((b) => b["Keterangan Bank"] === "SETORAN TUNAI");
  assert.equal(setoran["Referensi"], "REF-1");
  assert.ok(setoran["Tanggal"] instanceof Date && setoran["Tanggal"].toISOString().slice(0, 10) === "2026-09-20");
  assert.ok(r.wb.getWorksheet("Perlu Ditinjau"), "panel Perlu Ditinjau ikut");

  // baris yang tampil setelah pencarian/filter klien: hanya 2 baris, urutan layar
  const bunga = det.statement.lines.find((l) => l.description === "BUNGA");
  const setor = det.statement.lines.find((l) => l.description === "SETORAN TUNAI");
  const sub = await unduhExport(server.baseUrl, ctx.admin.token, "rekonsiliasi", { filter: { statementId: ctx.s1.id, lineIds: [bunga.id, setor.id] } });
  const ms = bacaSheet(sub.wb, "Mutasi");
  assert.deepEqual(ms.baris.map((b) => b["Keterangan Bank"]), ["BUNGA", "SETORAN TUNAI"]);
  assert.equal(ms.total["Nominal (Rp)"], 1_075_000);
  const kosong = await unduhExport(server.baseUrl, ctx.admin.token, "rekonsiliasi", { filter: { statementId: ctx.s1.id, lineIds: [] } });
  assert.equal(bacaSheet(kosong.wb, "Mutasi").baris.length, 0);
  // filter server status/arah (sama dengan Filter di layar)
  const belum = await unduhExport(server.baseUrl, ctx.admin.token, "rekonsiliasi", { filter: { statementId: ctx.s1.id, status: "BELUM_COCOK" } });
  assert.deepEqual(bacaSheet(belum.wb, "Mutasi").baris.map((b) => b["Keterangan Bank"]), ["BUNGA"]);
  const keluar = await unduhExport(server.baseUrl, ctx.admin.token, "rekonsiliasi", { filter: { statementId: ctx.s1.id, arah: "keluar" } });
  assert.equal(bacaSheet(keluar.wb, "Mutasi").baris.length, 2);
  // fokus "tinjau": hanya panel Perlu Ditinjau (+ detail), tanpa mutasi
  const fokus = await unduhExport(server.baseUrl, ctx.admin.token, "rekonsiliasi", { filter: { statementId: ctx.s1.id, fokus: "tinjau" } });
  assert.ok(fokus.wb.getWorksheet("Perlu Ditinjau")); assert.equal(fokus.wb.getWorksheet("Mutasi"), undefined);
});

test("Izin & keamanan: 401/403, FINANCE boleh tetapi catatan (periode/abaikan) TIDAK ikut; ADMIN dapat; formula dinetralkan; statementId tak dikenal 404", async () => {
  const ctx = await siapkan();
  assert.equal((await unduhExport(server.baseUrl, null, "rekonsiliasi")).status, 401);
  assert.equal((await unduhExport(server.baseUrl, ctx.sales.token, "rekonsiliasi")).status, 403);
  assert.equal((await unduhExport(server.baseUrl, ctx.admin.token, "rekonsiliasi", { filter: { statementId: "bukan-uuid" } })).status, 404);
  assert.equal((await unduhExport(server.baseUrl, ctx.admin.token, "rekonsiliasi", { filter: { statementId: "00000000-0000-4000-8000-000000000000" } })).status, 404);

  const fin = await unduhExport(server.baseUrl, ctx.finance.token, "rekonsiliasi", { filter: { statementId: ctx.s1.id } });
  assert.equal(fin.status, 200);
  assert.ok(!bacaSheet(fin.wb, "Rekonsiliasi").header.includes("Catatan Internal"));
  assert.ok(!bacaSheet(fin.wb, "Mutasi").header.includes("Catatan / Alasan Abaikan"));

  const adm = await unduhExport(server.baseUrl, ctx.admin.token, "rekonsiliasi", { filter: { statementId: ctx.s1.id } });
  const per = bacaSheet(adm.wb, "Rekonsiliasi").baris.find((b) => b[P.rek] === "PT Sano");
  assert.equal(per["Catatan Internal"], "'=CATATAN PERIODE");
  const adm2 = bacaSheet(adm.wb, "Mutasi").baris.find((b) => b["Keterangan Bank"] === "BIAYA ADM");
  assert.equal(adm2["Catatan / Alasan Abaikan"], "'=biaya admin belum dicatat");
  assert.equal(adm2["Status"], "Diabaikan");
  assert.ok(bacaSheet(adm.wb, "Mutasi").baris.some((b) => b["Keterangan Bank"] === "'=TRSF SUPPLIER"), "keterangan bank berawalan = dinetralkan");
});
