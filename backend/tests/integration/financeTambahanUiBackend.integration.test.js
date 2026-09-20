// Backend untuk perbaikan UI Finance (20 Sep 2026): (1) daftar pengeluaran/pembelian menandai `notaWajib` supaya tombol Setujui tidak
// tampak aktif padahal server menolak 422; (2) daftar karyawan Kasbon hanya karyawan Sano; (3) penjaga nama kasbon.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { notaWajibDenganAmbang } from "../../src/services/finance/receipts.js";
import { alasanBukanKaryawan } from "../../src/services/finance/karyawan.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const rekening = await testPrisma.finCashAccount.create({ data: { name: "Kas Kantor", kind: "KAS", accountId: akunKas.id } });
  return { rekening };
}
const user = (name, email, role, { active = true, roles = [role] } = {}) => testPrisma.user.create({
  data: { name, email, passwordHash: bcrypt.hashSync("x", 4), role, active, roles: { create: roles.map((r) => ({ role: r })) } },
});

test("notaWajibDenganAmbang = aturan notaWajib: pembelian selalu; reimbursement selalu; kategori gaji/upah/admin bank tidak; sisanya ≥ ambang", () => {
  const a = 500_000;
  assert.equal(notaWajibDenganAmbang({ jenis: "purchase", mode: "LANGSUNG", amount: 1, categoryCode: "BAHAN_BAKU_MANUAL" }, a), true);
  assert.equal(notaWajibDenganAmbang({ jenis: "expense", mode: "REIMBURSEMENT", amount: 1000, categoryCode: "BBM" }, a), true);
  assert.equal(notaWajibDenganAmbang({ jenis: "expense", mode: "LANGSUNG", amount: 499_999, categoryCode: "BBM" }, a), false);
  assert.equal(notaWajibDenganAmbang({ jenis: "expense", mode: "LANGSUNG", amount: 500_000, categoryCode: "BBM" }, a), true);
  assert.equal(notaWajibDenganAmbang({ jenis: "expense", mode: "LANGSUNG", amount: 9_000_000, categoryCode: "GAJI_KARYAWAN" }, a), false);
  assert.equal(notaWajibDenganAmbang({ jenis: "expense", mode: "REIMBURSEMENT", amount: 9_000_000, categoryCode: "UPAH_PRODUKSI" }, a), false);
});

test("Daftar pengeluaran & pembelian membawa notaWajib dan cashAccount (sumber dana); konsisten dengan penolakan Setujui 422", async () => {
  const { rekening } = await siapkan();
  const fin = await createTestUser({ roles: ["FINANCE", "ADMIN"] });
  const pembuat = await createTestUser({ roles: ["FINANCE"] });
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "SERVIS_KENDARAAN" } });
  const katBeli = await testPrisma.finPurchaseCategory.findFirst();
  const dasar = { date: new Date("2026-09-17T00:00:00Z"), categoryId: kat.id, mode: "LANGSUNG", cashAccountId: rekening.id, status: "MENUNGGU_APPROVAL", createdById: pembuat.user.id, description: "uji" };
  const besar = await testPrisma.finExpense.create({ data: { ...dasar, expenseNumber: "EXP-T-1", amount: 550_000 } });
  const kecil = await testPrisma.finExpense.create({ data: { ...dasar, expenseNumber: "EXP-T-2", amount: 100_000 } });
  const beli = await testPrisma.finPurchase.create({ data: { ...dasar, purchaseNumber: "PUR-T-1", categoryId: katBeli.id, amount: 12_000 } });

  const c = makeClient(server.baseUrl, fin.token);
  const ex = (await c.get("/api/finance/expenses?from=2026-09-01&to=2026-09-30")).body.expenses;
  assert.equal(ex.find((e) => e.id === besar.id).notaWajib, true);
  assert.equal(ex.find((e) => e.id === kecil.id).notaWajib, false);
  assert.equal(ex.find((e) => e.id === besar.id).cashAccount.name, "Kas Kantor", "sumber dana tersedia untuk kolom tabel");
  const pu = (await c.get("/api/finance/purchases?from=2026-09-01&to=2026-09-30")).body.purchases;
  assert.equal(pu.find((p) => p.id === beli.id).notaWajib, true);

  // Penanda cocok dengan perilaku server: yang notaWajib & tanpa foto ditolak 422, yang tidak wajib disetujui.
  const tolak = await c.post(`/api/finance/expenses/${besar.id}/approve`, {});
  assert.equal(tolak.status, 422);
  assert.match(tolak.body.error, /wajib punya foto nota/);
  const ok = await c.post(`/api/finance/expenses/${kecil.id}/approve`, {});
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

test("Aturan karyawan Sano: aktif saja; akun bersama owner, kurir eksternal, dan akun nonaktif dikecualikan", () => {
  assert.equal(alasanBukanKaryawan({ name: "Imam", email: "imam@klinikmatras.com", active: true }), null);
  assert.equal(alasanBukanKaryawan({ name: "Gilang", email: "gilang@klinikmatras.com", active: true }), null, "pemilik yang juga karyawan tetap boleh");
  assert.match(alasanBukanKaryawan({ name: "Farhan", email: "farhan@klinikmatras.com", active: false }), /dinonaktifkan/);
  assert.match(alasanBukanKaryawan({ name: "OWNER (Admin)", email: "admin@klinikmatras.com", active: true }), /owner/);
  assert.match(alasanBukanKaryawan({ name: "Kurir Eksternal (Lalamove/dst)", email: "kurir.eksternal@klinikmatras.com", active: true }), /kurir/);
});

