// Uji browser rilis OFF: SANSS kandidat (HUB_SSO_ENABLED=false) + HUB dari
// CONTAINER compose final (SANSS_SSO_ENABLED=false, HUB_RESOURCE_ACL_ENABLED=false)
// di belakang proxy TLS same-domain. Hanya skenario yang relevan untuk keadaan mati.
//
//   STAGE5_HUB_PORT=3100 node setup-proxy.mjs up      (proxy menunjuk container HUB)
//   STAGE5_HUB_PORT=3100 node off-check.mjs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // sertifikat proxy lokal self-signed, sama seperti rehearsal.mjs
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as A from "./run-apps.mjs";

const results = [];
const check = (cond, name, detail) => { results.push({ ok: !!cond }); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };
const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", shell: true });
const parseResult = (out) => { const l = out.split(/\r?\n/).find((x) => x.startsWith("RESULT:")); return l ? JSON.parse(l.slice(7)) : null; };
const SHOTS = path.join(os.tmpdir(), "sso-off-check");
fs.mkdirSync(SHOTS, { recursive: true });
const HUB_TEXT = /Task & Meeting|Tugas Saya|Hasil Meeting|Pantauan Leader/;
const ERROR_TEXT = /tidak tersedia|tidak dapat dihubungi|Gagal memuat|Terjadi kesalahan/i;
async function until(cond, ms, label) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 100)); }
  console.log(`  (menunggu ${label}: batas ${ms} ms habis)`);
  return false;
}

