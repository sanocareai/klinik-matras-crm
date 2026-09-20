import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TAB_DUR, TAB_SHIFT_DP, tabTransition, tabA11y, TAB_LABEL, createTabRequestGuard, createIdlePreloader, LIST_RECYCLE_POOL, holdListData, HIDDEN_LIST_SAMPLE,
} from "../src/lib/tabNav.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ── Animasi ────────────────────────────────────────────────────────────────────────────────────
test("animasi tab: 180–220 ms, geser 12–24 dp (bukan satu layar penuh)", () => {
  const t = tabTransition();
  assert.equal(t.animation, "shift");
  assert.ok(TAB_DUR >= 180 && TAB_DUR <= 220, `TAB_DUR=${TAB_DUR}`);
  assert.ok(TAB_SHIFT_DP >= 12 && TAB_SHIFT_DP <= 24, `TAB_SHIFT_DP=${TAB_SHIFT_DP}`);
  assert.equal(t.duration, TAB_DUR);
});

test("reduced motion: tanpa animasi sama sekali (durasi 0, tanpa geser)", () => {
  assert.deepEqual(tabTransition({ reduceMotion: true }), { animation: "none", duration: 0, shift: 0 });
});

test("interpolator hanya memakai transform translateX (tanpa properti layout / opacity / blur)", () => {
  const src = read("App.js");
  const fn = src.slice(src.indexOf("function forSlide"), src.indexOf("// Satu tab: SATU ikon saja"));
  assert.match(fn, /translateX/);
  // opacity BOLEH hanya sebagai fungsi anak-tangga 0/1 (menyembunyikan layar tak tampil tanpa layer alpha parsial)
  assert.match(fn, /outputRange: \[0, 1, 1, 1, 0\]/);
  for (const bad of ["width", "left", "right", "margin", "padding", "height", "top:", "blur", "shadow"]) {
    assert.ok(!fn.includes(bad), `forSlide tidak boleh memuat "${bad}"`);
  }
  assert.match(src, /outputRange: \[-TAB_SHIFT_DP, 0, TAB_SHIFT_DP\]/);
});

// ── Aksesibilitas ──────────────────────────────────────────────────────────────────────────────
test("tab accessibility: role tab, label Indonesia, status terpilih, label badge", () => {
  assert.deepEqual(tabA11y("Chats", true), { accessibilityRole: "tab", accessibilityLabel: "Inbox", accessibilityState: { selected: true } });
  assert.equal(tabA11y("Home", false).accessibilityLabel, "Beranda");
  assert.equal(tabA11y("Home", false).accessibilityState.selected, false);
  assert.equal(tabA11y("Chats", false, 12).accessibilityLabel, "Inbox, 12 belum dibaca");
  assert.deepEqual(Object.keys(TAB_LABEL), ["Home", "Chats", "Pelanggan", "Order", "Profil"]);
  const src = read("App.js");
  assert.match(src, /accessibilityRole="tablist"/);
  assert.match(src, /\{\.\.\.tabA11y\(route\.name, focused\)\}/);
  assert.match(src, /onPressIn=\{onPress\}/, "tab merespons sentuhan langsung");
});

// ── Ketukan beruntun / navigasi tunggal ───────────────────────────────────────────────────────
test("guard: ketuk tab aktif (double tap) tidak menavigasi", () => {
  const g = createTabRequestGuard();
  assert.equal(g.request("Home", "Home"), false);
  assert.equal(g.request("Home", "Home"), false);
});

test("guard: dua ketukan ke tujuan yang sama sebelum state menyusul → hanya SATU navigasi", () => {
  let t = 1000;
  const g = createTabRequestGuard({ now: () => t });
  assert.equal(g.request("Chats", "Home"), true);
  t += 30;
  assert.equal(g.request("Chats", "Home"), false, "state masih Home, tapi tujuan sudah Chats");
  g.settle("Chats");
  assert.equal(g.pending, null);
  assert.equal(g.request("Chats", "Chats"), false);
});

test("guard: ketukan beruntun ke tab BERBEDA selalu diizinkan (interupsi aman), A→B→A tidak macet", () => {
  let t = 0;
  const g = createTabRequestGuard({ now: () => t });
  const hasil = [];
  let aktif = "Home";
  for (let i = 0; i < 20; i++) {
    const target = i % 2 ? "Home" : "Chats";
    hasil.push(g.request(target, aktif));
    t += 40; // 40 ms antar ketukan: state navigator belum menyusul
  }
  assert.equal(hasil.filter(Boolean).length, 20, "tiap ketukan berganti tujuan → semua diteruskan");
  g.settle("Home");
  assert.equal(g.request("Chats", "Home"), true);
});

