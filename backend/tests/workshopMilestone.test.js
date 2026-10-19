// Milestone global "Diterima di Workshop" — fungsi murni + bentuk fragmen where (tanpa DB). Kontrak: lib/domain/workshopMilestone.js, docs/MILESTONE-DITERIMA-WORKSHOP.md.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GLOBAL_STATUS, GLOBAL_STATUS_FLOW, LEGACY_NOT_CONFIRMED, PICKUP_DONE_WAITING_RECEIVE, RECEIVED_BASIS, SCHEDULE_STATUS,
  globalStatusOf, globalStatusOfOrder, milestoneOf, orderMilestoneView, orderRollupOf, receivedBasisOf, scheduleStatusOf,
} from "../src/lib/domain/workshopMilestone.js";
import { physicalPresenceOf } from "../src/lib/domain/productionDisplay.js";
import {
  WHERE_PICKUP_DONE_NOT_RECEIVED, WHERE_PICKUP_IN_PROGRESS, WHERE_RECEIVED, WHERE_STARTED, WHERE_WAITING_PICKUP, unitWhereForGlobalStatus, unitWhereForGlobalStatuses,
} from "../src/services/workshopMilestoneEvidence.js";
import { BACKLOG_STATUSES, BACKLOG_STATUS_DEFAULT, parseBacklogQuery } from "../src/services/productionBacklog.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => fs.readFileSync(path.join(here, "..", p), "utf8");
const keyOf = (p) => globalStatusOf(p).key;

test("kosakata: urutan kanonis Menunggu Dijemput → Pengambilan → Diterima di Workshop → Diproses → Siap Kirim → Dalam Pengiriman → Terkirim", () => {
  assert.deepEqual([...GLOBAL_STATUS_FLOW], ["MENUNGGU_DIJEMPUT", "PENGAMBILAN", "DITERIMA_WORKSHOP", "DIPROSES", "SIAP_KIRIM", "DALAM_PENGIRIMAN", "TERKIRIM"]);
  assert.deepEqual(GLOBAL_STATUS_FLOW.map((k) => GLOBAL_STATUS[k].label), ["Menunggu Dijemput", "Pengambilan", "Diterima di Workshop", "Diproses", "Siap Kirim", "Dalam Pengiriman", "Terkirim"]);
});

test("pickup selesai (RECEIVED) TANPA bukti terima BUKAN Diterima di Workshop dan BUKAN Diproses — tetap Pengambilan dengan kalimat jujur", () => {
  const a = globalStatusOf({ unitStatus: "RECEIVED", pickupCompleted: true });
  assert.equal(a.key, "PENGAMBILAN"); assert.equal(a.detail, PICKUP_DONE_WAITING_RECEIVE); assert.equal(a.evidence.received, false);
  const b = globalStatusOf({ unitStatus: "RECEIVED" }); // histori lama tanpa catatan pickup
  assert.equal(b.key, "PENGAMBILAN"); assert.equal(b.detail, LEGACY_NOT_CONFIRMED);
  assert.equal(LEGACY_NOT_CONFIRMED, "Konfirmasi workshop belum tercatat");
});

test("Diterima di Workshop hanya dengan bukti command resmi (custody / konfirmasi petugas / lahir di workshop) DAN belum dimulai", () => {
  for (const basis of Object.values(RECEIVED_BASIS)) {
    const g = globalStatusOf({ unitStatus: "RECEIVED", receivedBasis: basis });
    assert.equal(g.key, "DITERIMA_WORKSHOP", basis); assert.equal(g.evidence.receivedBasis, basis); assert.equal(g.detail, null);
  }
  assert.equal(receivedBasisOf({}), null);
  assert.equal(receivedBasisOf({ inboundAccepted: true, staffConfirmed: true, bornInWorkshop: true }), RECEIVED_BASIS.CUSTODY); // prioritas custody
  assert.equal(receivedBasisOf({ staffConfirmed: true, bornInWorkshop: true }), RECEIVED_BASIS.STAFF_CONFIRMED);
});

