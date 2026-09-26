// C2 — Pengajuan Biaya Marketing / Management / HR-GA di atas fondasi C1: satu model & satu alur, konfigurasi data-driven,
// akses per workspace di server, pemetaan kategori tanpa fallback, dan penolakan aset/payroll/kasbon/antarbank/tagihan/stok.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const PB = "/api/finance/expense-submissions";

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "Bank Uji", kind: "BANK", accountId: akunBank.id } });
  const u = {};
  for (const [k, roles] of Object.entries({ sales: ["SALES"], sales2: ["SALES"], pl: ["PRODUCTION_LEAD"], wh: ["WAREHOUSE"], disp: ["DISPATCHER"], fin: ["FINANCE"], adm: ["ADMIN"], owner: ["OWNER"] })) u[k] = await createTestUser({ roles });
  const c = Object.fromEntries(Object.entries(u).map(([k, v]) => [k, makeClient(server.baseUrl, v.token)]));
  return { u, c, bank };
}

const meta = { MARKETING: { keperluan: "Kampanye Promo Kasur Oktober" }, MANAGEMENT: { keperluan: "Rapat dengan mitra" }, HR_GA: { kegiatan: "Pelatihan K3" } };
const body = (ws, tipe, extra = {}) => ({ workspace: ws, expenseType: tipe, date: "2026-09-26", amount: 250_000, vendorName: "Vendor Uji", metadata: { ...meta[ws] }, sumberDana: "BELUM_DIBAYAR", ...extra });
const ajukan = (client, id, kunci = `k-${id}`) => client.post(`${PB}/${id}/ajukan`, {}, { "Idempotency-Key": kunci });
async function bukti(id, userId) { await testPrisma.expenseSubmissionProof.create({ data: { submissionId: id, url: "https://example.test/nota-uji.jpg", version: 1, uploadedById: userId } }); }
const feDari = (id) => testPrisma.finExpense.findUnique({ where: { id }, include: { category: { include: { account: true } } } });

// pemetaan yang DIHARAPKAN (audit kategori) — jenis biaya → [kode kategori, akun]
const PETA = {
  MARKETING: { IKLAN_PROMOSI: ["MKT_PROMOSI", "6-1200"], KONTEN: ["MKT_KONTEN", "6-1200"], EVENT: ["MKT_EVENT", "6-1200"], CETAK_PROMO: ["MKT_CETAK", "6-1200"], TOOLS_MARKETING: ["LANGGANAN_APLIKASI", "6-1160"], TRANSPORT_REPRESENTASI: ["OPS_MEETING", "6-1170"] },
  MANAGEMENT: { MEETING_REPRESENTASI: ["OPS_MEETING", "6-1170"], PERJALANAN_DINAS: ["OPS_MEETING", "6-1170"], KONSULTAN: ["MGT_KONSULTAN", "6-1900"], LEGAL_PERIZINAN: ["MGT_LEGAL", "6-1900"], LANGGANAN_MANAJEMEN: ["LANGGANAN_APLIKASI", "6-1160"], OPERASIONAL_KHUSUS: ["LAIN_LAIN", "6-1900"] },
  HR_GA: { REKRUTMEN: ["HRGA_REKRUTMEN", "6-1900"], PELATIHAN: ["HRGA_PELATIHAN", "6-1900"], KESEJAHTERAAN: ["HRGA_KESEJAHTERAAN", "6-1900"], ATK_KANTOR: ["PERLENGKAPAN", "6-1600"], PERAWATAN_FASILITAS: ["HRGA_PERAWATAN_FASILITAS", "6-1900"], PERIZINAN_ADMINISTRASI: ["HRGA_PERIZINAN", "6-1900"] },
};

// ── pemetaan kategori ────────────────────────────────────────────────────────────────────────────────────────────

