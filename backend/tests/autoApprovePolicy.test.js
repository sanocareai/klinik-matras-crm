// Kebijakan auto-approve (BBM/tol/parkir <= Rp300.000): unit murni. Pengajuan mandiri akun own-only TIDAK
// pernah auto-approve; aturan lama untuk aktor/kategori/nominal yang memang diizinkan tetap sama.
import test from "node:test";
import assert from "node:assert/strict";
import { WORKSPACES, bolehAutoApprove } from "../src/services/expenseSubmission/config.js";
import { ownOnly } from "../src/services/expenseSubmission/ownPolicy.js";

const D = WORKSPACES.DELIVERY;

test("aturan lama utuh: hanya BBM/TOL/PARKIR dan nominal <= 300.000", () => {
  assert.deepEqual(D.autoApprove, { types: ["BBM", "TOL", "PARKIR"], maxAmount: 300_000 });
  for (const t of ["BBM", "TOL", "PARKIR"]) {
    assert.equal(bolehAutoApprove(D, t, 1), true, t);
    assert.equal(bolehAutoApprove(D, t, 300_000), true, `${t} batas`);
    assert.equal(bolehAutoApprove(D, t, 300_001), false, `${t} di atas batas`);
  }
  for (const t of ["SERVIS", "BAN", "CUCI", "DENDA", "SEWA", "LAINNYA"]) assert.equal(bolehAutoApprove(D, t, 1000), false, t);
});

test("pengajuan mandiri own-only: TIDAK PERNAH auto-approve, untuk semua kategori dan nominal", () => {
  for (const t of ["BBM", "TOL", "PARKIR", "SERVIS", "CUCI"]) {
    for (const n of [1, 250_000, 300_000, 300_001]) assert.equal(bolehAutoApprove(D, t, n, { mandiriOwn: true }), false, `${t}/${n}`);
  }
});

test("workspace tanpa kebijakan auto-approve tidak pernah auto-approve", () => {
  for (const [nama, cfg] of Object.entries(WORKSPACES)) {
    if (nama === "DELIVERY") continue;
    for (const t of ["BBM", "TOL", "PARKIR"]) assert.equal(bolehAutoApprove(cfg, t, 1000), false, `${nama}/${t}`);
  }
});

test("mandiriOwn diturunkan SERVER-SIDE dari izin aktor, tidak dari input klien", () => {
  const u = (...roles) => ({ id: "x", role: roles[0], roles });
  for (const r of ["DRIVER", "HELPER", "LEADER_DRIVER"]) assert.equal(ownOnly(u(r)), true, r);
  for (const r of ["DISPATCHER", "ADMIN", "OWNER", "FINANCE", "SALES"]) assert.equal(ownOnly(u(r)), false, r);
  assert.equal(ownOnly(u("DRIVER", "DISPATCHER")), false, "multi-role dengan jalur lama = aktor lama");
  // bolehAutoApprove tidak menerima 'sumber' dari body: satu-satunya parameter kebijakan adalah opsi server mandiriOwn
  assert.equal(bolehAutoApprove.length, 3);
});
