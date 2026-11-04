import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)
const APP = process.env.APP_DIR ?? "/app";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE "TIDAK MENULIS" laporan Nilai Persediaan: hanya GET. TIDAK ada pencatatan hasil SO, tidak ada penulisan apa pun (dibuktikan hitung baris sebelum vs sesudah).
// Kebenaran = invarian atas data nyata terhadap TABEL pada satu waktu acuan tetap (10 menit lalu), bukan angka tetap: saldo = jumlah pergerakan ≤ waktu, nilai = saldo × Harga Berlaku, saldo akun = jumlah jurnal akun.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const nominal = info.find((x) => bisa(x.rs, P.INVENTORY_READ) && bisa(x.rs, P.FINANCE_READ))?.u;
const tanpaNominal = info.find((x) => bisa(x.rs, P.INVENTORY_READ) && !bisa(x.rs, P.FINANCE_READ))?.u;
const tanpaBaca = info.find((x) => !bisa(x.rs, P.INVENTORY_READ))?.u;
const tanpaTulis = info.find((x) => bisa(x.rs, P.INVENTORY_READ) && !bisa(x.rs, P.INVENTORY_WRITE))?.u;
if (!nominal) { rec("akun dengan inventory:read + finance:read tersedia", false); process.exit(1); }
const http = async (method, url, token, body = null, header = {}) => { const r = await fetch(BASE + url, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...header }, ...(body ? { body: JSON.stringify(body) } : {}) }); let j = null; if (/json/.test(r.headers.get("content-type") ?? "")) { try { j = await r.json(); } catch { j = null; } } return { status: r.status, json: j }; };
const JEJAK = [["stock_movements", "select count(*)::int n from stock_movements"], ["biaya_beku", "select count(*)::int n from stock_movement_biaya_operasional"], ["harga_berlaku", "select count(*)::int n from material_harga_berlaku"], ["jurnal", "select count(*)::int n from fin_journal_entries"],
  ["penyesuaian", "select count(*)::int n from stock_adjustment_requests"], ["goods_receipts", "select count(*)::int n from goods_receipts"], ["persediaan_awal", "select count(*)::int n from fin_inventory_openings"], ["pengaturan_finance", "select count(*)::int n from fin_settings"], ["hasil_so", "select count(*)::int n from activity_events where entity_type = 'hasil_so_bahan'"]];
const jejak = async () => { const o = {}; for (const [k, q] of JEJAK) { try { o[k] = await hitung(q); } catch { o[k] = null; } } return o; };
const s0 = await jejak(); const URL_API = "/api/inventory/nilai-persediaan"; const tN = await tokenUntuk(nominal);

rec("tanpa token = 401", (await http("GET", URL_API, null)).status === 401);
rec("pencatatan hasil SO tanpa token = 401", (await http("POST", URL_API + "/hasil-so", null, { baris: [] })).status === 401);
rec("riwayat hasil SO tanpa token = 401", (await http("GET", URL_API + "/hasil-so/00000000-0000-4000-8000-000000000000", null)).status === 401);
if (tanpaBaca) rec("peran tanpa inventory:read = 403", (await http("GET", URL_API, await tokenUntuk(tanpaBaca))).status === 403); else skip("peran tanpa inventory:read = 403", "tidak ada akun aktif tanpa inventory:read");
if (tanpaTulis) rec("pencatatan hasil SO tanpa inventory:write = 403 (tanpa menulis apa pun)", (await http("POST", URL_API + "/hasil-so", await tokenUntuk(tanpaTulis), { baris: [{}] }, { "Idempotency-Key": "smoke-tanpa-izin-0001" })).status === 403); else skip("pencatatan hasil SO tanpa inventory:write = 403", "tidak ada akun aktif tanpa inventory:write");
const zona = await http("GET", `${URL_API}?waktu=2026-11-04T10:00:00`, tN); rec("waktu tanpa zona ditolak 400", zona.status === 400 && zona.json?.code === "ZONA_WAJIB", `${zona.status} ${zona.json?.code}`);
const depan = await http("GET", `${URL_API}?waktu=${encodeURIComponent(new Date(Date.now() + 3 * 86400_000).toISOString())}`, tN); rec("waktu masa depan ditolak 400", depan.status === 400 && depan.json?.code === "WAKTU_MASA_DEPAN", `${depan.status}`);

