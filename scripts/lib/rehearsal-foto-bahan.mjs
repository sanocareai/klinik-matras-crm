import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const sharp = require("sharp");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APP = process.env.APP_DIR ?? "/app"; // lokal (uji skrip ini): APP_DIR menunjuk ke folder backend; di kontainer rilis = /app
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await imp("src/constants/permissions.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const selesai = async (kode) => { await prisma.$disconnect(); console.log(`\nRINGKASAN rehearsal Foto Bahan: ${n} pemeriksaan, ${gagal} gagal`); process.exit(kode); };

// REHEARSAL "Foto Bahan": kode BARU berjalan sebagai SERVER sungguhan (index.js, port 4101, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production SETELAH migrasi.
// Semua tulisan hanya di DB sementara ini dan di folder data SEMENTARA (direktori data production TIDAK dipasang). Bahan uji dibuat di salinan (REH-FOTO-*), bukan bahan nyata; bahan nyata hanya DIBACA.
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji Foto Bahan hanya pada DB rehearsal", false, nm); await selesai(1); }
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const { FOTO_BAHAN_DIR, NAMA_VALID, namaThumb } = await imp("src/services/fotoBahan.js");
const dirTemp = process.env.FOTO_BAHAN_DIR ? true : FOTO_BAHAN_DIR.startsWith("/app/data/") && !fs.existsSync("/app/data/finance-receipts");
cek("folder foto memakai direktori data SEMENTARA (bukan direktori data production)", dirTemp, FOTO_BAHAN_DIR);
const PORT = Number(process.env.REH_PORT ?? 4101); const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await selesai(1); }

const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const token = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "25m" });
const semua = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of semua) info.push({ u, rs: await rolesDari(u) });
const stamp = Date.now().toString(36);
const buat = async (nama, role) => prisma.user.create({ data: { name: `REH ${nama}`, email: `reh-foto-${nama.toLowerCase()}-${stamp}@example.test`, passwordHash: "x", role } });
const uTulis = info.find((x) => bisa(x.rs, P.INVENTORY_WRITE) && bisa(x.rs, P.INVENTORY_READ))?.u ?? await buat("Tulis", "WAREHOUSE");
const uBaca = info.find((x) => bisa(x.rs, P.INVENTORY_READ) && !bisa(x.rs, P.INVENTORY_WRITE))?.u ?? null;
const uTanpa = info.find((x) => !bisa(x.rs, P.INVENTORY_READ) && !bisa(x.rs, P.UNIT_MATERIAL_WRITE))?.u ?? await buat("Sales", "SALES");
const tW = await token(uTulis); const tN = await token(uTanpa); const tR = uBaca ? await token(uBaca) : null;
cek("akun uji: penulis bahan (inventory:write), akun tanpa izin baca bahan" + (uBaca ? ", pembaca-saja" : " (pembaca-saja tidak ada di salinan: dilewati)"), !!uTulis && !!uTanpa);

const H = async (metode, p, tok, body = null) => { const r = await fetch(BASE + p, { method: metode, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const kirim = async (tok, id, buf, { nama = "foto.jpg", tipe = "image/jpeg" } = {}) => { const fd = new FormData(); fd.append("foto", new Blob([buf], { type: tipe }), nama); const r = await fetch(`${BASE}/api/inventory/materials/${id}/photo`, { method: "PUT", headers: tok ? { Authorization: "Bearer " + tok } : {}, body: fd }); let j = null; try { j = await r.json(); } catch { /* */ } return { status: r.status, json: j }; };
const jpeg = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 140, b: 90 } } }).jpeg().toBuffer();
const namaDari = (u) => new URL(u, "http://x").pathname.split("/").pop();
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const berkas = () => (fs.existsSync(FOTO_BAHAN_DIR) ? fs.readdirSync(FOTO_BAHAN_DIR).sort() : []);