test("Audit pemetaan: setiap jenis biaya tiap divisi jatuh ke kategori & akun resmi yang benar (tanpa fallback), dan config menandainya siap", async () => {
  const ctx = await siapkan();
  for (const [ws, peta] of Object.entries(PETA)) {
    const cfg = await ctx.c.fin.get(`${PB}/config?workspace=${ws}`);
    assert.equal(cfg.status, 200, JSON.stringify(cfg.body));
    assert.deepEqual(cfg.body.expenseTypes.map((t) => t.code).sort(), Object.keys(peta).sort(), `${ws}: jenis biaya`);
    assert.ok(cfg.body.expenseTypes.every((t) => t.siap === true), `${ws}: semua siap`);
    assert.ok(!cfg.body.expenseTypes.some((t) => /ASET|PAYROLL|KASBON|STOK|BAHAN/.test(t.code)), `${ws}: tidak ada jenis aset/payroll/kasbon/stok`);
    assert.ok(cfg.body.arahanModulLain.length >= 4);
    for (const [tipe, [kode, akun]] of Object.entries(peta)) {
      const d = await ctx.c.fin.post(PB, body(ws, tipe, { requestedById: undefined, urgentReason: "Mendesak untuk pengujian" }));
      assert.equal(d.status, 201, `${ws}/${tipe}: ${JSON.stringify(d.body)}`);
      await bukti(d.body.id, ctx.u.fin.user.id);
      const aj = await ajukan(ctx.c.fin, d.body.id);
      assert.equal(aj.status, 200, `${ws}/${tipe}: ${JSON.stringify(aj.body)}`);
      const fe = await feDari(aj.body.finExpenseId);
      assert.equal(fe.category.code, kode, `${ws}/${tipe} kategori`); assert.equal(fe.category.account.code, akun, `${ws}/${tipe} akun`);
      assert.equal(fe.division, ws);
    }
  }
});

test("Kategori belum terpasang / nonaktif: jenis biaya ditandai belum siap, draf & pengajuan DIBLOKIR dengan penjelasan konfigurasi (tanpa fallback)", async () => {
  const ctx = await siapkan();
  await testPrisma.finExpenseCategory.update({ where: { code: "MKT_EVENT" }, data: { active: false } });
  await testPrisma.finExpenseCategory.delete({ where: { code: "HRGA_PELATIHAN" } });
  const cfg = await ctx.c.sales.get(`${PB}/config?workspace=MARKETING`);
  const event = cfg.body.expenseTypes.find((t) => t.code === "EVENT");
  assert.equal(event.siap, false); assert.match(event.alasanTidakSiap, /MKT_EVENT.*nonaktif.*Finance/);
  const r = await ctx.c.sales.post(PB, body("MARKETING", "EVENT"));
  assert.equal(r.status, 422); assert.match(r.body.error, /nonaktif/);
  const hr = await ctx.c.fin.post(PB, body("HR_GA", "PELATIHAN"));
  assert.equal(hr.status, 422); assert.match(hr.body.error, /HRGA_PELATIHAN.*belum terpasang.*Pasang Akun Bawaan/);
  assert.equal(await testPrisma.expenseSubmission.count(), 0);
  // jenis lain tetap jalan
  assert.equal((await ctx.c.sales.post(PB, body("MARKETING", "KONTEN"))).status, 201);
});

// ── alur per divisi ──────────────────────────────────────────────────────────────────────────────────────────────

test("Marketing: Sales mengajukan (keperluan wajib, campaign/channel/periode opsional) → Finance menyetujui → dibayar; konteks tersimpan", async () => {
  const ctx = await siapkan();
  const d = await ctx.c.sales.post(PB, body("MARKETING", "KONTEN", { metadata: { keperluan: "Video promo", campaign: "Promo Kasur Oktober", channel: "Instagram", periodStart: "2026-10-01", periodEnd: "2026-10-31" } }));
  assert.equal(d.status, 201, JSON.stringify(d.body));
  assert.equal(d.body.division, "MARKETING"); assert.equal(d.body.metadata.channel, "Instagram");
  const tanpaKeperluan = await ctx.c.sales.post(PB, body("MARKETING", "EVENT", { metadata: { campaign: "X" } }));
  await bukti(tanpaKeperluan.body.id, ctx.u.sales.user.id);
  const gagal = await ajukan(ctx.c.sales, tanpaKeperluan.body.id);
  assert.equal(gagal.status, 422); assert.match(gagal.body.error, /Keperluan \/ kegiatan wajib diisi/);

  await bukti(d.body.id, ctx.u.sales.user.id);
  const aj = await ajukan(ctx.c.sales, d.body.id);
  assert.equal(aj.status, 200, JSON.stringify(aj.body));
  const fe = await feDari(aj.body.finExpenseId);
  assert.equal(fe.mode, "UTANG");
  assert.equal((await ctx.c.fin.post(`/api/finance/expenses/${fe.id}/approve`, {})).status, 200);
  assert.equal((await ctx.c.sales.get(`${PB}/${d.body.id}`)).body.status, "DISETUJUI");
  const pay = await ctx.c.fin.post(`/api/finance/expenses/${fe.id}/pay`, { cashAccountId: ctx.bank.id });
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  assert.equal((await ctx.c.sales.get(`${PB}/${d.body.id}`)).body.status, "DIBAYAR");
  assert.equal(await testPrisma.finExpense.count({ where: { division: "MARKETING" } }), 1);
});

