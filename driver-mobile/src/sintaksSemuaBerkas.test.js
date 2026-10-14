// Pengaman sintaks: `npm test` hanya mengimpor logika murni, jadi layar/komponen JSX tidak pernah dikompilasi.
// Kesalahan sintaks di layar (mis. newline literal di dalam string) baru ketahuan saat `expo export`/OTA.
// Tes ini mem-parse SELURUH berkas JS di src/ sehingga hal itu tertangkap sebelum rilis.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("@babel/parser");

function berkasJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return berkasJs(p);
    return /\.(js|jsx)$/.test(e.name) ? [p] : [];
  });
}

test("semua berkas JS di src/ dapat di-parse (JSX + sintaks modern)", () => {
  const gagal = [];
  for (const f of berkasJs(__dirname)) {
    try {
      parse(fs.readFileSync(f, "utf8"), { sourceType: "unambiguous", plugins: ["jsx", "classProperties", "optionalChaining", "nullishCoalescingOperator"] });
    } catch (e) {
      gagal.push(`${path.relative(__dirname, f)}:${e.loc?.line} ${e.message}`);
    }
  }
  assert.deepEqual(gagal, []);
});
