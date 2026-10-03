// Keputusan owner 4 Oktober 2026 — ADMIN/OWNER memegang SEMUA lini produksi. Tes ini mengunci: (1) cakupan izin ADMIN/OWNER, (2) role lain TIDAK melebar,
// (3) override pagar "PIC yang ditugaskan" hanya untuk pemegang PRODUCTION_EXECUTE_ANY dan tetap menegakkan penugasan rencana + workshop,
// (4) antrean Meja/Corner semua PIC hanya untuk pemegang izin itu. Tanpa DB/jaringan (stub).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PERMISSIONS as P, ROLE_PERMISSIONS } from "../src/constants/permissions.js";
import { hasPermission } from "../src/middleware/authorize.js";
import { assertOverridePlanAndWorkCenter, authorizeOperator, mayExecuteAnyUnit } from "../src/services/productionWorkshopExecutionCommandService.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, "..", ...p), "utf8");

const LINES = [
  ["Production Lead / Meja / Corner — eksekusi tahap", P.UNIT_STAGE_WRITE], ["bahan unit", P.UNIT_MATERIAL_WRITE], ["routing & jadwal", P.UNIT_ROUTING_WRITE],
  ["penugasan", P.PRODUCTION_ASSIGNMENT_WRITE], ["QC PASS/FAIL", P.QC_WRITE], ["QC WAIVE (tetap)", P.QC_WAIVE], ["Gudang — stok/penerimaan/retur/barang jadi", P.INVENTORY_WRITE],
  ["Dokumenter — foto", P.PRODUCTION_DOCUMENTATION_WRITE], ["laporan pribadi", P.PRODUCTION_REPORT_SELF], ["target harian", P.PRODUCTION_TARGET_WRITE], ["override PIC", P.PRODUCTION_EXECUTE_ANY],
];

test("ADMIN dan OWNER memegang izin SEMUA lini produksi (satu sumber: OWNER mewarisi ADMIN)", () => {
  for (const role of ["ADMIN", "OWNER"]) for (const [label, perm] of LINES) assert.ok(ROLE_PERMISSIONS[role].includes(perm), `${role} punya ${label} (${perm})`);
  assert.ok(P.PRODUCTION_EXECUTE_ANY === "production:execute:any");
  assert.equal(new Set(ROLE_PERMISSIONS.ADMIN).size, ROLE_PERMISSIONS.ADMIN.length, "tanpa izin ganda di daftar ADMIN");
});

test("role lain TIDAK melebar: PRODUCTION_EXECUTE_ANY hanya ADMIN/OWNER; Lead/Meja/Corner/QC/Gudang/Dokumenter/Sales/Finance tidak punya", () => {
  const holders = Object.entries(ROLE_PERMISSIONS).filter(([, perms]) => perms.includes(P.PRODUCTION_EXECUTE_ANY)).map(([role]) => role).sort();
  assert.deepEqual(holders, ["ADMIN", "OWNER"]);
  assert.ok(!hasPermission({ roles: ["PRODUCTION_LEAD"] }, P.PRODUCTION_EXECUTE_ANY), "Lead tetap terikat penugasan PIC");
  assert.ok(!hasPermission({ roles: ["QC_LEAD"] }, P.INVENTORY_WRITE) && !hasPermission({ roles: ["PRODUCTION_WORKER"] }, P.QC_WRITE) && !hasPermission({ roles: ["PRODUCTION_DOCUMENTER"] }, P.UNIT_STAGE_WRITE));
  assert.ok(!hasPermission({ roles: ["WAREHOUSE"] }, P.QC_WRITE) && !hasPermission({ roles: ["SALES"] }, P.UNIT_STAGE_WRITE) && !hasPermission({ roles: ["FINANCE"] }, P.INVENTORY_WRITE));
  assert.ok(!ROLE_PERMISSIONS.ADMIN.includes(P.SCOPE_REVISION_PROPOSE), "pengusul revisi tetap Lead/QC (admin hanya memutuskan)");
  assert.ok(ROLE_PERMISSIONS.ADMIN.includes(P.SCOPE_REVISION_DECIDE));
});

// stub tx.user.findUnique -> { role, active, roles }
const txOf = (user) => ({ user: { findUnique: async () => user } });
const PLAN = { status: "PLANNED", operatorId: "op-A", workCenterId: "wc-1", cornerWorkCenterId: "wc-c", cornerOperatorId: "op-C" };
const code = async (fn) => { try { await fn(); return null; } catch (e) { return e.code || e.message; } };

