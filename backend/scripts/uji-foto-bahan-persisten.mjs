// Bukti PERSISTENSI foto bahan lintas recreate container (dipakai uji lokal DAN rehearsal rilis). BUKAN alat produksi.
//
//   node scripts/uji-foto-bahan-persisten.mjs tulis            → membuat bahan uji, menulis satu foto lewat layanan yang sama dengan fitur, mencetak JSON {materialId, nama, sha256}
//   node scripts/uji-foto-bahan-persisten.mjs baca <materialId> <sha256> → server media sementara (router PRODUKSI) menyajikan foto itu lewat URL bertanda-tangan; isi harus sama persis
//   node scripts/uji-foto-bahan-persisten.mjs bersih <materialId>        → menghapus bahan uji + berkas fotonya (hanya yang dikelola fitur dan milik bahan uji itu)
//
// PAGAR: (1) DATABASE_URL wajib berupa salinan/tes — nama database harus mengandung "test" atau "rehearsal"; (2) folder foto wajib di dalam /app/data atau FOTO_BAHAN_DIR eksplisit di luar produksi;
// (3) hanya menyentuh baris bahan berkode UJI-FOTO-PERSISTEN-* dan berkas fotonya. Tidak menyentuh stok/harga/jurnal.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express from "express";

process.env.JWT_SECRET ||= "uji-persisten-bukan-rahasia-produksi";
const dbUrl = process.env.DATABASE_URL || "";
const dbName = (dbUrl.match(/\/([^/?]+)(\?.*)?$/) || [])[1] || "";
if (!/test|rehearsal/i.test(dbName)) { console.error(`BERHENTI: nama database "${dbName}" bukan salinan/tes (wajib mengandung "test" atau "rehearsal")`); process.exit(2); }

const { prisma } = await import("../src/db.js");
const { FOTO_BAHAN_DIR, olahFoto, tulisFoto, hapusBerkasFoto, urlFoto, urlThumb } = await import("../src/services/fotoBahan.js");
const { materialPhotoPathRouter } = await import("../src/routes/materialPhotoMedia.js");
const sharp = (await import("sharp")).default;

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const [mode, materialId, shaDiharapkan] = process.argv.slice(2);
const keluar = (o) => console.log(JSON.stringify(o));
const gagal = (m) => { console.error("GAGAL: " + m); process.exitCode = 1; };

async function tulis() {
  const kode = `UJI-FOTO-PERSISTEN-${Date.now()}`;
  const m = await prisma.material.create({ data: { code: kode, name: "Bahan uji persistensi foto (sementara)", unit: "PCS" } });
  const gambar = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 12, g: 99, b: 180 } } }).jpeg().toBuffer();
  const hasil = await olahFoto(gambar, m.id);
  await tulisFoto(hasil);
  await prisma.material.update({ where: { id: m.id }, data: { photoFile: hasil.nama, photoUpdatedAt: new Date() } });
  keluar({ materialId: m.id, nama: hasil.nama, sha256: sha(hasil.utama), folder: FOTO_BAHAN_DIR });
}

async function baca() {
  const m = await prisma.material.findUnique({ where: { id: materialId } });
  if (!m || !m.code.startsWith("UJI-FOTO-PERSISTEN-")) return gagal("bahan uji tidak ditemukan");
  const app = express(); app.use("/api/inventory/foto-bahan", materialPhotoPathRouter);
  const server = await new Promise((ok) => { const s = http.createServer(app).listen(0, "127.0.0.1", () => ok(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const utama = await fetch(base + urlFoto(m.photoFile)); const thumb = await fetch(base + urlThumb(m.photoFile));
    const isi = Buffer.from(await utama.arrayBuffer());
    const tanpaTtd = await fetch(base + urlFoto(m.photoFile).split("?")[0]);
    const hasil = { statusUtama: utama.status, statusThumb: thumb.status, shaCocok: sha(isi) === shaDiharapkan, tanpaTandaTangan: tanpaTtd.status, folder: FOTO_BAHAN_DIR };
    keluar(hasil);
    if (utama.status !== 200 || thumb.status !== 200) gagal("foto tidak terbaca setelah recreate container");
    else if (!hasil.shaCocok) gagal("isi foto berbeda dari yang ditulis");
    else if (hasil.tanpaTandaTangan !== 401) gagal("akses tanpa tanda tangan seharusnya 401");
  } finally { server.close(); }
}

async function bersih() {
  const m = await prisma.material.findUnique({ where: { id: materialId } });
  if (!m || !m.code.startsWith("UJI-FOTO-PERSISTEN-")) return gagal("bahan uji tidak ditemukan");
  if (m.photoFile) await hapusBerkasFoto(m.photoFile, m.id);
  await prisma.material.delete({ where: { id: m.id } });
  keluar({ bersih: true, sisaBerkasMilikBahanUji: fs.existsSync(FOTO_BAHAN_DIR) ? fs.readdirSync(FOTO_BAHAN_DIR).filter((f) => f.startsWith(m.id)).length : 0 });
}

try {
  if (mode === "tulis") await tulis(); else if (mode === "baca" && materialId && shaDiharapkan) await baca(); else if (mode === "bersih" && materialId) await bersih();
  else { console.error("pemakaian: tulis | baca <materialId> <sha256> | bersih <materialId>"); process.exitCode = 2; }
} catch (e) { gagal(String(e?.stack || e).slice(0, 600)); } finally { await prisma.$disconnect(); }
void path;