test("Management & HR-GA: Owner/Admin/Finance mengajukan; jenis dengan alasan mendesak wajib; Finance mencatat atas nama pemohon lain dengan sumber permintaan & waktu terpisah", async () => {
  const ctx = await siapkan();
  const khusus = await ctx.c.owner.post(PB, body("MANAGEMENT", "OPERASIONAL_KHUSUS"));
  assert.equal(khusus.status, 201, JSON.stringify(khusus.body));
  await bukti(khusus.body.id, ctx.u.owner.user.id);
  const g = await ajukan(ctx.c.owner, khusus.body.id);
  assert.equal(g.status, 422); assert.match(g.body.error, /Alasan mendesak/);
  assert.equal((await ctx.c.owner.patch(`${PB}/${khusus.body.id}`, { urgentReason: "Izin mendadak dari instansi" })).status, 200);
  assert.equal((await ajukan(ctx.c.owner, khusus.body.id, "khusus-1234")).status, 200);

  const at = await ctx.c.fin.post(PB, body("HR_GA", "REKRUTMEN", {
    requestedById: ctx.u.adm.user.id, picUserId: ctx.u.owner.user.id, requestedAt: "2026-09-26T02:00:00Z", sourceNote: "Diminta via WhatsApp HRD", urgentReason: "Lowongan ditutup besok",
    metadata: { kegiatan: "Iklan lowongan operator", lokasi: "Jakarta", jumlahOrang: 3 },
  }));
  assert.equal(at.status, 201, JSON.stringify(at.body));
  assert.equal(at.body.requestedById, ctx.u.adm.user.id, "pemohon = Admin"); assert.equal(at.body.createdById, ctx.u.fin.user.id, "pencatat = Finance");
  assert.equal(at.body.picUserId, ctx.u.owner.user.id); assert.equal(at.body.sourceNote, "Diminta via WhatsApp HRD"); assert.equal(at.body.urgentReason, "Lowongan ditutup besok");
  assert.ok(at.body.requestedAt);
  const mkt = await ctx.c.fin.post(PB, body("MARKETING", "CETAK_PROMO", { requestedById: ctx.u.sales.user.id }));
  assert.equal(mkt.status, 201); assert.equal(mkt.body.requestedById, ctx.u.sales.user.id);
  // Sales tidak boleh mencatat atas nama orang lain
  const salah = await ctx.c.sales.post(PB, body("MARKETING", "CETAK_PROMO", { requestedById: ctx.u.sales2.user.id }));
  assert.equal(salah.status, 403); assert.match(salah.body.error, /Hanya Finance/);
});

test("Revisi → perbaikan → ajukan ulang (Marketing); orang lain tidak bisa memperbaiki", async () => {
  const ctx = await siapkan();
  const d = await ctx.c.sales.post(PB, body("MARKETING", "TOOLS_MARKETING"));
  await bukti(d.body.id, ctx.u.sales.user.id);
  const aj = await ajukan(ctx.c.sales, d.body.id);
  const lama = aj.body.finExpenseId;
  const rv = await ctx.c.fin.post(`${PB}/${d.body.id}/minta-revisi`, { reason: "Nominal harus sesuai invoice" }, { "Idempotency-Key": "revisi-c2-0001" });
  assert.equal(rv.status, 200, JSON.stringify(rv.body)); assert.equal(rv.body.status, "PERLU_REVISI");
  assert.equal((await ctx.c.sales2.patch(`${PB}/${d.body.id}`, { amount: 100000 })).status, 403);
  assert.equal((await ctx.c.sales.patch(`${PB}/${d.body.id}`, { amount: 200_000 })).status, 200);
  const ulang = await ajukan(ctx.c.sales, d.body.id, "ajukan-ulang-c2");
  assert.equal(ulang.status, 200); assert.notEqual(ulang.body.finExpenseId, lama);
  assert.equal(Number((await feDari(ulang.body.finExpenseId)).amount), 200_000);
});

