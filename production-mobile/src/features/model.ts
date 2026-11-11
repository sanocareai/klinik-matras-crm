import type { AndonBoard, Bucket, MediaItem, ProductionReport, RunView, V1QueueItem, V1State } from "@/api/types";
import type { ToneKey } from "@/design/tokens";

// MODEL MURNI (tanpa JSX/jaringan, diuji Jest). Prinsip sama dengan Aplikasi Meja web (workerAppModel.js):
// SEMUA nilai — urutan, tahap, progres, prioritas — berasal dari server. Modul ini hanya menerjemahkan ke kartu.

/** Warna status per bucket (kanvas: antre abu, dikerjakan biru, jeda oranye, terhambat merah, selesai hijau). */
export const BUCKET_TONE: Record<Bucket, ToneKey> = {
  DALAM_PERJALANAN: "gray", ANTREAN: "gray",
  BONGKAR: "blue", DIAGNOSA: "blue", FONDASI: "blue", LAPISAN: "blue",
  MENUNGGU_BAHAN: "red", QC: "purple", CORNER: "teal", HANDOFF: "green", SELESAI: "green",
};
const BUCKET_AKTIF: Bucket[] = ["BONGKAR", "DIAGNOSA", "FONDASI", "LAPISAN", "QC", "CORNER"];

export type Prioritas = { label: string; tone: ToneKey; rank: number } | null;

/** Prioritas dari server: Komplain (rank 3) merah, Tinggi oranye, Normal tidak ditampilkan. */
export function prioritasDari(key: string | null | undefined, label: string | null | undefined, rank = 0): Prioritas {
  const k = String(key ?? "").toUpperCase();
  if (k === "COMPLAINT" || rank >= 3) return { label: label || "Komplain", tone: "red", rank: 3 };
  if (["HIGH", "URGENT", "CRITICAL"].includes(k) || rank >= 1) return { label: label && label !== "Normal" ? label : "Tinggi", tone: "orange", rank: Math.max(1, rank) };
  return null;
}

export type Kartu = {
  key: string;
  sumber: "V2" | "V1";
  runId: string | null;
  unitId: string;
  /** Kode pendek untuk dibaca sekilas: "RES-12112026-004-U1" → "004-U1". */
  kodePendek: string;
  unitCode: string;
  customer: string;
  kasur: string | null;
  layanan: string | null;
  tahap: string;
  tone: ToneKey;
  aktif: boolean;
  menit: number | null;
  progres: { done: number; total: number } | null;
  prioritas: Prioritas;
  terlambat: boolean;
  catatan: string | null;
  meja: string | null;
};

export const kodePendek = (unitCode: string) => unitCode.replace(/^[A-Z]{2,4}-\d{8}-/, "");
const bersih = (s: string | null | undefined) => (s && String(s).trim() ? String(s).trim() : null);
const gabung = (...xs: (string | null | undefined)[]) => xs.map(bersih).filter(Boolean).join(" · ") || null;

export function kartuDariV2(v: RunView): Kartu {
  const tunggu = v.next?.action === "WAIT";
  const jeda = v.activeOp?.status === "PAUSED";
  const aktif = BUCKET_AKTIF.includes(v.bucket) && !tunggu && !!v.activeOp;
  const tahapLabel = v.activeOp?.stageLabel || v.next?.label || v.bucketLabel;
  return {
    key: `v2:${v.runId}`, sumber: "V2", runId: v.runId, unitId: v.unit.id,
    kodePendek: kodePendek(v.unit.unitCode), unitCode: v.unit.unitCode,
    customer: bersih(v.customer?.name) ?? "Customer belum dicatat",
    kasur: gabung(v.unit.merk, v.unit.ukuran),
    layanan: v.customer?.salesServices?.length ? v.customer.salesServices.join(", ") : v.unit.service?.label ?? null,
    tahap: jeda ? `Jeda · ${tahapLabel}` : tahapLabel,
    tone: jeda ? "orange" : BUCKET_TONE[v.bucket] ?? "gray",
    aktif,
    menit: aktif ? v.timer?.stepElapsedMinutes ?? null : null,
    progres: v.progress && v.progress.total > 0 ? { done: v.progress.done + v.progress.skipped, total: v.progress.total } : null,
    prioritas: prioritasDari(v.priority?.key, v.plan?.priorityLabel ?? v.priority?.label, v.plan?.priorityRank ?? v.priority?.rank ?? 0),
    terlambat: !!v.timer?.late || !!v.plan?.targetMissed,
    catatan: bersih(v.customer?.request),
    meja: v.plan?.stationLabel ?? null,
  };
}

