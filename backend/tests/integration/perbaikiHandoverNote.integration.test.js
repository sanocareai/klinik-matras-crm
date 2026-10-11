// scripts/perbaiki-handover-note-basi.js dijalankan SUNGGUHAN (proses anak) terhadap Postgres uji.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const jalankan = (...a) => execFileSync(process.execPath, [path.join(backendRoot, "scripts/perbaiki-handover-note-basi.js"), ...a], { cwd: backendRoot, env: process.env, encoding: "utf8" });

test.before(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); await testPrisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "backup_handover_note_20261011"`); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

const user = async (nama) => { const x = await createTestUser({ roles: ["SALES"] }); await testPrisma.user.update({ where: { id: x.user.id }, data: { name: nama } }); return x.user; };
async function conv({ pemegang, note, events }) {
  const c = await testPrisma.conversation.create({ data: { channel: "WHATSAPP", assignedToId: pemegang.id, handoverNote: note } });
  let t = Date.now() - 100_000;
  for (const [reason, from, to] of events) await testPrisma.handoverEvent.create({ data: { conversationId: c.id, fromUserId: from?.id ?? null, toUserId: to.id, reason, createdAt: new Date((t += 1000)) } });
  return c;
}
const note = async (id) => (await testPrisma.conversation.findUnique({ where: { id } })).handoverNote;

test("pratinjau tidak mengubah; apply memperbaiki HANYA yang basi (event terakhir transfer & note tak menyebut pemegang); idempotent", async () => {
  const novi = await user("Novi"); const fadlan = await user("Fadlan"); const suci = await user("Suci");
  const basi = await conv({ pemegang: fadlan, note: "Percakapan diambil alih dari Suci oleh Novi.", events: [["takeover", suci, novi], ["transfer", novi, fadlan]] });
  const sudahBenar = await conv({ pemegang: fadlan, note: "Percakapan ditransfer dari Novi ke Fadlan oleh Admin.", events: [["transfer", novi, fadlan]] });
  const takeoverBenar = await conv({ pemegang: novi, note: "Percakapan diambil alih dari Suci oleh Novi.", events: [["takeover", suci, novi]] });
  const tanpaNote = await conv({ pemegang: fadlan, note: null, events: [["transfer", novi, fadlan]] });

  assert.match(jalankan(), /Catatan serah-terima basi: 1/);
  assert.equal(await note(basi.id), "Percakapan diambil alih dari Suci oleh Novi.");

  jalankan("--apply");
  assert.equal(await note(basi.id), "Percakapan ditransfer dari Novi ke Fadlan.");
  assert.equal(await note(sudahBenar.id), "Percakapan ditransfer dari Novi ke Fadlan oleh Admin.");
  assert.equal(await note(takeoverBenar.id), "Percakapan diambil alih dari Suci oleh Novi.");
  assert.equal(await note(tanpaNote.id), null);
  const backup = await testPrisma.$queryRawUnsafe(`SELECT id, "handoverNote" n FROM "backup_handover_note_20261011"`);
  assert.deepEqual(backup.map((r) => [r.id, r.n]), [[basi.id, "Percakapan diambil alih dari Suci oleh Novi."]]);
  assert.match(jalankan("--apply"), /Tidak ada yang perlu diperbaiki/);
});
