// Rencana Produksi order nyata — logika murni: kelayakan unit (matriks aksi/pengecualian), penjelasan foto, dan aturan atribusi foto pickup (tanpa DB; Prisma di-stub).
import test from "node:test";
import assert from "node:assert/strict";
import { RENCANA_ACTION as A, RENCANA_EXCEPTION as E, classifyRencanaUnit, photoNoteOf } from "../src/lib/domain/productionRencana.js";
import { diagnoseUnitPhotosBulk, resolveUnitPhoto, resolveUnitPhotosBulk } from "../src/services/productionUnitPhotoService.js";
import { ARRIVAL_NO_CUSTODY_REASON, arrivalConfirmedByStaff, physicalPresenceOf } from "../src/lib/domain/productionDisplay.js";

const base = { unitStatus: "RECEIVED", orderStatus: "PROCESSING", customerStage: "NEW", isInternalStaff: false, hasActiveRun: false, stageLogCount: 0, hasCurrentStage: false, readerEnabled: false, writerEnabled: false };

test("kelayakan: unit Diproses bersih di luar cohort = menunggu aktivasi (bukan 'tidak bisa'), dengan aksi berikutnya yang jelas", () => {
  const r = classifyRencanaUnit(base);
  assert.equal(r.action, A.AWAIT_ACTIVATION); assert.equal(r.eligible, false); assert.match(r.next, /Owner/); assert.doesNotMatch(r.message, /Belum bisa dijadwalkan/);
});

test("kelayakan: unit Diproses bersih di cohort reader+writer = ONBOARD_SCHEDULE (eligible); IN_PRODUCTION juga", () => {
  for (const unitStatus of ["RECEIVED", "IN_PRODUCTION"]) {
    const r = classifyRencanaUnit({ ...base, unitStatus, readerEnabled: true, writerEnabled: true });
    assert.equal(r.action, A.ONBOARD_SCHEDULE); assert.equal(r.eligible, true);
  }
});

test("kelayakan: aktivasi sebagian (hanya reader atau hanya writer) = pengecualian PARTIAL_ACTIVATION, tidak eligible", () => {
  for (const [readerEnabled, writerEnabled] of [[true, false], [false, true]]) {
    const r = classifyRencanaUnit({ ...base, readerEnabled, writerEnabled });
    assert.equal(r.action, A.EXCEPTION); assert.equal(r.code, E.PARTIAL_ACTIVATION); assert.equal(r.eligible, false);
  }
});

test("kelayakan: Siap Kirim/Terkirim/dibatalkan/SPAM/staf TIDAK masuk Rencana (apa pun cohortnya)", () => {
  const on = { readerEnabled: true, writerEnabled: true };
  for (const unitStatus of ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED"]) {
    const r = classifyRencanaUnit({ ...base, ...on, unitStatus, hasActiveRun: true }); assert.equal(r.code, E.UNIT_FINISHED); assert.equal(r.eligible, false);
  }
  assert.equal(classifyRencanaUnit({ ...base, ...on, unitStatus: "CANCELLED" }).code, E.UNIT_CANCELLED);
  assert.equal(classifyRencanaUnit({ ...base, ...on, orderStatus: "CANCELLED" }).code, E.UNIT_CANCELLED);
  assert.equal(classifyRencanaUnit({ ...base, ...on, customerStage: "SPAM" }).code, E.INTERNAL_OR_SPAM);
  assert.equal(classifyRencanaUnit({ ...base, ...on, isInternalStaff: true }).code, E.INTERNAL_OR_SPAM);
});

test("kelayakan: Run aktif TIDAK dibuat ganda — di cohort = SCHEDULE (pakai Run itu); di luar cohort = pengecualian, bukan onboarding", () => {
  assert.equal(classifyRencanaUnit({ ...base, hasActiveRun: true, readerEnabled: true, writerEnabled: true }).action, A.SCHEDULE);
  const r = classifyRencanaUnit({ ...base, hasActiveRun: true });
  assert.equal(r.action, A.EXCEPTION); assert.equal(r.code, E.RUN_OUTSIDE_COHORT, "Run lama (custody/backfill) di luar cohort: bukan tugas Rencana, bukan 'aktivasi sebagian'");
  assert.equal(classifyRencanaUnit({ ...base, hasActiveRun: true, readerEnabled: true }).code, E.PARTIAL_ACTIVATION, "hanya reader/writer = aktivasi sebagian, dengan Run pun");
});