test("Diproses hanya setelah pekerjaan pertama dimulai; sudah diterima tetapi belum dimulai = Diterima di Workshop; sudah dijadwalkan ≠ Diproses", () => {
  assert.equal(keyOf({ unitStatus: "RECEIVED", receivedBasis: "CUSTODY", started: false }), "DITERIMA_WORKSHOP");
  assert.equal(keyOf({ unitStatus: "RECEIVED", receivedBasis: "CUSTODY", started: true }), "DIPROSES");
  assert.equal(keyOf({ unitStatus: "IN_PRODUCTION", receivedBasis: "CUSTODY" }), "DIPROSES");
  // histori V1 lama: sudah berjalan tanpa bukti terima -> Diproses, keberadaan fisik "belum tercatat" (tidak ada bukti palsu)
  const legacy = globalStatusOf({ unitStatus: "IN_PRODUCTION" });
  assert.equal(legacy.key, "DIPROSES"); assert.equal(legacy.detail, LEGACY_NOT_CONFIRMED); assert.equal(legacy.evidence.received, false);
  // jadwal tidak menggeser status global
  const m = milestoneOf({ unitStatus: "RECEIVED", receivedBasis: "CUSTODY", started: false, scheduled: true });
  assert.equal(m.globalStatus.key, "DITERIMA_WORKSHOP"); assert.equal(m.scheduleStatus.key, "SIAP_DIKERJAKAN");
  const m2 = milestoneOf({ unitStatus: "RECEIVED", receivedBasis: null, started: false, scheduled: true, pickupCompleted: true });
  assert.equal(m2.globalStatus.key, "PENGAMBILAN"); assert.equal(m2.scheduleStatus.key, "SUDAH_DIJADWALKAN");
});

test("status setelah produksi mengikuti status tersimpan: Siap Kirim, Dalam Pengiriman, Terkirim, Dibatalkan", () => {
  assert.equal(keyOf({ unitStatus: "READY_FOR_DELIVERY" }), "SIAP_KIRIM");
  const hold = globalStatusOf({ unitStatus: "READY_ON_CUSTOMER_HOLD" });
  assert.equal(hold.key, "SIAP_KIRIM"); assert.equal(hold.detail, "Ditahan pelanggan");
  assert.equal(keyOf({ unitStatus: "IN_TRANSIT_OUT" }), "DALAM_PENGIRIMAN");
  assert.equal(keyOf({ unitStatus: "DELIVERED" }), "TERKIRIM");
  assert.equal(keyOf({ unitStatus: "CANCELLED" }), "DIBATALKAN");
  // UnitStatus tetap AWAITING_PICKUP selama job pickup berjalan -> dibedakan oleh job pickup (EN_ROUTE/ARRIVED), bukan oleh status unit
  assert.equal(globalStatusOf({ unitStatus: "AWAITING_PICKUP" }).key, "MENUNGGU_DIJEMPUT");
  const jalan = globalStatusOf({ unitStatus: "AWAITING_PICKUP", pickupInProgress: true });
  assert.equal(jalan.key, "PENGAMBILAN"); assert.equal(jalan.detail, "Pickup sedang berlangsung");
  assert.equal(globalStatusOf({ unitStatus: "IN_TRANSIT_IN" }).key, "PENGAMBILAN");
  assert.equal(globalStatusOf({ unitStatus: "IN_TRANSIT_IN" }).detail, "Dalam perjalanan ke workshop");
  assert.equal(globalStatusOf({ unitStatus: "TIDAK_ADA" }), null);
});

test("status order = unit PALING AWAL di alur (weakest link); unit dibatalkan diabaikan", () => {
  const g = (u) => globalStatusOf(u);
  assert.equal(globalStatusOfOrder([g({ unitStatus: "READY_FOR_DELIVERY" }), g({ unitStatus: "RECEIVED", receivedBasis: "CUSTODY" })]).key, "DITERIMA_WORKSHOP");
  assert.equal(globalStatusOfOrder([g({ unitStatus: "DELIVERED" }), g({ unitStatus: "IN_TRANSIT_OUT" })]).key, "DALAM_PENGIRIMAN");
  assert.equal(globalStatusOfOrder([g({ unitStatus: "CANCELLED" }), g({ unitStatus: "READY_FOR_DELIVERY" })]).key, "SIAP_KIRIM");
  assert.equal(globalStatusOfOrder([g({ unitStatus: "CANCELLED" })]).key, "DIBATALKAN");
  assert.equal(globalStatusOfOrder([]), null);
});

