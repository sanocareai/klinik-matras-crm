// Penerap PENGUNCIAN DEPLOY berbasis kepemilikan proses pada skrip rilis Laporan Produksi (diturunkan dari scripts/lib/gen-kunci-kelengkapan.cjs, tanpa blok migrasi/isi tabel).
"use strict";
const lf = (t) => t.replace(/\r\n/g, "\n");
function terapkanKunci(skrip, blok) {
  let s = skrip;
  const r = (a, b) => { if (!s.includes(a)) throw new Error("penanda (kunci): " + a.slice(0, 90)); s = s.split(a).join(b); };
  const potong = (awal, akhir, ganti) => { const i = s.indexOf(awal); const j = s.indexOf(akhir, i + awal.length); if (i < 0 || j < 0) throw new Error("penanda (kunci): " + awal.slice(0, 60) + " .. " + akhir.slice(0, 60)); s = s.slice(0, i) + ganti + s.slice(j); };
  const PH0 = 'PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"';
  r(PH0, lf(blok.kunci).trimEnd() + "\n" + lf(blok["uji-pra-switch"]).trimEnd() + "\n\n" + PH0);
  potong('for lf in /tmp/release-*.lock; do\n  [ -e "$lf" ] || continue\n  ( exec 8>"$lf"', '\nok "tidak ada deploy lain"', lf(blok["fase0-kunci"]).trimEnd());
  r('ok "tidak ada deploy lain"', 'ok "tidak ada deploy lain (kunci bersama + kunci sendiri dipegang proses ini; tidak ada kunci rilis lain yang dipegang; tidak ada proses deploy/build/migrasi lain)"');
  potong("# Tepat sebelum switch: pastikan tidak ada deploy", '\n\nPHASE="2-audit-produksi"', lf(blok["cek-ulang-kunci"]).trimEnd());
  r('gerbang_kode_live "fase-6-pra-switch"', 'gerbang_kode_live "fase-6-pra-switch"\ntidak_ada_deploy_lain_lagi');
  r('if [ "$REHEARSAL_ONLY" = "1" ]; then\n  say "REHEARSAL-ONLY: semua gerbang', lf(blok["rehearsal-pra-switch"]).trimEnd() + '\nif [ "$REHEARSAL_ONLY" = "1" ]; then\n  say "REHEARSAL-ONLY: semua gerbang');
  return s;
}
module.exports = { terapkanKunci };
