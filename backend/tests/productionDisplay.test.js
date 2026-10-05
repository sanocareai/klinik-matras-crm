// Simplifikasi Production slice 1 — kosakata tampilan murni: status, keberadaan fisik, prioritas Komplain, alasan Pekerjaan Tertunda. Tanpa DB.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DELAY_REASONS, DISPLAY_STATUS_FILTERS, DISPLAY_STATUS_UNIT_FILTER, delayReasonOfBlock, delayStatusText, displayStatusCountsOf, displayStatusOfOrder, displayStatusOfUnit,
  isBacklogEligible, isFinishedUnitStatus, isWorkableUnitStatus, physicalPresenceOf, priorityDisplay, storedPriorityLevel,
} from "../src/lib/domain/productionDisplay.js";
import { BLOCK_REASON_VALUES, BLOCK_REASON_LABEL } from "../src/lib/domain/productionExceptions.js";
import { PRIORITY_LABEL, compareStationOrder } from "../src/lib/domain/productionBoard.js";
import { OPEN_COMPLAINT_STATUS_EXCLUDED } from "../src/services/productionComplaints.js";

const here = path.dirname(fileURLToPath(import.meta.url));

test("status tampilan: tepat empat label (Pengambilan, Diproses, Siap Kirim, Terkirim); tiap enum UnitStatus & OrderStatus terpetakan; Dibatalkan terpisah", () => {
  const unit = { AWAITING_PICKUP: "Pengambilan", IN_TRANSIT_IN: "Pengambilan", RECEIVED: "Diproses", IN_PRODUCTION: "Diproses", READY_FOR_DELIVERY: "Siap Kirim", READY_ON_CUSTOMER_HOLD: "Siap Kirim", IN_TRANSIT_OUT: "Siap Kirim", DELIVERED: "Terkirim", CANCELLED: "Dibatalkan" };
  for (const [k, label] of Object.entries(unit)) assert.equal(displayStatusOfUnit(k).label, label, k);
  const order = { PENDING: "Pengambilan", PICKUP: "Pengambilan", PROCESSING: "Diproses", READY: "Siap Kirim", SHIPPING: "Siap Kirim", DELIVERED: "Terkirim", CANCELLED: "Dibatalkan" };
  for (const [k, label] of Object.entries(order)) assert.equal(displayStatusOfOrder(k).label, label, k);
  assert.equal(displayStatusOfUnit("TIDAK_ADA"), null); assert.equal(displayStatusOfOrder(undefined), null);
  assert.deepEqual([...DISPLAY_STATUS_FILTERS], ["PENGAMBILAN", "DIPROSES", "SIAP_KIRIM", "TERKIRIM"]);
  assert.deepEqual(DISPLAY_STATUS_UNIT_FILTER.DIPROSES.sort(), ["IN_PRODUCTION", "RECEIVED"]);
  assert.deepEqual(DISPLAY_STATUS_UNIT_FILTER.SIAP_KIRIM.sort(), ["IN_TRANSIT_OUT", "READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD"]);
  assert.equal(displayStatusOfUnit("IN_TRANSIT_OUT").detail, "Dalam pengiriman", "sub-keadaan tidak hilang");
  assert.deepEqual(displayStatusCountsOf([{ status: "RECEIVED", count: 3 }, { status: "IN_PRODUCTION", count: 4 }, { status: "DELIVERED", count: 9 }, { status: "CANCELLED", count: 2 }]), { PENGAMBILAN: 0, DIPROSES: 7, SIAP_KIRIM: 0, TERKIRIM: 9 });
});

