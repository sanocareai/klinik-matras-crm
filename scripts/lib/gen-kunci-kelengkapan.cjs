// Transformasi generator skrip rilis Kelengkapan: PENGUNCIAN DEPLOY berbasis kepemilikan proses, uji pra-switch terisolasi di rehearsal,
// dan keadaan LANJUT dengan isi tabel pernyataan DIBACA aktual (tidak diasumsikan kosong). Dipanggil dari scripts/gen-release-kelengkapan.cjs.
"use strict";

function terapkanKunci(skrip, blok) {
  let s = skrip;
  const lf = (t) => t.replace(/\r\n/g, "\n");
  const r = (a, b) => { if (!s.includes(a)) throw new Error("penanda (kunci): " + a.slice(0, 90)); s = s.split(a).join(b); };
  const potong = (awal, akhir, ganti) => {
    const i = s.indexOf(awal); const j = s.indexOf(akhir, i + awal.length);
    if (i < 0 || j < 0) throw new Error(`penanda (kunci): ${awal.slice(0, 60)} .. ${akhir.slice(0, 60)}`);
    s = s.slice(0, i) + ganti + s.slice(j);
  };

  // blok kunci + fungsi uji, didefinisikan SEBELUM fase 0
  const PH0 = 'PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"';
  r(PH0, lf(blok.kunci).trimEnd() + "\n" + lf(blok["uji-pra-switch"]).trimEnd() + "\n\n" + PH0);

  // fase 0: ambil kunci ATOMIK dulu (bersama + sendiri), baru periksa kunci/proses lain
  potong('for lf in /tmp/release-*.lock; do\n  [ -e "$lf" ] || continue\n  ( exec 8>"$lf"', '\nok "tidak ada deploy lain"', lf(blok["fase0-kunci"]).trimEnd());
  r('ok "tidak ada deploy lain"', 'ok "tidak ada deploy lain (kunci bersama + kunci sendiri dipegang proses ini; tidak ada kunci rilis lain yang dipegang; tidak ada proses deploy/build/migrasi lain)"');

  // pemeriksaan ulang (sebelum migrasi dan tepat sebelum switch): kunci sendiri dikenali dari KEPEMILIKAN, bukan nama
  potong("# Tepat sebelum switch: pastikan tidak ada deploy", '\n\nPHASE="2-audit-produksi"', lf(blok["cek-ulang-kunci"]).trimEnd());

  // fase 7: isi tabel pernyataan tepat sebelum switch (pembanding sesudah switch + smoke)
  r('gerbang_kode_live "fase-7-tepat-sebelum-switch"', 'gerbang_kode_live "fase-7-tepat-sebelum-switch"\n' + lf(blok["isi-pra-switch"]).trimEnd());

  // smoke: isi tabel dibandingkan dengan keadaan sebelum switch
  r('-e ORDER_N="$ORDER_N" -e JOB_N="$JOB_N" backend node --input-type=module -', '-e ORDER_N="$ORDER_N" -e JOB_N="$JOB_N" -e SMOKE_DECL_N="$SMOKE_DECL_N" -e SMOKE_DECL_FP="$SMOKE_DECL_FP" -e SMOKE_DECL_IDS="$SMOKE_DECL_IDS" backend node --input-type=module -');
  r("tabel rilis tetap kosong", "isi tabel rilis dibaca aktual dan tidak berubah oleh rilis");

  // rehearsal: isi awal restore dibandingkan dengan production
  r("-e DATABASE_URL=\"postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}\" backend node --input-type=module - <<'REHNODE'",
    "-e DATABASE_URL=\"postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}\" -e REH_DECL_AWAL=\"$(isi_n \"$ISI_PRA\")\" backend node --input-type=module - <<'REHNODE'");

  // rehearsal harus MENGUJI logika pra-switch (kunci, bagian kritis, baseline bergeser) lalu gerbang yang sama dengan fase 7 pada production nyata
  r('if [ "$REHEARSAL_ONLY" = "1" ]; then\n  say "REHEARSAL-ONLY: semua gerbang', lf(blok["rehearsal-pra-switch"]).trimEnd() + '\nif [ "$REHEARSAL_ONLY" = "1" ]; then\n  say "REHEARSAL-ONLY: semua gerbang');
  return s;
}

module.exports = { terapkanKunci };