// ── sumber dana ──────────────────────────────────────────────────────────────────────────────────────────────────

test("Sumber dana (Marketing): uang muka aktif wajib dipilih & milik pemohon/PIC; talangan → reimbursement ke pemohon; belum dibayar/rekening → utang", async () => {
  const ctx = await siapkan();
  const um = await ctx.c.adm.post("/api/finance/uang-muka", { holderId: ctx.u.sales.user.id, division: "MARKETING", purpose: "Uang lapangan event", date: "2026-09-20", dueDate: "2026-10-05", amount: 1_000_000, cashAccountId: ctx.bank.id });
  assert.equal(um.status, 201, JSON.stringify(um.body));
  const aktif = await ctx.c.sales.get(`${PB}/uang-muka-aktif`);
  assert.equal(aktif.body.items.length, 1);

  const a = await ctx.c.sales.post(PB, body("MARKETING", "EVENT", { sumberDana: "UANG_MUKA_OPERASIONAL" }));
  await bukti(a.body.id, ctx.u.sales.user.id);
  const tanpa = await ajukan(ctx.c.sales, a.body.id);
  assert.equal(tanpa.status, 422); assert.match(tanpa.body.error, /uang muka aktif/);
  assert.equal((await ctx.c.sales2.post(PB, body("MARKETING", "EVENT", { sumberDana: "UANG_MUKA_OPERASIONAL", advanceId: um.body.id }))).status, 403, "uang muka milik orang lain");
  assert.equal((await ctx.c.sales.patch(`${PB}/${a.body.id}`, { advanceId: um.body.id })).status, 200);
  const ok = await ajukan(ctx.c.sales, a.body.id, "um-marketing-01");
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal((await feDari(ok.body.finExpenseId)).mode, "UANG_MUKA");

  for (const [sumber, mode] of [["TALANGAN_PRIBADI", "REIMBURSEMENT"], ["BELUM_DIBAYAR", "UTANG"], ["REKENING_PERUSAHAAN", "UTANG"]]) {
    const d = await ctx.c.sales.post(PB, body("MARKETING", "KONTEN", { sumberDana: sumber, amount: 90_000 }));
    await bukti(d.body.id, ctx.u.sales.user.id);
    const fe = await feDari((await ajukan(ctx.c.sales, d.body.id)).body.finExpenseId);
    assert.equal(fe.mode, mode, sumber);
    if (sumber === "TALANGAN_PRIBADI") assert.equal(fe.reimburseToId, ctx.u.sales.user.id);
  }
});

// ── isolasi akses lintas divisi ──────────────────────────────────────────────────────────────────────────────────

