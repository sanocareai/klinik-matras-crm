// Smoke BACA-SAJA rilis Koreksi Gudang terhadap backend yang SUDAH melayani (dijalankan di container baru). Tidak membuat koreksi, tidak menulis stok/jurnal/PO/Produksi.
// Penolakan diuji hanya pada pintu yang gagal SEBELUM menyentuh data (tanpa token, tanpa izin, tanpa kunci idempoten, UUID/tipe tidak valid).
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const { PERMISSIONS: P, ROLE_PERMISSIONS } = await import((await import("node:url")).pathToFileURL("/app/src/constants/permissions.js").href);
const { JALUR } = await import("/app/src/services/warehouseCoverage.js");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
async function api(method, path, token, body, headers = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
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
const K = "/api/inventory/koreksi";
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const koreksiAwal = await hitung("select count(*)::int n from warehouse_corrections");

// ── Pintu: tanpa token / tanpa izin / bentuk salah — gagal SEBELUM menyentuh data ──
rec("cakupan tanpa token → 401", (await api("GET", K + "/cakupan", null)).status === 401);
rec("pratinjau tanpa token → 401", (await api("POST", `${K}/goods-receipts/${nol}/pratinjau`, null, {})).status === 401);
rec("ajukan tanpa token → 401", (await api("POST", `${K}/goods-receipts/${nol}/ajukan`, null, {})).status === 401);
if (tanpaTulis) {
  const a = (await api("POST", `${K}/goods-receipts/${nol}/pratinjau`, tokenUntuk(tanpaTulis), { perubahan: {}, alasan: "uji smoke tanpa izin" })).status;
  rec("pratinjau akun tanpa izin tulis Inventory → 403", a === 403, String(a));
  const b = (await api("POST", `${K}/goods-receipts/${nol}/ajukan`, tokenUntuk(tanpaTulis), { perubahan: {}, alasan: "uji smoke tanpa izin" }, { "Idempotency-Key": "smoke-kg-noperm-1" })).status;
  rec("ajukan akun tanpa izin tulis Inventory → 403", b === 403, String(b));
} else skip("pratinjau/ajukan 403", "tidak ada akun aktif tanpa izin tulis Inventory");
if (tanpaBaca) { const c = (await api("GET", K + "/cakupan", tokenUntuk(tanpaBaca))).status; rec("cakupan akun tanpa izin baca Inventory → 403", c === 403, String(c)); } else skip("cakupan 403", "tidak ada akun aktif tanpa izin baca Inventory");
const k5 = (await api("POST", `${K}/goods-receipts/${nol}/ajukan`, tB, { perubahan: {}, alasan: "uji smoke tanpa kunci" })).status;
rec("ajukan tanpa Idempotency-Key → 400/428 (tidak menulis)", k5 === 400 || k5 === 428, String(k5));
rec("setujui koreksi dengan UUID tidak valid → 400", (await api("POST", `${K}/bukan-uuid/setujui`, tB, {})).status === 400);
rec("dokumen: tipe tidak dikenal → 400 TIPE_TIDAK_DIKENAL", (await api("GET", `${K}/dokumen/ASING/${nol}`, tB)).json?.code === "TIPE_TIDAK_DIKENAL");
rec("dokumen: UUID tidak valid → 400", (await api("GET", `${K}/dokumen/GOODS_RECEIPT/bukan-uuid`, tB)).status === 400);
rec("dokumen: penerimaan tidak ada → 404", (await api("GET", `${K}/dokumen/GOODS_RECEIPT/${nol}`, tB)).status === 404);

// ── Baca: cakupan, daftar koreksi, jalur per dokumen NYATA ──
const cakupan = await api("GET", K + "/cakupan", tB);
rec("cakupan: 200, memuat jalur + matriks menu + penghalang", cakupan.status === 200 && Array.isArray(cakupan.json?.jalur) && Array.isArray(cakupan.json?.menu) && cakupan.json.menu.length > 0 && typeof cakupan.json?.penghalang === "object", `menu=${cakupan.json?.menu?.length}`);
const daftar = await api("GET", K, tB);
rec("daftar koreksi: 200", daftar.status === 200, String(daftar.status));
const grs = await prisma.goodsReceipt.findMany({ select: { id: true, receiptNumber: true, status: true, purchaseOrderId: true }, orderBy: { receiptNumber: "asc" } });
if (grs.length === 0) skip("jalur per dokumen nyata", "tidak ada penerimaan di produksi");
let nDiperiksa = 0;
for (const g of grs) {
  const r = await api("GET", `${K}/dokumen/GOODS_RECEIPT/${g.id}`, tB);
  const harap = g.status === "REJECTED" ? JALUR.FINAL : g.status !== "COMPLETED" ? JALUR.EDIT_DRAF : g.purchaseOrderId ? JALUR.ALUR_RESMI : JALUR.KOREKSI_UI;
  rec(`jalur ${g.receiptNumber} (${g.status}${g.purchaseOrderId ? ", PO" : ""}) = ${harap}`, r.status === 200 && r.json?.jalur === harap && r.json?.dokumen?.nomor === g.receiptNumber, `${r.status} ${r.json?.jalur}`);
  nDiperiksa += 1;
}
const selesai = grs.find((g) => g.status === "COMPLETED");
if (selesai) {
  const k = await api("GET", `${K}/goods-receipts/${selesai.id}/keadaan`, tB);
  rec(`keadaan koreksi ${selesai.receiptNumber}: 200, bisaMengajukan=true, tanpa koreksi tertunda`, k.status === 200 && k.json?.bisaMengajukan === true && k.json?.koreksiTertunda === 0, `${k.status}`);
} else skip("keadaan koreksi GR selesai", "tidak ada penerimaan COMPLETED");
// Jalur lama tidak rusak
rec("daftar penerimaan lama tetap 200", (await api("GET", "/api/inventory/goods-receipts", tB)).status === 200);
rec("stok lama tetap 200", (await api("GET", "/api/inventory/stock", tB)).status === 200);
// Tidak ada tulisan
rec("jumlah koreksi tidak berubah oleh smoke", (await hitung("select count(*)::int n from warehouse_corrections")) === koreksiAwal, `${koreksiAwal}`);
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP); " + nDiperiksa + " penerimaan nyata diperiksa");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
