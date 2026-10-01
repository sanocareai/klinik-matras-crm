// P10B draf unggahan dokumentasi yang bertahan offline: refresh, reconnect, retry maksimal 5, logout/ganti user, cache rusak, kuota penuh,
// exact-once, dan pembersihan Blob setelah sukses. Dieksekusi dari sumber dengan adapter memori + api palsu (tanpa jsdom/IndexedDB nyata;
// IndexedDB nyata diuji di QA browser 390).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BACKOFF_MS, DRAFT_SCHEMA, DraftError, LIMITS, MAX_RETRY, STATUS, createDraftManager, createMemoryAdapter, isValidRecord, purgePrincipalDrafts,
} from "../src/features/production/documentationDrafts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", ...p), "utf8");

const RUN_A = "11111111-1111-4111-8111-111111111111", RUN_B = "22222222-2222-4222-8222-222222222222";
const file = (name, size = 1000, type = "image/jpeg") => { const b = new Blob([new Uint8Array(size).fill(7)], { type }); return Object.assign(b, { name }); };
const netErr = () => Object.assign(new Error("Koneksi terputus"), { status: 0, code: "NETWORK" });

function fakeApi({ failUploads = 0, failSubmits = 0, submitError = null, submitFailsAfterApply = false } = {}) {
  const state = { uploads: [], submits: [], failUploads, failSubmits, applied: new Map(), calls: 0 };
  return {
    state,
    upload: async (runId, blob) => {
      state.calls += 1;
      if (state.failUploads > 0) { state.failUploads -= 1; throw netErr(); }
      const n = state.uploads.length + 1; state.uploads.push({ runId, size: blob.size });
      return { items: [{ url: `/media/production-evidence/${String(n).padStart(40, "a")}.jpg`, previewUrl: `/media/production-evidence/${String(n).padStart(40, "a")}.jpg?exp=1&sig=x`, kind: "image" }] };
    },
    submit: async (runId, body, key) => {
      state.calls += 1;
      state.submits.push({ runId, body, key });
      if (submitError) throw submitError;
      if (state.failSubmits > 0) { state.failSubmits -= 1; throw netErr(); }
      const replayed = state.applied.has(key);
      if (!replayed) state.applied.set(key, body);
      return { evidenceId: "e1", count: body.items.length, replayed };
    },
    correct: async (runId, body, key) => { state.submits.push({ runId, body, key, correction: true }); state.applied.set(key, body); return { evidenceId: "e2", count: body.items.length }; },
  };
}
function mk(over = {}) {
  const adapter = over.adapter || createMemoryAdapter();
  const api = over.api || fakeApi();
  let t = 1_000_000; const timers = [];
  const env = { online: true };
  let idn = 0;
  const mgr = createDraftManager({
    adapter, api, principalId: over.principalId || "user-1", now: () => t, newId: () => `id${++idn}${over.idSuffix || ""}`,
    isOnline: () => env.online, schedule: (fn, ms) => { const h = { fn, ms }; timers.push(h); return h; }, clearSchedule: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
    makeThumb: async () => "data:image/jpeg;base64,AAAA", ...(over.deps || {}),
  });
  return { adapter, api, mgr, env, timers, tick: (ms) => { t += ms; } };
}
const draftOf = (mgr, over = {}) => mgr.openDraft({ runId: RUN_A, unitCode: "RES-1", customerName: "Ibu A", category: "BEFORE_TEARDOWN", categoryLabel: "Sebelum bongkar", ...over });

