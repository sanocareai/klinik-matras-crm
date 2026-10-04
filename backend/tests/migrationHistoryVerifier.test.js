// Tes verifier riwayat migration — pengecualian LID harus sempit & fail-closed.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  EXCEPTION, CRLF_EXCEPTION, sha256, readRepoMigrations, verifyMigrationHistory, isAllowedLidDiff, isAllowedCrlfDiff,
} from "../src/lib/migrationHistoryVerifier.js";

const dir = fileURLToPath(new URL("../prisma/migrations", import.meta.url));
// Rilis dibangun dari checkout LF (blob git). Checkout Windows autocrlf memberi CRLF, jadi dinormalisasi di sini;
// verifier/CLI sendiri TETAP ketat (CRLF ditolak, lihat tes byte).
const lf = (b) => Buffer.from(b.toString("utf8").replaceAll("\r\n", "\n"), "utf8");
const repo = () => new Map([...readRepoMigrations(dir)].map(([n, b]) => [n, lf(b)]));
const IDX = ["LidMapping_lid_key", "LidMapping_pkey", "OrderWeightEntry_pkey"];
const fin = { finished_at: new Date(), rolled_back_at: null };
// DB "produksi": semua migration repo applied dengan checksum repo, kecuali LID = hash asli dan team_broadcast_contacts = hash versi CRLF (diterapkan dari working tree CRLF).
const prodRows = (m) => [...m].map(([n, b]) => ({
  migration_name: n, checksum: n === EXCEPTION.migration ? EXCEPTION.dbChecksum : n === CRLF_EXCEPTION.migration ? CRLF_EXCEPTION.dbChecksumCrlf : sha256(b), ...fin,
}));

test("repo memuat berkas LID persis hash current yang diaudit", () => {
  assert.equal(sha256(repo().get(EXCEPTION.migration)), EXCEPTION.repoChecksum);
});