test("kelayakan: progres/riwayat V1 dipertahankan — unit dengan stage log atau tahap berjalan TIDAK di-onboard dari tombol Jadwalkan", () => {
  const on = { readerEnabled: true, writerEnabled: true };
  assert.equal(classifyRencanaUnit({ ...base, ...on, stageLogCount: 3 }).code, E.HAS_V1_PROGRESS);
  assert.equal(classifyRencanaUnit({ ...base, ...on, hasCurrentStage: true }).code, E.HAS_V1_PROGRESS);
  assert.equal(classifyRencanaUnit({ ...base, stageLogCount: 1 }).code, E.HAS_V1_PROGRESS, "pengecualian lebih dulu daripada 'menunggu aktivasi' — aktivasi tidak menyelesaikannya");
});

test("kelayakan: Pengambilan (belum diambil/dalam perjalanan masuk) = WAIT_PICKUP; order belum Diproses = pengecualian; status Diproses bukan bukti tiba", () => {
  for (const unitStatus of ["AWAITING_PICKUP", "IN_TRANSIT_IN"]) assert.equal(classifyRencanaUnit({ ...base, unitStatus, orderStatus: "PICKUP" }).action, A.WAIT_PICKUP);
  assert.equal(classifyRencanaUnit({ ...base, orderStatus: "PENDING" }).code, E.ORDER_NOT_PROCESSING);
  assert.equal(classifyRencanaUnit({ ...base, orderStatus: "READY" }).code, E.ORDER_NOT_PROCESSING);
  // unit Diproses tanpa Run: presence TIDAK dinyatakan tiba (Run baru PENDING_ARRIVAL)
  assert.equal(physicalPresenceOf({ unitStatus: "RECEIVED", runStatus: "PENDING_ARRIVAL", runOrigin: "CUSTODY_PICKUP", inboundAccepted: false }).key, "NOT_ARRIVED");
});

test("presence: kedatangan dikonfirmasi petugas tanpa custody hanya dikenali lewat penanda INTAKE (bukan status Diproses/startedAt)", () => {
  const phases = (reason) => [{ phase: "INTAKE", reason }, { phase: "PROCESS", reason: null }];
  assert.equal(arrivalConfirmedByStaff(phases(ARRIVAL_NO_CUSTODY_REASON)), true);
  assert.equal(arrivalConfirmedByStaff(phases("Kedatangan dikonfirmasi petugas")), false);
  assert.equal(arrivalConfirmedByStaff(phases(null)), false);
  assert.equal(arrivalConfirmedByStaff(undefined), false);
  assert.equal(physicalPresenceOf({ unitStatus: "RECEIVED", runStatus: "ACTIVE", runOrigin: "CUSTODY_PICKUP", inboundAccepted: arrivalConfirmedByStaff(phases(ARRIVAL_NO_CUSTODY_REASON)) }).key, "ARRIVED_CONFIRMED");
  assert.equal(physicalPresenceOf({ unitStatus: "RECEIVED", runStatus: "ACTIVE", runOrigin: "CUSTODY_PICKUP", inboundAccepted: arrivalConfirmedByStaff(phases(null)) }).key, "AT_WORKSHOP_UNCONFIRMED");
});

test("penjelasan foto: ada foto = tanpa catatan; ambigu/menunggu/tanpa pickup masing-masing punya penjelasan yang jujur", () => {
  assert.equal(photoNoteOf({ photoUrl: "/media/unit-photo/x", diagnosis: { status: "AMBIGUOUS", jobUnitCount: 3 } }), null);
  const amb = photoNoteOf({ photoUrl: null, diagnosis: { status: "AMBIGUOUS", jobUnitCount: 3 } });
  assert.equal(amb.status, "AMBIGUOUS"); assert.match(amb.text, /3 unit/); assert.match(amb.text, /tidak bisa dipastikan/);
  assert.equal(photoNoteOf({ photoUrl: null, diagnosis: { status: "NO_PHOTO" } }).status, "NO_PHOTO");
  assert.equal(photoNoteOf({ photoUrl: null, diagnosis: undefined }).status, "NO_PICKUP");
});

