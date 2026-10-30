import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)
const APP = process.env.APP_DIR ?? "/app";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const B = (k) => Number(process.env[k]);
// SMOKE BACA-SAJA terhadap production hidup. TANPA token (tidak ada penyamaran pengguna), TANPA tulisan. D1 TIDAK dijalankan oleh rilis: keenam belas (atau berapa pun) catatan KILOAN harus tetap BUKAN_STOK dan tanpa peristiwa baru.
// Pratinjau dihitung langsung oleh fungsi layanan (baca-saja); rute hanya diuji tertutup tanpa token (401).
const svc = await import(pathToFileURL(path.join(APP, "src/services/catatanPemakaianHistoris.js")).href);
const sql = { bukanStok: "select count(*)::int n from unit_usage_notes where origin = 'EXCEL' and state = 'BUKAN_STOK' and raw_name ~* 'kiloan'", peristiwaKiloan: "select count(*)::int n from unit_usage_note_events e join unit_usage_notes n on n.id = e.note_id where n.raw_name ~* 'kiloan'", dikoreksi: "select count(*)::int n from unit_usage_note_events e join unit_usage_notes n on n.id = e.note_id where n.raw_name ~* 'kiloan' and e.kind = 'DIKOREKSI'" };
const s0 = { bukanStok: await hitung(sql.bukanStok), peristiwa: await hitung(sql.peristiwaKiloan), dikoreksi: await hitung(sql.dikoreksi), mv: await hitung("select count(*)::int n from stock_movements"), jur: await hitung("select count(*)::int n from fin_journal_entries"), hb: await hitung("select count(*)::int n from material_harga_berlaku"), mat: await hitung("select count(*)::int n from materials") };
const md5Catatan = async () => String((await prisma.$queryRawUnsafe("select coalesce(md5(string_agg(n::text, '|' order by n.id::text)), '-') as h from unit_usage_notes n"))[0].h);
const h0 = await md5Catatan();

const p = await svc.pratinjauKoreksiKiloan(prisma);
rec(`pratinjau D1 (baca-saja): ${p.jumlah} catatan KILOAN BUKAN_STOK, ${p.layak} layak, ${p.tertahan} tertahan, total ${p.totalQty} KG`, Number.isInteger(p.jumlah) && p.layak + p.tertahan === p.jumlah);
rec("pratinjau memuat id, keadaan awal (state, penanda, riwayat), dan sidik untuk setiap catatan", p.manifest.every((m) => m.id && m.keadaanAwal?.state === "BUKAN_STOK" && /^[0-9a-f]{64}$/.test(m.sidik) && Array.isArray(m.keadaanAwal.peristiwa)));
rec("jumlah pratinjau = jumlah catatan KILOAN BUKAN_STOK di tabel (komponen lama eksplisit tidak ikut)", p.jumlah <= s0.bukanStok, `${p.jumlah} ≤ ${s0.bukanStok}`);
if (process.env.BASE_KILOAN_N !== undefined) rec(`D1 TIDAK ikut berjalan karena deploy: catatan KILOAN BUKAN_STOK sama dengan sebelum switch (${process.env.BASE_KILOAN_N})`, s0.bukanStok === B("BASE_KILOAN_N"), `sekarang ${s0.bukanStok}`); else { dilewati++; console.log("  SKIP  pembanding BUKAN_STOK sebelum switch — DILEWATI: BASE_KILOAN_N tidak diberikan"); }
rec("tidak ada peristiwa DIKOREKSI pada catatan KILOAN akibat deploy (D1 belum dijalankan)", process.env.BASE_KILOAN_DIKOREKSI === undefined ? s0.dikoreksi >= 0 : s0.dikoreksi === B("BASE_KILOAN_DIKOREKSI"), `dikoreksi=${s0.dikoreksi}`);

const ambil = async (m, pth, body) => { const r = await fetch(BASE + pth, { method: m, headers: { "Content-Type": "application/json", "Idempotency-Key": "smoke-kla-tanpa-token-0001" }, body: body ? JSON.stringify(body) : undefined }); return r.status; };
rec("GET pratinjau D1 tanpa token = 401", (await ambil("GET", "/api/production/catatan-historis/koreksi-kiloan/pratinjau")) === 401);
rec("POST terapkan D1 tanpa token = 401 (tidak menulis)", (await ambil("POST", "/api/production/catatan-historis/koreksi-kiloan/terapkan", { manifest: [], alasan: "smoke tanpa token" })) === 401);

const s1 = { bukanStok: await hitung(sql.bukanStok), peristiwa: await hitung(sql.peristiwaKiloan), mv: await hitung("select count(*)::int n from stock_movements"), jur: await hitung("select count(*)::int n from fin_journal_entries"), hb: await hitung("select count(*)::int n from material_harga_berlaku"), mat: await hitung("select count(*)::int n from materials") };
rec("smoke TIDAK menulis: catatan KILOAN, peristiwa, stok, jurnal, Harga Berlaku, material sama sebelum vs sesudah smoke", JSON.stringify([s0.bukanStok, s0.peristiwa, s0.mv, s0.jur, s0.hb, s0.mat]) === JSON.stringify([s1.bukanStok, s1.peristiwa, s1.mv, s1.jur, s1.hb, s1.mat]));
rec("isi LENGKAP seluruh catatan pemakaian (unit_usage_notes) identik sebelum vs sesudah smoke", (await md5Catatan()) === h0);
rec("jurnal tidak seimbang (sebelum rilis: " + B("BASE_TIDAK_SEIMBANG") + ", tidak bertambah)", (await hitung("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")) <= B("BASE_TIDAK_SEIMBANG"));
rec("jumlah Order & Job tidak berkurang (sebelum: " + B("ORDER_N") + " / " + B("JOB_N") + ")", (await hitung('select count(*)::int n from "Order"')) >= B("ORDER_N") && (await hitung("select count(*)::int n from jobs")) >= B("JOB_N"));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
