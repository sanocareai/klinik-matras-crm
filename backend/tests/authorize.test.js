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

test("SALES bisa baca status/dokumentasi unit (D-015) tapi TIDAK bisa menulis produksi", () => {
  assert.ok(hasPermission(sales, P.UNIT_READ));
  assert.ok(!hasPermission(sales, P.UNIT_STAGE_WRITE));
  assert.ok(!hasPermission(sales, P.UNIT_ROUTING_WRITE));
  assert.ok(!hasPermission(sales, P.QC_WRITE));
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

test("driver punya JOB_OWN_WRITE (mulai/tiba/selesai/gagal job miliknya) tapi bukan JOB_WRITE penuh", () => {
  assert.ok(hasPermission(driver, P.JOB_OWN_WRITE));
  assert.ok(!hasPermission(driver, P.JOB_WRITE), "driver tidak boleh mengubah job siapa pun");
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

test("OPEN/RESOLVE BLOCKER (Production Core Slice 2A) butuh UNIT_STAGE_WRITE — sama dengan permission tahap lain", () => {
  // failStage()/resolveBlocker() (POST .../stages/:stageId/fail dan POST
  // .../blockers/:blockerId/resolve) SENGAJA memakai permission yang SAMA
  // dengan start/complete — siapa pun yang boleh mengerjakan tahap juga
  // boleh melaporkan & menyelesaikan hambatannya sendiri.
  assert.ok(hasPermission(worker, P.UNIT_STAGE_WRITE), "PRODUCTION_WORKER harus bisa membuka & menyelesaikan blokir");
  assert.ok(hasPermission({ roles: ["QC_LEAD"] }, P.UNIT_STAGE_WRITE));
  assert.ok(hasPermission({ roles: ["PRODUCTION_LEAD"] }, P.UNIT_STAGE_WRITE));

  assert.ok(!hasPermission(sales, P.UNIT_STAGE_WRITE), "SALES tidak boleh membuka/menyelesaikan blokir produksi");
  const r = runMiddleware(requirePermission(P.UNIT_STAGE_WRITE), sales);
  assert.equal(r.status, 403);

  // ADMIN SENGAJA tidak dapat UNIT_STAGE_WRITE (D-013) — konsisten: ADMIN
  // juga tidak boleh membuka/menutup blokir produksi sendiri, sama seperti
  // tidak boleh memajukan tahap atau memutuskan QC.
  assert.ok(!hasPermission(admin, P.UNIT_STAGE_WRITE));
});

test("PAUSE/RESUME tahap (Production Core Slice 3) butuh UNIT_STAGE_WRITE — sama dengan start/complete/fail", () => {
  // routes/units.js POST .../stages/:stageId/pause dan .../resume SENGAJA
  // memakai permission yang SAMA dengan start/complete/fail (bukan
  // permission baru) — siapa pun yang boleh mengerjakan tahap juga boleh
  // menjeda & melanjutkan pekerjaannya sendiri, konsisten dengan pola
  // OPEN/RESOLVE BLOCKER di atas.
  assert.ok(hasPermission(worker, P.UNIT_STAGE_WRITE), "PRODUCTION_WORKER harus bisa pause/resume tahapnya sendiri");
  assert.ok(!hasPermission(sales, P.UNIT_STAGE_WRITE), "SALES tidak boleh pause/resume tahap produksi");
  // ADMIN SENGAJA tidak dapat UNIT_STAGE_WRITE (D-013) — konsisten di sini juga.
  assert.ok(!hasPermission(admin, P.UNIT_STAGE_WRITE));
});

test("PATCH /units/:id/production butuh UNIT_ROUTING_WRITE — PRODUCTION_WORKER tidak boleh mereprioritaskan pekerjaannya sendiri", () => {
  // Production Core Slice 1 (spec Phase 28): pekerja produksi (hanya
  // UNIT_STAGE_WRITE) TIDAK BOLEH mengubah prioritas/tanggal target
  // produksi — itu keputusan supervisor (PRODUCTION_LEAD/QC_LEAD/ADMIN).
  assert.ok(hasPermission(worker, P.UNIT_STAGE_WRITE));
  assert.ok(!hasPermission(worker, P.UNIT_ROUTING_WRITE));
  const r = runMiddleware(requirePermission(P.UNIT_ROUTING_WRITE), worker);
  assert.equal(r.status, 403);

  assert.ok(hasPermission({ roles: ["PRODUCTION_LEAD"] }, P.UNIT_ROUTING_WRITE));
  assert.ok(
    !hasPermission({ roles: ["QC_LEAD"] }, P.UNIT_ROUTING_WRITE),
    "QC_LEAD tidak punya UNIT_ROUTING_WRITE — hanya SCOPE_REVISION_PROPOSE + UNIT_STAGE_WRITE + QC_WRITE"
  );
});

// --- Production Core Slice 4 (Route/Work Center/Operator) -----------------
test("Slice 4: ADMIN dan PRODUCTION_LEAD dapat penuh permission Route/Work Center/Operator, role lain tidak", () => {
  const slice4Perms = [
    P.PRODUCTION_ROUTE_READ, P.PRODUCTION_ROUTE_WRITE,
    P.WORK_CENTER_READ, P.WORK_CENTER_WRITE,
    P.PRODUCTION_OPERATOR_READ, P.PRODUCTION_OPERATOR_WRITE,
    P.PRODUCTION_ASSIGNMENT_WRITE,
  ];
  for (const perm of slice4Perms) {
    assert.ok(hasPermission(admin, perm), `ADMIN harus punya ${perm}`);
    assert.ok(hasPermission({ roles: ["PRODUCTION_LEAD"] }, perm), `PRODUCTION_LEAD harus punya ${perm}`);
    assert.ok(!hasPermission(worker, perm), `PRODUCTION_WORKER TIDAK boleh punya ${perm}`);
    assert.ok(!hasPermission({ roles: ["QC_LEAD"] }, perm), `QC_LEAD TIDAK boleh punya ${perm}`);
    assert.ok(!hasPermission(sales, perm), `SALES TIDAK boleh punya ${perm}`);
  }
});

test("POST /units/:id/route memakai UNIT_ROUTING_WRITE (bukan permission baru) — sama seperti PATCH /units/:id/service", () => {
  assert.ok(hasPermission({ roles: ["PRODUCTION_LEAD"] }, P.UNIT_ROUTING_WRITE));
  assert.ok(!hasPermission(worker, P.UNIT_ROUTING_WRITE), "PRODUCTION_WORKER tidak boleh mengganti rute produksi unit");
  const r = runMiddleware(requirePermission(P.UNIT_ROUTING_WRITE), worker);
  assert.equal(r.status, 403);
});

test("POST /units/:id/stages/:stageId/assign butuh PRODUCTION_ASSIGNMENT_WRITE — TERPISAH dari UNIT_STAGE_WRITE (mengerjakan tahap ≠ menugaskan siapa yang mengerjakan)", () => {
  assert.ok(hasPermission(worker, P.UNIT_STAGE_WRITE), "pekerja produksi tetap bisa mengerjakan tahap");
  assert.ok(!hasPermission(worker, P.PRODUCTION_ASSIGNMENT_WRITE), "tapi TIDAK boleh menugaskan operator/work center");
  const r = runMiddleware(requirePermission(P.PRODUCTION_ASSIGNMENT_WRITE), worker);
  assert.equal(r.status, 403);

  assert.ok(hasPermission({ roles: ["PRODUCTION_LEAD"] }, P.PRODUCTION_ASSIGNMENT_WRITE));
});

test("Work Center CRUD: WORK_CENTER_READ untuk lihat daftar, WORK_CENTER_WRITE terpisah untuk kelola", () => {
  assert.ok(hasPermission(admin, P.WORK_CENTER_READ));
  assert.ok(hasPermission(admin, P.WORK_CENTER_WRITE));
  assert.ok(!hasPermission(sales, P.WORK_CENTER_READ));
});

test("Production Operator: PRODUCTION_OPERATOR_WRITE dibutuhkan utk buat profil/kelola skill, worker tidak dapat", () => {
  assert.ok(hasPermission({ roles: ["PRODUCTION_LEAD"] }, P.PRODUCTION_OPERATOR_WRITE));
  assert.ok(!hasPermission(worker, P.PRODUCTION_OPERATOR_WRITE));
  const r = runMiddleware(requirePermission(P.PRODUCTION_OPERATOR_WRITE), worker);
  assert.equal(r.status, 403);
});

// --- portal ----------------------------------------------------------------
test("portal disaring sesuai role", () => {
  assert.deepEqual(portalsFor(sales).map((p) => p.key), ["growth"]);
  assert.deepEqual(portalsFor(worker).map((p) => p.key), ["bengkel"]);
  assert.deepEqual(portalsFor(driver).map((p) => p.key), ["armada"]);
  // "warehouse" adalah workspace KE-5 (Gudang dikeluarkan dari Bengkel jadi
  // portal sendiri). Test ini sempat tertinggal saat portal itu ditambahkan,
  // jadi suite merah walau kodenya benar — dan suite merah yang dibiarkan
  // membuat regresi berikutnya tidak kelihatan.
  assert.deepEqual(portalsFor(admin).map((p) => p.key),
    ["growth", "bengkel", "warehouse", "armada", "kendali"]);
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
