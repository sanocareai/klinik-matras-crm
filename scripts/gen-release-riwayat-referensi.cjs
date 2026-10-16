// Generator skrip rilis bergerbang "Riwayat Referensi" (backend + web + 1 migrasi ADITIF: 2 tabel baru, kosong, tanpa backfill).
//
// Hasilnya: scripts/release-riwayat-referensi.sh — diturunkan dari templat gerbang yang sudah terbukti (scripts/release-identitas-pemeriksa-hitung.sh) ditambah fase migrasi
// (verifier riwayat migrasi, rehearsal pada restore backup NYATA, uji perilaku constraint, migrate deploy sekali) dan smoke baca-saja (scripts/lib/smoke-riwayat-referensi.mjs).
// Semua masukan berasal dari REPO ini; tidak bergantung pada helper di luar repo.
//
//   node scripts/gen-release-riwayat-referensi.cjs                # bangkitkan ulang (daftar berkas dihitung dari git terhadap --base, default origin/main)
//   node scripts/gen-release-riwayat-referensi.cjs --check        # gagal (exit 1) bila skrip yang tersimpan berbeda dari hasil bangkitan ulang
//   node scripts/gen-release-riwayat-referensi.cjs --base <ref>   # basis pembanding (live = origin/main saat rilis)
//
// WAJIB dibangkitkan ulang dari commit FINAL setelah origin/main digabung (allowlist = berkas yang berbeda dari basis). Skrip rilis menolak berkas di luar allowlist.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const SUFIKS_MIGRASI = "_stok_riwayat_referensi";
const TEMPLAT = "scripts/release-identitas-pemeriksa-hitung.sh";
const SMOKE = "scripts/lib/smoke-riwayat-referensi.mjs";
const OUT_REL = "scripts/release-riwayat-referensi.sh";
const lf = (t) => t.replace(/\r\n/g, "\n");
const must = (c, m) => { if (!c) throw new Error("templat/masukan tak cocok: " + m); };

