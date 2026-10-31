// Rekonsiliasi foto bahan: membandingkan kolom materials.photo_file (database) dengan berkas di folder foto. BACA-SAJA — tidak mengubah database maupun berkas.
//
//   docker compose exec backend node scripts/rekonsiliasi-foto-bahan.mjs
//
// Dipakai setelah PEMULIHAN (database dipulihkan dari backup tanpa/dengan berkas foto, atau sebaliknya):
//   • "baris tanpa berkas"  = bahan yang menunjuk foto yang tidak ada di folder → aplikasi menampilkan ikon/petunjuk "Foto belum bisa dimuat"; bahan itu cukup diunggah ulang fotonya. Tidak merusak apa pun.
//   • "berkas yatim"        = berkas di folder yang tidak dirujuk baris mana pun → tidak disajikan siapa pun (hanya berkas yang dirujuk daftar bahan yang diberi URL); aman dibiarkan, atau dihapus MANUAL
//                             setelah dicocokkan dengan daftar ini. Skrip ini sendiri tidak menghapus apa pun.
//   • "nama tidak valid"    = nilai kolom yang bukan nama berkas fitur ini (tidak pernah disajikan atau dihapus oleh aplikasi).
// Kode keluar: 0 = konsisten; 3 = ada selisih (laporan di atas). Bukan kegagalan skrip.
import fs from "node:fs";
import { prisma } from "../src/db.js";
import { FOTO_BAHAN_DIR, NAMA_VALID, namaThumb, milikBahan } from "../src/services/fotoBahan.js";

const baris = await prisma.$queryRaw`SELECT id::text AS id, code, photo_file AS "photoFile" FROM materials WHERE photo_file IS NOT NULL ORDER BY code`;
const ada = fs.existsSync(FOTO_BAHAN_DIR) ? new Set(fs.readdirSync(FOTO_BAHAN_DIR)) : new Set();
const dirujuk = new Set(); const tanpaBerkas = []; const tidakValid = [];
for (const b of baris) {
  if (!milikBahan(b.photoFile, b.id)) { tidakValid.push(b); continue; }
  dirujuk.add(b.photoFile); dirujuk.add(namaThumb(b.photoFile));
  const hilang = [b.photoFile, namaThumb(b.photoFile)].filter((f) => !ada.has(f));
  if (hilang.length) tanpaBerkas.push({ ...b, hilang });
}
const yatim = [...ada].filter((f) => !dirujuk.has(f)).sort();
console.log(JSON.stringify({ folder: FOTO_BAHAN_DIR, barisBerfoto: baris.length, berkasDiFolder: ada.size, barisTanpaBerkas: tanpaBerkas.length, berkasYatim: yatim.length, namaTidakValid: tidakValid.length }));
for (const b of tanpaBerkas) console.log(`BARIS TANPA BERKAS  ${b.code}  ${b.id}  hilang: ${b.hilang.join(", ")}`);
for (const f of yatim) console.log(`BERKAS YATIM        ${f}`);
for (const b of tidakValid) console.log(`NAMA TIDAK VALID    ${b.code}  ${b.id}  ${String(b.photoFile).slice(0, 80)}`);
void NAMA_VALID;
await prisma.$disconnect();
process.exit(tanpaBerkas.length || yatim.length || tidakValid.length ? 3 : 0);