async function main() {
  console.log("== Pasangan DB staging ==");
  const pairArgs = [`"${A.SANSS_DB}"`, `"${A.HUB_DB}"`];
  const pair = parseResult(sh("node", ["scripts/stage5-rehearsal/staging-pair.mjs", "check", ...pairArgs, `"${A.HUB_DIR}"`], A.SANSS_DIR));
  console.log("pasangan:", pair);
  sh("node", ["scripts/stage5-rehearsal/staging-db.mjs", "create"], A.SANSS_DIR);
  sh("node", ["scripts/stage5-rehearsal/staging-db.mjs", "migrate"], A.SANSS_DIR);
  sh("node", ["scripts/stage5-rehearsal/staging-db.mjs", "create"], A.HUB_DIR);
  if (pair?.state === "fresh") console.log("penanda:", parseResult(sh("node", ["scripts/stage5-rehearsal/staging-pair.mjs", "mark", ...pairArgs], A.SANSS_DIR)));
  sh("node", ["scripts/stage5-rehearsal/staging-db.mjs", "migrate"], A.HUB_DIR);
  const seed = parseResult(sh("node", ["scripts/stage5-rehearsal/staging-seed.mjs", A.SANSS_DB], A.SANSS_DIR));

  console.log("\n== Boot: SANSS kandidat flag OFF; HUB = container compose ==");
  check(await A.startSanss({ HUB_SSO_ENABLED: "false" }), "SANSS kandidat boot dengan HUB_SSO_ENABLED=false");
  const hubHealth = await fetch(`http://127.0.0.1:${A.HUB_PORT}/workspace/api/health`).then((r) => r.status).catch((e) => e.message);
  check(hubHealth === 200, "HUB container compose sehat di /workspace/api/health", String(hubHealth));

  console.log("\n== Akses SSO ditolak ==");
  for (const [m, u] of [["GET", "/workspace/sso/start"], ["POST", "/workspace/sso/callback"], ["POST", "/workspace/api/sso/revoke"], ["POST", "/workspace/api/sso/summary"], ["POST", "/api/hub/internal/introspect"], ["POST", "/api/hub/internal/exchange"]]) {
    const r = await fetch(`${A.PUBLIC}${u}`, { method: m, redirect: "manual", headers: { "content-type": "application/json" }, body: m === "POST" ? "{}" : undefined });
    check(r.status === 404, `publik ${m} ${u} -> 404`, `status=${r.status}`);
  }

  const browser = await chromium.launch();
  async function login(email) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    const hubCalls = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    page.on("response", (r) => { if (/\/api\/hub\//.test(r.url())) hubCalls.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    await page.goto(`${A.PUBLIC}/login`, { waitUntil: "load" });
    await page.locator('input[type="email"], input[name="email"]').first().fill(email);
    await page.locator('input[type="password"], input[name="password"]').first().fill(seed.password);
    await page.locator('button[type="submit"], button:has-text("Masuk")').first().click();
    await page.waitForLoadState("networkidle").catch(() => {});
    return { ctx, page, pageErrors, hubCalls };
  }

  try {
    for (const [label, email] of [["OWNER", seed.owner.email], ["ADMIN", seed.adminActor.email]]) {
      console.log(`\n== Main Hub ${label} (flag OFF) ==`);
      const s = await login(email);
      await s.page.waitForURL(/\/portal$/, { timeout: 15000 }).catch(() => {});
      await s.page.locator('[data-testid="portal-kartu"] .ap-widget').first().waitFor({ timeout: 15000 }).catch(() => {});
      // Sistem tab dalam-app (D-144) memakai lokasi virtual: address bar bisa tetap /login. Nilai tab aktif + isi, bukan URL.
      const tabAktif = await s.page.locator('[role="tab"][aria-selected="true"], .tab-aktif, [data-active="true"]').first().innerText().catch(() => "");
      const adaPortal = await s.page.locator('[data-testid="portal-kartu"]').count();
      check(adaPortal === 1 && (/Portal/.test(tabAktif) || /\/portal$/.test(s.page.url())), `${label}: Main Hub (Portal) yang tampil setelah login`, `tab=${tabAktif || "?"} url=${s.page.url()}`);
      // Widget Main Hub memanggil /hub/summary/me dan /hub/summary/leaders secara async: nilai DOM SESUDAH keduanya dijawab.
      await until(() => s.hubCalls.length >= 2, 15000, "dua panggilan /api/hub/summary");
      await s.page.waitForLoadState("networkidle").catch(() => {});
      const portals = await s.page.evaluate(async () => {
        const r = await fetch("/api/auth/me", { headers: { authorization: `Bearer ${localStorage.getItem("token")}` } });
        return r.ok ? (await r.json()) : null;
      });
      const list = Array.isArray(portals) ? portals : portals?.portals ?? [];
      check(list.length > 1 && !list.some((p) => p.key === "hub"), `${label}: daftar portal dari server tanpa kartu 'hub'`, list.map((p) => p.key).join(","));
      const cards = await s.page.locator('[data-testid="portal-kartu"] .ap-widget').count();
      check(cards === list.length, `${label}: jumlah kartu workspace = jumlah portal server (${list.length})`, `kartu=${cards}`);
      check(await s.page.locator("header.ap-kepala h1").innerText().then((t) => /^Halo/.test(t)).catch(() => false), `${label}: sambutan Main Hub normal`);
      const body = await s.page.locator("main, body").first().innerText();
      check(!HUB_TEXT.test(body), `${label}: tidak ada kartu/widget HUB (Task & Meeting / Tugas Saya / Hasil Meeting / Pantauan Leader)`, (body.match(HUB_TEXT) || [""])[0]);
      check(await s.page.locator(".ap-panel").count() === 0, `${label}: tidak ada panel widget Main Hub (.ap-panel)`);
      check(!ERROR_TEXT.test(body), `${label}: tidak ada teks galat di Main Hub`, (body.match(ERROR_TEXT) || [""])[0]);
      check(s.hubCalls.length > 0 && s.hubCalls.every((c) => c.startsWith("404 ")), `${label}: panggilan /api/hub/* dijawab 404 dan disembunyikan UI`, s.hubCalls.join(" | "));
      check(s.pageErrors.length === 0, `${label}: tanpa galat JavaScript`, s.pageErrors.join(" | "));
      await s.page.screenshot({ path: path.join(SHOTS, `portal-${label}.png`), fullPage: true });

      if (label === "OWNER") {
        const token = await s.page.evaluate(() => localStorage.getItem("token"));
        const r = await fetch(`${A.PUBLIC}/api/hub/handoff`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ destination: "/meetings", stateHash: "a".repeat(64) }) });
        check(r.status === 404, "OWNER (token sah): POST /api/hub/handoff -> 404", `status=${r.status}`);
        const posted = [];
        s.page.on("request", (q) => { if (q.method() === "POST" && q.url().includes("/workspace/sso/callback")) posted.push(q.url()); });
        await s.page.goto(`${A.PUBLIC}/hub/launch?state_hash=${"b".repeat(64)}&next=%2Fmeetings`, { waitUntil: "networkidle" });
        await s.page.getByText(/tidak dapat dihubungi|tidak punya akses|Tautan tidak lengkap/).first().waitFor({ timeout: 15000 }).catch(() => {});
        const t = await s.page.locator("body").innerText();
        check(s.page.url().startsWith(`${A.PUBLIC}/hub/launch`) && posted.length === 0, "OWNER: /hub/launch tidak meneruskan ke HUB (tanpa POST /workspace/sso/callback)", s.page.url());
        check(/Tidak bisa membuka Task & Meeting/.test(t) && /tidak dapat dihubungi|tidak punya akses/.test(t) && !/Tautan tidak lengkap/.test(t), "OWNER: /hub/launch (parameter sah) memanggil handoff, dapat 404, menampilkan penolakan jelas", t.slice(0, 120).replace(/\s+/g, " "));
        await s.page.screenshot({ path: path.join(SHOTS, "hub-launch-OWNER.png"), fullPage: true });
        const before = s.pageErrors.length;
        await s.page.goto(`${A.PUBLIC}/portal`, { waitUntil: "networkidle" });
        check(s.pageErrors.length === before, "OWNER: kembali ke Main Hub tanpa galat");
      }
      await s.ctx.close();
    }

    console.log("\n== Pengguna lain (flag OFF) ==");
    for (const [label, email] of [["leaderA (SALES+HUB_MEMBER)", seed.leaderA.email], ["SALES biasa", seed.sales.email]]) {
      const s = await login(email);
      await until(() => !/\/(login|portal)$/.test(s.page.url()), 15000, "pengalihan portal tunggal");
      await s.page.waitForLoadState("networkidle").catch(() => {});
      check(!/\/portal$/.test(s.page.url()) && !s.page.url().includes("/workspace"), `${label}: satu portal operasional -> langsung ke workspace-nya (tidak tertahan di Main Hub, tidak ke HUB)`, s.page.url());
      const body = await s.page.locator("body").innerText();
      check(!/Task & Meeting|Tugas Saya|Pantauan Leader/.test(body), `${label}: tidak ada elemen HUB`);
      check(s.pageErrors.length === 0, `${label}: tanpa galat JavaScript`, s.pageErrors.join(" | "));
      await s.ctx.close();
    }

    console.log("\n== HUB langsung (tanpa sesi) ==");
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const p = await ctx.newPage();
    await p.goto(`${A.PUBLIC}/workspace/my-tasks`, { waitUntil: "load" });
    check(/\/workspace\/login/.test(p.url()), "HUB /workspace/my-tasks tanpa sesi -> /workspace/login", p.url());
    const lt = await p.locator("body").innerText();
    check(!/Google/i.test(lt) && (await p.locator('button:has-text("Google"), form[action*="signin"]').count()) === 0, "HUB /workspace/login tanpa tombol masuk (Google mati, SSO mati)", lt.slice(0, 120).replace(/\s+/g, " "));
    const prov = await fetch(`${A.PUBLIC}/workspace/api/auth/providers`).then((r) => r.json()).catch(() => null);
    check(prov && Object.keys(prov).length === 0, "HUB /workspace/api/auth/providers kosong", JSON.stringify(prov));
    await p.screenshot({ path: path.join(SHOTS, "hub-login.png"), fullPage: true });
    await ctx.close();
  } finally {
    await browser.close();
    await A.stopAll();
  }
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass}/${results.length} lulus — screenshot: ${SHOTS}`);
  process.exit(pass === results.length ? 0 : 1);
}
main().catch(async (e) => { console.error("GAGAL TOTAL:", e); await A.stopAll().catch(() => {}); process.exit(1); });
