// Script migrasi satu kali: pindahkan isi backend/data/templates.json (file
// JSON polos, tanpa kepemilikan) ke tabel MessageTemplate (Postgres) sebagai
// template TIM (isShared=true, authorId=null) — supaya template lama yang
// sudah dipakai sehari-hari (Salam Pembuka, Follow Up, dst) tidak hilang
// begitu saja saat pindah ke skema kepemilikan baru.
//
// IDEMPOTENT: aman dijalankan berkali-kali — template yang `nama`-nya SUDAH
// ada di database (persis sama) dilewati, bukan diduplikasi.
//
// Cara pakai:
//   node scripts/migrate-templates-json.js
// atau dari Docker:
//   docker compose exec backend node scripts/migrate-templates-json.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "../data/templates.json");

async function main() {
  let lama;
  try {
    lama = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    console.log("Tidak ada backend/data/templates.json (atau kosong) — tidak ada yang dimigrasi.");
    return;
  }

  if (!Array.isArray(lama) || lama.length === 0) {
    console.log("templates.json kosong — tidak ada yang dimigrasi.");
    return;
  }

  const existing = await prisma.messageTemplate.findMany({ select: { nama: true } });
  const existingNames = new Set(existing.map((t) => t.nama));

  let migrated = 0, skipped = 0;
  for (const t of lama) {
    if (!t.nama?.trim() || !t.isi?.trim()) { skipped++; continue; }
    if (existingNames.has(t.nama.trim())) {
      console.log(`  - Lewati "${t.nama}" (sudah ada di database)`);
      skipped++;
      continue;
    }
    await prisma.messageTemplate.create({
      data: {
        nama: t.nama.trim(),
        kategori: t.kategori || "lainnya",
        isi: t.isi.trim(),
        isShared: true, // template lama = template company/tim
        authorId: null,
      },
    });
    console.log(`  ✓ "${t.nama}" → Template Tim`);
    migrated++;
  }

  console.log(`\nSelesai. ${migrated} template dipindah ke database, ${skipped} dilewati.`);
  console.log("File backend/data/templates.json TIDAK dihapus (biarkan sebagai arsip/backup).");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
