#!/usr/bin/env bash
# Audit isolasi RUNTIME staging latihan (P12B). Hanya MEMBACA (docker inspect/ps) dan satu uji egress dari DALAM container staging (gagal = bagus).
# Jalankan dari root repo:  bash scripts/staging/audit-isolation.sh      Keluar kode 1 bila ada pelanggaran.
set -uo pipefail
PROJECT="${STAGING_PROJECT:-sanss-staging}"
FAIL=0
ok(){ printf '  PASS  %s\n' "$*"; }
bad(){ printf '  FAIL  %s\n' "$*"; FAIL=1; }
chk(){ if eval "$2"; then ok "$1"; else bad "$1"; fi; }

echo "== Container staging ($PROJECT)"
IDS=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT")
[ -n "$IDS" ] || { bad "tidak ada container project $PROJECT berjalan"; exit 1; }
for id in $IDS; do printf '  %s\n' "$(docker inspect -f '{{.Name}} image={{.Config.Image}}' "$id")"; done

echo "== Jaringan: tidak ada container staging di network production / network eksternal"
NETS=$(for id in $IDS; do docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$id"; done | tr ' ' '\n' | sort -u | grep -v '^$')
echo "$NETS" | sed 's/^/  net: /'
chk "semua network berawalan ${PROJECT}_" '[ -z "$(echo "$NETS" | grep -v "^${PROJECT}_")" ]'
chk "tidak ada network production (klinik-matras*)" '! echo "$NETS" | grep -qi "klinik"'
chk "staging_internal bersifat internal=true" '[ "$(docker network inspect ${PROJECT}_staging_internal -f "{{.Internal}}" 2>/dev/null)" = "true" ]'

echo "== Port ke host: hanya edge, hanya 127.0.0.1"
PORTS=$(docker ps --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}} {{.Ports}}' | grep -E '[0-9]+->' || true)
echo "${PORTS:-  (tidak ada)}" | sed 's/^/  /'
chk "tidak ada port yang di-bind ke 0.0.0.0/::" '! echo "$PORTS" | grep -E "(0\.0\.0\.0|\[::\]):[0-9]+->"'
chk "backend & postgres tidak publish port" '! echo "$PORTS" | grep -E "backend-staging|postgres-staging"'

echo "== Volume & mount: tanpa docker.sock / bind ke direktori sistem; volume berprefiks project"
MOUNTS=$(for id in $IDS; do docker inspect -f '{{range .Mounts}}{{.Type}}:{{.Source}}->{{.Destination}}{{"\n"}}{{end}}' "$id"; done)
chk "tanpa docker.sock" '! echo "$MOUNTS" | grep -q "docker.sock"'
chk "volume bernama hanya milik project staging" '[ -z "$(echo "$MOUNTS" | grep "^volume:" | grep -v "${PROJECT}_")" ]'

BE=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=backend-staging")
echo "== Kredensial & DB di container backend-staging"
ENVS=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$BE")
chk "APP_ENV=staging" 'echo "$ENVS" | grep -q "^APP_ENV=staging$"'
chk "DATABASE_URL -> postgres-staging/sanss_staging" 'echo "$ENVS" | grep -q "^DATABASE_URL=postgresql://qa_pv2:[^@]*@postgres-staging:5432/sanss_staging$"'
chk "tanpa kredensial layanan luar (WAHA/SMTP/FCM/OPENAI/ANTHROPIC/MAPS/WEBHOOK)" '! echo "$ENVS" | grep -Ei "^(WAHA|SMTP|SENDGRID|FIREBASE|FCM|OPENAI|ANTHROPIC|GOOGLE_MAPS|WEBHOOK)[A-Z_]*=.+"'
chk "tanpa DB production (host/nama klinik_matras)" '! echo "$ENVS" | grep -Ei "klinik_matras|@postgres:5432|klinik-matras"'

echo "== Egress nyata dari dalam backend-staging (HARUS gagal) & production DB tak terjangkau"
EGRESS=$(docker exec "$BE" node -e '
const dns=require("node:dns").promises;const net=require("node:net");
const t=(p)=>Promise.race([p.then(()=>"TERJANGKAU",()=>"GAGAL"),new Promise(r=>setTimeout(()=>r("GAGAL(timeout)"),6000))]);
(async()=>{
  console.log("internet_https="+await t(fetch("https://example.com",{signal:AbortSignal.timeout(5000)})));
  console.log("dns_publik="+await t(dns.lookup("example.com")));
  console.log("prod_db_hostname_postgres="+await t(dns.lookup("postgres")));
  console.log("prod_db_container="+await t(dns.lookup("klinik-matras-postgres-1")));
  console.log("waha="+await t(dns.lookup("waha")));
  console.log("gateway_host="+await t(new Promise((res,rej)=>{const s=net.connect({host:"host.docker.internal",port:5432,timeout:3000},()=>{s.destroy();res()});s.on("error",rej);s.on("timeout",()=>{s.destroy();rej(new Error("t"))});})));
})();' 2>&1)
echo "$EGRESS" | sed 's/^/  /'
for k in internet_https dns_publik prod_db_hostname_postgres prod_db_container waha gateway_host; do chk "$k tidak terjangkau" 'echo "$EGRESS" | grep -q "^$k=GAGAL"'; done

echo "== Log akses edge aktif"
EDGE=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=edge-staging")
curl -s -o /dev/null "http://127.0.0.1:${STAGING_PORT:-18080}/api/health"; sleep 1   # picu satu request supaya log akses pasti memuat entri baru
chk "nginx edge mencatat akses (docker logs)" 'docker logs --tail 200 "$EDGE" 2>&1 | grep -qE "\"(GET|POST) "'
chk "header X-Environment: staging pada respons" 'curl -sI "http://127.0.0.1:${STAGING_PORT:-18080}/api/health" | grep -qi "x-environment: staging"'

echo "== CLI seed/reset menolak production"
chk "qa-pv2.js menolak APP_ENV=production (kode 2)" '! docker exec -e APP_ENV=production "$BE" node scripts/staging/qa-pv2.js status >/dev/null 2>&1'

echo
if [ "$FAIL" = 0 ]; then echo "AUDIT ISOLASI: LULUS"; else echo "AUDIT ISOLASI: ADA PELANGGARAN"; exit 1; fi
