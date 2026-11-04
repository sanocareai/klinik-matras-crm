import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APP = process.env.APP_DIR ?? "/app"; // lokal (uji skrip ini): APP_DIR menunjuk ke folder backend; di kontainer rilis = /app
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await imp("src/constants/permissions.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const SMOKE_SRC = "@@SMOKE_SRC@@"; // diganti generator dengan isi smoke-nilai-persediaan.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji Nilai Persediaan hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "Nilai Persediaan": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4103, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production.
// Bagian A hanya membaca (kode SMOKE yang sama dengan fase 8b). Bagian B MENULIS — HANYA pada salinan restore (DB rehearsal_*, dibuang sesudahnya, dijaga di atas): pencatatan hasil SO (izin, validasi, idempotensi, koreksi append-only) dan bukti bahwa
// tidak ada tulisan ke ledger, harga, jurnal, penyesuaian, GR, persediaan awal, maupun pengaturan Finance.
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = Number(process.env.REH_PORT ?? 4103); const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await prisma.$disconnect(); process.exit(1); }

const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const token = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "25m" });
const semua = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of semua) info.push({ u, rs: await rolesDari(u) });
const stamp = Date.now().toString(36);
const penulis = info.find((x) => bisa(x.rs, P.INVENTORY_WRITE) && bisa(x.rs, P.FINANCE_READ))?.u ?? await prisma.user.create({ data: { name: "REH Penulis", email: `reh-npr-w-${stamp}@example.test`, passwordHash: "x", role: "ADMIN" } });
const pembacaSaja = info.find((x) => bisa(x.rs, P.INVENTORY_READ) && bisa(x.rs, P.FINANCE_READ) && !bisa(x.rs, P.INVENTORY_WRITE))?.u ?? await prisma.user.create({ data: { name: "REH Finance", email: `reh-npr-f-${stamp}@example.test`, passwordHash: "x", role: "FINANCE" } });
const tW = await token(penulis); const tF = await token(pembacaSaja);
const TABEL = [["stock_movements", "select count(*)::int n from stock_movements"], ["biaya_beku", "select count(*)::int n from stock_movement_biaya_operasional"], ["harga_berlaku", "select count(*)::int n from material_harga_berlaku"], ["jurnal", "select count(*)::int n from fin_journal_entries"], ["penyesuaian", "select count(*)::int n from stock_adjustment_requests"], ["goods_receipts", "select count(*)::int n from goods_receipts"], ["persediaan_awal", "select count(*)::int n from fin_inventory_openings"], ["pengaturan_finance", "select count(*)::int n from fin_settings"]];
const jejak = async () => Object.fromEntries(await Promise.all(TABEL.map(async ([k, q]) => [k, await num(q)])));
const sama = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);
const hasilSO = () => num("select count(*)::int n from activity_events where entity_type = 'hasil_so_bahan'");
const j0 = await jejak();

