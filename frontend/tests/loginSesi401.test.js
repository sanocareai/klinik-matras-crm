// Login web: 401 dari percobaan login = "email/password salah", BUKAN "Sesi Berakhir" (laporan 14 Okt 2026: banyak perangkat gagal
// login berulang; dialog "Sesi Berakhir" menutupi form sehingga email/password tidak bisa diketik; di log nginx 13 Okt: 12× 401
// kredensial + 11× 429 dari satu perangkat yang mengulang tanpa sadar).
//
// Yang diuji adalah KODE ASLI src/api.js (dibundel dengan esbuild, import.meta.env diberi nilai tetap) dengan fetch/XHR/localStorage/
// window palsu — bukan salinan logika. Perilaku App.jsx/Login.jsx diuji sebagai pagar kode (pola yang sama dengan tes UI lain).
import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { bolehAdopsiTokenGeser, klaimToken } from "../src/lib/tokenGeser.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (rel) => fs.readFileSync(path.join(here, "../src", rel), "utf8");

// ── lingkungan palsu ───────────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
globalThis.window = new EventTarget();
const authErrorEvents = [];
window.addEventListener("auth-error", () => authErrorEvents.push(Date.now()));

let calls = [];
const json = (status, body = {}, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const tertunda = () => { let selesai; const p = new Promise((r) => { selesai = r; }); return { p, selesai }; };
/** Pasang fetch palsu; `jawab(url, init)` mengembalikan Response atau Promise<Response>. */
function pasangFetch(jawab) {
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", headers: { ...(init.headers || {}) } });
    return jawab(String(url), init);
  };
}
const authHeaderDari = (call) => call.headers.Authorization ?? call.headers.authorization ?? null;

// Token berbentuk JWT (tanpa tanda tangan sungguhan — klien hanya membaca klaim id/exp; keabsahan tetap urusan server).
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwtPalsu = (exp, id = "u1") => `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ id, exp })}.sig`;
const SEKARANG = 1_800_000_000;

const USER = { id: "u1", name: "Tes", role: "SALES", roles: ["SALES"] };
let api;
let tmpFile;

