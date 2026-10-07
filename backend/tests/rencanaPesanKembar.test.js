import test from "node:test";
import assert from "node:assert/strict";
import { rencanaPesanKembar } from "../src/utils/rencanaPesanKembar.js";

const ID = "3EB0A99DC6DFA25017D79E";
const T = (d) => new Date(Date.UTC(2026, 9, 5, 9, 15, 8) + d * 1000);
const row = (id, o = {}) => ({ id, conversationId: "c1", direction: "OUTBOUND", externalId: `true_6281@c.us_${ID}`, sentById: null, ack: 0, createdAt: T(0), mediaUrl: null, ...o });

test("KASUS NYATA: baris CRM (berpengirim) dipertahankan, gema LID tanpa pengirim dihapus; ack tertinggi digabung", () => {
  const asli = row("A", { sentById: "u1", ack: 1, createdAt: T(0.458) });
  const gema = row("G", { externalId: `true_2040@lid_${ID}`, ack: 3, createdAt: T(0) });
  const { rencana } = rencanaPesanKembar([gema, asli]);
  assert.equal(rencana.length, 1);
  assert.equal(rencana[0].survivor.id, "A");
  assert.deepEqual(rencana[0].korban.map((k) => k.id), ["G"]);
  assert.equal(rencana[0].ackBaru, 3);
});

test("ack survivor sudah tertinggi → tidak ada perubahan ack", () => {
  const { rencana } = rencanaPesanKembar([row("A", { sentById: "u1", ack: 3 }), row("G", { externalId: `true_2040@lid_${ID}`, ack: 0 })]);
  assert.equal(rencana[0].ackBaru, null);
});

test("tanpa pengirim di kedua baris: ack tertinggi menang, lalu yang paling awal", () => {
  const { rencana } = rencanaPesanKembar([row("X", { ack: 1, createdAt: T(1) }), row("Y", { externalId: `true_2040@lid_${ID}`, ack: 1, createdAt: T(0) })]);
  assert.equal(rencana[0].survivor.id, "Y");
});

test("media: survivor tanpa media mewarisi media dari baris yang dihapus", () => {
  const { rencana } = rencanaPesanKembar([row("A", { sentById: "u1" }), row("G", { externalId: `true_2040@lid_${ID}`, mediaUrl: "/uploads/x.jpg" })]);
  assert.equal(rencana[0].sumberMedia.id, "G");
});

test("tiga baris kembar → satu survivor, dua korban", () => {
  const { rencana } = rencanaPesanKembar([row("A", { sentById: "u1" }), row("G1", { externalId: `true_1@lid_${ID}` }), row("G2", { externalId: `true_2@lid_${ID}` })]);
  assert.equal(rencana[0].korban.length, 2);
});

test("ID sama tapi percakapan berbeda, ID pendek, pesan masuk, atau waktu berjauhan → tidak disentuh", () => {
  assert.equal(rencanaPesanKembar([row("A"), row("B", { conversationId: "c2", externalId: `true_2@lid_${ID}` })]).rencana.length, 0);
  assert.equal(rencanaPesanKembar([row("A", { externalId: "true_1@c.us_ABC" }), row("B", { externalId: "true_2@lid_ABC" })]).rencana.length, 0);
  assert.equal(rencanaPesanKembar([row("A"), row("B", { externalId: `false_2@lid_${ID}`, direction: "INBOUND" })]).rencana.length, 0);
  const jauh = rencanaPesanKembar([row("A"), row("B", { externalId: `true_2@lid_${ID}`, createdAt: T(600) })]);
  assert.equal(jauh.rencana.length, 0);
  assert.equal(jauh.dilewati.length, 1);
});

test("pesan tunggal & id berbeda tidak masuk rencana", () => {
  assert.equal(rencanaPesanKembar([row("A"), row("B", { externalId: "true_1@c.us_3EB0FFFFFFFFFFFFFFFFFF" })]).rencana.length, 0);
});