test("guard: inFlight kedaluwarsa (tidak pernah macet bila state tak menyusul)", () => {
  let t = 0;
  const g = createTabRequestGuard({ ttlMs: 300, now: () => t });
  assert.equal(g.request("Order", "Home"), true);
  t += 350;
  assert.equal(g.request("Order", "Home"), true, "kedaluwarsa → boleh mencoba lagi");
});

// ── Preload idle ───────────────────────────────────────────────────────────────────────────────
function fakeTimers() {
  let id = 0; const q = new Map();
  return {
    schedule: (fn, ms) => { q.set(++id, { fn, ms }); return id; },
    cancel: (i) => q.delete(i),
    pending: () => q.size,
    fire() { const e = [...q][0]; if (!e) return null; q.delete(e[0]); e[1].fn(); return e[1].ms; },
  };
}

test("preload idle: TIDAK jalan saat startup — baru setelah jeda; hanya sekali per tab, urut", () => {
  const f = fakeTimers(); const done = [];
  const p = createIdlePreloader({ order: ["Chats", "Order"], preload: (n) => done.push(n), schedule: f.schedule, cancel: f.cancel, firstDelayMs: 2500, gapMs: 1500 });
  p.start();
  assert.deepEqual(done, [], "belum ada preload saat start()");
  assert.equal(f.fire(), 2500);
  assert.deepEqual(done, ["Chats"]);
  assert.equal(f.fire(), 1500);
  assert.deepEqual(done, ["Chats", "Order"]);
  assert.equal(f.pending(), 0, "selesai, tidak menjadwalkan ulang");
});

test("preload idle: sibuk (app di background / user sedang pindah tab) → ditunda, tidak dilewati", () => {
  const f = fakeTimers(); const done = []; let busy = true;
  const p = createIdlePreloader({ order: ["Chats"], preload: (n) => done.push(n), schedule: f.schedule, cancel: f.cancel, isBusy: () => busy, retryMs: 1200 });
  p.start();
  f.fire(); assert.deepEqual(done, []); // sibuk
  assert.equal(f.fire(), 1200); assert.deepEqual(done, []);
  busy = false;
  f.fire(); assert.deepEqual(done, ["Chats"]);
});

test("preload idle: interrupt (sentuhan tab bar) menunda; stop membersihkan timer (tanpa kebocoran)", () => {
  const f = fakeTimers(); const done = [];
  const p = createIdlePreloader({ order: ["Chats"], preload: (n) => done.push(n), schedule: f.schedule, cancel: f.cancel });
  p.start();
  p.interrupt();
  assert.equal(f.pending(), 1, "hanya satu timer aktif");
  p.stop();
  assert.equal(f.pending(), 0);
  p.start();
  assert.equal(f.pending(), 0, "setelah stop tidak bisa dinyalakan lagi");
  assert.deepEqual(done, []);
});

test("preload idle: error saat preload tidak mematikan penjadwal", () => {
  const f = fakeTimers(); const done = [];
  const p = createIdlePreloader({ order: ["A", "B"], preload: (n) => { done.push(n); if (n === "A") throw new Error("x"); }, schedule: f.schedule, cancel: f.cancel });
  p.start(); f.fire(); f.fire();
  assert.deepEqual(done, ["A", "B"]);
});

