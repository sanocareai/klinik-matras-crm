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
const masukan = (o = {}) => ({ templateSrc: baca("scripts/release-identitas-pemeriksa-hitung.sh"), berkasList: berkasUji, migName, migSql: baca(migRel), smokeSrc: baca("scripts/lib/smoke-riwayat-referensi.mjs"), restoreBersihSrc: baca("scripts/templates/restore-bersih.sh.part"), ...o });

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

// ───────── MODE REHEARSAL-ONLY: tidak punya jalur tulis ke produksi ─────────
const { bangkitkanRehearsal } = require(path.join(root, "scripts/gen-release-riwayat-referensi.cjs"));
const rehTersimpan = baca("scripts/rehearsal-riwayat-referensi.sh");
const rehBangkit = () => bangkitkanRehearsal({ tplSrc: baca("scripts/templates/rehearsal-riwayat-referensi.sh.tpl"), fullScript: bangkitkan(masukan()).script, migName, migSha: createHash("sha256").update(baca(migRel)).digest("hex"), smokeSrc: baca("scripts/lib/smoke-riwayat-referensi.mjs"), katalogSql: baca("scripts/templates/rehearsal-katalog.sql"), hitungSql: baca("scripts/templates/rehearsal-hitung-baris.sql"), candBranch: "feat/stok-mulai-catat-rekon-okt" });
// baris kode: tanpa komentar dan tanpa pesan (say/ok/die/echo) — pola terlarang diperiksa pada perintah yang benar-benar dijalankan
const barisKode = (t) => t.split("\n").filter((l) => !l.trim().startsWith("#") && !/^\s*(say|ok|die)\b/.test(l) && !/\|\| die |&& die |; die |\{ die |then die /.test(l.replace(/"[^"]*"/g, '""')) || /^\s*(docker|psql|live_ro|rpsql|RPSQL|ROK|RTOLAK|sg|gzip|rm|mkdir|mv|cp|cat)\b/.test(l)).join("\n");

test("rehearsal-only: berkas tersimpan = hasil bangkitan ulang (deterministik), sintaks valid, LF, tanpa placeholder", { skip: !punyaBash }, () => {
  assert.equal(rehTersimpan, rehBangkit(), "scripts/rehearsal-riwayat-referensi.sh harus identik dengan hasil generator");
  assert.ok(!rehTersimpan.includes("\r")); assert.doesNotMatch(rehTersimpan, /@@[A-Z_]+@@/);
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP || "/tmp"), "reh-")); const f = path.join(tmp, "reh.sh"); fs.writeFileSync(f, rehTersimpan);
  assert.equal(spawnSync("bash", ["-n", f], { encoding: "utf8" }).status, 0); fs.rmSync(tmp, { recursive: true, force: true });
  assert.match(rehTersimpan, new RegExp(`MIG_LIST="${migName}"; MIG_SHA="${createHash("sha256").update(baca(migRel)).digest("hex")}"`));
});

