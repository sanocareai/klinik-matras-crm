// Bug 7 Okt 2026: Inbox HP menampilkan pesan pelanggan 13:31 padahal sudah dibalas 16:26 (event socket terlewat / preview dibaca dari messages[0]
// yang tak pernah diperbarui socket). Menjalankan store & pemulih SUNGGUHAN.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useConversationStore } from "../src/store/conversationStore.js";
import { buatPemulih, pesanTerakhirBasi } from "../src/lib/pemulihanDaftar.js";

const msg = (o) => ({ id: "m", direction: "INBOUND", content: "Di sekitar jam berapa ya?", createdAt: "2026-10-06T23:31:17.759Z", ack: 3, ...o });
const siapkan = (conv) => useConversationStore.setState({ conversationsById: { c1: { id: "c1", lastMessageAt: "2026-10-06T23:31:17.759Z", messages: [msg({})], ...conv } }, conversationOrder: ["c1"] });
const ambil = () => useConversationStore.getState().conversationsById.c1;
const bump = (m) => useConversationStore.getState().bumpConversation("c1", m.content, m.createdAt, m.direction === "INBOUND" ? 1 : 0, m.direction, m);

test("KASUS RAHMI: balasan keluar lewat socket mengganti teks preview & ikon di daftar (bukan hanya jam)", () => {
  siapkan({});
  bump(msg({ id: "m2", direction: "OUTBOUND", content: "Untuk jam nanti akan di infokan kembali", createdAt: "2026-10-07T09:26:42.334Z", ack: 0 }));
  assert.equal(ambil().messages[0].content, "Untuk jam nanti akan di infokan kembali");
  assert.equal(ambil().messages[0].direction, "OUTBOUND");
  assert.equal(ambil().isUnanswered, false);
});

test("pesan yang lebih LAMA (terlambat tiba) tidak menimpa pesan terakhir yang sudah ada", () => {
  siapkan({});
  bump(msg({ id: "lama", content: "pesan lama", createdAt: "2026-10-06T10:00:00.000Z" }));
  assert.equal(ambil().messages[0].content, "Di sekitar jam berapa ya?");
});

test("percakapan tanpa messages di cache: pesan baru mengisinya", () => {
  siapkan({ messages: undefined });
  bump(msg({ id: "m3", content: "halo", createdAt: "2026-10-07T01:00:00.000Z" }));
  assert.equal(ambil().messages[0].content, "halo");
});

test("pesanTerakhirBasi: jam update lebih baru dari pesan yang kita punya = basi", () => {
  assert.equal(pesanTerakhirBasi({ lastMessageAt: "2026-10-07T09:26:42.336Z", messages: [msg({})] }), true);
});

test("pesanTerakhirBasi: pesan yang sama (selisih beberapa milidetik) = tidak basi", () => {
  assert.equal(pesanTerakhirBasi({ lastMessageAt: "2026-10-06T23:31:17.800Z", messages: [msg({})] }), false);
});

test("pesanTerakhirBasi: tanpa messages = basi; tanpa lastMessageAt/tak ada percakapan = tidak", () => {
  assert.equal(pesanTerakhirBasi({ lastMessageAt: "2026-10-07T09:26:42Z" }), true);
  assert.equal(pesanTerakhirBasi({ messages: [msg({})] }), false);
  assert.equal(pesanTerakhirBasi(undefined), false);
});

test("pemulih ber-debounce: 5 permintaan beruntun = 1 muat ulang; batal() membatalkan; bisa dipakai lagi sesudahnya", () => {
  const timers = []; let panggilan = 0;
  const p = buatPemulih({ muatUlang: () => panggilan++, setTimer: (fn) => (timers.push(fn), timers.length), clearTimer: (id) => { timers[id - 1] = null; } });
  for (let i = 0; i < 5; i++) p.minta();
  assert.equal(timers.length, 1);
  timers[0](); assert.equal(panggilan, 1);
  p.minta(); assert.equal(timers.length, 2);
  p.batal(); assert.equal(timers[1], null);
  p.minta(); assert.equal(timers.length, 3);
});

test("PEMASANGAN: hook socket meneruskan pesan penuh ke bump, memulihkan saat AppState aktif & socket tersambung ulang & update percakapan basi", () => {
  const s = fs.readFileSync(new URL("../src/hooks/useSocketEvents.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(s, /message\.direction,\n\s+message,\n\s+\);/);
  assert.match(s, /AppState\.addEventListener\("change", \(s\) => \{ if \(s === "active"\) pemulih\.minta\(\); \}\)/);
  assert.match(s, /socket\.on\("connect", onConnect\)/);
  assert.match(s, /pesanTerakhirBasi\(useConversationStore\.getState\(\)\.conversationsById\[payload\.id\]\)\) pemulihRef\.current\.minta\(\)/);
  assert.match(s, /invalidateQueries\(\{ queryKey: \["conversations"\] \}\)/);
});
