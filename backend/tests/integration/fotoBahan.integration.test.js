// FOTO BAHAN (Okt 2026) — Postgres SUNGGUHAN terisolasi, rute ASLI, berkas ke folder sementara (env.js → FOTO_BAHAN_DIR).
// Yang dikunci: unggah/ganti/putar/hapus foto per bahan; izin = izin ubah bahan (INVENTORY_WRITE); pemrosesan (EXIF diikuti, sisi terpanjang ≤1280, WebP, metadata dibuang, thumbnail 192);
// berkas bukan gambar / terlalu besar ditolak TANPA mengubah apa pun; berkas lama dihapus setelah baris DB diperbarui; jejak audit; foto TIDAK menyentuh stok/jurnal/valuasi/harga.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { FOTO_BAHAN_DIR, namaThumb, NAMA_VALID } from "../../src/services/fotoBahan.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await server.close(); await truncateAll(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); for (const f of fs.existsSync(FOTO_BAHAN_DIR) ? fs.readdirSync(FOTO_BAHAN_DIR) : []) fs.rmSync(path.join(FOTO_BAHAN_DIR, f), { force: true }); });

const akun = async (roles) => createTestUser({ roles });
async function jpeg(w, h, extra = {}) { return sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg(extra).toBuffer(); }
async function kirim(token, materialId, buf, { nama = "foto.jpg", tipe = "image/jpeg", method = "PUT" } = {}) {
  const fd = new FormData(); fd.append("foto", new Blob([buf], { type: tipe }), nama);
  const res = await fetch(`${server.baseUrl}/api/inventory/materials/${materialId}/photo`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
  let body = null; try { body = await res.json(); } catch { /* kosong */ }
  return { status: res.status, body };
}
async function json(token, method, url, body) {
  const res = await fetch(`${server.baseUrl}${url}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  let b = null; try { b = await res.json(); } catch { /* kosong */ }
  return { status: res.status, body: b };
}
// Baca lewat buffer (bukan sharp(path)): di Windows sharp menahan gagang berkas sehingga unlink/cleanup gagal EPERM.
const metaDi = (nama) => sharp(fs.readFileSync(path.join(FOTO_BAHAN_DIR, nama))).metadata();
const berkas = () => (fs.existsSync(FOTO_BAHAN_DIR) ? fs.readdirSync(FOTO_BAHAN_DIR).sort() : []);
const dbFoto = async (id) => (await testPrisma.$queryRaw`SELECT photo_file AS f, photo_updated_at AS t FROM materials WHERE id = ${id}::uuid`)[0];
const efek = async () => ({
  stok: await testPrisma.stockMovement.count(), jurnal: await testPrisma.finJournalEntry.count(), valuasi: await testPrisma.finStockMovementValuation.count(),
  harga: await testPrisma.materialHargaBerlaku.count(), adj: await testPrisma.stockAdjustmentRequest.count(),
});
const auditFoto = (id) => testPrisma.activityEvent.findMany({ where: { entityType: "material", entityId: id, eventType: "MATERIAL_UPDATED" }, orderBy: { createdAt: "asc" } });

test("unggah foto: 200, WebP ≤1280 tanpa metadata + thumbnail 192, DB terisi, audit, stok/jurnal/valuasi/harga tidak tersentuh, muncul di stok-lokasi & daftar bahan", async () => {
  const g = await akun(["WAREHOUSE"]); const m = await createTestMaterial({ code: "FB-1", name: "Busa foto" }); await seedBalance(m.id, 5);
  const sebelum = await efek();
  const r = await kirim(g.token, m.id, await jpeg(3000, 2000));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.fotoUrl, /^\/media\/material-photos\/.+\.webp$/); assert.match(r.body.fotoThumbUrl, /-t\.webp$/);
  assert.equal(r.body.photoFile, undefined, "nama berkas mentah tidak ikut respons");
  const f = berkas(); assert.equal(f.length, 2); const nama = path.basename(r.body.fotoUrl); assert.ok(NAMA_VALID.test(nama)); assert.deepEqual(f, [nama, namaThumb(nama)].sort());
  const utama = await metaDi(nama); assert.equal(utama.format, "webp"); assert.equal(Math.max(utama.width, utama.height), 1280); assert.equal(utama.exif, undefined, "metadata dibuang");
  const th = await metaDi(namaThumb(nama)); assert.deepEqual([th.width, th.height], [192, 192]);
  assert.equal((await dbFoto(m.id)).f, nama);
  const audit = await auditFoto(m.id); assert.equal(audit.length, 1); assert.deepEqual(audit[0].metadata.changes.foto, { from: null, to: nama }); assert.equal(audit[0].actorId, g.user.id);
  assert.deepEqual(await efek(), sebelum, "stok/jurnal/valuasi/harga/penyesuaian tidak berubah");
  const sl = await json(g.token, "GET", "/api/inventory/beranda/stok"); const baris = (sl.body.rows ?? sl.body).find((x) => x.materialId === m.id);
  assert.equal(baris.fotoUrl, r.body.fotoUrl); assert.equal(baris.fotoThumbUrl, r.body.fotoThumbUrl); assert.equal(baris.saldo, 5, "angka stok tetap");
  const daftar = await json(g.token, "GET", "/api/inventory/materials"); const dm = daftar.body.find((x) => x.id === m.id);
  assert.equal(dm.fotoUrl, r.body.fotoUrl); assert.equal(dm.photoFile, undefined);
});

test("bahan tanpa foto: fotoUrl null (bukan string kosong / URL palsu)", async () => {
  const g = await akun(["WAREHOUSE"]); const m = await createTestMaterial({ code: "FB-2", name: "Tanpa foto" });
  const sl = await json(g.token, "GET", "/api/inventory/beranda/stok"); const baris = (sl.body.rows ?? sl.body).find((x) => x.materialId === m.id);
  assert.equal(baris.fotoUrl, null); assert.equal(baris.fotoThumbUrl, null);
});

test("EXIF orientasi diikuti: foto 400×200 berorientasi 6 jadi potret 200×400", async () => {
  const g = await akun(["WAREHOUSE"]); const m = await createTestMaterial({ code: "FB-3", name: "Orientasi" });
  const buf = await sharp(await jpeg(400, 200)).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const r = await kirim(g.token, m.id, buf); assert.equal(r.status, 200, JSON.stringify(r.body));
  const meta = await metaDi(path.basename(r.body.fotoUrl)); assert.deepEqual([meta.width, meta.height], [200, 400]);
});

test("ganti foto: berkas lama (utama + thumbnail) dihapus, nama baru, audit from→to; foto kecil tidak diperbesar", async () => {
  const g = await akun(["WAREHOUSE"]); const m = await createTestMaterial({ code: "FB-4", name: "Ganti" });
  const a = await kirim(g.token, m.id, await jpeg(600, 400)); const namaA = path.basename(a.body.fotoUrl);
  const b = await kirim(g.token, m.id, await jpeg(500, 500), { nama: "baru.png", tipe: "image/png" }); const namaB = path.basename(b.body.fotoUrl);
  assert.notEqual(namaA, namaB); assert.deepEqual(berkas(), [namaB, namaThumb(namaB)].sort(), "hanya foto baru yang tersisa");
  assert.equal((await metaDi(namaB)).width, 500, "tidak diperbesar");
  const audit = await auditFoto(m.id); assert.equal(audit.length, 2); assert.deepEqual(audit[1].metadata.changes.foto, { from: namaA, to: namaB });
});

test("putar: 90° menukar dimensi, nama baru, berkas lama hilang; sudut tak sah 400; tanpa foto 409", async () => {
  const g = await akun(["WAREHOUSE"]); const m = await createTestMaterial({ code: "FB-5", name: "Putar" });
  assert.equal((await json(g.token, "POST", `/api/inventory/materials/${m.id}/photo/rotate`, { derajat: 90 })).status, 409);
  const a = await kirim(g.token, m.id, await jpeg(600, 300)); const namaA = path.basename(a.body.fotoUrl);
  assert.equal((await json(g.token, "POST", `/api/inventory/materials/${m.id}/photo/rotate`, { derajat: 45 })).status, 400);
  assert.equal((await json(g.token, "POST", `/api/inventory/materials/${m.id}/photo/rotate`, {})).status, 400);
  const r = await json(g.token, "POST", `/api/inventory/materials/${m.id}/photo/rotate`, { derajat: 90 }); assert.equal(r.status, 200, JSON.stringify(r.body));
  const namaB = path.basename(r.body.fotoUrl); assert.notEqual(namaB, namaA); assert.deepEqual(berkas(), [namaB, namaThumb(namaB)].sort());
  const meta = await metaDi(namaB); assert.deepEqual([meta.width, meta.height], [300, 600]);
});

test("hapus foto: berkas hilang, kolom null, audit; hapus kedua idempoten tanpa audit tambahan", async () => {
  const g = await akun(["WAREHOUSE"]); const m = await createTestMaterial({ code: "FB-6", name: "Hapus" });
  const a = await kirim(g.token, m.id, await jpeg(300, 300)); const namaA = path.basename(a.body.fotoUrl);
  const d = await json(g.token, "DELETE", `/api/inventory/materials/${m.id}/photo`); assert.equal(d.status, 200); assert.equal(d.body.fotoUrl, null);
  assert.deepEqual(berkas(), []); assert.equal((await dbFoto(m.id)).f, null);
  assert.equal((await json(g.token, "DELETE", `/api/inventory/materials/${m.id}/photo`)).status, 200);
  const audit = await auditFoto(m.id); assert.equal(audit.length, 2); assert.deepEqual(audit[1].metadata.changes.foto, { from: namaA, to: null });
});

test("penolakan tidak mengubah apa pun: bukan gambar, GIF beranimasi tak perlu, terlalu kecil, tanpa berkas, > 10 MB", async () => {
  const g = await akun(["WAREHOUSE"]); const m = await createTestMaterial({ code: "FB-7", name: "Tolak" });
  const a = await kirim(g.token, m.id, await jpeg(300, 300)); const namaA = path.basename(a.body.fotoUrl);
  const kasus = [
    ["bukan gambar", await kirim(g.token, m.id, Buffer.from("ini teks biasa, bukan gambar"), { nama: "x.jpg", tipe: "image/jpeg" }), 400],
    ["PDF menyamar", await kirim(g.token, m.id, Buffer.from("%PDF-1.4 fake"), { nama: "x.pdf", tipe: "application/pdf" }), 400],
    ["terlalu kecil", await kirim(g.token, m.id, await jpeg(16, 16)), 400],
    ["lebih dari 10 MB", await kirim(g.token, m.id, Buffer.alloc(10 * 1024 * 1024 + 1024, 1)), 413],
  ];
  for (const [nama, r, kode] of kasus) assert.equal(r.status, kode, `${nama}: ${JSON.stringify(r.body)}`);
  const fd = new FormData(); const tanpa = await fetch(`${server.baseUrl}/api/inventory/materials/${m.id}/photo`, { method: "PUT", headers: { Authorization: `Bearer ${g.token}` }, body: fd }); assert.equal(tanpa.status, 400);
  assert.deepEqual(berkas(), [namaA, namaThumb(namaA)].sort(), "foto lama utuh");
  assert.equal((await dbFoto(m.id)).f, namaA); assert.equal((await auditFoto(m.id)).length, 1, "tidak ada audit untuk penolakan");
});

test("izin: tanpa token 401; SALES 403 (tidak ada berkas tertulis); bahan tak dikenal 404", async () => {
  const sales = await akun(["SALES"]); const m = await createTestMaterial({ code: "FB-8", name: "Izin" });
  assert.equal((await kirim(null, m.id, await jpeg(300, 300))).status, 401);
  assert.equal((await kirim(sales.token, m.id, await jpeg(300, 300))).status, 403);
  assert.equal((await json(sales.token, "DELETE", `/api/inventory/materials/${m.id}/photo`)).status, 403);
  assert.equal((await json(sales.token, "POST", `/api/inventory/materials/${m.id}/photo/rotate`, { derajat: 90 })).status, 403);
  assert.deepEqual(berkas(), []); assert.equal((await dbFoto(m.id)).f, null);
  const g = await akun(["WAREHOUSE"]);
  assert.equal((await kirim(g.token, "00000000-0000-4000-8000-000000000000", await jpeg(300, 300))).status, 404);
  assert.deepEqual(berkas(), []);
});

test("OWNER dan ADMIN boleh mengunggah (pemegang izin ubah bahan)", async () => {
  const m = await createTestMaterial({ code: "FB-9", name: "Peran" });
  for (const role of ["OWNER", "ADMIN"]) { const u = await akun([role]); const r = await kirim(u.token, m.id, await jpeg(300, 300)); assert.equal(r.status, 200, `${role}: ${JSON.stringify(r.body)}`); }
});
