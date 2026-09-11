// Tes integrasi Warehouse<->Production end-to-end (13 Sept 2026) —
// routes/materialIssue.js#requiresUnitLink (fungsi murni) dan
// RESERVED_STATUSES (konstanta yang menentukan lifecycle Reserved).
//
// Alur penuh (Request -> Approval -> Reservation -> Picking -> Issue) TIDAK
// dites lewat HTTP/DB sungguhan di sini — pola yang SAMA dengan seluruh
// route lain di repo ini (diverifikasi lewat code review + pemeriksaan
// manual pasca-deploy, lihat header tests/scopeRevision.test.js). Yang
// dites di sini murni bagian yang bisa salah TANPA DB terlibat: aturan
// requiresUnitLink, dan invariant RESERVED_STATUSES supaya tidak bisa
// diam-diam bertambah ISSUED/CANCELLED (yang akan merusak formula
// Available = On Hand - Reserved).

import test from "node:test";
import assert from "node:assert/strict";

import { requiresUnitLink, RESERVED_STATUSES } from "../src/routes/materialIssue.js";

test("requiresUnitLink: PRODUCTION_WORK_ORDER wajib terhubung ke unit", () => {
  assert.equal(requiresUnitLink("PRODUCTION_WORK_ORDER"), true);
});

test("requiresUnitLink: sumber lain (tidak ada entitas Unit untuk ditunjuk) tidak wajib", () => {
  assert.equal(requiresUnitLink("MAINTENANCE_REQUEST"), false);
  assert.equal(requiresUnitLink("INTERNAL_REQUEST"), false);
  assert.equal(requiresUnitLink("SAMPLE_REQUEST"), false);
  assert.equal(requiresUnitLink("MANUAL"), false);
});

test("RESERVED_STATUSES: HANYA APPROVED/READY_TO_PICK/PICKED — bukan DRAFT/WAITING_APPROVAL (belum disetujui, belum boleh mengunci stok orang lain) atau ISSUED/CANCELLED (siklus sudah selesai)", () => {
  assert.deepEqual([...RESERVED_STATUSES].sort(), ["APPROVED", "PICKED", "READY_TO_PICK"]);
});

test("RESERVED_STATUSES: ISSUED tidak boleh pernah masuk — kalau masuk, material yang SUDAH keluar akan double-counted (Reserved dari sini + saldo dari ledger ISSUE)", () => {
  assert.equal(RESERVED_STATUSES.includes("ISSUED"), false);
});

test("RESERVED_STATUSES: CANCELLED tidak boleh pernah masuk — cancel/reject WAJIB otomatis melepas reservasi", () => {
  assert.equal(RESERVED_STATUSES.includes("CANCELLED"), false);
});

test("RESERVED_STATUSES: DRAFT tidak boleh masuk — permintaan yang belum diajukan/disetujui tidak boleh mengunci stok", () => {
  assert.equal(RESERVED_STATUSES.includes("DRAFT"), false);
});
