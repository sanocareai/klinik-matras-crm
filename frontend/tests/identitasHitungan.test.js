// Opname Penuh: identitas penghitung/pemeriksa tampil di drawer Stock Count dan pemeriksa memeriksa lewat aplikasi (akun login), bukan nama ketikan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");
const drawer = baca("../src/features/warehouse/components/StockCountDetailDrawer.jsx");
const api = baca("../src/api.js");

test("api.periksaHitungan memanggil POST /periksa pada Stock Count", () => {
  assert.match(api, /periksaHitungan:\s*\(countId, catatan\)\s*=>\s*request\(`\/inventory\/stock-counts\/\$\{countId\}\/periksa`,\s*\{ method: "POST"/);
});

test("drawer: blok petugas hitungan menampilkan penghitung & pemeriksa dari server dan tombol Periksa hanya saat Waiting Review", () => {
  assert.match(drawer, /data-testid="identitas-hitungan"/);
  assert.match(drawer, /count\.identitas\?\.penghitung/);
  assert.match(drawer, /count\.identitas\?\.pemeriksa/);
  assert.match(drawer, /Saya memeriksa hitungan ini/);
  const blokTombol = drawer.slice(drawer.indexOf('status === "WAITING_REVIEW" && (\n                        <>\n                          <p className="mt-1'));
  assert.ok(blokTombol.includes("btn-periksa-hitungan"), "tombol Periksa berada di dalam kondisi WAITING_REVIEW");
});

test("drawer tidak menyediakan input nama pemeriksa (identitas bukan ketikan)", () => {
  assert.doesNotMatch(drawer, /placeholder="[^"]*[Pp]emeriksa/);
});