test("refresh/PWA tertutup: foto, kategori, caption, unit, kunci idempoten, status bertahan dan dibaca manager baru", async () => {
  const a = mk(); await a.mgr.init();
  a.env.online = false; // offline: foto hanya tersimpan lokal
  const d = await draftOf(a.mgr);
  const { added } = await a.mgr.addFiles(d.id, [file("a.jpg"), file("b.jpg")]);
  await a.mgr.setCaption(d.id, added[0], "Sisi kiri sobek");
  await a.mgr.moveItem(d.id, added[1], -1);
  const before = await a.mgr.get(d.id);
  // "Refresh": manager baru di atas penyimpanan yang sama.
  const b = mk({ adapter: a.adapter, idSuffix: "x" }); const summary = await b.mgr.init();
  assert.deepEqual([summary.foreign, summary.corrupt, summary.schema], [0, 0, 0]);
  const [r] = await b.mgr.list();
  assert.equal(r.runId, RUN_A); assert.equal(r.unitCode, "RES-1"); assert.equal(r.category, "BEFORE_TEARDOWN"); assert.equal(r.status, STATUS.DRAFT);
  assert.equal(r.idempotencyKey, before.idempotencyKey);
  assert.deepEqual(r.items.map((i) => i.caption), ["", "Sisi kiri sobek"], "urutan & caption bertahan");
  assert.ok(r.items.every((i) => i.blob && i.size === 1000 && i.thumb), "Blob + thumbnail bertahan");
  assert.equal(a.api.state.uploads.length, 0, "offline: tidak ada unggahan");
});

test("reconnect: Kirim saat offline -> QUEUED tanpa panggilan jaringan & tanpa hitungan retry; online -> unggah + kirim sekali, record & Blob bersih", async () => {
  const x = mk(); await x.mgr.init(); x.env.online = false;
  const d = await draftOf(x.mgr); await x.mgr.addFiles(d.id, [file("a.jpg"), file("b.jpg")]);
  await x.mgr.queue(d.id);
  let r = await x.mgr.get(d.id);
  assert.equal(r.status, STATUS.QUEUED); assert.equal(r.retryCount, 0); assert.equal(x.api.state.calls, 0);
  assert.equal(await x.mgr.hasActiveWork(), true);
  x.env.online = true; await x.mgr.onOnline();
  assert.equal(x.api.state.uploads.length, 2); assert.equal(x.api.state.submits.length, 1);
  assert.equal(x.api.state.submits[0].body.items.length, 2); assert.equal(x.api.state.submits[0].body.category, "BEFORE_TEARDOWN");
  assert.equal(await x.mgr.get(d.id), null, "sukses menghapus record");
  assert.deepEqual(await x.adapter.getAll(), [], "tidak ada Blob tersisa di penyimpanan");
  assert.equal(await x.mgr.hasActiveWork(), false);
});

test("upload sukses membersihkan Blob lokal segera (hanya thumbnail & URL tersisa) bahkan sebelum Kirim", async () => {
  const x = mk(); await x.mgr.init();
  const d = await draftOf(x.mgr); await x.mgr.addFiles(d.id, [file("a.jpg")]); await x.mgr.uploadPending(d.id);
  const r = await x.mgr.get(d.id);
  assert.equal(r.items[0].blob, null); assert.match(r.items[0].url, /^\/media\/production-evidence\/[a-f0-9]{40}\.jpg$/); assert.ok(r.items[0].thumb);
  assert.equal(r.status, STATUS.DRAFT, "unggah belum berarti terkirim");
  assert.equal((await x.mgr.stats()).bytes, 0);
});

test("retry otomatis: gagal jaringan dijadwalkan ulang dengan backoff; maksimal 5 kali lalu FAILED; Coba Lagi mengulang dari nol", async () => {
  const x = mk({ api: fakeApi({ failSubmits: 99 }) }); await x.mgr.init();
  const d = await draftOf(x.mgr); await x.mgr.addFiles(d.id, [file("a.jpg")]); await x.mgr.uploadPending(d.id);
  await x.mgr.queue(d.id);
  for (let i = 1; i <= MAX_RETRY - 1; i += 1) {
    const r = await x.mgr.get(d.id);
    assert.equal(r.status, STATUS.QUEUED, `percobaan ${i} gagal -> masih antre`); assert.equal(r.retryCount, i);
    assert.ok(x.timers.length >= 1 && x.timers.at(-1).ms <= BACKOFF_MS[i - 1] + 1, "timer jeda terpasang");
    x.tick(BACKOFF_MS[i - 1] + 10); await x.mgr.processQueue();
  }
  const failed = await x.mgr.get(d.id);
  assert.equal(failed.status, STATUS.FAILED); assert.equal(failed.retryCount, MAX_RETRY); assert.match(failed.lastError, /Gagal 5 kali/);
  assert.equal(x.api.state.submits.length, MAX_RETRY);
  assert.ok(new Set(x.api.state.submits.map((s) => s.key)).size === 1, "kunci idempoten sama di semua percobaan");
  assert.equal(failed.items[0].url !== null, true, "foto yang sudah terunggah tidak diunggah ulang");
  assert.equal(x.api.state.uploads.length, 1);
  x.api.state.failSubmits = 0;
  await x.mgr.retry(d.id);
  assert.equal(await x.mgr.get(d.id), null); assert.equal(x.api.state.applied.size, 1);
});

