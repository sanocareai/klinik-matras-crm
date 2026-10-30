# Pembanding SIDIK JARI hitungan data rilis: migrasi|stok|MI|ST|koreksi|pesan (enam angka, dipisah |).
# Pesan WhatsApp ("Message") terus bertambah oleh PESAN MASUK YANG SAH, bukan oleh deploy. Maka:
#   • lima komponen bisnis (migrasi, pergerakan stok, Material Issue, Stock Transfer, koreksi Gudang) harus IDENTIK sebelum vs sesudah;
#   • komponen pesan boleh NAIK (pesan masuk sah selama rilis), tetapi TIDAK boleh TURUN (pesan hilang = dampak berbahaya) dan harus angka valid.
# Dipakai: bandingkan_sidik_data "<sebelum>" "<sesudah>"  → exit 0 bila lolos (info kenaikan pesan di stdout), exit 1 + alasan di stderr bila tidak.
bandingkan_sidik_data() {
  local a="${1-}" b="${2-}" i; local -a A B
  IFS='|' read -r -a A <<< "$a"; IFS='|' read -r -a B <<< "$b"
  if [ "${#A[@]}" -ne 6 ] || [ "${#B[@]}" -ne 6 ]; then echo "sidik jari harus 6 komponen (sebelum=${a} sesudah=${b})" >&2; return 1; fi
  for i in 0 1 2 3 4 5; do
    [[ "${A[$i]}" =~ ^[0-9]+$ && "${B[$i]}" =~ ^[0-9]+$ ]] || { echo "komponen ke-$((i + 1)) bukan angka (sebelum=${A[$i]} sesudah=${B[$i]})" >&2; return 1; }
  done
  local nama=(migrasi pergerakan_stok material_issue stock_transfer koreksi_gudang pesan)
  for i in 0 1 2 3 4; do
    [ "${A[$i]}" = "${B[$i]}" ] || { echo "hitungan ${nama[$i]} BERUBAH selama rilis: sebelum=${A[$i]} sesudah=${B[$i]}" >&2; return 1; }
  done
  if [ "${B[5]}" -lt "${A[5]}" ]; then echo "jumlah pesan BERKURANG selama rilis: sebelum=${A[5]} sesudah=${B[5]}" >&2; return 1; fi
  if [ "${B[5]}" -gt "${A[5]}" ]; then echo "pesan masuk sah selama rilis: +$((B[5] - A[5])) (bukan dampak deploy); hitungan bisnis lain identik"; fi
  return 0
}
