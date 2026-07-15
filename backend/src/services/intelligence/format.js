// Format Rupiah singkat untuk label sinyal/insight (server tak punya util frontend).
export function rpShort(n) {
  const v = n || 0;
  if (v >= 1_000_000) return "Rp" + (v / 1_000_000).toFixed(1).replace(/\.0$/, "") + "jt";
  if (v >= 1_000) return "Rp" + Math.round(v / 1_000) + "rb";
  return "Rp" + v;
}
