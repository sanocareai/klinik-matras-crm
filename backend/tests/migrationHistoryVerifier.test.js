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
// DB "produksi": semua migration repo applied dengan checksum repo, kecuali LID = hash asli dan Broadcast Team = hash CRLF yang diterapkan.
const prodRows = (m) => [...m].map(([n, b]) => ({
  migration_name: n, checksum: n === EXCEPTION.migration ? EXCEPTION.dbChecksum : n === CRLF_EXCEPTION.migration ? CRLF_EXCEPTION.dbChecksum : sha256(b), ...fin,
}));

test("repo memuat berkas LID persis hash current yang diaudit", () => {
  assert.equal(sha256(repo().get(EXCEPTION.migration)), EXCEPTION.repoChecksum);
});

test("kondisi produksi nyata: lolos dengan tepat DUA pengecualian bernama (LID dan Broadcast Team CRLF)", () => {
  const m = repo();
  const r = verifyMigrationHistory(m, prodRows(m), IDX);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.exceptions, [EXCEPTION.migration, CRLF_EXCEPTION.migration]);
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
  assert.deepEqual(r.exceptions, [CRLF_EXCEPTION.migration], "LID tak lagi memakai pengecualian; hanya pengecualian CRLF (independen) yang tersisa");
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

// ---------------------------------------------------------------------------------------------------------------------------------------
// Pengecualian 2: 20261007110000_team_broadcast_contacts (diterapkan CRLF, repo LF). Sempit, fail-closed, tanpa wildcard.
// ---------------------------------------------------------------------------------------------------------------------------------------
const BC = CRLF_EXCEPTION.migration;
const crlfOf = (buf) => Buffer.from(buf.toString("utf8").replaceAll("\n", "\r\n"), "utf8");

test("CRLF: berkas repo persis checksum yang diaudit; rekonstruksi CRLF = checksum DB (bukti byte-exact; beda hanya line ending)", () => {
  const buf = repo().get(BC);
  assert.equal(sha256(buf), CRLF_EXCEPTION.repoChecksum); assert.equal(buf.length, 2058);
  assert.equal(buf.toString("utf8").includes("\r"), false);
  const crlf = crlfOf(buf);
  assert.equal(sha256(crlf), CRLF_EXCEPTION.dbChecksum); assert.equal(crlf.length, 2089); assert.equal((crlf.toString("utf8").match(/\r\n/g) || []).length, 31);
  assert.equal(isAllowedCrlfDiff(buf), true);
});

test("CRLF: tanpa pengecualian ini verifier GAGAL (reproduksi masalah awal); dengan pengecualian lolos dan tercatat", () => {
  const m = repo(); const rows = prodRows(m);
  const ok = verifyMigrationHistory(m, rows, IDX); assert.equal(ok.ok, true); assert.ok(ok.exceptions.includes(BC));
  // Simulasi verifier lama: checksum DB CRLF vs repo LF tanpa pengecualian = drift (dicek lewat nama lain yang tidak dikecualikan)
  const renamed = new Map(m); renamed.set("20990101000000_salinan", m.get(BC));
  const r2 = prodRows(renamed); r2.find((x) => x.migration_name === "20990101000000_salinan").checksum = CRLF_EXCEPTION.dbChecksum;
  const bad = verifyMigrationHistory(renamed, r2, IDX);
  assert.equal(bad.ok, false); assert.match(bad.errors.join("\n"), /20990101000000_salinan: checksum drift TIDAK diizinkan/);
});

test("CRLF tamper: checksum DB berbeda satu karakter -> gagal", () => {
  const m = repo(); const rows = prodRows(m);
  const row = rows.find((x) => x.migration_name === BC); row.checksum = row.checksum.replace(/.$/, row.checksum.endsWith("d") ? "e" : "d");
  const r = verifyMigrationHistory(m, rows, IDX); assert.equal(r.ok, false); assert.match(r.errors[0], new RegExp(BC));
});

test("CRLF tamper: isi repo berubah (satu byte / tambah baris / spasi) -> gagal, walau checksum DB benar", () => {
  for (const mutate of [(b) => Buffer.concat([b, Buffer.from("\n")]), (b) => Buffer.from(b.toString("utf8").replace("ADD COLUMN", "ADD  COLUMN")), (b) => Buffer.from(b.toString("utf8").replace(/\n$/, "")), (b) => Buffer.from(b.toString("utf8").replace("'DELIVERY'", "'delivery'"))]) {
    const m = repo(); m.set(BC, mutate(m.get(BC)));
    const r = verifyMigrationHistory(m, prodRows(m), IDX); assert.equal(r.ok, false); assert.equal(r.exceptions.includes(BC), false);
  }
});

test("CRLF: file repo yang ber-CR (checkout autocrlf / commit CRLF) tidak memakai pengecualian — sama persis dengan DB -> lolos biasa, atau gagal bila bukan", () => {
  const m = repo(); const crlf = crlfOf(m.get(BC)); m.set(BC, crlf);
  assert.equal(isAllowedCrlfDiff(crlf), false, "pengecualian hanya untuk repo tanpa CR");
  const r = verifyMigrationHistory(m, prodRows(m), IDX);
  assert.equal(r.ok, true, "checksum repo CRLF == checksum DB -> cocok biasa"); assert.equal(r.exceptions.includes(BC), false);
  const mixed = Buffer.from(repo().get(BC).toString("utf8").replace("\n", "\r\n")); m.set(BC, mixed);
  assert.equal(verifyMigrationHistory(m, prodRows(m), IDX).ok, false);
});

test("CRLF bukan wildcard: migration lain dengan beda line ending yang sama TIDAK diterima; nama lain dengan checksum DB yang sama ditolak", () => {
  const m = repo(); const rows = prodRows(m);
  const other = [...m.keys()].find((n) => n !== BC && n !== EXCEPTION.migration && !/^2026100711/.test(n));
  const orig = rows.find((x) => x.migration_name === other); orig.checksum = sha256(crlfOf(m.get(other)));
  const r = verifyMigrationHistory(m, rows, IDX); assert.equal(r.ok, false); assert.match(r.errors[0], new RegExp(other));
  // checksum DB pengecualian dipakai migration lain -> ditolak (nama tidak cocok)
  const rows2 = prodRows(m); rows2.find((x) => x.migration_name === other).checksum = CRLF_EXCEPTION.dbChecksum;
  assert.equal(verifyMigrationHistory(m, rows2, IDX).ok, false);
  // pengecualian BC tidak meloloskan drift pada migration BC bila DB memakai checksum LID
  const rows3 = prodRows(m); rows3.find((x) => x.migration_name === BC).checksum = EXCEPTION.dbChecksum;
  assert.equal(verifyMigrationHistory(m, rows3, IDX).ok, false);
});

test("pengecualian LID tetap bekerja dan tidak menjadi wildcard setelah ada pengecualian kedua; keduanya independen", () => {
  const m = repo();
  // LID saja (DB Broadcast = checksum repo LF): lolos, hanya LID tercatat, invarian LID tetap ditegakkan
  const rowsLid = prodRows(m).map((x) => (x.migration_name === BC ? { ...x, checksum: CRLF_EXCEPTION.repoChecksum } : x));
  const a = verifyMigrationHistory(m, rowsLid, IDX); assert.equal(a.ok, true); assert.deepEqual(a.exceptions, [EXCEPTION.migration]);
  assert.equal(verifyMigrationHistory(m, rowsLid, [...IDX, "OrderWeightEntry_orderId_idx"]).ok, false, "invarian LID tetap berlaku");
  // CRLF saja (LID cocok biasa): lolos tanpa menuntut invarian LID (index LID boleh tidak ada di daftar)
  const orig = new Map(m); orig.set(EXCEPTION.migration, Buffer.from(m.get(EXCEPTION.migration).toString().replace(EXCEPTION.currentLine, EXCEPTION.originalLine)));
  const rowsCrlf = prodRows(orig).map((x) => (x.migration_name === EXCEPTION.migration ? { ...x, checksum: EXCEPTION.dbChecksum } : x));
  const b = verifyMigrationHistory(orig, rowsCrlf, []); assert.equal(b.ok, true); assert.deepEqual(b.exceptions, [BC]);
  // LID tetap tidak wildcard: migration lain berbeda -> gagal
  const rowsBad = prodRows(m); rowsBad.find((x) => x.migration_name !== EXCEPTION.migration && x.migration_name !== BC).checksum = "0".repeat(64);
  assert.equal(verifyMigrationHistory(m, rowsBad, IDX).ok, false);
  assert.equal(CRLF_EXCEPTION.migration === EXCEPTION.migration, false);
});

test("CLI terhadap SALINAN _prisma_migrations production (--json): hijau; tanpa pengecualian / checksum dirusak -> merah", async () => {
  const { execFileSync, spawnSync } = await import("node:child_process");
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const m = repo(); const rows = prodRows(m).map((r) => ({ migration_name: r.migration_name, checksum: r.checksum, finished_at: "2026-10-01T02:09:10.652Z", rolled_back_at: null }));
  const d = mkdtempSync(join(tmpdir(), "mig-verify-")); const f = join(d, "prod.json");
  const cli = fileURLToPath(new URL("../scripts/verify-migration-history.js", import.meta.url));
  writeFileSync(f, JSON.stringify({ applied: rows, indexes: IDX }));
  const out = execFileSync(process.execPath, [cli, "--json", f], { encoding: "utf8" });
  assert.match(out, /PENGECUALIAN HISTORIS \(terdokumentasi\): 20261007110000_team_broadcast_contacts/); assert.match(out, /migration history: OK/);
  rows.find((r) => r.migration_name === BC).checksum = "a".repeat(64); writeFileSync(f, JSON.stringify({ applied: rows, indexes: IDX }));
  const bad = spawnSync(process.execPath, [cli, "--json", f], { encoding: "utf8" }); assert.equal(bad.status, 1); assert.match(bad.stdout + bad.stderr, /checksum drift TIDAK diizinkan/);
});
