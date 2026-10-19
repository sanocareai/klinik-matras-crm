// Smoke BACA-SAJA rilis Stock Opname penuh terhadap backend yang SUDAH melayani (dijalankan di container baru). Tidak membuat sesi, tidak menulis stok/jurnal/PO/Produksi.
// Penolakan diuji hanya pada pintu yang gagal SEBELUM menyentuh data (tanpa token, tanpa izin, UUID tidak valid). Pratinjau cakupan murni baca.
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const { PERMISSIONS: P, ROLE_PERMISSIONS } = await import((await import("node:url")).pathToFileURL("/app/src/constants/permissions.js").href);
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
async function api(method, path, token, body) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json };
}
const aktif = await prisma.user.findMany({ where: { active: true } });
const peran = new Map();
for (const u of aktif) peran.set(u.id, [...new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)])]);
const punya = (roles, izin) => roles.some((r) => (ROLE_PERMISSIONS[r] || []).includes(izin));
const tokenUntuk = (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: peran.get(u.id) }, process.env.JWT_SECRET, { expiresIn: "10m" });
const cari = (fn) => aktif.find((u) => fn(peran.get(u.id)));
const pembaca = cari((r) => punya(r, P.INVENTORY_READ) && r.includes("ADMIN")) ?? cari((r) => punya(r, P.INVENTORY_READ));
const tanpaTulis = cari((r) => r.every((x) => ROLE_PERMISSIONS[x]) && !punya(r, P.INVENTORY_WRITE));
const tanpaBaca = cari((r) => r.every((x) => ROLE_PERMISSIONS[x]) && !punya(r, P.INVENTORY_READ));
if (!pembaca) { rec("akun dengan izin baca Inventory tersedia", false); process.exit(1); }
const tB = tokenUntuk(pembaca);
const nol = "00000000-0000-4000-8000-000000000000";
const SC = "/api/inventory/stock-counts";
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const awal = { sesi: await hitung("select count(*)::int n from stock_counts"), baris: await hitung("select count(*)::int n from stock_count_lines"), mov: await hitung("select count(*)::int n from stock_movements"), ev: await hitung("select count(*)::int n from activity_events") };

// ── Pintu: tanpa token / tanpa izin / bentuk salah — gagal SEBELUM menyentuh data ──
rec("daftar sesi tanpa token → 401", (await api("GET", SC, null)).status === 401);
rec("pratinjau cakupan tanpa token → 401", (await api("POST", SC + "/scope-preview", null, { mode: "FULL" })).status === 401);
rec("mulai hitung tanpa token → 401", (await api("POST", `${SC}/${nol}/lines/mulai`, null, { lineIds: [nol] })).status === 401);
if (tanpaTulis) {
  const t = tokenUntuk(tanpaTulis);
  rec("membuat sesi oleh akun tanpa izin tulis Inventory → 403", (await api("POST", SC, t, { mode: "FULL" })).status === 403);
  rec("simpan hasil hitung oleh akun tanpa izin tulis → 403", (await api("PUT", `${SC}/${nol}/hasil`, t, { items: [{ lineId: nol, revision: 0, countedQty: 1 }] })).status === 403);
  rec("mulai hitung oleh akun tanpa izin tulis → 403", (await api("POST", `${SC}/${nol}/lines/mulai`, t, { lineIds: [nol] })).status === 403);
  rec("koreksi waktu hitung oleh akun tanpa izin tulis → 403", (await api("POST", `${SC}/${nol}/lines/${nol}/waktu`, t, { observedAt: new Date().toISOString(), alasan: "uji smoke tanpa izin" })).status === 403);
  rec("keputusan massal pergerakan oleh akun tanpa izin tulis → 403", (await api("POST", `${SC}/${nol}/pergerakan/tanda-massal`, t, { tercermin: false })).status === 403);
} else skip("penolakan tulis 403", "tidak ada akun aktif tanpa izin tulis Inventory");
if (tanpaBaca) rec("pratinjau cakupan oleh akun tanpa izin baca → 403", (await api("POST", SC + "/scope-preview", tokenUntuk(tanpaBaca), { mode: "FULL" })).status === 403); else skip("pratinjau 403", "tidak ada akun aktif tanpa izin baca Inventory");
rec("kerja: UUID tidak valid → 400", (await api("GET", `${SC}/bukan-uuid/kerja`, tB)).status === 400);
rec("kerja: sesi tidak ada → 404", (await api("GET", `${SC}/${nol}/kerja`, tB)).status === 404);

