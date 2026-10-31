// FOTO BAHAN — hardening (Okt 2026), Postgres SUNGGUHAN terisolasi + rute ASLI + folder sementara. Melengkapi fotoBahan.integration.test.js (yang sudah mengunci unggah/ganti/putar/hapus dasar).
// Dikunci di sini: (1) akses mengikuti autentikasi aplikasi (URL bertanda-tangan / Bearer berizin; tanpa penyajian statis, tanpa daftar direktori, nama ketat);
// (2) ganti/putar/hapus yang GAGAL tidak merusak foto lama dan tidak meninggalkan berkas yatim; (3) penghapusan hanya menyentuh berkas milik bahan itu;
// (4) validasi isi/dimensi/piksel/format sebelum pemrosesan; (5) unggah serentak konsisten; (6) URL berganti setelah ganti/putar (cache tidak menampilkan foto lama).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { FOTO_BAHAN_DIR, namaThumb, SIGN_PURPOSE } from "../../src/services/fotoBahan.js";
import { signFile } from "../../src/lib/mediaSigning.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await server.close(); await testPrisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS fb_gagal_uji ON activity_events"); await truncateAll(); await testPrisma.$disconnect(); });
test.afterEach(async () => {
  await testPrisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS fb_gagal_uji ON activity_events");
  await truncateAll();
  for (const f of fs.existsSync(FOTO_BAHAN_DIR) ? fs.readdirSync(FOTO_BAHAN_DIR) : []) fs.rmSync(path.join(FOTO_BAHAN_DIR, f), { recursive: true, force: true });
});

