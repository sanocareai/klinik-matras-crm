// Dropdown PIC tanpa ADMIN/OWNER — logika murni + bentuk query (tanpa DB). Versi HTTP+DB: tests/integration/picDropdownTanpaAdmin.integration.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PIC_EXCLUDED_ROLES, bukanAdminOwner, getPlanningRefs } from "../src/services/productionRencanaService.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROUTE = fs.readFileSync(path.resolve(here, "../src/routes/production.js"), "utf8").replace(/\r\n/g, "\n");

test("filter PIC: ADMIN dan OWNER dikecualikan pada peran utama DAN peran tambahan (user_roles)", () => {
  assert.deepEqual([...PIC_EXCLUDED_ROLES].sort(), ["ADMIN", "OWNER"]);
  assert.deepEqual(bukanAdminOwner, { role: { notIn: ["ADMIN", "OWNER"] }, roles: { none: { role: { in: ["ADMIN", "OWNER"] } } } });
});

test("getPlanningRefs: operator dan kandidat memakai filter yang SAMA; profil nonaktif/ADMIN tidak dihapus (hanya pilihan)", async () => {
  const calls = {};
  const prisma = {
    workCenter: { findMany: async () => [{ id: "wc1", code: "WU", name: "Workshop Utama" }] },
    productionOperator: {
      findMany: async (q) => { calls.operators = q; return []; },
      count: async (q) => { calls.count = q; return 0; },
    },
    user: { findMany: async (q) => { calls.candidates = q; return []; } },
  };
  const r = await getPlanningRefs(prisma, { canRegisterOperator: true });
  assert.deepEqual(calls.operators.where.user, { active: true, ...bukanAdminOwner });
  assert.deepEqual({ role: calls.candidates.where.role, roles: calls.candidates.where.roles }, bukanAdminOwner);
  assert.equal(calls.candidates.where.active, true);
  // hitungan profil nonaktif TIDAK memakai filter (hanya informasi; tidak menyembunyikan data)
  assert.equal(calls.count.where.OR.length, 2);
  assert.equal(r.operators.length, 0);
});

test("route /api/production/operators: ?pilihan=1 menerapkan filter; tanpa parameter daftar penuh (halaman Operator)", () => {
  assert.match(ROUTE, /const hanyaPilihan = \["1", "true"\]\.includes\(String\(req\.query\.pilihan \|\| ""\)\);/);
  // ?pilihan=1 saja = filter ADMIN/OWNER; ?lane/?stageId (pemisahan PIC Meja/Corner) menambah lini + aktif, tetap tanpa ADMIN/OWNER. Tanpa parameter = daftar penuh.
  assert.match(ROUTE, /: hanyaPilihan \? \{ where: \{ user: bukanAdminOwner \} \} : \{\}\),/);
  assert.match(ROUTE, /\? \{ where: \{ active: true, workLanes: \{ has: lane \}, user: \{ AND: \[bukanAdminOwner, \{ active: true \}\] \} \} \}/);
  assert.match(ROUTE, /import \{ bukanAdminOwner \} from "\.\.\/services\/productionRencanaService\.js";/);
});
