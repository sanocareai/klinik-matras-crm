// Pesan kiriman Galeri Produk / Dokumentasi harus tercatat dikirim siapa (sentById) — termasuk saat gema webhook menyimpannya lebih dulu.
import test from "node:test";
import assert from "node:assert/strict";
import { simpanPesanGaleri } from "../src/utils/simpanPesanGaleri.js";

const data = (o = {}) => ({ conversationId: "c1", direction: "OUTBOUND", content: "cap", mediaType: "image", mediaUrl: "/uploads/a.jpg", externalId: "WA-1", clientId: "cid-1", ...o });
const p2002 = () => Object.assign(new Error("Unique constraint"), { code: "P2002" });

function fakePrisma({ createError = null, byClient = null, byExternal = null } = {}) {
  const log = { created: null, updated: null };
  return {
    log,
    message: {
      create: async ({ data: d }) => { if (createError) throw createError; log.created = d; return { id: "m1", ...d }; },
      findUnique: async ({ where }) => (where.clientId ? byClient : byExternal),
      update: async ({ where, data: d }) => { log.updated = { where, d }; return { id: where.id, sentById: d.sentById }; },
    },
  };
}

test("kasus normal: pesan disimpan DENGAN sentById pengirim", async () => {
  const pr = fakePrisma();
  const msg = await simpanPesanGaleri(pr, { data: data(), sentById: "sales-1" });
  assert.equal(pr.log.created.sentById, "sales-1");
  assert.equal(pr.log.created.externalId, "WA-1");
  assert.equal(msg.sentById, "sales-1");
});

test("gema webhook sudah menyimpan pesan (tanpa pengirim): sentById DILENGKAPI, bukan dibiarkan kosong", async () => {
  const pr = fakePrisma({ createError: p2002(), byExternal: { id: "m-echo", sentById: null } });
  const msg = await simpanPesanGaleri(pr, { data: data({ clientId: null }), sentById: "sales-1" });
  assert.deepEqual(pr.log.updated, { where: { id: "m-echo" }, d: { sentById: "sales-1" } });
  assert.equal(msg.sentById, "sales-1");
});

test("pesan yang sudah punya pengirim TIDAK ditimpa (mis. 2 request ber-clientId sama)", async () => {
  const pr = fakePrisma({ createError: p2002(), byClient: { id: "m-lama", sentById: "sales-lain" } });
  const msg = await simpanPesanGaleri(pr, { data: data(), sentById: "sales-1" });
  assert.equal(pr.log.updated, null);
  assert.equal(msg.sentById, "sales-lain");
});

test("clientId dicari lebih dulu daripada externalId", async () => {
  const pr = fakePrisma({ createError: p2002(), byClient: { id: "m-client", sentById: "x" }, byExternal: { id: "m-ext", sentById: "y" } });
  assert.equal((await simpanPesanGaleri(pr, { data: data(), sentById: "s" })).id, "m-client");
});

test("P2002 tapi pesan tidak ditemukan → galat asli dilempar (tidak ditelan)", async () => {
  const err = p2002();
  await assert.rejects(simpanPesanGaleri(fakePrisma({ createError: err }), { data: data(), sentById: "s" }), (e) => e === err);
});

test("galat selain P2002 dilempar apa adanya", async () => {
  const err = Object.assign(new Error("koneksi putus"), { code: "P1001" });
  await assert.rejects(simpanPesanGaleri(fakePrisma({ createError: err }), { data: data(), sentById: "s" }), (e) => e === err);
});

test("PEMASANGAN: kedua rute galeri memakai helper & mengirim sentById", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/routes/conversations.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.equal((src.match(/await simpanPesanGaleri\(prisma, \{\n\s+sentById: req\.user\.id,/g) || []).length, 2);
});
