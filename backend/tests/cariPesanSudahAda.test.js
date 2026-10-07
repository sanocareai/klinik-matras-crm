import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { cariPesanSudahAda } from "../src/utils/cariPesanSudahAda.js";

const ID = "3EB0A99DC6DFA25017D79E";
const fakePrisma = (rows) => ({
  message: {
    findUnique: async ({ where }) => rows.find((r) => r.externalId === where.externalId) || null,
    findFirst: async ({ where }) => rows.find((r) => r.externalId.includes(where.externalId.contains) && r.direction === where.direction) || null,
  },
});
const asli = { id: "m1", direction: "OUTBOUND", externalId: `true_6281212624845@c.us_${ID}`, ack: 1 };

test("KASUS NYATA: gema berbasis LID cocok dengan pesan CRM berbasis nomor (fromMe)", async () => {
  const r = await cariPesanSudahAda(fakePrisma([asli]), `true_204075555676278@lid_${ID}`, { fromMe: true });
  assert.equal(r?.id, "m1");
});

test("exact match tetap yang pertama (tidak butuh fromMe)", async () => {
  assert.equal((await cariPesanSudahAda(fakePrisma([asli]), asli.externalId))?.id, "m1");
});

test("pesan MASUK (fromMe false) tidak pernah dicocokkan lewat ID inti", async () => {
  assert.equal(await cariPesanSudahAda(fakePrisma([asli]), `false_204075555676278@lid_${ID}`, { fromMe: false }), null);
});

test("hanya mencocokkan pesan KELUAR; pesan masuk ber-ID sama tidak dianggap sudah ada", async () => {
  assert.equal(await cariPesanSudahAda(fakePrisma([{ ...asli, direction: "INBOUND" }]), `true_1@lid_${ID}`, { fromMe: true }), null);
});

test("ID inti pendek (< 16 karakter) atau format tak dikenal → tidak ada pencocokan (aman)", async () => {
  const pendek = { id: "m2", direction: "OUTBOUND", externalId: "true_628@c.us_ABC123", ack: 0 };
  assert.equal(await cariPesanSudahAda(fakePrisma([pendek]), "true_1@lid_ABC123", { fromMe: true }), null);
  assert.equal(await cariPesanSudahAda(fakePrisma([asli]), "abc", { fromMe: true }), null);
  assert.equal(await cariPesanSudahAda(fakePrisma([asli]), null, { fromMe: true }), null);
});

test("pesan yang benar-benar baru → null (boleh disimpan)", async () => {
  assert.equal(await cariPesanSudahAda(fakePrisma([asli]), "true_1@lid_3EB0FFFFFFFFFFFFFFFFFF", { fromMe: true }), null);
});

test("PEMASANGAN: webhook memakai helper dan mengirim ack dengan externalId tersimpan", () => {
  const s = fs.readFileSync(new URL("../src/routes/webhooks.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(s, /cariPesanSudahAda\(prisma, externalId, \{ fromMe: !!payload\.fromMe \}\)/);
  assert.match(s, /emitMessageAck\(existing\.conversationId, existing\.externalId, freshAck\)/);
});
