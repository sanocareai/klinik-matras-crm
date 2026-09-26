// Verifier riwayat migration — SATU pengecualian checksum historis, sempit dan fail-closed.
//
// Latar: 20260707130141_add_lid_mapping diterapkan di produksi dengan isi ASLI (commit 279dda7f).
// Commit 0019ff81 kemudian mengubah SATU baris (`DROP INDEX` -> `DROP INDEX IF EXISTS`) agar bootstrap
// DB kosong tidak gagal (index itu baru dibuat migration 20260707160000 yang urutannya SETELAH file ini;
// di produksi urutan terapannya terbalik). Hasilnya checksum repo != checksum _prisma_migrations.
// Lihat docs/MIGRATION-HISTORY-LID-MAPPING-EXCEPTION.md.
//
// Ini BUKAN allowlist umum: semua kondisi di bawah harus cocok persis, selain itu -> gagal.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const EXCEPTION = Object.freeze({
  migration: "20260707130141_add_lid_mapping",
  dbChecksum: "0fd0fc382fa921b9afea7d5ba89aec885946a174223e549ae122ca4e74d6b24d", // blob asli 279dda7f
  repoChecksum: "0c718a28653672313df578f43dc824233f7bd2bde203c298ad106a48665a937f", // blob HEAD d1ea493a
  originalLine: 'DROP INDEX "OrderWeightEntry_orderId_idx";',
  currentLine: 'DROP INDEX IF EXISTS "OrderWeightEntry_orderId_idx";',
  // Migration normalisasi WAJIB ada di repo (menyamakan hasil chain bersih dengan produksi): hanya DROP INDEX IF EXISTS.
  normalization: Object.freeze({
    migration: "20260926140000_normalize_order_weight_entry_index",
    checksum: "630591e4fcfac47cc42d8ed7b82aea2c857f2604b4d54be1fac0ee21f4bac618",
  }),
  absentIndexes: Object.freeze(["OrderWeightEntry_orderId_idx"]),
  requiredIndexes: Object.freeze(["LidMapping_lid_key", "LidMapping_pkey"]),
});

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

export function readRepoMigrations(dir) {
  const out = new Map();
  for (const name of readdirSync(dir).sort()) {
    const f = join(dir, name, "migration.sql");
    if (/^\d{14}_/.test(name) && existsSync(f)) out.set(name, readFileSync(f));
  }
  return out;
}

// Beda semantik = tepat SATU baris, dan pasangannya persis (asli -> current); sisa byte identik.
// Merekonstruksi berkas asli dari file repo lalu mencocokkan hash-nya = bukti byte-exact.
export function isAllowedLidDiff(repoBuf) {
  const text = repoBuf.toString("utf8");
  if (text.includes("\r")) return false;
  const lines = text.split("\n");
  const hits = lines.reduce((a, l, i) => (l === EXCEPTION.currentLine ? [...a, i] : a), []);
  if (hits.length !== 1) return false;
  lines[hits[0]] = EXCEPTION.originalLine;
  return sha256(Buffer.from(lines.join("\n"), "utf8")) === EXCEPTION.dbChecksum;
}

/**
 * @param {Map<string, Buffer>} repo  nama -> isi migration.sql
 * @param {{migration_name:string, checksum:string, finished_at:any, rolled_back_at:any}[]} applied  baris _prisma_migrations
 * @param {string[]} indexNames nama index di skema produksi (public)
 * @returns {{ok:boolean, errors:string[], exceptions:string[], pending:string[], checked:number}}
 */
export function verifyMigrationHistory(repo, applied, indexNames) {
  const errors = [];
  const exceptions = [];
  // Baris rolled_back (percobaan gagal yang sudah di-resolve) diabaikan Prisma; yang berbahaya = menggantung.
  const live = applied.filter((r) => !r.rolled_back_at);
  const done = live.filter((r) => r.finished_at);
  for (const r of live) if (!r.finished_at) errors.push(`${r.migration_name}: percobaan menggantung (belum selesai, belum rolled back)`);
  const doneNames = new Set(done.map((r) => r.migration_name));
  for (const r of done) {
    const buf = repo.get(r.migration_name);
    if (!buf) { errors.push(`${r.migration_name}: applied di DB tapi tidak ada di repo`); continue; }
    const repoSum = sha256(buf);
    if (repoSum === r.checksum) continue;
    if (
      r.migration_name === EXCEPTION.migration &&
      r.checksum === EXCEPTION.dbChecksum &&
      repoSum === EXCEPTION.repoChecksum &&
      isAllowedLidDiff(buf)
    ) {
      exceptions.push(r.migration_name);
      continue;
    }
    errors.push(`${r.migration_name}: checksum drift TIDAK diizinkan (db=${r.checksum.slice(0, 8)} repo=${repoSum.slice(0, 8)})`);
  }
  if (exceptions.length) {
    const nb = repo.get(EXCEPTION.normalization.migration);
    if (!nb) errors.push(`migration normalisasi ${EXCEPTION.normalization.migration} wajib ada di repo`);
    else if (sha256(nb) !== EXCEPTION.normalization.checksum) errors.push("migration normalisasi: checksum repo tidak normal");
    const idx = new Set(indexNames);
    for (const n of EXCEPTION.absentIndexes) if (idx.has(n)) errors.push(`invarian: index ${n} seharusnya TIDAK ada di produksi`);
    for (const n of EXCEPTION.requiredIndexes) if (!idx.has(n)) errors.push(`invarian: index ${n} wajib ada`);
  }
  const pending = [...repo.keys()].filter((n) => !doneNames.has(n));
  return { ok: errors.length === 0, errors, exceptions, pending, checked: done.length };
}
