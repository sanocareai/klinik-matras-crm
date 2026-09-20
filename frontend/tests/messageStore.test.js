import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useMessageStore } from "../src/features/inbox/stores/messageStore.js";

const msg = (id, t, extra = {}) => ({ id, conversationId: "c1", createdAt: new Date(t).toISOString(), direction: "INBOUND", content: id, ...extra });
const ids = (c = "c1") => useMessageStore.getState().messagesByConvId[c].map((m) => m.id);

beforeEach(() => useMessageStore.setState({ messagesByConvId: {}, hasMoreByConvId: {} }));

test("mergeLatest load awal: set + hasMore", () => {
  useMessageStore.getState().mergeLatest("c1", [msg("m5", 5), msg("m6", 6)], true);
  assert.deepEqual(ids(), ["m5", "m6"]);
  assert.equal(useMessageStore.getState().hasMoreByConvId.c1, true);
});

test("pagination: prependMessages menaruh halaman lama di depan tanpa duplikat", () => {
  const s = useMessageStore.getState();
  s.mergeLatest("c1", [msg("m5", 5), msg("m6", 6)], true);
  s.prependMessages("c1", [msg("m3", 3), msg("m4", 4), msg("m5", 5)], false);
  assert.deepEqual(ids(), ["m3", "m4", "m5", "m6"]);
  assert.equal(useMessageStore.getState().hasMoreByConvId.c1, false);
});

test("refetch halaman terbaru TIDAK membuang riwayat lama yang sudah dimuat", () => {
  const s = useMessageStore.getState();
  s.mergeLatest("c1", [msg("m5", 5), msg("m6", 6)], true);
  s.prependMessages("c1", [msg("m3", 3), msg("m4", 4)], true);
  s.mergeLatest("c1", [msg("m5", 5), msg("m6", 6), msg("m7", 7)], true);
  assert.deepEqual(ids(), ["m3", "m4", "m5", "m6", "m7"]);
  assert.equal(useMessageStore.getState().hasMoreByConvId.c1, true, "hasMore tidak di-reset");
});

test("deduplikasi: echo socket + refetch untuk pesan optimistic (clientId) → satu bubble", () => {
  const s = useMessageStore.getState();
  s.mergeLatest("c1", [msg("m1", 1)], false);
  s.upsertMessage("c1", msg("temp-1", 2, { direction: "OUTBOUND", status: "sending", clientId: "cid" }));
  const key = useMessageStore.getState().messagesByConvId.c1[1]._key;
  s.upsertMessage("c1", msg("m2", 2, { direction: "OUTBOUND", clientId: "cid" })); // echo socket
  s.mergeLatest("c1", [msg("m1", 1), msg("m2", 2, { direction: "OUTBOUND", clientId: "cid" })], false); // refetch
  assert.deepEqual(ids(), ["m1", "m2"]);
  assert.equal(useMessageStore.getState().messagesByConvId.c1[1]._key, key, "_key stabil");
  assert.ok(!useMessageStore.getState().messagesByConvId.c1[1].status);
});

test("refetch tidak membuang pesan optimistic yang belum terkirim & pesan socket yang lebih baru", () => {
  const s = useMessageStore.getState();
  s.mergeLatest("c1", [msg("m1", 1)], false);
  s.upsertMessage("c1", msg("temp-9", 5, { direction: "OUTBOUND", status: "failed", clientId: "x" }));
  s.upsertMessage("c1", msg("m3", 3)); // datang via socket setelah snapshot
  s.mergeLatest("c1", [msg("m1", 1)], false);
  assert.deepEqual(ids(), ["m1", "m3", "temp-9"]);
});

test("pesan yang sama via externalId tidak dobel di upsert", () => {
  const s = useMessageStore.getState();
  s.upsertMessage("c1", msg("m1", 1, { externalId: "wa1" }));
  s.upsertMessage("c1", msg("m1b", 1, { externalId: "wa1" }));
  assert.equal(ids().length, 1);
});

test("memory: riwayat percakapan lama di-evict (maks 8 dipertahankan)", () => {
  const s = useMessageStore.getState();
  for (let i = 0; i < 12; i++) s.mergeLatest(`c${i}`, [msg(`m${i}`, i)], false);
  const keys = Object.keys(useMessageStore.getState().messagesByConvId);
  assert.equal(keys.length, 8);
  assert.ok(keys.includes("c11"));
  assert.ok(!keys.includes("c0"));
});

test("cache invalidation: clearConversation menghapus pesan & hasMore", () => {
  const s = useMessageStore.getState();
  s.mergeLatest("c1", [msg("m1", 1)], true);
  s.clearConversation("c1");
  assert.equal(useMessageStore.getState().messagesByConvId.c1, undefined);
  assert.equal(useMessageStore.getState().hasMoreByConvId.c1, undefined);
});