// ── A. SMOKE pasca-switch (kode yang sama dengan fase 8b) terhadap server rehearsal: salah harapan terdeteksi SEBELUM deploy ──
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 600000, env: { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP } });
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
console.log(String(sm.stdout).split("\n").filter((l) => /^\s+(PASS|FAIL|SKIP|INFO)/.test(l)).join("\n"));
cek("SMOKE pasca-switch (kode yang sama dengan fase 8b) lulus terhadap server rehearsal: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-150));
cek("laporan (baca) tidak mengubah stok, biaya beku, harga, jurnal, penyesuaian, GR, persediaan awal, pengaturan Finance", sama(await jejak(), j0));

// ── B. UJI TULIS pada SALINAN RESTORE (DB rehearsal_*): pencatatan hasil SO ──
const post = async (body, tok, kunci = null) => { const r = await fetch(BASE + "/api/inventory/nilai-persediaan/hasil-so", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok, ...(kunci ? { "Idempotency-Key": kunci } : {}) }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* kosong */ } return { status: r.status, json: j }; };
const lap = async () => (await (await fetch(BASE + "/api/inventory/nilai-persediaan", { headers: { Authorization: "Bearer " + tF } })).json());
const baris = async (q, ...a) => prisma.$queryRawUnsafe(q, ...a);
const bahanA = (await baris("select m.id::text id, m.code, m.unit, coalesce(sum(sm.qty),0)::float saldo from materials m join stock_movements sm on sm.material_id = m.id where m.active and m.unit <> 'ROLL' and not exists (select 1 from activity_events e where e.entity_type = 'hasil_so_bahan' and e.entity_id = m.id::text) group by m.id order by count(sm.id) desc, m.code limit 1"))[0];
const bahanB = (await baris("select m.id::text id, m.code, m.unit from materials m where m.active and not exists (select 1 from stock_movements sm where sm.material_id = m.id) and not exists (select 1 from activity_events e where e.entity_type = 'hasil_so_bahan' and e.entity_id = m.id::text) order by m.code limit 1"))[0];
cek("data nyata tersedia: bahan ber-ledger (satuan bukan ROLL) dan bahan tanpa catatan stok", !!bahanA && !!bahanB, JSON.stringify({ a: bahanA?.code, b: bahanB?.code }));
if (bahanA && bahanB) {
  const dasar = { soTanggal: new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10), sumber: "Uji rehearsal (salinan restore)", alasan: "Uji rehearsal pencatatan hasil SO" };
  const peng = { materialId: bahanA.id, jenis: "PENGAMATAN_SATUAN", jumlah: 13.5, satuan: "ROLL", ...dasar }; const kunci = `reh-npr-${stamp}-0001`; const h0 = await hasilSO();
  const t1 = await post({ baris: [peng] }, tW); cek("tanpa Idempotency-Key: 428, tidak ada catatan", t1.status === 428 && (await hasilSO()) === h0, `${t1.status}`);
  const t2 = await post({ baris: [peng] }, tF, kunci); cek("akun tanpa inventory:write (Finance): 403, tidak ada catatan", t2.status === 403 && (await hasilSO()) === h0, `${t2.status}`);
  const t3 = await post({ baris: [{ ...peng, satuan: bahanA.unit }] }, tW, `${kunci}-sama`); cek("satuan pengamatan = satuan stok ditolak 422 (gunakan Koreksi Saldo)", t3.status === 422 && t3.json?.code === "SATUAN_SAMA_DENGAN_STOK" && (await hasilSO()) === h0, `${t3.status} ${t3.json?.code}`);
  const t4 = await post({ baris: [{ ...peng, alasan: "pendek" }] }, tW, `${kunci}-pendek`); cek("alasan terlalu pendek ditolak 400", t4.status === 400 && t4.json?.code === "ALASAN_WAJIB" && (await hasilSO()) === h0, `${t4.status}`);
  const t5 = await post({ baris: [{ ...peng, soWaktu: "2026-11-04T18:00:00" }] }, tW, `${kunci}-jam`); cek("jam SO tanpa zona ditolak 400 (jam tidak ditebak)", t5.status === 400 && t5.json?.code === "JAM_SO_TIDAK_VALID" && (await hasilSO()) === h0, `${t5.status}`);
  const ok = await post({ baris: [peng] }, tW, kunci); cek("pencatatan sah: 201, satu catatan, pelaku = akun login", ok.status === 201 && ok.json?.baru === 1 && (await hasilSO()) === h0 + 1 && ok.json?.hasil?.[0]?.pelaku?.id === penulis.id, `${ok.status} ${JSON.stringify(ok.json).slice(0, 160)}`);
  const ev = (await baris("select event_type, actor_id::text actor, metadata from activity_events where entity_type = 'hasil_so_bahan' and entity_id = $1 order by created_at desc limit 1", bahanA.id))[0];
  cek("jejak: jenis, jumlah, satuan, tanggal SO, sumber, alasan, saldo ledger saat dicatat, dan peristiwa SO_HASIL_DICATAT tercatat", ev?.event_type === "SO_HASIL_DICATAT" && ev?.actor === penulis.id && ev?.metadata?.jenis === "PENGAMATAN_SATUAN" && Number(ev?.metadata?.jumlah) === 13.5 && ev?.metadata?.satuan === "ROLL" && ev?.metadata?.sumber === dasar.sumber && Math.abs(Number(ev?.metadata?.saldoLedgerSaatDicatat) - bahanA.saldo) < 0.0002, JSON.stringify(ev?.metadata).slice(0, 200));
  const ulang = await post({ baris: [peng] }, tW, kunci); cek("retry (kunci sama, isi sama): tidak membuat catatan kedua", ulang.status === 200 && ulang.json?.ulang === 1 && (await hasilSO()) === h0 + 1, `${ulang.status}`);
  const beda = await post({ baris: [{ ...peng, jumlah: 14 }] }, tW, kunci); cek("kunci sama dengan isi berbeda ditolak 409", beda.status === 409 && beda.json?.code === "KUNCI_DIPAKAI_LAIN", `${beda.status}`);
  const dua = await post({ baris: [{ ...peng, jumlah: 14 }] }, tW, `${kunci}-dua`); cek("catatan kedua tanpa menggantikanId ditolak 409 (koreksi wajib menunjuk catatan terkini)", dua.status === 409 && dua.json?.code === "SUDAH_ADA_HASIL_SO", `${dua.status}`);
  const kor = await post({ baris: [{ ...peng, jumlah: 14, alasan: "Dihitung ulang pada salinan restore", menggantikanId: ok.json?.hasil?.[0]?.id }] }, tW, `${kunci}-kor`); cek("koreksi menunjuk catatan terkini: 201, catatan lama TETAP (append-only)", kor.status === 201 && (await hasilSO()) === h0 + 2, `${kor.status} ${JSON.stringify(kor.json).slice(0, 120)}`);
  const rw = await (await fetch(`${BASE}/api/inventory/nilai-persediaan/hasil-so/${bahanA.id}`, { headers: { Authorization: "Bearer " + tF } })).json(); cek("riwayat: dua entri berurutan, yang terakhir koreksi dan terkini", rw.riwayat?.length === 2 && rw.riwayat[0].jumlah === 13.5 && rw.riwayat[1].jumlah === 14 && rw.riwayat[1].koreksi === true && rw.riwayat[1].terkini === true);
  const nol = await post({ baris: [{ materialId: bahanB.id, jenis: "NOL_DIKONFIRMASI", jumlah: 0, satuan: "BEBAS", ...dasar }] }, tW, `${kunci}-nol`); cek("nol dikonfirmasi pada bahan tanpa catatan stok: 201, satuan dipaksa = satuan stok", nol.status === 201 && nol.json?.hasil?.[0]?.satuan === bahanB.unit, `${nol.status}`);
  const d = await lap(); const A = d.baris.find((b) => b.materialId === bahanA.id), B = d.baris.find((b) => b.materialId === bahanB.id);
  cek("laporan: bahan terukur ROLL = PENGAMATAN_FISIK (nilai null, tidak dikonversi) memakai catatan terkini (14 ROLL)", A?.status === "PENGAMATAN_FISIK" && A?.nilai === null && A?.pengamatan === "14 ROLL" && A?.hasilSOBermasalah === true && A?.hasilSO?.revisi === 2, `${A?.status} ${A?.pengamatan}`);
  cek("laporan: bahan tanpa ledger berlabel 'fisik nol dikonfirmasi … belum tercatat sebagai hasil SO di ledger', tetap stok belum diketahui, nilai null", B?.status === "STOK_BELUM_DIKETAHUI" && B?.nilai === null && /Fisik nol dikonfirmasi/.test(B?.keterangan ?? "") && /belum tercatat sebagai hasil SO di ledger/.test(B?.keterangan ?? ""), B?.keterangan);
  cek("laporan: catatan SO membawa tanggal sumber, status rekonsiliasi, pergerakan sesudahnya; nol belum disahkan Stock Count dan TIDAK berlabel Nol terverifikasi; pengecualian satuan terbuka", A?.hasilSO?.status === "TERBUKA_SATUAN" && A?.hasilSO?.urutan === 2 && typeof A?.hasilSO?.pergerakanSesudah?.jumlah === "number" && A?.hasilSO?.soTanggal === dasar.soTanggal && B?.hasilSO?.status === "BELUM_DISAHKAN_STOCK_COUNT" && /belum disahkan melalui Stock Count/.test(B?.keterangan ?? "") && B?.keadaanSaldo !== "NOL_TERVERIFIKASI" && !/Nol terverifikasi/i.test(JSON.stringify(B)), JSON.stringify(B?.hasilSO).slice(0, 160));
  const idK = kor.json?.hasil?.[0]?.id; const par = await Promise.all([1, 2, 3].map((i) => post({ baris: [{ ...peng, jumlah: 20 + i, alasan: `Koreksi serentak ${i} (rehearsal)`, menggantikanId: idK }] }, tW, `${kunci}-par${i}`)));
  cek("koreksi serentak menunjuk catatan terkini yang sama: tepat satu 201, lainnya 409; urutan 1..3 tanpa ganda", par.filter((x) => x.status === 201).length === 1 && par.filter((x) => x.status === 409).length === 2, JSON.stringify(par.map((x) => x.status)));
  const rw2 = await (await fetch(`${BASE}/api/inventory/nilai-persediaan/hasil-so/${bahanA.id}`, { headers: { Authorization: "Bearer " + tF } })).json(); cek("riwayat setelah koreksi serentak: urutan 1,2,3; tepat satu terkini; linimasa menaik", JSON.stringify(rw2.riwayat?.map((x) => x.urutan)) === "[1,2,3]" && rw2.riwayat.filter((x) => x.terkini).length === 1 && rw2.riwayat.every((x, i, a) => i === 0 || new Date(x.dicatatPada) >= new Date(a[i - 1].dicatatPada)));
  cek("laporan: estimasi berdasarkan ledger dan tanpa hasil SO bermasalah terpisah; status belum direkonsiliasi", d.kartu.estimasi.status === "BELUM_DIREKONSILIASI_DENGAN_HASIL_SO" && d.kartu.estimasi.nilaiTanpaHasilSOBermasalah <= d.kartu.estimasi.nilaiLedger && d.kartu.estimasi.bahanHasilSOBermasalah >= 1);
  cek("TIDAK ada tulisan ke ledger, biaya beku, harga, jurnal, ADJUSTMENT/penyesuaian, GR, persediaan awal, maupun fin_settings (hanya jejak hasil SO +4)", sama(await jejak(), j0) && (await hasilSO()) === h0 + 4, JSON.stringify(await jejak()));
}
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
