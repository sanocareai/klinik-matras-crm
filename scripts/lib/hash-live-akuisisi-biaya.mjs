// BACA-SAJA. Dijalankan di image LAMA (rollback) dan di container BARU terhadap DB PRODUKSI yang sama: menghitung laporan lewat router asli masing-masing dengan sesi ADMIN sintetis (JWT dari JWT_SECRET lingkungan; tidak ada akun/kata sandi).
// Keluaran: AGREGAT (lead/ber-order/membayar/lunas/nilai/uang per sumber), HASH_IKLAN + HASH_D7 (laporan per campaign dan D7), MONITOR_CAPTURE (flag capture). Skrip rilis membandingkan keluaran lama vs baru.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken"); const express = require("express");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const DARI = process.env.PER_DARI, SAMPAI = process.env.PER_SAMPAI;
const { attributionAdsRouter } = await import("/app/src/routes/attributionAds.js");
let adm = null;
for (const u of await prisma.user.findMany({ where: { active: true } })) { const rs = new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]); if (rs.has("ADMIN")) { adm = u; break; } }
if (!adm) { console.log("GAGAL tidak ada akun ADMIN aktif"); process.exit(1); }
const tok = jwt.sign({ id: adm.id, name: adm.name, role: adm.role, roles: ["ADMIN"] }, process.env.JWT_SECRET, { expiresIn: "5m" });
const app = express(); app.use("/api/atribusi/iklan", attributionAdsRouter);
const srv = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); }); const BASE = `http://127.0.0.1:${srv.address().port}/api/atribusi/iklan`;
const ambil = async (p) => { const r = await fetch(BASE + p, { headers: { Authorization: "Bearer " + tok } }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { s: r.status, j }; };
const bersih = (o) => JSON.parse(JSON.stringify(o, (k, v) => (["dihitungPada", "waktuWib", "waktu"].includes(k) ? undefined : v)));
const D7_DARI = new Date(Date.parse(SAMPAI + "T00:00:00Z") - 9 * 864e5).toISOString().slice(0, 10);
const sm = await ambil(`/sumber?dari=${DARI}&sampai=${SAMPAI}`); const ik = await ambil(`/?level=campaign&dari=${DARI}&sampai=${SAMPAI}`); const d7 = await ambil(`/d7?dari=${D7_DARI}&sampai=${SAMPAI}`);
if (sm.s !== 200 || ik.s !== 200 || d7.s !== 200) { console.log(`GAGAL status sumber=${sm.s} iklan=${ik.s} d7=${d7.s}`); process.exit(1); }
const A = Object.fromEntries(sm.j.sumber.map((x) => [x.id, [x.lead, x.spam, x.leadSah, x.berOrder, x.membayar, x.lunas, x.pernahDp, x.dpSaatIni, x.uang.nilaiOrderSaatIni, x.uang.uangLedger, x.uang.refund, x.uang.uangBersih]]));
console.log("AGREGAT=" + JSON.stringify(A));
console.log("HASH_IKLAN=" + createHash("sha256").update(JSON.stringify(bersih(ik.j))).digest("hex"));
console.log("HASH_D7=" + createHash("sha256").update(JSON.stringify(bersih(d7.j))).digest("hex"));
const mon = await ambil("/monitor");
console.log("MONITOR_CAPTURE=" + (mon.s === 200 ? String(mon.j?.snapshot?.touch?.captureAktif) : "tidak_tersedia(" + mon.s + ")"));
await prisma.$disconnect(); srv.close(); process.exit(0);