const akun = (roles) => createTestUser({ roles });
const jpeg = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 90, g: 160, b: 70 } } }).jpeg().toBuffer();
async function kirim(token, id, buf, { nama = "foto.jpg", tipe = "image/jpeg", method = "PUT" } = {}) {
  const fd = new FormData(); fd.append("foto", new Blob([buf], { type: tipe }), nama);
  const res = await fetch(`${server.baseUrl}/api/inventory/materials/${id}/photo`, { method, headers: { Authorization: `Bearer ${token}` }, body: fd });
  let body = null; try { body = await res.json(); } catch { /* kosong */ }
  return { status: res.status, body };
}
async function api(token, method, url, body) {
  const res = await fetch(`${server.baseUrl}${url}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body !== undefined ? JSON.stringify(body) : undefined });
  let b = null; try { b = await res.json(); } catch { /* kosong */ }
  return { status: res.status, body: b };
}
const get = (url, token) => fetch(`${server.baseUrl}${url}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
const namaDari = (url) => new URL(url, "http://x").pathname.split("/").pop();
const berkas = () => (fs.existsSync(FOTO_BAHAN_DIR) ? fs.readdirSync(FOTO_BAHAN_DIR).sort() : []);
const pasang = (nama) => [nama, namaThumb(nama)].sort();
const dbFoto = async (id) => (await testPrisma.$queryRaw`SELECT photo_file AS f FROM materials WHERE id = ${id}::uuid`)[0].f;
const bytes = (nama) => fs.readFileSync(path.join(FOTO_BAHAN_DIR, nama));
async function gagalkanAudit() { // setiap penulisan jejak audit gagal → transaksi foto GAGAL setelah berkas baru sempat ditulis
  await testPrisma.$executeRawUnsafe("CREATE OR REPLACE FUNCTION fb_gagal_uji() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'galat uji foto bahan'; END $$ LANGUAGE plpgsql");
  await testPrisma.$executeRawUnsafe("CREATE TRIGGER fb_gagal_uji BEFORE INSERT ON activity_events FOR EACH ROW EXECUTE FUNCTION fb_gagal_uji()");
}
const pulihkanAudit = () => testPrisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS fb_gagal_uji ON activity_events");

async function bahanBerfoto(roles = ["WAREHOUSE"]) {
  const g = await akun(roles); const m = await createTestMaterial({ code: `FBK-${Math.random().toString(36).slice(2, 7).toUpperCase()}`, name: "Bahan keamanan foto" });
  const r = await kirim(g.token, m.id, await jpeg(800, 500)); assert.equal(r.status, 200, JSON.stringify(r.body));
  return { g, m, r, nama: namaDari(r.body.fotoUrl), thumb: namaDari(r.body.fotoThumbUrl) };
}

// ── (1) AKSES ───────────────────────────────────────────────────────────────────────────────────────────────────
test("akses foto: URL bertanda-tangan 200 (image/webp, nosniff, private+immutable); Bearer berizin 200; tanpa kredensial 401; peran tanpa izin baca 403", async () => {
  const { g, r, nama, thumb } = await bahanBerfoto(); const sales = await akun(["SALES"]);
  for (const url of [r.body.fotoUrl, r.body.fotoThumbUrl]) {
    const res = await get(url); assert.equal(res.status, 200, url); assert.equal(res.headers.get("content-type"), "image/webp"); assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("cache-control"), /private/); assert.match(res.headers.get("cache-control"), /immutable/);
    assert.deepEqual((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).format, "webp");
  }
  assert.equal((await get(`/api/inventory/foto-bahan/${nama}`, g.token)).status, 200, "Bearer pemegang izin baca bahan");
  assert.equal((await get(`/api/inventory/foto-bahan/${thumb}`, g.token)).status, 200);
  assert.equal((await get(`/api/inventory/foto-bahan/${nama}`)).status, 401, "tanpa kredensial");
  assert.equal((await get(`/api/inventory/foto-bahan/${nama}`, sales.token)).status, 403, "peran tanpa izin baca bahan");
});

test("akses foto: tanda tangan salah / kedaluwarsa / milik berkas lain / tujuan lain ditolak 403", async () => {
  const { r, nama, thumb } = await bahanBerfoto(); const u = new URL(r.body.fotoUrl, "http://x"); const exp = u.searchParams.get("exp"); const sig = u.searchParams.get("sig");
  const ubah = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
  assert.equal((await get(`/api/inventory/foto-bahan/${nama}?exp=${exp}&sig=${ubah}`)).status, 403, "sig diubah");
  assert.equal((await get(`/api/inventory/foto-bahan/${nama}?exp=${Number(exp) + 3600}&sig=${sig}`)).status, 403, "exp diubah");
  const lalu = signFile(nama, { ttlSeconds: 60, now: Date.now() - 3600_000, purpose: SIGN_PURPOSE });
  assert.equal((await get(`/api/inventory/foto-bahan/${nama}?exp=${lalu.exp}&sig=${lalu.sig}`)).status, 403, "kedaluwarsa");
  assert.equal((await get(`/api/inventory/foto-bahan/${thumb}?exp=${exp}&sig=${sig}`)).status, 403, "tanda tangan berkas utama tidak berlaku untuk berkas lain");
  const lain = signFile(nama, { ttlSeconds: 600, purpose: "finance-media-v1" });
  assert.equal((await get(`/api/inventory/foto-bahan/${nama}?exp=${lain.exp}&sig=${lain.sig}`)).status, 403, "tanda tangan jenis media lain tidak berlaku");
});

test("akses foto: nama ketat — traversal, berkas lain di folder, direktori, dan berkas tak ada tidak pernah tersaji", async () => {
  const { nama, r } = await bahanBerfoto(); const ttd = r.body.fotoUrl.split("?")[1];
  fs.writeFileSync(path.join(FOTO_BAHAN_DIR, "rahasia.txt"), "bukan foto"); fs.mkdirSync(path.join(FOTO_BAHAN_DIR, "sub"), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(FOTO_BAHAN_DIR), "di-luar-folder.webp"), "x");
  const kasus = ["rahasia.txt", "sub", "..%2f..%2fetc%2fpasswd", "%2e%2e%2fdi-luar-folder.webp", "..%5cdi-luar-folder.webp", `${nama}%00.txt`, "00000000-0000-4000-8000-000000000000-aaaaaaaaaaaa.webp", nama.toUpperCase(), ""];
  for (const k of kasus) { const res = await get(`/api/inventory/foto-bahan/${k}?${ttd}`); assert.ok([404, 403, 401].includes(res.status), `${k} → ${res.status}`); /* 401 = nama kosong jatuh ke rute lain yang menuntut login */ assert.notEqual(res.headers.get("content-type"), "image/webp", k); }
  const daftar = await get(`/api/inventory/foto-bahan/`); assert.notEqual(daftar.status, 200, "tidak ada daftar direktori"); assert.ok(!(await daftar.text()).includes("rahasia"), "isi folder tidak bocor");
  fs.rmSync(path.join(path.dirname(FOTO_BAHAN_DIR), "di-luar-folder.webp"), { force: true });
});

