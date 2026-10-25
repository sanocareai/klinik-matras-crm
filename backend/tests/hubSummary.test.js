// Main Hub — ringkasan Task & Meeting: aturan MURNI (lib/domain/hubSummary.js)
// + pemetaan permission (constants/permissions.js). Tanpa DB, tanpa Express —
// bagian yang menyentuh DB/HUB ada di services/hubSummary.js, dibuktikan
// lewat verify:prod-boot (HUB) dan rehearsal Tahap 5 (SANSS+HUB berdua).
import test from "node:test";
import assert from "node:assert/strict";
import { LEADER_DIVISIONS, MAX_LEADERS_PER_CALL, canMonitorLeaders, normalizeDivisionFilter } from "../src/lib/domain/hubSummary.js";
import { ALL_ROLES, PERMISSIONS as P, ROLE_PERMISSIONS } from "../src/constants/permissions.js";

const user = (roles) => ({ roles });

test("LEADER_DIVISIONS sama persis dengan enum DivisiKeanggotaan di skema", () => {
  assert.deepEqual([...LEADER_DIVISIONS].sort(), ["DELIVERY", "DIGITAL_TECHNOLOGY", "HR_GA", "MANAGEMENT", "MARKETING", "PRODUCTION", "WAREHOUSE"]);
});

test("normalizeDivisionFilter: divisi dikenal lolos apa adanya", () => {
  for (const d of LEADER_DIVISIONS) assert.equal(normalizeDivisionFilter(d), d);
});

test("normalizeDivisionFilter: apa pun di luar daftar → null (tanpa filter, BUKAN 'divisi tak dikenal' yang lolos)", () => {
  for (const bad of [undefined, null, "", "SEMUA", "marketing", "Production", "GUDANG", 1, {}, [], ["MARKETING"], ["MARKETING", "WAREHOUSE"]]) {
    assert.equal(normalizeDivisionFilter(bad), null, JSON.stringify(bad));
  }
});

test("permission HUB_LEADER_MONITOR terdaftar", () => {
  assert.equal(typeof P.HUB_LEADER_MONITOR, "string");
  assert.ok(P.HUB_LEADER_MONITOR.length > 0);
});

test("HUB_LEADER_MONITOR: HANYA OWNER memegangnya — BUKAN ADMIN, dan bukan role lain mana pun (default-deny, Owner-only sesuai arahan Owner)", () => {
  assert.equal(canMonitorLeaders(user(["OWNER"])), true);
  for (const role of ALL_ROLES) {
    if (role === "OWNER") continue;
    assert.equal(canMonitorLeaders(user([role])), false, `role ${role} seharusnya TIDAK memegang HUB_LEADER_MONITOR`);
  }
});

test("HUB_LEADER_MONITOR TIDAK ada di ADMIN_PERMS — menambah izin OWNER lain tidak diam-diam membukanya untuk ADMIN", () => {
  assert.ok(!ROLE_PERMISSIONS.ADMIN.includes(P.HUB_LEADER_MONITOR));
  assert.ok(ROLE_PERMISSIONS.OWNER.includes(P.HUB_LEADER_MONITOR));
});

test("canMonitorLeaders: kombinasi role non-OWNER tetap ditolak; tanpa role sama sekali juga ditolak", () => {
  assert.equal(canMonitorLeaders(user(["ADMIN", "FINANCE", "SALES"])), false);
  assert.equal(canMonitorLeaders(user([])), false);
  assert.equal(canMonitorLeaders({}), false);
  assert.equal(canMonitorLeaders(null), false);
  // Aditif seperti permission lain — OWNER di antara beberapa role tetap lolos.
  assert.equal(canMonitorLeaders(user(["SALES", "OWNER"])), true);
});

test("MAX_LEADERS_PER_CALL masuk akal dan selaras dengan batas HUB (HUB menolak >50 sub per panggilan)", () => {
  assert.equal(MAX_LEADERS_PER_CALL, 50);
});
