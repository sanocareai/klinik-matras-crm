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
const FROM = process.env.SMOKE_FROM ?? "2026-10-01"; const TO = process.env.SMOKE_TO ?? "2026-10-31";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE BACA-SAJA terhadap production hidup: parity layar–API–Excel–tabel untuk Pemasukan (Uang Masuk) dan Rekonsiliasi Sales–Finance, periode FROM..TO (WIB).
// Setiap angka API dibandingkan dengan hitungan LANGSUNG dari tabel (SQL), bukan dari kode rute. Tidak ada tulisan dan tidak ada data percobaan.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const B = (k) => { const mentah = process.env[k]; const v = Number(mentah); if (mentah === undefined || mentah === "" || !Number.isFinite(v) || v < 0) throw new Error(`garis dasar ${k} hilang atau bukan angka ('${mentah}') — gerbang tidak dapat diverifikasi, bukan lulus`); return v; };
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const pembaca = info.find((x) => bisa(x.rs, P.FINANCE_READ) && x.rs.has("ADMIN"))?.u ?? info.find((x) => bisa(x.rs, P.FINANCE_READ))?.u;
const tanpaIzin = info.find((x) => !bisa(x.rs, P.FINANCE_READ) && !x.rs.has("ADMIN") && !x.rs.has("SALES"))?.u;
if (!pembaca) { rec("akun dengan izin finance:read tersedia", false); process.exit(1); }
const tok = await tokenUntuk(pembaca); const tokX = tanpaIzin ? await tokenUntuk(tanpaIzin) : null;
const get = async (url, token = tok) => { const r = await fetch(BASE + url, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const unduh = async (modul, body, token = tok) => { const r = await fetch(`${BASE}/api/finance/export/${modul}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) });
  if (!(r.headers.get("content-type") || "").includes("spreadsheetml")) { let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, wb: null, json: j }; }
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer())); return { status: r.status, wb, json: null }; };
const nilaiSel = (c) => (c.value && typeof c.value === "object" && !(c.value instanceof Date) && "text" in c.value ? c.value.text : c.value);
const bacaSheet = (wb, nama) => { const ws = wb.getWorksheet(nama); const header = []; ws.getRow(6).eachCell({ includeEmpty: false }, (c, i) => { header[i - 1] = nilaiSel(c); }); const baris = []; let total = null;
  for (let r = 7; r <= ws.rowCount; r++) { const row = ws.getRow(r); if (row.actualCellCount === 0) continue; if (nilaiSel(row.getCell(1)) === "Tidak ada data sesuai periode dan filter") continue; const o = {}; header.forEach((h, i) => { o[h] = nilaiSel(row.getCell(i + 1)) ?? null; }); const p = o[header[0]]; if (typeof p === "string" && /^TOTAL/i.test(p)) { total = o; break; } baris.push(o); }
  return { header, baris, total }; };

const JEJAK = [["payments", "select count(*)::int n from payments"], ["verifikasi", "select count(*)::int n from payment_verifications"], ["order", 'select count(*)::int n from "Order"'], ["jurnal", "select count(*)::int n from fin_journal_entries"],
  ["baris_jurnal", "select count(*)::int n from fin_journal_lines"], ["refund", "select count(*)::int n from fin_refunds"], ["nota_kredit", "select count(*)::int n from fin_order_credits"], ["pengecualian_lunas", "select count(*)::int n from order_paid_at_pengecualian"]];
const jejak = async () => Object.fromEntries(await Promise.all(JEJAK.map(async ([k, q]) => [k, await hitung(q)])));
const s0 = await jejak();

// batas periode WIB: awal hari inklusif, awal hari berikutnya eksklusif (UTC = WIB − 7 jam)
const mulai = new Date(`${FROM}T00:00:00+07:00`); const selesai = new Date(new Date(`${TO}T00:00:00+07:00`).getTime() + 86400000);
const NET = "GREATEST(0, o.value - COALESCE((SELECT SUM(k.amount) FROM fin_order_credits k WHERE k.order_id = o.id AND k.status = 'AKTIF'), 0))";
const sqlMasuk = await hitung(`select coalesce(sum(p.amount),0)::bigint n from payments p where p.cancelled_at is null and p.created_at >= $1 and p.created_at < $2 and exists (select 1 from payment_verifications v where v.payment_id = p.id)`, mulai, selesai);
const sqlLunas = await hitung(`select coalesce(sum(${NET}),0)::bigint n from "Order" o join "Customer" c on c.id = o."customerId" where o.paid_at >= $1 and o.paid_at < $2 and o.status::text not in ('CANCELLED','PENDING') and c."pipelineStage"::text <> 'SPAM' and o.penjualan_karyawan_id is null`, mulai, selesai);
const sqlKohort = await hitung(`select coalesce(sum(${NET}),0)::bigint n from "Order" o join "Customer" c on c.id = o."customerId" where o."createdAt" >= $1 and o."createdAt" < $2 and o.status::text not in ('CANCELLED','PENDING') and o."paymentStatus"::text = 'LUNAS' and c."pipelineStage"::text <> 'SPAM' and o.penjualan_karyawan_id is null`, mulai, selesai);
const sqlTdkHitung = await hitung(`select count(*)::int n from payments p where p.created_at >= $1 and p.created_at < $2 and p.cancelled_at is not null`, mulai, selesai);
console.log(`  (periode ${FROM}..${TO}: uang masuk terverifikasi ${sqlMasuk}; nilai lunas periode ${sqlLunas}; kohort dibuat-lunas ${sqlKohort}; pembayaran batal/tolak ${sqlTdkHitung})`);

// ── Rekonsiliasi Sales–Finance
const rk = await get(`/api/sales-finance/rekon?from=${FROM}&to=${TO}`);
rec("GET /sales-finance/rekon: 200 dan status perhitungan COCOK (semua residual Rp0)", rk.status === 200 && rk.json?.status?.perhitungan === "COCOK" && rk.json?.residual === 0 && rk.json?.tahap1?.residual === 0 && rk.json?.tahap2?.residual === 0 && rk.json?.kohort?.residual === 0, rk.status === 200 ? JSON.stringify([rk.json.residual, rk.json.tahap1?.residual, rk.json.tahap2?.residual, rk.json.kohort?.residual]) : rk.status);
if (rk.json) {
  rec("Uang Masuk Terverifikasi (API) = Σ payments aktif terverifikasi di periode (SQL langsung)", rk.json.kartu.uangMasukDariOrder === sqlMasuk, `${rk.json.kartu.uangMasukDariOrder} vs ${sqlMasuk}`);
  rec("Total Perusahaan (API) = Σ nilai bersih order lunas di periode, tanpa PKR (SQL langsung)", rk.json.kartu.totalPerusahaan === sqlLunas, `${rk.json.kartu.totalPerusahaan} vs ${sqlLunas}`);
  rec("Sudah Lunas kohort dibuat (API) = Σ nilai bersih order dibuat di periode & Lunas (SQL langsung)", rk.json.kartu.sudahLunasKohortDibuat === sqlKohort, `${rk.json.kartu.sudahLunasKohortDibuat} vs ${sqlKohort}`);
  const g = (k) => rk.json.bridge.find((b) => b.kunci === k)?.jumlah ?? 0;
  const jembatan = g("UANG_MASUK") - g("DP_BELUM_LUNAS") - g("ORDER_TIDAK_DIHITUNG") - g("LUNAS_PERIODE_LAIN") - g("REFUND_NON_LUNAS") + g("DP_SEBELUMNYA") - g("REFUND_LUNAS") - g("ONGKIR") - g("KLAIM_TANPA_PAYMENT") - g("PAYMENT_MENUNGGU") - g("PAYMENT_KURANG") - g("KELEBIHAN_BAYAR") - g("SELISIH_LAIN");
  rec("jembatan tahap 1 menutup persis: Uang Masuk − komponen = Total Perusahaan", jembatan === rk.json.kartu.totalPerusahaan, `${jembatan} vs ${rk.json.kartu.totalPerusahaan}`);
  const k = rk.json.kohort; const gk = (kunci) => k.langkah.find((b) => b.kunci === kunci)?.jumlah ?? 0;
  rec("jembatan kohort menutup persis: Sudah Lunas − di luar + dibuat sebelum + bukan-lunas = Total Perusahaan", gk("KOHORT_DIBUAT_LUNAS") - gk("KOHORT_LUNAS_DI_LUAR") + gk("KOHORT_DIBUAT_SEBELUM") + gk("KOHORT_BELUM_LUNAS_PAIDAT") === rk.json.kartu.totalPerusahaan);
  if (rk.json.detailTersedia) {
    const tanpaAlasan = Object.entries(rk.json.detail).filter(([kunci]) => ["LUNAS_PERIODE_LAIN", "KOHORT_LUNAS_DI_LUAR", "KOHORT_DIBUAT_SEBELUM", "KOHORT_BELUM_LUNAS_PAIDAT"].includes(kunci)).flatMap(([kunci, arr]) => arr.filter((o) => !o.alasan).map((o) => `${kunci}:${o.nomor}`));
    rec("setiap order di jembatan lintas-periode/kohort membawa alasan tertulis dan nomor order", tanpaAlasan.length === 0, tanpaAlasan.slice(0, 5).join(","));
    const payTanpaDok = Object.values(rk.json.detail).flat().flatMap((o) => o.pembayaran ?? []).filter((p) => !p.ref || p.tanggalWib === undefined);
    rec("setiap pembayaran di rincian membawa ID dokumen (ref) dan tanggal WIB", payTanpaDok.length === 0, payTanpaDok.length);
    rec("Σ detail UANG_MASUK = kartu uang masuk (daftar order = angka)", rk.json.detail.UANG_MASUK.reduce((a, o) => a + o.jumlah, 0) === rk.json.kartu.uangMasukDariOrder);
  }
}

// ── Pemasukan (Uang Masuk): layar = SQL = Excel
const halaman = []; let page = 1; let totalNilai = null; let totalTidak = null; let totalBaris = null;
for (let h = 0; h < 40; h++) { const r = await get(`/api/finance/pemasukan?from=${FROM}&to=${TO}&kategori=PEMBAYARAN&limit=100&page=${page}`); if (r.status !== 200) { rec("GET /finance/pemasukan?kategori=PEMBAYARAN 200", false, r.status); break; } halaman.push(...r.json.items); totalNilai = r.json.totalNilai; totalTidak = r.json.totalTidakDihitung; totalBaris = r.json.total; if (!r.json.adaLagi) break; page += 1; }
rec("total layar Uang Masuk = Σ payments terverifikasi (SQL langsung)", Number(totalNilai) === sqlMasuk, `${totalNilai} vs ${sqlMasuk}`);
rec("jumlah baris layar = semua payment tercatat di periode (terverifikasi + menunggu + ditolak + dibatalkan); tidak ada baris hilang", halaman.length === totalBaris && halaman.length === await hitung("select count(*)::int n from payments p where p.created_at >= $1 and p.created_at < $2", mulai, selesai), `${halaman.length}/${totalBaris}`);
const sumDihitung = halaman.reduce((a, b) => a + Number(b.nilaiDihitung), 0);
rec("Σ nilaiDihitung baris = total layar (satu aturan 'dihitung ke total')", Math.round(sumDihitung * 100) === Math.round(Number(totalNilai) * 100), `${sumDihitung} vs ${totalNilai}`);
const tidakDihitung = halaman.filter((b) => b.dihitung === false);
rec("setiap baris yang tidak dihitung membawa alasan tertulis; baris dihitung tanpa alasan", tidakDihitung.every((b) => b.alasanTidakDihitung && Number(b.nilaiDihitung) === 0) && halaman.filter((b) => b.dihitung).every((b) => !b.alasanTidakDihitung && b.nilaiDihitung === b.nilai), `${tidakDihitung.length} tidak dihitung`);
rec("jumlah & nilai 'tidak dihitung' di respons = Σ baris tidak dihitung", totalTidak?.jumlah === tidakDihitung.length && Math.round(Number(totalTidak?.nilai) * 100) === Math.round(tidakDihitung.reduce((a, b) => a + Number(b.nilai), 0) * 100));
// Tautan pengganti: tiap baris dibatalkan/ditolak yang order-nya masih punya pembayaran AKTIF harus menunjuk pembayaran aktif pada order yang SAMA; tanpa pembayaran aktif → tidak ada tautan.
const dibatalLayar = tidakDihitung.filter((b) => b.sub === "PEMBAYARAN_TIDAK_DIHITUNG");
let salahTaut = 0;
for (const b of dibatalLayar) {
  const aktif = await prisma.$queryRawUnsafe("select p.id::text i from payments p where p.order_id = (select order_id from payments where id = $1::uuid) and p.cancelled_at is null", b.id);
  const ids = new Set(aktif.map((x) => x.i));
  if (ids.size === 0 ? b.pengganti !== null : !(b.pengganti && ids.has(b.pengganti.id) && b.alasanTidakDihitung.includes(String(b.pengganti.id).slice(0, 8)))) salahTaut++;
}
rec("setiap pembayaran dibatalkan/ditolak menautkan pembayaran AKTIF pada order yang sama (atau tidak ada tautan bila order tak punya pembayaran aktif), id pengganti tercantum di alasan", salahTaut === 0, salahTaut + " salah");
for (const b of dibatalLayar) console.log("  SNAPSHOT_TIDAK_DIHITUNG " + [b.id.slice(0, 8), b.nomor, b.nilai, b.statusLabel, b.pengganti ? b.pengganti.kecocokan + ":" + String(b.pengganti.id).slice(0, 8) : "tanpa-pengganti", JSON.stringify(b.alasanTidakDihitung).slice(0, 140)].join(" | "));
console.log("  SNAPSHOT_TOTAL layar=" + totalNilai + " SUM_dihitung=" + sumDihitung + " tidak_dihitung=" + tidakDihitung.reduce((a, b) => a + Number(b.nilai), 0));
rec("pembayaran dibatalkan/ditolak di periode (SQL) = baris tidak dihitung di layar", tidakDihitung.length === sqlTdkHitung, `${tidakDihitung.length} vs ${sqlTdkHitung}`);

const ex = await unduh("pemasukan", { periode: { from: FROM, to: TO }, filter: { kategori: "PEMBAYARAN" } });
rec("Export Excel Pemasukan (Uang Masuk): 200 berupa xlsx", ex.status === 200 && !!ex.wb, ex.status);
if (ex.wb) {
  const s = bacaSheet(ex.wb, "Pemasukan");
  rec("kolom baru ada: Dihitung ke Total? · Nilai yang Dihitung (Rp) · Alasan Tidak Dihitung; kolom Nilai (Rp) historis dipertahankan", ["Dihitung ke Total?", "Nilai yang Dihitung (Rp)", "Alasan Tidak Dihitung", "Nilai (Rp)"].every((h) => s.header.includes(h)));
  const sumKolom = s.baris.reduce((a, x) => a + (x["Nilai yang Dihitung (Rp)"] || 0), 0); const sumMentah = s.baris.reduce((a, x) => a + (x["Nilai (Rp)"] || 0), 0);
  rec("SUM kolom 'Nilai yang Dihitung' = TOTAL Excel = total layar = SQL", Math.round(sumKolom) === Math.round(s.total?.["Nilai yang Dihitung (Rp)"] ?? 0) && Math.round(sumKolom) === sqlMasuk, `${sumKolom} / ${s.total?.["Nilai yang Dihitung (Rp)"] ?? "(tanpa baris total: periode kosong)"} / ${sqlMasuk}`);
  rec("SUM mentah kolom 'Nilai (Rp)' − TOTAL = Σ nilai baris yang tidak dihitung (selisih dijelaskan baris per baris)", Math.round(sumMentah - sumKolom) === Math.round(tidakDihitung.reduce((a, b) => a + Number(b.nilai), 0)), `${sumMentah - sumKolom}`);
  rec("jumlah baris Excel = jumlah baris layar", s.baris.length === halaman.length, `${s.baris.length}/${halaman.length}`);
  rec("setiap baris 'Tidak' di Excel punya alasan", s.baris.filter((x) => x["Dihitung ke Total?"] === "Tidak").every((x) => x["Alasan Tidak Dihitung"] && x["Nilai yang Dihitung (Rp)"] === 0));
}
const exr = await unduh("rekon-sales-finance", { periode: { from: FROM, to: TO } });
rec("Export Excel Rekonsiliasi Sales-Finance: 200 dan memuat jembatan kohort", exr.status === 200 && !!exr.wb && (() => { const ws = exr.wb.getWorksheet("Jembatan"); return !!ws && JSON.stringify(ws.getSheetValues()).includes("Jembatan kohort"); })(), exr.status);

// ── izin & validasi
rec("tanpa token = 401 (pemasukan dan rekon)", (await get(`/api/finance/pemasukan?from=${FROM}&to=${TO}`, null)).status === 401 && (await get(`/api/sales-finance/rekon?from=${FROM}&to=${TO}`, null)).status === 401);
rec("periode rekon tidak valid = 400", (await get("/api/sales-finance/rekon?from=x&to=y")).status === 400);
if (tokX) rec("akun tanpa izin finance = 403 (pemasukan dan export)", (await get(`/api/finance/pemasukan?from=${FROM}&to=${TO}`, tokX)).status === 403 && (await unduh("pemasukan", { periode: { from: FROM, to: TO } }, tokX)).status === 403); else skip("akun tanpa izin finance = 403", "tidak ada akun aktif tanpa izin finance/ADMIN/SALES");

// ── tanpa jejak tulis (produksi hidup: tabel tidak boleh BERKURANG)
const s1 = await jejak(); const turun = Object.keys(s0).filter((k) => s1[k] < s0[k]);
rec("TIDAK ada jejak tulis destruktif: payments, verifikasi, order, jurnal, baris jurnal, refund, nota kredit, pengecualian lunas tidak berkurang selama smoke", turun.length === 0, turun.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(",") || "tidak ada yang berkurang");
const naik = Object.keys(s0).filter((k) => s1[k] > s0[k]); if (naik.length) console.log("  (info: bertambah selama smoke karena pengguna lain/aplikasi hidup — smoke ini hanya GET/POST export: " + naik.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(",") + ")");
rec("jurnal tidak seimbang (sebelum rilis: " + B("BASE_TIDAK_SEIMBANG") + ", tidak bertambah)", (await hitung("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")) <= B("BASE_TIDAK_SEIMBANG"));
rec("jumlah Order & Payment tidak berkurang (sebelum: " + B("ORDER_N") + " / " + B("PAY_N") + ")", (await hitung('select count(*)::int n from "Order"')) >= B("ORDER_N") && (await hitung("select count(*)::int n from payments")) >= B("PAY_N"));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