before(async () => {
  const hasil = await build({
    entryPoints: [path.join(here, "../src/api.js")],
    bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
    define: { "import.meta.env.VITE_API_BASE": '""', "import.meta.env": "{}" },
  });
  tmpFile = path.join(os.tmpdir(), `api-login-sesi-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(tmpFile, hasil.outputFiles[0].text);
  ({ api } = await import(pathToFileURL(tmpFile).href));
});
after(() => { try { fs.unlinkSync(tmpFile); } catch { /* sudah hilang */ } });
beforeEach(() => { store.clear(); authErrorEvents.length = 0; calls = []; });

// ── login (endpoint publik) ────────────────────────────────────────────────────
test("login 401 (kredensial salah): galat biasa dengan pesan server, TANPA event auth-error, token lama tak disentuh, header Authorization tak dikirim", async () => {
  localStorage.setItem("token", "token-basi");
  pasangFetch(() => json(401, { error: "Email atau password salah" }));
  await assert.rejects(api.login("a@b.c", "salah"), (e) => {
    assert.equal(e.message, "Email atau password salah");
    assert.equal(e.status, 401);
    return true;
  });
  assert.equal(authErrorEvents.length, 0, "401 login tidak boleh memunculkan dialog Sesi Berakhir");
  assert.equal(localStorage.getItem("token"), "token-basi");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(authHeaderDari(calls[0]), null, "login tidak membawa token lama");
});

test("login 401 lalu dicoba lagi dengan kredensial benar: percobaan kedua berhasil (tidak ada status yang tertinggal)", async () => {
  let n = 0;
  pasangFetch(() => (++n === 1 ? json(401, { error: "Email atau password salah" }) : json(200, { token: "T-baru", user: USER })));
  await assert.rejects(api.login("a@b.c", "salah"), /Email atau password salah/);
  const ok = await api.login("a@b.c", "benar");
  assert.equal(ok.token, "T-baru");
  assert.deepEqual(ok.user, USER);
  assert.equal(authErrorEvents.length, 0);
  assert.equal(calls.length, 2);
});

test("login berhasil: mengembalikan token+user dan tidak membuka dialog", async () => {
  pasangFetch(() => json(200, { token: "T1", user: USER }));
  const r = await api.login("a@b.c", "benar");
  assert.equal(r.token, "T1");
  assert.equal(authErrorEvents.length, 0);
});

test("login 429 (batas percobaan): pesan + code RATE_LIMITED apa adanya, tanpa event auth-error", async () => {
  pasangFetch(() => json(429, { error: "Terlalu banyak percobaan login yang gagal. Coba lagi beberapa menit lagi.", code: "RATE_LIMITED", retryAfterSeconds: 600 }));
  await assert.rejects(api.login("a@b.c", "x"), (e) => {
    assert.match(e.message, /Terlalu banyak percobaan login/);
    assert.equal(e.status, 429);
    assert.equal(e.code, "RATE_LIMITED");
    return true;
  });
  assert.equal(authErrorEvents.length, 0);
});

test("login 500: pesan server apa adanya, tidak diulang otomatis (POST), tanpa event auth-error", async () => {
  pasangFetch(() => json(500, { error: "Server error: db" }));
  await assert.rejects(api.login("a@b.c", "x"), (e) => e.status === 500 && /Server error/.test(e.message));
  assert.equal(calls.length, 1, "POST login tidak boleh dikirim ulang otomatis");
  assert.equal(authErrorEvents.length, 0);
});

test("login saat jaringan putus: galat diteruskan apa adanya, tidak diulang, tanpa event auth-error", async () => {
  pasangFetch(() => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(api.login("a@b.c", "x"), TypeError);
  assert.equal(calls.length, 1);
  assert.equal(authErrorEvents.length, 0);
});

// ── request terautentikasi: penanganan sesi kedaluwarsa tetap berjalan ──────────
test("request terautentikasi dibalas 401 dengan token yang masih aktif: sesi dibatalkan (token dihapus + SATU event auth-error)", async () => {
  localStorage.setItem("token", "T-sesi");
  pasangFetch(() => json(401, { error: "Sesi tidak valid, silakan login ulang", code: "TOKEN_INVALID" }));
  await assert.rejects(api.getMyPortals(), /Sesi berakhir, silakan login kembali/);
  assert.equal(authErrorEvents.length, 1);
  assert.equal(localStorage.getItem("token"), null);
  assert.equal(authHeaderDari(calls[0]), "Bearer T-sesi");
});

test("fetch mentah terautentikasi (PDF) dibalas 401 dengan token aktif: sesi dibatalkan", async () => {
  localStorage.setItem("token", "T-sesi");
  pasangFetch(() => json(401, { error: "Belum login" }));
  await assert.rejects(api.getOrderInvoicePdf("o1"), /Sesi berakhir/);
  assert.equal(authErrorEvents.length, 1);
  assert.equal(localStorage.getItem("token"), null);
});

test("unggah XHR dibalas 401 dengan token aktif: sesi dibatalkan", async () => {
  class FakeXHR {
    constructor() { FakeXHR.last = this; this.upload = {}; this.hdr = {}; }
    open() {}
    setRequestHeader(k, v) { this.hdr[k] = v; }
    send() {}
  }
  globalThis.XMLHttpRequest = FakeXHR;
  localStorage.setItem("token", "T-sesi");
  const p = api.uploadProductionV2Evidence("r1", []);
  const x = FakeXHR.last;
  assert.equal(x.hdr.Authorization, "Bearer T-sesi");
  x.status = 401; x.responseText = JSON.stringify({ error: "Belum login" }); x.onload();
  await assert.rejects(p, (e) => e.status === 401);
  assert.equal(authErrorEvents.length, 1);
  assert.equal(localStorage.getItem("token"), null);
});

test("429/500/jaringan putus pada request terautentikasi: galat biasa, sesi TIDAK dibatalkan", async () => {
  localStorage.setItem("token", "T-sesi");
  pasangFetch(() => json(429, { error: "Terlalu banyak permintaan.", code: "RATE_LIMITED" }));
  await assert.rejects(api.getMyPortals(), (e) => e.status === 429);
  pasangFetch(() => json(500, { error: "boom" }));
  await assert.rejects(api.getMyPortals(), (e) => e.status === 500);
  pasangFetch(() => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(api.login("a@b.c", "x"), TypeError);
  assert.equal(authErrorEvents.length, 0);
  assert.equal(localStorage.getItem("token"), "T-sesi");
});

// ── 401 terlambat dari sesi lama tidak boleh menimpa login baru ────────────────
test("401 terlambat dari request berangkat-token-lama, setelah login baru berhasil: token baru utuh, TIDAK ada event", async () => {
  localStorage.setItem("token", "T-lama");
  const d = tertunda();
  pasangFetch(() => d.p);
  const lama = api.getMyPortals();
  const lamaDitolak = assert.rejects(lama, /Sesi berakhir/);
  // pengguna login ulang (Login.jsx menyimpan token baru) selagi request lama masih di jaringan
  localStorage.setItem("token", "T-baru");
  d.selesai(json(401, { error: "Sesi tidak valid, silakan login ulang", code: "TOKEN_INVALID" }));
  await lamaDitolak;
  assert.equal(localStorage.getItem("token"), "T-baru", "token login baru tidak boleh terhapus");
  assert.equal(authErrorEvents.length, 0, "dialog Sesi Berakhir tidak boleh muncul di atas sesi baru");
});

test("401 terlambat dari request yang berangkat TANPA token, setelah login: diabaikan", async () => {
  const d = tertunda();
  pasangFetch(() => d.p);
  const tanpaToken = api.getMyPortals();
  const ditolak = assert.rejects(tanpaToken, /Sesi berakhir/);
  localStorage.setItem("token", "T-baru");
  d.selesai(json(401, { error: "Belum login" }));
  await ditolak;
  assert.equal(localStorage.getItem("token"), "T-baru");
  assert.equal(authErrorEvents.length, 0);
});

test("fetch mentah (PDF) berangkat-token-lama lalu 401 terlambat setelah login baru: diabaikan", async () => {
  localStorage.setItem("token", "T-lama");
  const d = tertunda();
  pasangFetch(() => d.p);
  const lama = api.getOrderInvoicePdf("o1");
  const ditolak = assert.rejects(lama, /Sesi berakhir/);
  localStorage.setItem("token", "T-baru");
  d.selesai(json(401, { error: "Sesi tidak valid" }));
  await ditolak;
  assert.equal(localStorage.getItem("token"), "T-baru");
  assert.equal(authErrorEvents.length, 0);
});

test("token digeser server (X-Refreshed-Token) lalu 401 terlambat dari token sebelumnya: sesi yang masih sah tidak dibatalkan", async () => {
  const T1 = jwtPalsu(SEKARANG + 100), T2 = jwtPalsu(SEKARANG + 200);
  localStorage.setItem("token", T1);
  const lambat = tertunda();
  let n = 0;
  pasangFetch(() => (++n === 1 ? lambat.p : json(200, {}, { "X-Refreshed-Token": T2 })));
  const p1 = api.getMyPortals();
  const p1Ditolak = assert.rejects(p1, /Sesi berakhir/);
  await api.getMyPortals(); // respons ini membawa token baru → disimpan
  assert.equal(localStorage.getItem("token"), T2);
  lambat.selesai(json(401, { error: "Sesi tidak valid" }));
  await p1Ditolak;
  assert.equal(localStorage.getItem("token"), T2);
  assert.equal(authErrorEvents.length, 0);
});

test("setelah keluar (token dihapus), 401 yang masih di jaringan tidak memunculkan dialog di layar login", async () => {
  localStorage.setItem("token", "T-lama");
  const d = tertunda();
  pasangFetch(() => d.p);
  const p = api.getMyPortals();
  const ditolak = assert.rejects(p, /Sesi berakhir/);
  localStorage.removeItem("token"); // App.handleLogout
  d.selesai(json(401, { error: "Sesi tidak valid" }));
  await ditolak;
  assert.equal(authErrorEvents.length, 0);
});

// ── token geser (X-Refreshed-Token): hanya diterima untuk token yang masih aktif ─────────────────────────────────────
// Semua jalur yang membaca header ini: request biasa, form-data, dan fetch langsung (export). Satu tabel supaya jalur baru
// yang lupa memeriksa token-kirim langsung terlihat.
const JALUR_TOKEN_GESER = [
  ["request biasa", () => api.getMyPortals()],
  ["form-data", () => api.proposeScopeRevision("u1", new FormData())],
  ["fetch langsung: export laporan Production", () => api.exportProductionReport("report=summary")],
  ["fetch langsung: export Finance", () => api.exportFinanceExcel("kas", {})],
  ["fetch langsung: export laporan divisi", () => api.exportLaporanDivisi({})],
];

for (const [nama, panggil] of JALUR_TOKEN_GESER) {
  test(`token geser — ${nama}: sesi aktif tetap menerima token baru`, async () => {
    const aktif = jwtPalsu(SEKARANG + 100), geser = jwtPalsu(SEKARANG + 200);
    localStorage.setItem("token", aktif);
    pasangFetch(() => json(200, {}, { "X-Refreshed-Token": geser }));
    await panggil();
    assert.equal(localStorage.getItem("token"), geser);
    assert.equal(authErrorEvents.length, 0);
  });

  test(`token geser — ${nama}: 200 terlambat dari token lama TIDAK menimpa token login baru`, async () => {
    localStorage.setItem("token", "T-lama");
    const d = tertunda();
    pasangFetch(() => d.p);
    const lama = panggil().catch((e) => e);
    localStorage.setItem("token", "T-baru"); // login ulang berhasil selagi request lama di jaringan
    d.selesai(json(200, {}, { "X-Refreshed-Token": "T-geser-dari-sesi-lama" }));
    await lama;
    assert.equal(localStorage.getItem("token"), "T-baru");
    assert.equal(authErrorEvents.length, 0);
  });

  test(`token geser — ${nama}: respons terlambat setelah keluar (token dihapus) tidak menghidupkan sesi lagi`, async () => {
    localStorage.setItem("token", "T-lama");
    const d = tertunda();
    pasangFetch(() => d.p);
    const lama = panggil().catch((e) => e);
    localStorage.removeItem("token"); // App.handleLogout
    d.selesai(json(200, {}, { "X-Refreshed-Token": "T-geser-dari-sesi-lama" }));
    await lama;
    assert.equal(localStorage.getItem("token"), null);
  });
}

test("token geser: request yang berangkat TANPA token tidak pernah boleh menyimpan token geser", async () => {
  const d = tertunda();
  pasangFetch(() => d.p);
  const p = api.getMyPortals().catch((e) => e);
  d.selesai(json(200, {}, { "X-Refreshed-Token": "T-asing" }));
  await p;
  assert.equal(localStorage.getItem("token"), null);
});

test("token geser: dua request token-sama, geser pertama diterima, header geser kedua dari token usang tidak menimpa", async () => {
  const T1 = jwtPalsu(SEKARANG + 100), T2 = jwtPalsu(SEKARANG + 200), usang = jwtPalsu(SEKARANG + 50);
  localStorage.setItem("token", T1);
  const kedua = tertunda();
  let n = 0;
  pasangFetch(() => (++n === 1 ? json(200, {}, { "X-Refreshed-Token": T2 }) : kedua.p));
  const a = api.getMyPortals();
  const b = api.getMyPortals().catch((e) => e);
  await a;
  assert.equal(localStorage.getItem("token"), T2);
  kedua.selesai(json(200, {}, { "X-Refreshed-Token": usang }));
  await b;
  assert.equal(localStorage.getItem("token"), T2);
});

// ── token geser LAMA yang diputar ulang cache HTTP (respons 304) — akar "Sesi Berakhir" berulang setelah login (14 Okt 2026) ──
// Browser menyerahkan ke fetch() respons gabungan dari entri cache lama, lengkap dengan X-Refreshed-Token yang tersimpan dari
// beberapa hari lalu. Request-nya sendiri sah (berangkat dengan token aktif), jadi pemeriksaan "token-kirim masih aktif" saja lolos.
for (const [nama, panggil] of JALUR_TOKEN_GESER) {
  test(`replay cache — ${nama}: token geser LAMA (exp lebih kecil) dari entri cache tidak menimpa token login baru`, async () => {
    const baru = jwtPalsu(SEKARANG + 7 * 86400), lamaKedaluwarsa = jwtPalsu(SEKARANG - 3600);
    localStorage.setItem("token", baru);
    pasangFetch(() => json(200, {}, { "X-Refreshed-Token": lamaKedaluwarsa }));
    await panggil();
    assert.equal(localStorage.getItem("token"), baru);
    assert.equal(authErrorEvents.length, 0);
  });
}

test("alur lengkap: login baru → /auth/me ber-304 membawa token geser lama → request berikutnya tetap memakai token login baru dan sesi tidak dibatalkan", async () => {
  const baru = jwtPalsu(SEKARANG + 7 * 86400), lama = jwtPalsu(SEKARANG - 3600);
  pasangFetch((url, init) => {
    const auth = init.headers?.Authorization;
    if (auth !== `Bearer ${baru}`) return json(401, { error: "Sesi tidak valid, silakan login ulang", code: "TOKEN_INVALID" });
    return url.endsWith("/auth/me") ? json(200, {}, { "X-Refreshed-Token": lama }) : json(200, []);
  });
  localStorage.setItem("token", baru); // Login.jsx menyimpan token hasil login
  await api.getMyPortals();              // Portal/Layout: dijawab 304 → header geser lama dari cache
  await api.getMyPortals();              // Layout memanggil lagi
  await api.getAnalyticsOverview({});    // Dashboard
  assert.equal(localStorage.getItem("token"), baru);
  assert.equal(authErrorEvents.length, 0);
  assert.equal(calls.every((c) => authHeaderDari(c) === `Bearer ${baru}`), true, "semua request memakai token login baru");
});

test("bolehAdopsiTokenGeser: hanya token yang lebih panjang umurnya, pengguna sama, terbaca; selain itu ditolak", () => {
  const aktif = jwtPalsu(SEKARANG + 100);
  assert.equal(bolehAdopsiTokenGeser(aktif, jwtPalsu(SEKARANG + 101)), true);
  assert.equal(bolehAdopsiTokenGeser(aktif, jwtPalsu(SEKARANG + 100)), false, "exp sama = bukan lebih baru");
  assert.equal(bolehAdopsiTokenGeser(aktif, jwtPalsu(SEKARANG + 99)), false);
  assert.equal(bolehAdopsiTokenGeser(aktif, jwtPalsu(SEKARANG + 999, "u2")), false, "pengguna lain");
  assert.equal(bolehAdopsiTokenGeser(aktif, aktif), false);
  for (const rusak of [null, undefined, "", "bukan-jwt", "a.b.c", "a.b", `${b64u({})}.${b64u({ id: "u1" })}.s`]) {
    assert.equal(bolehAdopsiTokenGeser(aktif, rusak), false, String(rusak));
    assert.equal(bolehAdopsiTokenGeser(rusak, jwtPalsu(SEKARANG + 999)), false, "aktif rusak: " + String(rusak));
  }
  assert.equal(klaimToken("bukan-jwt"), null);
  assert.equal(klaimToken(jwtPalsu(5, "u9")).id, "u9");
});

// ── pagar kode: App.jsx / Login.jsx / api.js ───────────────────────────────────
test("api.js: tidak ada lagi handleUnauthorized() tanpa token-kirim, dan login memakai jalur publik", () => {
  const api_ = src("api.js");
  assert.doesNotMatch(api_, /handleUnauthorized\(\)/, "setiap 401 harus meneruskan token yang dikirim");
  assert.match(api_, /login: \(email, password\) =>\s*request\("\/auth\/login", \{ method: "POST", publik: true,/);
  assert.match(api_, /if \(res\.status === 401 && !publik\)/);
});

test("App.jsx: event auth-error hanya didengar selama ada sesi; dialog hanya terbuka lewat sessionExpired; login baru menutupnya", () => {
  const app = src("App.jsx").replace(/\r\n/g, "\n");
  assert.match(app, /const adaSesi = Boolean\(user\);\n\s*useEffect\(\(\) => \{\n\s*if \(!adaSesi\) return;[\s\S]*?addEventListener\("auth-error", handler\)[\s\S]*?\}, \[adaSesi\]\);/);
  assert.match(app, /open=\{sessionExpired\}/);
  assert.match(app, /function handleLogin\(u\) \{[\s\S]*?setSessionExpired\(false\);/);
});

test("Login.jsx: tidak memicu sesi-berakhir sendiri; galat login hanya tampil di form; input tak pernah dinonaktifkan", () => {
  const login = src("pages/Login.jsx");
  assert.doesNotMatch(login, /auth-error|handleUnauthorized|sessionExpired/);
  assert.match(login, /await api\.login\(email, password\)/);
  assert.match(login, /catch \(err\) \{\s*setError\(err\.message\);/);
  // hanya tombol submit yang boleh disabled saat memuat; field email/password tetap bisa diketik
  assert.equal((login.match(/disabled=/g) || []).length, 1);
  assert.match(login, /disabled=\{loading\}/);
});

test("dialog Sesi Berakhir di-portal ke <body> (bukan .app-shell yang ikut dibongkar bersama Layout) — kalau tidak, dialog tak terlihat tetapi body terkunci", () => {
  const app = src("App.jsx").replace(/\r\n/g, "\n");
  const modal = src("components/ui/modal.jsx").replace(/\r\n/g, "\n");
  assert.match(app, /open=\{sessionExpired\}[\s\S]{0,120}?portalToBody/);
  assert.match(modal, /portalToBody = false/);
  assert.match(modal, /const glassContainer = !portalToBody && typeof document/);
});
