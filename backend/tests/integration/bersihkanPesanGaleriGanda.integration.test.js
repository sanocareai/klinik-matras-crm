// Skrip scripts/bersihkan-pesan-galeri-ganda.js dijalankan SUNGGUHAN (proses anak) terhadap Postgres uji: pratinjau tidak mengubah
// apa pun; --apply menghapus hantu yang punya gema, mengalihkan balasan, menyalin ke tabel backup, dan aman diulang.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SKRIP = path.join(backendRoot, "scripts/bersihkan-pesan-galeri-ganda.js");
const jalankan = (...args) => execFileSync(process.execPath, [SKRIP, ...args], { cwd: backendRoot, env: process.env, encoding: "utf8" });

test.before(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); await testPrisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "backup_pesan_galeri_ganda_20261007"`); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

const T = (detik) => new Date(Date.UTC(2026, 9, 1, 15, 47, 0) + detik * 1000);

async function siapkan() {
  const { user } = await createTestUser({ roles: ["SALES"] });
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Uji" } });
  const conv = await testPrisma.conversation.create({ data: { customerId: customer.id, channel: "WHATSAPP" } });
  const m = (id, data) => testPrisma.message.create({ data: { id, conversationId: conv.id, direction: "OUTBOUND", mediaType: "image", content: "Konsep kasur sehat", ...data } });
  // Dua pasangan hantu+gema, satu hantu tanpa gema, satu unggahan manual (bukan galeri), satu gema berpengirim.
  await m("H1", { mediaUrl: "/media/products/a.jpg", createdAt: T(0) });
  await m("G1", { mediaUrl: "/uploads/g1.jpg", externalId: "WA-1", ack: 3, createdAt: T(0.5) });
  await m("H2", { mediaUrl: "/media/products/b.jpg", createdAt: T(10), content: "Garansi" });
  await m("G2", { mediaUrl: "/uploads/g2.jpg", externalId: "WA-2", ack: 3, createdAt: T(10.4), content: "Garansi" });
  await m("H3", { mediaUrl: "/media/products/c.jpg", createdAt: T(100), content: "Tanpa gema" });
  await m("U1", { mediaUrl: "/uploads/manual.jpg", createdAt: T(200), content: "unggah manual" }); // bukan folder galeri
  await m("H4", { mediaUrl: "/media/products/d.jpg", createdAt: T(300), content: "Dari rute lain" });
  await m("G4", { mediaUrl: "/uploads/g4.jpg", externalId: "WA-4", sentById: user.id, createdAt: T(300.3), content: "Dari rute lain" }); // gema berpengirim → bukan gema galeri
  // Balasan pelanggan yang mengutip H1.
  await testPrisma.message.create({ data: { id: "R1", conversationId: conv.id, direction: "INBOUND", content: "oke kak", replyToId: "H1", createdAt: T(60) } });
  return { conv };
}
const ada = async (id) => !!(await testPrisma.message.findUnique({ where: { id } }));

test("PRATINJAU (tanpa --apply) tidak mengubah apa pun dan melaporkan rencana", async () => {
  await siapkan();
  const keluar = jalankan();
  assert.match(keluar, /DRY-RUN/);
  assert.match(keluar, /dipasangkan dengan gema\s*:\s*2\b/);
  assert.match(keluar, /tanpa pasangan \(dibiarkan\)\s*:\s*2\b/); // H3 dan H4
  assert.equal(await testPrisma.message.count(), 9);
  const tabel = await testPrisma.$queryRawUnsafe(`SELECT to_regclass('backup_pesan_galeri_ganda_20261007')::text AS t`);
  assert.equal(tabel[0].t, null, "pratinjau tidak boleh membuat tabel backup");
});

test("--apply: hantu berpasangan dihapus, gema & lainnya utuh, balasan dialihkan ke gema, salinan masuk tabel backup", async () => {
  await siapkan();
  jalankan("--apply");
  assert.equal(await ada("H1"), false); assert.equal(await ada("H2"), false);
  for (const id of ["G1", "G2", "H3", "U1", "H4", "G4", "R1"]) assert.equal(await ada(id), true, id + " harus tetap ada");
  assert.equal((await testPrisma.message.findUnique({ where: { id: "R1" } })).replyToId, "G1", "balasan harus mengutip gema, bukan hilang");
  const backup = await testPrisma.$queryRawUnsafe(`SELECT id FROM "backup_pesan_galeri_ganda_20261007" ORDER BY id`);
  assert.deepEqual(backup.map((r) => r.id), ["H1", "H2"]);
});

test("--apply bisa diulang (idempotent): jalan kedua tidak menghapus apa-apa lagi", async () => {
  await siapkan();
  jalankan("--apply");
  const keluar = jalankan("--apply");
  assert.match(keluar, /Tidak ada yang perlu dibersihkan|dipasangkan dengan gema\s*:\s*0/);
  assert.equal(await testPrisma.message.count(), 7);
  const backup = await testPrisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "backup_pesan_galeri_ganda_20261007"`);
  assert.equal(backup[0].n, 2);
});
