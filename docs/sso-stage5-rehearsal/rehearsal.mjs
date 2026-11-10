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
import fsp from "node:fs/promises";

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
  // Pasangan DB staging WAJIB konsisten (penanda sama, migrasi dikenal repo
  // ini, identitas HUB menunjuk pengguna SANSS yang ada) — fixture dicari
  // per judul, jadi pasangan setengah-reset diam-diam memakai fixture lama.
  // Reset hanya atas permintaan eksplisit, dan hanya DB bertanda harness.
  const pairArgs = [`"${A.SANSS_DB}"`, `"${A.HUB_DB}"`];
  if (process.env.STAGE5_RESET_STAGING === "1") {
    console.log("reset staging:", parseResult(sh("node", ["scripts/stage5-rehearsal/staging-pair.mjs", "reset", ...pairArgs], SANSS_DIR)));
  }
  const pair = parseResult(sh("node", ["scripts/stage5-rehearsal/staging-pair.mjs", "check", ...pairArgs, `"${HUB_DIR}"`], SANSS_DIR));
  console.log("pasangan staging:", pair);
  sh("node", ["scripts/stage5-rehearsal/staging-db.mjs", "create"], SANSS_DIR);
  sh("node", ["scripts/stage5-rehearsal/staging-db.mjs", "migrate"], SANSS_DIR);
  sh("node", ["scripts/stage5-rehearsal/staging-db.mjs", "create"], HUB_DIR);
  if (pair?.state === "fresh") {
    console.log("penanda pasangan:", parseResult(sh("node", ["scripts/stage5-rehearsal/staging-pair.mjs", "mark", ...pairArgs], SANSS_DIR)));
  }
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

  // ═══ 4b. Main Hub: dua leader MEMBER (grant eksplisit) + Owner ══════════
  // Revisi Okt 2026 (keputusan Owner): leaderA DAN leaderB sekarang SAMA
  // bentuknya — SALES (satu portal operasional) + HUB_MEMBER (grant
  // eksplisit per-pengguna, lihat permissions.js), bukan lagi "satu ADMIN
  // satu tanpa akses". Keduanya benar-benar login ke HUB dengan membership
  // "MEMBER" (BUKAN "ADMIN" — dibuktikan langsung dari DB, bukan ditebak
  // dari UI), dan punya task/meeting BERBEDA supaya isolasi scope-sendiri
  // teruji sungguhan: leaderA tidak boleh pernah melihat judul milik
  // leaderB di Main Hub-nya, dan sebaliknya.
  //
  // SUPERSEDED (10 Nov 2026): catatan di bawah ini bilang HUB tidak punya
  // kontrol akses per-task/per-project sama sekali — itu SEKARANG SALAH.
  // server/policy/access.ts (repo HUB) menambahkan kontrol itu, gated di
  // belakang HUB_RESOURCE_ACL_ENABLED (lihat docs/SSO.md "Access control"
  // dan skenario 14 di bawah untuk bukti lintas-proyek). KONSEKUENSI untuk
  // bagian INI: auth.ts sekarang MENOLAK sesi HUB MEMBER/GUEST sama sekali
  // (dialihkan ke /acl-pending) kalau flag itu OFF — jadi mulai baris
  // startHub di bawah, flag DINYALAKAN untuk sisa skenario 12-14 (leaderA/
  // leaderB tidak akan bisa login ke HUB sama sekali kalau tidak), dan
  // DIMATIKAN lagi di skenario 14's finally. Paragraf ASLI di bawah (kenapa
  // ringkasan Main Hub SANSS sendiri aman TANPA kontrol akses proyek sejak
  // awal — ia baca langsung dari identitas sesi, tidak pernah menerima ID
  // dari browser) masih BENAR dan tetap relevan untuk MENGAPA bagian itu
  // sendiri tidak perlu diuji ulang di sini; yang berubah hanya bahwa
  // SESI HUB leaderA/leaderB kini butuh flag itu untuk bisa ada sama sekali.
  //
  // CATATAN ASLI (sebagian sudah basi — lihat di atas): HUB sendiri TIDAK
  // PUNYA kontrol akses per-task/per-project sama sekali — SIAPA PUN anggota
  // workspace (MEMBER/ADMIN/OWNER) bisa melihat DAN MENGUBAH task/meeting
  // siapa pun begitu mereka benar-benar masuk ke HUB (desain asli HUB sejak
  // awal, bukan sesuatu yang diubah di sini — lihat docs/HUB-SSO.md "Main
  // Hub — onboarding leader"). Bagian ini TIDAK menguji "mutasi task pihak
  // lain ditolak di dalam HUB" karena itu TIDAK BENAR hari ini dan
  // membangunnya adalah proyek terpisah yang jauh lebih besar (keputusan
  // Owner: dokumentasikan, jangan bangun sekarang). Yang DIUJI di sini
  // adalah batas yang SUNGGUHAN ada: ringkasan Main Hub SANSS sendiri
  // ("Tugas Saya"/"Hasil Meeting") hanya PERNAH menampilkan data milik
  // pemiliknya — dikunci oleh identitas sesi, tidak menerima parameter id
  // dari browser sama sekali, jadi tidak ada "ID" untuk dimanipulasi di
  // lapisan itu.
  console.log("\n== Main Hub: dua leader MEMBER (grant eksplisit) + Owner ==");
  // Resource ACL — MEMBER/GUEST butuh flag ON untuk bisa login ke HUB sama
  // sekali (lihat catatan SUPERSEDED di atas). Dinyalakan di sini, bukan
  // cuma di skenario 14, supaya leaderA/leaderB (dipakai sejak bagian ini)
  // berhasil JIT-provisioning. stopProc dulu (lihat alasannya di skenario 14).
  await A.stopProc("hub");
  check(await A.startHub({ SANSS_SSO_ENABLED: "true", HUB_RESOURCE_ACL_ENABLED: "true" }), "12. HUB dinyalakan ulang dengan HUB_RESOURCE_ACL_ENABLED=true (MEMBER/GUEST butuh ini untuk bisa login sama sekali)");
  try {
    // ── Routing: non-leader satu-portal TETAP auto-skip (regresi, bukan diubah) ──
    const ctxPlainSales = await browser.newContext({ ignoreHTTPSErrors: true });
    const pagePlainSales = await loginViaUI(ctxPlainSales, seed.sales.email, seed.password);
    await pagePlainSales.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
    await pagePlainSales.waitForTimeout(1500);
    check(pagePlainSales.url() !== `${A.PUBLIC}/portal`, "12. Non-leader (SALES biasa, tanpa HUB_MEMBER) satu-portal -> TETAP auto-skip, tidak mendarat di /portal", pagePlainSales.url());
    await pagePlainSales.close();
    await ctxPlainSales.close();

    // ── Login leaderA & leaderB (keduanya SALES+HUB_MEMBER) ──────────────
    async function loginLeader(email) {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const p = await loginViaUI(ctx, email, seed.password);
      await p.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
      const hubCard = p.locator('text="Task & Meeting"').first();
      const cardSeen = await hubCard.waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
      if (cardSeen) await Promise.all([p.waitForURL(`${A.PUBLIC}/workspace/meetings`, { timeout: 20000 }).catch(() => {}), hubCard.click()]);
      return { ctx, page: p, landedInHub: p.url() === `${A.PUBLIC}/workspace/meetings` };
    }
    const leaderALogin = await loginLeader(seed.leaderA.email);
    const pageLeaderA = leaderALogin.page;
    check(leaderALogin.landedInHub, "12. leaderA (SALES+HUB_MEMBER) login -> identitas HUB dibuat (JIT)", pageLeaderA.url());
    const leaderBLogin = await loginLeader(seed.leaderB.email);
    const pageLeaderB = leaderBLogin.page;
    check(leaderBLogin.landedInHub, "12. leaderB (SALES+HUB_MEMBER) login -> identitas HUB dibuat (JIT)", pageLeaderB.url());

    // ── Routing: leader satu-portal TIDAK auto-skip, Main Hub-nya tampil ──
    await pageLeaderA.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
    await pageLeaderA.waitForTimeout(1000);
    check(pageLeaderA.url() === `${A.PUBLIC}/portal`, "12. ROUTING: leaderA satu-portal-operasional TETAP mendarat di /portal (TIDAK auto-skip) karena HUB_ACCESS", pageLeaderA.url());
    const leaderATugasSayaVisible = await pageLeaderA.locator('text="Tugas Saya"').count();
    check(leaderATugasSayaVisible > 0, "12. ROUTING: widget Main Hub ('Tugas Saya') benar-benar tampil untuk leaderA satu-portal");

    // Dua tugas + dua meeting NYATA, BERBEDA per leader, lewat skrip di REPO
    // HUB itu sendiri (bukan import("@prisma/client") lintas-repo — lihat
    // seed-leader-tasks.mjs untuk penjelasan lengkap kenapa).
    const leaderSeed = parseResult(sh("node", ["scripts/stage5-rehearsal/seed-leader-tasks.mjs", A.HUB_DB, A.HUB_WORKSPACE_ID, seed.leaderA.id, seed.leaderB.id, seed.owner.id], HUB_DIR));
    check(leaderSeed?.ok === true, "12. identitas HUB leaderA+leaderB ditemukan + tugas/meeting fixture dibuat (JIT provisioning nyata)", JSON.stringify(leaderSeed));
    const ownerTaskTitle = leaderSeed?.ownerTaskTitle ?? null;
    check(leaderSeed?.leaderA?.membershipRole === "MEMBER", "12. MEMBERSHIP: leaderA punya WorkspaceMember.role = MEMBER di HUB (BUKAN ADMIN) — scope terbatas sesuai arahan Owner", JSON.stringify(leaderSeed?.leaderA));
    check(leaderSeed?.leaderB?.membershipRole === "MEMBER", "12. MEMBERSHIP: leaderB punya WorkspaceMember.role = MEMBER di HUB (BUKAN ADMIN)", JSON.stringify(leaderSeed?.leaderB));

    // ── Scope sendiri + isolasi lintas-leader (DOM dan body API langsung) ──
    async function ownSummaryBody(p) {
      return p.evaluate(async () => {
        const token = localStorage.getItem("token");
        const r = await fetch("/api/hub/summary/me", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
        return { status: r.status, body: await r.json().catch(() => null) };
      });
    }
    await pageLeaderA.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
    await pageLeaderA.waitForTimeout(1500);
    const leaderAOwnTaskVisible = await pageLeaderA.locator(`text="${leaderSeed?.leaderA?.taskTitle}"`).count();
    check(leaderAOwnTaskVisible > 0, "12. leaderA: 'Tugas Saya' menampilkan tugas MILIKNYA SENDIRI", leaderSeed?.leaderA?.taskTitle);
    const leaderASeesBTask = await pageLeaderA.locator(`text="${leaderSeed?.leaderB?.taskTitle}"`).count();
    const leaderASeesBMeeting = await pageLeaderA.locator(`text="${leaderSeed?.leaderB?.meetingTitle}"`).count();
    check(leaderASeesBTask === 0 && leaderASeesBMeeting === 0, "12. ISOLASI: leaderA TIDAK PERNAH melihat tugas/meeting milik leaderB di Main Hub-nya (DOM)");
    const leaderAApiBody = await ownSummaryBody(pageLeaderA);
    const leaderAApiStr = JSON.stringify(leaderAApiBody);
    check(leaderAApiBody.status === 200 && !leaderAApiStr.includes(leaderSeed?.leaderB?.taskTitle) && !leaderAApiStr.includes(leaderSeed?.leaderB?.meetingTitle), "12. ISOLASI: GET /hub/summary/me milik leaderA tidak memuat judul milik leaderB (body API langsung, bukan cuma DOM)", leaderAApiStr.slice(0, 300));

    await pageLeaderB.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
    await pageLeaderB.waitForTimeout(1500);
    const leaderBOwnTaskVisible = await pageLeaderB.locator(`text="${leaderSeed?.leaderB?.taskTitle}"`).count();
    check(leaderBOwnTaskVisible > 0, "12. leaderB: 'Tugas Saya' menampilkan tugas MILIKNYA SENDIRI", leaderSeed?.leaderB?.taskTitle);
    const leaderBSeesATask = await pageLeaderB.locator(`text="${leaderSeed?.leaderA?.taskTitle}"`).count();
    const leaderBSeesAMeeting = await pageLeaderB.locator(`text="${leaderSeed?.leaderA?.meetingTitle}"`).count();
    check(leaderBSeesATask === 0 && leaderBSeesAMeeting === 0, "12. ISOLASI: leaderB TIDAK PERNAH melihat tugas/meeting milik leaderA di Main Hub-nya (DOM)");
    const leaderBApiBody = await ownSummaryBody(pageLeaderB);
    const leaderBApiStr = JSON.stringify(leaderBApiBody);
    check(leaderBApiBody.status === 200 && !leaderBApiStr.includes(leaderSeed?.leaderA?.taskTitle) && !leaderBApiStr.includes(leaderSeed?.leaderA?.meetingTitle), "12. ISOLASI: GET /hub/summary/me milik leaderB tidak memuat judul milik leaderA (body API langsung)", leaderBApiStr.slice(0, 300));

    // leaderA/leaderB: kartu "Pantauan Leader" tidak boleh tampil (keduanya MEMBER, bukan Owner).
    const pantauanForLeaderA = await pageLeaderA.locator('text="Pantauan Leader"').count();
    check(pantauanForLeaderA === 0, "12. leaderA (MEMBER, bukan Owner): kartu 'Pantauan Leader' TIDAK tampil");
    const pantauanForLeaderB = await pageLeaderB.locator('text="Pantauan Leader"').count();
    check(pantauanForLeaderB === 0, "12. leaderB (MEMBER, bukan Owner): kartu 'Pantauan Leader' TIDAK tampil");

    // MANIPULASI: KEDUA leader memanggil endpoint leaders langsung -> 403, tidak membocorkan data leader lain.
    async function leadersManipulate(p) {
      return p.evaluate(async () => {
        const token = localStorage.getItem("token");
        const r = await fetch("/api/hub/summary/leaders", { headers: { authorization: `Bearer ${token}` } });
        return { status: r.status, body: await r.json().catch(() => null) };
      });
    }
    const leaderAManipulate = await leadersManipulate(pageLeaderA);
    check(leaderAManipulate.status === 403, "12. MANIPULASI: leaderA memanggil /hub/summary/leaders langsung dari browser -> 403", JSON.stringify(leaderAManipulate).slice(0, 200));
    const leaderBManipulate = await leadersManipulate(pageLeaderB);
    check(leaderBManipulate.status === 403, "12. MANIPULASI: leaderB memanggil /hub/summary/leaders langsung dari browser -> 403", JSON.stringify(leaderBManipulate).slice(0, 200));

    // Owner: Pantauan Leader menampilkan KEDUA leader dengan DATA NYATA BERBEDA (keduanya sekarang punya HUB_ACCESS).
    await page.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    const pantauanOwnerVisible = await page.locator('text="Pantauan Leader"').count();
    check(pantauanOwnerVisible > 0, "12. Owner: kartu 'Pantauan Leader' TAMPIL (HUB_LEADER_MONITOR)");
    const leaderANameVisible = await page.locator('text="Leader Produksi Staging S5"').count();
    const leaderBNameVisible = await page.locator('text="Leader Gudang Staging S5"').count();
    check(leaderANameVisible > 0 && leaderBNameVisible > 0, "12. Owner: Pantauan Leader menampilkan KEDUA leader (leaderA dan leaderB)");
    const ownerSeesLeaderATask = await page.locator(`text="${leaderSeed?.leaderA?.taskTitle}"`).count();
    const ownerSeesLeaderBTask = await page.locator(`text="${leaderSeed?.leaderB?.taskTitle}"`).count();
    check(ownerSeesLeaderATask > 0 && ownerSeesLeaderBTask > 0, "12. Owner: Pantauan Leader menampilkan tugas NYATA BERBEDA milik leaderA dan leaderB (keduanya terhubung, bukan 'Belum terhubung')");

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
    const leaderATaskRow = page.locator(`text="${leaderSeed?.leaderA?.taskTitle}"`).first();
    const deepLinkVisible = await leaderATaskRow.count();
    if (deepLinkVisible > 0) {
      await Promise.all([page.waitForURL(/\/workspace\/projects\/.+\/board\?task=/, { timeout: 15000 }).catch(() => {}), leaderATaskRow.click()]);
      await page.waitForTimeout(1000);
      check(/\/workspace\/projects\/.+\/board\?task=/.test(page.url()), "12. DEEP LINK: klik tugas leaderA di Pantauan Leader -> mendarat di task itu di HUB TANPA login ulang", page.url());
      const taskPanelVisible = await page.locator(`text="${leaderSeed?.leaderA?.taskTitle}"`).count();
      check(taskPanelVisible > 0, "12. DEEP LINK: panel task yang benar terbuka di HUB (judul sama terlihat)");
      // SENGAJA TIDAK diuji di sini: "task leaderB tidak muncul di halaman
      // board ini sama sekali". leaderA dan leaderB berbagi SATU project
      // ("Pantauan Leader S5") supaya fixture-nya sederhana — board HUB
      // menampilkan SEMUA kartu di project itu untuk SIAPA PUN anggota
      // workspace, sesuai desain HUB sendiri (lihat "Main Hub — onboarding
      // leader" di docs/HUB-SSO.md: batas yang didokumentasikan, bukan
      // dibangun, atas keputusan Owner). Sempat ditambahkan sebagai
      // assertion di sini, lalu GAGAL (bukan bug — board memang menampilkan
      // kartu leaderB di sana) dan dihapus, bukan "diperbaiki" dengan
      // menyembunyikan data di HUB. Batas yang NYATA dan SUDAH diuji di
      // atas: ringkasan Main Hub SANSS sendiri (ISOLASI, dua uji di atas).
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
    await leaderALogin.ctx.close();
    await pageLeaderB.close();
    await leaderBLogin.ctx.close();
  } catch (e) {
    const shotPath = path.join(os.tmpdir(), "sso-rehearsal-mainhub-leaders-fail.png");
    await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
    check(false, "12. Main Hub Pantauan Leader: skenario gagal", `${e.message} — screenshot: ${shotPath} — url=${page.url()}`);
  }

  // ═══ 13. QA visual Main Hub — redesain Apple-style (desktop, mobile,     ══
  //         disclosure, HUB mati, smoke CSS layar lain) ═══════════════════
  // Kandidat visual sendiri (92aaea3ab / sumber 62f660978) SUDAH ditutup —
  // bagian ini MEMBUKTIKANNYA dengan browser sungguhan, bukan mengubahnya
  // lagi. Akun fixture existing saja (page = Owner, sudah login sejak
  // skenario 1; leaderA/leaderB login ulang di bawah memakai email/password
  // staging yang sama seperti skenario 12) — tidak ada bypass auth baru.
  console.log("\n== QA visual Main Hub: desktop, mobile, disclosure, HUB mati, smoke CSS ==");
  const shotDir = path.join(os.tmpdir(), "sso-rehearsal-mainhub-qa");
  await fsp.mkdir(shotDir, { recursive: true }).catch(() => {});
  try {
    // ── Desktop: Portal penuh, data nyata Owner (dari skenario 4/12) ──────
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    const shotDesktop = path.join(shotDir, "portal-desktop.png");
    await page.screenshot({ path: shotDesktop, fullPage: true });
    check(true, "13. Screenshot DESKTOP /portal disimpan", shotDesktop);

    const capsuleCount = await page.locator(".ap-tombol").count();
    check(capsuleCount >= 2, "13. Tombol capsule Apple (.ap-tombol) tampil di Main Hub", `jumlah=${capsuleCount}`);
    const widgetCount = await page.locator(".ap-widget").count();
    check(widgetCount >= 1, "13. Kartu widget workspace (.ap-widget) tampil", `jumlah=${widgetCount}`);
    const panelCount = await page.locator(".ap-panel").count();
    check(panelCount === 3, "13. Ketiga panel Main Hub (.ap-panel: Tugas Saya/Hasil Meeting/Pantauan Leader) tampil", `jumlah=${panelCount}`);

    // ── Disclosure ikon info "i": buka via klik, tutup via Esc (bukan hover) ──
    const infoBtn = page.locator('[data-testid="ap-info"]').first();
    if ((await infoBtn.count()) > 0) {
      await infoBtn.click();
      await page.waitForTimeout(300);
      const openVisible = await page.locator('[data-testid="ap-info-isi"]').first().isVisible().catch(() => false);
      check(openVisible, "13. Ikon info 'i' membuka penjelasan saat diklik (bukan hover)");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      check((await page.locator('[data-testid="ap-info-isi"]').count()) === 0, "13. Ikon info 'i' tertutup dengan Esc");
    } else {
      check(false, "13. Ikon info 'i' tidak ditemukan di Main Hub untuk diuji");
    }

    // ── Tiga kartu Main Hub: Owner (terhubung ke HUB) -> state DATA NYATA, bukan kosong/galat ──
    check((await page.locator('text="Tugas Saya"').count()) > 0, "13. Panel 'Tugas Saya' tampil untuk Owner");
    check((await page.locator('text="Hasil Meeting"').count()) > 0, "13. Panel 'Hasil Meeting' tampil untuk Owner");
    check((await page.locator('text="Pantauan Leader"').count()) > 0, "13. Panel 'Pantauan Leader' tampil untuk Owner");
    check((await page.locator('text="Belum terhubung ke Task & Meeting"').count()) === 0, "13. Owner TERHUBUNG -> tidak menampilkan state 'belum terhubung' (data nyata, bukan kosong)");

    // ── Klik detail dari Pantauan Leader (tugas leaderA, judul stabil/idempoten
    //    dari seed-leader-tasks.mjs) -> HUB -> refresh -> kembali ke Main Hub,
    //    URL tetap SATU origin /workspace sepanjang jalan (same-domain, bukan
    //    cross-origin — lihat perbaikan komentar di Portal.jsx). ──
    const leaderATaskForClick = page.locator('text="Tugas Leader A (terlambat)"').first();
    if ((await leaderATaskForClick.count()) > 0) {
      await Promise.all([page.waitForURL(/\/workspace\/projects\/.+\/board\?task=/, { timeout: 15000 }).catch(() => {}), leaderATaskForClick.click()]);
      await page.waitForTimeout(1000);
      const urlAfterClick = page.url();
      check(urlAfterClick.startsWith(`${A.PUBLIC}/workspace`), "13. ALUR: kartu -> SSO -> detail mendarat di ORIGIN SAMA (/workspace), tanpa login ulang", urlAfterClick);
      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(1000);
      check(page.url().startsWith(`${A.PUBLIC}/workspace`), "13. ALUR: refresh di halaman detail HUB tetap di origin yang sama (sesi tidak hilang)", page.url());
      await page.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
      await page.waitForTimeout(1000);
      check(page.url() === `${A.PUBLIC}/portal` && (await page.locator('text="Pantauan Leader"').count()) > 0, "13. ALUR: kembali ke Main Hub dari HUB berhasil, Pantauan Leader tampil lagi", page.url());
    } else {
      check(false, "13. ALUR: tugas leaderA tidak ditemukan di Pantauan Leader Owner untuk diklik");
    }

    // ── Isolasi dua leader MEMBER (ulang ringkas dgn SCREENSHOT — logika lengkapnya sudah dibuktikan skenario 12) ──
    const ctxLeaderAQa = await browser.newContext({ ignoreHTTPSErrors: true });
    const pageLeaderAQa = await loginViaUI(ctxLeaderAQa, seed.leaderA.email, seed.password);
    await pageLeaderAQa.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
    await pageLeaderAQa.waitForTimeout(1500);
    const shotLeaderA = path.join(shotDir, "portal-leaderA-desktop.png");
    await pageLeaderAQa.screenshot({ path: shotLeaderA, fullPage: true });
    check((await pageLeaderAQa.locator('text="Tugas Leader A (terlambat)"').count()) > 0, "13. leaderA (screenshot): melihat tugas miliknya sendiri", shotLeaderA);
    check((await pageLeaderAQa.locator('text="Tugas Leader B (terlambat)"').count()) === 0, "13. leaderA (screenshot): TIDAK melihat tugas leaderB");
    check((await pageLeaderAQa.locator('text="Pantauan Leader"').count()) === 0, "13. leaderA (screenshot): Pantauan Leader tetap tersembunyi (MEMBER, bukan Owner)");
    await pageLeaderAQa.close();
    await ctxLeaderAQa.close();

    // ── HUB mati -> Main Hub bilang "tidak tersedia", SISA Portal (kartu workspace, tombol capsule) TIDAK ikut jatuh ──
    await A.stopProc("hub");
    await page.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
    // Backend SANSS sendiri butuh sampai SUMMARY_TIMEOUT_MS (8 dtk,
    // services/hubSummary.js) untuk gagal-tertutup saat HUB tak terjangkau —
    // tunggu KONDISI nyata (bukan sleep pendek yang kebetulan lolos/gagal
    // tergantung kecepatan mesin) sampai 12 dtk sebelum menilai.
    await page.waitForSelector('text="Task & Meeting tidak tersedia"', { timeout: 12000 }).catch(() => {});
    const shotHubDown = path.join(shotDir, "portal-hub-down.png");
    await page.screenshot({ path: shotHubDown, fullPage: true });
    check((await page.locator('text="Task & Meeting tidak tersedia"').count()) > 0, "13. HUB MATI: panel Main Hub menampilkan 'tidak tersedia' (bukan diam/kosong)", shotHubDown);
    check((await page.locator('.ap-widget').count()) >= 1, "13. HUB MATI: kartu widget workspace (data SANSS sendiri) TETAP tampil, Portal tidak ikut jatuh");
    check((await page.locator('.ap-tombol-utama').count()) > 0, "13. HUB MATI: tombol capsule header tetap berfungsi/tampil");
    const hubDownStatus = await page.evaluate(async () => {
      const token = localStorage.getItem("token");
      const r = await fetch("/api/hub/summary/me", { headers: { authorization: `Bearer ${token}` } });
      return r.status;
    });
    check(hubDownStatus === 503, "13. HUB MATI: GET /hub/summary/me menjawab 503 (bukan 500/hang)", `status=${hubDownStatus}`);
    // Nyalakan lagi HUB (dibutuhkan skenario 5-8 setelah ini) — flag SANA tetap
    // ON, sama seperti skenario 2. HUB_RESOURCE_ACL_ENABLED SENGAJA tidak
    // disertakan di sini (balik ke default OFF) — tidak ada sesi MEMBER/GUEST
    // HUB yang disentuh lagi setelah titik ini sampai skenario 14 menyalakan
    // ulang sendiri; sisa skenario 13 (mobile/CSS smoke) hanya memakai `page`
    // (Owner), yang tidak terdampak flag ini.
    check(await A.startHub({ SANSS_SSO_ENABLED: "true" }), "13. HUB dinyalakan ulang setelah uji 'HUB mati' (dibutuhkan skenario berikutnya)");
    await page.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    check((await page.locator('text="Task & Meeting tidak tersedia"').count()) === 0, "13. HUB NYALA LAGI: Main Hub pulih normal (bukan nyangkut di state 'tidak tersedia')");

    // ── Mobile: Portal + overflow horizontal ──────────────────────────────
    await page.setViewportSize({ width: 390, height: 844 }); // iPhone 12/13
    await page.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    const shotMobile = path.join(shotDir, "portal-mobile.png");
    await page.screenshot({ path: shotMobile, fullPage: true });
    check(true, "13. Screenshot MOBILE /portal disimpan", shotMobile);
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(mobileOverflow <= 2, "13. MOBILE: tidak ada overflow horizontal di /portal", `selisih=${mobileOverflow}px`);
    check((await page.locator(".ap-widget").count()) >= 1 && (await page.locator(".ap-panel").count()) === 3, "13. MOBILE: kartu widget + ketiga panel Main Hub tetap tampil (bukan hilang di breakpoint sempit)");

    // ── Smoke CSS: layar operasional LAIN tidak ikut berubah gara-gara sanss-apple.css global ──
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [route, label] of [["/dashboard", "dashboard-sales-crm"], ["/kendali", "kendali-all-teams"]]) {
      await page.goto(`${A.PUBLIC}${route}`, { waitUntil: "load" });
      await page.waitForTimeout(1200);
      const shotOther = path.join(shotDir, `smoke-${label}.png`);
      await page.screenshot({ path: shotOther, fullPage: true });
      const bodyText = await page.locator("body").innerText().catch(() => "");
      check(!/something went wrong|terjadi kesalahan/i.test(bodyText), `13. SMOKE CSS: ${route} render tanpa boundary galat`, shotOther);
      const overflowOther = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(overflowOther <= 2, `13. SMOKE CSS: ${route} tidak overflow horizontal (CSS Apple global tidak bocor)`, `selisih=${overflowOther}px`);
    }
    await page.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" }); // kembalikan page ke /portal untuk skenario berikutnya
  } catch (e) {
    const shotPath = path.join(shotDir, "qa-mainhub-fail.png");
    await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
    check(false, "13. QA visual Main Hub: skenario gagal", `${e.message} — screenshot: ${shotPath} — url=${page.url()}`);
  }

  // ═══ 14. Smoke browser — resource ACL (server/policy/access.ts, repo HUB) ═
  // Kandidat implementasi QA-tertutup sendiri lewat skrip langsung terhadap
  // DB staging (scripts/verify-resource-acl.ts, repo HUB, 53/53 lulus) — ini
  // MEMBUKTIKAN wiring-nya lewat browser sungguhan: Server Action HUB yang
  // benar-benar menolak, bukan cuma fungsi kebijakannya terisolasi. Flag
  // default OFF di produksi — DINYALAKAN di sini khusus untuk skenario ini,
  // DIMATIKAN lagi sebelum skenario berikutnya lanjut.
  console.log("\n== Smoke browser: resource ACL (dua MEMBER, dua proyek terpisah) ==");
  // Dideklarasikan di sini (bukan `const` di dalam try) supaya tetap
  // terjangkau dari blok 14c SETELAH try/catch/finally ini (14c sengaja di
  // luar, bukan di dalam `finally` — lihat alasan di komentar finally-nya).
  let loginA, pageAclA, loginB, pageAclB;
  try {
    // startHub() TIDAK menghentikan proses lama sendiri (lihat run-apps.mjs)
    // — memanggilnya tanpa stopProc dulu membiarkan proses HUB SEBELUMNYA
    // (flag lama) tetap hidup di port yang sama, dan waitReady() bisa lolos
    // membaca balasan dari proses LAMA itu, bukan yang baru. Setiap
    // panggilan startHub di bawah (di sini maupun di `finally`) didahului
    // stopProc("hub") sendiri, persis pola bookend-awal/akhir file ini.
    await A.stopProc("hub");
    check(await A.startHub({ SANSS_SSO_ENABLED: "true", HUB_RESOURCE_ACL_ENABLED: "true" }), "14. HUB dinyalakan ulang dengan HUB_RESOURCE_ACL_ENABLED=true");

    const aclSeed = parseResult(
      sh("node", ["scripts/stage5-rehearsal/seed-acl-fixture.mjs", A.HUB_DB, A.HUB_WORKSPACE_ID, seed.leaderA.id, seed.leaderB.id], HUB_DIR),
    );
    check(aclSeed?.ok === true, "14. Fixture dua proyek terpisah (ACL Proyek A/B, ProjectMember satu-satu) dibuat", JSON.stringify(aclSeed));

    async function loginIntoHub(email) {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const p = await loginViaUI(ctx, email, seed.password);
      await p.goto(`${A.PUBLIC}/portal`, { waitUntil: "load" });
      const hubCard = p.locator('text="Task & Meeting"').first();
      const seen = await hubCard.waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
      if (seen) await Promise.all([p.waitForURL(`${A.PUBLIC}/workspace/meetings`, { timeout: 20000 }).catch(() => {}), hubCard.click()]);
      return { ctx, page: p };
    }

    loginA = await loginIntoHub(seed.leaderA.email);
    pageAclA = loginA.page;
    loginB = await loginIntoHub(seed.leaderB.email);
    pageAclB = loginB.page;
    check(pageAclA.url() === `${A.PUBLIC}/workspace/meetings` && pageAclB.url() === `${A.PUBLIC}/workspace/meetings`, "14. leaderA dan leaderB masuk sesi HUB (browser nyata, bukan panggilan API langsung)");

    // ── leaderA: proyek SENDIRI (A) terbuka, tugasnya terlihat ──────────────
    await pageAclA.goto(`${A.PUBLIC}${aclSeed.projectA.boardUrl}`, { waitUntil: "load" });
    await pageAclA.waitForTimeout(1200);
    check((await pageAclA.locator(`text="${aclSeed.projectA.taskTitle}"`).count()) > 0, "14. leaderA membuka board proyek SENDIRI (A) -> tugasnya terlihat", pageAclA.url());

    // ── leaderA: proyek LEADERB (B) lewat deep link paksa -> DITOLAK, bukan bocor ──
    await pageAclA.goto(`${A.PUBLIC}${aclSeed.projectB.boardUrl}`, { waitUntil: "load" });
    await pageAclA.waitForTimeout(1200);
    const leakedToA = (await pageAclA.locator(`text="${aclSeed.projectB.taskTitle}"`).count()) > 0;
    check(!leakedToA, "14. leaderA deep-link ke board proyek B (BUKAN anggota) -> judul tugas rahasia B TIDAK terlihat", pageAclA.url());
    const bodyTextA = await pageAclA.locator("body").innerText().catch(() => "");
    check(/not found|tidak ditemukan|404/i.test(bodyTextA), "14. leaderA ke board proyek B -> halaman menyatakan tidak ditemukan (404), bukan diam kosong", bodyTextA.slice(0, 200));

    // ── leaderA: tugas B lewat deep link task id langsung (bukan cuma board) ──
    const taskDeepLinkA = `${A.PUBLIC}${aclSeed.projectB.boardUrl}?task=${aclSeed.projectB.taskId}`;
    await pageAclA.goto(taskDeepLinkA, { waitUntil: "load" });
    await pageAclA.waitForTimeout(1000);
    check((await pageAclA.locator(`text="${aclSeed.projectB.taskTitle}"`).count()) === 0, "14. leaderA deep-link LANGSUNG ke taskId milik B (?task=...) -> judul tetap TIDAK terlihat");

    // ── leaderB: simetris — proyek sendiri (B) ok, proyek A ditolak ─────────
    await pageAclB.goto(`${A.PUBLIC}${aclSeed.projectB.boardUrl}`, { waitUntil: "load" });
    await pageAclB.waitForTimeout(1200);
    check((await pageAclB.locator(`text="${aclSeed.projectB.taskTitle}"`).count()) > 0, "14. leaderB membuka board proyek SENDIRI (B) -> tugasnya terlihat");

    await pageAclB.goto(`${A.PUBLIC}${aclSeed.projectA.boardUrl}`, { waitUntil: "load" });
    await pageAclB.waitForTimeout(1200);
    const leakedToB = (await pageAclB.locator(`text="${aclSeed.projectA.taskTitle}"`).count()) > 0;
    check(!leakedToB, "14. leaderB deep-link ke board proyek A (BUKAN anggota) -> judul tugas rahasia A TIDAK terlihat", pageAclB.url());

    // ── Sidebar: proyek orang lain tidak muncul dalam daftar yang bisa dipilih ──
    await pageAclA.goto(`${A.PUBLIC}/workspace/projects`, { waitUntil: "load" });
    await pageAclA.waitForTimeout(1000);
    check((await pageAclA.locator('text="ACL Proyek B"').count()) === 0, "14. leaderA: daftar /projects TIDAK menampilkan 'ACL Proyek B' (sidebar/daftar ikut gerbang visibleProjectIds)");
    check((await pageAclA.locator('text="ACL Proyek A"').count()) > 0, "14. leaderA: daftar /projects TETAP menampilkan proyeknya sendiri ('ACL Proyek A')");

    // Screenshot bukti untuk laporan.
    const aclShotDir = path.join(os.tmpdir(), "sso-rehearsal-resource-acl");
    await fsp.mkdir(aclShotDir, { recursive: true }).catch(() => {});
    await pageAclA.goto(`${A.PUBLIC}${aclSeed.projectA.boardUrl}`, { waitUntil: "load" });
    await pageAclA.screenshot({ path: path.join(aclShotDir, "leaderA-own-project-board.png"), fullPage: true });
    await pageAclA.goto(`${A.PUBLIC}${aclSeed.projectB.boardUrl}`, { waitUntil: "load" });
    await pageAclA.screenshot({ path: path.join(aclShotDir, "leaderA-denied-project-b-board.png"), fullPage: true });
    check(true, "14. Screenshot bukti (proyek sendiri vs proyek ditolak) disimpan", aclShotDir);

    // ── 14a. Dashboard analytics: OWNER/ADMIN-only, server-side, bukan cuma halaman ──
    // ADMIN (`pageAdmin`, sesi sejak skenario 2) vs leaderA (MEMBER, pageAclA)
    // — sengaja BUKAN `page` (Owner): `page` dipakai skenario 5/8 (Logout)
    // tepat setelah ini untuk menguji sesi Owner yang SUDAH TIDAK disentuh
    // sejak skenario 13 masih dianggap basi oleh cache introspeksi (<=60dtk)
    // SETELAH logout SANSS — menyentuh `page` di sini menyegarkan cache itu
    // tepat sebelum pengujiannya sendiri dan membuatnya flaky. `pageAdmin`
    // sama validnya untuk membuktikan klausa "OWNER/ADMIN" kebijakan ini.
    await pageAdmin.goto(`${A.PUBLIC}/workspace/dashboard`, { waitUntil: "load" });
    await pageAdmin.waitForTimeout(800);
    check((await pageAdmin.locator('text="Status breakdown"').count()) > 0, "14a. ADMIN membuka /workspace/dashboard -> analitik workspace TERLIHAT");
    await pageAclA.goto(`${A.PUBLIC}/workspace/dashboard`, { waitUntil: "load" });
    await pageAclA.waitForTimeout(800);
    const memberSeesAnalytics = (await pageAclA.locator('text="Status breakdown"').count()) > 0;
    check(!memberSeesAnalytics, "14a. leaderA (MEMBER) membuka /workspace/dashboard -> analitik TIDAK terlihat (PermissionDenied), bukan cuma menu disembunyikan");
    const deniedBodyText = await pageAclA.locator("body").innerText().catch(() => "");
    check(/don.?t have access/i.test(deniedBodyText), "14a. leaderA -> halaman menyatakan tidak punya akses (PermissionDenied), bukan kosong diam", deniedBodyText.slice(0, 200));
    check((await pageAclA.locator('a:has-text("Go to My Tasks")').count()) > 0, "14a. PermissionDenied di /dashboard mengarahkan ke /my-tasks (bukan link balik ke /dashboard itu sendiri)");
    // Sidebar: link "Overview" (/dashboard) juga disembunyikan untuk MEMBER, bukan cuma halamannya yang menolak.
    await pageAclA.goto(`${A.PUBLIC}/workspace/my-tasks`, { waitUntil: "load" });
    await pageAclA.waitForTimeout(500);
    check((await pageAclA.locator('nav a[href="/workspace/dashboard"]').count()) === 0, "14a. Sidebar leaderA (MEMBER) TIDAK menampilkan link Overview/Dashboard");

    // ── 14b. Panel pengelolaan akses (OWNER/ADMIN-only) benar-benar mengubah akses ──
    // Tambah leaderB sebagai ProjectMember proyek A (sebelumnya hanya leaderA), lewat UI nyata.
    // Dipakai `pageAdmin`, bukan `page` — lihat alasan di 14a.
    const projectASettingsUrl = aclSeed.projectA.boardUrl.replace(/\/board$/, "/settings");
    await pageAdmin.goto(`${A.PUBLIC}${projectASettingsUrl}`, { waitUntil: "load" });
    await pageAdmin.locator("#members").getByRole("button", { name: "Add member" }).click();
    const picker = pageAdmin.locator("#members select");
    await picker.waitFor({ state: "visible", timeout: 10000 });
    await pageAdmin.waitForFunction(
      (sel) => !sel.disabled && Array.from(sel.options).some((o) => o.textContent?.toLowerCase().includes("leader gudang")),
      await picker.elementHandle(),
      { timeout: 10000 },
    ).catch(() => {});
    const leaderBOptionValue = await picker.evaluate((sel) => {
      const opt = Array.from(sel.options).find((o) => o.textContent?.toLowerCase().includes("leader gudang"));
      return opt ? opt.value : null;
    });
    check(!!leaderBOptionValue, "14b. leaderB (Leader Gudang) muncul sebagai kandidat yang BISA ditambahkan ke proyek A");
    if (leaderBOptionValue) {
      await picker.selectOption(leaderBOptionValue);
      await pageAdmin.locator("#members").getByRole("button", { name: "Add" }).click();
      await pageAdmin.locator("#members li").nth(1).waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
      check((await pageAdmin.locator("#members li").count()) === 2, "14b. Setelah menambah: panel Members proyek A menunjukkan 2 orang (leaderA + leaderB)");
    }

    // leaderB (sesi browser YANG SAMA, tanpa login ulang) sekarang bisa membuka proyek A.
    await pageAclB.goto(`${A.PUBLIC}${aclSeed.projectA.boardUrl}`, { waitUntil: "load" });
    await pageAclB.waitForTimeout(1000);
    check((await pageAclB.locator(`text="${aclSeed.projectA.taskTitle}"`).count()) > 0, "14b. SETELAH ditambahkan: leaderB membuka board proyek A -> tugasnya kini TERLIHAT, tanpa login ulang");

    // Cabut lagi lewat UI yang sama — baris yang BARU ditambahkan selalu paling akhir (orderBy createdAt asc).
    await pageAdmin.locator("#members li").last().getByRole("button", { name: "Remove" }).click();
    await pageAdmin.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
    await pageAdmin.locator("#members li").nth(1).waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
    check((await pageAdmin.locator("#members li").count()) === 1, "14b. Setelah mencabut: panel Members proyek A kembali ke 1 orang (hanya leaderA)");

    // leaderB (request BERIKUTNYA, sesi browser yang sama) ditolak lagi — pencabutan berlaku tanpa logout.
    await pageAclB.goto(`${A.PUBLIC}${aclSeed.projectA.boardUrl}`, { waitUntil: "load" });
    await pageAclB.waitForTimeout(1000);
    check((await pageAclB.locator(`text="${aclSeed.projectA.taskTitle}"`).count()) === 0, "14b. SETELAH dicabut: leaderB membuka board proyek A lagi -> tugasnya TIDAK terlihat lagi, request berikutnya saja (tanpa logout)");
  } catch (e) {
    check(false, "14. Smoke browser resource ACL: skenario gagal", e.message);
  } finally {
    // Flag SELALU dikembalikan OFF sebelum skenario lain (5 dst.) lanjut —
    // sama disiplinnya dengan bookend awal/akhir file ini. stopProc dulu —
    // lihat komentar di awal blok try di atas untuk alasannya. SATU restart
    // di sini saja (bukan restart tambahan di 14c lalu restart lagi di
    // sini) — dua restart balik-balik sempat terbukti memicu flake baru di
    // skenario 9 (SSO handoff admin-target macet di /sso/start) saat
    // pertama kali skrip ini ditulis; 14c's sendiri DIPINDAH ke bawah,
    // SETELAH restart ini, supaya cukup SATU restart ke flag OFF.
    await A.stopProc("hub");
    check(await A.startHub({ SANSS_SSO_ENABLED: "true" }), "14. HUB dinyalakan ulang dengan HUB_RESOURCE_ACL_ENABLED kembali OFF (default)");
  }

  // ── 14c. Gerbang fail-closed MEMBER/GUEST saat flag OFF — termasuk sesi yang SUDAH aktif ──
  // leaderA (pageAclA) MASIH login sejak awal skenario 14 (flag ON) — HUB
  // baru saja dinyalakan ulang dengan flag OFF (restart TUNGGAL di atas,
  // finally-nya skenario 14) TANPA leaderA logout; diuji permintaan
  // BERIKUTNYA di sesi browser yang SAMA (bukan sesi baru) ditolak.
  if (!pageAclA || !loginA) {
    check(false, "14c. Gerbang fail-closed: dilewati — prasyarat (login leaderA skenario 14) gagal lebih dulu");
  } else {
    try {
      await pageAclA.goto(`${A.PUBLIC}/workspace/my-tasks`, { waitUntil: "load" });
      check(pageAclA.url() === `${A.PUBLIC}/workspace/acl-pending`, "14c. leaderA (MEMBER, SESI AKTIF, tanpa logout): request berikutnya saat flag OFF -> dialihkan ke /acl-pending", pageAclA.url());
      const pendingBodyText = await pageAclA.locator("body").innerText().catch(() => "");
      check(/belum diaktifkan/i.test(pendingBodyText), "14c. /acl-pending menjelaskan akses belum diaktifkan (bukan pesan 'tidak ada akun')", pendingBodyText.slice(0, 200));
      // ADMIN TIDAK terdampak flag ini sama sekali (lagi-lagi `pageAdmin`, bukan `page` — lihat 14a).
      await pageAdmin.goto(`${A.PUBLIC}/workspace/my-tasks`, { waitUntil: "load" });
      check(pageAdmin.url() === `${A.PUBLIC}/workspace/my-tasks`, "14c. ADMIN TETAP bisa akses HUB meski flag OFF (gerbang pilot ini tidak berlaku untuk OWNER/ADMIN)", pageAdmin.url());
    } catch (e) {
      check(false, "14c. Gerbang fail-closed: skenario gagal", e.message);
    } finally {
      await pageAclA.close().catch(() => {});
      await loginA.ctx.close().catch(() => {});
      if (pageAclB) await pageAclB.close().catch(() => {});
      if (loginB) await loginB.ctx.close().catch(() => {});
    }
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