export const V1_LABEL: Record<V1State, string> = {
  READY: "Siap dikerjakan", IN_PROGRESS: "Sedang berjalan", PAUSED: "Dijeda", BLOCKED: "Tertunda",
  WAITING_PREREQUISITE: "Menunggu tahap sebelumnya", WAITING_ASSIGNMENT: "Menunggu penugasan",
};
const V1_TONE: Record<V1State, ToneKey> = {
  READY: "gray", IN_PROGRESS: "blue", PAUSED: "orange", BLOCKED: "red", WAITING_PREREQUISITE: "gray", WAITING_ASSIGNMENT: "gray",
};

export function kartuDariV1(it: V1QueueItem): Kartu {
  const u = it.unit;
  const stage = it.stage?.labelId ?? null;
  return {
    key: `v1:${u.id}`, sumber: "V1", runId: null, unitId: u.id,
    kodePendek: kodePendek(u.unitCode), unitCode: u.unitCode,
    customer: bersih(u.order?.customer?.name) ?? "Customer belum dicatat",
    kasur: gabung(u.merk, u.ukuran), layanan: null,
    tahap: stage ? `${V1_LABEL[it.state]} · ${stage}` : V1_LABEL[it.state],
    tone: V1_TONE[it.state] ?? "gray",
    aktif: it.state === "IN_PROGRESS",
    menit: null, progres: null,
    prioritas: prioritasDari(u.priority, null, 0),
    terlambat: false, catatan: null, meja: null,
  };
}

/**
 * Urutan = urutan SERVER (V2 dulu: tanggal > meja > urutan manual Admin; lalu V1). Satu-satunya penyesuaian klien:
 * kartu yang sedang dikerjakan naik ke atas (stabil). Nomor antrean = posisi setelah itu, mulai 1.
 */
export function susunAntrean(v2: RunView[], v1: V1QueueItem[]): { aktif: (Kartu & { no: number }) | null; antrean: (Kartu & { no: number })[]; semua: (Kartu & { no: number })[] } {
  const all = [...v2.map(kartuDariV2), ...v1.map(kartuDariV1)];
  const urut = [...all.filter((k) => k.aktif), ...all.filter((k) => !k.aktif)].map((k, i) => ({ ...k, no: i + 1 }));
  const aktif = urut.find((k) => k.aktif) ?? null;
  return { aktif, antrean: urut.filter((k) => k !== aktif), semua: urut };
}

export function formatMenit(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m) || m < 0) return "—";
  if (m < 60) return `${Math.round(m)} mnt`;
  const j = Math.floor(m / 60);
  const s = Math.round(m % 60);
  return s ? `${j} j ${s} mnt` : `${j} jam`;
}

/** Ringkasan papan admin dari KPI server (tidak dihitung ulang di klien). */
export function ringkasPapan(b: AndonBoard | undefined) {
  const k = b?.kpi;
  const dikerjakan = BUCKET_AKTIF.reduce((n, key) => n + (b?.counts?.[key] ?? 0), 0);
  return { target: k?.planned ?? 0, selesai: k?.completed ?? 0, dikerjakan, terhambat: (k?.waitingMaterial ?? 0), terlambat: k?.late ?? 0 };
}

export type GrupMedia = { key: "before" | "process" | "after"; judul: string; items: (MediaItem & { video: boolean })[] };
const isVideo = (m: MediaItem) => /video/i.test(String(m.kind ?? "")) || /\.(mp4|mov|webm|m4v|3gp)(\?|$)/i.test(String(m.url ?? ""));

/** Media laporan produksi → tiga grup (Sebelum · Proses · Sesudah), foto & video, tanpa URL kosong. */
export function grupMedia(r: ProductionReport | undefined): GrupMedia[] {
  if (!r?.media) return [];
  const g = (key: GrupMedia["key"], judul: string, xs: MediaItem[] = []): GrupMedia => ({
    key, judul, items: xs.filter((m) => !!m.url).map((m) => ({ ...m, video: isVideo(m) })),
  });
  return [g("before", "Sebelum", r.media.before), g("process", "Proses", r.media.process), g("after", "Sesudah", r.media.after)].filter((x) => x.items.length > 0);
}