test("Isolasi akses: Sales hanya Marketing; PL/Gudang/Dispatcher tidak ke divisi baru; Management & HR-GA hanya Finance/Admin/Owner; hanya milik sendiri", async () => {
  const ctx = await siapkan();
  for (const k of ["pl", "wh", "disp"]) for (const ws of ["MARKETING", "MANAGEMENT", "HR_GA"]) {
    assert.equal((await ctx.c[k].get(`${PB}/config?workspace=${ws}`)).status, 403, `${k}→${ws} config`);
    assert.equal((await ctx.c[k].post(PB, body(ws, Object.keys(PETA[ws])[0]))).status, 403, `${k}→${ws} buat`);
  }
  for (const ws of ["MANAGEMENT", "HR_GA", "PRODUKSI", "WAREHOUSE"]) {
    assert.equal((await ctx.c.sales.get(`${PB}/config?workspace=${ws}`)).status, 403, `sales→${ws}`);
    assert.equal((await ctx.c.sales.get(`${PB}?division=${ws === "WAREHOUSE" ? "GUDANG" : ws}`)).status, 403);
  }
  assert.equal((await ctx.c.pl.get(`${PB}/config?workspace=PRODUKSI`)).status, 200, "C1 tidak berubah");
  assert.equal((await ctx.c.sales.get(`${PB}/config?workspace=MARKETING`)).status, 200);
  assert.equal((await ctx.c.sales.get(`${PB}/opsi?workspace=MANAGEMENT`)).status, 403);
  const opsiMkt = await ctx.c.sales.get(`${PB}/opsi?workspace=MARKETING`);
  assert.equal(opsiMkt.status, 200); assert.ok(opsiMkt.body.pengguna.every((p) => [ctx.u.sales.user.id, ctx.u.sales2.user.id].includes(p.id)), "PIC Marketing hanya pengguna Sales");

  const milik = await ctx.c.sales.post(PB, body("MARKETING", "KONTEN"));
  const hr = await ctx.c.fin.post(PB, body("HR_GA", "PELATIHAN"));
  const mg = await ctx.c.adm.post(PB, body("MANAGEMENT", "KONSULTAN"));
  assert.equal((await ctx.c.sales.get(`${PB}/${hr.body.id}`)).status, 404, "Sales tidak melihat HR-GA");
  assert.equal((await ctx.c.sales.get(`${PB}/${mg.body.id}`)).status, 404);
  assert.equal((await ctx.c.pl.get(`${PB}/${milik.body.id}`)).status, 404, "PL tidak melihat Marketing");
  assert.equal((await ctx.c.sales2.get(`${PB}/${milik.body.id}`)).status, 403, "sesama Sales hanya miliknya");
  assert.equal((await ctx.c.sales2.patch(`${PB}/${milik.body.id}`, { amount: 1 })).status, 403);
  assert.equal((await ctx.c.sales.post(`${PB}/${hr.body.id}/ajukan`, {}, { "Idempotency-Key": "silang-hrga-0001" })).status, 404);
  assert.deepEqual((await ctx.c.sales.get(PB)).body.submissions.map((s) => s.id), [milik.body.id]);
  for (const k of ["fin", "adm", "owner"]) assert.equal((await ctx.c[k].get(PB)).body.submissions.length, 3, `${k} melihat seluruh pengajuan`);
  const opsiFin = await ctx.c.fin.get(`${PB}/opsi?workspace=HR_GA`);
  assert.equal(opsiFin.status, 200); assert.ok(opsiFin.body.pengguna.length >= 8, "HR-GA: staf Finance melihat daftar pengguna untuk pemohon/PIC");
});

// ── penolakan modul lain & anti double-count ─────────────────────────────────────────────────────────────────────

test("Aset, payroll, kasbon, antarbank, tagihan supplier, belanja iklan platform, dan stok ditolak dengan arahan modul yang benar", async () => {
  const ctx = await siapkan();
  const kasus = [
    ["ASET", /Aset tetap.*Finance › Pembelian/], ["ASET_KANTOR", /Aset tetap/], ["PAYROLL", /Payroll.*Jurnal Umum/], ["GAJI", /payroll/i], ["BONUS", /payroll/i],
    ["KASBON", /Kasbon karyawan.*Finance › Kasbon/], ["PINJAMAN_KARYAWAN", /Finance › Kasbon/], ["TRANSFER_BANK", /antarbank.*Kas & Bank/], ["PINDAH_DANA", /Kas & Bank/],
    ["TAGIHAN_SUPPLIER", /Tagihan supplier.*Supplier & Utang/], ["BELANJA_IKLAN", /Biaya Iklan/], ["BAHAN_BAKU", /urusan stok\/pembelian/], ["PERSEDIAAN", /urusan stok\/pembelian/], ["BARANG_DAGANG", /Penerimaan Barang/],
  ];
  for (const ws of ["MARKETING", "MANAGEMENT", "HR_GA"]) for (const [tipe, pola] of kasus) {
    const r = await ctx.c.fin.post(PB, { workspace: ws, expenseType: tipe, date: "2026-09-26", amount: 1_000_000 });
    assert.equal(r.status, 422, `${ws}/${tipe}`); assert.match(r.body.error, pola, `${ws}/${tipe}: ${r.body.error}`);
    assert.match(r.body.error, /tidak diproses lewat Pengajuan Biaya|urusan stok\/pembelian/);
  }
  assert.equal(await testPrisma.expenseSubmission.count(), 0);
  assert.equal(await testPrisma.finExpense.count(), 0); assert.equal(await testPrisma.finJournalEntry.count(), 0);
});