// ---- resolver foto: Prisma di-stub (hanya bentuk yang dipakai resolver) ----
const jobRow = (id, units, urls, completedAt = "2026-10-05T10:00:00Z") => ({ id, proofPhotoUrls: urls, completedAt: new Date(completedAt), createdAt: new Date("2026-10-01T00:00:00Z"), units: units.map((u) => ({ id: u, unitId: u })) });
function stubPrisma({ handoffs = [], jobs = [], manual = [] } = {}) {
  return {
    unitCustodyHandoff: { findFirst: async () => handoffs[0] || null, findMany: async () => handoffs },
    job: {
      findMany: async (q) => {
        const inIds = q.where.units.some.unitId.in || [q.where.units.some.unitId];
        let rows = jobs.filter((j) => j.units.some((u) => inIds.includes(u.unitId)));
        if (q.where.proofPhotoUrls) rows = rows.filter((j) => j.proofPhotoUrls.length > 0);
        return rows.map((j) => ({ ...j, units: q.take === 1 && !q.select.units.select.unitId ? j.units.slice(0, 2) : j.units }));
      },
    },
    unitPhoto: { findFirst: async () => manual[0] || null, findMany: async () => manual },
  };
}

test("foto: pickup single-unit TANPA handoff custody (unit di luar cohort) diatribusikan ke unit itu — kasus order nyata", async () => {
  const p = stubPrisma({ jobs: [jobRow("J1", ["U1"], ["/media/job-photos/abc.jpg"])] });
  const r = await resolveUnitPhoto(p, "U1");
  assert.deepEqual(r, { source: "DRIVER_PICKUP", jobPhotoFilename: "abc.jpg", mimeType: "image/jpeg" });
  const bulk = await resolveUnitPhotosBulk(p, ["U1", "U2"]);
  assert.equal(bulk.get("U1").source, "DRIVER_PICKUP"); assert.equal(bulk.get("U2"), null);
});

test("foto: pickup MULTI-unit TIDAK PERNAH diatribusikan (tidak menebak) dan didiagnosis AMBIGUOUS dengan jumlah unit", async () => {
  const p = stubPrisma({ jobs: [jobRow("J2", ["U1", "U2", "U3"], ["/media/job-photos/abc.jpg"])] });
  assert.equal(await resolveUnitPhoto(p, "U1"), null);
  const bulk = await resolveUnitPhotosBulk(p, ["U1", "U2", "U3"]); for (const id of ["U1", "U2", "U3"]) assert.equal(bulk.get(id), null);
  const d = await diagnoseUnitPhotosBulk(p, ["U1", "U2"]);
  assert.deepEqual(d.get("U1"), { status: "AMBIGUOUS", jobUnitCount: 3 }); assert.deepEqual(d.get("U2"), { status: "AMBIGUOUS", jobUnitCount: 3 });
});

test("foto: job pickup TERBARU menang; nama berkas tak aman (path traversal/ekstensi aneh) ditolak; manual hanya bila tidak ada pickup", async () => {
  const p = stubPrisma({ jobs: [jobRow("OLD", ["U1"], ["/media/job-photos/old.jpg"], "2026-10-01T00:00:00Z"), jobRow("NEW", ["U1"], ["/media/job-photos/new.png"], "2026-10-05T00:00:00Z")] });
  assert.equal((await resolveUnitPhotosBulk(p, ["U1"])).get("U1").jobPhotoFilename, "new.png");
  const bad = stubPrisma({ jobs: [jobRow("B", ["U1"], ["/media/job-photos/../../etc/passwd"])], manual: [{ unitId: "U1", storageKey: "m.jpg", mimeType: "image/jpeg" }] });
  assert.equal((await resolveUnitPhoto(bad, "U1")).source, "PRODUCTION_MANUAL", "pickup tak sah -> jatuh ke manual, bukan berkas liar");
  const both = stubPrisma({ jobs: [jobRow("J", ["U1"], ["/media/job-photos/ok.webp"])], manual: [{ unitId: "U1", storageKey: "m.jpg", mimeType: "image/jpeg" }] });
  assert.equal((await resolveUnitPhoto(both, "U1")).source, "DRIVER_PICKUP", "pickup menang atas manual");
});

test("foto: diagnosis membedakan 'ada job pickup tanpa foto' dan 'tidak ada pickup'", async () => {
  const p = stubPrisma({ jobs: [jobRow("J", ["U1"], [])] });
  const d = await diagnoseUnitPhotosBulk(p, ["U1", "U9"]);
  assert.equal(d.get("U1").status, "NO_PHOTO"); assert.equal(d.get("U9").status, "NO_PICKUP");
});
