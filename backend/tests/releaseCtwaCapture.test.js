// Tes skrip rilis scripts/release-ctwa-capture-flag-off.sh — TANPA menyentuh produksi.
// Mengunci jaminan yang dijanjikan ke pemilik: kode saja, flag OFF, tidak menghapus apa pun,
// tidak push, tidak mengubah env, berhenti pada gerbang yang disebut.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = path.join(root, "scripts/release-ctwa-capture-flag-off.sh");
const src = fs.readFileSync(scriptPath, "utf8").replace(/\r\n/g, "\n");
const kode = src.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n"); // tanpa komentar

const punyaBash = spawnSync("bash", ["-c", "exit 0"]).status === 0;

test("skrip rilis CTWA: sintaks bash valid", { skip: !punyaBash }, () => {
  const r = spawnSync("bash", ["-n", scriptPath], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("skrip rilis CTWA: gerbang murni lulus selftest (disk 5 GiB, mount, CTWA_*, log clid, CRLF)", { skip: !punyaBash }, () => {
  const r = spawnSync("bash", [scriptPath], { encoding: "utf8", env: { ...process.env, CTWA_RELEASE_SELFTEST: "1" } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!/^FAIL/m.test(r.stdout), r.stdout);
  assert.ok(/PASS\(gagal sesuai harapan\) gate_disk_kb 5242879/.test(r.stdout));
});

test("skrip rilis CTWA: TIDAK pernah menghapus, memangkas, mem-push, atau mengubah env", () => {
  const terlarang = [
    [/\brm\s+-[a-zA-Z]*r/, "rm -r"], [/\bdocker\s+(image\s+)?rmi?\b/, "docker rmi/image rm"], [/\bprune\b/, "prune"],
    [/\bdocker\s+volume\s+(rm|prune)/, "docker volume rm"], [/\bgit\b[^\n]*\bpush\b/, "git push"], [/\bfind\b[^\n]*-delete/, "find -delete"],
    [/\bsudo\b/, "sudo"], [/>>\s*"?\$?\{?PERSIST\}?\/backend\/\.env/, "append ke .env"], [/\bsed\s+-i[^\n]*\.env/, "sed -i .env"],
    [/CTWA_ATTRIBUTION_CAPTURE_ENABLED\s*=\s*"?true/, "menyalakan flag"], [/ctwa-capture-purge\.js/, "menjalankan purge"], [/\bmigrate\s+(deploy|dev|reset)/, "migrate deploy/dev/reset"],
    [/\bnpm\s+(ci|install|run\s+build)/, "npm install/build"], [/\bDROP\s+(TABLE|SCHEMA)/i, "DROP TABLE/SCHEMA"],
  ];
  for (const [re, nama] of terlarang) assert.ok(!re.test(kode), `skrip memuat perintah terlarang: ${nama}`);
  // satu-satunya DROP yang sah: DB verifikasi sementara
  const drops = kode.match(/DROP DATABASE[^\n]*/gi) || [];
  assert.ok(drops.length >= 1 && drops.every((d) => /\$\{VERIFY_DB\}/.test(d)), `DROP DATABASE hanya boleh untuk VERIFY_DB: ${drops.join(" | ")}`);
});

test("skrip rilis CTWA: gerbang yang dijanjikan ada di kode (baseline, mount, disk 5 GiB, pg_dump, flag OFF, allowlist, pin)", () => {
  for (const [re, nama] of [
    [/BUKAN baseline/, "baseline live berubah -> berhenti"],
    [/gate_mount_text/, "gerbang mount /app/data"],
    [/MIN_FREE_KB=\$\(\(5 \* 1024 \* 1024\)\)/, "ambang disk 5 GiB"],
    [/disk_gate "awal"/, "disk dicek di awal"], [/disk_gate "sebelum build"/, "disk sebelum build"], [/disk_gate "sebelum switch"/, "disk sebelum switch"],
    [/pg_dump gagal/, "pg_dump gagal -> berhenti"], [/gzip -t/, "validasi gzip"], [/restore verifikasi tidak cocok/, "verifikasi restore"],
    [/count_ctwa_lines/, "gerbang CTWA_* nol"], [/WEBHOOK_DEBUG/, "gerbang WEBHOOK_DEBUG"],
    [/ALLOWED_RE=/, "allowlist berkas"], [/declare -A PINS/, "pin sha256"], [/--verify-only/, "mode verify-only"], [/--preflight-only/, "mode preflight-only"],
    [/ctwa-capture\*/, "bukti folder capture tidak dibuat"], [/up -d --no-deps backend/, "switch hanya backend"],
  ]) assert.ok(re.test(src), `gerbang hilang: ${nama}`);
  assert.ok(!/__PIN_/.test(src), "pin masih placeholder");
  assert.equal([...src.matchAll(/\["backend\/[^"]+"\]="[0-9a-f]{64}"/g)].length, 4, "harus 4 pin sha256");
});

test("skrip rilis CTWA: pin sha256 cocok dengan berkas runtime di working tree (teks LF)", async () => {
  const { createHash } = await import("node:crypto");
  for (const m of src.matchAll(/\["(backend\/[^"]+)"\]="([0-9a-f]{64})"/g)) {
    const isi = fs.readFileSync(path.join(root, m[1]), "utf8").replace(/\r\n/g, "\n");
    assert.equal(createHash("sha256").update(isi).digest("hex"), m[2], `pin ${m[1]} sudah basi — perbarui pin setelah meninjau perubahan`);
  }
});

test("skrip rilis CTWA: allowlist berkas tidak mengizinkan area lain", () => {
  const re = new RegExp(/ALLOWED_RE='([^']+)'/.exec(src)[1]);
  for (const ok of ["backend/src/routes/webhooks.js", "backend/src/services/ctwaCapture.js", "backend/src/services/leadAttribution.js", "docs/CTWA-CAPTURE-PHASE0.md", ".gitignore"]) assert.ok(re.test(ok), ok);
  for (const no of ["backend/prisma/schema.prisma", "backend/prisma/migrations/x/migration.sql", "backend/package.json", "docker-compose.release.yml", "frontend/src/App.jsx", "backend/src/routes/orders.js", "backend/src/services/finance/journal.js", "backend/src/index.js", "docs/lain.md"]) assert.ok(!re.test(no), no);
});