test("Anti double-count: dokumen Pembelian/Tagihan/Kasbon/Uang Muka/Transfer Kas/Pengeluaran/Inventory ditolak (kolom & teks bebas); tautan order/unit/dokumen tidak berlaku", async () => {
  const ctx = await siapkan();
  const sup = await testPrisma.finSupplier.create({ data: { code: "SUP-C2", name: "PT C2" } });
  await testPrisma.finSupplierBill.create({ data: { billNumber: "BILL-260926-001", supplierId: sup.id, billDate: new Date("2026-09-26"), amount: 1_000_000, description: "Cetak", status: "MENUNGGU_APPROVAL" } });
  const cat = await testPrisma.finPurchaseCategory.findFirst();
  await testPrisma.finPurchase.create({ data: { purchaseNumber: "PUR-260926-001", date: new Date("2026-09-26"), amount: 500_000, description: "Laptop", categoryId: cat.id, status: "MENUNGGU_APPROVAL" } });
  await testPrisma.goodsReceipt.create({ data: { receiptNumber: "GR-260926-01", sourceType: "MANUAL", supplier: "PT X", status: "COMPLETED" } });
  const ksb = await testPrisma.finKasbon.create({ data: { kasbonNumber: "KSB-260926-001", employeeName: "Karyawan Uji", employeeId: ctx.u.sales.user.id, date: new Date("2026-09-26"), amount: 300_000 } });
  const um = await ctx.c.adm.post("/api/finance/uang-muka", { holderId: ctx.u.sales.user.id, division: "MARKETING", purpose: "Lapangan", date: "2026-09-20", dueDate: "2026-10-05", amount: 500_000, cashAccountId: ctx.bank.id });
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "PERLENGKAPAN" } });
  await testPrisma.finExpense.create({ data: { expenseNumber: "EXP-260926-001", date: new Date("2026-09-26"), amount: 50_000, description: "x", categoryId: kat.id, division: "UMUM", mode: "UTANG", status: "MENUNGGU_APPROVAL" } });

  const teks = ["BILL-260926-001", "PUR-260926-001", "GR-260926-01", "EXP-260926-001", um.body.advanceNumber, ksb.kasbonNumber];
  for (const no of teks) {
    const r = await ctx.c.sales.post(PB, body("MARKETING", "KONTEN", { description: `Cetak spanduk sesuai ${no}` }));
    assert.equal(r.status, 409, no); assert.match(r.body.error, /terhitung dua kali/);
  }
  // tautan yang tidak berlaku untuk workspace ini
  for (const ekstra of [{ documentRef: "BILL-260926-001" }, { orderId: "00000000-0000-0000-0000-000000000000" }, { unitId: "00000000-0000-0000-0000-000000000000" }, { vehicleId: "00000000-0000-0000-0000-000000000000" }, { warehouseId: "00000000-0000-0000-0000-000000000000" }]) {
    const r = await ctx.c.sales.post(PB, body("MARKETING", "KONTEN", ekstra));
    assert.equal(r.status, 422, JSON.stringify(ekstra)); assert.match(r.body.error, /tidak berlaku/);
  }
  // draf tidak bisa menyelundupkan dokumen lewat ubah/ajukan
  const d = await ctx.c.sales.post(PB, body("MARKETING", "KONTEN"));
  assert.equal((await ctx.c.sales.patch(`${PB}/${d.body.id}`, { notes: "lihat tagihan BILL-260926-001" })).status, 409);
  await testPrisma.expenseSubmission.update({ where: { id: d.body.id }, data: { description: "ganti PUR-260926-001" } });
  await bukti(d.body.id, ctx.u.sales.user.id);
  assert.equal((await ajukan(ctx.c.sales, d.body.id)).status, 409, "guard berjalan lagi saat diajukan");
  assert.equal(await testPrisma.finJournalEntry.count(), 1, "hanya jurnal uang muka dari fixture");
  assert.equal(await testPrisma.stockMovement.count(), 0);
});

// ── duplikat & klik ganda & permission ───────────────────────────────────────────────────────────────────────────