test("galat server 4xx = FAILED langsung (tanpa retry buta); dibuka lagi sebagai DRAFT dengan kunci idempoten BARU", async () => {
  const x = mk({ api: fakeApi({ submitError: Object.assign(new Error("Foto ini sudah tercatat"), { status: 409, code: "DOC_MEDIA_ALREADY_SUBMITTED" }) }) }); await x.mgr.init();
  const d = await draftOf(x.mgr); await x.mgr.addFiles(d.id, [file("a.jpg")]); await x.mgr.uploadPending(d.id);
  const key0 = (await x.mgr.get(d.id)).idempotencyKey;
  await x.mgr.queue(d.id);
  const r = await x.mgr.get(d.id);
  assert.equal(r.status, STATUS.FAILED); assert.equal(r.retryCount, 0); assert.equal(r.outcomeKnown, true); assert.equal(x.api.state.submits.length, 1);
  const re = await x.mgr.reopen(d.id);
  assert.equal(re.status, STATUS.DRAFT); assert.notEqual(re.idempotencyKey, key0);
});

test("exact-once: dua worker bersamaan -> kirim sekali; sukses tapi pembersihan lokal gagal -> replay kunci SAMA, tidak duplikat; kunci berubah hanya saat isi draf berubah", async () => {
  const x = mk(); await x.mgr.init();
  const d = await draftOf(x.mgr); await x.mgr.addFiles(d.id, [file("a.jpg"), file("b.jpg")]);
  await x.mgr.queue(d.id).catch(() => {});
  assert.equal(x.api.state.submits.length, 1);
  // dua worker bersamaan pada record QUEUED lain
  const y = mk(); await y.mgr.init();
  const e = await draftOf(y.mgr); await y.mgr.addFiles(e.id, [file("c.jpg")]); await y.mgr.uploadPending(e.id);
  y.env.online = false; await y.mgr.queue(e.id); y.env.online = true;
  await Promise.all([y.mgr.processQueue(), y.mgr.processQueue(), y.mgr.onOnline()]);
  assert.equal(y.api.state.submits.length, 1, "claim atomik + single-flight");
  // manager kedua (tab lain) pada penyimpanan yang sama tidak mengirim ulang record yang sedang di-lease
  const z = mk(); await z.mgr.init();
  const f = await draftOf(z.mgr); await z.mgr.addFiles(f.id, [file("d.jpg")]); await z.mgr.uploadPending(f.id);
  z.env.online = false; await z.mgr.queue(f.id); z.env.online = true;
  const tab2 = mk({ adapter: z.adapter, api: z.api }); await tab2.mgr.init();
  await Promise.all([z.mgr.processQueue(), tab2.mgr.processQueue()]);
  assert.equal(z.api.state.applied.size, 1, "dua tab: server menerima SATU pengiriman");
  assert.equal(z.api.state.submits.filter((s) => s.key === (z.api.state.submits[0].key)).length >= 1, true);
  // sukses di server tetapi remove lokal gagal
  const w = mk(); await w.mgr.init();
  const g = await draftOf(w.mgr); await w.mgr.addFiles(g.id, [file("e.jpg")]); await w.mgr.uploadPending(g.id);
  w.env.online = false; await w.mgr.queue(g.id); w.env.online = true;
  const realRemove = w.adapter.remove; let failOnce = true;
  w.adapter.remove = async (id) => { if (failOnce) { failOnce = false; throw new Error("tab mati"); } return realRemove(id); };
  await w.mgr.processQueue();
  assert.equal(w.api.state.applied.size, 1); assert.equal((await w.mgr.get(g.id)).status, STATUS.QUEUED, "tetap tercatat sampai server dikonfirmasi bersih");
  w.tick(BACKOFF_MS[0] + 5); await w.mgr.processQueue();
  assert.equal(w.api.state.applied.size, 1, "tidak ada pengiriman kedua"); assert.equal(w.api.state.submits.length, 2); assert.equal(w.api.state.submits[0].key, w.api.state.submits[1].key);
  assert.equal(await w.mgr.get(g.id), null);
  // kunci berubah hanya bila isi berubah
  const h = mk(); await h.mgr.init(); const k = await draftOf(h.mgr); const k0 = k.idempotencyKey; const { added } = await h.mgr.addFiles(k.id, [file("f.jpg")]);
  const k1 = (await h.mgr.get(k.id)).idempotencyKey; await h.mgr.setCaption(k.id, added[0], "baru"); const k2 = (await h.mgr.get(k.id)).idempotencyKey;
  assert.notEqual(k0, k1); assert.notEqual(k1, k2);
});

