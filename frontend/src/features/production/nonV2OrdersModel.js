// P12B.5 — model murni "order asli di luar Production V2" (sumber V1) untuk Ringkasan/Status/Rencana. Server menandai tiap unit work-order dengan
// `inProductionV2` (cohort reader yang SAMA dengan Unit 360); unit tampil TEPAT SATU kali: V2 di halaman V2, V1 di panel ini — tanpa duplikasi,
// tanpa membuat Run/backfill. Unit terkirim (riwayat) tidak termasuk "aktif".
export const isActiveV1 = (u) => !!u && u.inProductionV2 !== true && u.status !== "DELIVERED";
export const selectV1Units = (units = []) => (units || []).filter(isActiveV1);

const BLOCKED = (u) => u.productionStatus === "BLOCKED";
export function summarizeV1(units = []) {
  const active = selectV1Units(units);
  const byStatus = new Map();
  for (const u of active) byStatus.set(u.status, (byStatus.get(u.status) || 0) + 1);
  return { total: active.length, blocked: active.filter(BLOCKED).length, byStatus: [...byStatus].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count) };
}
const PRIORITY_RANK = { CRITICAL: 0, URGENT: 1, HIGH: 2, NORMAL: 3 };
// Terhambat dulu, lalu prioritas, lalu urutan server (terbaru).
export function topV1Units(units = [], limit = 8) {
  const active = selectV1Units(units).map((u, i) => ({ u, i }));
  active.sort((a, b) => (BLOCKED(b.u) - BLOCKED(a.u)) || ((PRIORITY_RANK[a.u.priority] ?? 3) - (PRIORITY_RANK[b.u.priority] ?? 3)) || a.i - b.i);
  return active.slice(0, limit).map((x) => x.u);
}

export const PANEL_COPY = Object.freeze({
  ringkasan: "Order asli yang belum memakai Production V2 (sumber V1). Tidak masuk angka KPI V2 di atas.",
  status: "Order asli yang belum memakai Production V2 (sumber V1) — tidak punya Run, jadi tidak tampil di pipeline.",
  rencana: "Order asli yang belum memakai Production V2 (sumber V1). Belum bisa dijadwalkan di sini: penjadwalan butuh Run V2, dan slice ini tidak membuat Run otomatis.",
});
