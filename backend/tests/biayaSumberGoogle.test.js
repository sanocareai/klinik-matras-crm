// Daftar sumber berbiaya di kode harus sama dengan aturan tabel terbaru.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SUMBER_BERBIAYA } from "../src/services/attribution/biayaSumber.js";

test("aturan tabel biaya mengizinkan semua sumber yang dikenal kode", () => {
  const sql = readFileSync(new URL("../prisma/migrations/20261231150000_biaya_sumber_google/migration.sql", import.meta.url), "utf8");
  for (const s of SUMBER_BERBIAYA) assert.ok(sql.includes(`'${s}'`), s);
});
