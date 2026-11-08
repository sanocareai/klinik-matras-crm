# Pemeriksaan skema untuk rehearsal rilis. Wajib: dump gagal/kosong/pendek, hash berbeda, atau tambahan di luar migrasi = kode keluar bukan 0.
# Normalisasi hanya membuang unsur nonsemantik: komentar, baris kosong, token \restrict acak, koma akhir baris (kolom baru di akhir tabel),
# dan, HANYA pada baris CHECK, cast varchar/text serta kurung redundan (render ulang pg_dump setelah restore). Urutan baris dipertahankan; tidak ada sort.
SKEMA_MD5_KOSONG="d41d8cd98f00b204e9800998ecf8427e"; SKEMA_MIN_BARIS="${SKEMA_MIN_BARIS:-50}"
skema_norm() {
  tr -d '\r' | sed -E '/^--/d; /^[[:space:]]*$/d; /^.?(un)?restrict [A-Za-z0-9]+$/d; s/,$//' | sed -E '/CHECK/{
    s/::character varying(\([0-9]+\))?(\[\])?//g
    s/::text(\[\])?//g
    :a
    s/(^|[^A-Za-z0-9_])\(([^() ,]+)\)/\1\2/g
    ta
    :b
    s/(^|[^A-Za-z0-9_])\((ARRAY\[[^]]*\])\)/\1\2/g
    tb
  }'
}
skema_valid() {
  [ -s "$1" ] && [ "$(md5sum <"$1" | cut -d' ' -f1)" != "$SKEMA_MD5_KOSONG" ] && [ "$(wc -l <"$1")" -ge "$SKEMA_MIN_BARIS" ] && grep -q 'CREATE TABLE' "$1"
}
skema_banding() { # dump_sumber dump_salinan
  local T ha hb; T="$(mktemp -d)"; skema_norm <"$1" >"$T/a"; skema_norm <"$2" >"$T/b"
  if ! skema_valid "$T/a" || ! skema_valid "$T/b"; then echo "SKEMA_GAGAL: dump kosong atau terlalu pendek"; rm -rf "$T"; return 1; fi
  ha="$(md5sum <"$T/a" | cut -d' ' -f1)"; hb="$(md5sum <"$T/b" | cut -d' ' -f1)"
  if [ "$ha" != "$hb" ]; then echo "SKEMA_GAGAL: hash berbeda ${ha:0:16} vs ${hb:0:16}"; diff "$T/a" "$T/b" | head -n 6 | cut -c1-140; rm -rf "$T"; return 1; fi
  echo "SKEMA_COCOK ${ha:0:16} baris=$(wc -l <"$T/a")"; rm -rf "$T"
}
skema_tambahan() { # dump_sebelum dump_sesudah migration.sql : sesudah = sebelum + persis objek migrasi
  local T f; T="$(mktemp -d)"; skema_norm <"$1" >"$T/a"; skema_norm <"$2" >"$T/b"
  if ! skema_valid "$T/a" || ! skema_valid "$T/b"; then echo "SKEMA_GAGAL: dump kosong atau terlalu pendek"; rm -rf "$T"; return 1; fi
  diff "$T/a" "$T/b" >"$T/d" || true
  if grep -q '^<' "$T/d"; then echo "SKEMA_GAGAL: skema lama berubah"; grep '^<' "$T/d" | head -n 5 | cut -c1-140; rm -rf "$T"; return 1; fi
  sed -n 's/^> //p' "$T/d" >"$T/add"
  tr -d '\r' <"$3" | sed -nE 's/^CREATE TABLE "([^"]+)".*/\1/p' | sort >"$T/mt"
  tr -d '\r' <"$3" | sed -nE 's/^CREATE (UNIQUE )?INDEX "([^"]+)".*/\2/p' | sort >"$T/mi"
  tr -d '\r' <"$3" | sed -nE 's/^ALTER TABLE "[^"]+" ADD COLUMN "([^"]+)".*/\1/p' | sort >"$T/mc"
  : >"$T/at"; : >"$T/ai"; : >"$T/aa"; : >"$T/ac"; : >"$T/lain"
  awk -v DT="$T" '
    b==1 { if ($0 ~ /^\)/) b=0; next }
    /^CREATE TABLE public\./ { t=$3; sub(/^public\./,"",t); print t >> (DT "/at"); b=1; next }
    /^CREATE (UNIQUE )?INDEX / { for(i=1;i<=NF;i++) if($i=="INDEX"){ print $(i+1) >> (DT "/ai"); break } next }
    /^ALTER TABLE ONLY public\./ { t=$4; sub(/^public\./,"",t); print t >> (DT "/aa"); getline; next }
    /^[[:space:]]+[a-z_"]/ { print $1 >> (DT "/ac"); next }
    { print >> (DT "/lain") }' "$T/add"
  for f in at ai aa ac; do sort -o "$T/$f" "$T/$f"; done
  if [ -s "$T/lain" ]; then echo "SKEMA_GAGAL: tambahan tak dikenal"; head -n 5 "$T/lain" | cut -c1-140; rm -rf "$T"; return 1; fi
  if ! cmp -s "$T/at" "$T/mt"; then echo "SKEMA_GAGAL: tabel tambahan tidak sama dengan migrasi"; rm -rf "$T"; return 1; fi
  if ! cmp -s "$T/ai" "$T/mi"; then echo "SKEMA_GAGAL: indeks tambahan tidak sama dengan migrasi"; rm -rf "$T"; return 1; fi
  if ! cmp -s "$T/ac" "$T/mc"; then echo "SKEMA_GAGAL: kolom tambahan tidak sama dengan migrasi"; rm -rf "$T"; return 1; fi
  if [ -n "$(sort -u "$T/aa" | comm -23 - "$T/mt")" ]; then echo "SKEMA_GAGAL: constraint pada tabel lama di luar migrasi"; rm -rf "$T"; return 1; fi
  echo "SKEMA_TAMBAHAN_SESUAI tabel=$(wc -l <"$T/at") indeks=$(wc -l <"$T/ai") kolom=$(wc -l <"$T/ac") constraint=$(wc -l <"$T/aa")"; rm -rf "$T"
}
