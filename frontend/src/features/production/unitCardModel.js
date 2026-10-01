// P9 UX Realignment — model MURNI untuk kartu unit yang SAMA dipakai Status Produksi, Rencana Produksi, dan Quality
// Control (satu kartu, satu bahasa visual). Tanpa React/DOM supaya bisa diuji langsung. Semua angka/label berasal dari
// view Command Center yang sudah dikirim server — modul ini hanya MENERJEMAHKAN, tidak menghitung KPI sendiri.
import { STEP_BY_NO, bucketStyle } from "@/features/production/experience.js";

// Prioritas: merah untuk Tinggi/Mendesak TIDAK hanya lewat warna — ada ikon + teks + penanda tepi (lihat UnitCard).
export function priorityMeta(priority) {
  if (priority === 2) return { key: "URGENT", label: "Mendesak", tone: "red", icon: "urgent", edge: "border-l-[4px] border-l-red" };
  if (priority === 1) return { key: "HIGH", label: "Tinggi", tone: "red", icon: "high", edge: "border-l-[4px] border-l-red" };
  return { key: "NORMAL", label: "Normal", tone: "neutral", icon: null, edge: "border-l-[4px] border-l-transparent" };
}

// Kekurangan data yang MEMANG relevan di kartu. Tidak menebak: hanya menyebut yang terbukti kosong di view.
export function dataGaps(view) {
  const gaps = [];
  const c = view?.customer || {};
  if (!view?.unit?.photoUrl) gaps.push("Foto unit belum ada");
  if (c.weightKg == null) gaps.push("Berat badan belum diisi Sales");
  if (!(c.salesServices && c.salesServices.length)) gaps.push("Layanan Sales belum tercatat");
  if (view?.plan && !view.plan.operator) gaps.push("PIC meja belum ditetapkan");
  return gaps;
}

// Kesiapan bahan: satu label + nada, dari materialStatus server (bukan hitungan baru).
export function materialBadge(view) {
  if (view?.shortage) return { label: "Bahan kurang", tone: "red" };
  const key = view?.materialStatus?.key;
  switch (key) {
    case "SUDAH_DISERAHKAN": return { label: "Bahan sudah diserahkan", tone: "green" };
    case "SIAP_DIAMBIL": return { label: "Bahan siap diambil", tone: "green" };
    case "MENUNGGU_DISIAPKAN": return { label: "Bahan direservasi", tone: "green" };
    case "BELUM_DIRESERVASI": return { label: "Bahan belum direservasi", tone: "orange" };
    // Belum ada BOM/rencana bahan = WAJAR sebelum diagnosa selesai — bukan kekurangan, jadi tidak ditandai di kartu.
    case "BOM_BELUM_ADA":
    case "BELUM_ADA_RENCANA": return null;
    default: return view?.materialStatus?.label ? { label: view.materialStatus.label, tone: "neutral" } : null;
  }
}

// Tahap yang sedang/ berikutnya dikerjakan ("Langkah 5 · Diagnosa"), atau label bucket bila tidak ada tahap.
export function stageText(view) {
  const n = view?.next?.stepNo;
  if (n && STEP_BY_NO[n]) return `Langkah ${n} · ${STEP_BY_NO[n].label}`;
  return bucketStyle(view?.bucket).label;
}

export const MEJA = Object.freeze(["TABLE_1", "TABLE_2", "TABLE_3", "TABLE_4"]);
export const mejaLabel = (code) => (code ? String(code).replace("TABLE_", "Meja ") : null);

// Kolom pipeline untuk layar sempit: chip pemilih tahap (label + jumlah) — sumbernya kolom server apa adanya.
export function pipelineChips(columns) {
  return (columns || []).map((c) => ({ key: c.key, label: c.label, count: c.count ?? c.items?.length ?? 0 }));
}

// Backlog "Belum Dijadwalkan" = view aktif tanpa meja (sama persis definisi KPI belumDijadwalkan di server).
export function backlogOf(columns) {
  const out = [];
  for (const col of columns || []) {
    for (const item of col.items || []) {
      if (item.kind === "UPCOMING_PICKUP") continue; // belum ada Run — belum bisa dijadwalkan
      if (item.runId && !item.plan?.stationCode) out.push(item);
    }
  }
  return out.sort((a, b) => (b.plan?.priority ?? 0) - (a.plan?.priority ?? 0));
}

// Pemetaan item kartu QC (antrean P6) -> view Command Center yang sama (lewat runId) supaya kartu QC = kartu Status.
export function mergeQcWithViews(queueItems, columns) {
  const byRun = new Map();
  for (const col of columns || []) for (const it of col.items || []) if (it.runId) byRun.set(it.runId, it);
  return (queueItems || []).map((q) => ({ queue: q, view: byRun.get(q.runId) || null }));
}
