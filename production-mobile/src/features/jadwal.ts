import type { RunView } from "@/api/types";
import type { ToneKey } from "@/design/tokens";
import { kodePendek } from "./model";

// MODEL MURNI PENJADWALAN (Admin / Kepala Produksi) — cermin `ScheduleModal` di frontend/src/features/production/ScheduleModals.jsx
// dan picLanes.js. Server = otoritas (kapasitas meja, lini PIC, revisi, aktivasi); berkas ini hanya menyusun pilihan & body yang
// SAMA dengan web supaya hasil dari HP dan dari SANSS Web tidak pernah berbeda. Bila ScheduleModal berubah, samakan di sini + tesnya.

// ---- Tipe data server --------------------------------------------------------------------------------------------------------

export type DefaultPic = { operatorId: string; name: string | null; active: boolean } | null;
/** Satu meja dari GET /production-v2/board. */
export type MejaPapan = { code: string; label: string; capacity: number; count: number; operatorNames: string[]; defaultPic: DefaultPic; items: RunView[] };
export type Papan = { readerMode: string; date?: string; config?: { stations: string[]; capacityPerStation: number; dailyTarget: number }; stations?: MejaPapan[] };

export type Lini = "TABLE" | "CORNER";
export type Operator = { id: string; name: string; userId: string; workLanes: Lini[] };
/** GET /production-v2/planning/refs */
export type RefsJadwal = {
  workCenters: { id: string; name: string }[];
  operators: Operator[];
  defaultWorkCenterId: string | null;
  problems?: { code: string; message: string; severity?: "info" }[];
};

/** Satu kartu backlog dari GET /production-v2/backlog (productionBacklog.js). */
export type ItemBacklog = {
  unitId: string;
  schedulable: boolean;
  view: RunView | null;
  rencana: { action: string; message?: string | null; onboardable: boolean; activatable: boolean; build: { product: { problem: string | null } } | null };
  card: {
    unit: { id: string; unitCode: string; merk: string | null; ukuran: string | null };
    customer: { name: string | null; orderNumber: string | null };
    priority: { key: string; label: string; rank: number };
    globalStatus?: string | null;
    receivedBasis?: string | null;
  };
};
export type HalamanBacklog = { total: number; hasMore: boolean; items: ItemBacklog[]; counts?: Record<string, number> };

export type PlanJadwal = {
  id: string; revision: number; productionDate: string | null; stationCode: string | null; priority: number;
  targetMissed: boolean; targetEffective: string | null;
  operator: { id: string; name: string | null } | null; cornerOperator: { id: string; name: string | null } | null;
};

/** Yang dijadwalkan: kartu yang sudah punya Run (dengan/ tanpa rencana) ATAU unit yang Run-nya dibuka saat dijadwalkan (onboarding). */
export type Sasaran = {
  runId: string | null;
  unitId: string;
  unitCode: string;
  customer: string | null;
  plan: PlanJadwal | null;
  saranPrioritas: 0 | 1;
  komplain: boolean;
  /** Belum diaktifkan untuk Rencana Produksi — Admin wajib mencentang persetujuan. */
  tanyaAktivasi: boolean;
  /** Jalur Pengerjaan Pesanan — wajib memilih Corner diperlukan/tidak. */
  tanyaCorner: boolean;
  masalahProduk: string | null;
};

// ---- Konstanta (HARUS sama dengan server/web) --------------------------------------------------------------------------------