test("authorizeOperator: ADMIN/OWNER aktif lolos untuk unit PIC lain; workshop & penugasan rencana TETAP ditegakkan", async () => {
  for (const role of ["ADMIN", "OWNER"]) {
    const tx = txOf({ role, active: true, roles: [] });
    const run = { plan: PLAN };
    assert.equal((await authorizeOperator(tx, run, "u-admin", "wc-1", { postQc: false })), PLAN, `${role} lolos tahap Meja unit PIC lain`);
    assert.equal((await authorizeOperator(tx, run, "u-admin", "wc-c", { postQc: true })), PLAN, `${role} lolos tahap Corner (workshop Corner)`);
    assert.equal(await code(() => authorizeOperator(tx, run, "u-admin", "wc-OTHER", { postQc: false })), "WORKSHOP_WORK_CENTER_MISMATCH", "workshop salah tetap ditolak");
    assert.equal(await code(() => authorizeOperator(tx, { plan: { ...PLAN, operatorId: null } }, "u-admin", "wc-1")), "WORKSHOP_PLAN_NOT_ASSIGNED", "rencana belum ditugaskan tetap ditolak");
    assert.equal(await code(() => authorizeOperator(tx, { plan: { ...PLAN, status: "CANCELLED" } }, "u-admin", "wc-1")), "WORKSHOP_NO_PLAN");
  }
  // role ADMIN tambahan lewat tabel user_roles juga dihitung
  assert.equal((await authorizeOperator(txOf({ role: "SALES", active: true, roles: [{ role: "ADMIN" }] }), { plan: PLAN }, "u", "wc-1")), PLAN);
});

test("authorizeOperator: non-admin TETAP ditolak untuk unit PIC lain (403 WORKSHOP_OPERATOR_MISMATCH); admin nonaktif tidak mendapat override", async () => {
  const noOperatorTx = (user) => ({ user: { findUnique: async () => user }, productionOperator: { findUnique: async () => ({ id: "op-B", active: true }) } });
  for (const role of ["PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD", "WAREHOUSE", "SALES"]) {
    assert.equal(await code(() => authorizeOperator(noOperatorTx({ role, active: true, roles: [] }), { plan: PLAN }, "u", "wc-1")), "WORKSHOP_OPERATOR_MISMATCH", `${role} tetap terikat penugasan`);
  }
  assert.equal(await code(() => authorizeOperator(noOperatorTx({ role: "ADMIN", active: false, roles: [] }), { plan: PLAN }, "u", "wc-1")), "WORKSHOP_OPERATOR_MISMATCH", "admin nonaktif tidak lolos");
  // PIC yang ditugaskan tetap lolos seperti biasa
  assert.equal((await authorizeOperator({ user: { findUnique: async () => ({ role: "PRODUCTION_WORKER", active: true, roles: [] }) }, productionOperator: { findUnique: async () => ({ id: "op-A", active: true }) } }, { plan: PLAN }, "u", "wc-1")), PLAN);
  assert.equal(mayExecuteAnyUnit({ roles: ["PRODUCTION_LEAD"] }), false); assert.equal(mayExecuteAnyUnit({ roles: ["OWNER"] }), true);
  assert.equal(assertOverridePlanAndWorkCenter(PLAN, "wc-1"), undefined);
});

test("jejak audit jujur: override TIDAK memalsukan PIC — authorizeOperator mengembalikan plan saja; actor_id tetap user penekan (tidak ada penulisan operator di sini)", () => {
  const src = read("src", "services", "productionWorkshopExecutionCommandService.js");
  const fn = src.slice(src.indexOf("export async function authorizeOperator"), src.indexOf("// Tahap INTAKE routing boleh berjalan"));
  assert.ok(!/operatorId\s*:\s*plan\.operatorId|actorId\s*=|actor_id/.test(fn), "tidak menimpa actor/operator");
  assert.match(fn, /assertOverridePlanAndWorkCenter\(plan, workCenterId, \{ postQc \}\);\s*return plan;/);
});

test("antrean Meja/Corner: pemegang PRODUCTION_EXECUTE_ANY melihat antrean SEMUA PIC; yang lain hanya miliknya", () => {
  const route = read("src", "routes", "productionExperience.js");
  assert.match(route, /listWorkerQueue\(prisma, \{ unitIds, userId: req\.user\.id, lane, all: hasPermission\(req\.user, P\.PRODUCTION_EXECUTE_ANY\) \}\)/);
  const svc = read("src", "services", "productionExperienceReadService.js");
  assert.match(svc, /export async function listWorkerQueue\(prisma, \{ unitIds, userId, lane, all = false, now = new Date\(\) \}\)/);
  assert.match(svc, /if \(!all && \(!operator \|\| !operator\.active\)\) return \{ operator: null, items: \[\] \};/, "non-admin tanpa catatan operator tetap kosong");
  assert.match(svc, /const planWhere = all\s*\? \{ operatorId: \{ not: null \} \}/);
});
