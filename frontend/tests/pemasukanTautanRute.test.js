// Tautan "Catat pemasukan lain" / "Pemasukan Lain" di halaman Pemasukan harus menuju rute yang TERDAFTAR (sebelumnya /finance/other-income tidak ada di pageRegistry → jatuh ke Portal).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(akar, p), "utf8").split("\r\n").join("\n");

test("setiap nav('/finance/...') di halaman Pemasukan menunjuk rute terdaftar di pageRegistry", () => {
  const sumber = ["src/pages/finance/FinancePemasukan.jsx", "src/features/finance/pemasukan/DaftarPemasukan.jsx", "src/features/finance/pemasukan/RingkasanPemasukan.jsx", "src/features/finance/pemasukan/pemasukanLogic.js"].map(baca).join("\n");
  const registri = baca("src/routes/pageRegistry.jsx");
  const tujuan = [...sumber.matchAll(/nav(?:igate)?\(\s*["'`](\/finance\/[a-z0-9-]+)/g)].map((m) => m[1]);
  assert.ok(tujuan.length > 0);
  for (const t of new Set(tujuan)) assert.ok(registri.includes(`path: "${t}"`), `${t} tidak terdaftar di pageRegistry.jsx`);
});

test("Pemasukan Lain: dua tombol menuju Kas & Bank tab Pemasukan lain (tab yang valid di FinanceCash)", () => {
  const s = baca("src/pages/finance/FinancePemasukan.jsx");
  assert.equal((s.match(/nav\("\/finance\/cash\?tab=pemasukan"\)/g) || []).length, 2);
  assert.ok(!s.includes("/finance/other-income"));
  assert.match(baca("src/pages/finance/FinanceCash.jsx"), /useUrlTab\(\["rekening", "mutasi", "transfer", "pemasukan"\]/);
});