test("unit selesai (Siap Kirim/Terkirim/Dibatalkan) tidak tampil di backlog/meja; hanya unit Diproses yang layak kerja", () => {
  for (const s of ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED", "CANCELLED"]) assert.equal(isFinishedUnitStatus(s), true, s);
  for (const s of ["AWAITING_PICKUP", "IN_TRANSIT_IN", "RECEIVED", "IN_PRODUCTION"]) assert.equal(isFinishedUnitStatus(s), false, s);
  assert.equal(isWorkableUnitStatus("RECEIVED"), true); assert.equal(isWorkableUnitStatus("IN_TRANSIT_IN"), false);
});

test("backlog default: order nyata Diproses DAN unit Diproses; order multi-unit yang unitnya sudah Siap Kirim tidak ikut; SPAM/staf internal & tanpa order ditolak", () => {
  assert.equal(isBacklogEligible({ orderStatus: "PROCESSING", unitStatus: "IN_PRODUCTION" }), true);
  assert.equal(isBacklogEligible({ orderStatus: "PROCESSING", unitStatus: "READY_FOR_DELIVERY" }), false, "order weakest-link masih Diproses, unitnya sudah Siap Kirim");
  assert.equal(isBacklogEligible({ orderStatus: "READY", unitStatus: "READY_FOR_DELIVERY" }), false);
  assert.equal(isBacklogEligible({ orderStatus: "DELIVERED", unitStatus: "DELIVERED" }), false);
  assert.equal(isBacklogEligible({ orderStatus: "PICKUP", unitStatus: "IN_TRANSIT_IN" }), false, "Pengambilan bukan backlog default");
  assert.equal(isBacklogEligible({ orderStatus: "PROCESSING", unitStatus: "RECEIVED", customerExcluded: true }), false);
  assert.equal(isBacklogEligible({ orderStatus: null, unitStatus: "RECEIVED" }), false);
});

test("keberadaan fisik: konfirmasi tiba HANYA dari custody INBOUND diterima atau run lahir workshop — tidak pernah dipalsukan", () => {
  assert.equal(physicalPresenceOf({ unitStatus: "IN_TRANSIT_IN", runStatus: "PENDING_ARRIVAL" }).key, "NOT_ARRIVED");
  assert.equal(physicalPresenceOf({ unitStatus: "RECEIVED", runStatus: "PENDING_ARRIVAL" }).key, "NOT_ARRIVED", "run menunggu kedatangan = belum tiba apa pun status unitnya");
  assert.equal(physicalPresenceOf({ unitStatus: "AWAITING_PICKUP" }).confirmed, false);
  assert.deepEqual([physicalPresenceOf({ unitStatus: "IN_PRODUCTION", runStatus: "ACTIVE", inboundAccepted: true }).key, physicalPresenceOf({ unitStatus: "IN_PRODUCTION", runStatus: "ACTIVE", inboundAccepted: true }).confirmed], ["ARRIVED_CONFIRMED", true]);
  assert.equal(physicalPresenceOf({ unitStatus: "IN_PRODUCTION", runStatus: "ACTIVE", runOrigin: "WORKSHOP_BORN" }).key, "ARRIVED_CONFIRMED");
  const legacy = physicalPresenceOf({ unitStatus: "IN_PRODUCTION" });
  assert.equal(legacy.key, "AT_WORKSHOP_UNCONFIRMED"); assert.equal(legacy.confirmed, false); assert.match(legacy.label, /belum tercatat/);
  assert.equal(physicalPresenceOf({ unitStatus: "DELIVERED" }).key, "LEFT_WORKSHOP");
});

test("prioritas: Normal · Tinggi · Komplain; Mendesak/Kritis lama tampil Tinggi (data tidak diubah); Komplain HANYA dari kasus resmi", () => {
  assert.deepEqual([0, 1, 2].map((n) => priorityDisplay({ stored: n }).label), ["Normal", "Tinggi", "Tinggi"]);
  assert.deepEqual(["NORMAL", "HIGH", "URGENT", "CRITICAL"].map((n) => priorityDisplay({ stored: n }).label), ["Normal", "Tinggi", "Tinggi", "Tinggi"]);
  assert.equal(storedPriorityLevel(2), 1); assert.equal(storedPriorityLevel("CRITICAL"), 1); assert.equal(storedPriorityLevel(undefined), 0);
  const k = priorityDisplay({ stored: 0, complaintCases: [{ id: "c1", caseNumber: "CMP-1" }] });
  assert.equal(k.key, "COMPLAINT"); assert.equal(k.label, "Komplain"); assert.deepEqual(k.complaintCases, [{ id: "c1", caseNumber: "CMP-1" }]);
  assert.equal(priorityDisplay({ stored: 2, complaintCases: [{ id: "c1", caseNumber: "CMP-1" }] }).key, "COMPLAINT", "Komplain mengalahkan Tinggi");
  assert.equal(priorityDisplay({ stored: 0 }).key, "NORMAL", "tanpa kasus resmi tidak pernah Komplain");
  assert.deepEqual([0, 1, 2].map((n) => PRIORITY_LABEL[n]), ["Normal", "Tinggi", "Tinggi"]);
  // kasus terbuka = bukan SELESAI/DIBATALKAN (sama dengan filter komplain aktif di routes/orders.js)
  assert.deepEqual([...OPEN_COMPLAINT_STATUS_EXCLUDED], ["SELESAI", "DIBATALKAN"]);
});

test("urutan meja: urutan MANUAL tetap menang atas prioritas apa pun (termasuk Komplain); tanpa nomor = Komplain > nilai tersimpan > target mulai", () => {
  const sort = (items) => [...items].sort(compareStationOrder).map((x) => x.id);
  assert.deepEqual(sort([{ id: "komplain", stationSequence: 3, priorityRank: 3, priority: 0 }, { id: "normal", stationSequence: 1, priorityRank: 0, priority: 0 }, { id: "tinggi", stationSequence: 2, priorityRank: 1, priority: 1 }]), ["normal", "tinggi", "komplain"]);
  assert.deepEqual(sort([{ id: "n", priorityRank: 0 }, { id: "t", priorityRank: 1 }, { id: "k", priorityRank: 3 }, { id: "m", priorityRank: 2 }]), ["k", "m", "t", "n"]);
  assert.deepEqual(sort([{ id: "baru", priorityRank: 3 }, { id: "manual", stationSequence: 1, priorityRank: 0 }]), ["manual", "baru"]);
});

test("Pekerjaan Tertunda: 8 nilai BlockReason -> 4 alasan; submit memakai SATU enum yang sudah ada; tidak ada enum baru; Lainnya wajib keterangan di kontrak backend", () => {
  assert.deepEqual(Object.values(DELAY_REASONS).map((r) => r.label), ["Menunggu bahan", "Menunggu arahan", "Kendala pengerjaan", "Lainnya"]);
  for (const v of BLOCK_REASON_VALUES) assert.ok(delayReasonOfBlock(v).key in DELAY_REASONS, v);
  for (const r of Object.values(DELAY_REASONS)) assert.ok(BLOCK_REASON_VALUES.includes(r.submitAs), `${r.key} -> enum yang sudah ada`);
  assert.equal(delayReasonOfBlock("QUALITY_ISSUE").label, "Kendala pengerjaan"); assert.equal(delayReasonOfBlock("AWAITING_OPERATOR").label, "Menunggu arahan"); assert.equal(delayReasonOfBlock("TAK_DIKENAL").label, "Lainnya");
  assert.equal(delayStatusText("MATERIAL_SHORTAGE"), "Tertunda — menunggu bahan");
  assert.equal(delayStatusText("OTHER", "Pelanggan minta ganti warna"), "Tertunda — Pelanggan minta ganti warna");
  assert.equal(delayStatusText("OTHER"), "Tertunda — lainnya");
  for (const v of BLOCK_REASON_VALUES) assert.equal(BLOCK_REASON_LABEL[v], delayReasonOfBlock(v).label);
});

test("statis: kata lama (Blocked/Blokir/Terhambat/Blocker) tidak lagi muncul di narasi & judul exception backend; enum BlockReason TIDAK berubah", () => {
  const src = (p) => fs.readFileSync(path.join(here, "..", "src", p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const ex = src("lib/domain/productionExceptions.js"); const log = src("lib/activityLog.js");
  assert.doesNotMatch(ex, /"Production Blocked"|`Blocked —|Resolve blocker|Waiting material/);
  assert.doesNotMatch(log, /Production blocked|Production blocker resolved/);
  assert.match(ex, /Pekerjaan Tertunda/); assert.match(log, /Pekerjaan tertunda — /); assert.match(log, /Pekerjaan dilanjutkan/);
  assert.deepEqual(BLOCK_REASON_VALUES, ["MATERIAL_SHORTAGE", "AWAITING_CUSTOMER_APPROVAL", "MACHINE_DOWN", "QUALITY_ISSUE", "OTHER", "AWAITING_CUSTOMER", "AWAITING_OPERATOR", "AWAITING_TOOL"]);
});
