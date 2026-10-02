// Seret-lepas Rencana Produksi — logika MURNI (tanpa React/DOM) supaya bisa diuji langsung.
// Kontrak server yang dipakai (TIDAK ada kontrak baru):
//   - scheduleProductionV2Plan(planId, { productionDate, stationCode, ... expectedRevision }) — jadwalkan/pindahkan; kartu masuk PALING BAWAH meja tujuan;
//     server menegakkan kapasitas (PLAN_STATION_FULL) di dalam transaksi.
//   - reorderProductionV2Station({ productionDate, stationCode, orderedPlanIds }) — DAFTAR LENGKAP isi meja; server menolak (STATION_ORDER_STALE) bila isi berubah.
//   - productionDate:null + stationCode:null = kembali ke Belum Dijadwalkan.
// Sisipan pada posisi tertentu = jadwalkan (ke bawah) lalu urutkan; keduanya lewat command yang sama dengan tombol Jadwalkan/Pindahkan/▲▼.
import { stationCapacity } from "@/features/production/experience.js";
import { orderedStationItems } from "@/features/production/stationOrder.js";

// Gerak minimal (px) sebelum sentuhan/klik pada handle dianggap SERET. Di bawah ini = ketukan biasa -> tidak ada yang berpindah.
export const DRAG_THRESHOLD_PX = 8;
export const dragMoved = (a, b, threshold = DRAG_THRESHOLD_PX) => Math.hypot((b?.x ?? 0) - (a?.x ?? 0), (b?.y ?? 0) - (a?.y ?? 0)) >= threshold;

// Indeks sisip dari posisi vertikal pointer: jumlah kartu (selain yang diseret) yang titik tengahnya di atas pointer.
export const insertIndexAt = (y, midpoints) => (midpoints || []).filter((m) => m < y).length;

export function listWithInserted(ids, id, index) {
  const rest = (ids || []).filter((x) => x !== id);
  const at = Math.max(0, Math.min(index ?? rest.length, rest.length));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Putuskan apa yang terjadi bila `view` dilepas di `target`.
 *  target: { kind: "backlog" } | { kind: "meja", code, index? } | { kind: "day", date }
 * Hasil:
 *  { type: "noop" } | { type: "reject", message }
 *  { type: "unschedule" }
 *  { type: "reorder", stationCode, orderedIds }
 *  { type: "place", stationCode, orderedIds, needsReorder }   (jadwalkan/pindah meja; needsReorder = tidak di posisi paling bawah)
 *  { type: "moveDate", date }
 */
export function decideDrop({ view, target, stations = [], date }) {
  const plan = view?.plan;
  if (!target) return { type: "noop" };
  if (target.kind === "backlog") return plan?.stationCode ? { type: "unschedule" } : { type: "noop" };
  if (target.kind === "day") {
    if (!plan?.stationCode) return { type: "reject", message: "Unit ini belum punya meja. Letakkan di Meja dulu; tanggal lain bisa dipilih lewat tombol Jadwalkan." };
    if (!target.date || target.date === plan.productionDate) return { type: "noop" };
    return { type: "moveDate", date: target.date };
  }
  if (target.kind !== "meja") return { type: "noop" };
  const station = stations.find((s) => s.code === target.code);
  if (!station) return { type: "reject", message: "Meja tujuan tidak ditemukan. Muat ulang halaman." };
  const ids = orderedStationItems(station.items).map((v) => v.plan?.id).filter(Boolean);
  const planId = plan?.id ?? view?.runId;
  const here = plan?.id ? ids.includes(plan.id) : false;
  if (here) {
    const next = listWithInserted(ids, plan.id, target.index);
    return sameList(next, ids) ? { type: "noop" } : { type: "reorder", stationCode: station.code, orderedIds: next };
  }
  const cap = stationCapacity(station);
  if (cap.full) return { type: "reject", message: `${station.label} sudah penuh (${cap.label}). Pilih meja lain.` };
  const orderedIds = listWithInserted(ids, planId, target.index);
  // Posisi bawah hanya TERJAMIN bila semua isi meja sudah bernomor manual (kartu baru masuk paling bawah). Kalau belum, urutan bawaan = prioritas
  // dan kartu baru bisa naik — jadi posisi yang ditunjuk indikator disimpan eksplisit lewat urutan manual.
  const allSequenced = orderedStationItems(station.items).every((v) => v.plan?.stationSequence != null);
  return { type: "place", stationCode: station.code, orderedIds, needsReorder: orderedIds[orderedIds.length - 1] !== planId || !allSequenced };
}

// Teks petunjuk di ghost/indikator saat seret.
export function describeTarget(decision, stations = [], draggedPlanId = null) {
  switch (decision?.type) {
    case "place": case "reorder": {
      const st = stations.find((s) => s.code === decision.stationCode);
      const at = decision.orderedIds.indexOf(draggedPlanId);
      return `${decision.type === "place" ? "Jadwalkan ke" : "Urutkan di"} ${st?.label || decision.stationCode}${at >= 0 ? ` · urutan ${at + 1}` : ""}`;
    }
    case "unschedule": return "Kembalikan ke Belum Dijadwalkan";
    case "moveDate": return `Pindah ke tanggal ${decision.date}`;
    case "reject": return decision.message;
    default: return "";
  }
}