test("status jadwal: empat nilai terpisah; Menunggu bahan mengalahkan Siap dikerjakan; belum dijadwalkan selalu Belum dijadwalkan", () => {
  assert.deepEqual(Object.values(SCHEDULE_STATUS).map((s) => s.label), ["Belum dijadwalkan", "Sudah dijadwalkan", "Menunggu bahan", "Siap dikerjakan"]);
  assert.equal(scheduleStatusOf({ scheduled: false, materialWaiting: true, receivedBasis: "CUSTODY" }).key, "BELUM_DIJADWALKAN");
  assert.equal(scheduleStatusOf({ scheduled: true }).key, "SUDAH_DIJADWALKAN");
  assert.equal(scheduleStatusOf({ scheduled: true, materialWaiting: true, receivedBasis: "CUSTODY" }).key, "MENUNGGU_BAHAN");
  assert.equal(scheduleStatusOf({ scheduled: true, receivedBasis: "STAFF_CONFIRMED" }).key, "SIAP_DIKERJAKAN");
  assert.equal(scheduleStatusOf({ scheduled: true, started: true }).key, "SIAP_DIKERJAKAN");
});

test("keberadaan fisik: konfirmasi petugas (tanpa custody) juga bukti tiba; tanpa bukti tetap 'konfirmasi belum tercatat'", () => {
  assert.equal(physicalPresenceOf({ unitStatus: "RECEIVED", staffConfirmed: true }).confirmed, true);
  assert.equal(physicalPresenceOf({ unitStatus: "RECEIVED" }).confirmed, false);
  assert.equal(physicalPresenceOf({ unitStatus: "RECEIVED", inboundAccepted: true }).key, "ARRIVED_CONFIRMED");
  assert.equal(physicalPresenceOf({ unitStatus: "AWAITING_PICKUP", staffConfirmed: true }).key, "NOT_ARRIVED"); // pickup belum selesai: tidak pernah 'tiba'
});

// ---- fragmen where (server-side filter & hitungan) ---------------------------------------------------------------------------------------
test("where: Pengambilan = pickup berjalan ATAU (RECEIVED, belum dimulai, belum ada bukti terima); Diterima = RECEIVED + bukti + belum dimulai; Diproses = dimulai", () => {
  const flat = (o) => JSON.stringify(o);
  const p = unitWhereForGlobalStatus("PENGAMBILAN");
  assert.deepEqual(p.OR, [WHERE_PICKUP_IN_PROGRESS, WHERE_PICKUP_DONE_NOT_RECEIVED]);
  assert.match(JSON.stringify(WHERE_PICKUP_IN_PROGRESS), /IN_TRANSIT_IN/); assert.match(JSON.stringify(WHERE_PICKUP_IN_PROGRESS), /"EN_ROUTE","ARRIVED"/);
  assert.equal(unitWhereForGlobalStatus("MENUNGGU_DIJEMPUT"), WHERE_WAITING_PICKUP);
  assert.match(JSON.stringify(WHERE_WAITING_PICKUP), /AWAITING_PICKUP/); assert.match(JSON.stringify(WHERE_WAITING_PICKUP), /"NOT":/);
  assert.match(flat(WHERE_PICKUP_DONE_NOT_RECEIVED), /"status":"RECEIVED"/);
  assert.match(flat(WHERE_PICKUP_DONE_NOT_RECEIVED), /"NOT":/); // NOT started & NOT received
  const d = unitWhereForGlobalStatus("DITERIMA_WORKSHOP");
  assert.deepEqual(d.AND[0], { status: "RECEIVED" }); assert.equal(d.AND[1], WHERE_RECEIVED); assert.deepEqual(d.AND[2], { NOT: WHERE_STARTED });
  const x = unitWhereForGlobalStatus("DIPROSES");
  assert.deepEqual(x.AND[0].status.in, ["RECEIVED", "IN_PRODUCTION"]); assert.equal(x.AND[1], WHERE_STARTED);
  assert.deepEqual(unitWhereForGlobalStatus("DALAM_PENGIRIMAN"), { status: "IN_TRANSIT_OUT" });
  assert.deepEqual(unitWhereForGlobalStatus("TERKIRIM"), { status: "DELIVERED" });
  assert.equal(unitWhereForGlobalStatus("ASAL"), null);
  assert.equal(unitWhereForGlobalStatuses(["ASAL"]), null);
  assert.deepEqual(unitWhereForGlobalStatuses(["TERKIRIM", "TERKIRIM"]), unitWhereForGlobalStatus("TERKIRIM"));
  assert.equal(unitWhereForGlobalStatuses(["SIAP_KIRIM", "TERKIRIM"]).OR.length, 2);
});

