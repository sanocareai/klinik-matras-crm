// Skrip rilis "Koreksi Saldo per Bahan": pin migrasi sesuai berkas, pemindai DDL menolak mutan, gerbang berurutan, allowlist tidak memuat jalur Finance/izin/index.js, jalur resmi Penyesuaian Stok tidak dilewati,
// layanan koreksi tidak menulis ledger/valuasi/jurnal, guard rollback baca-saja, bash lolos sintaks.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const lf = (t) => t.replace(/\r\n/g, "\n");
const baca = (rel) => lf(fs.readFileSync(path.join(repo, rel), "utf8"));
const NAMA_MIG = "20261231100000_koreksi_saldo_bahan"; // sesudah 20261231090000_harga_berlaku_bahan (migrasi terakhir live a4efda02): urutan jelas, tanpa timestamp kembar
const migSql = baca(`backend/prisma/migrations/${NAMA_MIG}/migration.sql`);
const skrip = baca("scripts/release-koreksi-saldo.sh");
const guard = baca("scripts/rollback-guard-koreksi-saldo.sh");
const bersih = (sql) => sql.split("\n").filter((l) => !/^\s*--/.test(l) && l.trim() !== "").join("\n") + "\n";
const pindai = (sql) => spawnSync(process.execPath, [path.join(repo, "scripts/lib/scan-migrasi-koreksi-saldo.mjs")], { input: bersih(sql), encoding: "utf8" });