test("kondisi produksi nyata: lolos dengan tepat DUA pengecualian historis (LID + CRLF), dilaporkan eksplisit", () => {
  const m = repo();
  const r = verifyMigrationHistory(m, prodRows(m), IDX);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.exceptions, [EXCEPTION.migration, CRLF_EXCEPTION.migration]);
  assert.deepEqual(r.exceptionDetails.map((e) => e.kind), ["LID_ONE_LINE", "CRLF_APPLIED"]);
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
  assert.deepEqual(r.exceptions, [CRLF_EXCEPTION.migration]); // hanya pengecualian CRLF yang tersisa
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

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Pengecualian #2 (Owner, 4 Okt 2026): 20261007110000_team_broadcast_contacts — DB menyimpan checksum versi CRLF, repo LF kanonis.
// Sempit & ber-pin hash penuh: hanya pasangan persis ini yang lulus; selain itu gagal.
// ---------------------------------------------------------------------------------------------------------------------------------------------
const crlfOf = (buf) => Buffer.from(buf.toString("utf8").replaceAll("\n", "\r\n"), "utf8");
const BC = CRLF_EXCEPTION.migration;
const rowOf = (rows, name) => rows.find((r) => r.migration_name === name);

test("CRLF: pin memakai SHA-256 penuh (64 hex), bukan prefix; repo memuat berkas LF ber-pin dan konversi LF->CRLF = checksum applied", () => {
  assert.match(CRLF_EXCEPTION.repoChecksumLf, /^[0-9a-f]{64}$/); assert.match(CRLF_EXCEPTION.dbChecksumCrlf, /^[0-9a-f]{64}$/);
  const buf = repo().get(BC);
  assert.equal(sha256(buf), CRLF_EXCEPTION.repoChecksumLf);
  assert.equal(buf.includes(13), false, "berkas repo LF kanonis (tanpa CR)");
  assert.equal(sha256(crlfOf(buf)), CRLF_EXCEPTION.dbChecksumCrlf);
  assert.equal(isAllowedCrlfDiff(buf), true);
});

test("CRLF: pasangan sah (repo LF + DB CRLF, selesai & tidak rolled back) lulus DAN dilaporkan sebagai pengecualian, bukan 'tanpa drift'", () => {
  const m = repo();
  const r = verifyMigrationHistory(m, prodRows(m), IDX);
  assert.equal(r.ok, true);
  assert.ok(r.exceptions.includes(BC));
  assert.equal(r.exceptionDetails.find((e) => e.migration === BC).kind, "CRLF_APPLIED");
});

test("CRLF: perubahan SQL (satu byte, spasi, baris) pada berkas repo -> gagal", () => {
  for (const mutate of [(b) => Buffer.concat([b, Buffer.from(" ")]), (b) => Buffer.concat([b, Buffer.from("\n")]), (b) => Buffer.from(b.toString("utf8").replace("CREATE", "CREATE ")), (b) => b.subarray(0, b.length - 1)]) {
    const m = repo(); const rows = prodRows(m);
    m.set(BC, mutate(m.get(BC)));
    const r = verifyMigrationHistory(m, rows, IDX);
    assert.equal(r.ok, false); assert.match(r.errors.join("|"), /checksum drift TIDAK diizinkan/);
    assert.equal(r.exceptions.includes(BC), false);
  }
});

test("CRLF: checksum applied lain (bukan hash CRLF ber-pin) -> gagal, termasuk beda satu karakter dan prefix saja", () => {
  for (const bad of ["0".repeat(64), CRLF_EXCEPTION.dbChecksumCrlf.slice(0, 63) + "0", CRLF_EXCEPTION.dbChecksumCrlf.slice(0, 8)]) {
    const m = repo(); const rows = prodRows(m); rowOf(rows, BC).checksum = bad;
    const r = verifyMigrationHistory(m, rows, IDX);
    assert.equal(r.ok, false, bad); assert.equal(r.exceptions.includes(BC), false);
  }
});

test("CRLF: migration LAIN dengan pola yang sama (checksum DB = konversi CRLF dari repo-nya) tetap gagal — bukan allowlist umum", () => {
  const m = repo(); const rows = prodRows(m);
  const other = [...m.keys()].find((n) => n !== BC && n !== EXCEPTION.migration && !n.startsWith("20260926140000"));
  rowOf(rows, other).checksum = sha256(crlfOf(m.get(other)));
  const r = verifyMigrationHistory(m, rows, IDX);
  assert.equal(r.ok, false); assert.match(r.errors.join("|"), new RegExp(`${other}: checksum drift TIDAK diizinkan`));
  assert.equal(isAllowedCrlfDiff(m.get(other)), false);
});

test("CRLF: baris applied tidak selesai -> gagal; baris rolled back diabaikan dan pengecualian TIDAK dipakai", () => {
  const m = repo(); const rows = prodRows(m); rowOf(rows, BC).finished_at = null;
  const r = verifyMigrationHistory(m, rows, IDX);
  assert.equal(r.ok, false); assert.match(r.errors.join("|"), /percobaan menggantung/); assert.equal(r.exceptions.includes(BC), false);
  const m2 = repo(); const rows2 = prodRows(m2); rowOf(rows2, BC).rolled_back_at = new Date();
  const r2 = verifyMigrationHistory(m2, rows2, IDX);
  assert.equal(r2.exceptions.includes(BC), false); assert.ok(r2.pending.includes(BC), "rolled back = pending, bukan applied");
});

test("CRLF: berkas repo ber-CR (working tree CRLF) -> gagal, walau hash CRLF-nya sama dengan checksum applied", () => {
  const m = repo(); const rows = prodRows(m);
  m.set(BC, crlfOf(m.get(BC)));
  assert.equal(sha256(m.get(BC)), CRLF_EXCEPTION.dbChecksumCrlf, "cocok biasa pun ditolak oleh pemeriksaan sumber LF");
  const r = verifyMigrationHistory(m, rows, IDX);
  assert.equal(r.ok, false); assert.match(r.errors.join("|"), /sumber migration mengandung CR/);
  assert.equal(isAllowedCrlfDiff(m.get(BC)), false);
});

test("CRLF: bila checksum DB kelak diperbaiki ke hash LF repo -> cocok biasa, pengecualian tidak dipakai (tidak ada jalur diam-diam)", () => {
  const m = repo(); const rows = prodRows(m); rowOf(rows, BC).checksum = sha256(m.get(BC));
  const r = verifyMigrationHistory(m, rows, IDX);
  assert.equal(r.ok, true); assert.equal(r.exceptions.includes(BC), false);
});

test("sumber migration: SELURUH berkas migration di repo LF (tanpa byte CR) — mencegah rilis dari working tree CRLF terulang", () => {
  const bad = [...readRepoMigrations(dir)].filter(([, b]) => b.includes(13)).map(([n]) => n);
  assert.deepEqual(bad, [], "migration ber-CR (autocrlf?). .gitattributes harus memaksa eol=lf untuk migration.sql");
});

test("CLI: pengecualian historis dicetak eksplisit; tidak pernah menyatakan 'tanpa pengecualian' saat dipakai", async () => {
  const { spawnSync } = await import("node:child_process");
  const { writeFileSync, mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  const tmp = mkdtempSync(join(tmpdir(), "mig-verify-"));
  try {
    const m = repo();
    const file = join(tmp, "db.json");
    const payload = () => ({ applied: prodRows(m).map((r) => ({ ...r, finished_at: r.finished_at.toISOString() })), indexes: IDX });
    writeFileSync(file, JSON.stringify(payload()));
    const cli = fileURLToPath(new URL("../scripts/verify-migration-history.js", import.meta.url));
    const out = spawnSync(process.execPath, [cli, "--json", file], { encoding: "utf8" });
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /PENGECUALIAN HISTORIS DIPAKAI \[CRLF_APPLIED\]: 20261007110000_team_broadcast_contacts/);
    assert.match(out.stdout, /PENGECUALIAN HISTORIS DIPAKAI \[LID_ONE_LINE\]/);
    assert.match(out.stdout, /OK DENGAN 2 PENGECUALIAN HISTORIS/);
    assert.doesNotMatch(out.stdout, /tanpa pengecualian/);
    const bad = payload();
    bad.applied.find((r) => r.migration_name === BC).checksum = "0".repeat(64);
    writeFileSync(file, JSON.stringify(bad));
    const out2 = spawnSync(process.execPath, [cli, "--json", file], { encoding: "utf8" });
    assert.equal(out2.status, 1); assert.match(out2.stdout, /migration history: GAGAL/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("CLI --sources-only: LF semua -> exit 0 tanpa DB; .gitattributes memaksa eol=lf untuk migration.sql", async () => {
  const { spawnSync } = await import("node:child_process");
  const { readFileSync } = await import("node:fs");
  const cli = fileURLToPath(new URL("../scripts/verify-migration-history.js", import.meta.url));
  const out = spawnSync(process.execPath, [cli, "--sources-only"], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /sumber migration: LF semua/);
  const attrs = readFileSync(fileURLToPath(new URL("../../.gitattributes", import.meta.url)), "utf8");
  assert.match(attrs, /^backend\/prisma\/migrations\/\*\*\/migration\.sql text eol=lf$/m);
});
