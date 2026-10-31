import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000"; // rehearsal/lokal menjalankan kode smoke YANG SAMA terhadap server uji (SMOKE_BASE)
const APP = process.env.APP_DIR ?? "/app";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE BACA-SAJA terhadap production hidup. TIDAK ada unggahan, TIDAK ada foto contoh, TIDAK ada perubahan bahan. Yang dilakukan: membaca Stok & Lokasi, memeriksa skema/kolom, dan menguji PENOLAKAN
// (tanpa token, tanpa izin, tanda tangan salah) yang terjadi SEBELUM menyentuh data. Jejak tulis (bahan, foto, stok, harga, jurnal, aktivitas bahan) harus identik sebelum vs sesudah smoke.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const get = async (p, tok) => { const r = await fetch(BASE + p, { headers: tok ? { Authorization: "Bearer " + tok } : {} }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const pembaca = info.find((x) => bisa(x.rs, P.INVENTORY_READ))?.u; const tanpaIzin = info.find((x) => !bisa(x.rs, P.INVENTORY_READ) && !bisa(x.rs, P.UNIT_MATERIAL_WRITE) && !bisa(x.rs, P.INVENTORY_WRITE))?.u;
if (!pembaca) { rec("akun dengan inventory:read tersedia", false); process.exit(1); }
const tR = await tokenUntuk(pembaca); const tN = tanpaIzin ? await tokenUntuk(tanpaIzin) : null;
const jejak = async () => ({
  material: await hitung("select count(*)::int n from materials"), berfoto: await hitung("select count(*)::int n from materials where photo_file is not null"),
  stok: await hitung("select count(*)::int n from stock_movements"), harga: await hitung("select count(*)::int n from material_harga_berlaku"), valuasi: await hitung("select count(*)::int n from fin_stock_movement_valuations"), jurnal: await hitung("select count(*)::int n from fin_journal_entries"),
  aktivitasBahan: await hitung("select count(*)::int n from activity_events where entity_type = 'material'"),
});
const s0 = await jejak();

// ── skema
const kol = await prisma.$queryRawUnsafe("select column_name c, data_type t, character_maximum_length l, is_nullable nl, column_default d from information_schema.columns where table_schema='public' and table_name='materials' and column_name in ('photo_file','photo_updated_at') order by column_name");
rec("kolom foto terpasang tepat seperti migrasi: photo_file varchar(80) NULL tanpa default; photo_updated_at timestamp NULL tanpa default", kol.length === 2 && kol[0].c === "photo_file" && kol[0].t === "character varying" && Number(kol[0].l) === 80 && kol[0].nl === "YES" && kol[0].d === null && kol[1].c === "photo_updated_at" && kol[1].t === "timestamp without time zone" && kol[1].nl === "YES" && kol[1].d === null, JSON.stringify(kol));
rec("isi kolom photo_file hanya NULL atau nama berkas sah (<id bahan>-<hex>.webp) milik bahan itu sendiri", (await hitung("select count(*)::int n from materials where photo_file is not null and (photo_file !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{12}[.]webp$' or photo_file not like id::text || '-%')")) === 0);
let dapatTulis = false; try { fs.accessSync(path.join(process.env.FOTO_BAHAN_DIR ?? "/app/data"), fs.constants.W_OK); dapatTulis = true; } catch { /* tidak bisa */ }
rec("folder data aplikasi dapat ditulis proses backend (syarat unggah foto); folder foto dibuat otomatis saat unggahan pertama", dapatTulis);