test("logout & pergantian user: draf principal lama dibuang; draf TIDAK pernah tercampur antar-user atau antar-unit", async () => {
  const shared = createMemoryAdapter();
  const u1 = mk({ adapter: shared, principalId: "user-1" }); await u1.mgr.init();
  const d1 = await draftOf(u1.mgr, { runId: RUN_A }); await u1.mgr.addFiles(d1.id, [file("a.jpg")]);
  const d1b = await draftOf(u1.mgr, { runId: RUN_B, unitCode: "RES-2", category: "FOUNDATION" }); await u1.mgr.addFiles(d1b.id, [file("b.jpg")]);
  assert.deepEqual((await u1.mgr.list({ runId: RUN_A })).map((r) => r.id), [d1.id], "per unit terpisah");
  assert.deepEqual((await u1.mgr.list({ runId: RUN_B })).map((r) => r.id), [d1b.id]);
  // user-2 membuka aplikasi di HP yang sama SEBELUM init: tidak melihat draf user-1.
  const u2 = mk({ adapter: shared, principalId: "user-2", idSuffix: "u2" });
  assert.deepEqual(await u2.mgr.list(), [], "tidak pernah menampilkan draf principal lain");
  const s = await u2.mgr.init(); assert.equal(s.foreign, 2);
  assert.deepEqual((await shared.getAll()).length, 0, "draf user-1 dibuang saat user-2 masuk");
  // logout eksplisit: purge principal itu saja (+ rusak)
  const keep = mk({ adapter: shared, principalId: "user-3" }); await keep.mgr.init(); const d3 = await draftOf(keep.mgr); await keep.mgr.addFiles(d3.id, [file("c.jpg")]);
  const other = mk({ adapter: shared, principalId: "user-4" }); const d4 = await shared.put({ ...(await shared.get(d3.id)), id: "other-4", principalId: "user-4" });
  void other; void d4;
  const res = await purgePrincipalDrafts(shared, "user-3");
  assert.deepEqual((await shared.getAll()).map((r) => r.principalId), ["user-4"], "hanya principal yang logout dibersihkan"); assert.equal(res.removed, 1);
  // kode logout memanggil purge
  assert.match(src("App.jsx"), /purgePrincipalDrafts/);
});

