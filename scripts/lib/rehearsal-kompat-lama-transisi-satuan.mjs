import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APP = process.env.APP_DIR ?? "/app";
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 300) : ""}`); };
const info = (nama, d = "") => console.log(`INFO  ${nama}${d ? " — " + String(d).slice(0, 300) : ""}`);
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
// KOMPATIBILITAS ROLLBACK KODE: image LAMA (yang sedang melayani produksi) dijalankan sebagai SERVER terhadap salinan restore yang SUDAH bermigrasi. Prisma client lama TIDAK mengenal kolom/tabel baru.
// MODE = "tanpa-transisi" (keadaan tepat sesudah migrasi: rollback rutin) atau "dengan-transisi" (sesudah transisi tersimpan: temuan untuk guard). Menulis HANYA pada DB rehearsal_* (dijaga di bawah), tidak pernah ke production.
const MODE = process.env.LAMA_MODE ?? "tanpa-transisi";
const nm = (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji kode lama hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await imp("src/constants/permissions.js");
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = Number(process.env.REH_PORT ?? 4104); const BASE = `http://127.0.0.1:${PORT}`;
const nT = await num("select count(*)::int n from material_unit_transitions");
cek(`[${MODE}] image LAMA berjalan terhadap DB bermigrasi (tabel rilis ada; transisi tersimpan ${nT})`, MODE === "dengan-transisi" ? nT > 0 : nT === 0, `transisi=${nT}`);
const child = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek(`[${MODE}] server kode LAMA hidup terhadap skema baru (/api/health)`, sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await prisma.$disconnect(); process.exit(1); }
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const stamp = Date.now().toString(36);
const semua = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const infoU = []; for (const u of semua) infoU.push({ u, rs: await rolesDari(u) });
const aktor = infoU.find((x) => bisa(x.rs, P.INVENTORY_READ) && bisa(x.rs, P.INVENTORY_WRITE) && bisa(x.rs, P.FINANCE_READ))?.u ?? await prisma.user.create({ data: { name: "REH Lama", email: `reh-lama-${stamp}@example.test`, passwordHash: "x", role: "OWNER" } });
const tok = jwt.sign({ id: aktor.id, name: aktor.name, role: aktor.role, roles: [...(await rolesDari(aktor))] }, process.env.JWT_SECRET, { expiresIn: "25m" });
const http = async (url) => { const r = await fetch(BASE + url, { headers: { Authorization: "Bearer " + tok } }); let json = null; try { json = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json }; };

// 1. jalur baca yang ada tetap berfungsi
const ls = await http("/api/inventory/materials"); cek(`[${MODE}] kode lama: daftar bahan terbaca (200)`, ls.status === 200 && Array.isArray(ls.json?.data ?? ls.json), `${ls.status}`);
const lap = await http("/api/inventory/nilai-persediaan"); cek(`[${MODE}] kode lama: Laporan Nilai Persediaan terbaca (200)`, lap.status === 200, `${lap.status}`);

// 2. jalur tulis stok yang ada (penulis resmi kode LAMA) tetap berfungsi dan DIBERI PENANDA SATUAN oleh trigger DB
const { postStockMovement } = await imp("src/services/inventoryLedger.js");
const bertransisi = (await prisma.$queryRawUnsafe("select distinct material_id::text id from material_unit_transitions")).map((r) => r.id);
const biasa = (await prisma.$queryRawUnsafe("select m.id::text id, m.code, m.unit::text unit from materials m where m.active and m.id::text <> all($1::text[]) and exists (select 1 from stock_movements s where s.material_id = m.id) order by m.code limit 1", bertransisi))[0];
if (biasa) {
  const s0 = await num("select coalesce(sum(qty),0)::float n from stock_movements where material_id = $1::uuid", biasa.id);
  const a = await prisma.$transaction(async (tx) => postStockMovement(tx, { materialId: biasa.id, type: "RECEIPT", qty: 1, note: "uji rollback kode lama", createdById: aktor.id }));
  const b = await prisma.$transaction(async (tx) => postStockMovement(tx, { materialId: biasa.id, type: "ISSUE", qty: -1, note: "uji rollback kode lama (balik)", createdById: aktor.id }));
  const ra = (await prisma.$queryRawUnsafe("select unit_at_entry::text u, unit_transition_id from stock_movements where id = $1::uuid", a.id))[0]; const rb = (await prisma.$queryRawUnsafe("select unit_at_entry::text u from stock_movements where id = $1::uuid", b.id))[0];
  const s1 = await num("select coalesce(sum(qty),0)::float n from stock_movements where material_id = $1::uuid", biasa.id);
  cek(`[${MODE}] kode lama: penerimaan + pengeluaran lewat penulis resmi berfungsi (bahan ${biasa.code}); saldo kembali`, Math.abs(s1 - s0) < 1e-9, `${s0} → ${s1}`);
  cek(`[${MODE}] pergerakan yang ditulis kode LAMA tetap diberi penanda satuan master oleh trigger DB (${biasa.unit})`, ra?.u === biasa.unit && rb?.u === biasa.unit && ra.unit_transition_id === null, `${ra?.u}/${rb?.u}`);
} else info(`[${MODE}] uji tulis bahan biasa dilewati`, "tidak ada bahan aktif berpergerakan di luar bahan bertransisi");

