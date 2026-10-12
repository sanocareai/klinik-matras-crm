// KPI waktu alur milestone (pickup → diterima workshop → produksi → barang jadi diterima Gudang → delivery) — fungsi MURNI (tanpa DB; diuji node --test).
// Prinsip: durasi dihitung HANYA bila kedua timestamp sumber ada dan berurutan. Tidak ada timestamp yang dibuat/ditebak, tidak ada histori yang diubah. Selain itu: "Data waktu belum tersedia".
// "Produksi selesai" dibedakan dari "barang jadi diterima Gudang": selesai = unit diserahkan produksi ke Gudang (FINISHED_GOODS ditawarkan / fase HANDOFF dimulai), diterima = Gudang menerima.

export const DATA_UNAVAILABLE = "Data waktu belum tersedia";

/** Tujuh timestamp sumber (urutan alur). */
export const TIMESTAMPS = Object.freeze([
  { key: "pickupCompletedAt", label: "Pickup selesai" },
  { key: "receivedAt", label: "Diterima di workshop" },
  { key: "productionStartedAt", label: "Produksi mulai" },
  { key: "productionFinishedAt", label: "Produksi selesai" },
  { key: "warehouseAcceptedAt", label: "Barang jadi diterima Gudang" },
  { key: "deliveryStartedAt", label: "Delivery mulai" },
  { key: "deliveredAt", label: "Terkirim" },
]);

/** Enam durasi: dari timestamp → ke timestamp. */
export const DURATIONS = Object.freeze([
  { key: "pickupToReceived", label: "Pickup selesai → diterima workshop", from: "pickupCompletedAt", to: "receivedAt" },
  { key: "receivedToStart", label: "Diterima workshop → mulai produksi", from: "receivedAt", to: "productionStartedAt" },
  { key: "productionDuration", label: "Durasi produksi", from: "productionStartedAt", to: "productionFinishedAt" },
  { key: "finishedToWarehouse", label: "Produksi selesai → diterima Gudang", from: "productionFinishedAt", to: "warehouseAcceptedAt" },
  { key: "readyToDelivery", label: "Siap kirim → delivery dimulai", from: "warehouseAcceptedAt", to: "deliveryStartedAt" },
  { key: "deliveryDuration", label: "Durasi delivery", from: "deliveryStartedAt", to: "deliveredAt" },
]);
export const DURATION_BY_KEY = Object.freeze(Object.fromEntries(DURATIONS.map((d) => [d.key, d])));

const ms = (v) => { if (!v) return null; const t = new Date(v).getTime(); return Number.isFinite(t) ? t : null; };

/** Durasi menit antara dua instan; null bila salah satu tidak ada atau urutannya terbalik (jam tidak wajar -> tidak dipakai, bukan dikoreksi). */
export function minutesBetween(from, to) {
  const a = ms(from); const b = ms(to);
  if (a == null || b == null || b < a) return null;
  return Math.round((b - a) / 60_000);
}

/** "2 jam 5 menit" / "35 menit" / "1 hari 3 jam" / "0 menit". */
export function formatMinutes(min) {
  if (min == null) return DATA_UNAVAILABLE;
  if (min < 60) return `${min} menit`;
  if (min < 24 * 60) { const h = Math.floor(min / 60); const m = min % 60; return m ? `${h} jam ${m} menit` : `${h} jam`; }
  const d = Math.floor(min / 1440); const h = Math.floor((min % 1440) / 60);
  return h ? `${d} hari ${h} jam` : `${d} hari`;
}

/** Timeline satu unit: timestamp sumber + enam durasi ({ minutes|null, text, available, reason }). */
export function timelineOf(ts = {}) {
  const stamps = Object.fromEntries(TIMESTAMPS.map((t) => [t.key, ts[t.key] ? new Date(ts[t.key]).toISOString() : null]));
  const durations = DURATIONS.map((d) => {
    const from = stamps[d.from]; const to = stamps[d.to];
    const minutes = minutesBetween(from, to);
    const reason = minutes != null ? null : (!from || !to ? "MISSING_TIMESTAMP" : "ORDER_INVALID");
    return { key: d.key, label: d.label, from: d.from, to: d.to, toAt: to, minutes, text: minutes != null ? formatMinutes(minutes) : DATA_UNAVAILABLE, available: minutes != null, reason };
  });
  return { timestamps: TIMESTAMPS.map((t) => ({ key: t.key, label: t.label, at: stamps[t.key] })), durations };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; if (!n) return null; return n % 2 ? s[(n - 1) / 2] : Math.round((s[n / 2 - 1] + s[n / 2]) / 2); };
/** Agregat lintas unit: n = unit yang kedua timestamp-nya ada; missing = unit tanpa data; rata-rata/median hanya dari yang tersedia. */
export function aggregateDurations(timelines = [], { within = null } = {}) {
  return DURATIONS.map((d) => {
    const vals = []; let missing = 0;
    for (const t of timelines) {
      const x = t.durations.find((y) => y.key === d.key);
      if (x?.available) { if (!within || within(x.toAt)) vals.push(x.minutes); } else missing += 1;
    }
    return {
      key: d.key, label: d.label, n: vals.length, missing,
      avgMinutes: vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null,
      medianMinutes: median(vals), maxMinutes: vals.length ? Math.max(...vals) : null,
      avgText: vals.length ? formatMinutes(Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)) : DATA_UNAVAILABLE,
      medianText: vals.length ? formatMinutes(median(vals)) : DATA_UNAVAILABLE,
    };
  });
}
