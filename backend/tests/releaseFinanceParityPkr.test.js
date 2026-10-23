import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Skrip rilis perbaikan kontrol parity PKR: kode saja, fail-closed, tanpa rollback otomatis, gerbang kontrol di container baru sebelum rilis dinyatakan selesai.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sh = readFileSync(path.join(ROOT, "scripts/release-finance-parity-pkr.sh"), "utf8").replace(/\r\n/g, "\n");

test("skrip: fail-fast, kandidat & berkas benar, tanpa migrasi/dependensi, tanpa perintah destruktif", () => {
  assert.match(sh, /^#!\/usr\/bin\/env bash\n/); assert.match(sh, /set -Eeuo pipefail/);
  assert.match(sh, /CAND_BRANCH="\$\{CAND_BRANCH:-fix\/finance-parity-pkr-batal\}"/);
  assert.match(sh, /pkrBatalParity/, "tes baru termasuk allowlist");
  assert.match(sh, /dependensi \(package\.json\/lock\) berubah — tidak diizinkan/);
  assert.match(sh, /schema\/migration berubah tetapi NEW_MIGRATION tidak diisi/);
  assert.doesNotMatch(sh, /git (reset|stash|push --force|checkout --)|rm -rf (\/|\$HOME|"\$HOME")|--force-with-lease|docker (system|volume) prune/);
  assert.doesNotMatch(sh, /rftl|fintl|tanda-laporan\.sh/, "tidak ada sisa nama rilis sebelumnya");
});

test("fail-closed: gerbang kontrol PKR di container baru berhenti (die) bila gagal; TIDAK ada rollback otomatis; instruksi rollback dicetak", () => {
  assert.match(sh, /8b\. Gerbang fail-closed/);
  assert.match(sh, /die "gerbang PKR GAGAL/);
  assert.match(sh, /k\.ok && k\.selisih === 0 && d\.kontrol\.daftar\.length === 14/);
  assert.match(sh, /INSTRUKSI ROLLBACK \(TIDAK dijalankan otomatis\)/);
  assert.ok(sh.indexOf("8b. Gerbang fail-closed") > sh.indexOf("7. Switch backend") && sh.indexOf("8b. Gerbang fail-closed") < sh.indexOf("SELESAI — rilis"), "gerbang setelah switch, sebelum SELESAI");
  assert.match(sh, /docker exec "\$CID_NEW" grep -q "adalahBarisPkr"/);
});
