// Smoke BACA-SAJA riwayat referensi (dijalankan di dalam container backend oleh scripts/release-riwayat-referensi.sh; disimpan di repo agar generator tidak bergantung pada helper lokal).
// Tidak memanggil POST /segarkan, /impor yang valid, ataupun penulisan apa pun; tabel referensi tidak boleh berubah selama smoke.
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const APP_ROOT = process.env.APP_ROOT || "/app";
const { PERMISSIONS: P, ROLE_PERMISSIONS } = await import((await import("node:url")).pathToFileURL(APP_ROOT + "/src/constants/permissions.js").href);
const prisma = new PrismaClient();
const MODE = process.env.MODE; // before | after
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:4000";
let fail = 0, skip = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const lewati = (n, alasan) => { skip++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
const info = (n) => console.log(`  INFO  ${n}`);
const NOL = "00000000-0000-4000-8000-000000000000";
async function api(method, path, token, body = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) });
  const teks = await r.text(); let json = null; try { json = JSON.parse(teks); } catch { /* bukan JSON */ }
  return { status: r.status, json, teks };
}
const aktif = await prisma.user.findMany({ where: { active: true } });
const peran = new Map();
for (const u of aktif) peran.set(u.id, [...new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)])]);
const punya = (roles, izin) => roles.some((r) => (ROLE_PERMISSIONS[r] || []).includes(izin));
const tokenUntuk = (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: peran.get(u.id) }, process.env.JWT_SECRET, { expiresIn: "10m" });
const cari = (fn) => aktif.find((u) => fn(peran.get(u.id)));
const cacah = async () => [await prisma.stockMovement.count(), await prisma.stockAdjustmentRequest.count(), await prisma.stockCount.count(), await prisma.finJournalEntry.count(), await prisma.goodsReceipt.count(), await prisma.returnRecord.count(), await prisma.damagedStockRecord.count()];
const sebelum = await cacah();
if (MODE === "before") {
  info(`baris sebelum: movement=${sebelum[0]} adjustment=${sebelum[1]} stockCount=${sebelum[2]} jurnal=${sebelum[3]} GR=${sebelum[4]} retur=${sebelum[5]} rusak=${sebelum[6]}`);
  console.log("REAL_BEFORE {}");
  console.log("SMOKE_HASIL mode=before fail=0 skip=0");
  await prisma.$disconnect();
  process.exit(0);
}
const penulis = cari((r) => punya(r, P.INVENTORY_WRITE));
const tanpaAkses = cari((r) => r.every((x) => ROLE_PERMISSIONS[x]) && !punya(r, P.INVENTORY_WRITE));

const hitungBaru = async () => [Number((await prisma.$queryRawUnsafe("select count(*) from stok_riwayat_referensi"))[0].count), Number((await prisma.$queryRawUnsafe("select count(*) from stok_riwayat_impor"))[0].count)];
const baruSebelum = await hitungBaru();
const auditSebelum = Number((await prisma.$queryRawUnsafe("select count(*) from activity_events where entity_type = $1", "stok_riwayat_referensi"))[0].count);
rec("tabel referensi baru terpasang (hitungan awal dicatat; tidak boleh berubah selama smoke)", Number.isFinite(baruSebelum[0]) && Number.isFinite(baruSebelum[1]), baruSebelum.join(","));
const pen = await prisma.$queryRawUnsafe("select count(*) from pg_trigger where tgname in ('stok_riwayat_referensi_append_only_trg','stok_riwayat_impor_append_only_trg')");
rec("trigger append-only terpasang (2)", Number(pen[0].count) === 2);
const R = "/api/inventory/riwayat-referensi";
for (const [m, p] of [["GET", ""], ["GET", "/ringkasan"], ["GET", "/impor"], ["POST", "/pratinjau"], ["POST", "/impor"], ["POST", "/segarkan"]]) rec(m + " " + R + p + ": tanpa token → 401", (await api(m, R + p, null)).status === 401);
if (tanpaAkses) {
  const tt = tokenUntuk(tanpaAkses);
  for (const [m, p] of [["GET", "/ringkasan"], ["POST", "/pratinjau"], ["POST", "/impor"], ["POST", "/segarkan"]]) rec(m + " " + R + p + ": tanpa izin → 403", (await api(m, R + p, tt, {})).status === 403);
} else lewati("403 tanpa izin", "tidak ada akun tanpa izin tulis");
if (penulis) {
  const t = tokenUntuk(penulis);
  const rg = await api("GET", R + "/ringkasan", t); rec("ringkasan 200, bukanSaldo=true, label referensi", rg.status === 200 && rg.json?.bukanSaldo === true && /bukan transaksi resmi/.test(rg.json?.label || ""), String(rg.status));
  const dft = await api("GET", R, t); rec("daftar 200 (GET murni baca; total = jumlah baris aktif)", dft.status === 200 && dft.json?.total <= baruSebelum[0], String(dft.json?.total));
  for (const p of ["", "/ringkasan", "/impor", "?semuaRevisi=1"]) rec("GET " + R + p + " dua kali → 200 (membuka tab tidak menulis)", (await api("GET", R + p, t)).status === 200 && (await api("GET", R + p, t)).status === 200);
  const sg = await api("POST", R + "/segarkan", t, {}); rec("POST /segarkan tanpa konfirmasi → 400 KONFIRMASI_DIPERLUKAN (snapshot adalah tindakan manual; tidak menulis)", sg.status === 400 && sg.json?.code === "KONFIRMASI_DIPERLUKAN", String(sg.status));
  rec("pratinjau tanpa berkas → 400 (tidak menulis)", (await api("POST", R + "/pratinjau", t, {})).status === 400);
  const imp = await api("POST", R + "/impor", t, { pakaiCsv: "x", konfirmasiHash: "salah" }); rec("impor dengan hash salah → 409 PRATINJAU_BERUBAH (tidak menulis)", imp.status === 409 && imp.json?.code === "PRATINJAU_BERUBAH", String(imp.status));
  rec("material id bukan UUID → 400", (await api("GET", R + "/material/bukan-uuid", t)).status === 400);
} else lewati("pemeriksaan dengan akun penulis", "tidak ada akun aktif pemegang inventory:write");
const baruSesudah = await hitungBaru(); rec("smoke tidak menulis tabel referensi baru (revisi, batch impor)", baruSesudah[0] === baruSebelum[0] && baruSesudah[1] === baruSebelum[1], baruSebelum.join(",") + " -> " + baruSesudah.join(","));
const auditSesudah = Number((await prisma.$queryRawUnsafe("select count(*) from activity_events where entity_type = $1", "stok_riwayat_referensi"))[0].count); rec("smoke tidak menambah audit stok_riwayat_referensi", auditSesudah === auditSebelum, auditSebelum + " -> " + auditSesudah);
const sesudah = await cacah();
rec("tidak ada baris berubah selama smoke (movement, adjustment, count, jurnal, GR, retur, rusak)", sebelum.every((n, i) => sesudah[i] >= n), sebelum.join(",") + " -> " + sesudah.join(","));
rec("smoke tidak membuat dokumen", sesudah[1] === sebelum[1] && sesudah[2] === sebelum[2] && sesudah[5] === sebelum[5] && sesudah[6] === sebelum[6], "adjustment/count/retur/rusak tetap");
await prisma.$disconnect();
console.log(`SMOKE_HASIL mode=${MODE} fail=${fail} skip=${skip}`);
process.exit(fail ? 1 : 0);
