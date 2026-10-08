#!/usr/bin/env bash
# Rehearsal kandidat rilis Produksi Fase 1–5 pada SALINAN production (pg_dump baca-saja -> DB scratch di server postgres yang sama -> migrate deploy dari image live + migrations kandidat).
# TIDAK menulis ke database production, tidak menyentuh container live; DB scratch & dump dihapus di akhir. Keluaran hanya hitungan/hash (tanpa data pelanggan).
set -uo pipefail
TS="$(date +%Y%m%d-%H%M%S)"; W="$HOME/rehearsal-fase5-$TS"; mkdir -p "$W"; cd "$W"
cp -r "$HOME/rehearsal-fase5-incoming/prisma" "$W/prisma"; LOG="$W/rehearsal.log"; exec > >(tee -a "$LOG") 2>&1
PG=klinik-matras-postgres-1; BE=klinik-matras-backend-1; NET=klinik-matras_default
DBU="$(docker exec $PG printenv POSTGRES_USER)"; DBN="$(docker exec $PG printenv POSTGRES_DB)"
REH="rehearsal_fase5_${TS//-/_}"
psql_live() { docker exec -i $PG psql -U "$DBU" -d "$DBN" -X -At -q -v ON_ERROR_STOP=1 "$@" </dev/null; }
psql_reh() { docker exec -i $PG psql -U "$DBU" -d "$REH" -X -At -q -v ON_ERROR_STOP=1 "$@" </dev/null; }
reh_drop() { docker exec -i $PG psql -U "$DBU" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"$REH\" WITH (FORCE)" </dev/null >/dev/null 2>&1 || true; }
die() { echo "GAGAL: $*"; reh_drop; rm -f "$W/prod.dump"; exit 1; }
echo "== mulai $TS  DB=$DBN  scratch=$REH"
echo "== release aktif: frontend mount = $(docker inspect $BE --format '{{range .Mounts}}{{.Source}}{{println}}{{end}}' | grep releases | head -1)"
echo "== image live: $(docker inspect $BE --format '{{.Image}}')"
LIVE_MIG="$(psql_live -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"
echo "== migration applied (live, finished & tidak rolled-back): $LIVE_MIG ; menggantung: $(psql_live -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")"
# 1. salinan production (baca-saja)
docker exec $PG pg_dump -U "$DBU" -d "$DBN" -Fc > prod.dump || die "pg_dump"
sha256sum prod.dump | tee prod.dump.sha256; ls -l prod.dump | awk '{print "ukuran dump:", $5}'
docker exec -i $PG psql -U "$DBU" -d postgres -X -q -c "CREATE DATABASE \"$REH\"" </dev/null || die "create scratch"
docker exec -i $PG pg_restore -U "$DBU" -d "$REH" --no-owner --exit-on-error < prod.dump > restore.log 2>&1 || { tail -5 restore.log; die "pg_restore"; }
[ "$(psql_reh -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" -ge "$LIVE_MIG" ] || die "migration scratch < live"
echo "== restore OK; migration di salinan: $(psql_reh -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"
# 2. sidik jari SEBELUM: per tabel, hanya kolom yang sudah ada (kolom baru dari migration tidak ikut), kecuali _prisma_migrations
psql_reh -c "select string_agg(format('select %L as t, count(*)::text as c, md5(coalesce(string_agg(row(%s)::text, ''|'' order by row(%s)::text), '''')) as h from %I', table_name, cols, cols, table_name), E'\nunion all\n' order by table_name) from (select table_name, string_agg(quote_ident(column_name), ',' order by ordinal_position) as cols from information_schema.columns where table_schema='public' and table_name <> '_prisma_migrations' and table_name in (select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE') group by table_name) x" > fp.sql
echo "-- tabel disidikjari: $(grep -c 'select ' fp.sql)"
psql_reh -c "select 'cols' ,table_name, string_agg(column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), ',' order by column_name) from information_schema.columns where table_schema='public' group by table_name order by table_name" > cols-sebelum.txt
docker exec -i $PG psql -U "$DBU" -d "$REH" -X -At -F'|' -q < fp.sql > fp-sebelum.txt || die "fingerprint sebelum"
FLAG_Q="select md5(coalesce(string_agg(f::text,'|' order by f.key),'')) from v2_feature_flags f"
SET_Q="select md5(coalesce(string_agg(s::text,'|' order by s.key),'')) from production_settings s"
FLAG_LIVE="$(psql_live -c "$FLAG_Q")"; FLAG_SEBELUM="$(psql_reh -c "$FLAG_Q")"; SET_SEBELUM="$(psql_reh -c "$SET_Q")"
echo "== flag/cohort md5: live-sekarang=$FLAG_LIVE salinan-sebelum=$FLAG_SEBELUM"; echo "== production_settings md5 salinan-sebelum=$SET_SEBELUM ; baris qc_gate_default_policy=$(psql_reh -c "select count(*) from production_settings where key='qc_gate_default_policy'") ; baris adaptation_default_policy=$(psql_reh -c "select count(*) from production_settings where key='adaptation_default_policy'")"
echo "== flag (key|enabled|scope) di salinan:"; psql_reh -F'|' -c "select key,enabled,scope from v2_feature_flags order by key"
# 3. migrate deploy: image live + migrations KANDIDAT (read-only mount)
DBURL="$(docker exec $BE printenv DATABASE_URL)"; REHURL="$(echo "$DBURL" | sed -E "s#/[^/?]+(\\?.*)?\$#/$REH\\1#")"
IMG="$(docker inspect $BE --format '{{.Image}}')"
RUN_MIG() { docker run --rm --network "$NET" -e DATABASE_URL="$REHURL" -v "$W/prisma:/app/prisma:ro" --entrypoint sh "$IMG" -c "cd /app && npx prisma migrate deploy" 2>&1; }
echo "== PENDING sebelum deploy (migrations kandidat vs applied di salinan):"
ls "$W/prisma/migrations" | grep -v lock | sort > cand.txt; psql_reh -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | sort > applied.txt
comm -13 applied.txt cand.txt | tee pending.txt; echo "(jumlah pending: $(wc -l < pending.txt))"
echo "== applied tapi tidak ada di kandidat (yatim):"; comm -23 applied.txt cand.txt
psql_reh -F'|' -c "select code, sequence from routing_stages order by sequence" > routing-sebelum.txt
RUN_MIG > migrate1.log || { tail -15 migrate1.log; die "migrate deploy"; }
tail -6 migrate1.log
echo "== migrate ulang (replay):"; RUN_MIG | tail -2
POST="$(psql_reh -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"; echo "== migration applied sesudah: $POST (sebelum $LIVE_MIG, +$((POST-LIVE_MIG)))  menggantung: $(psql_reh -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")"
# 4. sidik jari SESUDAH (kolom lama saja) + flag/settings byte-identik
docker exec -i $PG psql -U "$DBU" -d "$REH" -X -At -F'|' -q < fp.sql > fp-sesudah.txt || die "fingerprint sesudah"
psql_reh -F'|' -c "select code, sequence from routing_stages order by sequence" > routing-sesudah.txt; echo "== routing_stages: baris BARU dari migration (aditif):"; diff routing-sebelum.txt routing-sesudah.txt | grep '^[<>]'
echo "== DIFF sidik jari data lama (kosong = tidak ada yang berubah):"; diff fp-sebelum.txt fp-sesudah.txt && echo "(identik: $(wc -l < fp-sebelum.txt) tabel)"
FLAG_SESUDAH="$(psql_reh -c "$FLAG_Q")"; SET_SESUDAH="$(psql_reh -c "$SET_Q")"
[ "$FLAG_SEBELUM" = "$FLAG_SESUDAH" ] && echo "== flag/cohort BYTE-IDENTIK ($FLAG_SESUDAH)" || echo "== FLAG BERUBAH! $FLAG_SEBELUM -> $FLAG_SESUDAH"
[ "$SET_SEBELUM" = "$SET_SESUDAH" ] && echo "== production_settings BYTE-IDENTIK ($SET_SESUDAH); qc_gate_default_policy tetap tidak ada = V2 TIDAK diaktifkan" || echo "== SETTINGS BERUBAH! $SET_SEBELUM -> $SET_SESUDAH"
psql_reh -c "select 'cols' ,table_name, string_agg(column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), ',' order by column_name) from information_schema.columns where table_schema='public' group by table_name order by table_name" > cols-sesudah.txt
echo "== perubahan skema (ditambah/diubah):"; diff cols-sebelum.txt cols-sesudah.txt | grep '^[<>]' | cut -c1-230 | head -60
echo "== kolom BARU pada tabel lama yang NOT NULL tanpa default (harus kosong):"
psql_reh -F'|' -c "select a.table_name||'.'||a.column_name from information_schema.columns a where a.table_schema='public' and a.is_nullable='NO' and a.column_default is null" | sort > nn-sesudah.txt
# tandai hanya kolom yang tidak ada sebelum migrate: dari cols-sebelum (daftar kolom lama)
awk -F'|' '{n=split($3,a,","); for(i=1;i<=n;i++){split(a[i],b,":"); print $2"."b[1]}}' cols-sebelum.txt | sort > kolom-lama.txt
comm -13 kolom-lama.txt nn-sesudah.txt | tee kolom-baru-notnull.txt; echo "(jumlah kolom baru NOT NULL tanpa default pada tabel lama atau baru: $(wc -l < kolom-baru-notnull.txt) — tabel baru boleh)"
# 5. ROLLBACK KODE: image live (kode lama) terhadap DB yang SUDAH dimigrasi — baca/tulis (transaksi di-rollback) tidak rusak oleh kolom/tabel aditif
cat > rb.cjs <<'JS'
const { PrismaClient } = require("@prisma/client");
(async () => {
  const p = new PrismaClient();
  const out = {};
  out.users = await p.user.count(); out.orders = await p.order.count(); out.units = await p.unit.count();
  out.materials = (await p.material.findMany({ take: 5 })).length; out.runs = (await p.productionRun.findMany({ take: 5 })).length;
  out.plans = (await p.productionRunPlan.findMany({ take: 3 })).length; out.evidence = await p.productionStepEvidence.count(); out.moves = (await p.stockMovement.findMany({ take: 3 })).length;
  out.flags = await p.v2FeatureFlag.count(); out.settings = await p.productionSetting.count(); out.po = await p.finPurchaseOrder.count(); out.valuasi = await p.finStockMovementValuation.count();
  out.compEntries = await p.unitComponentEntry.count();
  try { await p.$transaction(async (tx) => { const m = await tx.material.create({ data: { code: "RB-" + Date.now(), name: "Uji rollback kode (dibatalkan)", unit: "PCS", category: "RAW_MATERIAL", active: true } }); out.writeOk = !!m.id; throw new Error("ROLLBACK_SENGAJA"); }); } catch (e) { out.rolledBack = e.message === "ROLLBACK_SENGAJA"; }
  out.materialsSetelah = await p.material.count();
  console.log(JSON.stringify(out)); await p.$disconnect();
})().catch((e) => { console.log("ERR " + e.message); process.exit(1); });
JS
echo "== ROLLBACK KODE (image live = kode lama) terhadap DB termigrasi:"
docker run --rm --network "$NET" -e DATABASE_URL="$REHURL" -v "$W/rb.cjs:/app/rb.cjs:ro" --entrypoint sh "$IMG" -c "cd /app && node rb.cjs" 2>&1 | tail -3
echo "== jumlah materials salinan: $(psql_reh -c "select count(*) from materials") (harus sama dgn sebelum rollback-test)"
# 6. bersih
reh_drop; rm -f "$W/prod.dump"
echo "== scratch dihapus; dump dihapus (sha256 disimpan). Direktori bukti: $W"
echo "== selesai"
