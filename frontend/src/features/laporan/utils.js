// Turunkan sparkline 7-titik dari series bulanan yang SUDAH di-fetch
// (monthlyRevenue/monthlyCustomers dari GET /analytics/overview) — BUKAN
// endpoint baru. Kalau seri lebih pendek dari 7 titik, dipakai apa adanya
// (Sparkline.jsx sudah handle minimal 2 titik).
export function buildSparkline(series, key) {
  if (!series || series.length === 0) return [];
  return series.slice(-7).map((row) => ({ value: Number(row[key]) || 0 }));
}