test("pin migrasi di skrip rilis = sha256 isi berkas migrasi (LF); nama cocok; migrasi hanya objek baru (ALTER hanya 2 FK RESTRICT pada tabel baru)", () => {
  const pin = skrip.match(/^MIG_PIN="([0-9a-f]{64})"$/m)?.[1]; const nama = skrip.match(/^MIG_NAME="([^"]+)"$/m)?.[1];
  assert.equal(nama, NAMA_MIG); assert.equal(pin, crypto.createHash("sha256").update(migSql).digest("hex"));
  const stmt = bersih(migSql).split(";").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  const alter = stmt.filter((x) => /^ALTER TABLE/.test(x)); assert.ok(alter.length === 2 && alter.every((x) => /ADD CONSTRAINT "[a-z0-9_]+" FOREIGN KEY .* ON DELETE RESTRICT ON UPDATE CASCADE$/.test(x)), "ALTER hanya 2 FK RESTRICT");
  assert.ok(alter.every((x) => /^ALTER TABLE "koreksi_saldo_bahan"/.test(x)), "ALTER hanya pada tabel baru");
  assert.equal([...migSql.matchAll(/CREATE TABLE "/g)].length, 1);
});

test("migrasi: CHECK (fisik ≥ 0, selisih ≠ 0 dan = fisik − saldo dilihat, keadaan dikenal, belum-ada-catatan ⇔ 0 pergerakan), unik per permintaan penyesuaian dan per kunci, trigger append-only", () => {
  for (const s of ["koreksi_saldo_bahan_fisik_chk", "\"jumlah_fisik\" >= 0", "koreksi_saldo_bahan_selisih_chk", "\"selisih\" <> 0 AND \"selisih\" = \"jumlah_fisik\" - \"saldo_dilihat\"", "koreksi_saldo_bahan_keadaan_chk", "koreksi_saldo_bahan_catatan_chk",
    "CREATE UNIQUE INDEX \"koreksi_saldo_bahan_adjustment_request_id_key\"", "CREATE UNIQUE INDEX \"koreksi_saldo_bahan_idempotency_key_key\""]) assert.ok(migSql.includes(s), s);
  assert.match(migSql, /CREATE TRIGGER "koreksi_saldo_bahan_append_only_trg" BEFORE UPDATE OR DELETE ON "koreksi_saldo_bahan"/);
});

test("pemindai DDL: migrasi asli lulus dengan hitungan yang dipin; semua mutan ditolak atau berhitungan beda", () => {
  const ok = pindai(migSql); assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout.trim(), skrip.match(/^SCAN_EXPECT='([^']+)'$/m)[1]);
  const mutan = {
    "DROP TABLE units": migSql + 'DROP TABLE "units";\n', "UPDATE units": migSql + "UPDATE \"units\" SET \"status\" = 'X';\n", "DELETE": migSql + 'DELETE FROM "units";\n', "INSERT tabel baru": migSql + "INSERT INTO \"koreksi_saldo_bahan\" (id) VALUES ('x');\n",
    "UPDATE stock_movements": migSql + 'UPDATE "stock_movements" SET "qty" = 0;\n', "INSERT stock_movements": migSql + "INSERT INTO \"stock_movements\" (id) VALUES ('x');\n",
    "ALTER materials": migSql + 'ALTER TABLE "materials" ADD COLUMN "x" TEXT;\n', "ALTER stock_adjustment_requests": migSql + 'ALTER TABLE "stock_adjustment_requests" ADD COLUMN "x" TEXT;\n', "ALTER tabel baru": migSql + 'ALTER TABLE "koreksi_saldo_bahan" ADD COLUMN "x" TEXT;\n',
    "CREATE TABLE liar": migSql + 'CREATE TABLE "x" ("id" UUID NOT NULL, CONSTRAINT "x_pkey" PRIMARY KEY ("id"));\n',
    "FK CASCADE": migSql.split("ON DELETE RESTRICT").join("ON DELETE CASCADE"), "FK SET NULL": migSql.split("ON DELETE RESTRICT").join("ON DELETE SET NULL"),
    "trigger dibuang": migSql.split("\n").filter((l) => !l.includes('CREATE TRIGGER "koreksi_saldo_bahan_append_only_trg"')).join("\n"), "fungsi liar": migSql + 'CREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;\n',
    "badan fungsi DROP": migSql.replace("RAISE EXCEPTION", "DROP TABLE units; RAISE EXCEPTION"), "GRANT": migSql + 'GRANT ALL ON "units" TO PUBLIC;\n', "EXTENSION": migSql + 'CREATE EXTENSION IF NOT EXISTS "pgcrypto";\n', "DISABLE TRIGGER": migSql + 'ALTER TABLE "koreksi_saldo_bahan" DISABLE TRIGGER ALL;\n',
    "indeks di tabel lama": migSql + 'CREATE INDEX "x" ON "units"("status");\n', "FK ke tabel lain": migSql + 'ALTER TABLE "koreksi_saldo_bahan" ADD CONSTRAINT "x" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;\n',
    "FK ke units": migSql + 'ALTER TABLE "koreksi_saldo_bahan" ADD CONSTRAINT "x" FOREIGN KEY ("created_by") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;\n',
  };
  for (const [nama, sql] of Object.entries(mutan)) { const r = pindai(sql); assert.ok(r.status !== 0 || r.stdout.trim() !== ok.stdout.trim(), `mutan '${nama}' lolos pemindai`); }
});

test("skrip rilis: gerbang berurutan; --rehearsal-only berhenti sebelum migrasi produksi; allowlist hanya fitur ini (tanpa izin, index.js, jalur nilai resmi/PSA, migrasi lain)", () => {
  const urut = ['PHASE="1-sumber"', 'PHASE="2-audit-produksi"', 'PHASE="3-backup"', 'PHASE="5-build-image"', 'PHASE="5b-rehearsal"', 'PHASE="6-migrate"', 'PHASE="7-switch"', 'PHASE="8-verifikasi"', 'PHASE="8b-smoke"'].map((x) => skrip.indexOf(x));
  assert.ok(urut.every((x) => x > 0) && urut.every((x, i) => i === 0 || x > urut[i - 1]), `urutan fase: ${urut}`);
  const reh = skrip.indexOf('if [ "$REHEARSAL_ONLY" = "1" ]; then'); assert.ok(reh > urut[4] && reh < urut[5], "rehearsal-only keluar sebelum fase 6 (migrasi produksi)");
  assert.match(skrip, /keadaan_produksi\(\) \{/); assert.match(skrip, /KEADAAN2="\$\(keadaan_produksi "2"\)"/); assert.match(skrip, /struktur_baru RPSQL gagal_reh/); assert.match(skrip, /harus_ditolak "FK CASCADE/);
  assert.match(skrip, /rollback-guard-koreksi-saldo\.sh/);
  assert.ok(!/status-kerja|rjm\.sh|ux-bahan|usulan|hb1\.sh/i.test(skrip.replace(/\n# \(dibangkitkan[^\n]*\n/, "\n").replace(/scripts\/release-status-kerja-buka-pekerjaan\.sh/g, "")), "tidak ada sisa nama rilis lain");
  const allow = skrip.match(/^ALLOWED_RE='(.*)'$/m)[1].split("\\.").join(".");
  for (const harus of ["backend/src/services/koreksiSaldoBahan.js", "backend/src/services/keadaanSaldo.js", "backend/src/services/stokLokasi.js", "backend/src/routes/stockAdjustment.js", "backend/prisma/schema.prisma", `backend/prisma/migrations/${NAMA_MIG}/migration.sql`, "frontend/src/features/warehouse/stok/KoreksiSaldoModal.jsx", "frontend/src/pages/warehouse/WarehouseInventory.jsx"]) assert.ok(allow.includes(harus), `allowlist harus memuat ${harus}`);
  for (const dilarang of ["backend/src/constants/permissions.js", "backend/src/index.js", "nilaiResmi.js", "penetapanNilai.js", "persediaanAwal.js", "koreksiValuasi.js", "services/inventoryLedger.js", "pembetulanBahanUnit.js", "package.json", "docker-compose"]) assert.ok(!allow.includes(dilarang), `berkas di luar fitur ikut terbawa: ${dilarang}`);
  assert.ok(!/backend\/prisma\/migrations\/2026122[0-9]|backend\/prisma\/migrations\/20261230/.test(allow), "tidak membawa migrasi lain");
});

test("jalur resmi TIDAK dilewati: koreksi hanya mengajukan Penyesuaian Stok; persetujuan tetap orang lain; posting tetap lewat postStockMovement; layanan tidak menulis ledger/valuasi/jurnal/harga", () => {
  const svc = baca("backend/src/services/koreksiSaldoBahan.js"); const rute = baca("backend/src/routes/stockAdjustment.js");
  const kode = svc.replace(/\/\/[^\n]*/g, "");
  assert.ok(!/stockMovement\.(create|update|delete)|postStockMovement\(|\$executeRaw|fin[A-Z][A-Za-z]*\.(create|update|delete)|finJournal|materialHargaBerlaku\.(create|update)|biayaOperasional/.test(kode), "layanan koreksi tidak menulis stok/valuasi/jurnal/harga");
  assert.ok(kode.includes("stockAdjustmentRequest.create") && kode.includes('status: "WAITING_APPROVAL"') && kode.includes("requestedById: user.id"), "pengajuan = permintaan Penyesuaian Stok berstatus Menunggu persetujuan");
  assert.ok(!/status:\s*"(APPROVED|POSTED)"|\.stockAdjustmentRequest\.update\(|approvedById\s*:|postedById\s*:/.test(kode), "layanan tidak pernah menyetujui/memposting (APPROVED/POSTED hanya dibaca untuk filter status aktif)");
  assert.match(rute, /"\/koreksi-saldo\/ajukan", requirePermission\(P\.INVENTORY_WRITE\)/); assert.match(rute, /"\/koreksi-saldo\/pratinjau", requirePermission\(P\.INVENTORY_READ\)/);
  const setuju = rute.slice(rute.indexOf('if (status === "APPROVED") {'), rute.indexOf('if (status === "APPROVED") {') + 700);
  assert.ok(setuju.indexOf("wajibPenyetujuPenyesuaian(req.user)") < setuju.indexOf("wajibBukanPihakPengaju") && setuju.indexOf("wajibBukanPihakPengaju") < setuju.indexOf("wajibSaldoBelumBergeser"), "izin penyetuju + pengaju≠penyetuju diperiksa SEBELUM penjaga saldo bergeser");
  const post = rute.slice(rute.indexOf('stockAdjustmentRouter.post("/:id/post"'), rute.indexOf('stockAdjustmentRouter.patch("/:id/cancel"'));
  assert.ok(post.indexOf("wajibSaldoBelumBergeser") > 0 && post.indexOf("wajibSaldoBelumBergeser") < post.indexOf("postStockMovement("), "penjaga saldo bergeser berjalan sebelum postStockMovement");
  assert.ok(post.includes("request.approvedById === request.requestedById"), "pertahanan berlapis pengaju≠penyetuju saat posting tetap ada");
});

test("guard rollback: baca-saja (transaksi READ ONLY); LULUS hanya bila tabel tak ada ATAU tak ada koreksi yang masih berjalan; menolak bila ada Draf/Menunggu/Disetujui; keadaan tak dikenal = tolak; bash lolos sintaks", () => {
  assert.match(guard, /BEGIN READ ONLY/);
  const tanpaKomentar = guard.replace(/\n#[^\n]*/g, "");
  assert.ok(!/\b(insert into|update [a-z_"]+ set|delete from|drop |truncate|alter table)\b/i.test(tanpaKomentar), "guard tidak menulis");
  for (const t of ["GUARD DITOLAK", "GUARD LULUS", "exit 2", "exit 1", "exit 0", "RUTIN TIDAK DIPERBOLEHKAN", "saldo bergeser", "Penyesuaian Stok", "'DRAFT','WAITING_APPROVAL','APPROVED'"]) assert.ok(guard.includes(t), t);
  assert.ok(guard.includes('if [ "$NJ" = "0" ]; then'), "LULUS hanya bila tidak ada koreksi yang masih berjalan");
  assert.equal(guard.split("GUARD LULUS").length - 1, 2, "persis dua pesan LULUS (tabel belum ada; tidak ada koreksi berjalan)");
  assert.ok(guard.indexOf("GUARD LULUS: tidak ada koreksi saldo yang masih berjalan") < guard.indexOf("RUTIN TIDAK DIPERBOLEHKAN"), "cabang LULUS mendahului penolakan; sisanya DITOLAK");
  // Pelajaran rehearsal 26 Okt: literal enum yang tidak ada ('REJECTED') membuat guard gagal di database nyata. Semua literal status di guard WAJIB anggota enum AdjustmentRequestStatus.
  const enumStatus = baca("backend/prisma/schema.prisma").match(/enum AdjustmentRequestStatus \{([^}]*)\}/)[1].split("\n").map((x) => x.trim()).filter((x) => /^[A-Z_]+$/.test(x));
  const literal = [...new Set([...tanpaKomentar.matchAll(/'([A-Z_]{4,})'/g)].map((m) => m[1]))];
  assert.ok(literal.length >= 4 && literal.every((x) => enumStatus.includes(x)), `literal status di guard di luar enum: ${literal.filter((x) => !enumStatus.includes(x))}`);
  for (const f of ["scripts/rollback-guard-koreksi-saldo.sh", "scripts/release-koreksi-saldo.sh"]) { const r = spawnSync("bash", ["-n", path.join(repo, f)], { encoding: "utf8" }); if (r.error) continue; assert.equal(r.status, 0, r.stderr); }
});

test("skrip rilis menguji guard secara NYATA dan menjalankan skenario koreksi di rehearsal: LULUS pada keadaan kosong (rehearsal + produksi pasca-switch), MENOLAK sesudah ada koreksi berjalan; saldo bergeser, pengaju≠penyetuju, tiga nol", () => {
  for (const t of ["guard-kosong.log", "guard-menolak.log", 'GUARD_DB="$REH_DB" bash "$NEW_DIR/scripts/rollback-guard-koreksi-saldo.sh"', "guard rollback TIDAK menolak", "guard rollback MENGUBAH data", "GUARD_PROD_RC",
    "SALDO_BERGESER", "pengaju TIDAK dapat menyetujui sendiri", "NOL_TERVERIFIKASI", "NOL_MENURUT_PERGERAKAN", "BELUM_ADA_CATATAN", "trigger DB: konteks koreksi tidak bisa diubah atau dihapus", "KUNCI_WAJIB", "satu koreksi dibiarkan Menunggu persetujuan"]) assert.ok(skrip.includes(t), t);
  assert.ok(skrip.indexOf("guard-menolak.log") > skrip.indexOf("<<'REHNODE'") && skrip.indexOf("guard-menolak.log") < skrip.indexOf('ok "rehearsal lulus:'), "guard-menolak berjalan SESUDAH skenario dan SEBELUM DB rehearsal dihapus");
  assert.ok(skrip.includes('"pengajuan serentak ×4 (kunci sama)') || skrip.includes("pengajuan serentak ×4 (kunci sama)"), "klik ganda diuji di rehearsal");
});

test("smoke pasca-rilis: baca-saja + penolakan sebelum menyentuh data (kunci/alasan wajib), 401/403, sidik jari tabel identik sebelum vs sesudah", () => {
  for (const t of ["KUNCI_WAJIB", "ALASAN_WAJIB", "JUMLAH_MINUS", "TIDAK ada jejak tulis", "stock_adjustment_requests", "koreksi_saldo_bahan", "SMOKE_HASIL fail="]) assert.ok(skrip.includes(t), t);
  const ajukanSmoke = skrip.slice(skrip.indexOf("const nk = await post("), skrip.indexOf("const nb = await get("));
  assert.ok(!/jumlahFisik: 1, saldoDilihat: 0, alasan: "[^"]{5,}" \}, \{ "Idempotency-Key"/.test(ajukanSmoke), "smoke tidak pernah mengirim pengajuan yang lolos validasi");
});
