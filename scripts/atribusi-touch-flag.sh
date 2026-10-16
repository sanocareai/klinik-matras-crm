#!/usr/bin/env bash
# Menyalakan / mematikan flag ATRIBUSI_TOUCH_CAPTURE_ENABLED pada backend/.env persisten lalu me-recreate backend DARI RELEASE AKTIF (tanpa build, image sama, release sama).
# Tidak mencetak isi .env (hanya sha256 dan hitungan baris). Hanya menyentuh SATU baris flag; baris lain tidak diubah.
# Pemakaian (di server):  bash atribusi-touch-flag.sh on  <RELEASE_SHA8>      # menyalakan
#                         bash atribusi-touch-flag.sh off <RELEASE_SHA8>      # rollback tingkat 1 (tabel dan touch TETAP)
# BERHENTI BILA: release aktif != RELEASE_SHA8; ada deploy lain (kunci release-*.lock dipegang); backend tidak sehat sebelum/sesudah; image/release berubah setelah recreate;
#                baris lain di .env berubah; flag tidak terbaca di container; RestartCount != 0.
set -Eeuo pipefail
umask 077
AKSI="${1:-}"; REL8="${2:-}"
[[ "$AKSI" =~ ^(on|off)$ ]] || { echo "STOP: argumen 1 harus on|off" >&2; exit 1; }
[[ "$REL8" =~ ^[0-9a-f]{8}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif 8 karakter" >&2; exit 1; }
PROJECT="klinik-matras"; RELEASES="$HOME/releases/klinik-matras"; PERSIST="$HOME/klinik-matras"; ENVF="$PERSIST/backend/.env"
INTERNAL_URL="http://127.0.0.1:4000"; PUBLIC_URL="https://app.sanomatrassehat.com"; FLAG="ATRIBUSI_TOUCH_CAPTURE_ENABLED"
die() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }
ok()  { printf '  OK    %s\n' "$*"; }
for lf in /tmp/release-*.lock; do [ -e "$lf" ] || continue; ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf})"; done
exec 9>/tmp/release-atribusi-touch-flag.lock; flock -n 9 || die "aktivasi ini sudah berjalan"
ok "tidak ada deploy lain"
CID="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
REL_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID")"
[ "$REL_DIR" = "$RELEASES/$REL8" ] || die "release aktif (${REL_DIR}) bukan ${REL8}"
IMG_ID="$(docker inspect -f '{{.Image}}' "$CID")"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "health internal sebelum perubahan gagal"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "health publik sebelum perubahan gagal"
[ -f "$ENVF" ] && [ ! -L "$ENVF" ] || die "backend/.env persisten tidak ada"
ok "release aktif ${REL8}, image ${IMG_ID:7:12}, health sehat"
SHA_SEBELUM="$(sha256sum "$ENVF" | cut -c1-16)"; N_SEBELUM="$(grep -c '' "$ENVF")"
ADA="$(grep -c "^${FLAG}=" "$ENVF" || true)"
[ "$ADA" -le 1 ] || die "flag muncul ${ADA}× di .env — ambigu"
BARIS_SEBELUM_HASH="$(grep -v "^${FLAG}=" "$ENVF" | sha256sum | cut -c1-16)"
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
grep -v "^${FLAG}=" "$ENVF" > "$TMP" || true
[ -z "$(tail -c1 "$TMP")" ] || echo >> "$TMP"
if [ "$AKSI" = "on" ]; then echo "${FLAG}=true" >> "$TMP"; else echo "${FLAG}=false" >> "$TMP"; fi
[ "$(grep -v "^${FLAG}=" "$TMP" | sha256sum | cut -c1-16)" = "$BARIS_SEBELUM_HASH" ] || die "baris selain flag berubah pada berkas calon — batal (tidak ditulis)"
cat "$TMP" > "$ENVF"
ok ".env: hanya baris ${FLAG} diubah (sha ${SHA_SEBELUM} -> $(sha256sum "$ENVF" | cut -c1-16); baris ${N_SEBELUM} -> $(grep -c '' "$ENVF")); baris lain identik"
( cd "$REL_DIR" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend </dev/null >/dev/null 2>&1 ) || die "recreate backend gagal (.env sudah diubah — jalankan '$0 off ${REL8}' bila perlu)"
UP=0; for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend tidak sehat dalam 90 detik setelah recreate — jalankan '$0 off ${REL8}'"
CID2="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(docker inspect -f '{{.Image}}' "$CID2")" = "$IMG_ID" ] || die "image berubah setelah recreate"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID2")" = "$REL_DIR" ] || die "release berubah setelah recreate"
ok "recreate dari release aktif ${REL8}; image sama ${IMG_ID:7:12}"
EXPECT="true"; [ "$AKSI" = "off" ] && EXPECT="false"
[ "$(docker exec "$CID2" printenv "$FLAG" 2>/dev/null || true)" = "$EXPECT" ] || die "flag di container bukan ${EXPECT}"
ok "flag di container = ${EXPECT}"
sleep 20
[ "$(docker inspect -f '{{.RestartCount}}' "$CID2")" = "0" ] || die "backend restart sendiri"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "health publik setelah perubahan gagal"
ok "RestartCount=0; health internal + publik sehat; waktu UTC: $(date -u +%FT%TZ)"
