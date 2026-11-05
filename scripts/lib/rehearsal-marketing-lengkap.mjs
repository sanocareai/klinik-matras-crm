import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APP = process.env.APP_DIR ?? "/app"; // lokal (uji skrip ini): APP_DIR menunjuk ke folder backend; di kontainer rilis = /app
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const SMOKE_SRC = "@@SMOKE_SRC@@"; // diganti generator dengan invarian-marketing-lengkap.mjs (tanpa export) + smoke-marketing-lengkap.mjs
const INVARIAN_SRC = "@@INVARIAN_SRC@@"; // diganti generator dengan isi invarian-marketing-lengkap.mjs APA ADANYA (dengan export), dimuat lewat data: URL untuk uji rentang tambahan
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji Marketing hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "Marketing lengkap": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4103, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production.
// Rilis ini TIDAK punya jalur tulis baru: seluruh uji hanya membaca (GET). Bagian A = smoke yang sama dengan fase 8b. Bagian B = rentang tambahan (7 hari, 90 hari, bulan lalu) dibandingkan dengan SQL independen.
// Bukti "tanpa tulisan": hitungan tabel inti sebelum vs sesudah identik (DB rehearsal tidak menerima aktivitas lain).
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); const dibuang = neutralizeExternalEnv(process.env);
// ── BUKTI ISOLASI (SEBELUM aplikasi rehearsal berjalan; fail-closed). Hanya NAMA variabel/DB yang dicetak, tidak ada nilai rahasia. ──
// neutralizeExternalEnv tidak mencakup token Meta, sinkron spend, dan nomor alert atribusi: dibuang di sini khusus proses rehearsal.
const EKSTRA = ["META_ADS_ACCESS_TOKEN", "META_ADS_ACCOUNT_ID", "ATRIBUSI_ALERT_NOTIFY_PHONE", "TIKTOK_ADS_ACCESS_TOKEN", "WINDSOR_API_KEY"];
for (const k of EKSTRA) if (process.env[k] !== undefined) { delete process.env[k]; dibuang.push(k); }
process.env.SPEND_SYNC_ENABLED = "false"; process.env.DISABLE_BACKGROUND_JOBS = "1";
const urlDb = (() => { try { return decodeURIComponent(new URL(String(process.env.DATABASE_URL)).pathname.replace(/^\//, "")); } catch { return null; } })();
cek("isolasi: DATABASE_URL aplikasi rehearsal menunjuk DB sementara rehearsal_* (BUKAN klinik_matras) dan sama dengan koneksi Prisma proses ini", urlDb !== null && urlDb !== "klinik_matras" && /^rehearsal_/.test(urlDb) && urlDb === nm, `db=${urlDb}`);
const WASPADA = ["WAHA_BASE_URL", "WAHA_API_KEY", "WAHA_SESSION", "WAHA_BUSINESS_NUMBER", "AUTOMATION_WEBHOOK_URL", "AUTOMATION_WEBHOOK_SECRET", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "IG_ACCESS_TOKEN", "SMTP_HOST", "SMTP_URL", "FCM_SERVICE_ACCOUNT", "FCM_SERVICE_ACCOUNT_JSON", "EXPO_ACCESS_TOKEN", "VAPID_PRIVATE_KEY", "MCP_HUB_API_TOKEN", "MCP_API_TOKEN", ...EKSTRA];
const sisa = WASPADA.filter((k) => process.env[k] !== undefined);
cek("isolasi: tidak ada konfigurasi integrasi eksternal tersisa (WhatsApp/WAHA, webhook keluar, email, push, AI, Maps, token Meta/TikTok/Windsor, nomor alert)", sisa.length === 0, `variabel dibuang=${dibuang.length}${dibuang.length ? " (" + dibuang.join(",") + ")" : ""}; tersisa=${sisa.join(",") || "tidak ada"}`);
cek("isolasi: job latar/scheduler dan sinkron spend dimatikan untuk proses rehearsal (DISABLE_BACKGROUND_JOBS=1, SPEND_SYNC_ENABLED=false)", process.env.DISABLE_BACKGROUND_JOBS === "1" && process.env.SPEND_SYNC_ENABLED === "false", "");
if (gagal > 0) { await prisma.$disconnect(); process.exit(1); }
const PORT = Number(process.env.REH_PORT ?? 4103); const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1", SPEND_SYNC_ENABLED: "false" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await prisma.$disconnect(); process.exit(1); }
await new Promise((r) => setTimeout(r, 1500));
cek("isolasi: server rehearsal sendiri melaporkan job latar & worker pengirim dimatikan", /job latar & worker pengirim dimatikan/.test(log), log.split("\n").filter((l) => /dimatikan/.test(l)).slice(0, 2).join(" | "));
if (gagal > 0) { berhenti(); await prisma.$disconnect(); process.exit(1); }

const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const token = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "25m" });
const semua = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); let admin = null; for (const u of semua) if ((await rolesDari(u)).has("ADMIN")) { admin = u; break; }
admin = admin ?? await prisma.user.create({ data: { name: "REH Admin", email: `reh-mkl-${Date.now().toString(36)}@example.test`, passwordHash: "x", role: "ADMIN" } });
const tA = await token(admin);
const TABEL = [["customer", 'select count(*)::int n from "Customer"'], ["order", 'select count(*)::int n from "Order"'], ["payments", "select count(*)::int n from payments"], ["kredit_order", "select count(*)::int n from fin_order_credits"], ["refund", "select count(*)::int n from fin_refunds"],
  ["transisi", "select count(*)::int n from pipeline_transitions"], ["touch", "select count(*)::int n from attribution_touches"], ["spend_ad", "select count(*)::int n from meta_ad_daily_spend"], ["impor_spend", "select count(*)::int n from meta_spend_imports"],
  ["biaya_sumber", "select count(*)::int n from ad_source_spend_entries"], ["biaya_sumber_revisi", "select count(*)::int n from ad_source_spend_revisions"], ["jurnal", "select count(*)::int n from fin_journal_entries"], ["stock_movements", "select count(*)::int n from stock_movements"]];
const jejak = async () => Object.fromEntries(await Promise.all(TABEL.map(async ([k, q]) => [k, await num(q)])));
const sama = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);
const j0 = await jejak();

// ── A. SMOKE pasca-switch (kode yang sama dengan fase 8b) terhadap server rehearsal ──
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 600000, env: { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP } });
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
console.log(String(sm.stdout).split("\n").filter((l) => /^\s+(PASS|FAIL|SKIP|INFO)/.test(l)).join("\n"));
cek("SMOKE pasca-switch (kode yang sama dengan fase 8b) lulus terhadap server rehearsal: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-150));

// ── B. rentang tambahan terhadap SQL independen (server rehearsal; hanya GET) ──
// Fungsi invarian dimuat dari INVARIAN_SRC lewat data: URL (tanpa berkas sementara).
const modul = await import("data:text/javascript;base64," + Buffer.from(INVARIAN_SRC).toString("base64"));
const { periksaLaporan, banding, petaSql, SQL_BANDING } = modul;
const geser = (ymd, k) => new Date(Date.parse(`${ymd}T00:00:00Z`) + k * 86400_000).toISOString().slice(0, 10);
const hariIni = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); const kemarin = geser(hariIni, -1);
const naive = (ymd) => new Date(Date.parse(`${ymd}T00:00:00+07:00`)).toISOString().replace("T", " ").slice(0, 19);
const RENTANG = [["7 hari penuh", geser(kemarin, -6), kemarin], ["90 hari penuh", geser(kemarin, -89), kemarin], ["bulan lalu penuh", `${geser(hariIni.slice(0, 8) + "01", -1).slice(0, 8)}01`, geser(hariIni.slice(0, 8) + "01", -1)]];
for (const [nama, dari, sampai] of RENTANG) {
  const r = await fetch(`${BASE}/api/atribusi/iklan/sumber?dari=${dari}&sampai=${sampai}`, { headers: { Authorization: "Bearer " + tA } }); const d = await r.json().catch(() => null);
  cek(`rentang ${nama} (${dari}..${sampai}): 200`, r.status === 200, `${r.status}`); if (r.status !== 200) continue;
  const g = periksaLaporan(d).filter((x) => !x.ok).map((x) => x.n); cek(`rentang ${nama}: seluruh invarian laporan lulus`, g.length === 0, g.join(" | "));
  const b = banding(d, petaSql(await prisma.$queryRawUnsafe(SQL_BANDING, naive(dari), naive(geser(sampai, 1))))); cek(`rentang ${nama}: laporan = SQL independen (lead, spam, sah, prospek eksplisit, atau-lanjut per sumber)`, b.every((x) => x.ok), b.filter((x) => !x.ok).map((x) => x.d).join(" | "));
}
cek("seluruh uji hanya membaca: hitungan customer, order, payments, kredit, refund, transisi, touch, spend, biaya sumber, jurnal, stok IDENTIK sebelum vs sesudah", sama(await jejak(), j0), JSON.stringify(await jejak()));
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
