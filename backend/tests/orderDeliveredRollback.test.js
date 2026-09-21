// Tes penentu "job ini artefak kaskade DELIVERED atau selesai sungguhan?"
// (21 September 2026). Yang paling penting diuji BUKAN kasus yang dibuka,
// tapi kasus yang TIDAK BOLEH dibuka: job yang benar-benar diselesaikan
// driver di lapangan tidak boleh ikut "hidup lagi" cuma karena admin
// menarik status order mundur. Salah ke arah itu = pengiriman nyata
// hilang dari catatan, jauh lebih mahal daripada job artefak yang lolos
// tidak dibuka (yang cukup dibetulkan manual seperti sebelumnya).

import test from "node:test";
import assert from "node:assert/strict";

import { adalahJobHasilKaskadeDelivered, tentukanStatusJobSemula } from "../src/services/orderStatusSync.js";

const T = new Date("2026-09-21T09:45:50.100Z");
const artefak = (over = {}) => ({
  type: "DELIVERY", status: "COMPLETED",
  completedAt: new Date("2026-09-21T09:45:50.108Z"),
  proofPhotoUrls: [], startPhotoUrls: [], arrivalPhotoUrls: [],
  signatureUrl: null, arrivedAt: null,
  ...over,
});

test("bentuk PERSIS job kasus NEW-30082026-023 dikenali sebagai artefak kaskade", () => {
  assert.equal(adalahJobHasilKaskadeDelivered(artefak(), T), true);
});

test("job yang punya FOTO BUKTI (selesai sungguhan) TIDAK PERNAH dibuka", () => {
  assert.equal(adalahJobHasilKaskadeDelivered(artefak({ proofPhotoUrls: ["/media/job-photos/a.jpg"] }), T), false);
});

test("job yang punya waktu tiba / tanda tangan / foto mulai / foto tiba TIDAK dibuka", () => {
  assert.equal(adalahJobHasilKaskadeDelivered(artefak({ arrivedAt: new Date() }), T), false);
  assert.equal(adalahJobHasilKaskadeDelivered(artefak({ signatureUrl: "/media/job-photos/s.png" }), T), false);
  assert.equal(adalahJobHasilKaskadeDelivered(artefak({ startPhotoUrls: ["/media/job-photos/x.jpg"] }), T), false);
  assert.equal(adalahJobHasilKaskadeDelivered(artefak({ arrivalPhotoUrls: ["/media/job-photos/y.jpg"] }), T), false);
});

test("job yang selesai JAUH dari transisi DELIVERED (bukan produk kaskade itu) tidak dibuka", () => {
  const sejamKemudian = new Date(T.getTime() + 60 * 60 * 1000);
  assert.equal(adalahJobHasilKaskadeDelivered(artefak({ completedAt: sejamKemudian }), T), false);
  const seharSebelum = new Date(T.getTime() - 24 * 60 * 60 * 1000);
  assert.equal(adalahJobHasilKaskadeDelivered(artefak({ completedAt: seharSebelum }), T), false);
});

test("hanya job DELIVERY berstatus COMPLETED dengan completedAt yang dipertimbangkan", () => {
  assert.equal(adalahJobHasilKaskadeDelivered(artefak({ type: "PICKUP" }), T), false);
  assert.equal(adalahJobHasilKaskadeDelivered(artefak({ status: "FAILED" }), T), false);
  assert.equal(adalahJobHasilKaskadeDelivered(artefak({ status: "ASSIGNED" }), T), false);
  assert.equal(adalahJobHasilKaskadeDelivered(artefak({ completedAt: null }), T), false);
});

test("status asal dipulihkan dari data yang tersisa: driver > tanggal > belum dijadwalkan", () => {
  assert.equal(tentukanStatusJobSemula({ driverId: "d1", scheduledDate: new Date() }), "ASSIGNED");
  assert.equal(tentukanStatusJobSemula({ driverId: null, scheduledDate: new Date("2026-09-22") }), "SCHEDULED");
  assert.equal(tentukanStatusJobSemula({ driverId: null, scheduledDate: null }), "UNSCHEDULED");
});