export const PRIORITAS = [{ value: "0", label: "Normal" }, { value: "1", label: "Tinggi" }] as const;
export const ALASAN_JADWAL_ULANG = [
  { value: "CUSTOMER_REQUEST", label: "Permintaan pelanggan" }, { value: "WAITING_MATERIAL", label: "Menunggu bahan" },
  { value: "WAITING_ARRIVAL", label: "Unit belum tiba" }, { value: "CAPACITY", label: "Kapasitas meja/PIC" },
  { value: "PRIORITY_CHANGE", label: "Perubahan prioritas" }, { value: "QC_REWORK", label: "Rework / hasil QC" }, { value: "OTHER", label: "Lainnya" },
] as const;
export const CATATAN_JADWAL_ULANG_MIN = 5; // RESCHEDULE_NOTE_MIN (lib/domain/productionBoard.js)
export const ALASAN_CORNER_MIN = 3; // CORNER_REASON_MIN (unitCardModel.js)
/** Galat "papan basi" — formulir memuat ulang papan supaya pilihan meja ikut diperbarui. */
export const KODE_BASI = ["PLAN_STATION_FULL", "PLAN_REVISION_CONFLICT", "STATION_ORDER_STALE", "RENCANA_ACTIVATION_STALE", "RENCANA_RUN_OUTSIDE_COHORT", "RENCANA_HAS_PRIOR_RUN", "RENCANA_HAS_V1_PROGRESS", "RENCANA_PARTIAL_ACTIVATION"];

// ---- Sasaran -----------------------------------------------------------------------------------------------------------------

type PlanView = NonNullable<RunView["plan"]> & { revision?: number; priority?: number; targetEffective?: string | null };

function planDari(v: RunView): PlanJadwal | null {
  const p = v.plan as PlanView | null;
  if (!p?.id) return null;
  return {
    id: p.id, revision: p.revision ?? 0, productionDate: p.productionDate, stationCode: p.stationCode, priority: p.priority ?? p.priorityRank ?? 0,
    targetMissed: !!p.targetMissed, targetEffective: p.targetEffective ?? p.targetDate ?? null,
    operator: p.operator ? { id: p.operator.id, name: p.operator.name } : null,
    cornerOperator: p.cornerOperator ? { id: p.cornerOperator.id, name: p.cornerOperator.name } : null,
  };
}

/** Kartu yang sudah punya Run (papan atau backlog `schedulable`). */
export function sasaranDariView(v: RunView): Sasaran {
  const plan = planDari(v);
  return {
    runId: v.runId, unitId: v.unit.id, unitCode: v.unit.unitCode, customer: v.customer.name, plan,
    saranPrioritas: v.priority?.key === "NORMAL" ? 0 : 1, komplain: v.priority?.key === "COMPLAINT",
    tanyaAktivasi: false, tanyaCorner: false, masalahProduk: null,
  };
}

/** Kartu backlog → sasaran; null bila belum bisa dijadwalkan dari HP (mis. menunggu dijemput / pengecualian). Cermin BacklogCard + viewOfOnboardCard. */
export function sasaranDariBacklog(item: ItemBacklog): Sasaran | null {
  if (item.schedulable && item.view) return sasaranDariView(item.view);
  const r = item.rencana;
  const onboard = !!r?.onboardable;
  const aktivasi = !onboard && !!r?.activatable;
  if (!onboard && !aktivasi) return null;
  const c = item.card;
  return {
    runId: null, unitId: c.unit.id, unitCode: c.unit.unitCode, customer: c.customer?.name ?? null, plan: null,
    saranPrioritas: c.priority?.key === "NORMAL" ? 0 : 1, komplain: c.priority?.key === "COMPLAINT",
    tanyaAktivasi: !!r.activatable, // web: askActivate = activatable && onboardUnitId && !plan
    tanyaCorner: !!r.build, masalahProduk: r.build?.product?.problem ?? null,
  };
}

// ---- Pilihan formulir --------------------------------------------------------------------------------------------------------

export function kapasitas(m: Pick<MejaPapan, "items" | "count" | "capacity">) {
  const count = m.items?.length ?? m.count ?? 0;
  const capacity = m.capacity ?? 3;
  return { count, capacity, penuh: count >= capacity, label: `${count}/${capacity}` };
}

/** Meja pertama yang masih lega (bawaan formulir rencana baru). */
export function mejaLega(stations: MejaPapan[], kecuali: string | null = null) {
  return stations.find((s) => s.code === kecuali) ?? stations.find((s) => !kapasitas(s).penuh) ?? stations[0] ?? null;
}

