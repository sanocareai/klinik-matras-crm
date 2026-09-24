// Capabilities Sano Delivery Control — memastikan peran tidak bocor antara dua aplikasi:
// Driver/Helper (job:own) TIDAK boleh masuk Control; Admin/Owner/Dispatcher boleh;
// empat izin biaya armada terpisah dan mengikuti izin Finance yang sudah ada.
import test from "node:test";
import assert from "node:assert/strict";
import { capabilitiesFor } from "../src/services/capabilities.js";

const cap = (...roles) => capabilitiesFor({ role: roles[0], roles });

test("Driver dan Helper TIDAK punya akses Delivery Control", () => {
  for (const r of ["DRIVER", "HELPER"]) {
    const c = cap(r);
    assert.equal(c.deliveryControlApp, false, r);
    assert.deepEqual(c.deliveryExpense, { submit: false, verify: false, approve: false, pay: false }, r);
  }
});

test("Admin, Owner, Dispatcher, Leader Driver punya akses (izin job:read penuh)", () => {
  for (const r of ["ADMIN", "OWNER", "DISPATCHER", "LEADER_DRIVER"]) assert.equal(cap(r).deliveryControlApp, true, r);
});

test("peran non-armada tidak punya akses (Sales, Produksi, Gudang, Finance, Akuntan, Approver)", () => {
  for (const r of ["SALES", "PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD", "WAREHOUSE", "FINANCE", "ACCOUNTANT", "APPROVER"]) {
    assert.equal(cap(r).deliveryControlApp, false, r);
  }
});

test("akun multi-role: Driver + Admin mendapat akses lewat izin Admin (bukan lewat Driver)", () => {
  assert.equal(cap("DRIVER", "ADMIN").deliveryControlApp, true);
  assert.equal(cap("DRIVER", "HELPER").deliveryControlApp, false);
});

test("izin biaya armada terpisah: Dispatcher hanya mengajukan; Approver hanya menyetujui; Finance tidak memverifikasi", () => {
  assert.deepEqual(cap("DISPATCHER").deliveryExpense, { submit: true, verify: false, approve: false, pay: false });
  assert.deepEqual(cap("APPROVER").deliveryExpense, { submit: false, verify: false, approve: true, pay: false });
  assert.deepEqual(cap("ACCOUNTANT").deliveryExpense, { submit: true, verify: false, approve: false, pay: true });
  assert.deepEqual(cap("FINANCE").deliveryExpense, { submit: true, verify: false, approve: true, pay: true });
  assert.deepEqual(cap("ADMIN").deliveryExpense, { submit: true, verify: true, approve: true, pay: true });
});

test("field capabilities lama tidak berubah (kompatibilitas klien Finance/Sales)", () => {
  const c = cap("FINANCE");
  for (const k of ["financeRead", "financePost", "financeApprove", "financeAdmin", "paymentRead", "paymentWrite", "expenseSubmit", "financeApp", "preset"]) {
    assert.ok(k in c, k);
  }
  assert.equal(c.preset, "FINANCE");
  assert.equal(c.financeApp, true);
});
