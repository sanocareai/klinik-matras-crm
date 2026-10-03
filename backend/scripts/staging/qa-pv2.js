#!/usr/bin/env node
// CLI staging QA-PV2 (P12A). Dijalankan DI DALAM container backend staging (data/ dan JWT_SECRET sama dengan server):
//   docker compose -f docker-compose.staging.yml exec backend-staging node scripts/staging/qa-pv2.js <perintah>
// Perintah:
//   seed [--rotate-passwords]                 master data + akun + 12 unit matriks demo (idempoten)
//   master [--rotate-passwords]               hanya master data + akun
//   unit --stage=<s> [--station=TABLE_1] [--priority=0|1|2] [--docs=lengkap|kurang]   unit baru pada tahap tertentu
//   lifecycle                                 satu lifecycle penuh pickup→…→barang jadi (unit baru)
//   status                                    ringkasan unit QA-PV2 dan data non-QA-PV2 (harus 0)
//   training                                  (P12B) master data + 9 unit latihan untuk 7 skenario (S1–S7); jalankan SETELAH 'reset --yes' (jangan campur dengan matriks demo)
//   credentials [--role=lead,meja1]           (P12B) terbitkan password akun latihan SEKALI-TAMPIL di terminal (tidak disimpan; ulang = password lama batal)
//   reset --yes                               kosongkan HANYA data staging (menolak bila ada data non-QA-PV2)
// Keselamatan: hanya APP_ENV=staging|test dan DATABASE_URL bertanda staging/qa/test; production ditolak sebelum query apa pun.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertQaPv2Safe } from "./qaPv2Safety.js";

const [cmd = "help", ...rest] = process.argv.slice(2);
const flag = (name, def = null) => { const a = rest.find((x) => x === `--${name}` || x.startsWith(`--${name}=`)); return a === undefined ? def : a.includes("=") ? a.split("=").slice(1).join("=") : true; };

if (cmd === "help" || cmd === "--help") {
  console.log("perintah: seed | master | unit --stage=<s> | lifecycle | training | credentials | status | reset --yes   (lihat komentar kepala berkas)");
  process.exit(0);
}
try { assertQaPv2Safe(); } catch (e) { console.error(e.message); process.exit(2); } // SEBELUM mengimpor db/Prisma

const { prisma } = await import("../../src/db.js");
const { makeKit } = await import("./qaPv2Kit.js");
const S = await import("./qaPv2Seed.js");
const T = await import("./qaPv2Training.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = process.env.QA_PV2_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4000}`;
const kit = makeKit({ baseUrl, jwtSecret: process.env.JWT_SECRET, log: console.log });
const ctx = { prisma, kit, baseUrl, dataDir: process.env.QA_PV2_DATA_DIR || path.resolve(here, "../../data"), log: console.log };

try {
  if (cmd === "seed" || cmd === "master" || cmd === "unit" || cmd === "lifecycle") {
    console.log("[qa-pv2] master data + akun…");
    const W = await S.ensureMaster(ctx, { rotate: flag("rotate-passwords", false) === true });
    if (cmd === "seed") console.log(JSON.stringify(await S.seedMatrix(ctx, W), null, 1));
    if (cmd === "unit") {
      const stage = flag("stage"); if (!S.STAGE_ORDER.includes(stage)) throw new Error(`--stage harus salah satu: ${S.STAGE_ORDER.join(", ")}`);
      console.log(JSON.stringify(await S.runLifecycle(ctx, W, { stage, station: flag("station", "TABLE_1"), prio: Number(flag("priority", 0)), docs: flag("docs", "kurang") })));
    }
    if (cmd === "lifecycle") console.log(JSON.stringify(await S.runLifecycle(ctx, W, { stage: "siap_kirim" })));
    console.log(`[qa-pv2] selesai. Kredensial (acak) ada di ${path.join(ctx.dataDir, "qa-pv2-credentials.json")} — TIDAK dicetak.`);
  } else if (cmd === "training") {
    console.log("[qa-pv2] master data + akun…");
    const W = await S.ensureMaster(ctx, {});
    console.log(JSON.stringify(await T.seedTraining(ctx, W), null, 1));
    console.log("[qa-pv2] skenario latihan siap. Terbitkan kredensial peserta: qa-pv2.js credentials");
  } else if (cmd === "credentials") {
    const keys = flag("role", null); const issued = await T.issueCredentials(ctx, typeof keys === "string" ? keys.split(",").map((x) => x.trim()) : null);
    console.log("PASSWORD INI TAMPIL SEKALI. Jangan disalin ke chat/repo/log. Menjalankan perintah ini lagi membatalkan password di bawah.");
    console.log("");
    console.log("PERAN".padEnd(18), "EMAIL (login)".padEnd(38), "PASSWORD");
    for (const r of issued) console.log(r.peran.padEnd(18), r.email.padEnd(38), r.password);
  } else if (cmd === "status") {
    console.log(JSON.stringify(await S.statusQaPv2(ctx), null, 1));
  } else if (cmd === "reset") {
    console.log(JSON.stringify(await S.resetQaPv2(ctx, { yes: flag("yes", false) === true })));
  } else { console.error(`perintah tidak dikenal: ${cmd}`); process.exitCode = 1; }
} catch (e) { console.error(`[qa-pv2] GAGAL: ${e.message}`); process.exitCode = 1; } finally { await prisma.$disconnect(); }