test("URL berganti setelah ganti dan putar (cache daftar/drawer tidak menampilkan foto lama); URL lama tak lagi tersaji", async () => {
  const { g, m, r, nama } = await bahanBerfoto();
  const sl0 = (await api(g.token, "GET", "/api/inventory/beranda/stok")).body.rows.find((x) => x.materialId === m.id);
  assert.equal(sl0.fotoThumbUrl, r.body.fotoThumbUrl, "daftar memakai thumbnail yang sama dengan respons unggah");
  const putar = await api(g.token, "POST", `/api/inventory/materials/${m.id}/photo/rotate`, { derajat: 90 });
  assert.equal(putar.status, 200); assert.notEqual(putar.body.fotoUrl, r.body.fotoUrl); assert.notEqual(putar.body.fotoThumbUrl, r.body.fotoThumbUrl);
  const ganti = await kirim(g.token, m.id, await jpeg(700, 700)); assert.equal(ganti.status, 200); assert.notEqual(ganti.body.fotoThumbUrl, putar.body.fotoThumbUrl);
  const sl1 = (await api(g.token, "GET", "/api/inventory/beranda/stok")).body.rows.find((x) => x.materialId === m.id);
  assert.equal(sl1.fotoThumbUrl, ganti.body.fotoThumbUrl, "daftar langsung memuat URL thumbnail terbaru"); assert.notEqual(namaDari(sl1.fotoThumbUrl), namaThumb(nama));
  assert.equal((await get(r.body.fotoUrl)).status, 404, "URL foto sebelum putar/ganti tak lagi tersaji");
  assert.equal((await get(r.body.fotoThumbUrl)).status, 404);
  assert.equal((await get(ganti.body.fotoThumbUrl)).status, 200);
});

// ── (2) GAGAL TIDAK MERUSAK FOTO LAMA ──────────────────────────────────────────────────────────────────────────
test("ganti GAGAL di tengah transaksi: foto lama utuh (berkas + DB), berkas baru dibersihkan, tidak ada yatim; setelah pulih, ganti berhasil", async () => {
  const { g, m, nama } = await bahanBerfoto(); const isiLama = bytes(nama);
  await gagalkanAudit();
  const r = await kirim(g.token, m.id, await jpeg(500, 500)); assert.equal(r.status, 500);
  assert.equal(await dbFoto(m.id), nama, "DB tetap menunjuk foto lama"); assert.deepEqual(berkas(), pasang(nama), "hanya foto lama; berkas baru dibersihkan"); assert.ok(isiLama.equals(bytes(nama)), "isi foto lama tidak berubah");
  assert.equal((await testPrisma.activityEvent.count({ where: { entityType: "material", entityId: m.id } })), 1, "jejak audit hanya dari unggah awal");
  await pulihkanAudit();
  const ok = await kirim(g.token, m.id, await jpeg(500, 500)); assert.equal(ok.status, 200); assert.deepEqual(berkas(), pasang(namaDari(ok.body.fotoUrl)));
});

test("putar GAGAL di tengah transaksi: foto lama utuh, tidak ada yatim", async () => {
  const { g, m, nama } = await bahanBerfoto(); const isiLama = bytes(nama);
  await gagalkanAudit();
  assert.equal((await api(g.token, "POST", `/api/inventory/materials/${m.id}/photo/rotate`, { derajat: 180 })).status, 500);
  assert.equal(await dbFoto(m.id), nama); assert.deepEqual(berkas(), pasang(nama)); assert.ok(isiLama.equals(bytes(nama)));
});

test("hapus GAGAL di tengah transaksi: foto tetap ada (berkas + DB)", async () => {
  const { g, m, nama } = await bahanBerfoto();
  await gagalkanAudit();
  assert.equal((await api(g.token, "DELETE", `/api/inventory/materials/${m.id}/photo`)).status, 500);
  assert.equal(await dbFoto(m.id), nama); assert.deepEqual(berkas(), pasang(nama));
});

test("unggahan ditolak (bukan gambar / rusak / terpotong) tidak menyentuh foto lama sama sekali", async () => {
  const { g, m, nama } = await bahanBerfoto(); const isiLama = bytes(nama); const utuh = await jpeg(900, 900);
  for (const [label, buf] of [["teks", Buffer.from("bukan gambar")], ["jpeg terpotong", utuh.subarray(0, Math.floor(utuh.length / 2))], ["nol byte acak", Buffer.alloc(5000, 7)]]) {
    const r = await kirim(g.token, m.id, buf); assert.equal(r.status, 400, `${label}: ${JSON.stringify(r.body)}`);
  }
  assert.equal(await dbFoto(m.id), nama); assert.deepEqual(berkas(), pasang(nama)); assert.ok(isiLama.equals(bytes(nama)));
});