// ── A. KEADAAN AWAL pada data NYATA hasil restore (hanya baca)
const jejak = async () => ({
  stok: await num("select count(*)::int n from stock_movements"), valuasi: await num("select count(*)::int n from fin_stock_movement_valuations"), jurnal: await num("select count(*)::int n from fin_journal_entries"), jurnalBaris: await num("select count(*)::int n from fin_journal_lines"),
  harga: await num("select count(*)::int n from material_harga_berlaku"), biayaBeku: await num("select count(*)::int n from stock_movement_biaya_operasional"), penyesuaian: await num("select count(*)::int n from stock_adjustment_requests"), material: await num("select count(*)::int n from materials"),
});
const sidikBahan = async () => String((await prisma.$queryRawUnsafe("select coalesce(md5(string_agg((to_jsonb(m) - 'photo_file' - 'photo_updated_at')::text, '|' order by m.id::text)), '-') as n from materials m"))[0].n);
const sidikHarga = async () => String((await prisma.$queryRawUnsafe("select coalesce(md5(string_agg(h::text, '|' order by h.id::text)), '-') as n from material_harga_berlaku h"))[0].n);
const j0 = await jejak(); const b0 = await sidikBahan(); const h0 = await sidikHarga();
const sl0 = await H("GET", "/api/inventory/beranda/stok", tW);
cek("Stok & Lokasi pada data restore terbaca (200) dan memuat bahan nyata", sl0.status === 200 && Array.isArray(sl0.json?.rows) && sl0.json.rows.length > 0, `${sl0.status} ${sl0.json?.rows?.length} bahan`);
const baris0 = sl0.json?.rows ?? [];
cek("SEMUA bahan nyata tanpa foto: fotoUrl/fotoThumbUrl = null (bukan URL palsu), tanpa backfill", baris0.length > 0 && baris0.every((r) => r.fotoUrl === null && r.fotoThumbUrl === null), `${baris0.filter((r) => r.fotoUrl !== null).length} bahan berfoto`);
const bagian = (rows) => JSON.stringify(rows.map(({ fotoUrl, fotoThumbUrl, ...sisa }) => sisa));
const daftar0 = await H("GET", "/api/inventory/materials", tW);
cek("daftar bahan (/inventory/materials) terbaca; kolom mentah photoFile tidak bocor ke respons", daftar0.status === 200 && Array.isArray(daftar0.json) && daftar0.json.length === j0.material && daftar0.json.every((m) => !("photoFile" in m) && m.fotoUrl === null), `${daftar0.status}`);