// ── Struktur (regresi): state terjaga, tanpa mount ulang, tanpa kerja berat saat animasi ─────────
test("state preservation: tab tetap ter-mount (tidak dilepas/dibekukan), tidak ada lazy:false saat startup", () => {
  const src = read("App.js");
  assert.match(src, /detachInactiveScreens=\{false\}/);
  assert.match(src, /freezeOnBlur: false/);
  assert.ok(!/lazy:\s*false/.test(src), "Inbox tidak lagi di-mount saat startup kritis");
  assert.match(src, /createIdlePreloader\(\{\s*order: \["Chats"\]/, "Inbox dipreload idle");
  for (const s of ["ChatListScreen", "PelangganScreen", "OrdersScreen", "ProfileScreen"]) assert.match(src, new RegExp(`deferTabScreen\\(${s}\\)`));
  assert.match(src, /deferTabScreen\(HomeScreen, \{ immediate: true \}\)/);
});

test("deferTabScreen: skeleton → layar asli SEKALI, tidak pernah kembali ke skeleton (state & scroll terjaga)", () => {
  const src = read("src/lib/tabHooks.js");
  assert.match(src, /ready \? <Screen \{\.\.\.props\} \/> : <TabSkeleton \/>/);
  assert.ok(!/setReady\(false\)/.test(src));
  assert.match(src, /clearTimeout\(t\)/);
  const skel = read("src/components/TabSkeleton.js");
  for (const bad of ["Animated", "withRepeat", "withTiming", "blur", "shadow"]) assert.ok(!skel.includes(bad), `skeleton tidak boleh memuat ${bad}`);
});

test("layar tab tidak dirender ulang oleh perpindahan tab (memo dengan komparator selalu-sama)", () => {
  const h = read("src/lib/tabHooks.js");
  assert.match(h, /const holdEqual = \(\) => true;/);
  assert.match(h, /return memo\(Screen, holdEqual\)/);
  assert.match(h, /return memo\(Deferred, holdEqual\)/);
  // tab tidak boleh membaca props selain navigation (kalau ya, memo ini tidak aman)
  for (const f of ["HomeScreen", "ChatListScreen", "PelangganScreen", "OrdersScreen", "ProfileScreen"]) {
    const s = read(`src/screens/${f}.js`);
    assert.ok(!/route\.params|props\.route|\{ route/.test(s), `${f} membaca route — memo selalu-sama tidak aman`);
  }
});

test("fetch berat dipisah dari animasi: Home & Inbox memakai useFocusAfterInteractions, bukan useFocusEffect", () => {
  for (const f of ["src/screens/HomeScreen.js", "src/screens/ChatListScreen.js"]) {
    const s = read(f);
    assert.match(s, /useFocusAfterInteractions\(/, f);
    assert.ok(!/useFocusEffect\(/.test(s.replace(/\/\/.*$/gm, "")), `${f} masih memakai useFocusEffect`);
  }
  const h = read("src/lib/tabHooks.js");
  assert.match(h, /InteractionManager\.runAfterInteractions/);
  assert.match(h, /task\.cancel\?\.\(\)/, "dibatalkan bila kehilangan fokus (tanpa kebocoran)");
});

test("reduced motion terhubung ke navigator & pil tab", () => {
  const src = read("App.js");
  assert.match(src, /useReducedMotion\(\)/);
  assert.match(src, /animation: trans\.animation/);
  assert.match(src, /reduceMotion \? \{ duration: 0 \} : PILL_SPEC/);
  const h = read("src/lib/tabHooks.js");
  assert.match(h, /isReduceMotionEnabled/);
  assert.match(h, /reduceMotionChanged/);
});

test("daftar tab: kolam daur-ulang FlashList dibatasi (tanpa batas → ratusan sel tersembunyi tetap ter-mount)", () => {
  assert.ok(LIST_RECYCLE_POOL > 0 && LIST_RECYCLE_POOL <= 20, `LIST_RECYCLE_POOL=${LIST_RECYCLE_POOL}`);
  for (const f of ["src/screens/ChatListScreen.js", "src/screens/PelangganScreen.js", "src/screens/OrdersScreen.js", "src/components/PipelineBoard.js"]) {
    const s = read(f);
    const n = (s.match(/<FlashList\b/g) || []).length;
    const m = (s.match(/maxItemsInRecyclePool=\{LIST_RECYCLE_POOL\}/g) || []).length;
    assert.equal(m, n, `${f}: setiap FlashList harus membatasi kolam daur-ulang`);
  }
});

test("pindah tab tidak merender ulang App/Root: state route hanya berubah bila kategori tampilan berganti; persist ditunda", () => {
  const src = read("App.js");
  const fn = src.slice(src.indexOf("function syncRouteName"), src.indexOf("// ⚠️ URUTAN PROVIDER"));
  assert.match(fn, /LIGHT_SCREENS\.includes\(prev\) === LIGHT_SCREENS\.includes\(next\) \? prev : next/);
  assert.ok(!/AsyncStorage\.setItem|JSON\.stringify/.test(fn), "tidak ada I/O sinkron di jalur perpindahan tab");
  const p = src.slice(src.indexOf("function persistNavState"), src.indexOf("export default function App"));
  assert.match(p, /clearTimeout\(persistTimer\)/);
  assert.match(p, /setTimeout\(/);
});

test("daftar di layar tersembunyi dibekukan (tanpa ini FlashList me-render SEMUA baris: tinggi terukur 0)", () => {
  const data = Array.from({ length: 300 }, (_, i) => `c${i}`);
  // belum pernah tampil → contoh kecil saja
  const first = holdListData({ focused: false, data });
  assert.equal(first.length, HIDDEN_LIST_SAMPLE);
  // data bertambah saat masih tersembunyi → tetap beku (tidak render ulang ratusan sel)
  assert.equal(holdListData({ focused: false, data: [...data, "x"], held: first }), first);
  // fokus → data penuh; lalu tersembunyi lagi → beku di data terakhir yang tampil (posisi scroll tak berubah)
  assert.equal(holdListData({ focused: true, data, held: first }), data);
  assert.equal(holdListData({ focused: false, data: [...data, "y"], held: data }), data);
  for (const f of ["ChatListScreen", "PelangganScreen", "OrdersScreen"]) {
    const s = read(`src/screens/${f}.js`);
    assert.match(s, /useHiddenSafeList\(navigation, /, f);
  }
  const h = read("src/lib/tabHooks.js");
  assert.match(h, /addListener\("focus"/);
  assert.match(h, /addListener\("blur"/);
});
