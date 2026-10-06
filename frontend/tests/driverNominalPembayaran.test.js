// Layar driver "Catat Pembayaran": nominal sangat kecil ditahan server (NOMINAL_KECIL_PERLU_KONFIRMASI) → layar bertanya dulu, lalu kirim ulang dengan konfirmasi. Tanpa ini salah ketik "1" langsung masuk kas.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");

test("DriverJobs meminta konfirmasi saat server menahan nominal kecil, dan hanya mengirim ulang bila ditegaskan", () => {
  const s = baca("../src/pages/DriverJobs.jsx");
  assert.match(s, /e1\?\.code !== "NOMINAL_KECIL_PERLU_KONFIRMASI"\) throw e1/);
  assert.match(s, /window\.confirm\(/);
  assert.match(s, /hasil = await kirim\(true\)/);
  // batal pada konfirmasi = berhenti tanpa kirim ulang
  assert.match(s, /\{ setBusy\(false\); return; \}/);
});

test("submitJobAction meneruskan konfirmasiNominalKecil hanya bila diminta", () => {
  const s = baca("../src/utils/submitJobAction.js");
  assert.match(s, /\.\.\.\(payload\.konfirmasiNominalKecil && \{ konfirmasiNominalKecil: true \}\)/);
});
