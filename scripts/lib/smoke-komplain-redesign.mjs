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
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 220) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE BACA-SAJA terhadap production hidup: daftar & ringkasan Kasus Komplain (redesign). Tidak ada tulisan dan tidak ada kasus/aktivitas percobaan. Setiap angka API dibandingkan dengan hitungan
// LANGSUNG dari tabel complaint_cases (bukan dari kode rute). Production hidup: tabel yang bisa ditulis pengguna lain selama smoke hanya diperiksa TIDAK BERKURANG (rehearsal pada salinan memeriksa kesamaan persis).
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const B = (k) => Number(process.env[k]);
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const pembaca = info.find((x) => bisa(x.rs, P.COMPLAINT_READ))?.u;
const tanpaIzin = info.find((x) => !bisa(x.rs, P.COMPLAINT_READ))?.u;
if (!pembaca) { rec("akun dengan izin complaint:read tersedia", false); process.exit(1); }
const tok = await tokenUntuk(pembaca); const tokX = tanpaIzin ? await tokenUntuk(tanpaIzin) : null;
const get = async (url, token = tok) => { const r = await fetch(BASE + url, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };

const JEJAK = [["complaint_cases", "select count(*)::int n from complaint_cases"], ["activity_events", "select count(*)::int n from activity_events"], ["jobs", "select count(*)::int n from jobs"], ["units", "select count(*)::int n from units"],
  ["order", 'select count(*)::int n from "Order"'], ["jurnal", "select count(*)::int n from fin_journal_entries"], ["baris_jurnal", "select count(*)::int n from fin_journal_lines"], ["stok", "select count(*)::int n from stock_movements"]];
const jejak = async () => Object.fromEntries(await Promise.all(JEJAK.map(async ([k, q]) => [k, await hitung(q)])));
const s0 = await jejak();

const TUTUP = "('SELESAI','DIBATALKAN')";
const total = await hitung("select count(*)::int n from complaint_cases");
const nAktif = await hitung(`select count(*)::int n from complaint_cases where status::text not in ${TUTUP}`);
const nRiwayat = await hitung(`select count(*)::int n from complaint_cases where status::text in ${TUTUP}`);
console.log(`  (data: ${total} kasus; aktif ${nAktif}; riwayat ${nRiwayat})`);

// ── daftar: total jujur, tanpa pemotongan diam-diam
const semua = await get("/api/complaints?limit=1");
rec("GET /complaints: 200 dan total = hitungan langsung tabel (semua kasus)", semua.status === 200 && semua.json?.total === total, `${semua.json?.total} vs ${total}`);
const aktif = await get("/api/complaints?scope=aktif&limit=1"); const riwayat = await get("/api/complaints?scope=riwayat&limit=1");
rec("scope=aktif total sama dengan tabel (status bukan SELESAI/DIBATALKAN)", aktif.status === 200 && aktif.json?.total === nAktif, `${aktif.json?.total} vs ${nAktif}`);
rec("scope=riwayat total sama dengan tabel (SELESAI/DIBATALKAN); aktif + riwayat = semua kasus", riwayat.status === 200 && riwayat.json?.total === nRiwayat && nAktif + nRiwayat === total, `${riwayat.json?.total} vs ${nRiwayat}`);
const bawaan = await get("/api/complaints");
rec("tanpa parameter (pemanggil lama): bentuk { cases } tetap ada, paling banyak 300, DENGAN total dan hasMore (tidak lagi dipotong diam-diam)", bawaan.status === 200 && Array.isArray(bawaan.json?.cases) && bawaan.json.cases.length === Math.min(300, total) && bawaan.json.total === total && bawaan.json.hasMore === (total > 300), `${bawaan.json?.cases?.length}/${bawaan.json?.total}/${bawaan.json?.hasMore}`);

// ── halaman: tidak ada kasus ganda/hilang, urutan stabil, hasMore benar
const ukuran = 40; const ids = []; let offset = 0; let halaman = 0; let hasMoreAkhir = null; let urutanOk = true; let prevRank = 99; const RANK = { RENDAH: 0, SEDANG: 1, TINGGI: 2, KRITIS: 3 };
while (halaman < 60) {
  const r = await get(`/api/complaints?scope=aktif&limit=${ukuran}&offset=${offset}`); if (r.status !== 200) { rec("halaman daftar aktif 200", false, r.status); break; }
  for (const c of r.json.cases) { ids.push(c.id); const rk = RANK[c.severity] ?? -1; if (rk > prevRank) urutanOk = false; prevRank = rk; }
  hasMoreAkhir = r.json.hasMore; halaman += 1; offset += r.json.cases.length; if (!r.json.hasMore || r.json.cases.length === 0) break;
}
rec(`menelusuri semua halaman aktif (${halaman} halaman @${ukuran}): jumlah = total aktif, tanpa kasus ganda, hasMore=false di akhir`, ids.length === nAktif && new Set(ids).size === ids.length && hasMoreAkhir === false, `${ids.length}/${nAktif}, unik ${new Set(ids).size}, hasMore ${hasMoreAkhir}`);
rec("urutan aktif: tingkat keparahan menurun (Kritis dulu), lintas halaman", urutanOk);
const halamanLewat = await get(`/api/complaints?scope=aktif&limit=${ukuran}&offset=${nAktif + 5}`);
rec("offset melewati akhir: 200, kosong, hasMore=false (bukan galat)", halamanLewat.status === 200 && halamanLewat.json?.cases?.length === 0 && halamanLewat.json?.hasMore === false);

// ── ringkasan
const sqlStatus = await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from complaint_cases group by 1");
const peta = Object.fromEntries(sqlStatus.map((x) => [x.s, x.n]));
const sqlPrioritas = () => hitung(`select count(*)::int n from complaint_cases where status::text not in ${TUTUP} and severity::text in ('TINGGI','KRITIS')`);
const sqlLewat = () => hitung(`select count(*)::int n from complaint_cases where status::text not in ${TUTUP} and target_completion_at < (now() at time zone 'UTC')`);
const lw0 = await sqlLewat(); const rg = await get("/api/complaints/ringkasan"); const lw1 = await sqlLewat();
rec("GET /complaints/ringkasan: 200", rg.status === 200, rg.status);
if (rg.json) {
  const salah = Object.keys(peta).filter((st) => rg.json.perStatus?.[st] !== peta[st]);
  rec("ringkasan perStatus sama dengan hitungan langsung tabel untuk setiap status yang ada", salah.length === 0 && Object.values(rg.json.perStatus).reduce((a, b) => a + b, 0) === total, salah.join(",") || "identik");
  rec("ringkasan aktif/riwayat/prioritas sama dengan tabel", rg.json.aktif === nAktif && rg.json.riwayat === nRiwayat && rg.json.prioritas === (await sqlPrioritas()), JSON.stringify([rg.json.aktif, rg.json.riwayat, rg.json.prioritas]));
  rec("ringkasan lewatTarget sama dengan tabel (diukur sebelum dan sesudah panggilan)", rg.json.lewatTarget >= Math.min(lw0, lw1) && rg.json.lewatTarget <= Math.max(lw0, lw1), `${rg.json.lewatTarget} (${lw0}..${lw1})`);
}

// ── filter: status rinci, pencarian, pemegang
const stPertama = Object.keys(peta)[0];
if (stPertama) { const r = await get(`/api/complaints?statuses=${stPertama}&limit=1`); rec(`filter statuses=${stPertama}: total sama dengan tabel`, r.status === 200 && r.json?.total === peta[stPertama], `${r.json?.total} vs ${peta[stPertama]}`); } else skip("filter status rinci", "tidak ada kasus");
const contoh = (await prisma.$queryRawUnsafe("select case_number, current_owner::text own from complaint_cases order by case_number limit 1"))[0];
if (contoh) {
  const r = await get(`/api/complaints?q=${encodeURIComponent(contoh.case_number)}&limit=5`);
  rec("pencarian nomor kasus menemukan kasusnya", r.status === 200 && r.json?.cases?.some((c) => c.caseNumber === contoh.case_number), r.json ? `${r.json.total} hasil` : r.status);
  const nOwn = await hitung("select count(*)::int n from complaint_cases where current_owner::text = $1", contoh.own); const ro = await get(`/api/complaints?currentOwner=${contoh.own}&limit=1`);
  rec(`filter pemegang ${contoh.own}: total sama dengan tabel`, ro.status === 200 && ro.json?.total === nOwn, `${ro.json?.total} vs ${nOwn}`);
} else skip("pencarian/pemegang", "tidak ada kasus komplain");

// ── validasi & izin: ditolak SEBELUM menyentuh data (400, bukan 500)
for (const [nama, url] of [["scope tidak dikenal", "/api/complaints?scope=semua"], ["limit 0", "/api/complaints?limit=0"], ["limit 301", "/api/complaints?limit=301"], ["offset negatif", "/api/complaints?offset=-1"], ["status tidak dikenal", "/api/complaints?status=BUKAN_STATUS"], ["statuses berisi yang tidak dikenal", "/api/complaints?statuses=BARU,BUKAN_STATUS"], ["ringkasan pemegang tidak valid", "/api/complaints/ringkasan?currentOwner=BUKAN_DIVISI"]]) {
  const r = await get(url); rec(`${nama} = 400 (bukan 500)`, r.status === 400, r.status);
}
rec("tanpa token = 401", (await get("/api/complaints?limit=1", null)).status === 401);
if (tokX) rec("akun tanpa izin complaint:read = 403", (await get("/api/complaints?limit=1", tokX)).status === 403 && (await get("/api/complaints/ringkasan", tokX)).status === 403); else skip("akun tanpa izin complaint:read = 403", "tidak ada akun aktif tanpa izin tersebut");

// ── detail kasus tetap sama bentuknya (drawer memakai endpoint lama)
if (contoh) { const id = (await prisma.$queryRawUnsafe("select id::text i from complaint_cases where case_number = $1", contoh.case_number))[0].i; const d = await get(`/api/complaints/${id}`); rec("detail kasus GET /complaints/:id tetap 200 dengan status dan nomor kasus", d.status === 200 && (d.json?.caseNumber === contoh.case_number || d.json?.case?.caseNumber === contoh.case_number), d.status); }

// ── tanpa jejak tulis: produksi hidup → tabel tidak boleh BERKURANG (rehearsal memeriksa kesamaan persis)
const s1 = await jejak(); const turun = Object.keys(s0).filter((k) => s1[k] < s0[k]);
rec("TIDAK ada jejak tulis destruktif: kasus, aktivitas, job, unit, order, jurnal, baris jurnal, stok tidak berkurang selama smoke", turun.length === 0, turun.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(",") || "tidak ada yang berkurang");
const naik = Object.keys(s0).filter((k) => s1[k] > s0[k]); if (naik.length) console.log("  (info: bertambah selama smoke karena pengguna lain/aplikasi hidup — smoke ini hanya GET: " + naik.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(",") + ")");
rec("jurnal tidak seimbang (sebelum rilis: " + B("BASE_TIDAK_SEIMBANG") + ", tidak bertambah)", (await hitung("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")) <= B("BASE_TIDAK_SEIMBANG"));
rec("jumlah Order & Job tidak berkurang (sebelum: " + B("ORDER_N") + " / " + B("JOB_N") + ")", (await hitung('select count(*)::int n from "Order"')) >= B("ORDER_N") && (await hitung("select count(*)::int n from jobs")) >= B("JOB_N"));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