// ── laporan pada satu waktu acuan tetap: 10 menit lalu ──
const at = new Date(Date.now() - 10 * 60_000); const iso = at.toISOString();
const r = await http("GET", `${URL_API}?waktu=${encodeURIComponent(iso)}`, tN); const d = r.json;
rec("pemilik nominal: 200 dan bentuk lengkap (kartu, cakupan, baris, finance, definisi, izin)", r.status === 200 && d?.kartu && d?.cakupan && Array.isArray(d?.baris) && d?.finance && d?.definisi && d?.izin?.nominal === true, `${r.status}`);
if (r.status !== 200) { console.log(`SMOKE_HASIL fail=${fail} skip=${dilewati}`); process.exit(1); }
rec("waktu acuan = yang diminta (satu waktu untuk saldo dan Harga Berlaku)", d.waktuAcuan === iso, d.waktuAcuan);
rec("cakupan: universe = jumlah baris; jumlah per status = universe; relevan = dinilai + pengecualian", d.cakupan.universe === d.baris.length && Object.values(d.cakupan.perStatus).reduce((a, v) => a + v, 0) === d.cakupan.universe && d.cakupan.relevan === d.cakupan.dinilai + d.cakupan.pengecualian, JSON.stringify(d.cakupan.perStatus));
const PENGECUALIAN = ["STOK_BELUM_DIKETAHUI", "HARGA_KOSONG", "SALDO_MINUS", "SATUAN_TIDAK_COCOK", "PENGAMATAN_FISIK"];
rec("pengecualian TIDAK pernah bernilai (nilai null, bukan Rp0)", d.baris.filter((b) => PENGECUALIAN.includes(b.status)).every((b) => b.nilai === null), String(d.baris.filter((b) => PENGECUALIAN.includes(b.status) && b.nilai !== null).length));
const dinilai = d.baris.filter((b) => b.status === "DINILAI");
rec("DINILAI: nilai = saldo × Harga Berlaku, satuan harga = satuan stok, saldo > 0", dinilai.every((b) => b.saldo > 0 && b.harga && String(b.harga.satuan).toUpperCase() === String(b.satuan).toUpperCase() && Math.abs(b.nilai - Math.round(b.saldo * b.harga.nilai * 10000) / 10000) < 0.01), String(dinilai.length));
const totalLedger = Math.round(d.baris.reduce((a, b) => a + (b.nilaiLedger ?? 0), 0));
rec("kartu 1 (berdasarkan ledger) = jumlah nilai ledger seluruh baris; tanpa-hasil-SO-bermasalah ≤ ledger", Math.abs(d.kartu.estimasi.nilaiLedger - totalLedger) <= 1 && d.kartu.estimasi.nilaiTanpaHasilSOBermasalah <= d.kartu.estimasi.nilaiLedger + 1 && d.kartu.estimasi.status === "BELUM_DIREKONSILIASI_DENGAN_HASIL_SO", `${d.kartu.estimasi.nilaiLedger} vs ${totalLedger}`);
rec("kartu 3 = jumlah pengecualian; kartu 1 mencantumkan dinilai/relevan yang sama dengan cakupan", d.kartu.belumDinilai.jumlah === d.cakupan.pengecualian && d.kartu.estimasi.bahanDinilai === d.cakupan.dinilai && d.kartu.estimasi.bahanRelevan === d.cakupan.relevan);
// saldo per bahan = jumlah pergerakan ≤ waktu (sampel 60 bahan acak berurutan stabil)
const sampel = [...d.baris].filter((b) => b.saldo !== null).sort((a, b) => String(a.materialId).localeCompare(String(b.materialId))).slice(0, 60); let salah = 0; let contoh = "";
for (const b of sampel) { const x = Number((await prisma.$queryRawUnsafe("select coalesce(sum(qty),0)::float s from stock_movements where material_id = $1::uuid and created_at <= $2", b.materialId, at))[0].s); if (Math.abs(x - b.saldo) > 0.0002) { salah++; contoh = `${b.kode} ${b.saldo} vs ${x}`; } }
rec(`saldo per bahan = jumlah pergerakan ≤ waktu acuan (sampel ${sampel.length} bahan)`, salah === 0, contoh);
const belum = d.baris.filter((b) => b.status === "STOK_BELUM_DIKETAHUI"); let belumSalah = 0; for (const b of belum.slice(0, 80)) if ((await hitung("select count(*)::int n from stock_movements where material_id = $1::uuid and created_at <= $2", b.materialId, at)) !== 0 || b.saldo !== null) belumSalah++;
rec(`stok belum diketahui = tanpa catatan stok sama sekali, saldo ditampilkan null (sampel ${Math.min(80, belum.length)} dari ${belum.length})`, belumSalah === 0);
// Finance
const f = d.finance; const tgl = f.tanggalBuku;
const akun = (await prisma.$queryRawUnsafe("select id::text id from fin_accounts where system_key = 'PERSEDIAAN_BAHAN' limit 1"))[0];
if (akun) { const sd = Number((await prisma.$queryRawUnsafe("select coalesce(sum(l.debit - l.credit),0)::float s from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id where l.account_id = $1::uuid and e.status::text in ('POSTED','REVERSED') and e.date <= $2::date", akun.id, tgl))[0].s);
  rec("saldo akun Finance = jumlah jurnal akun PERSEDIAAN_BAHAN sampai tanggal buku (dihitung ulang dari tabel)", Math.abs((f.saldo ?? 0) - sd) < 0.01, `${f.saldo} vs ${sd}`); }
