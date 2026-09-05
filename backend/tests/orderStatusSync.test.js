// Tes aturan agregasi Order.status dari Unit.status (D-006, Integrasi Fase
// 1). Yang diuji di sini logika MURNI, tanpa database — aturan weakest-link
// ("Order ikut unit yang paling tertinggal") gampang salah dibaca kalau
// dibalik jadi "mayoritas" atau "unit manapun yang paling maju".
//
// Bagian yang menyentuh database (syncOrderStatus menulis Order.status +
// orderStatusTransition) diverifikasi lewat pemeriksaan langsung di
// production, sama seperti scopeRevision.test.js — butuh data nyata.

import test from "node:test";
import assert from "node:assert/strict";

import { computeOrderStatus } from "../src/services/orderStatusSync.js";

// Helper: unit yang SUDAH diadopsi ke stage engine (currentStageId terisi).
// Dipakai di hampir semua tes di bawah karena unit yang BELUM diadopsi
// sengaja dikecualikan dari agregasi — lihat tes khusus di bagian bawah.
const adopted = (status) => ({ status, currentStageId: "stage-1" });

test("satu unit AWAITING_PICKUP -> Order PICKUP", () => {
  assert.equal(computeOrderStatus([adopted("AWAITING_PICKUP")]), "PICKUP");
});

test("satu unit DELIVERED -> Order DELIVERED", () => {
  assert.equal(computeOrderStatus([adopted("DELIVERED")]), "DELIVERED");
});

test("weakest-link: satu unit masih di produksi menahan SELURUH order di PROCESSING", () => {
  // 2 unit sudah DELIVERED, 1 masih IN_PRODUCTION — Order TIDAK BOLEH bilang
  // DELIVERED walau MAYORITAS unit-nya sudah sampai. Ini akar alasan kenapa
  // aturannya weakest-link, bukan mayoritas.
  const units = [adopted("DELIVERED"), adopted("DELIVERED"), adopted("IN_PRODUCTION")];
  assert.equal(computeOrderStatus(units), "PROCESSING");
});

test("baru jadi DELIVERED kalau SEMUA unit delivered", () => {
  const units = [adopted("DELIVERED"), adopted("DELIVERED"), adopted("DELIVERED")];
  assert.equal(computeOrderStatus(units), "DELIVERED");
});

test("unit CANCELLED dikecualikan dari agregasi, tidak menyeret order", () => {
  // 1 unit dibatalkan, 2 lainnya jalan terus — order ikut yang masih hidup.
  const units = [adopted("CANCELLED"), adopted("DELIVERED"), adopted("READY_FOR_DELIVERY")];
  assert.equal(computeOrderStatus(units), "READY");
});

test("SELURUH unit CANCELLED -> null (tidak ada dasar hitung, JANGAN dianggap status apa pun)", () => {
  const units = [adopted("CANCELLED"), adopted("CANCELLED")];
  assert.equal(computeOrderStatus(units), null);
});

test("order tanpa unit sama sekali -> null", () => {
  assert.equal(computeOrderStatus([]), null);
});

test("IN_TRANSIT_OUT (dalam perjalanan kirim) -> SHIPPING, bukan READY ataupun DELIVERED", () => {
  // KOREKSI 5 Sep 2026 — sebelumnya dianggap READY (bucket digabung).
  // Sekarang bucket sendiri: order sedang di jalan diantar HARUS terlihat
  // beda dari yang baru "siap kirim tapi belum ada driver jalan", dan
  // TETAP belum boleh bilang selesai sebelum job delivery benar-benar
  // completed (makanya bukan DELIVERED juga).
  assert.equal(computeOrderStatus([adopted("IN_TRANSIT_OUT")]), "SHIPPING");
});

test("READY_ON_CUSTOMER_HOLD tetap READY, bukan DELIVERED ataupun PROCESSING", () => {
  assert.equal(computeOrderStatus([adopted("READY_ON_CUSTOMER_HOLD")]), "READY");
});

// --- gerbang "belum diadopsi ke stage engine" -----------------------------
// currentStageId HANYA diisi startStage() (lihat unitStageEngine.js) — tidak
// pernah saat Unit dibuat. Ini krusial untuk 199 unit backfill yang sudah
// ada di production SEBELUM fitur ini dibangun: Order.status manual mereka
// (yang sudah lama tidak sinkron dengan Unit.status backfill-nya) TIDAK
// BOLEH tiba-tiba tertimpa cuma karena fitur ini di-deploy.
test("unit yang BELUM pernah di-start (currentStageId null) dikecualikan dari agregasi", () => {
  const units = [{ status: "DELIVERED", currentStageId: null }];
  assert.equal(computeOrderStatus(units), null);
});

test("campuran: unit yang sudah diadopsi tetap dihitung walau ada unit lain yang belum", () => {
  const units = [
    { status: "READY_FOR_DELIVERY", currentStageId: null }, // belum diadopsi, diabaikan
    adopted("IN_PRODUCTION"),
  ];
  assert.equal(computeOrderStatus(units), "PROCESSING");
});

test("SEMUA unit belum diadopsi -> null, walau statusnya macam-macam", () => {
  const units = [
    { status: "DELIVERED", currentStageId: null },
    { status: "AWAITING_PICKUP", currentStageId: null },
  ];
  assert.equal(computeOrderStatus(units), null);
});