test("rehearsal-only: TIDAK ada jalur tulis ke produksi (tanpa compose/tag/up/restart/switch; migrate hanya ke DB sementara; akses live hanya baca-saja)", () => {
  const kode = rehTersimpan.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  const perintah = kode.split("\n").filter((l) => !/^\s*(say|ok|die)\b/.test(l) && !/^OTHER=.*pgrep/.test(l)).join("\n"); // pgrep hanya MENDETEKSI deploy lain
  assert.doesNotMatch(perintah, /docker compose|docker-compose|\bdcp\b/, "tidak memakai compose (satu-satunya jalur ke stack produksi)");
  assert.doesNotMatch(perintah, /docker tag\b|docker (restart|stop|kill|update)\b|docker exec[^\n]*\b(up|recreate)\b|--force-recreate|up -d/);
  assert.doesNotMatch(perintah, /\$PREV_DIR[^\n]*(>|tee|rm |mv |cp |mkdir|ln )|>\s*"?\$RELEASES|\brm\b[^\n]*\$(RELEASES|PREV_DIR|PERSIST|HOME\/backups)|\.release-commit"? *>/, "tidak menulis ke release aktif / ~/releases / persist");
  assert.doesNotMatch(perintah, /\bpsql_live\b|\bPERSIST\b|(backend|frontend)\/\.env/, "tidak memuat env/.env produksi atau helper tulis live");
  // setiap migrate deploy memakai DATABASE_URL sementara pada jaringan rr-reh
  const migrate = perintah.split("\n").filter((l) => /prisma migrate deploy/.test(l) && /docker run/.test(l));
  assert.equal(migrate.length, 1); assert.match(migrate[0], /--network "\$RR_NET" -e DATABASE_URL="\$REH_URL"/);
  assert.match(rehTersimpan, /REH_URL="postgresql:\/\/\$\{DB_USER\}:\$\{REH_PW\}@\$\{RR_PG\}:5432\/\$\{DB_NAME\}"/);
  assert.match(rehTersimpan, /docker network create --internal "\$RR_NET"/);
  assert.match(rehTersimpan, /tidak menunjuk Postgres sementara/);
  // akses live: hanya live_ro (PGOPTIONS read-only) dan pg_dump read-only; docker exec ke $LIVE_PG hanya lewat keduanya
  const keLive = perintah.split("\n").filter((l) => /\$LIVE_PG/.test(l) && /docker exec/.test(l));
  assert.ok(keLive.length >= 2 && keLive.every((l) => /default_transaction_read_only=on/.test(l)), "semua docker exec ke produksi baca-saja: " + keLive.join(" | "));
  assert.match(rehTersimpan, /create temp table rr_uji_tulis/, "bukti bahwa sesi produksi menolak tulis");
  // semua penghapusan hanya menyasar sumber daya rr-reh-*/WORK
  for (const l of perintah.split("\n").filter((x) => /docker (rm|rmi|network rm|volume rm)|\brm -rf\b/.test(x))) assert.match(l, /\$RR_(API|PG|NET|VOL|IMG)|\$WORK|\$REH_|--rm /, "penghapusan hanya sumber daya sementara: " + l);
  for (const v of ["RR_NET", "RR_PG", "RR_API", "RR_VOL", "RR_IMG"]) assert.match(rehTersimpan, new RegExp(`${v}="rr-reh-`), v + " berawalan rr-reh-");
  assert.match(rehTersimpan, /WORK="\$HOME\/rehearsal-rr\//, "direktori kerja terpisah dari ~/releases (tidak memblokir rilis nyata)");
  assert.doesNotMatch(perintah, /\$RELEASES\/\$|NEW_DIR/, "tidak membuat release dir");
});

test("rehearsal-only: urutan — audit live baca-saja → backup → restore sementara → build tag sementara → verifier → snapshot sebelum → migrate sementara → constraint → snapshot sesudah identik → smoke → snapshot identik → bukti produksi tak berubah", () => {
  const pos = (t) => { const i = rehTersimpan.indexOf(t); assert.ok(i >= 0, t); return i; };
  const urut = ['PHASE="2-audit-live-baca-saja"', 'PHASE="3-backup"', 'PHASE="4-postgres-sementara"', 'PHASE="4b-kontrol-restore"', 'PHASE="5-build-image"', 'PHASE="5a-verifier"', 'PHASE="6-migrate-rehearsal"', 'PHASE="6b-constraint"', 'PHASE="6c-kontrol-sesudah"', 'PHASE="7-smoke"', 'PHASE="8-bukti-produksi-tak-berubah"'].map(pos);
  assert.deepEqual(urut, [...urut].sort((a, b) => a - b));
  assert.match(rehTersimpan, /cmp -s "\$WORK\/snap-sebelum\.txt" "\$WORK\/snap-sesudah-migrasi\.txt"/); assert.match(rehTersimpan, /cmp -s "\$WORK\/snap-sebelum\.txt" "\$WORK\/snap-sesudah-smoke\.txt"/);
  assert.match(rehTersimpan, /Applying migration[^\n]*\n?[^\n]*TEPAT \$\{MIG_LIST\}|menerapkan sesuatu selain TEPAT/);
  assert.match(rehTersimpan, /env produksi TIDAK dimuat/); assert.match(rehTersimpan, /rr-server\.mjs/);
  assert.ok((rehTersimpan.match(/SELECT|select/g) || []).length > 5);
});

// ───────── RESTORE HARUS BERSIH (tidak ada error yang diabaikan) ─────────
test("restore: skrip rilis penuh TIDAK lagi mengabaikan error restore (exit code + jumlah error); tidak ada '|| true' pada psql restore", () => {
  const { script } = bangkitkan(masukan());
  assert.equal((script.match(/RESTORE_RC=\$\?/g) || []).length, 2, "kedua restore (3b dan 5c) diperiksa");
  assert.equal((script.match(/restore ke DB sementara TIDAK bersih/g) || []).length, 2);
  assert.doesNotMatch(script, /ON_ERROR_STOP=0 -X -q > "\$BK_DIR\/restore-(rehearsal|mig)\.log" 2>&1 \|\| true/);
  assert.throws(() => bangkitkan(masukan({ restoreBersihSrc: "tanpa penanda" })), /restore-bersih/);
});

test("rehearsal-only: restore diperiksa ketat (exit code, error, warning), role dibuat dari produksi, log disimpan, itemisasi penyebab/perintah/objek, data COPY tidak pernah ditampilkan", () => {
  const t = rehTersimpan;
  assert.match(t, /PHASE="4a-role"/); assert.match(t, /CREATE ROLE \\"\$\{r\}\\" NOLOGIN/); assert.doesNotMatch(t.replace(/#.*$/gm, ""), /PASSWORD '|ENCRYPTED PASSWORD|rolpassword|pg_authid|pg_shadow/i, "tidak menyalin rahasia role");
  assert.match(t, /RR_DIAGNOSA_TANPA_ROLE/); assert.match(t, /-v ON_ERROR_STOP=0 -X -q -f \/tmp\/live\.sql/); assert.match(t, /RESTORE_RC=\$\?/);
  assert.match(t, /\[ "\$\{ERR_ANY:-0\}" != "0" \] \|\| \[ "\$RESTORE_RC" != "0" \] \|\| \[ "\$\{WARN_N:-0\}" != "0" \]/, "gerbang: error, exit code, atau warning menggagalkan");
  assert.match(t, /restore TIDAK bersih/); assert.match(t, /tidak ada pengecualian yang diterima diam-diam/);
  assert.match(t, /LOGDIR="\$HOME\/rehearsal-rr-logs\//); assert.match(t, /RESTORE_LOG="\$LOGDIR\/restore\.log"/); assert.match(t, /baris data COPY TIDAK pernah ditampilkan/);
  assert.match(t, /ROLE_TIDAK_ADA/); assert.match(t, /IZIN/); assert.match(t, /OBJEK_TIDAK_ADA/);
  const cleanup = t.slice(t.indexOf("cleanup() {"), t.indexOf("trap cleanup EXIT"));
  assert.doesNotMatch(cleanup, /rm -rf[^\n]*LOGDIR/, "cleanup tidak menghapus log");
  assert.match(cleanup, /cp "\$x" "\$LOGDIR"/);
});

test("rehearsal-only: objek/izin dibuktikan pulih sesuai sumber (katalog + izin efektif + jumlah baris) dan migrasi hanya menambah objek stok_riwayat_*", () => {
  const t = rehTersimpan; const kat = baca("scripts/templates/rehearsal-katalog.sql");
  for (const k of ["'relasi'", "'kolom'", "'indeks'", "'constraint'", "'trigger'", "'fungsi'", "'enum'", "'ekstensi'", "'role'", "'default-acl'", "'izin-tabel'", "'izin-fungsi'", "'izin-skema'", "'tampilan'", "'skema'", "'db'"]) assert.ok(kat.includes(k), "katalog memuat " + k);
  assert.match(kat, /relacl/); assert.match(kat, /pg_get_userbyid/); assert.match(kat, /has_table_privilege/); assert.match(kat, /pg_get_triggerdef/); assert.match(kat, /pg_get_functiondef/); assert.match(kat, /pg_get_constraintdef/);
  assert.doesNotMatch(kat.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''"), /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/i, "SQL katalog murni SELECT");
  assert.doesNotMatch(baca("scripts/templates/rehearsal-hitung-baris.sql").replace(/--.*$/gm, "").replace(/'[^']*'/g, "''"), /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/i);
  assert.match(t, /katalog restore BERBEDA dari produksi/); assert.match(t, /jumlah baris restore tidak sesuai sumber/); assert.match(t, /DI-LUAR-RENTANG/);
  assert.match(t, /PHASE="6d-katalog-sesudah-migrasi"/); assert.match(t, /migrasi menambah objek di luar stok_riwayat_\*/); assert.match(t, /objek lama BERUBAH\/HILANG oleh migrasi/);
  const pos = (x) => t.indexOf(x); assert.ok(pos('PHASE="4a-role"') < pos('PHASE="4-restore"') && pos('PHASE="4-restore"') < pos('PHASE="4b-kontrol-restore"') && pos('PHASE="4b-kontrol-restore"') < pos('PHASE="4c-objek-dan-izin"') && pos('PHASE="4c-objek-dan-izin"') < pos('PHASE="5-build-image"') && pos('PHASE="6c-kontrol-sesudah"') < pos('PHASE="6d-katalog-sesudah-migrasi"') && pos('PHASE="6d-katalog-sesudah-migrasi"') < pos('PHASE="7-smoke"'));
  assert.match(t, /live_ro_f "\$WORK\/katalog\.sql"/);
});
