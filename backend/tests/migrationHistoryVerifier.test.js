// Tes verifier riwayat migration — pengecualian LID harus sempit & fail-closed.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  EXCEPTION, sha256, readRepoMigrations, verifyMigrationHistory, isAllowedLidDiff,
} from "../src/lib/migrationHistoryVerifier.js";

const dir = fileURLToPath(new URL("../prisma/migrations", import.meta.url));
// Rilis dibangun dari checkout LF (blob git). Checkout Windows autocrlf memberi CRLF, jadi dinormalisasi di sini;
// verifier/CLI sendiri TETAP ketat (CRLF ditolak, lihat tes byte).
const lf = (b) => Buffer.from(b.toString("utf8").replaceAll("\r\n", "\n"), "utf8");
const repo = () => new Map([...readRepoMigrations(dir)].map(([n, b]) => [n, lf(b)]));
const IDX = ["LidMapping_lid_key", "LidMapping_pkey", "OrderWeightEntry_pkey"];
const fin = { finished_at: new Date(), rolled_back_at: null };
// DB "produksi": semua migration repo applied dengan checksum repo, kecuali LID = hash asli.
const prodRows = (m) => [...m].map(([n, b]) => ({
  migration_name: n, checksum: n === EXCEPTION.migration ? EXCEPTION.dbChecksum : sha256(b), ...fin,
}));

test("repo memuat berkas LID persis hash current yang diaudit", () => {
  assert.equal(sha256(repo().get(EXCEPTION.migration)), EXCEPTION.repoChecksum);
});

test("kondisi produksi nyata: lolos dengan tepat satu pengecualian", () => {
  const m = repo();
  const r = verifyMigrationHistory(m, prodRows(m), IDX);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.exceptions, [EXCEPTION.migration]);
});

test("migration pending/baru tidak dianggap error", () => {
  const m = repo();
  const rows = prodRows(m);
  m.set("99990101000000_disposable", Buffer.from("SELECT 1;\n"));
  const r = verifyMigrationHistory(m, rows, IDX);
  assert.equal(r.ok, true);
  assert.deepEqual(r.pending, ["99990101000000_disposable"]);
});

test("checksum migration LAIN berbeda -> gagal", () => {
  const m = repo();
  const rows = prodRows(m);
  const other = rows.find((x) => x.migration_name !== EXCEPTION.migration);
  other.checksum = "0".repeat(64);
  const r = verifyMigrationHistory(m, rows, IDX);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /TIDAK diizinkan/);
});

test("LID: checksum DB bukan hash asli -> gagal", () => {
  const m = repo();
  const rows = prodRows(m);
  rows.find((x) => x.migration_name === EXCEPTION.migration).checksum = "f".repeat(64);
  assert.equal(verifyMigrationHistory(m, rows, IDX).ok, false);
});

test("LID: perubahan satu byte pada file repo -> gagal", () => {
  const m = repo();
  const rows = prodRows(m);
  m.set(EXCEPTION.migration, Buffer.concat([m.get(EXCEPTION.migration), Buffer.from("\n")]));
  assert.equal(verifyMigrationHistory(m, rows, IDX).ok, false);
  const crlf = Buffer.from(repo().get(EXCEPTION.migration).toString().replace(/\n/g, "\r\n"));
  assert.equal(isAllowedLidDiff(crlf), false);
});

test("LID: file repo kembali ke hash asli -> cocok biasa, tanpa pengecualian", () => {
  const m = repo();
  const orig = m.get(EXCEPTION.migration).toString().replace(EXCEPTION.currentLine, EXCEPTION.originalLine);
  m.set(EXCEPTION.migration, Buffer.from(orig));
  const r = verifyMigrationHistory(m, prodRows(m).map((x) => (x.migration_name === EXCEPTION.migration ? { ...x, checksum: EXCEPTION.dbChecksum } : x)), IDX);
  assert.equal(r.ok, true);
  assert.deepEqual(r.exceptions, []);
});

test("invarian skema: index OrderWeightEntry_orderId_idx ada -> gagal", () => {
  const m = repo();
  const r = verifyMigrationHistory(m, prodRows(m), [...IDX, "OrderWeightEntry_orderId_idx"]);
  assert.equal(r.ok, false);
});

test("invarian skema: index LidMapping hilang -> gagal", () => {
  const m = repo();
  assert.equal(verifyMigrationHistory(m, prodRows(m), ["LidMapping_pkey"]).ok, false);
});

test("percobaan gagal yang sudah rolled_back (riwayat produksi nyata) diabaikan", () => {
  const m = repo();
  const rows = prodRows(m);
  rows.push({ migration_name: rows[0].migration_name, checksum: "e".repeat(64), finished_at: null, rolled_back_at: new Date() });
  assert.equal(verifyMigrationHistory(m, rows, IDX).ok, true);
});

test("migration applied yang hilang dari repo / tidak selesai -> gagal", () => {
  const m = repo();
  const rows = prodRows(m);
  rows.push({ migration_name: "20260101000000_hantu", checksum: "a".repeat(64), ...fin });
  assert.equal(verifyMigrationHistory(m, rows, IDX).ok, false);
  const rows2 = prodRows(m);
  rows2[0].finished_at = null;
  assert.equal(verifyMigrationHistory(m, rows2, IDX).ok, false);
});

test("migration normalisasi wajib ada dan checksum-nya normal saat pengecualian dipakai", () => {
  const m = repo();
  const name = EXCEPTION.normalization.migration;
  assert.equal(sha256(m.get(name)), EXCEPTION.normalization.checksum);
  assert.equal(m.get(name).toString("utf8"), 'DROP INDEX IF EXISTS "OrderWeightEntry_orderId_idx";\n');
  const rows = prodRows(m).filter((r) => r.migration_name !== name);
  const without = new Map(m); without.delete(name);
  assert.equal(verifyMigrationHistory(without, rows, IDX).ok, false);
  const changed = new Map(m); changed.set(name, Buffer.from("SELECT 1;\n"));
  assert.equal(verifyMigrationHistory(changed, rows, IDX).ok, false);
});

test("normalisasi berurutan setelah pembuat index (160000), LID, dan migration terbaru saat dibuat; tanpa pemilik lain", () => {
  const names = [...repo().keys()].sort();
  const n = names.indexOf(EXCEPTION.normalization.migration);
  assert.ok(n > names.indexOf("20260707160000_add_order_weight_entries"));
  assert.ok(n > names.indexOf(EXCEPTION.migration));
  assert.ok(n > names.indexOf("20260926090000_persediaan_awal_cutover")); // migration terbaru saat dibuat; yang lebih baru boleh menyusul
  const owners = names.filter((x) => /CREATE INDEX "OrderWeightEntry_orderId_idx"/.test(repo().get(x).toString()));
  assert.deepEqual(owners, ["20260707160000_add_order_weight_entries"]);
});
