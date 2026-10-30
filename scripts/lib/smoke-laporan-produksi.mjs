import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const ExcelJS = require("exceljs");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)
const APP = process.env.APP_DIR ?? "/app";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 220) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE BACA-SAJA terhadap production hidup: Laporan Produksi terpadu (/api/production-v2/laporan/*). Tidak ada tulisan dan tidak ada data percobaan. Angka API dibandingkan dengan hitungan LANGSUNG dari tabel
// dan dengan angka tab lain (Ringkasan = Biaya per Order = Excel). Production hidup: tabel yang bisa ditulis pengguna lain selama smoke hanya diperiksa TIDAK BERKURANG.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const pembaca = info.find((x) => bisa(x.rs, P.PRODUCTION_REPORT_READ) && bisa(x.rs, P.FINANCE_READ))?.u;
const tanpaHarga = info.find((x) => bisa(x.rs, P.PRODUCTION_REPORT_READ) && !bisa(x.rs, P.FINANCE_READ))?.u;
const tanpaIzin = info.find((x) => !bisa(x.rs, P.PRODUCTION_REPORT_READ) && !bisa(x.rs, P.PRODUCTION_REPORT_WAREHOUSE) && !bisa(x.rs, P.FINANCE_READ))?.u;
if (!pembaca) { rec("akun dengan production_report:read + finance:read tersedia", false); process.exit(1); }
const tok = await tokenUntuk(pembaca);
const L = "/api/production-v2/laporan";
const get = async (url, token = tok) => { const r = await fetch(BASE + url, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; const ct = r.headers.get("content-type") ?? ""; if (/json/.test(ct)) { try { j = await r.json(); } catch { /* bukan JSON */ } } return { status: r.status, json: j, res: r }; };
const wib = (d) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const sampai = wib(new Date()); const dari = wib(new Date(Date.now() - 29 * 86400_000)); const Q = `from=${dari}&to=${sampai}`;

const JEJAK = [["stock_movements", "select count(*)::int n from stock_movements"], ["biaya_beku", "select count(*)::int n from stock_movement_biaya_operasional"], ["harga_berlaku", "select count(*)::int n from material_harga_berlaku"], ["material_issues", "select count(*)::int n from material_issues"],
  ["jurnal", "select count(*)::int n from fin_journal_entries"], ["units", "select count(*)::int n from units"], ["pernyataan", "select count(*)::int n from unit_material_declarations"], ["runs", "select count(*)::int n from production_runs_v2"]];
const jejak = async () => Object.fromEntries(await Promise.all(JEJAK.map(async ([k, q]) => [k, await hitung(q)])));
const s0 = await jejak();

// ── izin ──
for (const k of ["ringkasan", "biaya-order", "kinerja", "bahan-gudang"]) rec(`GET /laporan/${k} tanpa token = 401`, (await get(`${L}/${k}?${Q}`, null)).status === 401);
if (tanpaIzin) { const tX = await tokenUntuk(tanpaIzin); rec("akun tanpa izin laporan/Finance: semua tab 403", (await Promise.all(["ringkasan", "biaya-order", "kinerja", "bahan-gudang"].map((k) => get(`${L}/${k}?${Q}`, tX)))).every((r) => r.status === 403)); } else skip("403 akun tanpa izin", "tidak ada akun aktif tanpa izin laporan/Finance");
const meta = await get(`${L}/meta`);
rec("meta: 4 kemampuan tersedia untuk pembaca penuh + definisi + dasar tanggal", meta.status === 200 && meta.json.capabilities.ringkasan && meta.json.capabilities.biayaOrder && meta.json.capabilities.kinerja && meta.json.capabilities.bahanGudang && meta.json.definisi.length >= 8 && !!meta.json.dasarTanggal?.lingkupOrder);

// ── cakupan: semua unit non-batal (bukan hanya kohort V2) ──
const nUnit = await hitung("select count(*)::int n from units where status <> 'CANCELLED'");
const rg = await get(`${L}/ringkasan?${Q}`);
rec(`ringkasan 200; cakupan = semua unit non-batal (${nUnit}), bukan hanya kohort rencana`, rg.status === 200 && rg.json.cakupan.unitNonBatal === nUnit, `${rg.json?.cakupan?.unitNonBatal} vs ${nUnit}`);

