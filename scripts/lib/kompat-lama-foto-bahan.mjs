import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APP = process.env.APP_DIR ?? "/app";
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 240) : ""}`); };
// KOMPATIBILITAS KODE LAMA: image LAMA (tag rollback) dijalankan terhadap salinan restore yang SUDAH bermigrasi (kolom foto ada). Ini yang terjadi bila rilis di-rollback KODE-nya tanpa membalik skema.
// Dijalankan HANYA pada DB salinan (nama "rehearsal_*" atau "*_test"): ada satu tulisan uji (bahan uji dibuat lalu dihapus) di salinan itu.
const nm = (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_|_test$/.test(nm)) { cek("uji kompatibilitas kode lama hanya pada DB salinan", false, nm); await prisma.$disconnect(); process.exit(1); }
const kolom = Number((await prisma.$queryRawUnsafe("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='materials' and column_name in ('photo_file','photo_updated_at')"))[0].n);
cek("skema salinan SUDAH memuat kolom foto (kode lama berjalan di atas skema BARU)", kolom === 2, `${kolom} kolom`);
const { stokLokasi } = await imp("src/services/stokLokasi.js");
let hasil = null; let galat = "";
try { hasil = await stokLokasi(prisma); } catch (e) { galat = String(e?.message ?? e).slice(0, 200); }
cek("kode lama: Stok & Lokasi (stokLokasi) berjalan tanpa galat dan mengembalikan seluruh bahan", !!hasil && Array.isArray(hasil.rows) && hasil.rows.length > 0, galat || `${hasil?.rows?.length} bahan`);
cek("kode lama: baris tidak memuat kolom foto (tidak tahu, tidak error)", !!hasil && hasil.rows.every((r) => !("fotoUrl" in r) && !("photoFile" in r)));
let semua = null; galat = "";
try { semua = await prisma.material.findMany({ take: 50 }); } catch (e) { galat = String(e?.message ?? e).slice(0, 200); }
cek("kode lama: prisma.material.findMany tidak terganggu kolom tak dikenal", Array.isArray(semua) && semua.length > 0, galat);
const kode = `REH-KOMPAT-${Date.now().toString(36)}`.toUpperCase(); let ok = false; galat = "";
try {
  const m = await prisma.material.create({ data: { code: kode, name: "Uji kompatibilitas kode lama (salinan)", unit: "PCS" } });
  await prisma.material.update({ where: { id: m.id }, data: { name: "Uji kompatibilitas kode lama (diubah)", reorderPoint: 3 } });
  const dibaca = await prisma.material.findUnique({ where: { id: m.id } });
  await prisma.material.delete({ where: { id: m.id } });
  ok = dibaca?.name?.endsWith("(diubah)") === true;
} catch (e) { galat = String(e?.message ?? e).slice(0, 200); }
cek("kode lama: membuat/mengubah/menghapus bahan tetap berfungsi (kolom foto nullable tanpa default tidak mengganggu INSERT/UPDATE)", ok, galat);
await prisma.$disconnect();
console.log(`\nRINGKASAN kompatibilitas kode lama: ${n} pemeriksaan, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
