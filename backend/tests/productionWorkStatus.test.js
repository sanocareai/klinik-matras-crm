// Kontrak tiga sumbu status Order Produksi (adopsi Admin) — fungsi MURNI, tanpa DB.
import test from "node:test";
import assert from "node:assert/strict";
import { AKSI, MANUAL_STATUSES, WORK_SOURCE, WORK_STATUS, effectiveWorkStatus, posisiUnitOf, riwayatKerjaManual, tindakanBerikutnya } from "../src/lib/domain/productionWorkStatus.js";
import { MAX_BARIS_RENCANA, RencanaBahanError, normalisasiBarisRencana, sameLines, selisihRencana } from "../src/lib/domain/productionMaterialPlan.js";

const manual = (status, extra = {}) => ({ status, note: null, actor: { name: "Admin Uji" }, createdAt: new Date("2026-10-20T03:00:00Z"), ...extra });

test("status kerja efektif: urutan sumber DIBATALKAN > bukti aplikasi > status order Siap Kirim ke atas > manual > jadwal > belum dijadwalkan", () => {
  assert.equal(effectiveWorkStatus({ unitStatus: "CANCELLED", appStarted: true, manual: manual("DIKERJAKAN") }).key, "DIBATALKAN");
  const app = effectiveWorkStatus({ unitStatus: "IN_PRODUCTION", productionStatus: "WAITING_QC", appStarted: true, manual: manual("SELESAI") });
  assert.equal(app.key, "MENUNGGU_QC"); assert.equal(app.source, WORK_SOURCE.APLIKASI, "bukti aplikasi MENANG atas catatan manual");
  const man = effectiveWorkStatus({ unitStatus: "RECEIVED", manual: manual("DIKERJAKAN") });
  assert.equal(man.key, "DIKERJAKAN"); assert.equal(man.source, WORK_SOURCE.MANUAL); assert.match(man.detail, /Dicatat manual oleh Admin Uji/);
  assert.equal(effectiveWorkStatus({ unitStatus: "READY_FOR_DELIVERY" }).key, "SELESAI");
  assert.equal(effectiveWorkStatus({ unitStatus: "READY_FOR_DELIVERY" }).source, WORK_SOURCE.STATUS_ORDER);
  assert.equal(effectiveWorkStatus({ unitStatus: "RECEIVED", scheduled: true }).key, "DIJADWALKAN");
  assert.equal(effectiveWorkStatus({ unitStatus: "RECEIVED" }).key, "BELUM_DIJADWALKAN");
});

test("catatan manual BELUM_DIJADWALKAN = mengosongkan; catatan manual mengalahkan status order hanya bila ada", () => {
  assert.equal(effectiveWorkStatus({ unitStatus: "RECEIVED", scheduled: true, manual: manual("BELUM_DIJADWALKAN") }).key, "DIJADWALKAN", "dikosongkan → kembali ke jadwal");
  const siap = effectiveWorkStatus({ unitStatus: "READY_FOR_DELIVERY", manual: manual("DIKERJAKAN") });
  assert.equal(siap.key, "SELESAI", "Siap Kirim = pekerjaan selesai; tidak boleh 'Dikerjakan' di samping 'Siap Kirim'"); assert.equal(siap.source, WORK_SOURCE.STATUS_ORDER); assert.match(siap.detail, /catatan manual sebelumnya tetap di riwayat/);
  assert.equal(effectiveWorkStatus({ unitStatus: "RECEIVED", manual: manual("DIKERJAKAN") }).key, "DIKERJAKAN", "status order dimundurkan → catatan manual berlaku lagi");
});