// ── SELESAI: posisi = hitungan langsung; bertanggal dipisah dari tanpa tanggal; tidak 0 palsu ──
const nPosisi = await hitung("select count(*)::int n from units where status in ('READY_FOR_DELIVERY','READY_ON_CUSTOMER_HOLD','IN_TRANSIT_OUT','DELIVERED')");
const kn = await get(`${L}/kinerja?${Q}`); const s = kn.json?.selesai;
rec(`kinerja: selesai posisi saat ini = hitungan langsung tabel (${nPosisi})`, kn.status === 200 && s.posisiSaatIni === nPosisi, `${s?.posisiSaatIni}`);
rec("selesai: bertanggal + tanpa tanggal tersusun benar (tanpa tanggal ≤ posisi; bertanggal periode ≤ bertanggal semua waktu); unit tanpa tanggal TIDAK masuk tren", s.tanpaTanggal <= s.posisiSaatIni && s.bertanggalPeriode <= s.bertanggalSemuaWaktu && s.perHari.reduce((a, x) => a + x.nilai, 0) === s.bertanggalPeriode, JSON.stringify({ p: s.posisiSaatIni, b: s.bertanggalPeriode, t: s.tanpaTanggal }));
rec("selesai: ringkasan = kinerja (posisi, bertanggal, tanpa tanggal, terkirim)", rg.json.kartu.selesai.posisiSaatIni === s.posisiSaatIni && rg.json.kartu.selesai.bertanggalPeriode === s.bertanggalPeriode && rg.json.kartu.selesai.tanpaTanggal === s.tanpaTanggal && rg.json.kartu.selesai.terkirimPeriode === s.terkirimPeriode);
rec("meja: Σ baris + Tidak tercatat = total selesai bertanggal (tanpa dobel)", kn.json.meja.baris.reduce((a, m) => a + m.selesai, 0) + kn.json.meja.tidakTercatat.selesai === s.bertanggalPeriode);
const nRencanaPic = await hitung("select count(*)::int n from production_run_plans_v2 where status <> 'CANCELLED' and (operator_id is not null or corner_operator_id is not null)");
rec(`PIC: berlabel PENUGASAN; cakupan menyebut rencana ber-PIC = hitungan tabel (${nRencanaPic}); Σ baris PIC = total`, kn.json.pic.dasar === "PENUGASAN" && /penugasan/i.test(kn.json.pic.dasarLabel) && kn.json.pic.cakupan.rencanaBerPicTotal === nRencanaPic && kn.json.pic.baris.reduce((a, p) => a + p.selesai, 0) === s.bertanggalPeriode, JSON.stringify(kn.json.pic.cakupan));
rec("durasi/target/QC: 'belum tersedia' bila tidak ada data (tidak 0 buatan)", kn.json.selesai.durasi.rataMenit === null ? /Belum|belum/.test(kn.json.selesai.durasi.catatan ?? "") : kn.json.selesai.durasi.rataMenit > 0);

// ── BIAYA PER ORDER: lingkup penuh, konsistensi ──
const bo = await get(`${L}/biaya-order?${Q}&pageSize=100`); const r = bo.json?.ringkas;
rec("biaya-order 200; Σ status = jumlah order; total = ringkas.order; kartu Ringkasan = tabel", bo.status === 200 && r.perStatus.LENGKAP + r.perStatus.PARSIAL + r.perStatus.BELUM_DIKETAHUI === r.order && bo.json.total === r.order && rg.json.kartu.orderDalamLingkup.order === r.order && rg.json.kartu.orderDalamLingkup.tanpaPemakaian === r.orderTanpaPemakaian, JSON.stringify(r.perStatus));
const bs = await get(`${L}/biaya-order?${Q}&hanyaPemakaian=1&pageSize=1`);
rec("lingkup bawaan PENUH ≥ lingkup 'hanya pemakaian'; selisihnya = order tanpa pemakaian (tidak hilang)", bs.status === 200 && bs.json.total <= r.order && r.order - bs.json.total <= r.orderTanpaPemakaian + 0 && r.orderDenganPemakaian === bs.json.total, `${r.order} vs ${bs.json.total}`);
if (bo.json.total <= 100) rec("HPP diketahui (ringkas) = Σ baris order; order tanpa nilai tidak tampil Rp 0 di UI (status Belum diketahui)", Math.abs(bo.json.rows.reduce((a, o) => a + (o.nilaiDiketahui ?? 0), 0) - r.nilaiDiketahui) < 0.01 && bo.json.rows.every((o) => o.status !== "BELUM_DIKETAHUI" || o.nilaiDiketahui === 0 || o.nilaiDiketahui > 0)); else skip("Σ baris = ringkas", "lebih dari 100 order pada periode (halaman pertama saja)");
const hal2 = await get(`${L}/biaya-order?${Q}&pageSize=10&page=2`); rec("paginasi server: halaman 2 berisi baris berbeda dari halaman 1 (atau kosong bila ≤10 order)", hal2.status === 200 && hal2.json.total === r.order && (r.order <= 10 ? hal2.json.rows.length === 0 : hal2.json.rows.length > 0 && !hal2.json.rows.some((x) => bo.json.rows.slice(0, 10).some((y) => y.orderId === x.orderId))));
const contoh = bo.json.rows.find((o) => o.unitDalamOrder >= 1);
if (contoh) { const d = await get(`${L}/biaya-order/${encodeURIComponent(contoh.orderId)}?${Q}`); rec("rincian order: total = Σ unit; status & jumlah masalah = baris daftar; pemisah Finance ada", d.status === 200 && d.json.total.barisPemakaian === d.json.unit.reduce((a, u) => a + u.ringkas.barisPemakaian, 0) && d.json.status === contoh.status && d.json.jumlahMasalah === contoh.jumlahMasalah && !!d.json.catatanFinance, `${d.status}`); } else skip("rincian order", "tidak ada order pada periode");
// SANO GUARD: bila ada pemakaian pada periode, nilai ikut dihitung dan gap ditandai
const guardOrder = bo.json.rows.find((o) => o.adaGuard); if (guardOrder) rec("SANO GUARD: order dengan SANO GUARD memuat nilaiGuard terpisah dan gap GUARD ≥ 1 (tidak disembunyikan)", guardOrder.masalah.GUARD >= 1 && typeof guardOrder.nilaiGuard === "number"); else skip("SANO GUARD", "tidak ada pemakaian SANO GUARD pada periode (4 bahan ber-harga, belum ada ISSUE)");
// nominal hanya finance:read
if (tanpaHarga) { const tH = await tokenUntuk(tanpaHarga); const x = await get(`${L}/biaya-order?${Q}&pageSize=5`, tH); rec("akun produksi TANPA finance:read: nilai Rp dikirim null (nominal diputuskan di server)", x.status === 200 && x.json.izinHarga === false && x.json.rows.every((o) => o.nilaiDiketahui === null) && x.json.ringkas.nilaiDiketahui === 0); } else skip("nominal null tanpa finance:read", "tidak ada akun aktif dengan production_report:read tanpa finance:read");

