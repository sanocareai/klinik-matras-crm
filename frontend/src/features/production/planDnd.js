// Seret-lepas Rencana Produksi — logika MURNI (tanpa React/DOM) supaya bisa diuji langsung.
// Kontrak server yang dipakai (TIDAK ada kontrak baru):
//   - scheduleProductionV2Plan(planId, { productionDate, stationCode, ... expectedRevision }) — jadwalkan/pindahkan; kartu masuk PALING BAWAH meja tujuan;
//     server menegakkan kapasitas (PLAN_STATION_FULL) di dalam transaksi.
//   - reorderProductionV2Station({ productionDate, stationCode, orderedPlanIds }) — DAFTAR LENGKAP isi meja; server menolak (STATION_ORDER_STALE) bila isi berubah.
//   - productionDate:null + stationCode:null = kembali ke Belum Dijadwalkan.
// Sisipan pada posisi tertentu = jadwalkan (ke bawah) lalu urutkan; keduanya lewat command yang sama dengan tombol Jadwalkan/Pindahkan/▲▼.
import { stationCapacity } from "@/features/production/experience.js";
import { rankOfView } from "@/features/production/productionLabels.js";
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

// Unit 12/12 (semua tahap selesai): terkunci — tidak bisa diseret/dipindah, selalu di urutan paling bawah meja.
export const isPlanComplete = (v) => (v?.progress?.total ?? 0) > 0 && (v.progress.done ?? 0) + (v.progress.skipped ?? 0) >= v.progress.total;
// Urutan tampil di meja = urutan server (manual > prioritas bawaan), LALU unit 12/12 dikunci di bawah (stabil). Dipakai render DAN keputusan drop.
export const planDisplayOrder = (items) => { const o = orderedStationItems(items); return [...o.filter((v) => !isPlanComplete(v)), ...o.filter(isPlanComplete)]; };

// ---- Prioritas vs urutan manual (P12A.3) ----
// ATURAN: stationSequence/urutan manual SELALU menang di meja. Prioritas HANYA (1) mengurutkan backlog, (2) menentukan posisi AWAL unit yang
// masuk meja tanpa posisi eksplisit (tombol Jadwalkan), dan (3) memicu peringatan non-blocking bila Komplain/Tinggi berada di bawah Normal.
// TIDAK PERNAH mengurutkan ulang meja secara otomatis.
export const priorityOf = (v) => rankOfView(v); // peringkat: Komplain > Tinggi (termasuk Mendesak lama) > Normal

// Indeks posisi awal untuk unit berprioritas `priority` di daftar `others` (urutan tampil meja, TANPA unit itu; unit 12/12 terkunci diabaikan):
// tepat setelah item terakhir yang prioritasnya >= priority (Normal -> paling bawah; Komplain -> di depan semua yang lebih rendah).
export function priorityInsertIndex(others, priority) {
  const movable = (others || []).filter((v) => !isPlanComplete(v));
  let last = -1;
  movable.forEach((v, i) => { if (priorityOf(v) >= priority) last = i; });
  return last + 1;
}

// Inversi prioritas di satu meja: unit yang lebih mendesak berada SETELAH unit yang kurang mendesak (kartu 12/12 tidak dihitung).
// Mengembalikan kode unit yang "tertinggal" (kosong = tidak ada peringatan). Murni informasi — tidak mengubah urutan.
export function priorityInversion(items) {
  const movable = (items || []).filter((v) => !isPlanComplete(v));
  const out = []; let minBefore = Infinity;
  for (const v of movable) {
    const p = priorityOf(v);
    if (p > minBefore) out.push(v.unit?.unitCode);
    minBefore = Math.min(minBefore, p);
  }
  return out;
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
  if (isPlanComplete(view)) return { type: "reject", message: "Unit 12/12 sudah selesai dan terkunci — tidak bisa dipindahkan." };
  if (target.kind === "backlog") return plan?.stationCode ? { type: "unschedule" } : { type: "noop" };
  if (target.kind === "day") {
    if (!plan?.stationCode) return { type: "reject", message: "Unit ini belum punya meja. Letakkan di Meja dulu; tanggal lain bisa dipilih lewat tombol Jadwalkan." };
    if (!target.date || target.date === plan.productionDate) return { type: "noop" };
    return { type: "moveDate", date: target.date };
  }
  if (target.kind !== "meja") return { type: "noop" };
  const station = stations.find((s) => s.code === target.code);
  if (!station) return { type: "reject", message: "Meja tujuan tidak ditemukan. Muat ulang halaman." };
  const ordered = planDisplayOrder(station.items);
  const ids = ordered.map((v) => v.plan?.id).filter(Boolean);
  const planId = plan?.id ?? view?.runId;
  const here = plan?.id ? ids.includes(plan.id) : false;
  // Posisi sisip tidak boleh melewati unit 12/12 yang terkunci di bawah.
  const lockedOthers = ordered.filter((v) => isPlanComplete(v) && v.plan?.id !== planId).length;
  const limit = ids.filter((x) => x !== planId).length - lockedOthers;
  const index = Math.max(0, Math.min(target.index ?? limit, limit));
  if (here) {
    const next = listWithInserted(ids, plan.id, index);
    return sameList(next, ids) ? { type: "noop" } : { type: "reorder", stationCode: station.code, orderedIds: next };
  }
  const cap = stationCapacity(station);
  if (cap.full) return { type: "reject", message: `${station.label} sudah penuh (${cap.label}). Pilih meja lain.` };
  const orderedIds = listWithInserted(ids, planId, index);
  // Posisi bawah hanya TERJAMIN bila semua isi meja sudah bernomor manual (kartu baru masuk paling bawah). Kalau belum, urutan bawaan = prioritas
  // dan kartu baru bisa naik — jadi posisi yang ditunjuk indikator disimpan eksplisit lewat urutan manual.
  const allSequenced = ordered.every((v) => v.plan?.stationSequence != null);
  return { type: "place", stationCode: station.code, orderedIds, needsReorder: orderedIds.indexOf(planId) !== orderedIds.length - 1 - lockedOthers || !allSequenced || lockedOthers > 0 };
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