// ── Baca: sesi lama tetap terbaca persis seperti sebelum rilis ──
const daftar = await api("GET", SC, tB);
rec("daftar sesi hitung: 200", daftar.status === 200 && Array.isArray(daftar.json?.counts), String(daftar.status));
const sesiDb = await prisma.stockCount.findMany({ select: { id: true, countNumber: true, status: true, modelVersion: true, _count: { select: { lines: true } } }, orderBy: { createdAt: "asc" } });
rec("semua sesi di produksi bermodel 1 (rilis ini tidak membuat sesi model baru)", sesiDb.every((s) => s.modelVersion === 1), `n=${sesiDb.length}`);
if (sesiDb.length === 0) skip("sesi lama terbaca", "tidak ada sesi hitung di produksi");
for (const s of sesiDb) {
  const d = await api("GET", `${SC}/${s.id}`, tB);
  rec(`sesi lama ${s.countNumber} (${s.status}, ${s._count.lines} baris) terbaca: 200, model 1, jumlah baris sama dengan database`, d.status === 200 && d.json?.sesi?.modelVersion === 1 && d.json?.lines?.length === s._count.lines, `${d.status} baris=${d.json?.lines?.length}`);
  const k = await api("GET", `${SC}/${s.id}/kerja`, tB);
  rec(`halaman kerja model baru menolak sesi lama ${s.countNumber} dengan SESI_LAMA (409)`, k.status === 409 && k.json?.code === "SESI_LAMA", `${k.status}`);
  const di = daftar.json?.counts?.find((c) => c.id === s.id);
  rec(`daftar memuat ${s.countNumber} dengan jumlahBahan ${s._count.lines}`, !!di && di.jumlahBahan === s._count.lines);
}
// ── Pratinjau cakupan Opname penuh di atas bahan NYATA (baca-saja) ──
const aktifN = await hitung("select count(*)::int n from materials where active");
const pr = await api("POST", SC + "/scope-preview", tB, { mode: "FULL" });
rec("pratinjau Opname penuh: 200", pr.status === 200, String(pr.status));
const r = pr.json?.ringkasan;
rec("pratinjau memuat seluruh bahan aktif: masuk + tidak dilacak = bahan aktif di database", !!r && r.bahanAktif === aktifN && r.masuk + r.tidakDilacak.jumlah === aktifN, `aktif=${aktifN} masuk=${r?.masuk} tidakDilacak=${r?.tidakDilacak?.jumlah}`);
rec("pratinjau menyebut dasar cakupan 'dilacak secara fisik' dan alasan tiap bahan tidak dilacak", typeof r?.dasarCakupan === "string" && /dilacak secara fisik/.test(r.dasarCakupan) && (r.tidakDilacak.daftar ?? []).every((x) => /Tidak ada jejak stok/.test(x.alasan)));
rec("pratinjau Cycle Count memerlukan bahan yang dipilih (400)", (await api("POST", SC + "/scope-preview", tB, { mode: "ITEMS", materialIds: [] })).status === 400);
rec("daftar bahan Cycle Count: 200", (await api("GET", SC + "/bahan?limit=5", tB)).status === 200);
// Jalur lama tidak rusak
rec("stok lama tetap 200", (await api("GET", "/api/inventory/stock", tB)).status === 200);
rec("daftar penerimaan lama tetap 200", (await api("GET", "/api/inventory/goods-receipts", tB)).status === 200);
// Tidak ada tulisan
rec("smoke tidak menulis sesi, baris hitung, pergerakan stok, maupun jejak aktivitas", (await hitung("select count(*)::int n from stock_counts")) === awal.sesi && (await hitung("select count(*)::int n from stock_count_lines")) === awal.baris && (await hitung("select count(*)::int n from stock_movements")) === awal.mov && (await hitung("select count(*)::int n from activity_events")) === awal.ev);
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP); " + sesiDb.length + " sesi lama diperiksa");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
