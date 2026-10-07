// Skrip pembersihan pesan kembar & resync percakapan dijalankan SUNGGUHAN (proses anak) terhadap Postgres uji, dan idempotensi webhook
// (cariPesanSudahAda) dites terhadap query `contains` yang nyata.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { cariPesanSudahAda } from "../../src/utils/cariPesanSudahAda.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const jalankan = (skrip, ...args) => execFileSync(process.execPath, [path.join(backendRoot, "scripts", skrip), ...args], { cwd: backendRoot, env: process.env, encoding: "utf8" });
const ID = "3EB0A99DC6DFA25017D79E";
const T = (detik) => new Date(Date.UTC(2026, 9, 5, 9, 15, 8) + detik * 1000);

test.before(async () => { await truncateAll(); });
test.afterEach(async () => {
  await truncateAll();
  for (const t of ["backup_pesan_kembar_20261007", "backup_resync_percakapan_20261007"]) await testPrisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${t}"`);
});
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

async function siapkan() {
  const user = await testPrisma.user.create({ data: { name: "Sales Uji", email: `s${Date.now()}@uji.test`, passwordHash: "x", role: "SALES" } });
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Uji" } });
  const conv = await testPrisma.conversation.create({ data: { customerId: customer.id, channel: "WHATSAPP", lastMessageAt: T(-3600), lastMessagePreview: "pesan lama pelanggan" } });
  const m = (id, data) => testPrisma.message.create({ data: { id, conversationId: conv.id, direction: "OUTBOUND", content: "Untuk jam nanti akan diinfokan", ...data } });
  await m("A", { externalId: `true_6281@c.us_${ID}`, sentById: user.id, ack: 1, createdAt: T(0.458) });
  await m("G", { externalId: `true_2040@lid_${ID}`, ack: 3, createdAt: T(0) });
  await m("S", { externalId: "true_6281@c.us_3EB0AAAAAAAAAAAAAAAAAA", sentById: user.id, createdAt: T(100), content: "tunggal" });
  await testPrisma.message.create({ data: { id: "R", conversationId: conv.id, direction: "INBOUND", content: "oke", replyToId: "G", createdAt: T(60) } });
  return { conv };
}
const ada = async (id) => !!(await testPrisma.message.findUnique({ where: { id } }));

test("cariPesanSudahAda terhadap DB nyata: gema LID cocok ke baris CRM; pesan masuk & ID asing tidak", async () => {
  await siapkan();
  assert.equal((await cariPesanSudahAda(testPrisma, `true_999@lid_${ID}`, { fromMe: true }))?.id, "A", "pertama-tama baris tersimpan yang cocok");
  assert.equal(await cariPesanSudahAda(testPrisma, `true_999@lid_${ID}`, { fromMe: false }), null);
  assert.equal(await cariPesanSudahAda(testPrisma, "true_999@lid_3EB0BBBBBBBBBBBBBBBBBB", { fromMe: true }), null);
});

test("PRATINJAU kembar tidak mengubah apa pun", async () => {
  await siapkan();
  const keluar = jalankan("bersihkan-pesan-kembar.js");
  assert.match(keluar, /DRY-RUN/);
  assert.match(keluar, /Baris kembar yang akan DIHAPUS\s*:\s*1\b/);
  assert.equal(await testPrisma.message.count(), 4);
  assert.equal((await testPrisma.$queryRawUnsafe(`SELECT to_regclass('backup_pesan_kembar_20261007')::text AS t`))[0].t, null);
});

test("--apply kembar: gema dihapus, baris CRM utuh dengan ack tertinggi, balasan dialihkan, salinan di backup; idempotent", async () => {
  await siapkan();
  jalankan("bersihkan-pesan-kembar.js", "--apply");
  assert.equal(await ada("G"), false);
  for (const id of ["A", "S", "R"]) assert.equal(await ada(id), true, id);
  assert.equal((await testPrisma.message.findUnique({ where: { id: "A" } })).ack, 3);
  assert.equal((await testPrisma.message.findUnique({ where: { id: "R" } })).replyToId, "A");
  assert.deepEqual((await testPrisma.$queryRawUnsafe(`SELECT id FROM "backup_pesan_kembar_20261007"`)).map((r) => r.id), ["G"]);
  assert.match(jalankan("bersihkan-pesan-kembar.js", "--apply"), /Tidak ada yang perlu dibersihkan/);
  assert.equal(await testPrisma.message.count(), 3);
});

test("resync: pratinjau tidak mengubah; --apply memajukan lastMessageAt & preview ke pesan terbaru, nilai lama di backup; idempotent", async () => {
  const { conv } = await siapkan();
  assert.match(jalankan("resync-percakapan-basi.js"), /Percakapan tertinggal: 1/);
  assert.equal((await testPrisma.conversation.findUnique({ where: { id: conv.id } })).lastMessagePreview, "pesan lama pelanggan");
  jalankan("resync-percakapan-basi.js", "--apply");
  const c = await testPrisma.conversation.findUnique({ where: { id: conv.id } });
  assert.equal(c.lastMessageAt.toISOString(), T(100).toISOString());
  assert.match(c.lastMessagePreview, /tunggal/);
  const backup = await testPrisma.$queryRawUnsafe(`SELECT "lastMessagePreview" p FROM "backup_resync_percakapan_20261007"`);
  assert.equal(backup[0].p, "pesan lama pelanggan");
  assert.match(jalankan("resync-percakapan-basi.js", "--apply"), /Tidak ada yang perlu dirapikan/);
});

test("resync tidak pernah memundurkan percakapan yang sudah mutakhir", async () => {
  const { conv } = await siapkan();
  await testPrisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: T(500), lastMessagePreview: "lebih baru" } });
  assert.match(jalankan("resync-percakapan-basi.js"), /Percakapan tertinggal: 0/);
});
