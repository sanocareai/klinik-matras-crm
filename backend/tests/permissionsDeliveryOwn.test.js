// Matriks izin Delivery: Control access dan biaya milik sendiri (delivery:expense:own:*).
import test from "node:test";
import assert from "node:assert/strict";
import { hasPermission } from "../src/middleware/authorize.js";
import { PERMISSIONS as P } from "../src/constants/permissions.js";
import { ownOnly } from "../src/services/expenseSubmission/ownAccess.js";

const u = (...roles) => ({ id: "x", role: roles[0], roles });
const has = (roles, perm) => hasPermission(u(...roles), perm);

test("konvensi nama permission baru mengikuti pola repo (domain:resource:aksi)", () => {
  assert.equal(P.DELIVERY_CONTROL_ACCESS, "delivery:control:access");
  assert.equal(P.DELIVERY_EXPENSE_OWN_READ, "delivery:expense:own:read");
  assert.equal(P.DELIVERY_EXPENSE_OWN_WRITE, "delivery:expense:own:write");
});

test("delivery:control:access hanya Admin, Owner, Dispatcher", () => {
  const boleh = ["ADMIN", "OWNER", "DISPATCHER"];
  const semua = ["ADMIN", "OWNER", "DISPATCHER", "LEADER_DRIVER", "DRIVER", "HELPER", "FINANCE", "ACCOUNTANT", "APPROVER", "SALES", "WAREHOUSE", "PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD"];
  for (const r of semua) assert.equal(has([r], P.DELIVERY_CONTROL_ACCESS), boleh.includes(r), r);
});

test("biaya milik sendiri: hanya Driver, Helper, Leader Driver; TIDAK diberi finance:expense:submit", () => {
  const boleh = ["DRIVER", "HELPER", "LEADER_DRIVER"];
  const semua = ["ADMIN", "OWNER", "DISPATCHER", "LEADER_DRIVER", "DRIVER", "HELPER", "FINANCE", "ACCOUNTANT", "APPROVER", "SALES", "WAREHOUSE"];
  for (const r of semua) {
    assert.equal(has([r], P.DELIVERY_EXPENSE_OWN_READ), boleh.includes(r), `${r} read`);
    assert.equal(has([r], P.DELIVERY_EXPENSE_OWN_WRITE), boleh.includes(r), `${r} write`);
  }
  for (const r of boleh) {
    assert.equal(has([r], P.FINANCE_EXPENSE_SUBMIT), false, `${r} tidak boleh mendapat finance:expense:submit`);
    for (const k of ["FINANCE_READ", "FINANCE_POST", "FINANCE_APPROVE", "FINANCE_ADMIN"]) assert.equal(has([r], P[k]), false, `${r} ${k}`);
  }
});

test("ownOnly: Driver/Helper/Leader true; jalur lama dan role tanpa izin false; multi-role dengan jalur lama = bukan own-only", () => {
  for (const r of ["DRIVER", "HELPER", "LEADER_DRIVER"]) assert.equal(ownOnly(u(r)), true, r);
  for (const r of ["ADMIN", "OWNER", "DISPATCHER", "FINANCE", "SALES", "WAREHOUSE", "APPROVER"]) assert.equal(ownOnly(u(r)), false, r);
  assert.equal(ownOnly(u("DRIVER", "DISPATCHER")), false);
});
