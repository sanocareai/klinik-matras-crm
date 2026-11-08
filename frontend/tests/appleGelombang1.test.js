// Gelombang 1 redesain Apple (Main Hub, Delivery, All Teams): kontrak struktur. Data, izin, tujuan klik, dan arti angka tidak berubah; hanya tampilan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const baca = (f) => fs.readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

test("ikon info 'i': tombol sungguhan (klik/ketuk/keyboard), aria-expanded, Esc menutup, TIDAK bergantung hover", () => {
  const a = baca("components/apple/Apple.jsx");
  assert.match(a, /<button type="button" aria-expanded=\{buka\}/); assert.match(a, /aria-controls/); assert.match(a, /e\.key === "Escape"/); assert.match(a, /pointerdown/);
  assert.doesNotMatch(a, /onMouseEnter|onMouseOver|onMouseLeave/, "tidak ada tooltip hover");
  assert.match(a, /role="note"/);
  const css = baca("styles/sanss-apple.css"); assert.match(css, /\.ap-i > button \{[^}]*width: 28px/); assert.match(css, /@media \(max-width: 767px\) \{[^}]*\.ap-i > button \{ width: 44px; height: 44px; \}/, "area sentuh 44px di HP");
});

test("CSS bersama: selektor terkunci ke .ap- (dan :root/.app-shell.ap-skin untuk tipografi); tidak menyentuh kelas workspace lain", () => {
  const css = baca("styles/sanss-apple.css");
  for (const baris of css.split("\n")) { const t = baris.trim(); if (/^\.[a-z]/.test(t) && !/^\.ap-/.test(t)) assert.fail(`selektor di luar lingkup: ${t.slice(0, 60)}`); }
  assert.doesNotMatch(css, /\.gud-|\.nip-|\.crm-(?!skin)|\.sidebar\s*\{/); assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  for (const f of fs.readdirSync(new URL("../src/styles/", import.meta.url)).filter((x) => x.endsWith(".css") && x !== "sanss-apple.css")) assert.ok(!/\.ap-ubin|\.ap-widget/.test(baca(`styles/${f}`)), `${f} memakai kelas ap-`);
});

test("Layout: kerangka baru hanya untuk Main Hub, Delivery, All Teams; pekerja lapangan (driver/helper) dan APK driver dikecualikan", () => {
  const l = baca("components/Layout.jsx");
  // Gelombang 2 menambahkan B2B ke daftar yang sama (Sales, Finance, Produksi, Gudang tetap di luar).
  assert.match(l, /const apSkin = \(onHub \|\| divisionKey === "armada" \|\| divisionKey === "kendali" \|\| divisionKey === "b2b"\) && !driverOnly && !IS_DRIVER_APP && !CRM_SKIN_OFF;/);
  assert.match(l, /apSkin && "ap-skin"/); assert.match(l, /useWorkspaceFont\(apSkin, "apple"\)/); assert.ok(!/divisionKey === "(growth|finance|bengkel|warehouse)"( \|\| [^)]*)?\) && !driverOnly/.test(l), "workspace yang belum bermigrasi tidak ikut apSkin");
});

test("Main Hub: logika auto-skip & tujuan klik tidak berubah; angka hanya dari server; deskripsi panjang di ikon info", () => {
  const p = baca("pages/Portal.jsx");
  assert.match(p, /landingPathFor\(\{ roles: rolesOf\(/); assert.match(p, /if \(list\.length === 1\)/); assert.match(p, /api\.getPortalSummary\(\)/);
  assert.match(p, /onOpen=\{\(p\) => navigate\(p\.path\)\}/, "klik kartu langsung ke halaman kerja");
  assert.match(p, /info=\{portal\.description\}/); assert.doesNotMatch(p, /HeroArt|PortalHero|WORKSPACE_ART/);
  assert.match(p, /\{stat \? \(/); assert.match(p, /Buka workspace/, "tanpa angka = 'Buka workspace', bukan angka karangan");
});

test("Delivery dashboard: tujuan klik & angka sama; kartu widget; panel Apple; tanpa tulis baru", () => {
  const d = baca("pages/armada/ArmadaDashboard.jsx");
  for (const k of ['navigate("/armada/jobs?status=UNSCHEDULED")', 'navigate("/armada/jobs?status=COMPLETED")', 'navigate("/armada/jobs")', "unscheduled?.length ?? 0", "overdueJobs.length", "driversActiveCount", "completedCount"]) assert.ok(d.includes(k), k);
  assert.match(d, /<KartuWidget nada="jingga"/); assert.match(d, /data-testid="armada-ringkasan"/); assert.doesNotMatch(d, /DashboardSnapshot/); assert.ok(!/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(d));
});

test("All Teams: angka & sumber /kendali/overview tidak berubah; Rework rate tetap '—' bila data belum cukup", () => {
  const k = baca("pages/Kendali.jsx");
  assert.match(k, /units\.totalUnits/); assert.match(k, /units\.blocked\.length/); assert.match(k, /rework\.reworkRate == null \? "—"/); assert.match(k, /driverActivity\.reduce\(\(n, d\) => n \+ d\.completed \+ d\.failed, 0\)/);
  assert.match(k, /data-testid="kendali-ringkasan"/); assert.doesNotMatch(k, /import { WorkspaceHero }|<WorkspaceHero/);
});
