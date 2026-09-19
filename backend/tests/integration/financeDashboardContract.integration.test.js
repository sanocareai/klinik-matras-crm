// KONTRAK GET /api/finance/dashboard yang dipakai Finance Mobile (Beranda, slice S3).
//
// Aplikasi mobile memetakan respons ini secara defensif (bagian yang hilang → "data belum tersedia"),
// tapi bentuk normalnya HARUS stabil. Tes ini mengunci kunci & tipe yang dibaca klien — kalau kontrak
// berubah, tes gagal di sini dulu, bukan di HP pengguna. Isi angkanya bukan urusan file ini
// (itu financeLedger.integration.test.js); yang dijaga: bentuk, tipe, dan izin per peran.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";

let server;
const klien = {};

test.before(async () => {
  await truncateAll();
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const rekening = await testPrisma.finCashAccount.create({ data: { name: "Kas Kantor", kind: "KAS", accountId: akunKas.id } });
  await setSetting(testPrisma, SETTING_KEYS.CASH_ACCOUNT_CASH, rekening.id);

  server = await startTestServer(buildTestApp());
  for (const role of ["FINANCE", "ACCOUNTANT", "APPROVER", "OWNER", "SALES"]) {
    const { token } = await createTestUser({ roles: [role] });
    klien[role] = makeClient(server.baseUrl, token);
  }
});
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const adalahUang = (v) => typeof v === "number" && Number.isFinite(v);

test("dashboard: bentuk & tipe yang dibaca Finance Mobile", async () => {
  const res = await klien.FINANCE.get("/api/finance/dashboard?from=2026-09-01&to=2026-09-30");
  assert.equal(res.status, 200);
  const d = res.body;

  assert.deepEqual(d.periode, { from: "2026-09-01", to: "2026-09-30" });

  assert.ok(Array.isArray(d.kasBank) && d.kasBank.length >= 1);
  for (const k of d.kasBank) {
    assert.equal(typeof k.id, "string");
    assert.equal(typeof k.name, "string");
    assert.ok(["KAS", "BANK", "EWALLET"].includes(k.kind), `kind tak dikenal: ${k.kind}`);
    assert.ok(adalahUang(k.saldo));
  }
  assert.ok(adalahUang(d.totalKas));

  for (const kunci of ["pendapatanBruto", "retur", "pendapatanBersih", "bebanPokok", "labaKotor", "bebanOperasional", "labaBersih"]) {
    assert.ok(adalahUang(d.labaRugi[kunci]), `labaRugi.${kunci}`);
  }
  // margin = persen (bukan uang); boleh null/number tergantung ada pendapatan atau tidak.
  for (const kunci of ["marginKotor", "marginBersih"]) {
    assert.ok(d.labaRugi[kunci] === null || typeof d.labaRugi[kunci] === "number", `labaRugi.${kunci}`);
  }

  for (const bagian of ["piutang", "utang"]) {
    assert.ok(adalahUang(d[bagian].total), `${bagian}.total`);
    for (const ember of ["belum_jatuh_tempo", "1_30", "31_60", "61_90", "90_plus"]) {
      assert.ok(adalahUang(d[bagian].ringkasan[ember]), `${bagian}.ringkasan.${ember}`);
    }
  }
  assert.equal(typeof d.piutang.menungguVerifikasi.jumlah, "number");
  assert.ok(adalahUang(d.piutang.menungguVerifikasi.total));

  const a = d.antrean;
  for (const kunci of ["jumlahPembayaranBelumVerifikasi", "pengeluaranMenunggu", "pembelianMenunggu", "tagihanMenunggu", "refundMenunggu"]) {
    assert.equal(typeof a[kunci], "number", `antrean.${kunci}`);
  }
  assert.equal(typeof a.lunasBelumDicatat.jumlah, "number");
  assert.ok(adalahUang(a.lunasBelumDicatat.total));
  assert.ok(Array.isArray(a.pembayaranBelumVerifikasi));

  assert.equal(typeof d.gate.enabled, "boolean");
  assert.ok(Array.isArray(d.jurnalTerakhir));
  assert.equal(typeof d.catatan.gapTerbuka, "number");
  assert.equal(typeof d.catatan.saldoAwalTerisi, "boolean");
  assert.ok(Array.isArray(d.catatan.pesan));
});

test("dashboard: tanpa ?from&to memakai bulan berjalan (WIB), bukan menolak", async () => {
  const res = await klien.FINANCE.get("/api/finance/dashboard");
  assert.equal(res.status, 200);
  assert.match(res.body.periode.from, /^\d{4}-\d{2}-01$/);
  assert.match(res.body.periode.to, /^\d{4}-\d{2}-\d{2}$/);
});

test("dashboard: periode berbeda mengembalikan rentang yang diminta (dipakai pemilih periode)", async () => {
  const res = await klien.FINANCE.get("/api/finance/dashboard?from=2026-01-01&to=2026-12-31");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.periode, { from: "2026-01-01", to: "2026-12-31" });
});

test("dashboard: FINANCE, ACCOUNTANT, APPROVER, OWNER boleh baca; SALES ditolak", async () => {
  for (const role of ["FINANCE", "ACCOUNTANT", "APPROVER", "OWNER"]) {
    const res = await klien[role].get("/api/finance/dashboard");
    assert.equal(res.status, 200, `${role} harus boleh membaca dashboard`);
  }
  const sales = await klien.SALES.get("/api/finance/dashboard");
  assert.equal(sales.status, 403);
});
