// C2.1 — UI Admin/Owner untuk keanggotaan divisi: Peran dan Divisi tampil sebagai dua konsep berbeda; menu mengikuti divisi; label Indonesia.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(__dirname, "..", "src", rel), "utf8");
const KUNCI_BACKEND = ["MARKETING", "MANAGEMENT", "HR_GA", "PRODUCTION", "WAREHOUSE", "DELIVERY"];

test("halaman Pengguna: kolom Peran dan kolom Divisi terpisah, dengan menu 'Atur Divisi' dan penjelasan bahwa divisi bukan izin", () => {
  const src = baca("pages/Pengguna.jsx");
  assert.match(src, /<th>Peran<\/th>\s*<th>Divisi<\/th>/);
  assert.match(src, /Atur Divisi/);
  assert.match(src, /terpisah dari peran \(izin keamanan\) dan tidak menambah izin Finance/);
  assert.match(src, /hanya melihat dan mengelola pengajuan miliknya sendiri/);
  assert.match(src, /api\.setUserDivisions\(/);
  assert.match(src, /data-testid="modal-divisi"/);
  assert.match(src, /Belum diatur/);
});

test("daftar divisi UI sama persis dengan enum backend (enam divisi) dan berlabel Indonesia", () => {
  const src = baca("pages/Pengguna.jsx");
  const blok = src.match(/export const DIVISI_AKSES = \[([\s\S]*?)\];/)[1];
  const kunci = [...blok.matchAll(/key: "([A-Z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(kunci, KUNCI_BACKEND);
  for (const label of ["Marketing", "Management", "HR & GA", "Produksi", "Gudang", "Delivery"]) assert.match(blok, new RegExp(`label: "${label}"`));
});

test("api.js: setUserDivisions memakai PUT /users/:id/divisions dengan daftar divisi", () => {
  const api = baca("api.js");
  assert.match(api, /setUserDivisions: \(id, divisions\) =>\s*request\(`\/users\/\$\{id\}\/divisions`, \{ method: "PUT", body: JSON\.stringify\(\{ divisions \}\) \}\)/);
});

test("Layout: menu Pengajuan Biaya mengikuti divisi (bolehDivisi) untuk Marketing, Management, HR-GA, Produksi, Gudang; divisi dimuat dari server", () => {
  const layout = baca("components/Layout.jsx");
  for (const [rute, div] of [["/marketing/pengajuan-biaya", "MARKETING"], ["/kendali/pengajuan-biaya", "MANAGEMENT"], ["/kendali/pengajuan-hrga", "HR_GA"], ["/bengkel/pengajuan-biaya", "PRODUCTION"], ["/warehouse/pengajuan-biaya", "WAREHOUSE"]]) {
    assert.match(layout, new RegExp(`to: "${rute.replace(/\//g, "\\/")}"[^}]*bolehDivisi: \\["${div}"\\]`), rute);
  }
  assert.match(layout, /api\.getMyPortals\(\)\.then\(\(me\) =>[^)]*divisions/);
  assert.match(layout, /\(i\.bolehDivisi \|\| \[\]\)\.some\(\(d\) => divisiSaya\.includes\(d\)\)/);
});

test("rute HR & GA untuk anggota divisi terdaftar", () => {
  const reg = baca("routes/pageRegistry.jsx");
  assert.match(reg, /\/kendali\/pengajuan-hrga[^\n]*<PengajuanBiayaWorkspace workspace="HR_GA"/);
});
