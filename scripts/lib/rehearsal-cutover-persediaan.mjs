import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APP = process.env.APP_DIR ?? "/app"; // lokal (uji skrip ini): APP_DIR menunjuk ke folder backend; di kontainer rilis = /app
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 260) : ""}`); };
const SMOKE_SRC = "@@SMOKE_SRC@@"; // diganti generator dengan isi smoke-cutover-persediaan.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji batas cutover hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL perbaikan batas cutover: kode BARU sebagai SERVER terhadap SALINAN RESTORE (DB rehearsal_*, dibuang). Bagian A = smoke fase 8b; Bagian B MENULIS hanya pada salinan.
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = Number(process.env.REH_PORT ?? 4103); const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await prisma.$disconnect(); process.exit(1); }

// ── A. SMOKE (kode yang sama dengan fase 8b) ──
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 600000, env: { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP } });
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0];
console.log(String(sm.stdout).split("\n").filter((l) => /^\s+(PASS|FAIL|SKIP|INFO)/.test(l)).join("\n"));
cek("SMOKE lulus terhadap salinan restore: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + String(sm.stderr).slice(-200));

// ── B. Batas cutover pada salinan ──
const P = await imp("src/services/finance/persediaanAwal.js");
const { setSetting, SETTING_KEYS } = await imp("src/services/finance/settings.js");
const { todayBookDateWIB } = await imp("src/services/finance/journal.js");
const tx = (fn) => prisma.$transaction(fn, { timeout: 120000, maxWait: 20000 });
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const pembuat = await prisma.user.findFirst({ where: { active: true }, orderBy: { id: "asc" }, select: { id: true } });
const pemeriksa = await prisma.user.findFirst({ where: { active: true, id: { not: pembuat.id } }, orderBy: { id: "asc" }, select: { id: true } });
const hari = todayBookDateWIB().toISOString().slice(0, 10);
const gerak0 = await num("select count(*)::int n from stock_movements");
const lama = await prisma.finInventoryOpening.findMany({ where: { status: "DRAFT" }, select: { id: true } });
await tx(async (t) => { for (const o of lama) await P.batalkanDraf(t, { openingId: o.id }); await setSetting(t, SETTING_KEYS.INVENTORY_CUTOVER_DATE, hari, pembuat.id); });
const o = await tx((t) => P.buatDraf(t, { userId: pembuat.id, notes: "Uji rehearsal" }));
const m = (await prisma.$queryRawUnsafe("select m.code, m.unit::text unit from materials m where m.code = 'LEM-I-SR-1037-13-KG'"))[0] ?? (await prisma.$queryRawUnsafe("select m.code, m.unit::text unit from materials m where m.active order by m.code limit 1"))[0];
await tx((t) => P.isiBaris(t, { openingId: o.id, rows: [{ kode: m.code, qty: "17.2231", satuan: m.unit, harga: "1000", sumber: "LAINNYA", penjelasanHarga: "Uji rehearsal presisi kuantitas" }], mode: "ganti", userId: pembuat.id }));
const baris = await prisma.finInventoryOpeningLine.findFirst({ where: { openingId: o.id } });
cek("PSA menyimpan kuantitas 4 desimal tanpa pembulatan", String(baris.qty) === "17.2231" && Number(baris.value) === 17223.1, `${baris.qty} / ${baris.value}`);
await tx((t) => P.periksa(t, { openingId: o.id, peran: "FINANCE", userId: pembuat.id })); await tx((t) => P.periksa(t, { openingId: o.id, peran: "GUDANG", userId: pemeriksa.id }));
const post = await tx((t) => P.postingPembuka(t, { openingId: o.id, userId: pembuat.id, reason: "Uji rehearsal" }));
const post2 = await tx((t) => P.postingPembuka(t, { openingId: o.id, userId: pembuat.id, reason: "Uji rehearsal" }));
cek("posting PSA satu kali, ulang tidak ganda", post.dibuat === true && post2.dibuat === false);
const grLama = await prisma.goodsReceipt.findFirst({ where: { status: "COMPLETED", receivedDate: { lt: new Date(`${hari}T00:00:00Z`) }, movements: { some: {} } }, select: { id: true, receivedDate: true } }).catch(() => null);
if (grLama) cek("GR yang sudah di ledger sebelum waktu hitung tetap tercakup", (await P.penerimaanTercakupPembuka(prisma, grLama.id, grLama.receivedDate)) === true);
cek("uji cutover tidak menambah pergerakan stok", (await num("select count(*)::int n from stock_movements")) === gerak0);
if (grLama) { const { postStockMovement } = await imp("src/services/inventoryLedger.js"); const contoh = await prisma.stockMovement.findFirst({ where: { goodsReceiptId: grLama.id, type: "RECEIPT" }, select: { materialId: true } }); await tx((t) => postStockMovement(t, { materialId: contoh.materialId, type: "RECEIPT", qty: 1, goodsReceiptId: grLama.id, createdById: pembuat.id, note: "Uji rehearsal" })); cek("RECEIPT tertulis sesudah waktu hitung tidak dianggap tercakup", (await P.penerimaanTercakupPembuka(prisma, grLama.id, grLama.receivedDate)) === false); }
const balik = await tx((t) => P.balikPembuka(t, { openingId: o.id, userId: pembuat.id, reason: "Uji rehearsal" }));
cek("pembalikan PSA resmi berhasil", balik.dibuat === true && balik.opening.status === "DIBALIK");
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
