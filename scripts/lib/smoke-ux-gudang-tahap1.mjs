// Smoke BACA-SAJA rilis UX Gudang Tahap 1 terhadap backend yang SUDAH melayani (dijalankan di container baru). Tidak membuat/mengubah penerimaan, koreksi, stok, jurnal, PO, atau Produksi.
// Penolakan diuji hanya pada pintu yang gagal SEBELUM menyentuh data (tanpa token, tanpa izin, UUID/tipe tidak valid).
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
const penulis = cari((r) => punya(r, P.INVENTORY_WRITE) && r.includes("ADMIN")) ?? cari((r) => punya(r, P.INVENTORY_WRITE));
const pembacaSaja = cari((r) => r.every((x) => ROLE_PERMISSIONS[x]) && punya(r, P.INVENTORY_READ) && !punya(r, P.INVENTORY_WRITE));
const tanpaBaca = cari((r) => r.every((x) => ROLE_PERMISSIONS[x]) && !punya(r, P.INVENTORY_READ));
if (!penulis) { rec("akun dengan izin tulis Inventory tersedia", false); process.exit(1); }
const tW = tokenUntuk(penulis); const nol = "00000000-0000-4000-8000-000000000000";
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const awal = { sm: await hitung("select count(*)::int n from stock_movements"), kor: await hitung("select count(*)::int n from warehouse_corrections"), act: await hitung("select count(*)::int n from activity_events where event_type in ('DOCUMENT_EDITED','DOCUMENT_CANCELLED') and entity_type = 'goods_receipt'"),
  status: JSON.stringify(await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from goods_receipts group by 1 order by 1")) };

// ── Pintu baru: tanpa token / tanpa izin / bentuk salah ──
rec("Beranda tanpa token → 401", (await api("GET", "/api/inventory/beranda", null)).status === 401);
rec("Stok & Lokasi tanpa token → 401", (await api("GET", "/api/inventory/beranda/stok", null)).status === 401);
if (tanpaBaca) rec("Beranda akun tanpa izin baca Inventory → 403", (await api("GET", "/api/inventory/beranda", tokenUntuk(tanpaBaca))).status === 403); else skip("Beranda 403", "tidak ada akun aktif tanpa izin baca Inventory");
const AKSI_BARU = ["kembali-draft", "batalkan-jadwal", "batalkan-tiba", "pulihkan", "buat-ulang"];
for (const a of AKSI_BARU) {
  rec(`${a} tanpa token → 401`, (await api("POST", `/api/inventory/goods-receipts/${nol}/${a}`, null, { alasan: "uji smoke" })).status === 401);
  if (pembacaSaja) { const s = (await api("POST", `/api/inventory/goods-receipts/${nol}/${a}`, tokenUntuk(pembacaSaja), { alasan: "uji smoke tanpa izin" })).status; rec(`${a} akun hanya-baca → 403`, s === 403, String(s)); }
  const u = (await api("POST", `/api/inventory/goods-receipts/bukan-uuid/${a}`, tW, { alasan: "uji smoke uuid" })).status; rec(`${a} UUID tidak valid → 400 (tanpa menyentuh data)`, u === 400, String(u));
  const t = (await api("POST", `/api/inventory/goods-receipts/${nol}/${a}`, tW, {})).status; rec(`${a} dokumen tidak ada/alasan kosong → 400/404 (tanpa menulis)`, t === 400 || t === 404, String(t));
}
if (!pembacaSaja) skip("aksi baru 403 untuk akun hanya-baca", "tidak ada akun aktif hanya-baca");

// ── Baca: Beranda, Stok & Lokasi, status per penerimaan NYATA, panel PO ──
const b = await api("GET", "/api/inventory/beranda", tW);
rec("Beranda: 200, 5 tugas, definisi, dihitung server", b.status === 200 && b.json?.tugas?.length === 5 && b.json?.definisi && typeof b.json?.dihitungPada === "string", `${b.status} ${b.json?.tugas?.map((t) => t.kode + "=" + t.jumlah).join(" ")}`);
const s = await api("GET", "/api/inventory/beranda/stok", tW); const nBahan = await hitung("select count(*)::int n from materials");
rec("Stok & Lokasi: 200; setiap bahan sekali; ringkasan menyebut yang belum ada catatan/minus/batas minimum", s.status === 200 && s.json?.rows?.length === nBahan && s.json?.ringkasan?.terdaftar === nBahan && !!s.json?.ringkasan?.kesimpulan?.reorder, `${s.status} bahan=${s.json?.rows?.length}`);
const grs = await prisma.goodsReceipt.findMany({ select: { id: true, receiptNumber: true, status: true, purchaseOrderId: true }, orderBy: { receiptNumber: "asc" } });
let n = 0;
for (const g of grs) {
  const r = await api("GET", `/api/inventory/goods-receipts/${g.id}`, tW); const t = r.json?.tampilan; const final = ["COMPLETED", "REJECTED"].includes(g.status);
  const okAksi = g.status === "COMPLETED" ? t?.aksi?.length === 1 && /^KOREKSI_/.test(t.aksi[0].kode) : final ? true : t?.aksi?.length > 0;
  rec(`detail ${g.receiptNumber} (${g.status}): 200, status + aksi sesuai, izin.tulis=true`, r.status === 200 && !!t?.label && okAksi && r.json?.izin?.tulis === true && Array.isArray(r.json?.jejak), `${r.status} ${t?.kode}`); n += 1;
  if (pembacaSaja && n === 1) { const rb = await api("GET", `/api/inventory/goods-receipts/${g.id}`, tokenUntuk(pembacaSaja)); if (rb.status === 200) rec("akun hanya-baca: izin.tulis=false dan aksi kosong", rb.json?.izin?.tulis === false && rb.json?.tampilan?.aksi?.length === 0, JSON.stringify(rb.json?.izin)); else rec("akun hanya-baca: ditolak 403 (tidak ada akses baca)", rb.status === 403, String(rb.status)); }
}
const po = await prisma.finPurchaseOrder.findFirst({ where: { status: { in: ["DISETUJUI", "DITERIMA_SEBAGIAN"] } }, select: { id: true, poNumber: true } });
if (po) { const r = await api("GET", `/api/inventory/barang-akan-datang/${po.id}`, tW); rec(`Barang Akan Datang ${po.poNumber}: 200; setiap penerimaan membawa status petugas (tampilan)`, r.status === 200 && (r.json?.penerimaan ?? []).every((x) => !!x.tampilan?.label), `${r.status} n=${r.json?.penerimaan?.length}`); } else skip("Barang Akan Datang detail", "tidak ada PO aktif");
// Koreksi Gudang tetap utuh
const c = await api("GET", "/api/inventory/koreksi/cakupan", tW); rec("Koreksi Gudang: cakupan 200 (menu tetap)", c.status === 200 && c.json?.menu?.length > 0, `menu=${c.json?.menu?.length}`);
const selesai = grs.find((g) => g.status === "COMPLETED");
if (selesai) { const k = await api("GET", `/api/inventory/koreksi/dokumen/GOODS_RECEIPT/${selesai.id}`, tW); rec(`Koreksi Gudang: jalur ${selesai.receiptNumber} tetap ${selesai.purchaseOrderId ? "ALUR_RESMI" : "KOREKSI_UI"}`, k.status === 200 && k.json?.jalur === (selesai.purchaseOrderId ? "ALUR_RESMI" : "KOREKSI_UI"), `${k.status} ${k.json?.jalur}`); } else skip("jalur Koreksi", "tidak ada penerimaan COMPLETED");
rec("Finance: daftar PO tetap 200", (await api("GET", "/api/finance/purchase-orders", tW)).status === 200);
rec("Produksi: board tetap 200", (await api("GET", "/api/production/board", tW)).status === 200);
// Tidak ada tulisan oleh smoke
const akhir = { sm: await hitung("select count(*)::int n from stock_movements"), kor: await hitung("select count(*)::int n from warehouse_corrections"), act: await hitung("select count(*)::int n from activity_events where event_type in ('DOCUMENT_EDITED','DOCUMENT_CANCELLED') and entity_type = 'goods_receipt'"),
  status: JSON.stringify(await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from goods_receipts group by 1 order by 1")) };
rec("smoke tidak menulis: pergerakan stok, koreksi, jejak dokumen penerimaan, dan sebaran status penerimaan tidak berubah", akhir.sm === awal.sm && akhir.kor === awal.kor && akhir.act === awal.act && akhir.status === awal.status, JSON.stringify({ sm: [awal.sm, akhir.sm], kor: [awal.kor, akhir.kor], act: [awal.act, akhir.act] }));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP); " + n + " penerimaan nyata diperiksa");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