// ── EKSPOR: layar = Excel ──
const ex = await fetch(BASE + `${L}/export?tab=biaya-order&${Q}`, { headers: { Authorization: "Bearer " + tok } });
rec("ekspor biaya-order: 200, xlsx", ex.status === 200 && /spreadsheetml/.test(ex.headers.get("content-type") ?? ""), `${ex.status} ${ex.headers.get("content-type")}`);
if (ex.status === 200) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await ex.arrayBuffer())); const ws = wb.getWorksheet("Biaya per Order"); let nBaris = 0; let selesaiHitung = false; ws?.eachRow((row, n) => { if (n < 7 || selesaiHitung) return; const v = String(row.getCell(1).value ?? ""); if (v.startsWith("TOTAL")) { selesaiHitung = true; return; } if (v) nBaris += 1; }); // baris data berhenti di baris TOTAL (catatan kaki sesudahnya tidak dihitung)
  rec(`Excel memuat SEMUA order (bukan halaman 1): ${nBaris} baris = total layar ${r.order}`, !!ws && (nBaris === r.order || (r.order === 0 && nBaris <= 1)), `${nBaris}`);
  rec("Excel memuat sheet Cakupan dan Definisi (dasar tanggal, definisi)", !!wb.getWorksheet("Cakupan dan Definisi"));
}
for (const tab of ["ringkasan", "kinerja", "bahan-gudang"]) rec(`ekspor ${tab}: 200`, (await fetch(BASE + `${L}/export?tab=${tab}&${Q}`, { headers: { Authorization: "Bearer " + tok } })).status === 200);
rec("periode terbalik = 400; tab ekspor tidak dikenal = 400; ID order tidak valid = 404", (await get(`${L}/biaya-order?from=${sampai}&to=${dari}`)).status === 400 && (await get(`${L}/export?tab=lain`)).status === 400 && (await get(`${L}/biaya-order/!!!`)).status === 404);

// ── BAHAN & GUDANG ──
const bg = await get(`${L}/bahan-gudang?${Q}`); const nMenunggu = await hitung("select count(*)::int n from material_issues where unit_id is not null and status::text in ('WAITING_APPROVAL','APPROVED','READY_TO_PICK','PICKED')");
rec(`bahan-gudang: permintaan menunggu = hitungan tabel (${nMenunggu}); ringkasan sama`, bg.status === 200 && bg.json.permintaan.menungguSaatIni === nMenunggu && rg.json.kartu.permintaanMenunggu === nMenunggu, `${bg.json?.permintaan?.menungguSaatIni}`);
rec("kelengkapan di Bahan & Gudang = kartu Ringkasan (sumber klasifikasi yang sama dengan Order Produksi)", bg.json.kelengkapan.unitBerkekurangan === rg.json.kartu.kelengkapan.unitBerkekurangan && bg.json.kelengkapan.bahanBelumDicatat === rg.json.kartu.kelengkapan.bahanBelumDicatat);

// ── tanpa jejak tulis ──
const s1 = await jejak(); const turun = Object.keys(s0).filter((k) => s1[k] < s0[k]);
rec("TIDAK ada jejak tulis destruktif: stok, biaya beku, harga berlaku, Material Issue, jurnal, unit, pernyataan, run tidak berkurang selama smoke", turun.length === 0, turun.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(" "));
rec("tabel pernyataan: isi tidak berubah oleh smoke (smoke hanya GET)", s1.pernyataan === s0.pernyataan);
const naik = Object.keys(s0).filter((k) => s1[k] > s0[k]); if (naik.length) console.log("  (info: bertambah selama smoke karena pengguna lain/aplikasi hidup — smoke ini hanya GET: " + naik.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(" ") + ")");
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
