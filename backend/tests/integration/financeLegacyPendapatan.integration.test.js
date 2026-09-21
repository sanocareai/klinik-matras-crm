// DATA SEBELUM SISTEM (register pendapatan historis NON-POSTING): cutoff dari data produksi, impor CSV/XLSX, pratinjau & validasi, idempotensi, deteksi duplikat
// (arsip lain & order sistem), baris meragukan = Perlu Ditinjau, batalkan, rekonsiliasi per bulan, proposal jurnal (tidak diposting), dan jaminan tidak ada
// efek ke buku besar / saldo Kas & Bank / Neraca.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw, DEVICE } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";
import { parseNominal, parseTanggal } from "../../src/services/finance/legacyPendapatan.js";
import { saldoKasBank, neraca } from "../../src/services/finance/reports.js";

let server; let raw;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); raw = makeRaw(server.baseUrl); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function masuk(roles) {
  const u = await createLoginUser({ roles });
  const r = await raw("POST", "/api/mobile/auth/login", { body: { email: u.email, password: u.password, device: DEVICE() } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { ...u, token: r.body.accessToken };
}
const api = (u, m, path, body) => raw(m, `/api/finance${path}`, { token: u.token, headers: { "Idempotency-Key": crypto.randomUUID() }, body });
const get = (u, path) => raw("GET", `/api/finance${path}`, { token: u.token });
async function unggah(u, isi, nama = "notion.csv", tipe = "text/csv") {
  const form = new FormData();
  form.append("file", new Blob([isi], { type: tipe }), nama);
  const r = await fetch(`${server.baseUrl}/api/finance/pemasukan/legacy/batch`, { method: "POST", headers: { Authorization: `Bearer ${u.token}`, "Idempotency-Key": crypto.randomUUID() }, body: form });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const cust = await testPrisma.customer.create({ data: { name: "Ibu Sari" } });
  // order sistem pertama: 12 Jul 2026 → cutoff diturunkan dari sini
  const o1 = await testPrisma.order.create({ data: { customerId: cust.id, value: 750_000, category: "LAYANAN", orderNumber: "RES-12072026-001", status: "DELIVERED", paymentStatus: "BELUM_BAYAR", createdAt: new Date("2026-07-12T03:00:00Z") } });
  const cust2 = await testPrisma.customer.create({ data: { name: "Bapak Andi" } });
  const o2 = await testPrisma.order.create({ data: { customerId: cust2.id, value: 1_200_000, category: "LAYANAN", orderNumber: "RES-15072026-004", status: "DELIVERED", paymentStatus: "BELUM_BAYAR", createdAt: new Date("2026-07-15T03:00:00Z") } });
  return { o1, o2 };
}
const HEADER = "Tanggal Transaksi,No Resi,Pelanggan,Keterangan,Nominal,Status Pembayaran,Tanggal Pembayaran,Metode Pembayaran,Sumber Data";
const CSV = [
  HEADER,
  "2026-01-10,NOTION-001,Ibu Rina,Cuci kasur,\"Rp 1.500.000\",Lunas,2026-01-11,Transfer,Notion",
  "15/02/2026,NOTION-002,Bapak Joko,Sofa,2.250.000,Belum dibayar,,,Notion",
  "\"March 3, 2026\",,Ibu Wati,Springbed servis,800000,DP,,Tunai,Notion",
  "2026-03-03,,Ibu Wati,Springbed servis,800000,DP,,Tunai,Notion",          // identik → tinjau
  "2026-04-01,NOTION-001,Ibu Rina,Cuci kasur,\"Rp 1.500.000\",Lunas,,,Notion", // nomor sama, sama → duplikat
  "2026-04-02,NOTION-003,Ibu X,Cuci,900000,Lunas,,,Notion",
  "2026-04-05,NOTION-003,Ibu X,Cuci,950000,Lunas,,,Notion",                     // nomor sama nominal beda → tinjau
  "2026-05-05,NOTION-004,Ibu Y,Retur,-300000,Lunas,,,Notion",                   // negatif → tinjau
  "2026-05-06,NOTION-005,Ibu Z,Tanpa nominal,,Lunas,,,Notion",                  // tidak valid
  "tanggal ngawur,NOTION-006,Ibu Q,Tanggal rusak,100000,Lunas,,,Notion",        // tidak valid
  "2026-07-20,NOTION-007,Ibu Setelah,Setelah cutoff,500000,Lunas,,,Notion",    // di luar periode
  "2026-06-20,RES-12072026-001,Ibu Sari,Sama nomor order sistem,750000,Lunas,,,Notion", // duplikat order sistem
  "2026-07-10,NOTION-008,Bapak Andi,Mirip order sistem,1200000,Lunas,,,Notion", // pelanggan+nominal+tanggal ±3 hari dari RES-15072026-004? (5 hari) → SIAP
  "2026-07-13,NOTION-009,Bapak Andi,Mirip order sistem,1200000,Lunas,,,Notion", // sesudah cutoff → di luar periode
  "2026-07-11,NOTION-010,Bapak Andi,Kemungkinan cocok,1200000,Lunas,,,Notion", // sebelum cutoff, tidak ±3 dari 15 Jul → SIAP",
].join("\n");

test("Parser: tanggal (ISO, dd/mm/yyyy, 'January 12, 2026', serial Excel) dan nominal (Rp, titik/koma ribuan-desimal, negatif) tanpa float", () => {
  assert.equal(parseTanggal("2026-01-05"), "2026-01-05");
  assert.equal(parseTanggal("05/01/2026"), "2026-01-05");
  assert.equal(parseTanggal("January 12, 2026"), "2026-01-12");
  assert.equal(parseTanggal("12 Januari 2026"), "2026-01-12");
  assert.equal(parseTanggal(46032), "2026-01-10");
  assert.equal(parseTanggal("31/02/2026"), null);
  assert.equal(parseTanggal("ngawur"), null);
  assert.equal(parseNominal("Rp 1.500.000"), "1500000.00");
  assert.equal(parseNominal("1.500.000,50"), "1500000.50");
  assert.equal(parseNominal("1,500,000.50"), "1500000.50");
  assert.equal(parseNominal("1.500"), "1500.00");
  assert.equal(parseNominal("(2.000)"), "-2000.00");
  assert.equal(parseNominal("-300000"), "-300000.00");
  assert.equal(parseNominal("12345678901234.55"), "12345678901234.55");
  assert.equal(parseNominal("IDR 33,000,000"), "33000000.00", "format ekspor Notion");
  assert.equal(parseNominal("abc"), null);
  assert.equal(parseNominal(""), null);
});

test("Cutoff DITURUNKAN dari order sistem paling awal (bukan ditebak) dan celah pengakuan pendapatan dilaporkan sebagai informasi", async () => {
  await siapkan();
  const fin = await masuk(["FINANCE"]);
  const c = (await get(fin, "/pemasukan/legacy/cutoff")).body;
  assert.equal(c.tanggal, "2026-07-12");
  assert.match(c.dasar, /RES-12072026-001/);
  assert.equal(c.orderPertama.nomor, "RES-12072026-001");
});

test("Pratinjau CSV: validasi per baris, duplikat, meragukan → Perlu Ditinjau; belum dihitung sampai diimpor; idempoten", async () => {
  const { o1 } = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const r = await unggah(fin, CSV);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.batch.id;
  assert.equal(r.body.batch.status, "PREVIEW");
  assert.equal(r.body.batch.cutoff, "2026-07-12");
  const d = (await get(fin, `/pemasukan/legacy/batch/${id}?limit=100`)).body;
  const per = (n) => d.items.find((x) => x.nomorLama === n) ?? d.items.find((x) => x.rowNo === n);
  assert.equal(per("NOTION-001").status, "SIAP");
  assert.equal(per("NOTION-001").nilai, "1500000.00");
  assert.equal(per("NOTION-001").payStatus, "LUNAS");
  assert.equal(d.items.find((x) => x.rowNo === 3).tanggal, "2026-02-15");
  assert.equal(d.items.find((x) => x.rowNo === 3).payStatus, "BELUM_BAYAR");
  const tanpaNomor = d.items.filter((x) => x.pelanggan === "Ibu Wati");
  assert.equal(tanpaNomor.length, 2);
  assert.match(tanpaNomor[0].legacyId, /^LEG-[0-9a-f]{16}$/, "ID legacy stabil dibuat sistem");
  assert.equal(tanpaNomor[0].status, "SIAP");
  assert.equal(tanpaNomor[1].status, "PERLU_DITINJAU", "baris identik tanpa nomor: tidak ditebak");
  assert.match(tanpaNomor[1].legacyId, /#2$/);
  assert.equal(d.items.filter((x) => x.rowNo === 6)[0].status, "DUPLIKAT", "nomor yang sama dengan nominal sama");
  assert.equal(d.items.find((x) => x.rowNo === 8).status, "PERLU_DITINJAU", "nomor sama, nominal berbeda");
  assert.equal(d.items.find((x) => x.rowNo === 9).status, "PERLU_DITINJAU", "negatif");
  assert.equal(d.items.find((x) => x.rowNo === 10).status, "TIDAK_VALID");
  assert.equal(d.items.find((x) => x.rowNo === 11).status, "TIDAK_VALID");
  assert.equal(d.items.find((x) => x.rowNo === 12).status, "DI_LUAR_PERIODE");
  const dupOrder = d.items.find((x) => x.rowNo === 13);
  assert.equal(dupOrder.status, "DUPLIKAT");
  assert.equal(dupOrder.cocokOrderId, o1.id);
  // belum diimpor → tidak dihitung di Pemasukan
  const ring0 = (await get(fin, "/pemasukan/ringkasan?from=2026-01-01&to=2026-06-30")).body;
  assert.equal(ring0.pendapatanHistoris.nilai, "0.00");
  // idempoten: berkas yang sama tidak membuat batch baru
  const ulang = await unggah(fin, CSV);
  assert.equal(ulang.status, 200);
  assert.equal(ulang.body.batch.id, id);
  assert.equal(ulang.body.sudahAda, true);
  assert.equal(await testPrisma.finLegacyBatch.count(), 1);
});

test("Impor: hanya baris SIAP dihitung; Perlu Ditinjau tidak; keputusan TERIMA menghitung; ABAIKAN tidak; gabungan = sistem + historis; tak ada efek ke buku besar/kas/Neraca", async () => {
  await siapkan();
  const fin = await masuk(["FINANCE"]);
  const sebelum = { j: await testPrisma.finJournalEntry.count(), l: await testPrisma.finJournalLine.count(), kas: JSON.stringify(await saldoKasBank(testPrisma, {})), n: (await neraca(testPrisma, { to: new Date("2026-09-21T00:00:00Z") })).ringkasan.seimbang };
  const r = await unggah(fin, CSV);
  const id = r.body.batch.id;
  const im = await api(fin, "POST", `/pemasukan/legacy/batch/${id}/impor`);
  assert.equal(im.status, 200, JSON.stringify(im.body));
  assert.equal(im.body.batch.status, "IMPORTED");
  const ring = (await get(fin, "/pemasukan/ringkasan?from=2026-01-01&to=2026-07-11")).body;
  // SIAP: 001 (1.500.000) + 002 (2.250.000) + Wati pertama (800.000) + NOTION-003 pertama (900.000) + NOTION-008 & 010 (1.200.000 ×2)
  assert.equal(ring.pendapatanHistoris.nilai, (1_500_000 + 2_250_000 + 800_000 + 900_000 + 2_400_000).toFixed(2));
  assert.equal(ring.pendapatanHistoris.lunas, (1_500_000 + 900_000 + 2_400_000).toFixed(2));
  assert.ok(ring.pendapatanHistoris.perluDitinjau.jumlah >= 3, "meragukan dipisah");
  assert.equal(ring.pendapatanGabungan.nilai, (Number(ring.pendapatanSistem.nilai) + Number(ring.pendapatanHistoris.nilai)).toFixed(2));
  assert.equal(ring.labelHistoris, "Data sebelum sistem berasal dari arsip lama dan belum memengaruhi buku besar sampai proses rekonsiliasi dan posting disetujui.");
  // keputusan atas baris meragukan
  const tin = (await get(fin, `/pemasukan?from=2026-01-01&to=2026-07-11&kategori=HISTORIS&status=PERLU_DITINJAU&limit=100`)).body.items;
  assert.ok(tin.length >= 3);
  const negatif = tin.find((x) => x.nilai.startsWith("-"));
  assert.ok(negatif && negatif.perluTinjau && !negatif.dihitung);
  const bukanNegatif = tin.find((x) => !x.nilai.startsWith("-"));
  assert.equal((await api(fin, "POST", `/pemasukan/legacy/baris/${bukanNegatif.id}/keputusan`, { keputusan: "TERIMA" })).status, 200);
  const ring2 = (await get(fin, "/pemasukan/ringkasan?from=2026-01-01&to=2026-07-11")).body;
  assert.equal(Number(ring2.pendapatanHistoris.nilai), Number(ring.pendapatanHistoris.nilai) + Number(bukanNegatif.nilai));
  assert.equal((await api(fin, "POST", `/pemasukan/legacy/baris/${bukanNegatif.id}/keputusan`, { keputusan: "ABAIKAN" })).status, 200);
  assert.equal((await get(fin, "/pemasukan/ringkasan?from=2026-01-01&to=2026-07-11")).body.pendapatanHistoris.nilai, ring.pendapatanHistoris.nilai);
  assert.equal((await api(fin, "POST", `/pemasukan/legacy/baris/${bukanNegatif.id}/keputusan`, { keputusan: "ASAL" })).status, 400);
  // TIDAK ADA efek ke buku besar
  const setelah = { j: await testPrisma.finJournalEntry.count(), l: await testPrisma.finJournalLine.count(), kas: JSON.stringify(await saldoKasBank(testPrisma, {})), n: (await neraca(testPrisma, { to: new Date("2026-09-21T00:00:00Z") })).ringkasan.seimbang };
  assert.deepEqual(setelah, sebelum, "register non-posting: jurnal, saldo Kas & Bank, Neraca tidak berubah");
  assert.equal(await testPrisma.invoice.count(), 0, "tidak membuat invoice");
});

test("Duplikat lintas batch: berkas berbeda yang memuat baris yang sama menandai DUPLIKAT terhadap batch yang sudah diimpor", async () => {
  await siapkan();
  const fin = await masuk(["FINANCE"]);
  const a = await unggah(fin, `${HEADER}\n2026-01-10,NOTION-001,Ibu Rina,Cuci,1500000,Lunas,,,Notion\n2026-02-10,NOTION-002,Ibu B,Cuci,500000,Lunas,,,Notion`);
  await api(fin, "POST", `/pemasukan/legacy/batch/${a.body.batch.id}/impor`);
  const b = await unggah(fin, `${HEADER}\n2026-01-10,NOTION-001,Ibu Rina,Cuci,1500000,Lunas,,,Notion\n2026-03-10,NOTION-777,Ibu C,Cuci,700000,Lunas,,,Notion`, "notion-2.csv");
  const d = (await get(fin, `/pemasukan/legacy/batch/${b.body.batch.id}`)).body;
  assert.equal(d.items.find((x) => x.nomorLama === "NOTION-001").status, "DUPLIKAT");
  assert.equal(d.items.find((x) => x.nomorLama === "NOTION-777").status, "SIAP");
});

test("XLSX: sel tanggal & angka Excel terbaca; sama-sama tervalidasi", async () => {
  await siapkan();
  const fin = await masuk(["FINANCE"]);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Pendapatan");
  ws.addRow(["Tanggal", "Nomor", "Customer", "Deskripsi", "Total", "Status"]);
  ws.addRow([new Date(Date.UTC(2026, 0, 20)), "X-1", "Ibu Tia", "Cuci", 1250000, "Lunas"]);
  ws.addRow(["20/02/2026", "X-2", "Ibu Uci", "Sofa", "Rp 2.000.000", "Belum lunas"]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const r = await unggah(fin, buf, "notion.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const d = (await get(fin, `/pemasukan/legacy/batch/${r.body.batch.id}`)).body;
  assert.equal(d.items.length, 2);
  assert.equal(d.items[0].tanggal, "2026-01-20");
  assert.equal(d.items[0].nilai, "1250000.00");
  assert.equal(d.items[1].nilai, "2000000.00");
  assert.equal(d.items[1].payStatus, "BELUM_BAYAR");
});

test("Berkas rusak/format salah/kolom wajib hilang ditolak dengan pesan jelas; tanpa berkas 400", async () => {
  await siapkan();
  const fin = await masuk(["FINANCE"]);
  assert.equal((await unggah(fin, "Nama,Umur\nA,3", "x.csv")).status, 400);
  assert.equal((await unggah(fin, "isi", "x.pdf", "application/pdf")).status, 400);
  assert.equal((await unggah(fin, HEADER, "kosong.csv")).status, 400);
  const form = new FormData();
  const r = await fetch(`${server.baseUrl}/api/finance/pemasukan/legacy/batch`, { method: "POST", headers: { Authorization: `Bearer ${fin.token}`, "Idempotency-Key": crypto.randomUUID() }, body: form });
  assert.equal(r.status, 400);
  assert.equal(await testPrisma.finLegacyBatch.count(), 0);
});

test("Batalkan: alasan wajib; baris tidak lagi dihitung; berkas yang sama bisa diunggah lagi; batch POSTED tidak bisa dibatalkan", async () => {
  await siapkan();
  const fin = await masuk(["FINANCE"]);
  const a = await unggah(fin, `${HEADER}\n2026-01-10,N-1,Ibu R,Cuci,1000000,Lunas,,,Notion`);
  await api(fin, "POST", `/pemasukan/legacy/batch/${a.body.batch.id}/impor`);
  assert.equal((await get(fin, "/pemasukan/ringkasan?from=2026-01-01&to=2026-01-31")).body.pendapatanHistoris.nilai, "1000000.00");
  assert.equal((await api(fin, "POST", `/pemasukan/legacy/batch/${a.body.batch.id}/batal`, {})).status, 400);
  assert.equal((await api(fin, "POST", `/pemasukan/legacy/batch/${a.body.batch.id}/batal`, { alasan: "salah berkas" })).status, 200);
  assert.equal((await get(fin, "/pemasukan/ringkasan?from=2026-01-01&to=2026-01-31")).body.pendapatanHistoris.nilai, "0.00");
  const lagi = await unggah(fin, `${HEADER}\n2026-01-10,N-1,Ibu R,Cuci,1000000,Lunas,,,Notion`);
  assert.equal(lagi.status, 201, "berkas identik boleh diunggah lagi setelah dibatalkan");
  await testPrisma.finLegacyBatch.update({ where: { id: lagi.body.batch.id }, data: { status: "POSTED", postedAt: new Date() } });
  assert.equal((await api(fin, "POST", `/pemasukan/legacy/batch/${lagi.body.batch.id}/batal`, { alasan: "coba" })).status, 409);
});

test("Rekonsiliasi per bulan + simulasi + proposal jurnal: hanya laporan; TIDAK memposting; kas tidak berubah", async () => {
  await siapkan();
  const fin = await masuk(["FINANCE"]);
  const a = await unggah(fin, `${HEADER}\n2026-01-10,N-1,Ibu R,Cuci,1000000,Lunas,2026-01-11,Transfer,Notion\n2026-01-20,N-2,Ibu S,Sofa,500000,Belum dibayar,,,Notion\n2026-02-05,N-3,Ibu T,Cuci,300000,Lunas,,,Notion`);
  await api(fin, "POST", `/pemasukan/legacy/batch/${a.body.batch.id}/impor`);
  const j0 = await testPrisma.finJournalEntry.count();
  const rk = (await get(fin, "/pemasukan/legacy/rekonsiliasi")).body;
  assert.equal(rk.periodeArsip.from, "2026-01-01");
  assert.equal(rk.periodeArsip.to, "2026-07-12");
  const jan = rk.perBulan.find((b) => b.bulan === "2026-01");
  assert.equal(jan.pendapatan, "1500000.00");
  assert.equal(jan.lunas, "1000000.00");
  assert.equal(jan.belumBayar, "500000.00");
  assert.equal(jan.jurnalSaatIni, "0.00");
  assert.equal(jan.selisihTerhadapJurnal, "1500000.00");
  assert.equal(rk.perBulan.map((b) => b.bulan).join(","), "2026-01,2026-02,2026-03,2026-04,2026-05,2026-06,2026-07");
  assert.equal(rk.total.pendapatan, "1800000.00");
  assert.equal(rk.simulasi.kas.berubah, "0.00");
  assert.equal(rk.simulasi.piutang.bertambah, "500000.00");
  assert.equal(rk.simulasi.ekuitas.berubah, "500000.00", "total ekuitas naik hanya sebesar piutang");
  assert.equal(rk.simulasi.ekuitas.koreksiSaldoAwalBerkurang, "1300000.00");
  const pr = (await get(fin, "/pemasukan/legacy/proposal")).body;
  assert.match(pr.status, /BELUM DIPOSTING/);
  assert.match(pr.persetujuan, /Owner/);
  for (const jr of pr.jurnal) {
    const d = jr.lines.reduce((s, l) => s + Number(l.debit), 0); const k = jr.lines.reduce((s, l) => s + Number(l.kredit), 0);
    assert.equal(d, k, `proposal ${jr.bulan} seimbang`);
    assert.ok(!jr.lines.some((l) => ["1-1100", "1-1200"].includes(l.akun)), "proposal tidak menyentuh kas/bank");
  }
  assert.equal(await testPrisma.finJournalEntry.count(), j0, "tidak ada jurnal yang diposting");
});

test("Izin: tulis Data Sebelum Sistem hanya untuk FINANCE_POST; APPROVER membaca saja; tanpa sesi 401", async () => {
  await siapkan();
  const approver = await masuk(["APPROVER"]);
  assert.equal((await unggah(approver, CSV)).status, 403);
  assert.equal((await get(approver, "/pemasukan/legacy/batch")).status, 200);
  const r = await fetch(`${server.baseUrl}/api/finance/pemasukan/legacy/batch`, { method: "POST", body: new FormData() });
  assert.equal(r.status, 401);
});
