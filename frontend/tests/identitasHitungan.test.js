// Opname Penuh: identitas penghitung/pemeriksa tampil di halaman Stock Opname dan pemeriksa memeriksa lewat aplikasi (akun login), bukan nama ketikan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");
const drawer = baca("../src/features/warehouse/dokumen/OpnameDetail.jsx");
const api = baca("../src/api.js");

test("api.periksaHitungan memanggil POST /periksa pada Stock Count", () => {
  assert.match(api, /periksaHitungan:\s*\(countId, catatan\)\s*=>\s*request\(`\/inventory\/stock-counts\/\$\{countId\}\/periksa`,\s*\{ method: "POST"/);
});

test("halaman: blok petugas hitungan menampilkan penghitung & pemeriksa dari server; tombol Periksa datang dari aksi server (hanya Waiting Review, Opname Penuh, bukan penghitung)", () => {
  assert.match(drawer, /data-testid="identitas-hitungan"/);
  assert.match(drawer, /r\.identitas\?\.penghitung/);
  assert.match(drawer, /r\.identitas\?\.pemeriksa/);
  assert.match(drawer, /PERIKSA_HITUNGAN/);
  assert.match(drawer, /api\.periksaHitungan\(id\)/);
});

test("halaman tidak menyediakan input nama pemeriksa (identitas bukan ketikan)", () => {
  assert.doesNotMatch(drawer, /placeholder="[^"]*[Pp]emeriksa/);
});
