// Rehearsal staging SSO Task & Meeting — Tahap 5. Satu proses panjang
// (bukan beberapa invocation Node terpisah) supaya server anak yang
// di-spawn tetap hidup sepanjang seluruh skenario, termasuk Playwright.
//
// Reusable, TANPA rahasia tertanam: semua token/secret dibuat acak saat
// jalan (lihat run-apps.mjs). Variabel topologi (port, DB, origin publik)
// ada di run-apps.mjs — ubah di sana untuk lingkungan lain.
// Sertifikat self-signed (rehearsal lokal saja) — Node fetch() biasa (BUKAN
// Playwright, yang sudah ignoreHTTPSErrors per-context) perlu ini supaya bisa
// memanggil https://localhost:8443/9443 langsung dari skrip ini sendiri.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { chromium } from "playwright";
import * as A from "./run-apps.mjs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const SANSS_DIR = A.SANSS_DIR;
const HUB_DIR = A.HUB_DIR;

const results = [];
function check(cond, name, detail) {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}
function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", shell: true });
}
function parseResult(out) {
  const line = out.split(/\r?\n/).find((l) => l.startsWith("RESULT:"));
  return line ? JSON.parse(line.slice("RESULT:".length)) : null;
}

async function main() {
  // ═══ -1. Provisioning database staging (idempoten) ══════════════════════
  // create+migrate aman dipanggil berkali-kali (lihat scripts/stage5-rehearsal/staging-db.mjs) —
  // kalau database sudah ada & sudah bermigrasi, ini cuma memverifikasi.
  console.log("== Provisioning database staging ==");
  sh("node", ["scripts/stage5-rehearsal/staging-db.mjs", "create"], SANSS_DIR);
  sh("node", ["scripts/stage5-rehearsal/staging-db.mjs", "migrate"], SANSS_DIR);
  sh("node", ["scripts/stage5-rehearsal/staging-db.mjs", "create"], HUB_DIR);
  const hubMigrate = parseResult(sh("node", ["scripts/stage5-rehearsal/staging-db.mjs", "migrate"], HUB_DIR));
  if (hubMigrate?.workspaceId) A.setHubWorkspaceId(hubMigrate.workspaceId);
  console.log("HUB_WORKSPACE_ID:", A.HUB_WORKSPACE_ID);

  // ═══ 0. Seed data staging (idempoten — aman dijalankan ulang) ═══════════
  console.log("== Seed data staging ==");
  const seed = parseResult(sh("node", ["scripts/stage5-rehearsal/staging-seed.mjs", A.SANSS_DB], SANSS_DIR));
  const hubSeed = parseResult(sh("node", ["scripts/stage5-rehearsal/staging-seed.mjs", A.HUB_DB, A.HUB_WORKSPACE_ID], HUB_DIR));
  console.log("seed:", seed, hubSeed);

  // ═══ 1. BOOKEND AWAL — kedua flag OFF ═══════════════════════════════════
  console.log("\n== BOOKEND AWAL: kedua flag OFF ==");
  check(await A.startSanss({ HUB_SSO_ENABLED: "false" }), "boot SANSS (flag OFF)");
  check(await A.startHub({ SANSS_SSO_ENABLED: "false" }), "boot HUB (flag OFF)");
  let r = await fetch(`http://127.0.0.1:${A.SANSS_PORT}/api/hub/handoff`, { method: "POST", headers: { authorization: "Bearer x", "content-type": "application/json" }, body: "{}" });
  check(r.status === 404, "bookend-awal: SANSS /api/hub/handoff -> 404", `status=${r.status}`);
  r = await fetch(`http://127.0.0.1:${A.HUB_PORT}/workspace/sso/start`, { redirect: "manual" });
  check(r.status === 404, "bookend-awal: HUB /sso/start -> 404", `status=${r.status}`);
  await A.stopAll();

  // ═══ 2. Nyalakan kedua flag (HANYA staging) ═════════════════════════════
  console.log("\n== Nyalakan kedua flag (staging) ==");
  check(await A.startSanss({ HUB_SSO_ENABLED: "true" }), "boot SANSS (flag ON)");
  check(await A.startHub({ SANSS_SSO_ENABLED: "true" }), "boot HUB (flag ON)");

  // ── Endpoint internal: diblokir publik, bisa langsung antarlayanan ──────
  r = await fetch(`${A.PUBLIC}/api/hub/internal/introspect`, { method: "POST", headers: { "x-hub-service-token": A.SHARED_TOKEN, "content-type": "application/json" }, body: JSON.stringify({ sub: "x" }) });
  check(r.status === 404, "proxy publik 8443 MEMBLOKIR /api/hub/internal/* -> 404", `status=${r.status}`);
  r = await fetch(`http://127.0.0.1:${A.SANSS_PORT}/api/hub/internal/introspect`, { method: "POST", headers: { "x-hub-service-token": A.SHARED_TOKEN, "content-type": "application/json" }, body: JSON.stringify({ sub: "x" }) });
  check(r.status === 200, "langsung ke backend (bypass proxy) /api/hub/internal/introspect -> TETAP bisa", `status=${r.status}`);
  r = await fetch(`${A.PUBLIC}/workspace/api/sso/revoke`, { method: "POST", headers: { "x-hub-service-token": A.SHARED_TOKEN, "content-type": "application/json" }, body: JSON.stringify({ sub: "x" }) });
  check(r.status === 404, "proxy publik 8443 MEMBLOKIR (path /workspace) /api/sso/revoke -> 404", `status=${r.status}`);
  r = await fetch(`http://127.0.0.1:${A.HUB_PORT}/workspace/api/sso/revoke`, { method: "POST", headers: { "x-hub-service-token": A.SHARED_TOKEN, "content-type": "application/json" }, body: JSON.stringify({ sub: "x" }) });
  check(r.status === 200, "langsung ke backend (bypass proxy) /api/sso/revoke -> TETAP bisa", `status=${r.status}`);
  r = await fetch(`${A.PUBLIC}/workspace/api/sso/summary`, { method: "POST", headers: { "x-hub-service-token": A.SHARED_TOKEN, "content-type": "application/json" }, body: JSON.stringify({ subs: ["x"] }) });
  check(r.status === 404, "proxy publik 8443 MEMBLOKIR (path /workspace) /api/sso/summary -> 404", `status=${r.status}`);
  r = await fetch(`http://127.0.0.1:${A.HUB_PORT}/workspace/api/sso/summary`, { method: "POST", headers: { "x-hub-service-token": A.SHARED_TOKEN, "content-type": "application/json" }, body: JSON.stringify({ subs: ["x"] }) });
  check(r.status === 200, "langsung ke backend (bypass proxy) /api/sso/summary -> TETAP bisa", `status=${r.status}`);

  // ═══ 3. Playwright — browser SUNGGUHAN, TLS asli (cert self-signed diizinkan) ═══
  console.log("\n== Playwright: browser sungguhan ==");
  const browser = await chromium.launch();
  const leakSecrets = [A.SHARED_TOKEN];

  async function loginViaUI(context, email, password) {
    const page = await context.newPage();
    await page.goto(`${A.PUBLIC}/login`, { waitUntil: "load" });
    await page.fill('input[type="email"], input[name="email"]', email).catch(async () => {
      await page.locator("input").first().fill(email);
    });
    await page.fill('input[type="password"], input[name="password"]', password).catch(async () => {
      await page.locator("input").nth(1).fill(password);
    });
    await page.locator('button[type="submit"], button:has-text("Masuk")').first().click();
    await page.waitForLoadState("networkidle").catch(() => {});
    return page;
  }

  // ── OWNER: full launch -> HUB /meetings ─────────────────────────────────
  const ctxOwner = await browser.newContext({ ignoreHTTPSErrors: true });
  let page = await loginViaUI(ctxOwner, seed.owner.email, seed.password);
  await page.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
  const hubCard = page.locator('text="Task & Meeting"').first();
  await hubCard.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  check(await hubCard.count() > 0, "1. OWNER: kartu 'Task & Meeting' tampil di /portal (browser nyata)");
  await Promise.all([page.waitForURL(`${A.PUBLIC}/workspace/meetings`, { timeout: 20000 }).catch(() => {}), hubCard.click()]);
  await page.waitForLoadState("networkidle").catch(() => {});
  const finalUrl1 = page.url();
  check(finalUrl1 === `${A.PUBLIC}/workspace/meetings`, "1. OWNER: mendarat di HUB /meetings (browser nyata)", finalUrl1);
  check(!finalUrl1.includes("code=") && !finalUrl1.includes("state"), "11. URL akhir TIDAK memuat code/state", finalUrl1);

  // ── Cookie attributes (Secure/HttpOnly/SameSite) — browser nyata ───────
  // URL di bawah /workspace, sengaja — context.cookies(url) menyaring
  // berdasarkan Path cookie juga, dan sesi HUB sekarang Path=/workspace.
  const cookiesHub = await ctxOwner.cookies(`${A.PUBLIC}/workspace/meetings`);
  const sessionCookie = cookiesHub.find((c) => /sanohub\.session-token/.test(c.name));
  check(!!sessionCookie, "cookie sesi HUB ditemukan via context.cookies() (browser nyata)");
  check(sessionCookie?.secure === true, "cookie sesi: Secure=true", JSON.stringify(sessionCookie));
  check(sessionCookie?.httpOnly === true, "cookie sesi: HttpOnly=true");
  check(sessionCookie?.sameSite === "Lax", "cookie sesi: SameSite=Lax", sessionCookie?.sameSite);
  const stateCookieLeft = cookiesHub.find((c) => c.name === "sano-sso-state");
  check(!stateCookieLeft, "cookie state SUDAH TIDAK ADA setelah callback sukses (sekali pakai)");

  // Diagnostik: potongan SEKITAR kecocokan (bukan nilai rahasia) supaya
  // kalau regex ini kena, kita tahu APA yang sungguh cocok, bukan menebak.
  function matchContext(dump, re) {
    const m = dump.match(re);
    if (!m) return null;
    const i = m.index;
    return dump.slice(Math.max(0, i - 40), i + m[0].length + 40);
  }

  // ── localStorage/sessionStorage — tidak boleh ada code/state/token ──────
  const storageHub = await page.evaluate(() => ({ ls: { ...localStorage }, ss: { ...sessionStorage } }));
  const storageDumpHub = JSON.stringify(storageHub);
  check(!leakSecrets.some((s) => storageDumpHub.includes(s)), "11. localStorage/sessionStorage HUB tidak memuat token layanan");
  // PENYEBAB (ditemukan lewat matchContext di atas, bukan ditebak): yang
  // cocok adalah router cache Next.js menyimpan path "/hub/launch?state_hash=…"
  // yang memang pernah dikunjungi — BUKAN kebocoran. `state_hash` SENGAJA
  // publik sejak desainnya (satu-satunya yang boleh "meninggalkan server" lewat
  // query string, lihat docs/HUB-SSO.md) — bukan rahasia yang dicek di sini.
  // Yang SUNGGUH tidak boleh ada: kode handoff mentah ("code=") dan nama
  // cookie state (indikasi nilai cookie-nya ikut tersimpan di storage).
  check(!/code=|sano-sso-state/i.test(storageDumpHub), "11. localStorage/sessionStorage HUB tidak memuat code mentah/cookie state", matchContext(storageDumpHub, /code=|sano-sso-state/i) ?? "");

  const pageOwnerSanss = await ctxOwner.newPage();
  await pageOwnerSanss.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
  const storageSanss = await pageOwnerSanss.evaluate(() => ({ ls: { ...localStorage }, ss: { ...sessionStorage } }));
  const storageDumpSanss = JSON.stringify(storageSanss);
  check(!/sano-sso-state/i.test(storageDumpSanss), "11. localStorage/sessionStorage SANSS tidak memuat cookie state", matchContext(storageDumpSanss, /sano-sso-state/i) ?? "");

  // ── HTML/RSC sumber: tidak boleh ada token/sesi mentah ──────────────────
  const htmlHub = await page.content();
  check(!leakSecrets.some((s) => htmlHub.includes(s)), "11. HTML halaman HUB tidak memuat token layanan");
  check(!(sessionCookie && htmlHub.includes(sessionCookie.value)), "11. HTML halaman HUB tidak memuat nilai cookie sesi mentah");
  await pageOwnerSanss.close();

  // ── "Replay" lewat browser: back ke /hub/launch, reload ────────────────
  // (logika state/replay/kode-sekali-pakai SUDAH diuji exhaustif server-ke-server
  //  di Tahap 4 — di sini cukup konfirmasi PERILAKU BROWSER NYATA: reload tautan
  //  launch yang sudah terpakai tidak diam-diam membuat sesi baru, dan menampilkan
  //  pesan Indonesia yang benar, bukan crash.)
  const launchUrlHistory = page.url();
  await page.goBack().catch(() => {});
  await page.goBack().catch(() => {}); // balik lagi ke /hub/launch (yang code-nya sudah dipakai)
  await page.reload().catch(() => {});
  await page.waitForTimeout(1500);
  const bodyTextAfterReplay = await page.locator("body").innerText().catch(() => "");
  check(
    /tidak berlaku|buka task & meeting lagi|kembali ke workspace/i.test(bodyTextAfterReplay) || page.url().includes("/portal") || page.url().includes("/login"),
    "5. Reload tautan launch yang sudah terpakai (replay via browser) -> pesan Indonesia / kembali, TIDAK membuat sesi baru",
    `url=${page.url()} text=${bodyTextAfterReplay.slice(0, 120)}`,
  );

  // ── ADMIN: full launch juga berhasil ────────────────────────────────────
  const ctxAdmin = await browser.newContext({ ignoreHTTPSErrors: true });
  let pageAdmin = await loginViaUI(ctxAdmin, seed.adminActor.email, seed.password);
  await pageAdmin.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
  const hubCardAdmin = pageAdmin.locator('text="Task & Meeting"').first();
  await hubCardAdmin.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  check(await hubCardAdmin.count() > 0, "2. ADMIN: kartu Task & Meeting tampil");
  await Promise.all([pageAdmin.waitForURL(`${A.PUBLIC}/workspace/meetings`, { timeout: 20000 }).catch(() => {}), hubCardAdmin.click()]);
  await pageAdmin.waitForLoadState("networkidle").catch(() => {});
  check(pageAdmin.url() === `${A.PUBLIC}/workspace/meetings`, "2. ADMIN: mendarat di HUB /meetings", pageAdmin.url());

  // ── SALES: TIDAK ada kartu, dan tidak bisa masuk lewat manipulasi langsung ──
  const ctxSales = await browser.newContext({ ignoreHTTPSErrors: true });
  let pageSales = await loginViaUI(ctxSales, seed.sales.email, seed.password);
  await pageSales.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
  await pageSales.waitForTimeout(2000); // beri waktu portal selesai render sebelum simpulkan kartu tidak ada
  const hubCardSales = pageSales.locator('text="Task & Meeting"').first();
  check((await hubCardSales.count()) === 0, "6. SALES: kartu Task & Meeting TIDAK tampil (browser nyata)");
  // Coba akses langsung /hub/launch tanpa lewat HUB /sso/start (state_hash asal) -> ditolak bersih
  await pageSales.goto(`${A.PUBLIC}/hub/launch?state_hash=${"a".repeat(64)}`, { waitUntil: "load" });
  await pageSales.waitForTimeout(1500);
  const salesBodyText = await pageSales.locator("body").innerText().catch(() => "");
  check(/tidak tersedia|hubungi admin|tidak bisa membuka/i.test(salesBodyText), "6. SALES: akses manual /hub/launch -> pesan Indonesia 'tidak tersedia', bukan crash", salesBodyText.slice(0, 150));

  // ═══ 4. Meeting -> decision -> action item -> task -> refresh (OWNER) ══
  // Sempat GAGAL berulang dengan gejala "klik 'New project' tidak membuka
  // menu" dan sempat DIDUGA selector basi (43 commit perombakan UI HUB sejak
  // skrip ini ditulis). BUKAN itu — root cause SUNGGUHAN, dikonfirmasi lewat
  // probe standalone terpisah + full-page screenshot: `next build` standalone
  // HUB TIDAK menyalin `.next/static`/`public` ke `.next/standalone` (langkah
  // manual resmi Next.js yang mudah terlewat) — tanpa itu halaman RENDER
  // (HTML/RSC-nya sendiri lengkap) tapi TIDAK interaktif sama sekali (semua
  // chunk JS 404 diam-diam, klik tidak berbuat apa-apa, tanpa error yang
  // kelihatan). Diperbaiki permanen di repo HUB: scripts/copy-standalone-
  // assets.mjs + "postbuild" di package.json, supaya `npm run build` HUB
  // TIDAK PERNAH lagi menghasilkan standalone build yang render-tapi-mati
  // begini. Dikonfirmasi: 48/48 lulus setelah build HUB disegarkan dengan
  // langkah itu. try/catch + listener di bawah DIPERTAHANKAN sebagai
  // diagnostik umum (bukan lagi untuk membungkam gap yang sudah tidak ada) —
  // kalau bagian ini pernah gagal lagi, laporkan terus-terang, jangan
  // dibungkam sebagai PASS.
  console.log("\n== Alur meeting -> keputusan -> action item -> task -> refresh ==");
  const diagBadResp = [];
  const onDiagResp = (r) => {
    if (!r.ok()) diagBadResp.push(`${r.status()} ${r.url()}`);
  };
  page.on("response", onDiagResp);
  try {
    // Buat task butuh proyek (tombol "Buat task" disabled "Pilih proyek dulu"
    // sampai action item punya projectId) — workspace staging baru, 0 proyek.
    await page.goto(`${A.PUBLIC}/workspace/`, { waitUntil: "load" });
    const projectName = "Proyek Rehearsal Tahap 5";
    await page.locator('[aria-label="Create"]').first().click(); // "+ New" -> menu
    await page.getByText("New project", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
    await page.getByText("New project", { exact: true }).click(); // -> dialog pilih template
    await page.getByText("Blank project", { exact: true }).click(); // -> form nama proyek
    await page.locator('input[placeholder="e.g. Marketing Campaign"]').fill(projectName);
    await page.locator('button[type="submit"]:has-text("Create project")').click();
    await page.waitForTimeout(1500);
    check(page.url().includes("/projects/"), "7. Proyek dibuat (prasyarat Buat task)", `${projectName} — ${page.url()}`);

    await page.goto(`${A.PUBLIC}/workspace/meetings`, { waitUntil: "load" });
    await page.locator('button:has-text("Meeting Baru")').click();
    await page.waitForURL(/\/meetings\//, { timeout: 15000 });
    const meetingUrl = page.url();
    check(/\/meetings\/[a-z0-9]+$/.test(meetingUrl), "7. Meeting baru dibuat, navigasi ke halaman detailnya", meetingUrl);

    await page.locator('input[aria-label="Judul meeting"]').fill("Rapat Rehearsal Tahap 5 (Playwright)");
    await page.keyboard.press("Tab");

    await page.locator('input[placeholder="Tambah keputusan…"]').fill("Keputusan: lanjutkan rehearsal Tahap 5");
    await page.locator('form:has(input[placeholder="Tambah keputusan…"]) button[type="submit"]').click();
    await page.waitForTimeout(1000);
    const decisionVisible = await page.locator(':has-text("lanjutkan rehearsal Tahap 5")').count();
    check(decisionVisible > 0, "7. Keputusan tersimpan dan tampil");

    const itemForm = page.locator('form:has(input[placeholder="Tambah action item…"])');
    const itemInput = itemForm.locator('input[placeholder="Tambah action item…"]');
    const ACTION_ITEM_TEXT = "Action item: verifikasi task tercipta";
    await itemInput.fill(ACTION_ITEM_TEXT);
    await itemForm.locator('select[aria-label="Proyek"]').selectOption({ label: projectName });
    await itemForm.locator('button[type="submit"]').click();
    // PENYEBAB ASLI (ditemukan lewat dump HTML nyata sesudah 2 kali tebakan
    // selector teks gagal, bukan ditebak lagi): baris action item BUKAN teks
    // statis — judulnya adalah VALUE sebuah <input aria-label="Judul action
    // item">, controlled React, langsung bisa diedit di tempat. getByText/
    // :has-text()/text= SEMUANYA mencocokkan textContent, dan sebuah <input>
    // TIDAK PERNAH punya text child — jadi ketiganya selalu 0 match, apa pun
    // perbaikan selector-nya, selama tetap mencari TEKS. Kondisi konkret yang
    // benar: tunggu ada <input aria-label="Judul action item"> yang VALUE-nya
    // memuat judul yang baru dibuat — lewat waitForFunction yang meng-query
    // ulang DOM tiap polling (re-render tidak membuatnya stale). Bukan sleep;
    // menunggu KONDISI nyata, dan honest — tidak ada swallow-lalu-cek-saja.
    const itemCreated = await page
      .waitForFunction(
        ({ sel, text }) => Array.from(document.querySelectorAll(sel)).some((el) => el.value.includes(text)),
        { sel: 'input[aria-label="Judul action item"]', text: ACTION_ITEM_TEXT },
        { timeout: 15000 },
      )
      .then(() => true)
      .catch(() => false);
    check(itemCreated, "7. Action item tersimpan dan tampil (dengan proyek terpasang)");

    const buatTaskBtn = page.locator('button:has-text("Buat task")').first();
    const hasBuatTask = (await buatTaskBtn.count()) > 0;
    let taskClicked = false;
    if (hasBuatTask) {
      await buatTaskBtn.waitFor({ state: "visible" });
      const enabled = await buatTaskBtn.isEnabled();
      if (enabled) {
        await buatTaskBtn.click();
        await page.waitForTimeout(1500);
        taskClicked = true;
      }
    }
    check(taskClicked, "7. Tombol 'Buat task' tersedia, ENABLED (proyek terpasang), dan diklik -> task sungguhan tercipta");

    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(1000);
    const afterRefreshTitle = await page.locator('input[aria-label="Judul meeting"]').inputValue().catch(() => "");
    check(afterRefreshTitle === "Rapat Rehearsal Tahap 5 (Playwright)", "7. SETELAH REFRESH: judul meeting tetap tersimpan", afterRefreshTitle);
    const afterRefreshDecision = await page.locator(':has-text("lanjutkan rehearsal Tahap 5")').count();
    check(afterRefreshDecision > 0, "7. SETELAH REFRESH: keputusan tetap ada");
    const taskLinkAfterRefresh = await page.locator('a[href*="/board?task="]').count();
    check(taskLinkAfterRefresh > 0, "7. SETELAH REFRESH: action item sudah tertaut ke task sungguhan (link board)");
  } catch (e) {
    const shotPath = path.join(os.tmpdir(), "sso-rehearsal-section4-fail.png");
    await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
    console.log("   DIAGNOSTIK non-2xx responses selama bagian ini:", diagBadResp.slice(0, 20).join(" | ") || "(tidak ada)");
    check(false, "7. Alur proyek/meeting/task gagal", `${e.message} — screenshot: ${shotPath} — url=${page.url()} — bad-resp: ${diagBadResp.slice(0, 5).join(" | ")}`);
  } finally {
    page.off("response", onDiagResp);
  }

  // ═══ 4b. Main Hub: dua leader berbeda + Owner ═══════════════════════════
  // Part 4 (perubahan arah Main Hub, Okt 2026): dua leader BERBEDA BENTUK
  // sengaja (lihat staging-seed.mjs) — leaderA punya HUB_ACCESS (ADMIN) dan
  // benar-benar terhubung ke HUB dengan data nyata; leaderB TIDAK (SALES
  // saja, seperti kebanyakan leader divisi sungguhan hari ini) — menguji
  // jalur "connected:false" yang jujur, bukan data karangan. Owner memantau
  // keduanya lewat Pantauan Leader; leaderA sendiri TIDAK BOLEH melihatnya.
  console.log("\n== Main Hub: Pantauan Leader (dua leader + Owner) ==");
  try {
    const ctxLeaderA = await browser.newContext({ ignoreHTTPSErrors: true });
    const pageLeaderA = await loginViaUI(ctxLeaderA, seed.leaderA.email, seed.password);
    await pageLeaderA.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
    const hubCardLeaderA = pageLeaderA.locator('text="Task & Meeting"').first();
    const leaderACardSeen = await hubCardLeaderA.waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
    if (leaderACardSeen) await Promise.all([pageLeaderA.waitForURL(`${A.PUBLIC}/workspace/meetings`, { timeout: 20000 }).catch(() => {}), hubCardLeaderA.click()]);
    check(pageLeaderA.url() === `${A.PUBLIC}/workspace/meetings`, "12. leaderA (ADMIN) login -> identitas HUB dibuat (JIT)", pageLeaderA.url());

    // Dua tugas NYATA (leaderA + Owner), lewat skrip di REPO HUB itu sendiri
    // (bukan import("@prisma/client") lintas-repo dari sini — resolusi modul
    // Node berdasar lokasi file yang mengimpor, bukan cwd, jadi itu akan
    // menunjuk ke client PRISMA REPO YANG SALAH; lihat seed-leader-tasks.mjs
    // untuk penjelasan lengkap). Jalur UI pembuatan task sendiri sudah
    // dibuktikan di bagian 4 — ini cuma data fixture, cepat dan deterministik.
    const leaderSeed = parseResult(sh("node", ["scripts/stage5-rehearsal/seed-leader-tasks.mjs", A.HUB_DB, A.HUB_WORKSPACE_ID, seed.leaderA.id, seed.owner.id], HUB_DIR));
    check(leaderSeed?.ok === true, "12. identitas HUB leaderA ditemukan + tugas fixture dibuat (JIT provisioning nyata)", JSON.stringify(leaderSeed));
    const ownerTaskTitle = leaderSeed?.ownerTaskTitle ?? null;

    // leaderA sendiri: "Tugas Saya" menampilkan tugas MILIKNYA SENDIRI.
    await pageLeaderA.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
    await pageLeaderA.waitForTimeout(1500);
    const ownTaskVisible = await pageLeaderA.locator('text="Tugas Leader A (terlambat)"').count();
    check(ownTaskVisible > 0, "12. leaderA: 'Tugas Saya' Main Hub menampilkan tugas miliknya sendiri (scope sendiri)");

    // leaderA BUKAN Owner -> kartu "Pantauan Leader" tidak boleh tampil sama sekali.
    const pantauanForLeaderA = await pageLeaderA.locator('text="Pantauan Leader"').count();
    check(pantauanForLeaderA === 0, "12. leaderA (bukan Owner): kartu 'Pantauan Leader' TIDAK tampil (bukan error, memang tersembunyi)");

    // MANIPULASI: leaderA memanggil endpoint leaders langsung dari browser -> 403, tidak membocorkan data leader lain.
    const leaderAManipulate = await pageLeaderA.evaluate(async () => {
      const token = localStorage.getItem("token");
      const r = await fetch("/api/hub/summary/leaders", { headers: { authorization: `Bearer ${token}` } });
      return { status: r.status, body: await r.json().catch(() => null) };
    });
    check(leaderAManipulate.status === 403, "12. MANIPULASI: leaderA memanggil /hub/summary/leaders langsung dari browser -> 403", JSON.stringify(leaderAManipulate).slice(0, 200));

    // Owner: Pantauan Leader menampilkan KEDUA leader — leaderA dgn data nyata, leaderB jujur "Belum terhubung".
    await page.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    const pantauanOwnerVisible = await page.locator('text="Pantauan Leader"').count();
    check(pantauanOwnerVisible > 0, "12. Owner: kartu 'Pantauan Leader' TAMPIL (HUB_LEADER_MONITOR)");
    const leaderANameVisible = await page.locator('text="Leader Produksi Staging S5"').count();
    const leaderBNameVisible = await page.locator('text="Leader Gudang Staging S5"').count();
    check(leaderANameVisible > 0 && leaderBNameVisible > 0, "12. Owner: Pantauan Leader menampilkan KEDUA leader (leaderA dan leaderB)");
    const belumTerhubungVisible = await page.locator('text="Belum terhubung"').count();
    check(belumTerhubungVisible > 0, "12. Owner: leaderB (tanpa HUB_ACCESS) ditampilkan jujur 'Belum terhubung', BUKAN data karangan");

    // MANIPULASI divisi: ?division= hanya MEMPERSEMPIT, tidak pernah memperluas.
    const divisionNarrow = await page.evaluate(async () => {
      const token = localStorage.getItem("token");
      const r = await fetch("/api/hub/summary/leaders?division=PRODUCTION", { headers: { authorization: `Bearer ${token}` } });
      return { status: r.status, body: await r.json().catch(() => null) };
    });
    const narrowedNames = (divisionNarrow.body?.leaders || []).map((l) => l.name);
    check(
      divisionNarrow.status === 200 && narrowedNames.includes("Leader Produksi Staging S5") && !narrowedNames.includes("Leader Gudang Staging S5"),
      "12. MANIPULASI: ?division=PRODUCTION mempersempit ke leaderA saja, TIDAK menyertakan leaderB",
      JSON.stringify(narrowedNames),
    );
    const divisionGarbage = await page.evaluate(async () => {
      const token = localStorage.getItem("token");
      const r = await fetch("/api/hub/summary/leaders?division=' OR '1'='1", { headers: { authorization: `Bearer ${token}` } });
      return { status: r.status, body: await r.json().catch(() => null) };
    });
    check(divisionGarbage.status === 200 && Array.isArray(divisionGarbage.body?.leaders), "12. MANIPULASI: ?division= nilai sampah/liar -> 200 wajar (diabaikan, bukan 500/leak)", JSON.stringify(divisionGarbage).slice(0, 150));

    // Deep link: klik tugas leaderA di Main Hub Owner -> mendarat tepat di task itu di HUB, TANPA login ulang.
    const leaderATaskRow = page.locator('text="Tugas Leader A (terlambat)"').first();
    const deepLinkVisible = await leaderATaskRow.count();
    if (deepLinkVisible > 0) {
      await Promise.all([page.waitForURL(/\/workspace\/projects\/.+\/board\?task=/, { timeout: 15000 }).catch(() => {}), leaderATaskRow.click()]);
      await page.waitForTimeout(1000);
      check(/\/workspace\/projects\/.+\/board\?task=/.test(page.url()), "12. DEEP LINK: klik tugas leaderA di Pantauan Leader -> mendarat di task itu di HUB TANPA login ulang", page.url());
      const taskPanelVisible = await page.locator('text="Tugas Leader A (terlambat)"').count();
      check(taskPanelVisible > 0, "12. DEEP LINK: panel task yang benar terbuka di HUB (judul sama terlihat)");
    } else {
      check(false, "12. DEEP LINK: baris tugas leaderA tidak ditemukan di Pantauan Leader untuk diklik");
    }

    // PENCABUTAN AKSES: nonaktifkan leaderA -> hilang dari Pantauan Leader (bukan cuma dari login).
    // PATCH /api/users/:id dijaga adminOnly, yang mengecek STRING ROLE
    // "ADMIN" (rolesOf(req.user).includes("ADMIN")) — OWNER TIDAK otomatis
    // lolos (rolesOf Owner = ["OWNER"], bukan "ADMIN"), jadi dipakai
    // pageAdmin (adminActor), pola SAMA dengan skenario 9 di bawah. pageAdmin
    // sedang di origin HUB sejak skenario 2 — balik ke SANSS dulu (gotcha
    // yang sama persis sudah didokumentasikan di skenario 9).
    await pageAdmin.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
    const deactivateStatus = await pageAdmin.evaluate(async (leaderAId) => {
      const token = localStorage.getItem("token");
      const r = await fetch(`/api/users/${leaderAId}`, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ active: false }) });
      return r.status;
    }, seed.leaderA.id);
    check(deactivateStatus === 200, "12. PENCABUTAN: PATCH /api/users/:id {active:false} untuk leaderA -> 200", `status=${deactivateStatus}`);
    // DIAGNOSTIK — panggil API langsung (bukan DOM) supaya kalau ini gagal,
    // jelas apakah backend masih mengirim leaderA (bug logika) atau backend
    // sudah benar dan ini cuma caching/rendering di sisi klien.
    const directApiCheck = await page.evaluate(async () => {
      const token = localStorage.getItem("token");
      const r = await fetch("/api/hub/summary/leaders", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
      return { status: r.status, body: await r.json().catch(() => null) };
    });
    console.log("   DIAGNOSTIK 12. /hub/summary/leaders langsung setelah nonaktif:", JSON.stringify(directApiCheck).slice(0, 500));
    // `page` (Owner) masih di origin HUB sejak uji DEEP LINK di atas
    // (/workspace/projects/.../board?task=...) — page.reload() di situ
    // hanya me-reload board HUB, BUKAN Main Hub tempat Pantauan Leader
    // dirender. Navigasi eksplisit balik ke /portal dulu (pola yang sama
    // dipakai di seluruh skrip ini), baru itu "refresh" yang dimaksud.
    await page.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    const leaderAStillVisible = await page.locator('text="Leader Produksi Staging S5"').count();
    check(leaderAStillVisible === 0, "12. PENCABUTAN: leaderA nonaktif -> HILANG dari Pantauan Leader Owner setelah refresh");
    // Kembalikan ke aktif supaya tidak mengotori baseline staging untuk rehearsal berikutnya.
    await pageAdmin.evaluate(async (leaderAId) => {
      const token = localStorage.getItem("token");
      await fetch(`/api/users/${leaderAId}`, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ active: true }) });
    }, seed.leaderA.id);

    // Rantai penuh -> Main Hub Owner, SETELAH REFRESH, TANPA login ulang.
    if (ownerTaskTitle) {
      await page.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
      await page.waitForTimeout(1500);
      const ownerChainTaskVisible = await page.locator(`text="${ownerTaskTitle}"`).count();
      check(ownerChainTaskVisible > 0, "12. RANTAI PENUH: tugas yang ditetapkan ke Owner muncul di 'Tugas Saya' Main Hub setelah refresh, tanpa login ulang");
    }

    await pageLeaderA.close();
    await ctxLeaderA.close();
  } catch (e) {
    const shotPath = path.join(os.tmpdir(), "sso-rehearsal-mainhub-leaders-fail.png");
    await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
    check(false, "12. Main Hub Pantauan Leader: skenario gagal", `${e.message} — screenshot: ${shotPath} — url=${page.url()}`);
  }

  // ═══ 5. Logout SANSS -> sesi HUB tercabut (browser nyata) ══════════════
  console.log("\n== Logout & revoke (browser nyata) ==");
  const pageOwnerSanssForLogout = await ctxOwner.newPage();
  await pageOwnerSanssForLogout.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
  const logoutBtn = pageOwnerSanssForLogout.locator('button:has-text("Keluar"), button:has-text("Logout")').first();
  if ((await logoutBtn.count()) > 0) {
    await logoutBtn.click();
    await pageOwnerSanssForLogout.waitForTimeout(2000);
  } else {
    // fallback: panggil logout lewat API dalam konteks browser (token dari localStorage)
    await pageOwnerSanssForLogout.evaluate(async () => {
      const token = localStorage.getItem("token");
      if (token) await fetch("/api/auth/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } });
    });
    await pageOwnerSanssForLogout.waitForTimeout(2000);
  }
  await page.goto(`${A.PUBLIC}/workspace/meetings`, { waitUntil: "load" });
  check(!page.url().endsWith("/meetings"), "8. SETELAH LOGOUT SANSS: GET /meetings (sesi lama) TIDAK lagi 200/berhasil", page.url());

  // ═══ 6. Revoke via ADMIN ke ADMIN target, sesi HUB berhenti ════════════
  const ctxTarget = await browser.newContext({ ignoreHTTPSErrors: true });
  let pageTarget = await loginViaUI(ctxTarget, seed.adminTarget.email, seed.password);
  const targetToken = await pageTarget.evaluate(() => localStorage.getItem("token")).catch(() => null);
  check(!!targetToken, "9. Login admin-target (browser) -> token tersimpan", `url=${pageTarget.url()}`);
  await pageTarget.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
  let cardT = pageTarget.locator('text="Task & Meeting"').first();
  let cardFound = await cardT.waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
  if (!cardFound) {
    console.log("   kartu belum tampil, reload /portal sekali lagi...");
    await pageTarget.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
    cardT = pageTarget.locator('text="Task & Meeting"').first();
    cardFound = await cardT.waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
  }
  check(cardFound, "9. Kartu Task & Meeting tampil untuk admin-target sebelum diklik");
  if (cardFound) {
    await Promise.all([pageTarget.waitForURL(`${A.PUBLIC}/workspace/meetings`, { timeout: 20000 }).catch(() => {}), cardT.click()]);
  }
  check(pageTarget.url() === `${A.PUBLIC}/workspace/meetings`, "9. Sesi HUB (admin target) dibuat untuk uji revoke", pageTarget.url());

  // pageAdmin sedang di /workspace sejak skenario 2 — fetch("/api/users/...")
  // dari sana akan mukul HUB, bukan SANSS. Balik ke origin SANSS dulu.
  await pageAdmin.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
  const patchStatus = await pageAdmin.evaluate(async (targetId) => {
    const token = localStorage.getItem("token");
    const r = await fetch(`/api/users/${targetId}`, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ active: false }) });
    return r.status;
  }, seed.adminTarget.id);
  check(patchStatus === 200, "9. PATCH /api/users/:id {active:false} (dari browser, origin SANSS) -> 200", `status=${patchStatus}`);
  await pageTarget.waitForTimeout(3000);
  await pageTarget.goto(`${A.PUBLIC}/workspace/meetings`, { waitUntil: "load" });
  check(!pageTarget.url().endsWith("/meetings") || pageTarget.url() !== `${A.PUBLIC}/workspace/meetings`, "9. SETELAH DICABUT: sesi HUB (admin target) berhenti", pageTarget.url());
  // (kalau masih di /meetings, berarti revoke langsung gagal dites — fallback introspeksi <=60s diuji di langkah berikut)
  const stillIn = pageTarget.url() === `${A.PUBLIC}/workspace/meetings`;
  if (stillIn) {
    console.log("   (revoke langsung belum nampak — tunggu introspeksi HUB <=60 dtk)");
    await pageTarget.waitForTimeout(62000);
    await pageTarget.goto(`${A.PUBLIC}/workspace/meetings`, { waitUntil: "load" });
    check(pageTarget.url() !== `${A.PUBLIC}/workspace/meetings`, "9. (fallback introspeksi) sesi HUB (admin target) berhenti dalam <=60 dtk", pageTarget.url());
  }

  // ═══ 7. Kill switch TERHADAP SESI YANG SUDAH AKTIF ═════════════════════
  console.log("\n== Kill switch terhadap sesi yang sudah aktif ==");
  // ADMIN (pageAdmin) masih punya sesi HUB aktif dari langkah 2. Matikan
  // HUB_SSO_ENABLED di SANSS (tanpa restart HUB) -> /api/hub/internal/introspect
  // ikut 404 -> introspectGate HUB gagal (unavailable) -> fail-closed -> sesi
  // yang SUDAH AKTIF ikut berhenti, bukan cuma mencegah login baru.
  await A.stopProc("sanss");
  check(await A.startSanss({ HUB_SSO_ENABLED: "false" }), "kill-switch: restart SANSS dengan flag OFF (HUB tetap jalan, sesi ADMIN masih ada)");
  await pageAdmin.waitForTimeout(2000);
  // Sanity check murah — bukan untuk HUB, tapi memastikan prasyarat skenario
  // ini (SANSS SUNGGUH menjawab 404) benar sebelum menuduh gerbang HUB kalau
  // baris di bawah gagal. Pernah menyelamatkan banyak waktu: skenario ini
  // sempat gagal bukan karena ini, tapi karena resolveUserId() (HUB,
  // server/auth.ts) masih mencari cookie dengan NAMA LAMA setelah
  // di-rename untuk same-domain embedding — row sesi selalu null,
  // introspectGate TIDAK PERNAH terpanggil, sesi dipercaya selamanya. Sudah
  // diperbaiki (lihat commit HUB); baris ini tetap di sini sebagai jaring
  // pengaman murah kalau prasyaratnya pernah basi lagi.
  const directIntrospect = await fetch(`http://127.0.0.1:${A.SANSS_PORT}/api/hub/internal/introspect`, {
    method: "POST",
    headers: { "x-hub-service-token": A.SHARED_TOKEN, "content-type": "application/json" },
    body: JSON.stringify({ sub: "x" }),
  }).then((r) => r.status).catch((e) => `fetch gagal: ${e.message}`);
  if (directIntrospect !== 404) console.log("   PERINGATAN: /api/hub/internal/introspect langsung ke SANSS bukan 404 (prasyarat skenario ini basi):", directIntrospect);
  await pageAdmin.goto(`${A.PUBLIC}/workspace/meetings`, { waitUntil: "load" });
  let adminStillIn = pageAdmin.url() === `${A.PUBLIC}/workspace/meetings`;
  if (adminStillIn) {
    console.log("   cache introspeksi masih hangat — tunggu <=60 dtk...");
    await pageAdmin.waitForTimeout(62000);
    await pageAdmin.goto(`${A.PUBLIC}/workspace/meetings`, { waitUntil: "load" });
    adminStillIn = pageAdmin.url() === `${A.PUBLIC}/workspace/meetings`;
  }
  check(!adminStillIn, "10. Kill switch (flag SANSS OFF) menutup SESI ADMIN YANG SUDAH AKTIF, bukan cuma mencegah login baru", pageAdmin.url());

  await browser.close();

  // ═══ 8. BOOKEND AKHIR — kedua flag OFF lagi ═════════════════════════════
  console.log("\n== BOOKEND AKHIR: kedua flag OFF ==");
  await A.stopAll();
  check(await A.startSanss({ HUB_SSO_ENABLED: "false" }), "bookend-akhir: boot SANSS (flag OFF)");
  check(await A.startHub({ SANSS_SSO_ENABLED: "false" }), "bookend-akhir: boot HUB (flag OFF)");
  r = await fetch(`http://127.0.0.1:${A.SANSS_PORT}/api/hub/handoff`, { method: "POST", headers: { authorization: "Bearer x", "content-type": "application/json" }, body: "{}" });
  check(r.status === 404, "bookend-akhir: SANSS /api/hub/handoff -> 404", `status=${r.status}`);
  r = await fetch(`http://127.0.0.1:${A.HUB_PORT}/workspace/sso/start`, { redirect: "manual" });
  check(r.status === 404, "bookend-akhir: HUB /sso/start -> 404", `status=${r.status}`);
  await A.stopAll();

  console.log("\n=== RINGKASAN ===");
  for (const x of results) console.log(`${x.ok ? "PASS" : "FAIL"} ${x.name}`);
  const gagal = results.filter((x) => !x.ok).length;
  console.log(`${results.length - gagal}/${results.length} lulus`);
  process.exit(gagal ? 1 : 0);
}

main().catch(async (e) => {
  console.error("GAGAL TOTAL:", e);
  await A.stopAll();
  process.exit(1);
});