test("cache rusak & skema berbeda: record tak valid / skema lama dibuang saat init; DB tak terbaca -> reset bersih; draf sah tetap", async () => {
  const adapter = createMemoryAdapter(); const x = mk({ adapter }); await x.mgr.init();
  const good = await draftOf(x.mgr); await x.mgr.addFiles(good.id, [file("a.jpg")]);
  const base = await adapter.get(good.id);
  adapter.rows.set("rusak-1", { id: "rusak-1", principalId: "user-1" });
  adapter.rows.set("rusak-2", { ...base, id: "rusak-2", items: "bukan-array" });
  adapter.rows.set("rusak-3", { ...base, id: "rusak-3", status: "ENTAH" });
  adapter.rows.set("rusak-4", { ...base, id: "rusak-4", items: [{ id: "i", size: 1, blob: null, url: null }] }); // tanpa Blob & tanpa URL = tak bisa dikirim
  adapter.rows.set("lama-1", { ...base, id: "lama-1", schema: DRAFT_SCHEMA - 1 });
  adapter.rows.set("nol", null);
  const fresh = mk({ adapter }); const s = await fresh.mgr.init();
  assert.equal(s.corrupt >= 4, true, JSON.stringify(s)); assert.equal(s.schema, 1);
  assert.deepEqual((await fresh.mgr.list()).map((r) => r.id), [good.id], "hanya record sah yang bertahan");
  assert.equal(isValidRecord(base), true); assert.equal(isValidRecord({}), false); assert.equal(isValidRecord(null), false);
  // seluruh penyimpanan tak terbaca
  const broken = createMemoryAdapter(); let reset = false; broken.getAll = async () => { throw new Error("DB corrupt"); }; broken.reset = async () => { reset = true; };
  const b = mk({ adapter: broken }); const sb = await b.mgr.init();
  assert.equal(sb.reset, true); assert.equal(reset, true);
});

test("penyimpanan penuh: QuotaExceededError -> pesan Bahasa Indonesia & tidak ada draf setengah jadi; batas jumlah/ukuran/total/estimasi; tipe non-gambar ditolak", async () => {
  const quota = Object.assign(new Error("quota"), { name: "QuotaExceededError" });
  const x = mk(); await x.mgr.init();
  const d = await draftOf(x.mgr);
  x.adapter.failPutWith = quota;
  await assert.rejects(x.mgr.addFiles(d.id, [file("a.jpg")]), (e) => e instanceof DraftError && e.code === "STORAGE_FULL" && /Penyimpanan HP penuh/.test(e.message));
  x.adapter.failPutWith = null;
  assert.equal((await x.mgr.get(d.id)).items.length, 0, "tidak ada foto yang tersimpan setengah-setengah");
  // draf baru pun gagal dengan pesan yang sama
  const y = mk(); await y.mgr.init(); y.adapter.failPutWith = quota;
  await assert.rejects(draftOf(y.mgr), (e) => e.code === "STORAGE_FULL");
  // batas
  const z = mk(); await z.mgr.init(); const dz = await draftOf(z.mgr);
  const r1 = await z.mgr.addFiles(dz.id, [file("a.gif", 10, "image/gif"), file("b.pdf", 10, "application/pdf")]);
  assert.deepEqual(r1.rejected.map((r) => r.code), ["NOT_IMAGE", "NOT_IMAGE"]); assert.match(r1.rejected[0].message, /JPG\/PNG\/WEBP/);
  const r2 = await z.mgr.addFiles(dz.id, Array.from({ length: LIMITS.maxItemsPerDraft + 2 }, (_, i) => file(`p${i}.jpg`, 10)));
  assert.equal(r2.added.length, LIMITS.maxItemsPerDraft); assert.equal(r2.rejected.length, 2); assert.match(r2.rejected[0].message, /Maksimal 12 foto/);
  const big = mk({ deps: { estimateStorage: async () => ({ quota: 10_000, usage: 9_500 }) } }); await big.mgr.init(); const db = await draftOf(big.mgr);
  const r3 = await big.mgr.addFiles(db.id, [file("x.jpg", 600)]); assert.equal(r3.rejected[0].code, "STORAGE_FULL"); assert.match(r3.rejected[0].message, /Penyimpanan HP penuh/);
  const tooBig = await z.mgr.addFiles((await draftOf(z.mgr, { runId: RUN_B, category: "PROCESS" })).id, [file("raksasa.jpg", LIMITS.maxPhotoBytes + 1)]);
  assert.equal(tooBig.rejected[0].code, "TOO_BIG");
});

