// Menangkap "Property 'x' doesn't exist" SEBELUM rilis: pengenal yang dipakai tapi tidak pernah dideklarasikan (kasus nyata 7 Okt 2026:
// fungsi startEdit hilang dari OrderInvoiceTab.js saat menambah fitur DP, layar Invoice error di HP). Unit test logika murni tidak melihat ini
// karena komponen tidak dijalankan — jadi layar yang disentuh perubahan DIPINDAI lewat analisis scope Babel.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parse } = require("@babel/parser");
const traverse = require("@babel/traverse").default;

// Global yang disediakan runtime React Native/Hermes (bukan dideklarasikan di berkas).
const GLOBAL_RN = new Set([
  "undefined", "NaN", "Infinity", "console", "fetch", "FormData", "URL", "URLSearchParams", "AbortController", "Blob", "File", "FileReader",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "queueMicrotask", "__DEV__",
  "Promise", "Date", "Math", "JSON", "Number", "String", "Boolean", "Array", "Object", "Map", "Set", "WeakMap", "WeakSet", "Symbol", "Error",
  "RegExp", "Intl", "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent", "globalThis", "require", "module",
  "process", "TextEncoder", "TextDecoder", "atob", "btoa", "Buffer", "performance", "navigator",
]);

function pengenalTakDikenal(path) {
  const kode = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const ast = parse(kode, { sourceType: "module", plugins: ["jsx"] });
  const hilang = new Set();
  traverse(ast, {
    ReferencedIdentifier(p) {
      const nama = p.node.name;
      if (!p.scope.hasBinding(nama) && !GLOBAL_RN.has(nama)) hilang.add(`${nama} (baris ${p.node.loc.start.line})`);
    },
  });
  return [...hilang];
}

const LAYAR = [
  "../src/components/order/OrderInvoiceTab.js",
  "../src/components/CatatPembayaranDariChat.js",
  "../src/lib/invoiceDp.js",
  "../src/lib/klaimLunas.js",
  "../src/push.js",
];

for (const f of LAYAR) {
  test(`tidak ada pengenal yang dipakai tapi tak dideklarasikan: ${f.split("/").pop()}`, () => {
    if (!fs.existsSync(new URL(f, import.meta.url))) return;
    assert.deepEqual(pengenalTakDikenal(f), []);
  });
}

test("REGRESI: OrderInvoiceTab mendefinisikan startEdit (ikon pensil 'Ditagihkan ke')", () => {
  const kode = fs.readFileSync(new URL("../src/components/order/OrderInvoiceTab.js", import.meta.url), "utf8");
  assert.match(kode, /function startEdit\(\)/);
});