/** Murni: tidak menyentuh git/disk. Mengembalikan { script, ringkasan }. */
function bangkitkan({ templateSrc, berkasList, migName, migSql, smokeSrc }) {
  let s = lf(templateSrc); smokeSrc = lf(smokeSrc);
  const swap = (a, b) => { must(s.includes(a), a.slice(0, 80)); s = s.replace(a, () => b); };
  const swapLine = (prefix, b) => { const Ls = s.split("\n"); const i = Ls.findIndex((l) => l.startsWith(prefix)); must(i >= 0, prefix); Ls[i] = b; s = Ls.join("\n"); };
  must(/^\d{14}_[a-z0-9_]+$/.test(migName), "nama migrasi tidak valid: " + migName);
  const berkas = [...new Set([...berkasList, OUT_REL])].filter((f) => !f.startsWith("frontend/dist/")).sort();
  const esc = (f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const backendSrc = berkas.filter((f) => f.startsWith("backend/src/"));
  const frontendSrc = berkas.filter((f) => f.startsWith("frontend/src/"));
  const prismaOk = ["backend/prisma/schema.prisma", `backend/prisma/migrations/${migName}/migration.sql`];
  for (const p of prismaOk) must(berkas.includes(p), "berkas prisma tidak ada di diff: " + p);
  must(!berkas.some((f) => /^backend\/prisma\//.test(f) && !prismaOk.includes(f)), "perubahan prisma lain di luar schema + migrasi rilis");
  const migSha = crypto.createHash("sha256").update(lf(migSql)).digest("hex");
  const templateSha = crypto.createHash("sha256").update(lf(templateSrc)).digest("hex");

// ---- header ----
const header = `#!/usr/bin/env bash
# RILIS RIWAYAT REFERENSI HISTORIS DARI FILE — BACKEND + WEB + 1 MIGRASI ADITIF (2 tabel baru, kosong, tanpa backfill). FAIL-CLOSED.
#   • Catatan REFERENSI dari file (rekap pemakaian per order, log pembelian) bisa dilihat di SANSS, terpisah dan berlabel dari GR/Material Issue/movement/saldo. Tidak ada kode yang menulis stok/jurnal dari catatan ini.
#   • Tanggal pemakaian selalu kosong (CHECK database). Status mengikuti kondisi dokumen resmi TERKINI tanpa impor ulang; revisi append-only. T0 tidak menyaring baris.
# URUTAN AMAN: (1) gerbang sumber (ancestry, allowlist, pin sha256 migrasi, tepat 1 migrasi pending) → (2) audit produksi baca-saja → (3) backup + restore nyata → (4) build web + image
#              → (5) verifier riwayat migrasi dari image BARU terhadap DB produksi (baca-saja; migrasi yang sudah terpasang tidak boleh berubah) → (6) REHEARSAL migrasi + uji perilaku constraint pada restore backup NYATA
#              → (7) migrate deploy produksi SATU kali (backend lama tetap melayani) → (8) switch backend → (9) verifikasi + smoke baca-saja + snapshot.
# Workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA); dist frontend DIBANGUN di release dir (aset lama dibawa). Tidak ada tulis data produksi selain migrasi aditif (tabel baru kosong).
#
#   cat scripts/release-riwayat-referensi.sh | tr -d '\\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/rr.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/rr.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'      # DRY-RUN: produksi TIDAK diubah
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/rr.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/rr.out 2>&1 < /dev/null &'
#
# PRASYARAT SEBELUM MENJALANKAN: branch kandidat sudah di-merge/rebase ke origin/main TERBARU (release aktif HARUS leluhur kandidat), di-push, dan daftar berkas di skrip ini dibangkitkan ulang dari commit final (make_release_rr.cjs).
# ROLLBACK: kode aman kapan saja (tag image rollback-pre-rr-<sha8>); 2 tabel baru TIDAK dihapus (kosong/aditif, tidak dibaca kode lama). Pemulihan database penuh hanya bila terjadi kerusakan data (backup + checksum dicetak).
`;
const hEnd = s.indexOf("set -Eeuo pipefail"); must(hEnd > 0, "set -Eeuo");
s = header + s.slice(hEnd);

swap('CAND_BRANCH="${CAND_BRANCH:-feat/stok-identitas-pemeriksa-hitung}"', 'CAND_BRANCH="${CAND_BRANCH:-feat/stok-mulai-catat-rekon-okt}"');
swapLine("ALLOWED_RE=", `ALLOWED_RE='^(${berkas.map(esc).join("|")})$'`);
swapLine("BACKEND_SRC_EXPECT=", `BACKEND_SRC_EXPECT="${backendSrc.join(" ")}"`);
swapLine("FRONTEND_SRC_EXPECT=", `FRONTEND_SRC_EXPECT="${frontendSrc.join(" ")}"\nMIG_LIST="${migName}"; MIG_SHA="${migSha}"`);
swap('# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Prisma/package/frontend/migrasi tidak boleh ikut.', '# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Prisma hanya schema.prisma + TEPAT satu migrasi baru (pin sha256); package/compose/Dockerfile tidak boleh ikut.');

// ---- penamaan ----
swap('BK_DIR="$HOME/release-backups/identitas-pemeriksa-${DEPLOY_SHORT}-${TS}"', 'BK_DIR="$HOME/release-backups/riwayat-referensi-${DEPLOY_SHORT}-${TS}"');
swap("exec 9>/tmp/release-identitas-pemeriksa-hitung.lock", "exec 9>/tmp/release-riwayat-referensi.lock");
swap('grep -v "pid\\|release-identitas-pemeriksa-hitung\\|pgrep\\|node src/index.js"', 'grep -v "rr\\|release-riwayat-referensi\\|pgrep\\|node src/index.js"');
swap('BACKUP_FILE="$HOME/backups/pre-pid-${DEPLOY_SHORT}-${TS}.sql.gz"', 'BACKUP_FILE="$HOME/backups/pre-rr-${DEPLOY_SHORT}-${TS}.sql.gz"');
swap('REH_DB="rehearsal_pid_${TS}"', 'REH_DB="rehearsal_rr_restore_${TS}"');
swap('ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-pid-${DEPLOY_SHORT}"', 'ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-rr-${DEPLOY_SHORT}"');
swap("Rilis ini TIDAK punya migrasi dan TIDAK mengubah data: rollback kode tidak membutuhkan pemulihan database.", "Rilis ini hanya menambah 2 tabel kosong (aditif): rollback KODE tidak membutuhkan pemulihan database; tabel baru dibiarkan.");

// ---- gerbang prisma: tepat schema + 1 migrasi dengan pin sha256 ----
swap(`! printf '%s\\n' "$CHANGED" | grep -qE '^backend/prisma/|package(-lock)?\\.json$|^docker-compose|Dockerfile' || die "prisma/dependensi/compose berubah — rilis ini tanpa migrasi dan tanpa dependensi baru"`,
`[ "$(printf '%s\\n' "$CHANGED" | grep -E '^backend/prisma/' | LC_ALL=C sort | tr '\\n' ' ' | sed 's/ $//')" = "backend/prisma/migrations/\${MIG_LIST}/migration.sql backend/prisma/schema.prisma" ] || die "perubahan backend/prisma bukan TEPAT schema.prisma + migrasi rilis ini (migrasi yang sudah pernah diterapkan tidak boleh diganti)"
! printf '%s\\n' "$CHANGED" | grep -qE 'package(-lock)?\\.json$|^docker-compose|Dockerfile' || die "dependensi/compose berubah — rilis ini tanpa dependensi baru"
[ "$(sg show "\${DEPLOY_SHA}:backend/prisma/migrations/\${MIG_LIST}/migration.sql" | tr -d '\\r' | sha256sum | cut -d' ' -f1)" = "$MIG_SHA" ] || die "isi migrasi \${MIG_LIST} berbeda dari pin sha256 yang diaudit"
SQLM="$(sg show "\${DEPLOY_SHA}:backend/prisma/migrations/\${MIG_LIST}/migration.sql" | tr -d '\\r')"
! printf '%s\\n' "$SQLM" | grep -qiE '^\\s*(DROP|TRUNCATE|DELETE\\s+FROM|UPDATE\\s)' || die "migrasi memuat DROP/TRUNCATE/DELETE FROM/UPDATE"
! printf '%s\\n' "$SQLM" | grep -iE '^\\s*ALTER\\s+TABLE' | grep -viE '^\\s*ALTER\\s+TABLE\\s+"stok_riwayat_(referensi|impor)"' | grep -q . || die "migrasi mengubah tabel di luar 2 tabel baru"`);

// ---- audit produksi: migrasi pending harus TEPAT migrasi rilis ini ----
swap(`ok "migrasi terpasang sebelum rilis = \${MIG_SEBELUM} (harus tidak berubah)"`,
`ok "migrasi terpasang sebelum rilis = \${MIG_SEBELUM} (akan menjadi +1)"
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$BK_DIR/applied-sebelum.txt" || die "gagal membaca migrasi terpasang"
grep -Fx "$MIG_LIST" "$BK_DIR/applied-sebelum.txt" >/dev/null && die "migrasi \${MIG_LIST} SUDAH terpasang sebelum rilis (tidak diharapkan)"
CAND_MIGS="$(sg ls-tree --name-only "$DEPLOY_SHA" backend/prisma/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_' | LC_ALL=C sort -u)"
SOLO_PROD="$(comm -13 <(printf '%s\\n' "$CAND_MIGS") "$BK_DIR/applied-sebelum.txt" || true)"
[ -z "$SOLO_PROD" ] || { printf '%s\\n' "$SOLO_PROD" | sed 's/^/        /'; die "produksi memiliki migrasi yang TIDAK ada di kandidat — gabungkan origin/main terbaru ke kandidat dulu"; }
PENDING="$(comm -23 <(printf '%s\\n' "$CAND_MIGS") "$BK_DIR/applied-sebelum.txt" || true)"
[ "$PENDING" = "$MIG_LIST" ] || die "migrasi pending bukan TEPAT migrasi rilis ini (pending: $(printf '%s' "$PENDING" | tr '\\n' ' '))"
TERAKHIR="$(LC_ALL=C sort "$BK_DIR/applied-sebelum.txt" | tail -n 1)"
[[ "$MIG_LIST" > "$TERAKHIR" ]] || die "nama migrasi rilis ($MIG_LIST) tidak lebih baru dari migrasi terpasang terakhir ($TERAKHIR) — urutan tidak aman"
ok "tepat 1 migrasi pending (\${MIG_LIST}); terurut SETELAH migrasi terpasang terakhir (\${TERAKHIR}); nama tanggal pada nama migrasi BUKAN bukti siap rilis — yang diperiksa adalah isi + riwayat terpasang"`);

// ---- dist: teks fitur baru ----
{
  const L = s.split("\n"); const i = L.findIndex((l) => l.startsWith('for s1 in "Ajukan Penyesuaian"')); must(i >= 0, "dist s1");
  L[i] = L[i].replace(/for s1 in "[^;]*; do/, 'for s1 in "Riwayat Referensi (bukan transaksi)" "Riwayat referensi dari file (bukan transaksi)" "Antrean penyelesaian" "Setelah tanggal itu belum ada data" "Saya memeriksa hitungan ini"; do');
  must(L[i].includes('"Antrean penyelesaian"'), "dist teks baru"); s = L.join("\n");
}

// ---- fase migrasi: setelah build image ----
const SKEMA = `select md5(coalesce(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable, ',' order by table_name, ordinal_position), '')) from information_schema.columns where table_schema='public' and table_name not in ('stok_riwayat_referensi','stok_riwayat_impor')`;
const fase = `
PHASE="5a-verifier"; say "5a. Verifier riwayat migrasi dari image BARU terhadap DB produksi (baca-saja): semua migrasi terpasang checksum-identik"
VER_OUT="$(dcp "$NEW_DIR" run --rm --no-deps -T backend node scripts/verify-migration-history.js </dev/null 2>&1)" || { printf '%s\\n' "$VER_OUT" | tail -n 15; die "verifier riwayat migrasi GAGAL — ada migrasi terpasang yang berubah/tidak cocok; JANGAN migrasi"; }
printf '%s\\n' "$VER_OUT" > "$BK_DIR/verifier.out"
printf '%s\\n' "$VER_OUT" | grep -F "pending: \${MIG_LIST}" >/dev/null || { printf '%s\\n' "$VER_OUT" | tail -n 8; die "verifier tidak melaporkan pending TEPAT \${MIG_LIST}"; }
ok "verifier: migrasi terpasang tidak berubah; pending = \${MIG_LIST}"
docker run --rm --entrypoint sh "$NEW_IMG_ID" -c "cat /app/prisma/migrations/\${MIG_LIST}/migration.sql" 2>/dev/null | tr -d '\\r' | sha256sum | cut -d' ' -f1 | grep -Fx "$MIG_SHA" >/dev/null || die "image baru memuat migrasi berbeda dari pin sha256"
ok "image baru memuat migrasi persis pin sha256"

PHASE="5c-rehearsal"; say "5c. REHEARSAL: backup NYATA dipulihkan ke DB sementara, migrasi diterapkan dengan image baru, perilaku constraint diuji, skema tabel lama dibandingkan, DB sementara dihapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_rr_mig_\${TS}"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \\"\${REH_DB}\\"" </dev/null || die "gagal membuat DB rehearsal"
reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \\"\${REH_DB}\\"" </dev/null >/dev/null 2>&1 || true; }
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-mig.log" 2>&1 || true
RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
RTOLAK() { if dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -v ON_ERROR_STOP=1 -c "$1" </dev/null >/dev/null 2>&1; then reh_drop; die "perilaku SALAH — perintah ini seharusnya DITOLAK: $2"; fi; }
ROK() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -v ON_ERROR_STOP=1 -c "$1" </dev/null >/dev/null 2>&1 || { reh_drop; die "perintah yang seharusnya LOLOS ditolak: $2"; }; }
SKEMA_SQL="${SKEMA}"
S_SEBELUM="$(RPSQL "$SKEMA_SQL")"; [ -n "$S_SEBELUM" ] || { reh_drop; die "sidik jari skema rehearsal kosong"; }
REH_PW="$(sed -n 's/^DATABASE_URL="\\?postgresql:\\/\\/[^:]*:\\([^@]*\\)@.*/\\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
[ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
REH_URL="postgresql://\${DB_USER}:\${REH_PW}@postgres:5432/\${REH_DB}"
N_SEBELUM="$(RPSQL "select (select count(*) from stock_movements)||'/'||(select count(*) from materials)||'/'||(select count(*) from fin_journal_entries)||'/'||(select count(*) from goods_receipts)")"
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="$REH_URL" backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-rehearsal.log"; reh_drop; die "migrate deploy di DB rehearsal GAGAL (produksi tidak disentuh)"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="$REH_URL" backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || { reh_drop; die "migrate status rehearsal tidak 'up to date'"; }
[ "$(RPSQL "select count(*) from information_schema.tables where table_schema='public' and table_name in ('stok_riwayat_referensi','stok_riwayat_impor')")" = "2" ] || { reh_drop; die "2 tabel baru tidak terpasang di rehearsal"; }
for T in stok_riwayat_referensi stok_riwayat_impor; do [ "$(RPSQL "select count(*) from $T")" = "0" ] || { reh_drop; die "tabel baru $T TIDAK kosong setelah migrasi (backfill tidak diizinkan)"; }; done
[ "$(RPSQL "select count(*) from pg_trigger where tgname in ('stok_riwayat_referensi_append_only_trg','stok_riwayat_impor_append_only_trg')")" = "2" ] || { reh_drop; die "trigger append-only tidak terpasang"; }
ok "rehearsal: migrate deploy lulus; 2 tabel baru kosong; trigger append-only terpasang; status up to date"
ROK "insert into stok_riwayat_impor (id, hash_konten, ringkasan) values ('00000000-0000-4000-8000-0000000000a1','h','{}'::jsonb)" "impor valid"
INS() { printf "insert into stok_riwayat_referensi (id, impor_id, kunci, revisi, konten_hash, jenis, nama_di_file, satuan_file, sumber_file, sumber_baris, status_verifikasi, alasan_blocker, peringatan, jumlah%s) values ('%s','00000000-0000-4000-8000-0000000000a1','%s',%s,'h','%s','n','METER','f','{1}','%s','{}','{}',%s%s)" "$6" "$1" "$2" "$3" "$4" "$5" "$7" "$8"; }
ROK "$(INS 00000000-0000-4000-8000-0000000000b1 k1 1 PEMAKAIAN_ORDER BELUM_DIVERIFIKASI '' 3 '')" "baris referensi valid"
ROK "$(INS 00000000-0000-4000-8000-0000000000b2 k2 1 PENERIMAAN_TERBUKTI_TANPA_GR PERLU_PEMERIKSAAN '' NULL '')" "jumlah tidak terbaca disimpan kosong (bukan nol)"
RTOLAK "$(INS 00000000-0000-4000-8000-0000000000b3 k3 1 PEMAKAIAN_ORDER BELUM_DIVERIFIKASI ', tanggal_pemakaian' 3 ", '2026-10-05'")" "tanggal pemakaian terisi"
RTOLAK "$(INS 00000000-0000-4000-8000-0000000000b4 k4 1 JENIS_LAIN BELUM_DIVERIFIKASI '' 3 '')" "jenis di luar daftar"
RTOLAK "$(INS 00000000-0000-4000-8000-0000000000b5 k5 1 PEMAKAIAN_ORDER STATUS_LAIN '' 3 '')" "status di luar daftar"
RTOLAK "$(INS 00000000-0000-4000-8000-0000000000b6 k1 1 PEMAKAIAN_ORDER BELUM_DIVERIFIKASI '' 3 '')" "kunci+revisi ganda"
RTOLAK "delete from stok_riwayat_referensi" "DELETE referensi"
RTOLAK "update stok_riwayat_referensi set jumlah = 99" "UPDATE isi referensi"
RTOLAK "delete from stok_riwayat_impor" "DELETE batch impor"
RTOLAK "update stok_riwayat_impor set hash_konten = 'x'" "UPDATE batch impor"
ROK "update stok_riwayat_referensi set aktif = false where id = '00000000-0000-4000-8000-0000000000b1'" "membalik aktif true→false (revisi)"
RTOLAK "update stok_riwayat_referensi set aktif = true where id = '00000000-0000-4000-8000-0000000000b1'" "membalik aktif false→true"
ok "perilaku constraint terbukti di restore backup nyata: tanggal pemakaian/jenis/status salah ditolak; DELETE & UPDATE isi ditolak; hanya aktif true→false yang boleh"
[ "$(RPSQL "$SKEMA_SQL")" = "$S_SEBELUM" ] || { reh_drop; die "migrasi MENGUBAH skema tabel lama"; }
[ "$(RPSQL "select (select count(*) from stock_movements)||'/'||(select count(*) from materials)||'/'||(select count(*) from fin_journal_entries)||'/'||(select count(*) from goods_receipts)")" = "$N_SEBELUM" ] || { reh_drop; die "migrasi/uji rehearsal MENGUBAH isi tabel lama (movement/material/jurnal/GR)"; }
reh_drop; REH_DB=""
ok "rehearsal lulus: skema & isi tabel lama IDENTIK sebelum vs sesudah; DB sementara dihapus"

PHASE="6-migrate"; say "6. Migrasi aditif ke produksi (image baru; backend lama tetap melayani)"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "image container aktif berubah selama persiapan — JANGAN migrasi"
[ "$(sed -n 1p "$PREV_DIR/.release-commit" | tr -d '[:space:]')" = "$PREV_COMMIT" ] || die "baseline berubah selama persiapan"
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$BK_DIR/applied-sebelum2.txt" || die "gagal membaca migrasi terpasang"
cmp -s "$BK_DIR/applied-sebelum.txt" "$BK_DIR/applied-sebelum2.txt" || die "daftar migrasi terpasang berubah selama persiapan (sesi lain menerapkan migrasi) — berhenti, ulangi preflight"
psql_live -At -c "$SKEMA_SQL" > "$BK_DIR/skema-prod-sebelum.txt" || die "sidik jari skema produksi sebelum gagal"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( MIG_SEBELUM + 1 ))" ] || die "jumlah migrasi terpasang != sebelum + 1"
psql_live -At -c "select finished_at is not null from _prisma_migrations where migration_name='\${MIG_LIST}'" | grep -Fx t >/dev/null || die "\${MIG_LIST} tidak tercatat selesai"
for T in stok_riwayat_referensi stok_riwayat_impor; do [ "$(psql_live -At -c "select count(*) from $T")" = "0" ] || die "tabel baru $T TIDAK kosong setelah migrasi"; done
[ "$(psql_live -At -c "$SKEMA_SQL")" = "$(cat "$BK_DIR/skema-prod-sebelum.txt")" ] || die "skema tabel lama BERUBAH oleh migrasi (jangan switch)"
curl -fsS --max-time 8 "\${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah migrasi aditif"
ok "1 migrasi diterapkan (\${MIG_SEBELUM} → $(( MIG_SEBELUM + 1 ))); 2 tabel baru kosong; skema tabel lama identik; backend lama tetap sehat"
`;
swap(`ok "image baru \${NEW_IMG_ID:7:12}; container aktif masih \${PREV_IMG_ID:7:12}"\n`, `ok "image baru \${NEW_IMG_ID:7:12}; container aktif masih \${PREV_IMG_ID:7:12}"\n` + fase);

// ---- smoke ----
{
  const smoke = smokeSrc;
  const heredoc = "cat > \"$BK_DIR/smoke.mjs\" <<'NODE'\n";
  const a = s.indexOf(heredoc); must(a > 0, "heredoc"); const bs = a + heredoc.length; const be = s.indexOf("\nNODE\n", bs); must(be > 0, "akhir heredoc");
  s = s.slice(0, bs) + smoke + s.slice(be + 1);
}
swap('say "8b. Smoke jalur cepat ditutup + sesi hitung + identitas pemeriksa (baca-saja; TIDAK membuat data/transaksi QA di produksi)"', 'say "8b. Smoke riwayat referensi (baca-saja; TIDAK membuat data/transaksi QA di produksi; tabel referensi tetap kosong)"');
swap('say "7. Switch backend ke release baru (SATU kali; tanpa migrasi)"', 'say "7. Switch backend ke release baru (SATU kali; migrasi aditif sudah diterapkan di fase 6)"');
swap(`[ "$MIG_SESUDAH" = "$MIG_SEBELUM" ] || die "jumlah migrasi berubah (\${MIG_SEBELUM} -> \${MIG_SESUDAH}) padahal rilis ini tanpa migrasi"
ok "migrasi terpasang tetap \${MIG_SESUDAH} (tanpa migrasi)"`, `[ "$MIG_SESUDAH" = "$(( MIG_SEBELUM + 1 ))" ] || die "jumlah migrasi bukan sebelum + 1 (\${MIG_SEBELUM} -> \${MIG_SESUDAH})"
ok "migrasi terpasang \${MIG_SESUDAH} = sebelum + 1"`);
  s = s.replace("# RILIS RIWAYAT REFERENSI HISTORIS", `# (dibangkitkan oleh scripts/gen-release-riwayat-referensi.cjs; templat ${TEMPLAT} sha256 ${templateSha.slice(0, 12)}…; JANGAN edit manual — ubah generator lalu bangkitkan ulang)\n# RILIS RIWAYAT REFERENSI HISTORIS`);
  return { script: s, ringkasan: { berkas: berkas.length, backendSrc: backendSrc.length, frontendSrc: frontendSrc.length, migName, migSha, templateSha } };
}

function git(args) { return execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").map((x) => x.trim()).filter(Boolean); }

/** Daftar berkas yang berbeda dari basis. Bila HEAD belum memuat basis (belum digabung), pakai merge-base dan beri peringatan. */
function berkasBerbeda(base) {
  let ref = base, belumGabung = false;
  try { execFileSync("git", ["merge-base", "--is-ancestor", base, "HEAD"], { cwd: REPO, stdio: "ignore" }); } catch { ref = git(["merge-base", "HEAD", base])[0]; belumGabung = true; }
  const list = new Set([...git(["diff", "--name-only", ref]), ...git(["ls-files", "-o", "--exclude-standard"])]);
  return { list: [...list], ref, belumGabung };
}

function main() {
  const arg = process.argv.slice(2); const iBase = arg.indexOf("--base"); const base = iBase >= 0 ? arg[iBase + 1] : "origin/main"; const cek = arg.includes("--check");
  const migDir = fs.readdirSync(path.join(REPO, "backend/prisma/migrations")).filter((n) => n.endsWith(SUFIKS_MIGRASI) && /^\d{14}_/.test(n));
  must(migDir.length === 1, `harus tepat 1 migrasi *${SUFIKS_MIGRASI}, ditemukan: ${migDir.join(",") || "tidak ada"}`);
  const { list, ref, belumGabung } = berkasBerbeda(base);
  const hasil = bangkitkan({
    templateSrc: fs.readFileSync(path.join(REPO, TEMPLAT), "utf8"), berkasList: list, migName: migDir[0],
    migSql: fs.readFileSync(path.join(REPO, "backend/prisma/migrations", migDir[0], "migration.sql"), "utf8"), smokeSrc: fs.readFileSync(path.join(REPO, SMOKE), "utf8"),
  });
  const keluar = path.join(REPO, OUT_REL);
  if (belumGabung) console.error(`PERINGATAN: HEAD belum memuat ${base}; daftar berkas dihitung dari merge-base ${ref.slice(0, 8)}. Gabungkan ${base}, commit, lalu bangkitkan ulang sebelum rilis.`);
  if (cek) {
    const ada = fs.existsSync(keluar) ? lf(fs.readFileSync(keluar, "utf8")) : "";
    if (ada !== hasil.script) { console.error("TIDAK SAMA: " + OUT_REL + " berbeda dari hasil bangkitan ulang. Jalankan tanpa --check."); process.exit(1); }
    console.log("SAMA: " + OUT_REL + " identik dengan hasil bangkitan ulang"); return;
  }
  fs.writeFileSync(keluar, hasil.script);
  console.log("ditulis", OUT_REL, hasil.script.split("\n").length, "baris;", JSON.stringify(hasil.ringkasan));
}
module.exports = { bangkitkan };
if (require.main === module) main();
