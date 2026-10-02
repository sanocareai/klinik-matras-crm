// Verifier riwayat migration — DUA pengecualian checksum historis, masing-masing sempit dan fail-closed (tanpa wildcard).
//   1. 20260707130141_add_lid_mapping            — beda SATU baris SQL (lihat di bawah).
//   2. 20261007110000_team_broadcast_contacts    — beda HANYA line ending (CRLF diterapkan, repo LF); lihat CRLF_EXCEPTION.
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

// Pengecualian 2 — provenance (docs/MIGRATION-HISTORY-BROADCAST-TEAM-CRLF-EXCEPTION.md): rilis Broadcast Team (d81ab104, 2026-10-01) dibangun dari
// salinan kerja Windows, sehingga image-nya membawa migration ini dengan CRLF (2089 byte, 31 CR) dan itulah yang dicatat Prisma di
// _prisma_migrations. Blob git SATU-SATUNYA versi (LF, 2058 byte). Isi SQL identik; uji clean 0->latest & upgrade dari backup: skema dan data identik.
// Kondisi lulus: nama persis + checksum DB persis + checksum repo persis + berkas repo tanpa CR yang, bila SEMUA LF diganti CRLF, ber-SHA-256
// persis checksum DB (bukti byte-exact bahwa bedanya hanya line ending). Salah satu berubah -> GAGAL.
export const CRLF_EXCEPTION = Object.freeze({
  migration: "20261007110000_team_broadcast_contacts",
  dbChecksum: "ed5e993401ab55c0855299a3e7fda2bc3c5e198cd5fcaf1965390e62a9ed82bd", // CRLF, 2089 byte (image rilis d81ab104)
  repoChecksum: "a61efcfadb06f1c0151de5f8a842aaec25c1955cdd030c917e82b8f05f584395", // LF, 2058 byte (blob git 738882fd)
  repoBlob: "738882fd19351e9038e44a5028a4c00b527d54f9",
  originatingCommit: "d81ab104d4decd76bd1c2361436921465155291f",
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

// Beda hanya line ending: berkas repo tanpa CR; mengganti setiap LF dengan CRLF menghasilkan byte yang checksum-nya = checksum DB.
export function isAllowedCrlfDiff(repoBuf) {
  const text = repoBuf.toString("utf8");
  if (text.includes("\r")) return false;
  return sha256(Buffer.from(text.replaceAll("\n", "\r\n"), "utf8")) === CRLF_EXCEPTION.dbChecksum;
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
  let lidUsed = false; // invarian LID (migration normalisasi, indeks) hanya diwajibkan bila pengecualian LID dipakai
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
      lidUsed = true;
      continue;
    }
    if (
      r.migration_name === CRLF_EXCEPTION.migration &&
      r.checksum === CRLF_EXCEPTION.dbChecksum &&
      repoSum === CRLF_EXCEPTION.repoChecksum &&
      isAllowedCrlfDiff(buf)
    ) {
      exceptions.push(r.migration_name);
      continue;
    }
    errors.push(`${r.migration_name}: checksum drift TIDAK diizinkan (db=${r.checksum.slice(0, 8)} repo=${repoSum.slice(0, 8)})`);
  }
  if (lidUsed) {
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
