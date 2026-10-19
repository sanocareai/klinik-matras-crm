// Smoke BACA-SAJA rilis UX Gudang Tahap 3 terhadap backend yang SUDAH melayani (dijalankan di container baru). Tidak membuat/mengubah dokumen, stok, jurnal, koreksi, atau Produksi.
// Penolakan diuji hanya pada pintu yang gagal SEBELUM menyentuh data (tanpa token, tanpa izin, UUID/tipe tidak valid, dokumen tidak ada, alasan/kunci tidak valid).
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
const pembacaSaja = cari((r) => r.every((x) => ROLE_PERMISSIONS[x]) && punya(r, P.INVENTORY_READ) && !punya(r, P.INVENTORY_WRITE) && !punya(r, P.INVENTORY_ADJUSTMENT_APPROVE));
const tanpaBaca = cari((r) => r.every((x) => ROLE_PERMISSIONS[x]) && !punya(r, P.INVENTORY_READ));
if (!penulis) { rec("akun dengan izin tulis Inventory tersedia", false); process.exit(1); }
const tW = tokenUntuk(penulis); const nol = "00000000-0000-4000-8000-000000000000";
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const TABEL = ["goods_receipts", "goods_receipt_lines", "goods_receipt_events", "stock_movements", "material_issues", "material_issue_lines", "stock_transfers", "stock_transfer_lines", "stock_counts", "replenishment_requests", "damaged_stock_records", "return_records", "stock_adjustment_requests", "warehouse_corrections", "material_reservations_v2"];
const ENT_GUDANG = "('material_issue','stock_transfer','stock_count','replenishment','damaged_stock','return_record','stock_adjustment')";
const snapshot = async () => ({ ...Object.fromEntries(await Promise.all(TABEL.map(async (t) => [t, await hitung(`select count(*)::int n from ${t}`)]))), aktivitas_dokumen_gudang: await hitung(`select count(*)::int n from activity_events where entity_type in ${ENT_GUDANG}`) });
const awal = await snapshot();
const statusMI = JSON.stringify(await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from material_issues group by 1 order by 1"));
const statusST = JSON.stringify(await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from stock_transfers group by 1 order by 1"));

// ── Pintu baru: tanpa token / tanpa izin / bentuk salah / dokumen tidak ada (semua gagal SEBELUM menyentuh data) ──
const PINTU = [
  ["PUT", `/api/inventory/material-issues/${nol}/isi`, { revisi: "x", lines: [{ materialId: nol, requestedQty: 1 }] }],
  ["POST", `/api/inventory/material-issues/${nol}/kembalikan`, { alasan: "uji smoke" }],
  ["POST", `/api/inventory/material-issues/${nol}/buat-ulang`, { alasan: "uji smoke" }],
  ["PUT", `/api/inventory/transfers/${nol}/isi`, { revisi: "x", lines: [{ materialId: nol, qtySent: 1 }] }],
  ["POST", `/api/inventory/transfers/${nol}/kembalikan`, { alasan: "uji smoke" }],
  ["POST", `/api/inventory/transfers/${nol}/buat-ulang`, { alasan: "uji smoke" }],
  ["POST", `/api/inventory/transfers/${nol}/selisih`, { lineId: nol, jenis: "SUSUT", qty: 1, alasan: "uji smoke", kunci: "kunci-smoke-0001" }],
];
for (const [m, path, body] of PINTU) {
  const nama = `${m} ${path.replace(nol, ":id").replace("/api/inventory/", "")}`;
  rec(`${nama} tanpa token → 401`, (await api(m, path, null, body)).status === 401);
  if (pembacaSaja) { const s = (await api(m, path, tokenUntuk(pembacaSaja), body)).status; rec(`${nama} akun hanya-baca → 403`, s === 403, String(s)); }
  const u = (await api(m, path.replace(nol, "bukan-uuid"), tW, body)).status; rec(`${nama} UUID tidak valid → 400`, u === 400, String(u));
  const t = (await api(m, path, tW, body)).status; rec(`${nama} dokumen tidak ada → 404 (tanpa menulis)`, t === 404, String(t));
}
if (!pembacaSaja) skip("pintu baru 403 untuk akun hanya-baca", "tidak ada akun aktif hanya-baca");
const k1 = await api("POST", `/api/inventory/material-issues/${nol}/kembalikan`, tW, { alasan: "x" }); rec("kembalikan: alasan terlalu pendek → 400 berkode", k1.status === 400 && k1.json?.kode === "ALASAN_TIDAK_VALID", `${k1.status} ${k1.json?.kode}`);
const k2 = await api("PUT", `/api/inventory/material-issues/${nol}/isi`, tW, { lines: [{ materialId: nol, requestedQty: 1 }] }); rec("ubah isi tanpa revisi → 400 REVISI_WAJIB", k2.status === 400 && k2.json?.kode === "REVISI_WAJIB", `${k2.status} ${k2.json?.kode}`);
const k3 = await api("POST", `/api/inventory/transfers/${nol}/selisih`, tW, { lineId: nol, jenis: "HILANG", qty: 1, alasan: "uji smoke", kunci: "kunci-smoke-0002" }); rec("selisih: jenis tidak valid → 400 JENIS_TIDAK_VALID", k3.status === 400 && k3.json?.kode === "JENIS_TIDAK_VALID", `${k3.status} ${k3.json?.kode}`);

// ── Baca: setiap dokumen NYATA — daftar & detail membawa status petugas, izin, jejak ──
let n = 0;
async function periksa(nama, daftarUrl, kunciDaftar, detailUrl, ambilBanyak) {
  const d = await api("GET", daftarUrl, tW); const baris = d.json?.[kunciDaftar] ?? [];
  rec(`${nama}: daftar 200 dan setiap baris membawa status petugas (tampilan)`, d.status === 200 && baris.every((r) => !!r.tampilan?.label), `${d.status} n=${baris.length}`);
  for (const r of baris.slice(0, ambilBanyak)) {
    const x = await api("GET", detailUrl(r.id), tW);
    rec(`${nama} ${r.issueNumber ?? r.transferNumber ?? r.countNumber ?? r.requestNumber ?? r.recordNumber ?? r.returnNumber ?? r.adjustmentNumber}: detail 200, tampilan + izin.tulis + jejak`, x.status === 200 && !!x.json?.tampilan?.label && x.json?.izin?.tulis === true && Array.isArray(x.json?.jejak), `${x.status} ${x.json?.tampilan?.kode}`); n += 1;
    if (pembacaSaja && nama.startsWith("Pengeluaran") && r === baris[0]) { const rb = await api("GET", detailUrl(r.id), tokenUntuk(pembacaSaja)); if (rb.status === 200) rec("akun hanya-baca: izin.tulis=false dan aksi kosong", rb.json?.izin?.tulis === false && rb.json?.tampilan?.aksi?.length === 0); }
  }
  return baris;
}
const mis = await periksa("Pengeluaran Material", "/api/inventory/material-issues", "issues", (id) => `/api/inventory/material-issues/${id}`, 30);
const miDetailBukti = mis.find((r) => ["PICKED", "APPROVED", "READY_TO_PICK"].includes(r.status));
if (miDetailBukti) { const x = await api("GET", `/api/inventory/material-issues/${miDetailBukti.id}`, tW); rec("detail dokumen berjalan memuat revisi dan ketersediaan per baris", typeof x.json?.revisi === "string" && x.json?.ketersediaan?.length === x.json?.lines?.length); } else skip("revisi/ketersediaan dokumen berjalan", "tidak ada Pengeluaran Material berjalan");
const sts = await periksa("Transfer Stok", "/api/inventory/transfers", "transfers", (id) => `/api/inventory/transfers/${id}`, 30);
const stSelesai = sts.find((r) => r.status === "COMPLETED");
if (stSelesai) { const x = await api("GET", `/api/inventory/transfers/${stSelesai.id}`, tW); rec(`detail transfer selesai ${stSelesai.transferNumber}: selisih[] dan saldoPerjalanan[] ada`, Array.isArray(x.json?.selisih) && Array.isArray(x.json?.saldoPerjalanan) && x.json.saldoPerjalanan.every((s) => s.diterima !== null)); } else skip("selisih/saldo perjalanan transfer selesai", "tidak ada transfer selesai");
await periksa("Stock Opname", "/api/inventory/stock-counts", "counts", (id) => `/api/inventory/stock-counts/${id}`, 15);
await periksa("Restok", "/api/inventory/replenishment", "requests", (id) => `/api/inventory/replenishment/${id}`, 15);
await periksa("Barang Rusak", "/api/inventory/damaged-stock", "records", (id) => `/api/inventory/damaged-stock/${id}`, 15);
await periksa("Retur", "/api/inventory/returns", "records", (id) => `/api/inventory/returns/${id}`, 15);
await periksa("Penyesuaian Stok", "/api/inventory/adjustments", "requests", (id) => `/api/inventory/adjustments/${id}`, 15);
// ── Tahap 3: perpindahan status Penerimaan — pintu baru gagal SEBELUM menyentuh data; setiap penerimaan nyata membawa pipeline + revisi + riwayat status ──
const GRP = "/api/inventory/goods-receipts";
{
  const m0 = ["POST", `${GRP}/${nol}/mundur`, { ke: "DRAFT", alasan: "uji smoke" }];
  rec("POST goods-receipts/:id/mundur tanpa token → 401", (await api(m0[0], m0[1], null, m0[2])).status === 401);
  if (pembacaSaja) { const s = (await api(m0[0], m0[1], tokenUntuk(pembacaSaja), m0[2])).status; rec("mundur: akun hanya-baca → 403", s === 403, String(s)); } else skip("mundur 403 untuk akun hanya-baca", "tidak ada akun aktif hanya-baca");
  const u3 = (await api(m0[0], `${GRP}/bukan-uuid/mundur`, tW, m0[2])).status; rec("mundur: UUID tidak valid → 400", u3 === 400, String(u3));
  const n3 = (await api(m0[0], m0[1], tW, m0[2])).status; rec("mundur: dokumen tidak ada → 404 (tanpa menulis)", n3 === 404, String(n3));
  const t3 = await api("POST", `${GRP}/${nol}/mundur`, tW, { ke: "COMPLETED", alasan: "uji smoke" }); rec("mundur: tujuan tidak valid (COMPLETED) → 400 TUJUAN_TIDAK_VALID", t3.status === 400 && t3.json?.code === "TUJUAN_TIDAK_VALID", `${t3.status} ${t3.json?.code}`);
  const lst = await api("GET", GRP, tW); const grl = lst.json?.receipts ?? [];
  rec(`Penerimaan Barang: daftar 200 dan setiap baris membawa pipeline (6 tahap), tindakan berikutnya, dan revisi — ${grl.length} dokumen`, lst.status === 200 && grl.every((r) => r.tampilan?.pipeline?.tahap?.length === 6 && typeof r.tampilan?.berikutnya === "string" && typeof r.revisi === "string"));
  for (const r of grl.slice(0, 25)) {
    const x = await api("GET", `${GRP}/${r.id}`, tW); const okDetail = x.status === 200 && !!x.json?.tampilan?.pipeline && typeof x.json?.revisi === "string" && Array.isArray(x.json?.jejak) && x.json?.izin?.tulis === true && "pemeriksaanSebelumnya" in (x.json ?? {});
    const posted = x.json?.status === "COMPLETED" ? (x.json?.tampilan?.pipeline?.pindah?.length === 0) : true;
    rec(`Penerimaan ${r.receiptNumber}: detail 200 — pipeline, revisi, riwayat status, pemeriksaanSebelumnya, izin; terposting tanpa perpindahan`, okDetail && posted, `${x.status}`); n += 1;
    if (pembacaSaja && r === grl[0]) { const rb = await api("GET", `${GRP}/${r.id}`, tokenUntuk(pembacaSaja)); if (rb.status === 200) rec("akun hanya-baca: pipeline.pindah dan aksi kosong", rb.json?.izin?.tulis === false && rb.json?.tampilan?.pipeline?.pindah?.length === 0 && rb.json?.tampilan?.aksi?.length === 0); }
  }
  const sk = await api("GET", "/api/inventory/beranda/stok", tW); const kel = sk.json?.kelompok?.kelompok ?? []; const aktifN = (sk.json?.rows ?? []).filter((x) => x.aktif).length;
  rec(`Stok & Lokasi: kelompok bahan 9 kartu; jumlah per kelompok = bahan aktif (${aktifN}); belum dikelompokkan=${kel.find((x) => x.kode === "BELUM")?.total}`, sk.status === 200 && kel.length === 9 && kel.reduce((a, x) => a + x.total, 0) === aktifN);
}
// ── Menu lain tetap utuh ──
const c = await api("GET", "/api/inventory/koreksi/cakupan", tW); rec("Koreksi Gudang: cakupan 200 (menu tetap)", c.status === 200 && c.json?.menu?.length > 0, `menu=${c.json?.menu?.length}`);
rec("Beranda Gudang tetap 200", (await api("GET", "/api/inventory/beranda", tW)).status === 200);
rec("Stok & Lokasi tetap 200", (await api("GET", "/api/inventory/beranda/stok", tW)).status === 200);
rec("Penerimaan Barang: daftar tetap 200", (await api("GET", "/api/inventory/goods-receipts", tW)).status === 200);
rec("Finance: daftar PO tetap 200", (await api("GET", "/api/finance/purchase-orders", tW)).status === 200);
rec("Produksi: board tetap 200", (await api("GET", "/api/production/board", tW)).status === 200);
// ── Tidak ada tulisan oleh smoke ──
const akhir = await snapshot();
const berubah = [...TABEL, "aktivitas_dokumen_gudang"].filter((t) => akhir[t] !== awal[t]);
rec("smoke tidak menulis: jumlah baris pergerakan stok, dokumen Gudang, baris dokumen, koreksi, reservasi V2, dan jejak aktivitas dokumen Gudang tidak berubah (jurnal/Finance dijaga oleh sidik jari beku skrip rilis)", berubah.length === 0, berubah.map((t) => `${t}:${awal[t]}→${akhir[t]}`).join(" "));
rec("sebaran status Pengeluaran Material & Transfer tidak berubah", statusMI === JSON.stringify(await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from material_issues group by 1 order by 1")) && statusST === JSON.stringify(await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from stock_transfers group by 1 order by 1")));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP); " + n + " dokumen nyata diperiksa");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
