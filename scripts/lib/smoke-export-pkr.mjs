import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)
const APP = process.env.APP_DIR ?? "/app";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 220) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE BACA-SAJA terhadap production hidup: Export Excel Penjualan Karyawan (PKR). Tidak ada tulisan dan tidak ada transaksi/dokumen percobaan. Setiap angka Excel dibandingkan dengan hitungan
// LANGSUNG dari tabel (bukan dari kode export) dan dengan daftar layar (GET /api/finance/penjualan-karyawan). Dokumen, pembayaran, dan jurnal harus identik sebelum vs sesudah.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const B = (k) => Number(process.env[k]);
const r2 = (x) => Math.round(Number(x) * 100) / 100;
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const finAdmin = info.find((x) => bisa(x.rs, P.FINANCE_ADMIN))?.u;
const finBiasa = info.find((x) => bisa(x.rs, P.FINANCE_READ) && !bisa(x.rs, P.FINANCE_ADMIN))?.u;
const tanpaIzin = info.find((x) => !bisa(x.rs, P.FINANCE_READ))?.u;
if (!finAdmin) { rec("akun Finance Admin (finance:admin) tersedia", false); process.exit(1); }
const tA = await tokenUntuk(finAdmin); const tF = finBiasa ? await tokenUntuk(finBiasa) : null; const tX = tanpaIzin ? await tokenUntuk(tanpaIzin) : null;

const jejak = async () => ({
  dokumen: await hitung("select count(*)::int n from fin_penjualan_karyawan"), item: await hitung("select count(*)::int n from fin_penjualan_karyawan_items"), bayar: await hitung("select count(*)::int n from fin_penjualan_karyawan_payments"),
  batalDok: await hitung("select count(*)::int n from fin_penjualan_karyawan where status::text = 'DIBATALKAN'"), batalBayar: await hitung("select count(*)::int n from fin_penjualan_karyawan_payments where cancelled_at is not null"),
  nilai: String((await prisma.$queryRawUnsafe("select coalesce(sum(total),0)::text n from fin_penjualan_karyawan"))[0].n),
  jurnal: await hitung("select count(*)::int n from fin_journal_entries"), baris: await hitung("select count(*)::int n from fin_journal_lines"), order: await hitung('select count(*)::int n from "Order"'), stok: await hitung("select count(*)::int n from stock_movements"),
});
const s0 = await jejak();

const unduh = async (token, body) => {
  const r = await fetch(BASE + "/api/finance/export/penjualan-karyawan", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) });
  const tipe = r.headers.get("content-type") || ""; if (!tipe.includes("spreadsheetml")) { let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, wb: null, json: j }; }
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer())); return { status: r.status, wb, json: null };
};
const sel = (c) => (c.value && typeof c.value === "object" && !(c.value instanceof Date) && "text" in c.value ? c.value.text : c.value);
const sheet = (wb, nama) => { const ws = wb.getWorksheet(nama); if (!ws) return { header: [], baris: [], total: null, ada: false };
  const header = []; ws.getRow(6).eachCell({ includeEmpty: false }, (c, i) => { header[i - 1] = sel(c); }); const baris = []; let total = null;
  for (let r = 7; r <= ws.rowCount; r++) { const row = ws.getRow(r); if (row.actualCellCount === 0) continue; const o = {}; header.forEach((h, i) => { o[h] = sel(row.getCell(i + 1)) ?? null; });
    if (typeof o[header[0]] === "string" && /^Tidak ada data sesuai/.test(o[header[0]])) continue; // pesan sheet kosong, bukan baris data
    if (typeof o[header[0]] === "string" && /^TOTAL/i.test(o[header[0]])) { total = o; break; } baris.push(o); }
  return { header, baris, total, ada: true }; };
const num = (v) => Number(v ?? 0);
const layar = async (q) => { const r = await fetch(BASE + "/api/finance/penjualan-karyawan?" + new URLSearchParams(q).toString(), { headers: { Authorization: "Bearer " + tA } }); return { status: r.status, json: r.status === 200 ? await r.json() : null }; };

