// Jalankan sebelum `prisma migrate deploy`:
//   node scripts/verify-migration-history.js            (memakai DATABASE_URL, hanya SELECT)
//   node scripts/verify-migration-history.js --json f   (f = {"applied":[...],"indexes":[...]} untuk uji offline)
//   node scripts/verify-migration-history.js --sources-only   (tanpa DB: sumber migration wajib LF)
// Exit 0 hanya bila semua migration applied checksum-identik, ATAU satu-satunya beda adalah salah satu dari DUA pengecualian
// historis terdokumentasi (LID satu-baris; team_broadcast_contacts CRLF-applied). Pengecualian yang dipakai DICETAK eksplisit —
// hasilnya tidak pernah dilaporkan sebagai "tanpa drift". Migration pending tidak disentuh (diproses normal oleh migrate deploy).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readRepoMigrations, verifyMigrationHistory } from "../src/lib/migrationHistoryVerifier.js";

const dir = fileURLToPath(new URL("../prisma/migrations", import.meta.url));
// --sources-only: tanpa DB — HANYA memeriksa sumber migration LF (tanpa byte CR). Dipakai sebelum build/rilis agar rilis dari checkout CRLF tidak terulang.
if (process.argv.includes("--sources-only")) {
  const withCr = [...readRepoMigrations(dir)].filter(([, b]) => b.includes(13)).map(([n]) => n);
  for (const n of withCr) console.error(`GAGAL: ${n}: sumber migration mengandung CR — wajib LF`);
  console.log(withCr.length ? "sumber migration: GAGAL" : "sumber migration: LF semua (OK)");
  process.exit(withCr.length ? 1 : 0);
}
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
for (const e of r.exceptionDetails) console.log(`PENGECUALIAN HISTORIS DIPAKAI [${e.kind}]: ${e.migration} — ${e.detail}`);
for (const e of r.errors) console.error(`GAGAL: ${e}`);
console.log(r.ok ? (r.exceptionDetails.length ? `migration history: OK DENGAN ${r.exceptionDetails.length} PENGECUALIAN HISTORIS (bukan \"tanpa drift\"): ${r.exceptionDetails.map((e) => e.kind).join(", ")}` : "migration history: OK (tanpa pengecualian)") : "migration history: GAGAL");
process.exit(r.ok ? 0 : 1);