// ── B. AKSES & IZIN
const kode = `REH-FOTO-${stamp}`.toUpperCase();
const m = await prisma.material.create({ data: { code: kode, name: "Bahan uji rehearsal foto (hanya di salinan)", unit: "PCS" } });
const g1 = await kirim(tW, m.id, await jpeg(3000, 2000));
cek("penulis bahan mengunggah foto 3000×2000: 200 dan URL bertanda-tangan", g1.status === 200 && /\/api\/inventory\/foto-bahan\/[^?]+\.webp\?exp=\d+&sig=[0-9a-f]{64}$/.test(g1.json?.fotoUrl ?? "") && !("photoFile" in (g1.json ?? {})), `${g1.status} ${g1.json?.error ?? ""}`);
const n1 = namaDari(g1.json?.fotoUrl ?? "");
cek("nama berkas valid (<id bahan>-<hex>.webp) + pasangan thumbnail ada di folder SEMENTARA; tidak ada berkas lain", NAMA_VALID.test(n1) && JSON.stringify(berkas()) === JSON.stringify([n1, namaThumb(n1)].sort()), berkas().join(","));
const meta1 = await sharp(fs.readFileSync(path.join(FOTO_BAHAN_DIR, n1))).metadata();
cek("hasil WebP, sisi terpanjang 1280, metadata dibuang", meta1.format === "webp" && Math.max(meta1.width, meta1.height) === 1280 && !meta1.exif, `${meta1.format} ${meta1.width}x${meta1.height}`);
const aksesTtd = await fetch(BASE + g1.json.fotoUrl); const aksesThumb = await fetch(BASE + g1.json.fotoThumbUrl);
cek("URL bertanda-tangan menyajikan foto (200 image/webp, nosniff, private+immutable) dan thumbnail", aksesTtd.status === 200 && aksesThumb.status === 200 && aksesTtd.headers.get("content-type") === "image/webp" && aksesTtd.headers.get("x-content-type-options") === "nosniff" && /private/.test(aksesTtd.headers.get("cache-control") ?? "") && /immutable/.test(aksesTtd.headers.get("cache-control") ?? ""));
cek("tanpa kredensial = 401; tanda tangan salah = 403; Bearer penulis = 200; akun tanpa izin baca bahan = 403", (await fetch(`${BASE}/api/inventory/foto-bahan/${n1}`)).status === 401 && (await fetch(`${BASE}/api/inventory/foto-bahan/${n1}?exp=${Math.floor(Date.now() / 1000) + 600}&sig=${"0".repeat(64)}`)).status === 403 && (await fetch(`${BASE}/api/inventory/foto-bahan/${n1}`, { headers: { Authorization: "Bearer " + tW } })).status === 200 && (await fetch(`${BASE}/api/inventory/foto-bahan/${n1}`, { headers: { Authorization: "Bearer " + tN } })).status === 403);
const trav = []; for (const k of ["..%2f..%2fpackage.json", "%2e%2e%2fsettings.json", "settings.json", "finance-receipts", ""]) trav.push((await fetch(`${BASE}/api/inventory/foto-bahan/${k}?exp=1&sig=${"0".repeat(64)}`)).status);
cek("traversal / berkas lain / direktori tidak pernah tersaji (semua 401/403/404)", trav.every((s) => [401, 403, 404].includes(s)), trav.join(","));
cek("tanpa izin tulis bahan: unggah/putar/hapus ditolak 403" + (tR ? " (juga pembaca-saja)" : ""), (await kirim(tN, m.id, await jpeg(300, 300))).status === 403 && (await H("DELETE", `/api/inventory/materials/${m.id}/photo`, tN)).status === 403 && (await H("POST", `/api/inventory/materials/${m.id}/photo/rotate`, tN, { derajat: 90 })).status === 403 && (!tR || (await kirim(tR, m.id, await jpeg(300, 300))).status === 403));
cek("penolakan tidak mengubah apa pun: foto lama tetap, tak ada berkas baru", JSON.stringify(berkas()) === JSON.stringify([n1, namaThumb(n1)].sort()));