// ── sumber kebenaran LANGSUNG dari tabel untuk satu periode
const dariTabel = async (from, to) => {
  const dok = await prisma.$queryRawUnsafe("select p.id::text id, p.nomor, p.status::text status, p.total::float8 total from fin_penjualan_karyawan p where p.date between $1::date and $2::date order by p.nomor", from, to);
  const bayar = await prisma.$queryRawUnsafe("select y.penjualan_id::text pid, y.amount::float8 amount, (y.cancelled_at is not null) batal from fin_penjualan_karyawan_payments y join fin_penjualan_karyawan p on p.id = y.penjualan_id where p.date between $1::date and $2::date", from, to);
  const aktifPer = new Map(); for (const y of bayar) if (!y.batal) aktifPer.set(y.pid, r2((aktifPer.get(y.pid) ?? 0) + y.amount));
  const baris = dok.map((d) => { const aktif = d.status === "AKTIF"; const terbayar = aktif ? (aktifPer.get(d.id) ?? 0) : 0; return { nomor: d.nomor, aktif, total: r2(d.total), terbayar: r2(terbayar), sisa: aktif ? r2(d.total - terbayar) : 0 }; });
  return { baris, nBayar: bayar.length, bayarAktif: r2(bayar.filter((y) => !y.batal).reduce((s, y) => s + y.amount, 0)), nBayarAktif: bayar.filter((y) => !y.batal).length };
};
const PERIODES = [["2025-01-01", "2026-12-31", "seluruh periode data"], ["2026-10-01", "2026-10-31", "Oktober 2026"]];
for (const [from, to, nama] of PERIODES) {
  const t = await dariTabel(from, to); const ex = await unduh(tA, { periode: { from, to }, filter: {} });
  rec(`export PKR ${nama}: 200 dan berkas .xlsx`, ex.status === 200 && !!ex.wb, ex.status);
  if (!ex.wb) continue;
  const d = sheet(ex.wb, "Daftar Penjualan");
  rec(`${nama}: sheet Daftar memuat SEMUA ${t.baris.length} dokumen periode (hitungan langsung dari tabel), tanpa batas 500 layar`, d.baris.length === t.baris.length, `${d.baris.length} vs ${t.baris.length}`);
  let beda = 0; for (const x of t.baris) { const b = d.baris.find((r) => r["Nomor PKR"] === x.nomor); if (!b || r2(num(b["Nilai (Rp)"])) !== x.total || r2(num(b["Dibayar (Rp)"])) !== x.terbayar || r2(num(b["Sisa Ditagih (Rp)"])) !== x.sisa) beda++;
    else if (!x.aktif && b.Status !== "Dibatalkan — tidak ditagih") beda++; else if (x.aktif && !["Lunas", "Dibayar sebagian", "Belum dibayar"].includes(b.Status)) beda++; }
  rec(`${nama}: setiap dokumen (nilai, dibayar, sisa, status) sama dengan hitungan langsung dari tabel; dokumen batal = "Dibatalkan — tidak ditagih" dengan sisa Rp0`, beda === 0, beda ? `${beda} dokumen berbeda` : "identik");
  const aktif = t.baris.filter((x) => x.aktif);
  rec(`${nama}: baris TOTAL hanya dokumen aktif (nilai, dibayar, sisa)`, !!d.total && r2(num(d.total["Nilai (Rp)"])) === r2(aktif.reduce((s, x) => s + x.total, 0)) && r2(num(d.total["Dibayar (Rp)"])) === r2(aktif.reduce((s, x) => s + x.terbayar, 0)) && r2(num(d.total["Sisa Ditagih (Rp)"])) === r2(aktif.reduce((s, x) => s + x.sisa, 0)), d.total ? String(d.total["Nomor PKR"]) : "tanpa baris total");
  const y = sheet(ex.wb, "Pembayaran");
  rec(`${nama}: sheet Pembayaran memuat semua pembayaran (${t.nBayar}), pembayaran batal berstatus Dibatalkan dan TIDAK masuk total aktif (${t.nBayarAktif} pembayaran, Rp${t.bayarAktif})`, y.baris.length === t.nBayar && y.baris.filter((r) => r.Status === "Aktif").length === t.nBayarAktif && (t.nBayar === 0 || (!!y.total && r2(num(y.total["Nominal (Rp)"])) === t.bayarAktif)), `${y.baris.length}/${t.nBayar}`);
  rec(`${nama}: kolom sensitif (Catatan Internal, Rekening) hadir untuk Finance Admin`, d.header.includes("Catatan Internal") && y.header.includes("Rekening"));
  rec(`${nama}: sheet Per Karyawan ada`, sheet(ex.wb, "Per Karyawan").ada);
  const sc = await layar({ from, to }); rec(`${nama}: daftar layar 200`, sc.status === 200);
  if (sc.json) { let sk = 0; for (const p of sc.json.penjualan) { const b = d.baris.find((r) => r["Nomor PKR"] === p.nomor); if (!b || r2(num(b["Nilai (Rp)"])) !== r2(p.total) || r2(num(b["Dibayar (Rp)"])) !== r2(p.terbayar) || r2(num(b["Sisa Ditagih (Rp)"])) !== r2(p.sisa)) sk++; }
    rec(`${nama}: angka Excel sama dengan daftar layar untuk ${sc.json.penjualan.length} dokumen yang tampil di layar`, sk === 0, sk ? `${sk} berbeda` : "identik"); }
}