// 3. pagar DB: kode lama tidak bisa mengganti satuan bahan berpergerakan (kode lama tidak pernah melakukannya; bila mencoba, ditolak tanpa sisa)
const ledger = (await prisma.$queryRawUnsafe("select m.id::text id, m.code, m.unit::text unit from materials m where exists (select 1 from stock_movements s where s.material_id = m.id) order by m.code limit 1"))[0];
let ditolak = false; try { await prisma.material.update({ where: { id: ledger.id }, data: { unit: ledger.unit === "KG" ? "PCS" : "KG" } }); } catch (e) { ditolak = /tidak boleh diubah langsung/.test(String(e.message)); }
cek(`[${MODE}] kode lama: ubah satuan bahan berpergerakan (${ledger.code}) DITOLAK pagar DB; satuan tidak berubah`, ditolak && (await prisma.$queryRawUnsafe("select unit::text u from materials where id = $1::uuid", ledger.id))[0].u === ledger.unit);

if (MODE === "dengan-transisi") {
  // 4. TEMUAN untuk guard: apa yang kode lama baca untuk bahan yang SUDAH bertransisi
  const stokApi = await http("/api/inventory/stock"); cek("kode lama: daftar saldo /stock terbaca (200)", stokApi.status === 200 && Array.isArray(stokApi.json), `${stokApi.status}`);
  const ids = bertransisi; let salahBaca = 0; let salahSaldo = 0; let dinilai = 0; const ringkas = [];
  for (const id of ids) {
    const m = (await prisma.$queryRawUnsafe("select code, unit::text unit from materials where id = $1::uuid", id))[0];
    const mv = await http(`/api/inventory/movements?materialId=${id}&limit=500`); const rows = mv.json?.data ?? mv.json ?? [];
    const lamaP = (await prisma.$queryRawUnsafe("select count(*)::int n from stock_movements where material_id = $1::uuid and (unit_at_entry is distinct from $2::\"MaterialUnit\" and (unit_at_entry is not null or created_at < (select min(created_at) from material_unit_transitions t where t.material_id = $1::uuid)))", id, m.unit))[0].n;
    const sdb = await num("select coalesce(sum(qty),0)::float n from stock_movements where material_id = $1::uuid", id);
    const sApi = Number((Array.isArray(stokApi.json) ? stokApi.json : []).find((x) => x.materialId === id)?.balance ?? NaN);
    const b = (lap.json?.baris ?? []).find((x) => x.kode === m.code);
    if (Array.isArray(rows) && rows.length && lamaP > 0) salahBaca += 1;
    if (!Number.isFinite(sApi) || Math.abs(sApi - sdb) > 1e-6) salahSaldo += 1;
    if (b && b.status === "DINILAI") dinilai += 1;
    ringkas.push(`${m.code}: ${rows.length} baris dibaca kode lama; ${lamaP} di antaranya bersatuan LAMA tetapi berlabel ${m.unit}; status laporan ${b?.status ?? "-"}`);
  }
  for (const r of ringkas) info(`temuan kode lama ${r}`);
  cek("kode lama: saldo bahan bertransisi (jumlah qty) TETAP sama dengan saldo satuan baru (transisi menutup lalu membuka saldo)", salahSaldo === 0, `${salahSaldo} bahan berbeda`);
  cek("kode lama: Laporan Nilai Persediaan TIDAK menilai bahan bertransisi dengan harga satuan lama (tidak ada status DINILAI)", dinilai === 0, `${dinilai} bahan berstatus DINILAI`);
  info("TEMUAN GUARD", `${salahBaca} dari ${ids.length} bahan bertransisi akan dibaca kode LAMA dengan riwayat berlabel satuan master baru padahal pergerakan sebelum transisi bersatuan lama → rollback rutin DITOLAK guard`);
  cek("kode lama menampilkan riwayat bahan bertransisi tanpa membedakan periode satuan (dasar penolakan guard terbukti, bukan dugaan)", salahBaca > 0 || ids.length === 0, `${salahBaca}`);
}
console.log(`RINGKAS_LAMA mode=${MODE} cek=${n} gagal=${gagal}`);
berhenti(); await prisma.$disconnect(); process.exit(gagal ? 1 : 0);