test("satu unit tidak pernah punya dua status kerja: setiap kombinasi menghasilkan tepat satu nilai kamus", () => {
  const unitStatuses = ["AWAITING_PICKUP", "IN_TRANSIT_IN", "RECEIVED", "IN_PRODUCTION", "READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED", "CANCELLED"];
  const prods = [null, "NOT_STARTED", "QUEUED", "IN_PROGRESS", "PAUSED", "BLOCKED", "WAITING_QC", "REWORK", "COMPLETED"];
  for (const unitStatus of unitStatuses) for (const productionStatus of prods) for (const appStarted of [false, true]) for (const scheduled of [false, true]) for (const m of [null, ...MANUAL_STATUSES.map((x) => manual(x))]) {
    const r = effectiveWorkStatus({ unitStatus, productionStatus, appStarted, scheduled, manual: m });
    assert.ok(WORK_STATUS[r.key], `${unitStatus}/${productionStatus}/${appStarted}/${scheduled}/${m?.status} → ${r.key}`); assert.ok(r.source && r.label);
  }
});

test("riwayat manual: catatan terakhir sebelum bukti aplikasi ditandai digantikan; urut lama → baru", () => {
  const e = [{ id: "b", status: "DIKERJAKAN", createdAt: "2026-10-20T05:00:00Z", actor: { name: "B" } }, { id: "a", status: "DIJADWALKAN", createdAt: "2026-10-20T03:00:00Z", actor: { name: "A" } }];
  const r = riwayatKerjaManual(e, { firstEvidenceAt: "2026-10-20T06:00:00Z" });
  assert.deepEqual(r.map((x) => x.id), ["a", "b"]); assert.equal(r[0].digantikanBuktiAplikasi, null); assert.equal(r[1].digantikanBuktiAplikasi, "2026-10-20T06:00:00.000Z");
  assert.equal(riwayatKerjaManual(e, {})[1].digantikanBuktiAplikasi, null);
});

test("posisi unit: pickup selesai tanpa bukti terima = 'Sudah dijemput · belum diterima workshop' (bukan 'Pengambilan' dan bukan 'Diproses')", () => {
  const p = posisiUnitOf({ unitStatus: "RECEIVED", pickupCompleted: true });
  assert.equal(p.key, "SUDAH_DIJEMPUT"); assert.match(p.label, /belum diterima workshop/); assert.equal(p.tone, "orange"); assert.match(p.detail, /Terima Unit di Workshop/);
  assert.equal(posisiUnitOf({ unitStatus: "RECEIVED", receivedBasis: "CUSTODY", receivedBasisLabel: "Diterima petugas lewat custody" }).key, "DI_WORKSHOP");
  assert.equal(posisiUnitOf({ unitStatus: "IN_PRODUCTION" }).key, "DI_WORKSHOP_TANPA_BUKTI");
  assert.equal(posisiUnitOf({ unitStatus: "AWAITING_PICKUP" }).key, "MENUNGGU_DIJEMPUT");
  assert.equal(posisiUnitOf({ unitStatus: "AWAITING_PICKUP", pickupInProgress: true }).key, "DALAM_PENJEMPUTAN");
  assert.equal(posisiUnitOf({ unitStatus: "IN_TRANSIT_OUT" }).key, "DALAM_PENGIRIMAN"); assert.equal(posisiUnitOf({ unitStatus: "DELIVERED" }).key, "DI_PELANGGAN");
});

test("tindakan berikutnya: deterministik per keadaan dan menunjuk pelaku yang benar", () => {
  const t = (unitStatus, posisiKey, kerjaKey, extra = {}) => tindakanBerikutnya({ unitStatus, posisi: { key: posisiKey }, kerja: { key: kerjaKey }, ...extra });
  assert.equal(t("AWAITING_PICKUP", "MENUNGGU_DIJEMPUT", "BELUM_DIJADWALKAN").aktor, "Delivery");
  assert.equal(t("RECEIVED", "SUDAH_DIJEMPUT", "BELUM_DIJADWALKAN").aksi, AKSI.CONFIRM_ARRIVAL);
  assert.equal(t("RECEIVED", "DI_WORKSHOP", "BELUM_DIJADWALKAN").aksi, AKSI.OPEN_PLAN);
  assert.equal(t("RECEIVED", "DI_WORKSHOP", "DIJADWALKAN").aksi, AKSI.SET_TARGET);
  assert.equal(t("RECEIVED", "DI_WORKSHOP", "DIJADWALKAN", { adaTarget: true }).aksi, AKSI.PLAN_MATERIAL);
  assert.equal(t("RECEIVED", "DI_WORKSHOP", "DIJADWALKAN", { adaTarget: true, rencanaBahanAda: true }).aksi, AKSI.START_WORK);
  assert.equal(t("RECEIVED", "DI_WORKSHOP", "DIKERJAKAN", { rencanaBahanAda: true }).aksi, AKSI.RECORD_MATERIAL);
  assert.equal(t("RECEIVED", "DI_WORKSHOP", "DIKERJAKAN", { rencanaBahanAda: true, aktualAda: true }).aksi, AKSI.FINISH_WORK);
  assert.equal(t("RECEIVED", "DI_WORKSHOP", "SELESAI").aksi, AKSI.MARK_READY);
  assert.equal(t("READY_FOR_DELIVERY", "DI_WORKSHOP_SIAP", "SELESAI").aktor, "Delivery");
  assert.equal(t("DELIVERED", "DI_PELANGGAN", "SELESAI").aksi, AKSI.NONE); assert.equal(t("CANCELLED", "DIBATALKAN", "DIBATALKAN").aksi, AKSI.NONE);
});

