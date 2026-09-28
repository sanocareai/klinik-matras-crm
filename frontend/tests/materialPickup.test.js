// Logika murni Pengambilan Bahan Produksi. Lihat src/features/production/materialPickup.js.
import test from "node:test";
import assert from "node:assert/strict";
import {
  PICKUP_TABS, canCancelRequest, canPickRequest, canRequestPickup, emptyStateCopy, lineComparison, pickErrorMessage,
  pickupStatusBadgeFor, requestSummary,
} from "../src/features/production/materialPickup.js";

test("tab dan badge: Menunggu Diserahkan/Sudah Diserahkan/Dibatalkan; status tak dikenal netral", () => {
  assert.deepEqual(PICKUP_TABS.map((t) => t.key), ["READY_TO_PICK", "ISSUED", "CANCELLED"]);
  assert.deepEqual(pickupStatusBadgeFor("READY_TO_PICK"), { variant: "warning", label: "Menunggu Diserahkan" });
  assert.deepEqual(pickupStatusBadgeFor("ISSUED"), { variant: "success", label: "Sudah Diserahkan" });
  assert.deepEqual(pickupStatusBadgeFor("CANCELLED"), { variant: "danger", label: "Dibatalkan" });
  assert.deepEqual(pickupStatusBadgeFor("X"), { variant: "neutral", label: "X" });
});

test("aksi: serahkan dan batal hanya untuk READY_TO_PICK (setelah diserahkan tidak ada batal)", () => {
  assert.equal(canPickRequest({ status: "READY_TO_PICK" }), true);
  assert.equal(canCancelRequest({ status: "READY_TO_PICK" }), true);
  for (const status of ["ISSUED", "CANCELLED", undefined]) {
    assert.equal(canPickRequest({ status }), false, String(status));
    assert.equal(canCancelRequest({ status }), false, String(status));
  }
  assert.equal(canPickRequest(null), false);
});

test("canRequestPickup: hanya plan Bahan Direservasi tanpa permintaan aktif/selesai; permintaan CANCELLED boleh diajukan ulang", () => {
  const plan = { id: "p1", status: "MATERIAL_RESERVED" };
  assert.equal(canRequestPickup(plan, []), true);
  assert.equal(canRequestPickup(plan, [{ planId: "p1", status: "READY_TO_PICK" }]), false);
  assert.equal(canRequestPickup(plan, [{ planId: "p1", status: "ISSUED" }]), false);
  assert.equal(canRequestPickup(plan, [{ planId: "p1", status: "CANCELLED" }]), true);
  assert.equal(canRequestPickup(plan, [{ planId: "lain", status: "READY_TO_PICK" }]), true);
  assert.equal(canRequestPickup({ id: "p1", status: "PLANNED" }, []), false);
  assert.equal(canRequestPickup(null, []), false);
});

test("lineComparison/requestSummary: rencana vs reservasi vs diserahkan; ketidakcocokan rencana-reservasi terdeteksi", () => {
  assert.deepEqual(lineComparison({ planned: 5, reserved: 5, picked: 0 }), { planned: 5, reserved: 5, picked: 0, remaining: 5, consistent: true });
  assert.deepEqual(lineComparison({ planned: 5, reserved: 4, picked: 5 }), { planned: 5, reserved: 4, picked: 5, remaining: 0, consistent: false });
  const s = requestSummary({ lines: [{ planned: 5, reserved: 5, picked: 5 }, { planned: 2, reserved: 2, picked: 2 }] });
  assert.deepEqual(s, { lineCount: 2, totalPlanned: 7, totalPicked: 7, allConsistent: true });
  assert.equal(requestSummary({ lines: [{ planned: 1, reserved: 0, picked: 0 }] }).allConsistent, false);
  assert.equal(requestSummary(null).lineCount, 0);
});

test("pickErrorMessage: pesan Indonesia untuk 409/503 yang relevan; kode lain memakai pesan server", () => {
  assert.match(pickErrorMessage({ code: "MATERIAL_ISSUE_REVISION_CONFLICT" }), /muat ulang/i);
  assert.match(pickErrorMessage({ code: "MATERIAL_ISSUE_ALREADY_PICKED" }), /sudah diserahkan/i);
  assert.match(pickErrorMessage({ code: "MATERIAL_ISSUE_SHORTAGE", message: "Stok X tidak cukup" }), /tidak ada bahan yang dikeluarkan/i);
  assert.match(pickErrorMessage({ code: "MATERIAL_ISSUE_WRITER_OFF" }), /belum aktif/i);
  assert.equal(pickErrorMessage({ code: "LAIN", message: "pesan server" }), "pesan server");
  assert.equal(pickErrorMessage(null), "Gagal memproses permintaan");
});

test("emptyStateCopy: reader OFF menjelaskan canary (bukan error); reader aktif menyebut tab", () => {
  const off = emptyStateCopy({ readerMode: "OFF", tabKey: "READY_TO_PICK" });
  assert.equal(off.belumAktif, true);
  assert.match(off.title, /belum diaktifkan/i);
  const cohort = emptyStateCopy({ readerMode: "COHORT", tabKey: "ISSUED" });
  assert.equal(cohort.belumAktif, false);
  assert.match(cohort.title, /sudah diserahkan/i);
});
