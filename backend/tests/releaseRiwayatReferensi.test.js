// Tes generator + skrip rilis Riwayat Referensi — TANPA menyentuh produksi, tanpa git jaringan.
// Mengunci: generator berbasis repo (bukan helper di luar repo), gerbang migrasi (tepat 1 pending, pin sha256, himpunan terpasang ⊆ kandidat),
// rehearsal sebelum migrate, migrate sebelum switch, smoke baca-saja, dan urutan nama migrasi yang aman.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { bangkitkan } = require(path.join(root, "scripts/gen-release-riwayat-referensi.cjs"));
const lf = (t) => t.replace(/\r\n/g, "\n");
const baca = (rel) => lf(fs.readFileSync(path.join(root, rel), "utf8"));
const punyaBash = spawnSync("bash", ["-c", "exit 0"]).status === 0;

const dirMig = fs.readdirSync(path.join(root, "backend/prisma/migrations")).filter((n) => /^\d{14}_/.test(n));
const migName = dirMig.find((n) => n.endsWith("_stok_riwayat_referensi"));
const migRel = `backend/prisma/migrations/${migName}/migration.sql`;
const berkasUji = ["backend/prisma/schema.prisma", migRel, "backend/src/routes/riwayatReferensi.js", "frontend/src/features/warehouse/components/RiwayatReferensiTab.jsx", "scripts/lib/smoke-riwayat-referensi.mjs", "scripts/gen-release-riwayat-referensi.cjs"];
const masukan = (o = {}) => ({ templateSrc: baca("scripts/release-identitas-pemeriksa-hitung.sh"), berkasList: berkasUji, migName, migSql: baca(migRel), smokeSrc: baca("scripts/lib/smoke-riwayat-referensi.mjs"), ...o });

test("generator berbasis repo: tepat satu migrasi *_stok_riwayat_referensi, namanya SESUDAH semua migrasi lain (urutan aman)", () => {
  assert.ok(migName, "migrasi riwayat referensi ada");
  assert.equal(dirMig.filter((n) => n.endsWith("_stok_riwayat_referensi")).length, 1);
  const lain = dirMig.filter((n) => n !== migName).sort();
  assert.ok(migName > lain[lain.length - 1], `nama migrasi (${migName}) harus lebih baru dari migrasi lain (${lain[lain.length - 1]}) — nama tanggal BUKAN bukti siap rilis, tetapi urutan harus aman`);
  const src = baca("scripts/gen-release-riwayat-referensi.cjs");
  assert.doesNotMatch(src, /C:[\\/]+tmp|km-recon-out|pid_main|smoke_rr/i, "generator tidak boleh bergantung pada helper di luar repo");
});

test("skrip hasil bangkitan: deterministik, sintaks bash valid, LF, pin sha256 migrasi = isi migrasi di repo", { skip: !punyaBash }, () => {
  const a = bangkitkan(masukan()); const b = bangkitkan(masukan());
  assert.equal(a.script, b.script, "deterministik");
  assert.ok(!a.script.includes("\r"));
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP || "/tmp"), "rr-"));
  const f = path.join(tmp, "rr.sh"); fs.writeFileSync(f, a.script);
  const r = spawnSync("bash", ["-n", f], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr);
  fs.rmSync(tmp, { recursive: true, force: true });
  const sha = createHash("sha256").update(baca(migRel)).digest("hex");
  assert.match(a.script, new RegExp(`MIG_LIST="${migName}"; MIG_SHA="${sha}"`));
  assert.equal(a.ringkasan.migSha, sha);
});