// ── filter status/pencarian/karyawan: hasil Excel = hasil layar. PEMBANDING SAH hanya bila seluruh data < 500 dokumen: layar memotong 500 baris TERBARU lebih dulu, baru menyaring status turunan (Lunas/Sebagian/Belum),
// sehingga pada data lebih besar layar menampilkan lebih sedikit dari hasil sebenarnya (Excel memuat semuanya).
const layarSah = (await hitung("select count(*)::int n from fin_penjualan_karyawan")) < 500;
const [F0, T0] = ["2025-01-01", "2026-12-31"];
for (const st of ["LUNAS", "SEBAGIAN", "BELUM_BAYAR", "DIBATALKAN"]) {
  const ex = await unduh(tA, { periode: { from: F0, to: T0 }, filter: { status: st } }); const sc = await layar({ from: F0, to: T0, status: st });
  const n = ex.wb ? sheet(ex.wb, "Daftar Penjualan").baris.length : -1;
  if (layarSah && sc.json) rec(`filter status ${st}: jumlah dokumen Excel = layar`, ex.status === 200 && n === sc.json.penjualan.length, `${n} vs ${sc.json.penjualan.length}`); else skip(`filter status ${st}`, "data lebih dari 500 dokumen: layar memotong sebelum menyaring status, bukan pembanding sah (Excel memuat semuanya)");
}
const contoh = (await prisma.$queryRawUnsafe("select nomor, buyer_name, seller_id from fin_penjualan_karyawan order by nomor limit 1"))[0];
if (contoh && layarSah) {
  const kata = String(contoh.buyer_name).split(/\s+/)[0]; const ex = await unduh(tA, { periode: { from: F0, to: T0 }, filter: { q: kata } }); const sc = await layar({ from: F0, to: T0, q: kata });
  rec(`filter pencarian "${kata}": jumlah dokumen Excel = layar`, ex.status === 200 && !!sc.json && sheet(ex.wb, "Daftar Penjualan").baris.length === sc.json.penjualan.length, ex.status);
  const exK = await unduh(tA, { periode: { from: F0, to: T0 }, filter: { sellerId: contoh.seller_id } }); const scK = await layar({ from: F0, to: T0, sellerId: contoh.seller_id });
  rec("filter karyawan: jumlah dokumen Excel = layar dan label filter memakai NAMA (bukan id)", exK.status === 200 && !!scK.json && sheet(exK.wb, "Daftar Penjualan").baris.length === scK.json.penjualan.length && !JSON.stringify(sheet(exK.wb, "Daftar Penjualan")).includes(contoh.seller_id) && JSON.stringify([1, 2, 3, 4].map((i) => sel(exK.wb.getWorksheet("Daftar Penjualan").getCell(`A${i}`)))).includes("Karyawan: "), exK.status);
} else skip("filter pencarian/karyawan dibanding layar", contoh ? "data lebih dari 500 dokumen: layar terpotong, bukan pembanding sah" : "tidak ada dokumen PKR");

// ── izin & penolakan sebelum menyentuh data
rec("tanpa token = 401", (await unduh(null, { periode: { from: F0, to: T0 }, filter: {} })).status === 401);
if (tX) rec("akun tanpa izin Finance = 403 (TIDAK_BERHAK)", (await unduh(tX, { periode: { from: F0, to: T0 }, filter: {} })).status === 403); else skip("akun tanpa izin Finance = 403", "tidak ada akun aktif tanpa izin finance:read");
if (tF) { const ex = await unduh(tF, { periode: { from: F0, to: T0 }, filter: {} }); rec("akun Finance non-Admin: 200 dan TANPA kolom sensitif (Catatan Internal, Rekening)", ex.status === 200 && !!ex.wb && !sheet(ex.wb, "Daftar Penjualan").header.includes("Catatan Internal") && !sheet(ex.wb, "Pembayaran").header.includes("Rekening")); } else skip("akun Finance non-Admin tanpa kolom sensitif", "tidak ada akun aktif ber-izin finance:read tanpa finance:admin");
rec("status tidak valid = 400 FILTER_TIDAK_VALID (tidak menyentuh data)", await (async () => { const r = await unduh(tA, { periode: { from: F0, to: T0 }, filter: { status: "APA_SAJA" } }); return r.status === 400 && r.json?.code === "FILTER_TIDAK_VALID"; })());
rec("periode tidak valid = 400", (await unduh(tA, { periode: { from: "2026-13-45", to: T0 }, filter: {} })).status === 400);

const s1 = await jejak(); const beda = Object.keys(s0).filter((k) => s0[k] !== s1[k]);
rec("TIDAK ada jejak tulis: dokumen, item, pembayaran (aktif/batal), nilai, jurnal, baris jurnal, order, stok sama persis sebelum vs sesudah smoke", beda.length === 0, beda.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(",") || "identik");
rec("jurnal tidak seimbang (sebelum rilis: " + B("BASE_TIDAK_SEIMBANG") + ", tidak bertambah)", (await hitung("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")) <= B("BASE_TIDAK_SEIMBANG"));
rec("jumlah Order & Job tidak berkurang (sebelum: " + B("ORDER_N") + " / " + B("JOB_N") + ")", (await hitung('select count(*)::int n from "Order"')) >= B("ORDER_N") && (await hitung("select count(*)::int n from jobs")) >= B("JOB_N"));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