test("hapus draf manual; draf yang sedang dikirim tidak bisa dihapus; Kirim butuh minimal 1 foto dan alasan untuk koreksi; draf tak bisa diubah setelah antre", async () => {
  const x = mk(); await x.mgr.init();
  const d = await draftOf(x.mgr);
  await assert.rejects(x.mgr.queue(d.id), (e) => e.code === "EMPTY");
  await x.mgr.addFiles(d.id, [file("a.jpg")]);
  assert.equal(await x.mgr.discard(d.id), true); assert.equal(await x.mgr.get(d.id), null); assert.equal(await x.mgr.discard(d.id), false);
  const c = await x.mgr.openDraft({ runId: RUN_A, category: "FOUNDATION", correction: { evidenceId: "ev-1" }, seedItems: [{ url: "/media/production-evidence/" + "a".repeat(40) + ".jpg", previewUrl: "/p?sig=1", caption: "lama" }] });
  await assert.rejects(x.mgr.queue(c.id), (e) => e.code === "REASON");
  await x.mgr.setReason(c.id, "Foto tertukar");
  x.env.online = false; await x.mgr.queue(c.id);
  await assert.rejects(x.mgr.addFiles(c.id, [file("b.jpg")]), (e) => e.code === "NOT_EDITABLE");
  await assert.rejects(x.mgr.setCaption(c.id, "x", "y"), (e) => e.code === "NOT_EDITABLE");
  x.env.online = true; await x.mgr.processQueue();
  const sub = x.api.state.submits.at(-1);
  assert.equal(sub.correction, true); assert.equal(sub.body.supersedesEvidenceId, "ev-1"); assert.equal(sub.body.reason, "Foto tertukar"); assert.equal(sub.body.items[0].caption, "lama");
  // lease aktif -> tidak bisa dihapus
  const y = mk(); await y.mgr.init(); const e = await draftOf(y.mgr); await y.mgr.addFiles(e.id, [file("c.jpg")]);
  await y.adapter.update(e.id, (cur) => ({ ...cur, status: STATUS.SENDING, leaseUntil: 9_999_999_999 }));
  await assert.rejects(y.mgr.discard(e.id), (err) => err.code === "BUSY");
  // lease kedaluwarsa (tab mati saat mengirim) -> init mengembalikan ke antrean
  await y.adapter.update(e.id, (cur) => ({ ...cur, leaseUntil: 1 }));
  const s = await mk({ adapter: y.adapter }).mgr.init(); assert.equal(s.recovered, 1); assert.equal((await y.adapter.get(e.id)).status, STATUS.QUEUED);
});

test("UI terpasang: konfirmasi sebelum meninggalkan halaman saat ada pekerjaan aktif, panel antrean (Coba Lagi/Hapus draf), logout membersihkan, online memicu retry", () => {
  const page = src("pages", "produksi", "ProductionDocumentation.jsx") + src("features", "production", "DocumentationDraftUi.jsx");
  assert.match(page, /beforeunload/); assert.match(page, /isActive\(statsRef\.current\)/);
  assert.match(page, /addEventListener\("online"/); assert.match(page, /\.onOnline\(\)/);
  assert.match(page, /Hapus draft/); assert.match(page, /Coba Lagi/); assert.match(page, /window\.confirm/);
  assert.match(page, /createIdbAdapter\(\)/); assert.match(page, /principalId/); assert.match(page, /onLeave=\{drafts\.confirmLeave\}/);
  assert.match(src("components", "StandaloneShell.jsx"), /onLeave && !onLeave\(\)/);
  assert.match(page, /pendingText/);
  const app = src("App.jsx");
  assert.match(app, /purgePrincipalDrafts\(createIdbAdapter\(\), principal\)/);
});
