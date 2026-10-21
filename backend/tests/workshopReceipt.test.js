// Penerimaan workshop oleh petugas — fungsi MURNI (tanpa DB): basis bukti ke-4, keberadaan fisik, penghalang status order, tindakan berikutnya.
import test from "node:test";
import assert from "node:assert/strict";
import { RECEIVED_BASIS, RECEIVED_BASIS_LABEL, globalStatusOf, receivedBasisOf } from "../src/lib/domain/workshopMilestone.js";
import { physicalPresenceOf } from "../src/lib/domain/productionDisplay.js";
import { AKSI, penghalangStatusOrder, tindakanBerikutnya } from "../src/lib/domain/productionWorkStatus.js";

test("basis bukti: penerimaan workshop adalah bukti sah; custody dan konfirmasi petugas tetap didahulukan; tanpa bukti = null", () => {
  assert.equal(receivedBasisOf({ workshopReceipt: true }), RECEIVED_BASIS.WORKSHOP_RECEIPT);
  assert.equal(receivedBasisOf({ workshopReceipt: true, inboundAccepted: true }), RECEIVED_BASIS.CUSTODY);
  assert.equal(receivedBasisOf({ workshopReceipt: true, staffConfirmed: true }), RECEIVED_BASIS.STAFF_CONFIRMED);
  assert.equal(receivedBasisOf({ workshopReceipt: true, bornInWorkshop: true }), RECEIVED_BASIS.WORKSHOP_RECEIPT);
  assert.equal(receivedBasisOf({}), null); assert.equal(RECEIVED_BASIS_LABEL.WORKSHOP_RECEIPT, "Penerimaan dicatat petugas");
});

test("status global: pickup selesai + penerimaan tercatat = Diterima di Workshop (bukan Diproses); tanpa penerimaan tetap Pengambilan", () => {
  const dgn = globalStatusOf({ unitStatus: "RECEIVED", receivedBasis: "WORKSHOP_RECEIPT", pickupCompleted: true });
  assert.equal(dgn.key, "DITERIMA_WORKSHOP"); assert.equal(dgn.evidence.receivedBasis, "WORKSHOP_RECEIPT");
  assert.equal(globalStatusOf({ unitStatus: "RECEIVED", pickupCompleted: true }).key, "PENGAMBILAN");
  assert.equal(globalStatusOf({ unitStatus: "RECEIVED", receivedBasis: "WORKSHOP_RECEIPT", started: false }).key, "DITERIMA_WORKSHOP", "penerimaan bukan 'dimulai'");
});

test("keberadaan fisik: penerimaan workshop = tiba terkonfirmasi; Run menunggu kedatangan tetap belum tiba", () => {
  assert.equal(physicalPresenceOf({ unitStatus: "RECEIVED", workshopReceipt: true }).confirmed, true);
  assert.equal(physicalPresenceOf({ unitStatus: "RECEIVED", workshopReceipt: true }).key, "ARRIVED_CONFIRMED");
  assert.equal(physicalPresenceOf({ unitStatus: "RECEIVED" }).confirmed, false);
  assert.equal(physicalPresenceOf({ unitStatus: "RECEIVED", runStatus: "PENDING_ARRIVAL" }).key, "NOT_ARRIVED");
});

test("penghalang status order: hanya saat order masih Belum diambil/Pengambilan padahal unit sudah dijemput; sebab dijelaskan jujur; tidak otomatis", () => {
  const kunci = penghalangStatusOrder({ orderStatus: "PICKUP", statusLocked: true, unitStatus: "RECEIVED", pengunci: { nama: "Gilang", at: "2026-10-19T03:00:00Z", note: "Dipindah manual" } });
  assert.equal(kunci.kode, "ORDER_TERKUNCI_PENGAMBILAN"); assert.equal(kunci.bolehUbahKeDiproses, true); assert.match(kunci.teks, /dikunci manual oleh Gilang/); assert.match(kunci.teks, /Dipindah manual/); assert.match(kunci.teks, /19 Okt 2026/);
  assert.equal(penghalangStatusOrder({ orderStatus: "PENDING", statusLocked: true, unitStatus: "IN_PRODUCTION" }).kode, "ORDER_TERKUNCI_PENGAMBILAN");
  const lain = penghalangStatusOrder({ orderStatus: "PICKUP", statusLocked: false, unitStatus: "RECEIVED", unitLainBelumDijemput: 2 });
  assert.equal(lain.kode, "UNIT_LAIN_BELUM_DIJEMPUT"); assert.equal(lain.bolehUbahKeDiproses, false); assert.match(lain.teks, /2 unit lain/);
  assert.equal(penghalangStatusOrder({ orderStatus: "PICKUP", statusLocked: false, unitStatus: "RECEIVED" }).kode, "ORDER_BELUM_DISINKRONKAN");
  for (const unitStatus of ["AWAITING_PICKUP", "IN_TRANSIT_IN", "READY_FOR_DELIVERY", "DELIVERED", "CANCELLED"]) assert.equal(penghalangStatusOrder({ orderStatus: "PICKUP", statusLocked: true, unitStatus }), null, unitStatus);
  for (const orderStatus of ["PROCESSING", "READY", "SHIPPING", "DELIVERED", "CANCELLED"]) assert.equal(penghalangStatusOrder({ orderStatus, statusLocked: true, unitStatus: "RECEIVED" }), null, orderStatus);
});

test("tindakan berikutnya: penerimaan fisik didahulukan; sesudah diterima + order tertahan → 'Ubah status order ke Diproses' (Admin) dengan penyebab; penghalang unit-lain tidak menawarkan ubah", () => {
  const penghalang = penghalangStatusOrder({ orderStatus: "PICKUP", statusLocked: true, unitStatus: "RECEIVED" });
  const belumDiterima = tindakanBerikutnya({ unitStatus: "RECEIVED", posisi: { key: "SUDAH_DIJEMPUT" }, kerja: { key: "BELUM_DIJADWALKAN" }, penghalang });
  assert.equal(belumDiterima.aksi, AKSI.CONFIRM_ARRIVAL); assert.equal(belumDiterima.penghalang.kode, "ORDER_TERKUNCI_PENGAMBILAN");
  const sudah = tindakanBerikutnya({ unitStatus: "RECEIVED", posisi: { key: "DI_WORKSHOP" }, kerja: { key: "BELUM_DIJADWALKAN" }, penghalang });
  assert.equal(sudah.aksi, AKSI.UBAH_ORDER_DIPROSES); assert.equal(sudah.aktor, "Admin"); assert.equal(sudah.detail, penghalang.teks);
  const lain = penghalangStatusOrder({ orderStatus: "PICKUP", statusLocked: false, unitStatus: "RECEIVED", unitLainBelumDijemput: 1 });
  assert.notEqual(tindakanBerikutnya({ unitStatus: "RECEIVED", posisi: { key: "DI_WORKSHOP" }, kerja: { key: "BELUM_DIJADWALKAN" }, penghalang: lain }).aksi, AKSI.UBAH_ORDER_DIPROSES);
  assert.equal(tindakanBerikutnya({ unitStatus: "RECEIVED", posisi: { key: "DI_WORKSHOP" }, kerja: { key: "BELUM_DIJADWALKAN" } }).aksi, AKSI.OPEN_PLAN, "tanpa penghalang: perilaku lama utuh");
});