test("Pilihan karyawan kasbon: hanya karyawan aktif (semua peran), tanpa nonaktif/OWNER (Admin)/Kurir Eksternal/nama lama dari riwayat", async () => {
  const { rekening } = await siapkan();
  const fin = await createTestUser({ roles: ["FINANCE", "ADMIN"] });
  await user("Agung", "agung@klinikmatras.com", "DRIVER", { roles: ["DRIVER", "HELPER"] });
  await user("Kiki", "kiki@klinikmatras.com", "SALES");
  await user("Ferdy", "ferdy@klinikmatras.com", "PRODUCTION_LEAD", { roles: ["PRODUCTION_LEAD", "QC_LEAD"] });
  await user("Juri", "juri@klinikmatras.com", "ADMIN", { roles: ["ADMIN", "FINANCE", "OWNER"] });
  await user("Farhan", "farhan@klinikmatras.com", "SALES", { active: false });
  await user("Mila", "mila@klinikmatras.com", "SALES", { active: false });
  await user("OWNER (Admin)", "admin@klinikmatras.com", "ADMIN");
  await user("Kurir Eksternal (Lalamove/dst)", "kurir.eksternal@klinikmatras.com", "DRIVER");
  await testPrisma.finKasbon.create({ data: { kasbonNumber: "KSB-T-1", date: new Date("2026-09-01T00:00:00Z"), amount: 100_000, employeeName: "Tidak Dicatat", urgency: "lama", cashAccountId: rekening.id, createdById: fin.user.id } });

  const r = await makeClient(server.baseUrl, fin.token).get("/api/finance/kasbon/karyawan-nama");
  assert.equal(r.status, 200);
  for (const n of ["Agung", "Kiki", "Ferdy", "Juri"]) assert.ok(r.body.nama.includes(n), `${n} harus ada`);
  for (const n of ["Farhan", "Mila", "OWNER (Admin)", "Kurir Eksternal (Lalamove/dst)", "Tidak Dicatat"]) assert.equal(r.body.nama.includes(n), false, `${n} tidak boleh ada`);
  assert.deepEqual(r.body.karyawan.find((k) => k.name === "Agung").roles.sort(), ["DRIVER", "HELPER"]);
  assert.deepEqual([...r.body.nama], [...r.body.nama].sort((a, b) => a.localeCompare(b, "id")), "urut abjad");
});

test("Kasbon baru/edit ke akun nonaktif, owner bersama, atau kurir eksternal ditolak 400; karyawan aktif & nama tanpa akun tetap lolos", async () => {
  const { rekening } = await siapkan();
  const fin = await createTestUser({ roles: ["FINANCE", "ADMIN"] });
  await user("Imam", "imam@klinikmatras.com", "PRODUCTION_LEAD");
  await user("Farhan", "farhan@klinikmatras.com", "SALES", { active: false });
  await user("OWNER (Admin)", "admin@klinikmatras.com", "ADMIN");
  const c = makeClient(server.baseUrl, fin.token);
  const kirim = (nama) => c.post("/api/finance/kasbon", { date: "2026-09-19", amount: 100_000, employeeName: nama, urgency: "keperluan mendesak", cashAccountId: rekening.id });

  for (const nama of ["farhan", "OWNER (Admin)", "Kurir Eksternal (Lalamove/dst)"]) {
    const r = await kirim(nama);
    assert.equal(r.status, 400, nama);
    assert.match(r.body.error, /Kasbon tidak bisa diberikan/);
  }
  assert.equal(await testPrisma.finKasbon.count(), 0, "tidak ada kasbon/jurnal yang terbentuk");
  const ok = await kirim("imam");
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal((await kirim("Karyawan Baru Belum Punya Akun")).status, 201);

  const ubah = await c.patch(`/api/finance/kasbon/${ok.body.id}`, { employeeName: "Farhan", reason: "salah nama" });
  assert.equal(ubah.status, 400);
  assert.match(ubah.body.error, /Kasbon tidak bisa diberikan/);
});

test("Terintegrasi: akun baru lewat Pengguna & Peran otomatis jadi pilihan karyawan kasbon; dinonaktifkan/diaktifkan ulang ikut berubah", async () => {
  await siapkan();
  const admin = await createTestUser({ roles: ["ADMIN", "FINANCE"] });
  const c = makeClient(server.baseUrl, admin.token);
  const daftar = async () => (await c.get("/api/finance/kasbon/karyawan-nama")).body.nama;

  assert.equal((await daftar()).includes("Karyawan Baru Uji"), false);
  const buat = await c.post("/api/users", { name: "Karyawan Baru Uji", email: "baru.uji@klinikmatras.com", password: "rahasia123", role: "DRIVER" });
  assert.equal(buat.status, 201, JSON.stringify(buat.body));
  assert.ok((await daftar()).includes("Karyawan Baru Uji"), "akun baru langsung jadi pilihan tanpa langkah tambahan");

  const off = await c.patch(`/api/users/${buat.body.id}`, { active: false });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal((await daftar()).includes("Karyawan Baru Uji"), false, "dinonaktifkan → hilang dari pilihan");
  await c.patch(`/api/users/${buat.body.id}`, { active: true });
  assert.ok((await daftar()).includes("Karyawan Baru Uji"), "diaktifkan lagi → muncul lagi");

  const ganti = await c.patch(`/api/users/${buat.body.id}`, { name: "Nama Sudah Diganti" });
  assert.equal(ganti.status, 200);
  const d = await daftar();
  assert.ok(d.includes("Nama Sudah Diganti") && !d.includes("Karyawan Baru Uji"), "ganti nama ikut");
});
