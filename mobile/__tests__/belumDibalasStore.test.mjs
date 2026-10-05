// Tab "Belum Dibalas" di aplikasi: pesan baru HARUS memperbarui isUnanswered di store (bug 5 Okt 2026 — chat yang sudah dibalas tetap tersangkut).
// Menjalankan store SUNGGUHAN (zustand), bukan memeriksa pola kode.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useConversationStore } from "../src/store/conversationStore.js";

const siapkan = (conv) => useConversationStore.setState({
  conversationsById: { c1: { id: "c1", lastMessageAt: "2026-10-05T09:00:00Z", unreadCount: 0, unread: false, ...conv } },
  conversationOrder: ["c1"],
});
const ambil = () => useConversationStore.getState().conversationsById.c1;
const bump = (direction, ts = "2026-10-05T10:00:00Z") => useConversationStore.getState().bumpConversation("c1", "isi", ts, direction === "INBOUND" ? 1 : 0, direction);

test("balasan keluar (OUTBOUND) mengeluarkan chat dari Belum Dibalas", () => {
  siapkan({ isUnanswered: true, unansweredMinutes: 95 });
  bump("OUTBOUND");
  assert.equal(ambil().isUnanswered, false);
  assert.equal(ambil().unansweredMinutes, null);
});

test("pesan masuk (INBOUND) memasukkan chat yang sudah dibalas ke Belum Dibalas, tanpa menunggu refresh", () => {
  siapkan({ isUnanswered: false, unansweredMinutes: null });
  bump("INBOUND");
  assert.equal(ambil().isUnanswered, true);
  assert.equal(ambil().unansweredMinutes, 0);
  assert.equal(ambil().unreadCount, 1);
});

test("urutan nyata: masuk → balas → masuk → balas berakhir 'sudah dibalas'", () => {
  siapkan({ isUnanswered: false });
  for (const d of ["INBOUND", "OUTBOUND", "INBOUND", "OUTBOUND"]) bump(d);
  assert.equal(ambil().isUnanswered, false);
});

test("tanpa arah (pemanggil lama) status TIDAK diubah — tidak menebak", () => {
  siapkan({ isUnanswered: true, unansweredMinutes: 10 });
  useConversationStore.getState().bumpConversation("c1", "isi", "2026-10-05T10:00:00Z", 0);
  assert.equal(ambil().isUnanswered, true);
  assert.equal(ambil().unansweredMinutes, 10);
});

test("event conversation:update dari server yang membawa isUnanswered menimpa nilai lama (balasan dari HP)", () => {
  siapkan({ isUnanswered: true, unansweredMinutes: 200 });
  useConversationStore.getState().upsertConversation({ id: "c1", isUnanswered: false, unansweredMinutes: null });
  assert.equal(ambil().isUnanswered, false);
});

test("event conversation:update TANPA field itu (server lama) tidak menghapus nilai yang ada", () => {
  siapkan({ isUnanswered: true, unansweredMinutes: 30 });
  useConversationStore.getState().upsertConversation({ id: "c1", lastMessagePreview: "halo" });
  assert.equal(ambil().isUnanswered, true);
});

test("handler socket meneruskan arah pesan ke store", () => {
  const src = fs.readFileSync(new URL("../src/hooks/useSocketEvents.js", import.meta.url), "utf8");
  assert.match(src, /message\.direction === "INBOUND" \? 1 : 0,\s*message\.direction,/);
});
