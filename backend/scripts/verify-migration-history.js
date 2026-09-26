// Jalankan sebelum `prisma migrate deploy`:
//   node scripts/verify-migration-history.js            (memakai DATABASE_URL, hanya SELECT)
//   node scripts/verify-migration-history.js --json f   (f = {"applied":[...],"indexes":[...]} untuk uji offline)
// Exit 0 hanya bila semua migration applied checksum-identik, ATAU satu-satunya beda adalah pengecualian
// LID yang terdokumentasi. Migration pending tidak disentuh (diproses normal oleh migrate deploy).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readRepoMigrations, verifyMigrationHistory } from "../src/lib/migrationHistoryVerifier.js";

const dir = fileURLToPath(new URL("../prisma/migrations", import.meta.url));
const jsonAt = process.argv.indexOf("--json");
let applied, indexes;
if (jsonAt > 0) {
  ({ applied, indexes } = JSON.parse(readFileSync(process.argv[jsonAt + 1], "utf8")));
} else {
  const { PrismaClient } = await import("@prisma/client");
  const p = new PrismaClient();
  try {
    applied = await p.$queryRawUnsafe(
      "SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name"
    );
    indexes = (await p.$queryRawUnsafe("SELECT indexname FROM pg_indexes WHERE schemaname='public'")).map((r) => r.indexname);
  } finally {
    await p.$disconnect();
  }
}
const r = verifyMigrationHistory(readRepoMigrations(dir), applied, indexes);
console.log(`migration applied diperiksa: ${r.checked}; pending: ${r.pending.length ? r.pending.join(", ") : "-"}`);
for (const e of r.exceptions) console.log(`PENGECUALIAN HISTORIS (terdokumentasi): ${e}`);
for (const e of r.errors) console.error(`GAGAL: ${e}`);
console.log(r.ok ? "migration history: OK" : "migration history: GAGAL");
process.exit(r.ok ? 0 : 1);