test("putar saat berkas foto hilang dari penyimpanan: 404 jelas, DB tidak berubah; nama di DB rusak: 409", async () => {
  const { g, m, nama } = await bahanBerfoto();
  fs.rmSync(path.join(FOTO_BAHAN_DIR, nama));
  const r = await api(g.token, "POST", `/api/inventory/materials/${m.id}/photo/rotate`, { derajat: 90 }); assert.equal(r.status, 404); assert.match(r.body.error, /Unggah ulang/);
  assert.equal(await dbFoto(m.id), nama);
  await testPrisma.$executeRaw`UPDATE materials SET photo_file = 'bukan-nama-sah.webp' WHERE id = ${m.id}::uuid`;
  assert.equal((await api(g.token, "POST", `/api/inventory/materials/${m.id}/photo/rotate`, { derajat: 90 })).status, 409);
  const sl = (await api(g.token, "GET", "/api/inventory/beranda/stok")).body.rows.find((x) => x.materialId === m.id); assert.equal(sl.fotoUrl, null, "nama tak sah tidak pernah ditandatangani");
});

// ── (3) HAPUS HANYA BERKAS MILIK FITUR + BAHAN INI ─────────────────────────────────────────────────────────────
test("hapus/ganti hanya menyentuh berkas milik bahan itu: nilai kolom dimanipulasi (traversal / berkas bahan lain / nama bebas) tidak menghapus apa pun", async () => {
  const a = await bahanBerfoto(); const b = await bahanBerfoto();
  fs.writeFileSync(path.join(FOTO_BAHAN_DIR, "catatan-penting.txt"), "jangan dihapus"); fs.writeFileSync(path.join(path.dirname(FOTO_BAHAN_DIR), "luar.webp"), "x");
  for (const nilai of [b.nama, "../luar.webp", "catatan-penting.txt", "../../package.json"]) {
    await testPrisma.$executeRaw`UPDATE materials SET photo_file = ${nilai} WHERE id = ${a.m.id}::uuid`;
    const hapus = await api(a.g.token, "DELETE", `/api/inventory/materials/${a.m.id}/photo`); assert.equal(hapus.status, 200, `${nilai}: ${JSON.stringify(hapus.body)}`);
    assert.equal(await dbFoto(a.m.id), null);
    assert.ok(fs.existsSync(path.join(FOTO_BAHAN_DIR, b.nama)) && fs.existsSync(path.join(FOTO_BAHAN_DIR, b.thumb)), `foto bahan lain utuh (${nilai})`);
    assert.ok(fs.existsSync(path.join(FOTO_BAHAN_DIR, "catatan-penting.txt")) && fs.existsSync(path.join(path.dirname(FOTO_BAHAN_DIR), "luar.webp")), `berkas bukan milik fitur utuh (${nilai})`);
  }
  await testPrisma.$executeRaw`UPDATE materials SET photo_file = ${b.nama} WHERE id = ${a.m.id}::uuid`; // ganti pada bahan A yang menunjuk berkas bahan B
  assert.equal((await kirim(a.g.token, a.m.id, await jpeg(400, 400))).status, 200);
  assert.ok(fs.existsSync(path.join(FOTO_BAHAN_DIR, b.nama)), "foto bahan B tidak ikut terhapus saat bahan A mengganti fotonya");
  fs.rmSync(path.join(path.dirname(FOTO_BAHAN_DIR), "luar.webp"), { force: true });
});

