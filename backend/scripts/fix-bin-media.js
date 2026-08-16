// Perbaiki file media yang telanjur tersimpan dengan ekstensi ".bin".
//
// LATAR BELAKANG: lihat catatan panjang di src/utils/mediaExt.js. Singkatnya,
// `extFromMime()` versi lama jatuh ke ".bin" untuk MIME yang tidak dikenal,
// sehingga 4.105 file (9,9 GB) — hampir semuanya VIDEO — disajikan
// express.static sebagai "application/octet-stream" dan DITOLAK diputar oleh
// browser. Bug penulisannya sudah diperbaiki; script ini membereskan file
// yang sudah terlanjur ada.
//
// PEMAKAIAN (dry-run dulu, JANGAN langsung --apply):
//   docker compose exec backend node scripts/fix-bin-media.js
//   docker compose exec backend node scripts/fix-bin-media.js --apply
//
// AMAN DIJALANKAN BERKALI-KALI (idempoten & tahan crash). Kuncinya: pencocokan
// dilakukan lewat BASENAME tanpa ekstensi, bukan lewat nama lengkap. Jadi
// kalau script mati persis di antara "file sudah di-rename" dan "DB sudah
// di-update", run berikutnya tetap menemukan pasangannya dan menuntaskan
// update DB-nya — tidak ada link yang tertinggal rusak permanen.
//
// TIDAK menghapus apa pun. Rename + update kolom Message.mediaUrl saja.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../src/db.js";
import { sniffExt } from "../src/utils/mediaExt.js";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "../uploads");
const APPLY      = process.argv.includes("--apply");

// Baca 32 byte pertama saja — cukup untuk semua pola magic-byte, dan jauh
// lebih murah daripada membaca file video 100MB ke memori.
function readHead(filePath, n = 32) {
  const fd = Buffer.alloc(n);
  const handle = fs.openSync(filePath, "r");
  try {
    const bytesRead = fs.readSync(handle, fd, 0, n, 0);
    return fd.subarray(0, bytesRead);
  } finally {
    fs.closeSync(handle);
  }
}

async function main() {
  console.log(`\n=== fix-bin-media.js — mode: ${APPLY ? "APPLY (mengubah data)" : "DRY-RUN (tidak mengubah apa pun)"} ===\n`);

  const semuaFile = fs.readdirSync(uploadsDir);
  const binFiles  = semuaFile.filter((f) => f.toLowerCase().endsWith(".bin"));
  // Index basename → nama file nyata, untuk jalur pemulihan crash di atas.
  const byBasename = new Map();
  for (const f of semuaFile) byBasename.set(path.parse(f).name, f);

  console.log(`File .bin ditemukan : ${binFiles.length}`);

  const rencana = [];   // { lama, baru, ext, bytes }
  const takTerbaca = []; // magic bytes tidak dikenali — dibiarkan .bin

  for (const f of binFiles) {
    const full = path.join(uploadsDir, f);
    let ext = null;
    try { ext = sniffExt(readHead(full)); } catch { /* file rusak/terkunci */ }
    const bytes = fs.statSync(full).size;
    if (!ext || ext === ".bin") { takTerbaca.push({ f, bytes }); continue; }
    rencana.push({ lama: f, baru: path.parse(f).name + ext, ext, bytes });
  }

  // Ringkasan per ekstensi hasil deteksi
  const perExt = {};
  for (const r of rencana) {
    perExt[r.ext] = perExt[r.ext] || { n: 0, bytes: 0 };
    perExt[r.ext].n += 1;
    perExt[r.ext].bytes += r.bytes;
  }
  console.log("\nHasil deteksi isi file (magic bytes):");
  for (const [ext, v] of Object.entries(perExt).sort((a, b) => b[1].bytes - a[1].bytes)) {
    console.log(`  ${ext.padEnd(6)} ${String(v.n).padStart(6)} file   ${(v.bytes / 1073741824).toFixed(2)} GB`);
  }
  if (takTerbaca.length) {
    const gb = takTerbaca.reduce((t, x) => t + x.bytes, 0) / 1073741824;
    console.log(`  (tidak dikenali, tetap .bin: ${takTerbaca.length} file, ${gb.toFixed(2)} GB)`);
  }

  // ── Jalur pemulihan: Message yang mediaUrl-nya .bin TAPI filenya sudah
  // di-rename oleh run sebelumnya yang mati di tengah jalan.
  const rowsBin = await prisma.message.findMany({
    where: { mediaUrl: { endsWith: ".bin" } },
    select: { id: true, mediaUrl: true },
  });
  const yatim = [];
  for (const row of rowsBin) {
    const namaFile = row.mediaUrl.split("/").pop();
    if (fs.existsSync(path.join(uploadsDir, namaFile))) continue; // masih .bin, ditangani rencana di atas
    const nyata = byBasename.get(path.parse(namaFile).name);
    if (nyata) yatim.push({ id: row.id, baru: `/uploads/${nyata}` });
  }
  if (yatim.length) console.log(`\nBaris DB yatim dari run sebelumnya (file sudah di-rename, DB belum): ${yatim.length}`);

  console.log(`\nTotal file akan di-rename : ${rencana.length}`);
  console.log(`Total baris DB akan diupdate: ~${rencana.length + yatim.length}`);

  if (!APPLY) {
    console.log("\n(DRY-RUN — tidak ada yang diubah. Jalankan ulang dengan --apply untuk menerapkan.)\n");
    // Contoh 5 pertama supaya bisa diperiksa manual sebelum apply
    rencana.slice(0, 5).forEach((r) => console.log(`  contoh: ${r.lama}  →  ${r.baru}`));
    console.log();
    await prisma.$disconnect();
    return;
  }

  let renamed = 0, dbUpdated = 0, gagal = 0;

  // Tuntaskan yatim dulu (murni update DB, tidak menyentuh file).
  for (const y of yatim) {
    try {
      await prisma.message.update({ where: { id: y.id }, data: { mediaUrl: y.baru } });
      dbUpdated += 1;
    } catch (e) { gagal += 1; console.warn(`  gagal update yatim ${y.id}: ${e.message}`); }
  }

  for (const r of rencana) {
    try {
      // Rename DULU, baru update DB. Kalau mati di antaranya, run berikutnya
      // menangkapnya lewat jalur "yatim" di atas.
      fs.renameSync(path.join(uploadsDir, r.lama), path.join(uploadsDir, r.baru));
      renamed += 1;
      const hasil = await prisma.message.updateMany({
        where: { mediaUrl: `/uploads/${r.lama}` },
        data:  { mediaUrl: `/uploads/${r.baru}` },
      });
      dbUpdated += hasil.count;
      if (renamed % 500 === 0) console.log(`  ...${renamed}/${rencana.length} file diproses`);
    } catch (e) {
      gagal += 1;
      console.warn(`  gagal ${r.lama}: ${e.message}`);
    }
  }

  console.log(`\n=== SELESAI ===`);
  console.log(`File di-rename    : ${renamed}`);
  console.log(`Baris DB diupdate : ${dbUpdated}`);
  console.log(`Gagal             : ${gagal}`);
  console.log(`\nCatatan: file yang tidak terdeteksi (${takTerbaca.length}) sengaja DIBIARKAN .bin —`);
  console.log(`jangan ditebak-tebak, biar tidak salah label.\n`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