else skip("saldo akun Finance = jumlah jurnal akun", "akun PERSEDIAAN_BAHAN belum disiapkan");
const psaPosted = await hitung("select count(*)::int n from fin_inventory_openings where status = 'DIPOSTING'");
rec("status Finance 'belum direkonsiliasi' dan penyebabnya jujur (PSA belum diposting bila memang belum; saldo tidak dialokasikan ke bahan)", f.status === "BELUM_DIREKONSILIASI" && (psaPosted > 0 || f.alasan.some((a) => /Persediaan Awal belum diposting/.test(a))) && f.alasan.some((a) => /tidak dialokasikan ke bahan/i.test(a)));
rec("rincian bukti Finance tidak mengalokasikan saldo akun ke bahan", f.bukti.rincian.every((x) => !("nilaiAlokasi" in x) && !("bagianSaldoAkun" in x)) && f.bukti.bahanBerstok === f.bukti.berbukti + f.bukti.sebagian + f.bukti.tanpaBukti);
const aktif = await hitung("select count(*)::int n from materials where active");
rec("nilai parsial (KPI lama) hanya di rincian Finance: bahan dengan + tanpa biaya = bahan aktif; tidak ada di kartu utama", f.nilaiParsial.bahanDenganBiaya + f.nilaiParsial.bahanTanpaBiaya === aktif && !JSON.stringify(d.kartu).includes("nilaiParsial"), `${f.nilaiParsial.bahanDenganBiaya}+${f.nilaiParsial.bahanTanpaBiaya} vs ${aktif}`);
rec("izin nominal disebut dari peta izin (peran, tanpa peran baru)", Array.isArray(d.izin.peranPelihatNominal) && d.izin.peranPelihatNominal.includes("FINANCE") && /tidak ada peran baru/.test(d.izin.keterangan));
rec("setiap catatan hasil SO di laporan membawa status rekonsiliasi, tanggal sumber, dan pergerakan sesudahnya; nol dikonfirmasi tidak pernah berstatus Nol terverifikasi tanpa Stock Count", d.baris.filter((b) => b.hasilSO).every((b) => b.hasilSO.status && b.hasilSO.soTanggal && typeof b.hasilSO.pergerakanSesudah?.jumlah === "number") && d.baris.filter((b) => b.hasilSO?.jenis === "NOL_DIKONFIRMASI").every((b) => b.hasilSO.status !== "NOL_TERVERIFIKASI") && !JSON.stringify(d.baris.filter((b) => b.hasilSO)).includes("Nol terverifikasi"), String(d.baris.filter((b) => b.hasilSO).length));
// Tanpa izin finance:read: nominal tidak dikirim
if (tanpaNominal) { const rn = await http("GET", `${URL_API}?waktu=${encodeURIComponent(iso)}`, await tokenUntuk(tanpaNominal)); const dn = rn.json;
  rec("tanpa finance:read: 200, TANPA harga/nilai/saldo akun/nilai parsial; status & jumlah tetap ada", rn.status === 200 && dn.izin.nominal === false && dn.kartu.estimasi.nilaiLedger === null && dn.finance.saldo === null && dn.finance.nilaiParsial.nilai === null && dn.baris.every((b) => b.harga === null && (b.nilai === null || b.nilai === 0)) && dn.cakupan.universe === d.cakupan.universe, `${rn.status}`); }
else skip("tanpa finance:read: nominal tidak dikirim", "tidak ada akun aktif dengan inventory:read tanpa finance:read");
// riwayat hasil SO (baca)
const contohBahan = d.baris[0]?.materialId; if (contohBahan) { const rw = await http("GET", `${URL_API}/hasil-so/${contohBahan}`, tN); rec("riwayat hasil SO satu bahan: 200 dan berupa daftar", rw.status === 200 && Array.isArray(rw.json?.riwayat), `${rw.status}`); }
const s1 = await jejak(); rec("SMOKE tidak menulis: stok, biaya beku, harga, jurnal, penyesuaian, GR, persediaan awal, pengaturan Finance, hasil SO — jumlah baris sama", Object.keys(s0).every((k) => s0[k] === s1[k]), JSON.stringify({ s0, s1 }));
console.log(`SMOKE_HASIL fail=${fail} skip=${dilewati}`);
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
