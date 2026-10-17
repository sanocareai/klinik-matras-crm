// Tes gerbang migrasi skrip rilis Admin Override Siap Kirim — TANPA produksi, TANPA git jaringan.
// Mengunci: pin migrasi = isi repo; potongan bash ASLI dari skrip dijalankan terhadap keadaan migrasi simulasi:
// hanya bila migrasi terpasang di produksi ⊆ kandidat DAN pending terhadap live saat itu = TEPAT migrasi rilis ini, gerbang lolos.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const lf = (t) => t.replace(/\r\n/g, "\n");
const skrip = lf(fs.readFileSync(path.join(root, "scripts/release-admin-override-siap-kirim.sh"), "utf8"));
const punyaBash = spawnSync("bash", ["-c", "exit 0"]).status === 0;
const dirMig = fs.readdirSync(path.join(root, "backend/prisma/migrations")).filter((n) => /^\d{14}_/.test(n)).sort();

const [migEntry, ...sisa] = /^MIGS="([^"]+)"/m.exec(skrip)[1].split(/\s+/);
const [migName, migSha] = migEntry.split(":");

test("pin migrasi: tepat satu migrasi rilis; ada di repo; sha256 = isi berkas; aditif (2 kolom + 1 CHECK pada production_runs_v2)", () => {
  assert.deepEqual(sisa, [], "rilis ini hanya membawa satu migrasi");
  assert.ok(dirMig.includes(migName), "migrasi rilis ada di repo");
  const sql = lf(fs.readFileSync(path.join(root, "backend/prisma/migrations", migName, "migration.sql"), "utf8"));
  assert.equal(createHash("sha256").update(sql).digest("hex"), migSha, "isi migrasi berbeda dari pin yang diaudit");
  const kode = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(kode, /\b(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s|INSERT\s)/i);
  assert.equal((kode.match(/ADD COLUMN/gi) || []).length, 2);
  assert.equal((kode.match(/ADD CONSTRAINT/gi) || []).length, 1);
  assert.ok(kode.split("\n").filter((l) => /ALTER\s+TABLE/i.test(l)).every((l) => /production_runs_v2/.test(l)), "ALTER hanya pada production_runs_v2");
});

test("skrip: sintaks bash valid, LF, dan gerbang migrasi dua arah + urutan + saklar bawaan OFF tertulis", { skip: !punyaBash }, () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ao-"));
  const f = path.join(tmp, "s.sh"); fs.writeFileSync(f, skrip);
  assert.equal(spawnSync("bash", ["-n", f], { encoding: "utf8" }).status, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.match(skrip, /produksi memiliki migrasi yang TIDAK ada di kandidat/);
  assert.match(skrip, /migrasi pending terhadap live saat ini bukan TEPAT migrasi rilis ini/);
  assert.match(skrip, /produksi memiliki migrasi yang TIDAK ada di image baru/);
  assert.match(skrip, /tidak terurut SETELAH migrasi baseline terbaru/);
  assert.match(skrip, /saklar production_admin_override_siap_kirim SUDAH aktif di produksi sebelum rilis/);
});

// Menjalankan potongan ASLI gerbang preflight (dari APPLIED_PRE= sampai ok "migrasi terpasang di produksi") dengan psql_live/sg ditiru.
function jalankanGerbang(terpasang, kandidat) {
  const mulai = skrip.indexOf("APPLIED_PRE=");
  const akhir = skrip.indexOf("\n", skrip.indexOf('ok "migrasi terpasang di produksi'));
  assert.ok(mulai > 0 && akhir > mulai, "potongan gerbang ditemukan");
  const potongan = skrip.slice(mulai, akhir);
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "aog-"));
  fs.writeFileSync(path.join(tmp, "applied"), terpasang.join("\n") + "\n");
  fs.writeFileSync(path.join(tmp, "cand"), kandidat.map((n) => `backend/prisma/migrations/${n}`).join("\n") + "\n");
  const bash = `set -u
die() { echo "DIE: $1"; exit 1; }
ok() { echo "OK: $1"; }
psql_live() { cat "${tmp.replace(/\\/g, "/")}/applied"; }
sg() { cat "${tmp.replace(/\\/g, "/")}/cand"; }
DEPLOY_SHA=x; MIG_LIST="${migName}"
${potongan}
`;
  const r = spawnSync("bash", ["-c", bash], { encoding: "utf8" });
  fs.rmSync(tmp, { recursive: true, force: true });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const tanpaMilikKita = dirMig.filter((n) => n !== migName);

test("gerbang: live = semua migrasi kecuali milik rilis ini → LOLOS", { skip: !punyaBash }, () => {
  const r = jalankanGerbang(tanpaMilikKita, dirMig);
  assert.equal(r.status, 0, r.out); assert.match(r.out, /OK: migrasi terpasang di produksi/);
});

test("gerbang: ada migrasi pendahulu yang BELUM live (mis. rilis lain belum jalan) → pending bukan tepat milik kita → DITOLAK", { skip: !punyaBash }, () => {
  const live = tanpaMilikKita.slice(0, -1); // satu migrasi terakhir milik rilis lain belum terpasang
  const r = jalankanGerbang(live, dirMig);
  assert.equal(r.status, 1); assert.match(r.out, /DIE: migrasi pending terhadap live saat ini bukan TEPAT/);
});

test("gerbang: produksi sudah memuat migrasi yang TIDAK ada di kandidat (rilis lain live lebih dulu, belum digabung) → DITOLAK", { skip: !punyaBash }, () => {
  const r = jalankanGerbang([...tanpaMilikKita, "29991231235959_rilis_lain_sudah_live"], dirMig);
  assert.equal(r.status, 1); assert.match(r.out, /DIE: produksi memiliki migrasi yang TIDAK ada di kandidat/);
});

test("gerbang: migrasi rilis ini sudah terpasang → pending kosong → DITOLAK", { skip: !punyaBash }, () => {
  const r = jalankanGerbang(dirMig, dirMig);
  assert.equal(r.status, 1); assert.match(r.out, /DIE: migrasi pending terhadap live saat ini bukan TEPAT/);
});