test("Duplikat hanya PERINGATAN dengan konteks divisi (campaign/channel/kegiatan/lokasi/peserta), tanggal, nominal, PIC, dan status bukti", async () => {
  const ctx = await siapkan();
  const a = await ctx.c.sales.post(PB, body("MARKETING", "KONTEN", { amount: 250_000, picUserId: ctx.u.sales2.user.id, metadata: { keperluan: "Video promo", campaign: "Promo Oktober", channel: "TikTok" } }));
  await bukti(a.body.id, ctx.u.sales.user.id);
  const q = "division=MARKETING&expenseType=KONTEN&date=2026-09-27&amount=250000";
  const cek = await ctx.c.sales.get(`${PB}/duplicate-check?${q}`);
  assert.equal(cek.status, 200); assert.equal(cek.body.kandidat.length, 1);
  const k = cek.body.kandidat[0];
  assert.equal(k.amount, 250_000); assert.equal(k.adaBukti, true); assert.equal(k.pemohon !== null, true);
  assert.match(k.konteks, /Campaign Promo Oktober/); assert.match(k.konteks, /Channel TikTok/);
  assert.equal((await ctx.c.sales.post(PB, body("MARKETING", "KONTEN", { date: "2026-09-27" }))).status, 201, "duplikat tidak diblokir");
  assert.equal((await ctx.c.sales.get(`${PB}/duplicate-check?${q.replace("250000", "111")}`)).body.kandidat.length, 0);
  assert.equal((await ctx.c.pl.get(`${PB}/duplicate-check?${q}`)).status, 403);

  const h = await ctx.c.fin.post(PB, body("HR_GA", "PELATIHAN", { amount: 900_000, metadata: { kegiatan: "Pelatihan K3", lokasi: "Bekasi", jumlahOrang: 12 } }));
  const ch = await ctx.c.fin.get(`${PB}/duplicate-check?division=HR_GA&expenseType=PELATIHAN&date=2026-09-26&amount=900000`);
  assert.match(ch.body.kandidat[0].konteks, /Lokasi Bekasi · Peserta 12 orang/);
  assert.ok(h.body.id);
});

test("Klik ganda / paralel: satu FinExpense per pengajuan (Marketing & HR-GA)", async () => {
  const ctx = await siapkan();
  for (const [client, u, ws, tipe] of [[ctx.c.sales, ctx.u.sales, "MARKETING", "EVENT"], [ctx.c.fin, ctx.u.fin, "HR_GA", "REKRUTMEN"]]) {
    const d = await client.post(PB, body(ws, tipe));
    await bukti(d.body.id, u.user.id);
    const sama = await Promise.all([...Array(5)].map(() => ajukan(client, d.body.id, `sama-${ws}-paralel`)));
    assert.ok(sama.every((r) => [200, 409].includes(r.status)) && sama.some((r) => r.status === 200), JSON.stringify(sama.map((r) => [r.status, r.body?.error])));
    const beda = await Promise.all([...Array(4)].map((_, i) => ajukan(client, d.body.id, `beda-${ws}-${i}-paralel`)));
    assert.ok(beda.every((r) => [200, 409].includes(r.status)));
    assert.equal(new Set([...sama, ...beda].filter((r) => r.status === 200).map((r) => r.body.finExpenseId)).size, 1);
    assert.equal(await testPrisma.finExpense.count({ where: { division: ws } }), 1, ws);
  }
});

test("Permission 403 & bentuk 401/404: tanpa hak submit, tanpa workspace, dan aksi milik orang lain", async () => {
  const ctx = await siapkan();
  const tanpaToken = makeClient(server.baseUrl, null);
  assert.equal((await tanpaToken.get(`${PB}/config?workspace=MARKETING`)).status, 401);
  assert.equal((await ctx.c.sales.get(`${PB}/config?workspace=TIDAK_ADA`)).status, 404);
  const d = await ctx.c.sales.post(PB, body("MARKETING", "KONTEN"));
  assert.equal((await ctx.c.sales2.post(`${PB}/${d.body.id}/ajukan`, {}, { "Idempotency-Key": "orang-lain-0001" })).status, 403);
  assert.equal((await ctx.c.sales2.post(`${PB}/${d.body.id}/batalkan`, { reason: "x" })).status, 403);
  assert.equal((await ctx.c.sales2.post(`${PB}/${d.body.id}/metadata`, { reason: "x", changes: { notes: "y" } })).status, 403);
  const salesTanpaFinance = await ctx.c.sales.post(`${PB}/${d.body.id}/minta-revisi`, { reason: "x" }, { "Idempotency-Key": "revisi-bukan-fin-01" });
  assert.equal(salesTanpaFinance.status, 403);
  assert.equal((await ctx.c.sales.post(PB, body("HR_GA", "PELATIHAN"))).status, 403);
});
