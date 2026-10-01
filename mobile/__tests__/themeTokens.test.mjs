// Token warna yang tidak ada di constants/theme.js bernilai undefined → latar transparan / warna hilang (bug nyata 1 Okt 2026: sheet "Ajukan Klaim Lunas"
// memakai color.surface/color.background yang tidak ada, sehingga halaman di belakang menimpa isi sheet).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const tema = fs.readFileSync(path.join(akar, "constants/theme.js"), "utf8");
const blok = /const LIGHT_COLOR = \{([\s\S]*?)\n\};/.exec(tema)[1];
const ADA = new Set([...blok.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]));

function berkas(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? berkas(path.join(d, e.name)) : /\.js$/.test(e.name) ? [path.join(d, e.name)] : [])); }

test("tema punya token inti", () => { for (const k of ["bg", "card", "subtle", "accent", "accentSoft", "textPrimary"]) assert.ok(ADA.has(k), k); });

test("fitur Klaim Lunas hanya memakai token warna yang ada di tema", () => {
  const s = fs.readFileSync(path.join(akar, "components/order/OrderKlaimLunas.js"), "utf8");
  const pakai = [...s.matchAll(/\b(?:t|tokens)\.color\.(\w+)/g)].map((m) => m[1]);
  const hilang = [...new Set(pakai.filter((k) => !ADA.has(k)))];
  assert.deepEqual(hilang, [], `token tidak ada di tema: ${hilang.join(", ")}`);
});

test("seluruh src mobile: token color.* yang tidak ada di tema (seluruh aplikasi)", () => {
  const hilang = new Map();
  for (const f of berkas(akar).filter((x) => !x.endsWith("theme.js"))) for (const m of fs.readFileSync(f, "utf8").matchAll(/\b(?:t|tokens)\.color\.(\w+)/g)) if (!ADA.has(m[1])) hilang.set(`${path.relative(akar, f)}:${m[1]}`, 1);
  assert.deepEqual([...hilang.keys()], [], `token tidak ada: ${[...hilang.keys()].join(", ")}`);
});
