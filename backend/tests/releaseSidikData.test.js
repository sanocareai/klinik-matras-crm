// Pembanding sidik jari hitungan data rilis: pesan WhatsApp masuk yang sah BUKAN perubahan akibat deploy; hitungan bisnis relevan tetap diperiksa ketat.
// Memuat fungsi LANGSUNG dari scripts/lib/sidik-data.sh (yang sama dengan yang ditanam ke skrip rilis) dan menjalankannya lewat bash.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LIB = path.join(repo, "scripts/lib/sidik-data.sh").replace(/\\/g, "/");
const punyaBash = spawnSync("bash", ["-c", "true"]).status === 0;
const uji = (a, b) => { const r = spawnSync("bash", ["-c", `. "${LIB}"; bandingkan_sidik_data "$1" "$2"`, "_", a, b], { encoding: "utf8" }); return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr.trim() }; };
const T = { skip: !punyaBash };

test("identik: lolos tanpa info", T, () => { const r = uji("272|423|0|0|0|294431", "272|423|0|0|0|294431"); assert.equal(r.ok, true); assert.equal(r.out, ""); });
test("PESAN MASUK SAH (naik 294431 → 294437, kasus rilis 29 Okt): LOLOS dan dilaporkan sebagai bukan dampak deploy", T, () => {
  const r = uji("272|423|0|0|0|294431", "272|423|0|0|0|294437"); assert.equal(r.ok, true, r.err); assert.match(r.out, /pesan masuk sah selama rilis: \+6/); assert.match(r.out, /bukan dampak deploy/);
});
test("pesan BERKURANG: GAGAL (pesan hilang tidak boleh)", T, () => { const r = uji("272|423|0|0|0|294431", "272|423|0|0|0|294430"); assert.equal(r.ok, false); assert.match(r.err, /pesan BERKURANG/); });
test("hitungan BISNIS berubah tetap GAGAL, meski pesan juga naik: migrasi, pergerakan stok, Material Issue, Stock Transfer, koreksi Gudang", T, () => {
  const dasar = [272, 423, 5, 7, 9, 1000];
  const nama = ["migrasi", "pergerakan_stok", "material_issue", "stock_transfer", "koreksi_gudang"];
  for (let i = 0; i < 5; i++) for (const d of [+1, -1]) {
    const sesudah = [...dasar]; sesudah[i] += d; sesudah[5] += 3;
    const r = uji(dasar.join("|"), sesudah.join("|")); assert.equal(r.ok, false, `${nama[i]} ${d}`); assert.match(r.err, new RegExp(`hitungan ${nama[i]} BERUBAH`));
  }
});
test("format tidak valid: bukan 6 komponen, bukan angka, kosong → GAGAL (fail-closed)", T, () => {
  for (const [a, b] of [["1|2|3|4|5", "1|2|3|4|5|6"], ["1|2|3|4|5|6", "1|2|3|4|5|6|7"], ["1|2|3|4|5|x", "1|2|3|4|5|6"], ["1|2|3|4|5|6", "1|2|3|4|5|"], ["", ""], ["1|2|3|4|5|6", "abc"]]) assert.equal(uji(a, b).ok, false, `${a} → ${b}`);
});
test("skrip rilis frontend-saja memakai pembanding ini (bukan kesamaan string) dan tidak lagi menghentikan rilis karena pesan masuk", () => {
  const s = fs.readFileSync(path.join(repo, "scripts/release-stok-saringan.sh"), "utf8").replace(/\r\n/g, "\n");
  assert.ok(s.includes("bandingkan_sidik_data()") && s.includes('bandingkan_sidik_data "$FP_0" "$FP_1"'), "fungsi tertanam dan dipakai");
  assert.ok(!s.includes('[ "$FP_1" = "$FP_0" ] || die "hitungan data BERUBAH selama rilis'), "kesamaan string lama dicabut");
  const lib = fs.readFileSync(path.join(repo, "scripts/lib/sidik-data.sh"), "utf8").replace(/\r\n/g, "\n").trimEnd();
  assert.ok(s.includes(lib), "isi fungsi di skrip == scripts/lib/sidik-data.sh (satu sumber)");
});