// ── Stok & Lokasi (baca-saja)
const sl = await get("/api/inventory/beranda/stok", tR);
rec("Stok & Lokasi terbaca (200) dan jumlah baris = jumlah bahan di database", sl.status === 200 && Array.isArray(sl.json?.rows) && sl.json.rows.length === s0.material, `${sl.status} ${sl.json?.rows?.length}/${s0.material}`);
const rows = sl.json?.rows ?? [];
const ttd = /^\/api\/inventory\/foto-bahan\/[0-9a-f-]{36}-[0-9a-f]{12}(-t)?\.webp\?exp=\d+&sig=[0-9a-f]{64}$/;
rec("setiap baris: fotoUrl/fotoThumbUrl null (belum ada foto) ATAU URL bertanda-tangan sah — tidak ada nama berkas mentah/path/URL statis", rows.length > 0 && rows.every((r) => (r.fotoUrl === null && r.fotoThumbUrl === null) || (ttd.test(r.fotoUrl ?? "") && ttd.test(r.fotoThumbUrl ?? ""))) && rows.every((r) => !("photoFile" in r)), `${rows.filter((r) => r.fotoUrl).length} berfoto`);
const bf = rows.find((r) => r.fotoUrl);
if (bf) { const a = await fetch(BASE + bf.fotoThumbUrl); rec("satu thumbnail nyata tersaji lewat URL bertanda-tangan (200 image/webp)", a.status === 200 && a.headers.get("content-type") === "image/webp"); } else skip("thumbnail nyata tersaji", "belum ada bahan berfoto di production (diharapkan tepat setelah rilis pertama)");
const dm = await get("/api/inventory/materials", tR);
rec("katalog bahan terbaca (200); kolom mentah photoFile tidak bocor", dm.status === 200 && Array.isArray(dm.json) && dm.json.length === s0.material && dm.json.every((m) => !("photoFile" in m)), `${dm.status}`);

// ── akses: penolakan sebelum menyentuh data
const sampel = rows[0]?.materialId ?? null; const namaPalsu = "00000000-0000-4000-8000-000000000000-aaaaaaaaaaaa.webp";
rec("media tanpa kredensial = 401; tanda tangan salah = 403; nama tak sah / traversal = 404/401/403", (await fetch(`${BASE}/api/inventory/foto-bahan/${namaPalsu}`)).status === 401 && (await fetch(`${BASE}/api/inventory/foto-bahan/${namaPalsu}?exp=${Math.floor(Date.now() / 1000) + 600}&sig=${"0".repeat(64)}`)).status === 403 && [404, 401, 403].includes((await fetch(`${BASE}/api/inventory/foto-bahan/..%2f..%2fpackage.json?exp=1&sig=${"0".repeat(64)}`)).status));
rec("media dengan Bearer berizin tetapi berkas tidak ada = 404 (bukan 500, tidak membocorkan jalur)", (await fetch(`${BASE}/api/inventory/foto-bahan/${namaPalsu}`, { headers: { Authorization: "Bearer " + tR } })).status === 404);
if (tN) rec("akun tanpa izin baca bahan: media Bearer = 403", (await fetch(`${BASE}/api/inventory/foto-bahan/${namaPalsu}`, { headers: { Authorization: "Bearer " + tN } })).status === 403); else skip("akun tanpa izin baca bahan ditolak", "tidak ada akun aktif tanpa izin bahan");
if (sampel) {
  const tanpaToken = await Promise.all([fetch(`${BASE}/api/inventory/materials/${sampel}/photo`, { method: "PUT" }), fetch(`${BASE}/api/inventory/materials/${sampel}/photo`, { method: "DELETE" }), fetch(`${BASE}/api/inventory/materials/${sampel}/photo/rotate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })]);
  rec("unggah/hapus/putar TANPA token = 401 (ditolak sebelum menyentuh data; tidak ada unggahan dilakukan)", tanpaToken.every((r) => r.status === 401), tanpaToken.map((r) => r.status).join());
  if (tN) { const tanpaIzinTulis = await Promise.all([fetch(`${BASE}/api/inventory/materials/${sampel}/photo`, { method: "DELETE", headers: { Authorization: "Bearer " + tN } }), fetch(`${BASE}/api/inventory/materials/${sampel}/photo/rotate`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tN }, body: JSON.stringify({ derajat: 90 }) })]); rec("hapus/putar oleh akun tanpa izin = 403 (tanpa efek)", tanpaIzinTulis.every((r) => r.status === 403), tanpaIzinTulis.map((r) => r.status).join()); }
} else skip("penolakan tulis", "tidak ada bahan di production");

// ── tidak ada jejak tulis
const s1 = await jejak(); const beda = Object.keys(s0).filter((k) => s0[k] !== s1[k]);
rec("TIDAK ada jejak tulis akibat smoke: jumlah bahan, bahan berfoto, pergerakan stok, harga berlaku, valuasi, jurnal, aktivitas bahan sama persis sebelum vs sesudah", beda.length === 0, beda.length ? beda.map((k) => `${k}: ${s0[k]}→${s1[k]}`).join("; ") : "identik");
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
