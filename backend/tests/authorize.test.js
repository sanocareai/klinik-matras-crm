// Tes otorisasi Sano Hub. Dijalankan dengan test runner bawaan Node 20:
//   npm test
//
// Sengaja TANPA dependency test baru (jest/vitest) — CLAUDE.md §3 mengunci
// stack, dan `node --test` sudah cukup untuk logika murni seperti ini.
//
// PHASE-0.md menjadikan tes ini bagian dari "definisi selesai": aturan
// "pekerja produksi tidak melihat PII & harga" harus terbukti SEBELUM ada
// pekerja produksi yang benar-benar login.

import test from "node:test";
import assert from "node:assert/strict";

import {
  rolesOf,
  permissionsOf,
  hasPermission,
  portalsFor,
  requirePermission,
  sanitizeCustomer,
  sanitizeOrder,
  PERMISSIONS as P,
} from "../src/middleware/authorize.js";
import { ROLE_PERMISSIONS, PORTALS } from "../src/constants/permissions.js";

const worker = { id: "u1", roles: ["PRODUCTION_WORKER"] };
const sales = { id: "u2", roles: ["SALES"] };
const admin = { id: "u3", roles: ["ADMIN"] };
const driver = { id: "u4", roles: ["DRIVER"] };
const leadAndQc = { id: "u5", roles: ["PRODUCTION_LEAD", "QC_LEAD"] };

// ---------------------------------------------------------------------------
test("token lama tanpa `roles` tetap berfungsi lewat fallback `role`", () => {
  // Token berlaku 7 hari — setelah deploy masih ada yang memegang bentuk lama.
  // Kalau ini pecah, semua orang kehilangan akses sampai login ulang.
  assert.deepEqual(rolesOf({ role: "SALES" }), ["SALES"]);
  assert.ok(hasPermission({ role: "SALES" }, P.CUSTOMER_READ));
  assert.deepEqual(rolesOf({}), []);
  assert.deepEqual(rolesOf(null), []);
});

test("`roles` diprioritaskan di atas `role` tunggal kalau dua-duanya ada", () => {
  const u = { role: "SALES", roles: ["DRIVER"] };
  assert.deepEqual(rolesOf(u), ["DRIVER"]);
  assert.ok(!hasPermission(u, P.CUSTOMER_WRITE));
});

test("permission bersifat aditif untuk multi-role", () => {
  assert.ok(hasPermission(leadAndQc, P.UNIT_ROUTING_WRITE)); // dari PRODUCTION_LEAD
  assert.ok(hasPermission(leadAndQc, P.QC_WRITE));           // dari QC_LEAD
});

test("user tanpa role tidak punya permission apa pun", () => {
  assert.equal(permissionsOf({ roles: [] }).size, 0);
  assert.equal(permissionsOf({ roles: ["TIDAK_DIKENAL"] }).size, 0);
});

// --- aturan keamanan inti (PRD §9.3) ---------------------------------------
test("pekerja produksi TIDAK bisa melihat PII customer maupun harga", () => {
  assert.ok(!hasPermission(worker, P.CUSTOMER_PII_READ));
  assert.ok(!hasPermission(worker, P.ORDER_PRICE_READ));
  // Tapi tetap boleh tahu kasur siapa dan harus diapakan.
  assert.ok(hasPermission(worker, P.CUSTOMER_READ));
  assert.ok(hasPermission(worker, P.UNIT_READ));
  assert.ok(hasPermission(worker, P.UNIT_STAGE_WRITE));
});

test("sanitizeCustomer membuang nomor telepon & email untuk pekerja produksi", () => {
  const customer = {
    id: "c1", name: "Budi", phone: "628111", email: "b@x.com",
    instagramHandle: "@budi", city: "Bekasi",
  };
  const seen = sanitizeCustomer(customer, worker);
  assert.equal(seen.phone, undefined);
  assert.equal(seen.email, undefined);
  assert.equal(seen.instagramHandle, undefined);
  assert.equal(seen.name, "Budi"); // masih perlu untuk mencocokkan kasur
  assert.equal(seen.city, "Bekasi");

  // Sales berhak — tidak boleh ikut disaring.
  assert.equal(sanitizeCustomer(customer, sales).phone, "628111");
});