// ── (4) VALIDASI ISI / UKURAN / DIMENSI / PIKSEL / FORMAT ──────────────────────────────────────────────────────
test("validasi sebelum pemrosesan: dimensi/piksel berlebih, format tak didukung (SVG, GIF, PDF menyamar), > 10 MB, tipe palsu — ditolak; isi menentukan (bukan Content-Type)", async () => {
  const g = await akun(["WAREHOUSE"]); const m = await createTestMaterial({ code: "FBV-1", name: "Validasi" });
  const lebar = await sharp({ create: { width: 13000, height: 64, channels: 3, background: "#888" } }).png({ compressionLevel: 9 }).toBuffer();
  const piksel = await sharp({ create: { width: 9000, height: 7200, channels: 3, background: "#888" } }).png({ compressionLevel: 9 }).toBuffer();
  assert.ok(lebar.length < 1_000_000 && piksel.length < 5_000_000, "berkas kecil tetapi dimensi raksasa");
  const r1 = await kirim(g.token, m.id, lebar, { nama: "lebar.png", tipe: "image/png" }); assert.equal(r1.status, 400); assert.match(r1.body.error, /Dimensi gambar terlalu besar/);
  const r2 = await kirim(g.token, m.id, piksel, { nama: "piksel.png", tipe: "image/png" }); assert.equal(r2.status, 400); assert.match(r2.body.error, /megapiksel/);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="red"/></svg>');
  assert.equal((await kirim(g.token, m.id, svg, { nama: "a.png", tipe: "image/png" })).status, 400, "SVG menyamar sebagai PNG");
  const gif = await sharp(await jpeg(100, 100)).gif().toBuffer(); assert.equal((await kirim(g.token, m.id, gif, { nama: "a.gif", tipe: "image/gif" })).status, 400, "GIF tidak didukung");
  assert.equal((await kirim(g.token, m.id, Buffer.from("%PDF-1.4\n%fake"), { nama: "a.jpg", tipe: "image/jpeg" })).status, 400, "PDF menyamar sebagai JPEG");
  assert.equal((await kirim(g.token, m.id, Buffer.alloc(10 * 1024 * 1024 + 2048, 1), { nama: "besar.jpg" })).status, 413);
  const jpgBeriNamaTeks = await kirim(g.token, m.id, await jpeg(300, 300), { nama: "foto.txt", tipe: "text/plain" });
  assert.equal(jpgBeriNamaTeks.status, 200, "isi JPEG yang sah diterima walau nama/tipe kiriman klien keliru: isi yang menentukan");
  assert.deepEqual(berkas().length, 2);
});

test("batas dimensi sisi yang sah: 12000×100 diterima dan diperkecil; 4000×4000 (16 MP) diterima", async () => {
  const g = await akun(["WAREHOUSE"]); const m = await createTestMaterial({ code: "FBV-2", name: "Batas sah" });
  const sempit = await sharp({ create: { width: 12000, height: 100, channels: 3, background: "#999" } }).jpeg().toBuffer();
  const r1 = await kirim(g.token, m.id, sempit); assert.equal(r1.status, 200, JSON.stringify(r1.body));
  const empat = await sharp({ create: { width: 4000, height: 4000, channels: 3, background: "#777" } }).jpeg().toBuffer();
  const r2 = await kirim(g.token, m.id, empat); assert.equal(r2.status, 200, JSON.stringify(r2.body));
  const meta = await sharp(bytes(namaDari(r2.body.fotoUrl))).metadata(); assert.deepEqual([meta.width, meta.height], [1280, 1280]); assert.deepEqual(berkas().length, 2, "satu foto saja yang tersisa");
});

// ── (5) SERENTAK ─────────────────────────────────────────────────────────────────────────────────────────────────
test("unggah serentak untuk bahan yang sama: tepat satu foto tersisa, DB menunjuk berkas yang ada, tanpa yatim; putar serentak dengan ganti tidak menimpa foto lebih baru", async () => {
  const g = await akun(["WAREHOUSE"]); const m = await createTestMaterial({ code: "FBS-1", name: "Serentak" });
  const bufs = await Promise.all([jpeg(600, 400), jpeg(500, 500), jpeg(400, 600), jpeg(700, 300)]);
  const hasil = await Promise.all(bufs.map((b) => kirim(g.token, m.id, b))); assert.ok(hasil.every((r) => r.status === 200), JSON.stringify(hasil.map((r) => r.status)));
  const akhir = await dbFoto(m.id); assert.deepEqual(berkas(), pasang(akhir), "hanya pasangan foto yang dirujuk DB");
  const audit = await testPrisma.activityEvent.findMany({ where: { entityType: "material", entityId: m.id }, orderBy: { createdAt: "asc" } }); assert.equal(audit.length, 4, "satu jejak per perubahan");
  const rantai = audit.map((a) => a.metadata.changes.foto); for (let i = 1; i < rantai.length; i++) assert.equal(rantai[i].from, rantai[i - 1].to, "rantai from→to tak putus (tak ada pembacaan basi)");
  const [putar, ganti] = await Promise.all([api(g.token, "POST", `/api/inventory/materials/${m.id}/photo/rotate`, { derajat: 90 }), kirim(g.token, m.id, await jpeg(450, 450))]);
  assert.ok([200, 409].includes(putar.status) && ganti.status === 200, `${putar.status}/${ganti.status}`);
  assert.deepEqual(berkas(), pasang(await dbFoto(m.id)), "tidak ada yatim setelah putar+ganti serentak");
  if (putar.status === 200) assert.equal(await dbFoto(m.id) !== null, true);
});
