// Seed referensi ruas tol Jabodetabek (8 September 2026, permintaan owner:
// "tracking driver lewat jalan mana aja... tol mana aja, dan akumulasi
// biayanya"). Data REFERENSI, bukan transaksional — dijalankan sekali (atau
// diulang kalau daftar/tarif perlu diperbarui, script ini upsert by name
// jadi aman dijalankan berkali-kali).
//
// SUMBER DATA (lihat scripts/data/toll-roads-jabodetabek.json untuk detail
// per baris):
//   - geometry: OpenStreetMap via Overpass API (way bertag toll=yes,
//     bounding box Jabodetabek -6.65,106.55,-6.05,107.05), diambil 8
//     September 2026. Bentuk jalan OBJEKTIF dari data peta terbuka, BUKAN
//     digambar manual — didesimasi (~1 titik/150m) supaya ukuran wajar
//     untuk pengecekan jarak titik-ke-jalur, bukan presisi lane-level.
//   - estimatedFareGol1: tarif Golongan I (mobil pribadi/pikap/bus kecil)
//     dari sumber yang mengutip BPJT (Badan Pengatur Jalan Tol), dicek
//     lewat web search 8 September 2026 — field `source`/`verifiedAt` per
//     baris mencatat PERSIS kapan & dari mana, supaya kalau tarif naik
//     nanti, admin tahu data ini sudah basi, bukan angka mengambang tanpa
//     asal. INI PERKIRAAN, bukan hasil cek langsung ke bpjt.pu.go.id/
//     aplikasi e-Toll — kalau butuh presisi lebih tinggi, verifikasi ulang
//     manual sebelum dipakai untuk keputusan finansial.
//
// CAKUPAN SENGAJA TERBATAS: 8 ruas utama Jabodetabek (area operasional
// nyata — lihat kota-kota di data produksi: Jakarta Barat/Timur/Utara/
// Selatan/Pusat, Tangerang, Bekasi, Depok, Bogor), BUKAN seluruh Indonesia.
//
// PEMAKAIAN (dry-run dulu):
//   docker compose exec backend node scripts/seed-toll-roads.js
//   docker compose exec backend node scripts/seed-toll-roads.js --apply

import { prisma } from "../src/db.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "DRY-RUN (cuma pratinjau)"}\n`);

  const dataPath = path.join(__dirname, "data", "toll-roads-jabodetabek.json");
  const rows = JSON.parse(readFileSync(dataPath, "utf8"));

  console.log(`${rows.length} ruas tol ditemukan di data seed:\n`);
  for (const r of rows) {
    console.log(`  ${r.name} — Rp${r.estimatedFareGol1.toLocaleString("id-ID")} (${r.geometry.length} titik geometri)`);
  }

  if (!APPLY) {
    console.log("\nJalankan ulang dengan --apply untuk benar-benar menulis ke database.");
    return;
  }

  for (const r of rows) {
    await prisma.tollRoad.upsert({
      where: { name: r.name },
      update: {
        geometry: r.geometry,
        estimatedFareGol1: r.estimatedFareGol1,
        source: r.source,
        verifiedAt: new Date(r.verifiedAt),
        active: true,
      },
      create: {
        name: r.name,
        geometry: r.geometry,
        estimatedFareGol1: r.estimatedFareGol1,
        source: r.source,
        verifiedAt: new Date(r.verifiedAt),
      },
    });
    console.log(`${r.name}: tersimpan.`);
  }
  console.log(`\nSelesai — ${rows.length} ruas tol di-upsert.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