test("sanitizeOrder membuang nilai order DAN harga tiap item", () => {
  const order = {
    id: "o1", value: 5000000, quantity: 2,
    items: [{ id: "i1", layananName: "Upgrade Fondasi", harga: 3000000 }],
  };
  const seen = sanitizeOrder(order, worker);
  assert.equal(seen.value, undefined);
  // Layanannya HARUS tetap terlihat — itu instruksi kerjanya.
  assert.equal(seen.items[0].layananName, "Upgrade Fondasi");
  assert.equal(seen.items[0].harga, undefined, "harga per item ikut bocor");

  const asSales = sanitizeOrder(order, sales);
  assert.equal(asSales.value, 5000000);
  assert.equal(asSales.items[0].harga, 3000000);
});

test("driver tidak punya akses baca job umum, hanya job miliknya", () => {
  assert.ok(hasPermission(driver, P.JOB_OWN_READ));
  assert.ok(!hasPermission(driver, P.JOB_READ));
  assert.ok(!hasPermission(driver, P.JOB_WRITE));
});

test("hanya FINANCE yang bisa menulis pembayaran — ADMIN pun tidak", () => {
  assert.ok(hasPermission({ roles: ["FINANCE"] }, P.PAYMENT_WRITE));
  assert.ok(!hasPermission(admin, P.PAYMENT_WRITE));
  assert.ok(!hasPermission(sales, P.PAYMENT_WRITE));
});

test("ADMIN TIDAK bisa memajukan tahap produksi atau memutuskan QC", () => {
  // Bukan kelalaian — ini disengaja (PRD §3). Kalau admin bisa memajukan
  // tahap, kolom "siapa mengerjakan" di unit_stage_logs berhenti bisa
  // dipercaya. Admin yang memang ikut mengerjakan diberi role produksi
  // sebagai TAMBAHAN, bukan dengan melebarkan ADMIN.
  assert.ok(!hasPermission(admin, P.UNIT_STAGE_WRITE));
  assert.ok(!hasPermission(admin, P.QC_WRITE));
  // Multi-role adalah jalan keluarnya:
  assert.ok(hasPermission({ roles: ["ADMIN", "QC_LEAD"] }, P.QC_WRITE));
});

// --- portal ----------------------------------------------------------------
test("portal disaring sesuai role", () => {
  assert.deepEqual(portalsFor(sales).map((p) => p.key), ["growth"]);
  assert.deepEqual(portalsFor(worker).map((p) => p.key), ["bengkel"]);
  assert.deepEqual(portalsFor(driver).map((p) => p.key), ["armada"]);
  assert.deepEqual(portalsFor(admin).map((p) => p.key),
    ["growth", "bengkel", "armada", "kendali"]);
  assert.deepEqual(portalsFor({ roles: [] }), []);
});

test("setiap portal menyebut role yang benar-benar ada", () => {
  const known = new Set(Object.keys(ROLE_PERMISSIONS));
  for (const portal of PORTALS) {
    for (const role of portal.roles) {
      assert.ok(known.has(role), `portal ${portal.key} menyebut role tak dikenal: ${role}`);
    }
  }
});

// --- middleware ------------------------------------------------------------
function runMiddleware(mw, user) {
  const req = { user };
  const result = { status: null, body: null, nextCalled: false };
  const res = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
  mw(req, res, () => { result.nextCalled = true; });
  return result;
}

test("requirePermission: 401 kalau belum login", () => {
  const r = runMiddleware(requirePermission(P.UNIT_READ), undefined);
  assert.equal(r.status, 401);
  assert.equal(r.nextCalled, false);
});

test("requirePermission: 403 kalau login tapi tidak berhak", () => {
  const r = runMiddleware(requirePermission(P.PAYMENT_WRITE), worker);
  assert.equal(r.status, 403);
  assert.equal(r.nextCalled, false);
});

test("requirePermission: lanjut kalau berhak", () => {
  const r = runMiddleware(requirePermission(P.UNIT_STAGE_WRITE), worker);
  assert.equal(r.status, null);
  assert.equal(r.nextCalled, true);
});

test("setiap permission yang dipetakan ke role benar-benar terdaftar", () => {
  const known = new Set(Object.values(P));
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
    for (const perm of perms) {
      assert.ok(known.has(perm), `role ${role} memakai permission tak dikenal: ${perm}`);
    }
  }
});
