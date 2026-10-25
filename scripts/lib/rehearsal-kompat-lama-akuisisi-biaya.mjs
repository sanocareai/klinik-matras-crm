// Dijalankan di dalam IMAGE LAMA (yang sedang melayani produksi) terhadap salinan restore yang SUDAH bermigrasi dan berisi entri biaya uji: bukti rollback kode aman.
// Kode lama tidak mengenal tabel baru; ia harus tetap menghitung /sumber, laporan iklan, dan D7 persis seperti sebelum migrasi. Hanya BACA. Mencetak AGREGAT_LAMA=<json> (sama bentuk dengan AGREGAT_BARU).
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const DARI = process.env.PER_DARI, SAMPAI = process.env.PER_SAMPAI;
const hariIni = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const { hitungSumberPerforma } = await import("/app/src/services/attribution/sumber.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + d : ""}`); };
const tabelBaru = Number((await prisma.$queryRawUnsafe("select count(*)::int n from pg_tables where schemaname='public' and tablename in ('ad_source_spend_entries','ad_source_spend_revisions')"))[0].n);
const entri = Number((await prisma.$queryRawUnsafe("select count(*)::int n from ad_source_spend_entries"))[0].n);
cek("image LAMA berjalan terhadap DB bermigrasi (2 tabel baru ada, berisi entri uji)", tabelBaru === 2 && entri > 0, `tabel=${tabelBaru} entri=${entri}`);
const j = await hitungSumberPerforma(prisma, { dari: DARI, sampai: SAMPAI, hariIni, bawaan: false });
cek("kode LAMA menghitung /sumber tanpa galat: 6 sumber", j.sumber.length === 6);
const A = Object.fromEntries(j.sumber.map((x) => [x.id, [x.lead, x.spam, x.leadSah, x.berOrder, x.membayar, x.lunas, x.pernahDp, x.dpSaatIni, x.uang.nilaiOrderSaatIni, x.uang.uangLedger, x.uang.refund, x.uang.uangBersih]]));
cek("kode LAMA tidak melihat biaya manual (biaya per sumber non-Meta = 'tanpa sumber spend'; tidak ada angka biaya dari tabel baru)", j.sumber.filter((x) => x.id !== "META").every((x) => x.biaya.spend === null && x.biaya.cpa === null));
console.log("AGREGAT_LAMA=" + JSON.stringify(A));
// /iklan (campaign) dan /d7 lewat ROUTER lama asli + sesi ADMIN nyata: hash harus sama dengan kode baru (laporan lain tidak berubah)
const jwt = require("jsonwebtoken"); const express = require("express");
const { attributionAdsRouter } = await import("/app/src/routes/attributionAds.js");
let adm = null; for (const u of await prisma.user.findMany({ where: { active: true } })) { const rs = new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]); if (rs.has("ADMIN")) { adm = u; break; } }
const tA = jwt.sign({ id: adm.id, name: adm.name, role: adm.role, roles: ["ADMIN"] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const app = express(); app.use("/api/atribusi/iklan", attributionAdsRouter);
const srv = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); }); const BASE = `http://127.0.0.1:${srv.address().port}/api/atribusi/iklan`;
const ambil = async (p) => { const r = await fetch(BASE + p, { headers: { Authorization: "Bearer " + tA } }); return r.json(); };
const hapusVolatil = (o) => JSON.parse(JSON.stringify(o, (k, v) => (["dihitungPada", "waktuWib", "waktu"].includes(k) ? undefined : v)));
const D7_DARI = new Date(Date.parse(SAMPAI + "T00:00:00Z") - 9 * 864e5).toISOString().slice(0, 10);
const iklan = hapusVolatil(await ambil(`/?level=campaign&dari=${DARI}&sampai=${SAMPAI}`)); const d7 = hapusVolatil(await ambil(`/d7?dari=${D7_DARI}&sampai=${SAMPAI}`));
cek("kode LAMA: /iklan (campaign) dan /d7 menjawab tanpa galat terhadap DB bermigrasi berisi entri biaya", !iklan.error && !d7.error && Array.isArray(iklan.grup));
console.log("HASH_IKLAN=" + createHash("sha256").update(JSON.stringify(iklan)).digest("hex") + " HASH_D7=" + createHash("sha256").update(JSON.stringify(d7)).digest("hex"));
srv.close();
await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