test("where: bukti terima hanya tiga command resmi; pickup selesai (jobUnit/status RECEIVED) TIDAK termasuk bukti", () => {
  const s = JSON.stringify(WHERE_RECEIVED);
  assert.match(s, /custodyHandoffs/); assert.match(s, /"direction":"INBOUND"/); assert.match(s, /"status":"ACCEPTED"/);
  assert.match(s, /WORKSHOP_BORN/); assert.match(s, /Kedatangan dikonfirmasi petugas \(tanpa custody\)/);
  assert.doesNotMatch(s, /jobUnits|PICKUP|RECEIVED/);
  const st = JSON.stringify(WHERE_STARTED);
  assert.match(st, /IN_PRODUCTION/); assert.match(st, /stageLogs/); assert.match(st, /"SKIPPED"/);
});

test("backlog: tab Pengambilan · Diterima di Workshop · Diproses (+ SEMUA = himpunan lama); default SEMUA; status tak dikenal jatuh ke default", () => {
  assert.deepEqual([...BACKLOG_STATUSES], ["SEMUA", "MENUNGGU_DIJEMPUT", "PENGAMBILAN", "DITERIMA_WORKSHOP", "DIPROSES"]);
  assert.equal(BACKLOG_STATUS_DEFAULT, "SEMUA");
  assert.equal(parseBacklogQuery({}).status, "SEMUA");
  assert.equal(parseBacklogQuery({ status: "diterima_workshop" }).status, "DITERIMA_WORKSHOP");
  assert.equal(parseBacklogQuery({ status: "DIPROSES" }).status, "DIPROSES");
  assert.equal(parseBacklogQuery({ status: "SIAP_KIRIM" }).status, "SEMUA"); // Siap Kirim/Terkirim tidak pernah masuk backlog
});

test("tidak ada enum/migrasi baru: UnitStatus & OrderStatus tidak berubah, RECEIVED masih diset saat pickup selesai (bukan oleh milestone)", () => {
  const schema = src("prisma/schema.prisma");
  const unitEnum = schema.match(/enum UnitStatus \{([\s\S]*?)\}/)[1].split("\n").map((l) => l.trim().split(/\s+/)[0]).filter((l) => /^[A-Z_]+$/.test(l));
  assert.deepEqual(unitEnum, ["AWAITING_PICKUP", "IN_TRANSIT_IN", "RECEIVED", "IN_PRODUCTION", "READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED", "CANCELLED"]);
  // modul milestone BACA-SAJA: tidak boleh menulis ke DB
  for (const f of ["src/lib/domain/workshopMilestone.js", "src/services/workshopMilestoneEvidence.js"]) {
    assert.doesNotMatch(src(f), /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/, `${f} harus baca-saja`);
  }
});

test("wiring: backlog, /work-orders, Run view dan Unit 360 memakai milestone yang sama (satu sumber)", () => {
  assert.match(src("src/services/productionBacklog.js"), /loadMilestoneEvidence/);
  assert.match(src("src/routes/production.js"), /listWorkOrders/); // handler /work-orders memanggil listWorkOrders (adopsi Admin); logika filter/hitungan ada di productionOrderList.js
  assert.match(src("src/services/productionOrderList.js"), /unitWhereForGlobalStatuses[\s\S]*globalStatusCounts/);
  assert.match(src("src/services/productionExperienceReadService.js"), /export function milestoneOfRun/);
  const ov = src("src/services/productionUnitOverviewService.js");
  assert.equal((ov.match(/globalStatus: milestone\.globalStatus/g) || []).length, 2); // unit dengan Run + unit tanpa Run
});