const m1 = { id: "11111111-1111-4111-8111-111111111111", kode: "BS-1", nama: "Busa A", satuan: "LBR", aktif: true };
const m2 = { id: "22222222-2222-4222-8222-222222222222", kode: "KN-1", nama: "Kain B", satuan: "M", aktif: true };
const peta = new Map([[m1.id, m1], [m2.id, m2], ["33333333-3333-4333-8333-333333333333", { id: "33333333-3333-4333-8333-333333333333", kode: "OLD", aktif: false }]]);

test("rencana bahan: normalisasi menolak duplikat, qty ≤ 0, bahan tak dikenal/nonaktif, dan terlalu banyak baris", () => {
  assert.deepEqual(normalisasiBarisRencana([{ materialId: m1.id, qty: "2.12345" }], peta), [{ materialId: m1.id, qty: 2.1235 }]);
  assert.throws(() => normalisasiBarisRencana([{ materialId: m1.id, qty: 1 }, { materialId: m1.id, qty: 2 }], peta), (e) => e.code === "RENCANA_BAHAN_DUPLIKAT");
  assert.throws(() => normalisasiBarisRencana([{ materialId: m1.id, qty: 0 }], peta), RencanaBahanError);
  assert.throws(() => normalisasiBarisRencana([{ materialId: m1.id, qty: -1 }], peta), RencanaBahanError);
  assert.throws(() => normalisasiBarisRencana([{ materialId: "44444444-4444-4444-8444-444444444444", qty: 1 }], peta), (e) => e.code === "RENCANA_BAHAN_TIDAK_ADA");
  assert.throws(() => normalisasiBarisRencana([{ materialId: "33333333-3333-4333-8333-333333333333", qty: 1 }], peta), (e) => e.code === "RENCANA_BAHAN_NONAKTIF");
  assert.throws(() => normalisasiBarisRencana([{ materialId: "bukan-uuid", qty: 1 }], peta), RencanaBahanError);
  assert.throws(() => normalisasiBarisRencana(Array.from({ length: MAX_BARIS_RENCANA + 1 }, () => ({ materialId: m1.id, qty: 1 })), peta), RencanaBahanError);
});

test("rencana bahan: selisih TAMBAH/UBAH/HAPUS dan sameLines", () => {
  const a = [{ materialId: m1.id, qty: 2 }, { materialId: m2.id, qty: 5 }];
  const b = [{ materialId: m1.id, qty: 3 }, { materialId: "55555555-5555-4555-8555-555555555555", qty: 1 }];
  const d = selisihRencana(a, b, peta);
  assert.deepEqual(d.map((x) => [x.aksi, x.sebelum, x.sesudah]).sort(), [["HAPUS", 5, null], ["TAMBAH", null, 1], ["UBAH", 2, 3]]);
  assert.equal(sameLines(a, [{ materialId: m2.id, qty: 5 }, { materialId: m1.id, qty: 2 }]), true, "urutan baris tidak berarti");
  assert.equal(sameLines(a, b), false);
});