/** Opsi PIC satu lini — cermin laneOptions(): hanya operator berlini itu; PIC yang SUDAH ditetapkan tetap tampil (ditandai). */
export function opsiLini(operators: Operator[], lini: Lini, sekarang: { id: string; name: string | null } | null = null) {
  const list = (operators || []).filter((o) => Array.isArray(o.workLanes) && o.workLanes.includes(lini)).map((o) => ({ id: o.id, name: o.name, lama: false }));
  if (sekarang?.id && !list.some((o) => o.id === sekarang.id)) list.unshift({ id: sekarang.id, name: sekarang.name || "PIC saat ini", lama: true });
  return list;
}

export type FormJadwal = {
  productionDate: string;
  stationCode: string;
  priority: 0 | 1;
  workCenterId: string;
  /** "" = ikuti PIC bawaan meja (server memilihnya). */
  operatorId: string;
  cornerOperatorId: string;
  aktivasiOk: boolean;
  corner: "" | "YES" | "NO";
  alasanCorner: string;
  alasanUlang: string;
  catatanUlang: string;
};

export function formAwal(s: Sasaran, ctx: { tanggal: string; stations: MejaPapan[]; refs: RefsJadwal | null }): FormJadwal {
  const p = s.plan;
  return {
    productionDate: p?.productionDate || ctx.tanggal,
    stationCode: p?.stationCode || mejaLega(ctx.stations)?.code || "",
    priority: Math.min(p?.priority ?? s.saranPrioritas, 1) as 0 | 1,
    workCenterId: ctx.refs?.defaultWorkCenterId || ctx.refs?.workCenters[0]?.id || "",
    operatorId: "",
    cornerOperatorId: p?.cornerOperator?.id || "",
    aktivasiOk: false, corner: "", alasanCorner: "", alasanUlang: "", catatanUlang: "",
  };
}

/** Wajib alasan jadwal ulang: target sudah lewat DAN tanggal produksi dipindah. */
export const perluAlasanUlang = (s: Sasaran, f: FormJadwal) => !!s.plan?.targetMissed && !!s.plan.productionDate && f.productionDate !== s.plan.productionDate;

/** Validasi klien (sama urutan & pesan dengan web). null = boleh dikirim. */
export function validasiJadwal(s: Sasaran, f: FormJadwal, picBawaan: DefaultPic): string | null {
  if (!f.stationCode) return "Pilih meja.";
  if (!f.workCenterId) return "Pilih workshop.";
  if (!f.operatorId && !picBawaan?.active && !s.plan?.operator?.id) return "Pilih PIC meja, atau tetapkan PIC bawaan meja dulu.";
  if (perluAlasanUlang(s, f) && (!f.alasanUlang || f.catatanUlang.trim().length < CATATAN_JADWAL_ULANG_MIN)) return `Target sudah lewat: pilih alasan dan tulis catatan (minimal ${CATATAN_JADWAL_ULANG_MIN} karakter).`;
  if (s.tanyaAktivasi && !s.plan && !f.aktivasiOk) return "Centang persetujuan: unit ini diaktifkan untuk Rencana Produksi saat jadwal disimpan.";
  if (s.tanyaCorner && !s.plan) {
    if (f.corner !== "YES" && f.corner !== "NO") return "Pilih: Corner diperlukan atau tidak diperlukan.";
    if (f.corner === "NO" && f.alasanCorner.trim().length < ALASAN_CORNER_MIN) return `Corner tidak diperlukan wajib beralasan (minimal ${ALASAN_CORNER_MIN} karakter).`;
  }
  return null;
}

export type PerintahJadwal =
  | { jenis: "rencana"; body: Record<string, unknown> } // POST /production-v2/plans
  | { jenis: "jadwal"; planId: string; body: Record<string, unknown> }; // POST /production-v2/plans/:id/schedule

/**
 * Body yang SAMA dengan ScheduleModal.submit(). Target khusus per kartu tidak diubah dari HP (tidak dikirim = server mempertahankannya).
 * `keluarkan` = keluarkan dari papan (tanggal & meja null).
 */