// ── C. PUTAR / GANTI / VALIDASI / GAGAL-AMAN
const r90 = await H("POST", `/api/inventory/materials/${m.id}/photo/rotate`, tW, { derajat: 90 }); const n2 = namaDari(r90.json?.fotoUrl ?? "");
const meta2 = n2 ? await sharp(fs.readFileSync(path.join(FOTO_BAHAN_DIR, n2))).metadata() : {};
cek("putar 90°: dimensi bertukar, nama BARU (URL berganti, cache tidak menampilkan foto lama), berkas lama terhapus", r90.status === 200 && n2 !== n1 && meta2.width === meta1.height && meta2.height === meta1.width && JSON.stringify(berkas()) === JSON.stringify([n2, namaThumb(n2)].sort()), `${r90.status} ${meta2.width}x${meta2.height}`);
cek("URL lama (sebelum putar) tidak lagi tersaji (404)", (await fetch(BASE + g1.json.fotoUrl)).status === 404 && (await fetch(BASE + g1.json.fotoThumbUrl)).status === 404);
const g3 = await kirim(tW, m.id, await jpeg(700, 700)); const n3 = namaDari(g3.json?.fotoUrl ?? "");
cek("ganti foto: nama baru, daftar Stok & Lokasi langsung memuat URL thumbnail TERBARU", g3.status === 200 && n3 !== n2 && (await H("GET", "/api/inventory/beranda/stok", tW)).json.rows.find((r) => r.materialId === m.id)?.fotoThumbUrl === g3.json.fotoThumbUrl);
const lebar = await sharp({ create: { width: 13000, height: 64, channels: 3, background: "#888" } }).png({ compressionLevel: 9 }).toBuffer();
const tolak = [await kirim(tW, m.id, Buffer.from("bukan gambar")), await kirim(tW, m.id, Buffer.from("%PDF-1.4 palsu")), await kirim(tW, m.id, lebar, { nama: "a.png", tipe: "image/png" }), await kirim(tW, m.id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"/>'), { nama: "a.png", tipe: "image/png" }), await kirim(tW, m.id, Buffer.alloc(10 * 1024 * 1024 + 4096, 1))];
cek("isi bukan gambar / PDF / dimensi 13000 / SVG / >10 MB ditolak (400/413) SEBELUM diproses", tolak.map((r) => r.status).join() === "400,400,400,400,413", tolak.map((r) => r.status).join());
cek("setelah semua penolakan: foto terakhir utuh dan tak ada berkas yatim", JSON.stringify(berkas()) === JSON.stringify([n3, namaThumb(n3)].sort()));
const ser = await Promise.all([jpeg(600, 400), jpeg(500, 500), jpeg(400, 600)].map(async (b) => kirim(tW, m.id, await b)));
const akhir = (await prisma.$queryRawUnsafe("select photo_file as f from materials where id = $1::uuid", m.id))[0].f;
cek("tiga unggahan SERENTAK untuk bahan yang sama: semua 200, tepat satu pasangan berkas tersisa dan dirujuk DB", ser.every((r) => r.status === 200) && JSON.stringify(berkas()) === JSON.stringify([akhir, namaThumb(akhir)].sort()), `${ser.map((r) => r.status).join()} ${berkas().length} berkas`);
const audit = await prisma.activityEvent.findMany({ where: { entityType: "material", entityId: m.id }, orderBy: { createdAt: "asc" } });
cek("jejak audit: satu per perubahan foto, rantai from→to tidak putus, pelaku tercatat", audit.length === 6 && audit.slice(1).every((a, i) => a.metadata.changes.foto.from === audit[i].metadata.changes.foto.to) && audit.every((a) => a.actorId === uTulis.id), `${audit.length} peristiwa`);
// foto dimanipulasi: nilai kolom menunjuk berkas lain → hapus TIDAK menyentuh berkas itu
fs.writeFileSync(path.join(FOTO_BAHAN_DIR, "bukan-milik-fitur.txt"), "jangan dihapus");
await prisma.$executeRawUnsafe("update materials set photo_file = $1 where id = $2::uuid", "../bukan-milik-fitur.txt", m.id);
const hp = await H("DELETE", `/api/inventory/materials/${m.id}/photo`, tW);
cek("kolom dimanipulasi (../bukan-milik-fitur.txt): hapus foto hanya membersihkan DB dan TIDAK menghapus berkas lain", hp.status === 200 && fs.existsSync(path.join(FOTO_BAHAN_DIR, "bukan-milik-fitur.txt")));
fs.rmSync(path.join(FOTO_BAHAN_DIR, "bukan-milik-fitur.txt"), { force: true });
for (const f of berkas()) fs.rmSync(path.join(FOTO_BAHAN_DIR, f), { force: true }); // sisa serentak milik bahan uji

// ── D. TIDAK ADA EFEK SAMPING PADA DATA NYATA
const hapusUji = await H("DELETE", `/api/inventory/materials/${m.id}/photo`, tW);
await prisma.activityEvent.deleteMany({ where: { entityType: "material", entityId: m.id } }); await prisma.material.delete({ where: { id: m.id } });
const j1 = await jejak(); const b1 = await sidikBahan(); const h1 = await sidikHarga();
cek("stok, valuasi, jurnal, harga berlaku, biaya beku, penyesuaian, dan jumlah bahan IDENTIK sebelum vs sesudah seluruh uji foto", JSON.stringify(j0) === JSON.stringify(j1), JSON.stringify({ j0, j1 }));
cek("seluruh isi data bahan (kecuali kolom foto) dan seluruh baris Harga Berlaku IDENTIK sebelum vs sesudah", b0 === b1 && h0 === h1);
const sl1 = await H("GET", "/api/inventory/beranda/stok", tW);
cek("angka Stok & Lokasi (saldo, tersedia, keadaan, batas minimum, lokasi terakhir) IDENTIK sebelum vs sesudah — foto tidak mengubah stok", sl1.status === 200 && bagian(sl1.json.rows) === bagian(baris0) && sl1.json.rows.every((r) => r.fotoUrl === null), `${hapusUji.status}`);
berhenti(); await new Promise((r) => setTimeout(r, 500));
await selesai(gagal ? 1 : 0);
