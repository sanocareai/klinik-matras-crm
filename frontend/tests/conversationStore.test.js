import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useConversationStore, sameValue } from "../src/features/inbox/stores/conversationStore.js";

const conv = (id, extra = {}) => ({ id, lastMessageAt: "2026-09-20T10:00:00Z", unread: false, customer: { name: "A", tags: [] }, messages: [{ content: "hai" }], ...extra });
beforeEach(() => useConversationStore.setState({ conversationsById: {}, conversationOrder: [], activeConversationId: null }));

test("upsert dengan isi sama (objek baru) TIDAK mengubah state → tanpa render ulang", () => {
  const s = useConversationStore.getState();
  s.upsertConversations([conv("a"), conv("b")]);
  const before = useConversationStore.getState();
  let notified = 0; const un = useConversationStore.subscribe(() => notified++);
  useConversationStore.getState().upsertConversations([conv("a"), conv("b")]);
  useConversationStore.getState().upsertConversation(conv("a"));
  un();
  assert.equal(notified, 0);
  assert.equal(useConversationStore.getState(), before);
});

test("pesan baru di konv A hanya mengganti identitas A; B tetap sama objeknya", () => {
  const s = useConversationStore.getState();
  s.upsertConversations([conv("a"), conv("b")]);
  const b0 = useConversationStore.getState().conversationsById.b;
  const a0 = useConversationStore.getState().conversationsById.a;
  useConversationStore.getState().bumpConversation("a", "halo baru", "2026-09-20T10:05:00Z", 1);
  const st = useConversationStore.getState();
  assert.notEqual(st.conversationsById.a, a0);
  assert.equal(st.conversationsById.b, b0, "item lain tidak disentuh");
  assert.equal(st.conversationOrder[0], "a");
});

test("selector boolean isActive: pindah chat hanya mengubah hasil untuk 2 item", () => {
  const sel = (id) => (s) => s.activeConversationId === id;
  const ids = ["a", "b", "c", "d"];
  useConversationStore.setState({ activeConversationId: "a" });
  const before = ids.map((i) => sel(i)(useConversationStore.getState()));
  useConversationStore.setState({ activeConversationId: "b" });
  const after = ids.map((i) => sel(i)(useConversationStore.getState()));
  assert.equal(before.filter((v, i) => v !== after[i]).length, 2);
});

test("sameValue: rekursif & aman untuk array/null", () => {
  assert.ok(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }));
  assert.ok(!sameValue({ a: [1] }, { a: [1, 2] }));
  assert.ok(!sameValue(null, {}));
  assert.ok(!sameValue([], {}));
});