export function perintahJadwal(s: Sasaran, f: FormJadwal, keluarkan = false): PerintahJadwal {
  let body: Record<string, unknown>;
  if (keluarkan) body = { productionDate: null, stationCode: null, priority: f.priority };
  else {
    body = { productionDate: f.productionDate, stationCode: f.stationCode, priority: Number(f.priority), workCenterId: f.workCenterId };
    if (f.cornerOperatorId) body.cornerOperatorId = f.cornerOperatorId;
    if (f.operatorId) body.operatorId = f.operatorId; // kosong = server memakai PIC bawaan meja
    if (s.tanyaAktivasi && !s.plan) body.activateUnit = true;
    if (s.tanyaCorner && !s.plan) Object.assign(body, f.corner === "YES" ? { cornerRequired: true } : { cornerRequired: false, cornerReason: f.alasanCorner.trim() });
    if (perluAlasanUlang(s, f)) Object.assign(body, { rescheduleReason: f.alasanUlang, rescheduleNote: f.catatanUlang.trim() });
  }
  if (s.plan) return { jenis: "jadwal", planId: s.plan.id, body: { ...body, expectedRevision: s.plan.revision } };
  return { jenis: "rencana", body: s.runId ? { runId: s.runId, ...body } : { unitId: s.unitId, ...body } };
}

export const labelMeja = (code: string) => code.replace(/^TABLE_/, "Meja ");

export function pesanSukses(s: Sasaran, f: FormJadwal, keluarkan: boolean) {
  const kode = kodePendek(s.unitCode);
  return keluarkan ? `${kode} dikeluarkan dari papan.` : `${kode} dijadwalkan ke ${labelMeja(f.stationCode)} · ${f.productionDate}.`;
}

// ---- Perlu perhatian (Admin) -------------------------------------------------------------------------------------------------

export type Perhatian = { key: string; runId: string | null; kode: string; customer: string; alasan: string; tone: ToneKey; sasaran: Sasaran | null };

/**
 * Daftar yang menuntut keputusan Admin, terpenting dulu: Komplain (di papan maupun belum dijadwalkan), lewat target, tertunda/kurang bahan,
 * prioritas Tinggi yang belum dijadwalkan. Prioritas tetap MANUAL — daftar ini hanya memberi tahu, tidak mengubah urutan.
 */
export function perhatianAdmin(stations: MejaPapan[], backlog: ItemBacklog[]): Perhatian[] {
  const out: (Perhatian & { bobot: number })[] = [];
  for (const m of stations) {
    for (const v of m.items) {
      const kode = kodePendek(v.unit.unitCode);
      const base = { key: `p-${v.runId}`, runId: v.runId, kode, customer: v.customer.name || "—", sasaran: null };
      if (v.priority?.key === "COMPLAINT") out.push({ ...base, alasan: `Komplain · ${m.label}`, tone: "red", bobot: 0 });
      else if (v.plan?.targetMissed) out.push({ ...base, alasan: `Lewat target · ${m.label}`, tone: "red", bobot: 1 });
      else if (v.bucket === "MENUNGGU_BAHAN" || v.activeOp?.status === "BLOCKED") out.push({ ...base, alasan: `${v.bucket === "MENUNGGU_BAHAN" ? "Menunggu bahan" : "Tertunda"} · ${m.label}`, tone: "orange", bobot: 2 });
    }
  }
  for (const it of backlog) {
    const key = it.card?.priority?.key;
    if (key !== "COMPLAINT" && key !== "HIGH") continue;
    const s = sasaranDariBacklog(it);
    out.push({
      key: `b-${it.unitId}`, runId: it.view?.runId ?? null, kode: kodePendek(it.card.unit.unitCode), customer: it.card.customer?.name || "—",
      alasan: `${key === "COMPLAINT" ? "Komplain" : "Prioritas Tinggi"} · belum dijadwalkan`, tone: key === "COMPLAINT" ? "red" : "orange", sasaran: s, bobot: key === "COMPLAINT" ? 0 : 3,
    });
  }
  return out.sort((a, b) => a.bobot - b.bobot).map(({ bobot: _b, ...p }) => p);
}
