// Paket rilis spr1 (redesain Produksi): FRONTEND-SAJA dengan ALLOWLIST EKSPLISIT dari templat allowlist.txt.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const baca = (p) => fs.readFileSync(path.join(akar, p), "utf8").replace(/\r\n/g, "\n");
const skrip = baca("scripts/release-produksi-ui.sh");
const { bangkitkan } = createRequire(import.meta.url)(path.join(akar, "scripts", "gen-release-produksi-ui.cjs"));
const APLIKASI = baca("scripts/templates/release-produksi-ui/allowlist.txt").split("\n").map((x) => x.trim()).filter(Boolean);
const TPL = ["allowlist", "bandingkan-kode", "build-only", "container-baru", "fitur-dist", "header", "verifikasi-hotfix"].map((n) => `scripts/templates/release-produksi-ui/${n}.txt`);
const TPL_P = ["gerbang-kode-live", "hitung-pasca", "hitung-pra"].map((n) => `scripts/templates/release-penjadwalan-langsung/${n}.txt`);
const TETAP = ["scripts/gen-release-produksi-ui.cjs", "scripts/release-produksi-ui.sh", ...TPL, ...TPL_P];
const blok = () => Object.fromEntries([...TPL.filter((f) => !f.endsWith("allowlist.txt")), ...TPL_P].map((f) => [path.basename(f, ".txt"), baca(f)]));
const bangun = (daftar) => bangkitkan({ baseScript: baca("scripts/release-gudang-pintu-masuk.sh"), blok: blok(), berkasList: daftar });

test("allowlist skrip = berkas di allowlist.txt + berkas rilis sendiri; tanpa backend/package/docker/.env", () => {
  assert.ok(APLIKASI.every((f) => f.startsWith("frontend/")), "allowlist.txt hanya berkas frontend");
  const baris = skrip.split("\n").find((l) => l.startsWith("ALLOWED_RE="));
  const isi = baris.slice("ALLOWED_RE='^(".length, -")$'".length).split("|").map((x) => x.replace(/\\\./g, "."));
  assert.deepEqual([...isi].sort(), [...APLIKASI, ...TETAP].sort());
  assert.doesNotMatch(baris, /backend\/|package|docker|\.env/);
});

test("generator MENOLAK berkas di luar allowlist dan berkas yang kurang", () => {
  assert.doesNotThrow(() => bangun(APLIKASI));
  for (const ekstra of ["frontend/src/pages/finance/FinanceCash.jsx", "frontend/src/lib/financeHubs.js", "backend/src/routes/financeTransactions.js", "frontend/package.json", "frontend/src/api.js"]) assert.throws(() => bangun([...APLIKASI, ekstra]), /allowlist|FRONTEND-SAJA|dependensi/, ekstra);
  assert.throws(() => bangun(APLIKASI.slice(1)), /allowlist eksplisit/);
});

test("skrip: kode spr1, dua berkas tes persis, tanpa penghapusan di luar release dir sementara", () => {
  assert.match(skrip, /\/tmp\/spr1\.sh/);
  assert.match(skrip, /bandingkan_kode "\$BK_DIR\/container-sha\.txt" "\$BK_DIR\/dir-sha\.txt" \|\|/);
  assert.doesNotMatch(skrip.replace('rm -rf -- "$NEW_DIR"', ""), /rm -rf[^\n]*(RELEASES\b|PREV_DIR|backups|volume)/);
  assert.doesNotMatch(skrip.split("\n").filter((l) => !l.startsWith("#")).join("\n"), /spo1|spo2|spo3|skb1|gpm\b|pjl\\\|/);
});

test("skrip tersimpan identik dengan hasil bangkitan ulang (tak diedit tangan)", () => {
  assert.equal(bangun(APLIKASI).script, skrip);
});