test("skrip rilis: urutan gerbang — verifier → rehearsal pada restore → migrate sekali → switch → smoke; himpunan migrasi; tidak menyentuh data selain migrasi aditif", () => {
  const { script: s } = bangkitkan(masukan());
  const pos = (t) => { const i = s.indexOf(t); assert.ok(i >= 0, "tidak ditemukan: " + t); return i; };
  const verifier = pos("verify-migration-history.js"), rehearsal = pos('PHASE="5c-rehearsal"'), migrate = pos('PHASE="6-migrate"'), switchB = pos('PHASE="7-switch"'), smoke = pos('PHASE="8b-smoke"');
  assert.ok(verifier < rehearsal && rehearsal < migrate && migrate < switchB && switchB < smoke, "urutan fase");
  assert.equal((s.match(/prisma migrate deploy/g) || []).length, 2, "satu di rehearsal (DB sementara), satu di produksi");
  assert.ok(s.indexOf("prisma migrate deploy", migrate) > migrate && s.indexOf("prisma migrate deploy", migrate) < switchB, "migrate produksi sebelum switch");
  assert.match(s, /SOLO_PROD=/); assert.match(s, /produksi memiliki migrasi yang TIDAK ada di kandidat/);
  assert.match(s, /migrasi pending bukan TEPAT migrasi rilis ini/); assert.match(s, /MIG_SESUDAH" = "\$\(\( MIG_SEBELUM \+ 1 \)\)"/);
  assert.match(s, /\[\[ "\$MIG_LIST" > "\$TERAKHIR" \]\]/, "gerbang urutan nama");
  assert.match(s, /perubahan backend\/prisma bukan TEPAT schema\.prisma \+ migrasi rilis ini/);
  // semua INSERT/UPDATE/DELETE uji hanya di antara awal rehearsal dan penghapusan DB sementara; tidak ada di fase produksi
  const mulaiReh = rehearsal, akhirReh = pos('reh_drop; REH_DB=""');
  for (const m of s.matchAll(/^(ROK|RTOLAK)\b/gm)) assert.ok(m.index > mulaiReh && m.index < akhirReh, "uji tulis hanya pada DB rehearsal");
  const fasaProd = s.slice(migrate);
  assert.doesNotMatch(fasaProd.replace(/#.*$/gm, ""), /insert into stok_riwayat|update stok_riwayat|delete from stok_riwayat|\/segarkan.*konfirmasi: *true/i, "fase produksi tidak menulis tabel referensi");
  assert.doesNotMatch(s.split("\n").filter((l) => !/\bdie\b|^\s*#/.test(l)).join("\n"), /--accept-data-loss|migrate reset|db push|DROP TABLE|TRUNCATE/i);
});

test("smoke tersemat = berkas repo; baca-saja: tidak memanggil impor valid, tidak memanggil segarkan dengan konfirmasi", () => {
  const { script: s } = bangkitkan(masukan()); const smoke = baca("scripts/lib/smoke-riwayat-referensi.mjs");
  assert.ok(s.includes(smoke.trimEnd()), "isi smoke tersemat persis");
  assert.doesNotMatch(smoke, /konfirmasi: *true/); assert.match(smoke, /KONFIRMASI_DIPERLUKAN/);
  assert.doesNotMatch(smoke.replace(/\/\/.*$/gm, ""), /method: *"(PUT|PATCH|DELETE)"/);
  assert.match(smoke, /smoke tidak menambah audit/); assert.match(smoke, /smoke tidak menulis tabel referensi baru/);
});

test("allowlist: hanya berkas di diff; perubahan prisma lain, migrasi hilang, atau nama tak valid ditolak generator", () => {
  const { script: s } = bangkitkan(masukan());
  const re = new RegExp(s.split("\n").find((l) => l.startsWith("ALLOWED_RE=")).slice("ALLOWED_RE='".length, -1));
  for (const f of berkasUji) assert.ok(re.test(f), f);
  for (const f of ["backend/prisma/migrations/20260101000000_lain/migration.sql", "backend/package.json", "docker-compose.yml", "backend/src/index.jsx", "frontend/dist/index.html"]) assert.ok(!re.test(f), "harus ditolak: " + f);
  assert.throws(() => bangkitkan(masukan({ berkasList: [...berkasUji, "backend/prisma/migrations/20261203000000_lain/migration.sql"] })), /perubahan prisma lain/);
  assert.throws(() => bangkitkan(masukan({ berkasList: berkasUji.filter((f) => f !== migRel) })), /berkas prisma tidak ada/);
  assert.throws(() => bangkitkan(masukan({ migName: "bukan-nama" })), /nama migrasi tidak valid/);
  assert.throws(() => bangkitkan(masukan({ templateSrc: "#!/bin/bash\necho kosong\n" })), /templat\/masukan tak cocok/);
});

test("migrasi rilis: aditif murni (hanya objek stok_riwayat_*; tanpa DROP/TRUNCATE/DELETE/UPDATE; tanpa ALTER tabel lain)", () => {
  const sql = baca(migRel).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(sql, /^\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s)/im);
  const alter = sql.split("\n").filter((l) => /^\s*ALTER\s+TABLE/i.test(l));
  assert.ok(alter.length > 0 && alter.every((l) => /^\s*ALTER\s+TABLE\s+"stok_riwayat_(referensi|impor)"/i.test(l)), "ALTER hanya pada 2 tabel baru");
  assert.equal((sql.match(/CREATE TABLE/g) || []).length, 2);
  assert.match(sql, /"stok_riwayat_referensi_tanpa_tanggal_pemakaian" CHECK \("tanggal_pemakaian" IS NULL\)/);
});

test("BATAS KERJA: fitur Riwayat Referensi tidak membaca/menulis Finance (PO, pembayaran, uang muka, jurnal) dan tidak mengaitkan status bayar dengan GR/pemakaian", () => {
  const berkas = ["backend/src/services/stokRiwayatReferensi.js", "backend/src/routes/riwayatReferensi.js", "frontend/src/features/warehouse/components/RiwayatReferensiTab.jsx", "frontend/src/features/warehouse/components/RiwayatReferensiBahan.jsx", migRel];
  for (const rel of berkas) {
    const kode = baca(rel).split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("--")).join("\n");
    assert.doesNotMatch(kode, /finPurchase|finPayment|finJournal|finSupplier|fin_purchase|fin_payment|fin_journal|fin_supplier|paymentStatus|statusBayar|uangMuka/i, rel + " tidak boleh menyentuh Finance");
  }
  const sql = baca(migRel);
  const referensiTabel = [...sql.matchAll(/REFERENCES "([a-z_]+)"/gi)].map((m) => m[1]).sort();
  assert.deepEqual(referensiTabel, ["materials", "stok_riwayat_impor"], "FK migrasi hanya ke materials dan tabel sendiri");
});