// ---- Fase 2: status tingkat order ---------------------------------------------------------------------------------------------------------------
const G = (key) => ({ key });
test("order: semua unit aktif sama -> status itu; berbeda -> unit PALING tertinggal + rincian progres (tanpa enum 'Campuran')", () => {
  const sama = orderRollupOf([G("DIPROSES"), G("DIPROSES")]);
  assert.equal(sama.key, "DIPROSES"); assert.equal(sama.mixed, false); assert.equal(sama.summary, "Diproses · 2 unit"); assert.equal(sama.progressText, "Semua 2 unit");
  const tunggal = orderRollupOf([G("SIAP_KIRIM")]); assert.equal(tunggal.summary, "Siap Kirim"); assert.equal(tunggal.progressText, null);
  const beda = orderRollupOf([G("DITERIMA_WORKSHOP"), G("DITERIMA_WORKSHOP"), G("DIPROSES")]);
  assert.equal(beda.key, "DITERIMA_WORKSHOP"); assert.equal(beda.mixed, true); assert.equal(beda.summary, "Diterima di Workshop · 2 dari 3 unit");
  assert.equal(beda.progressText, "2 dari 3 unit masih Diterima di Workshop"); assert.equal(beda.aheadText, "1 unit Diproses");
  const lag = orderRollupOf([G("PENGAMBILAN"), G("DIPROSES"), G("DIPROSES")]);
  assert.equal(lag.key, "PENGAMBILAN"); assert.equal(lag.laggingCount, 1); assert.equal(lag.aheadText, "2 unit Diproses");
  assert.ok(!Object.keys(GLOBAL_STATUS).some((k) => /CAMPUR/i.test(k)), "tidak ada enum Campuran");
});

test("order: Siap Kirim / Terkirim tidak pernah tampil selama masih ada unit aktif yang tertinggal; unit batal tidak ikut penyebut", () => {
  assert.equal(orderRollupOf([G("TERKIRIM"), G("DIPROSES")]).key, "DIPROSES");
  assert.equal(orderRollupOf([G("SIAP_KIRIM"), G("DITERIMA_WORKSHOP")]).key, "DITERIMA_WORKSHOP");
  assert.equal(orderRollupOf([G("TERKIRIM"), G("DALAM_PENGIRIMAN")]).key, "DALAM_PENGIRIMAN");
  const batal = orderRollupOf([G("DIBATALKAN"), G("SIAP_KIRIM"), G("SIAP_KIRIM")]);
  assert.equal(batal.key, "SIAP_KIRIM"); assert.equal(batal.total, 2); assert.equal(batal.cancelled, 1); assert.equal(batal.mixed, false);
  assert.equal(orderRollupOf([G("DIBATALKAN")]).key, "DIBATALKAN");
  assert.equal(orderRollupOf([]), null); assert.equal(orderRollupOf([null, { key: "ASAL" }]), null);
  assert.equal(globalStatusOfOrder([G("MENUNGGU_DIJEMPUT"), G("TERKIRIM")]).key, "MENUNGGU_DIJEMPUT");
});

test("order: tampilan API — order tanpa unit/sewa TIDAK dikarang (legacy), Order.status CANCELLED = Dibatalkan, status pembayaran tidak memengaruhi", () => {
  const legacy = orderMilestoneView({ orderStatus: "PROCESSING", rollup: null });
  assert.equal(legacy.legacy, true); assert.equal(legacy.key, null); assert.equal(legacy.label, "Diproses");
  const sewa = orderMilestoneView({ orderStatus: "SEWA_DIKIRIM", rollup: orderRollupOf([G("DIPROSES")]) });
  assert.equal(sewa.legacy, true); assert.equal(sewa.key, null);
  assert.equal(orderMilestoneView({ orderStatus: "CANCELLED", rollup: orderRollupOf([G("DIPROSES")]) }).key, "DIBATALKAN");
  const v = orderMilestoneView({ orderStatus: "PROCESSING", rollup: orderRollupOf([G("PENGAMBILAN"), G("DIPROSES")]) });
  assert.equal(v.legacy, false); assert.equal(v.key, "PENGAMBILAN"); assert.equal(v.summary, "Pengambilan · 1 dari 2 unit");
  // pembayaran bukan sumbu status global: tidak ada parameter/pembacaan paymentStatus di modul milestone
  assert.doesNotMatch(src("src/lib/domain/workshopMilestone.js") + src("src/services/workshopMilestoneEvidence.js") + src("src/services/orderMilestoneService.js"), /paymentStatus|BELUM_BAYAR|LUNAS/);
});
