// P12C — model MURNI Aplikasi Meja/Corner mode aplikasi (tanpa JSX/jaringan, diuji `node --test`).
// Prinsip: SEMUA nilai (progres, tahap, bahan, aksi berikutnya, urutan) berasal dari server. Modul ini hanya MENERJEMAHKAN ke kartu/aksi.
//  - Jalur V2: item antrean `GET /production-v2/worker/:lane` (urutan manual/tanggal/meja sudah diurutkan server) + `next` dari server.
//  - Jalur V1: unit non-cohort yang DITUGASKAN ke operator ini (`GET /production/work-orders` -> assignedOperator.id = operator V2 yang sama) diperkaya
//    `GET /units/:id/timeline`. Tahap V1 TIDAK pernah dipetakan ke 12 langkah V2 (dua mesin berbeda, label & progres masing-masing dari server).
import { isGantiKain, materialBadge, mattressInfo, salesNoteOf, stageText } from "@/features/production/unitCardModel.js";
import { delayStatusText, priorityOf, resumeInfo, statusOf, viewPresence, viewStatus } from "@/features/production/productionLabels.js";
import { bucketLabelOf, bucketStyle } from "@/features/production/experience.js";
import { canMaterialV1, canStageV1, needsPhotoOf, stageStateOf } from "@/features/production/unitV1ActionsModel.js";

// Bottom navigation: MAKSIMAL 4 (diuji). Urutan = urutan tampil.
export const NAV_TABS = Object.freeze([
  Object.freeze({ key: "kerja", label: "Kerja", icon: "Briefcase" }),
  Object.freeze({ key: "bahan", label: "Bahan", icon: "Package" }),
  Object.freeze({ key: "aktivitas", label: "Aktivitas", icon: "Activity" }),
  Object.freeze({ key: "akun", label: "Akun", icon: "User" }),
]);
export const TAB_KEYS = Object.freeze(NAV_TABS.map((t) => t.key));
export const tabOf = (raw) => (TAB_KEYS.includes(raw) ? raw : "kerja");

// Mode aplikasi lantai. Peran = cermin izin server (sama dengan TRAINING_PAGES); server tetap penegak akses.
const FLOOR_ROLES = ["PRODUCTION_WORKER", "PRODUCTION_LEAD", "ADMIN", "OWNER"];
export const APP_MODES = Object.freeze([
  Object.freeze({ key: "meja", label: "Meja Bongkar", to: "/produksi/meja", lane: "TABLE", roles: FLOOR_ROLES }),
  Object.freeze({ key: "corner", label: "Meja Corner", to: "/produksi/corner", lane: "CORNER", roles: FLOOR_ROLES }),
  // PIC Bahan per pekerjaan (jalur Pengerjaan Pesanan): hanya pekerjaan yang ditugaskan kepadanya oleh Lead; otorisasi ditegakkan server per pekerjaan (bukan peran baru).
  Object.freeze({ key: "bahan", label: "PIC Bahan", to: "/produksi/bahan", lane: "MATERIAL", roles: FLOOR_ROLES }),
  Object.freeze({ key: "dokumentasi", label: "Dokumentasi", to: "/produksi/dokumentasi", lane: null, roles: Object.freeze(["PRODUCTION_DOCUMENTER", "PRODUCTION_LEAD", "ADMIN", "OWNER"]) }),
]);
// Pengguna multi-peran hanya melihat mode yang memang diizinkan perannya (tidak ada tombol yang pasti 403).
export const allowedModes = (roles = []) => APP_MODES.filter((m) => (roles || []).some((r) => m.roles.includes(r)));
export const modeOfLane = (lane) => APP_MODES.find((m) => m.lane === (lane === "CORNER" || lane === "MATERIAL" ? lane : "TABLE"));

// ---- Prioritas: Normal · Tinggi · Komplain (Komplain hanya dari kasus komplain resmi yang dikirim server) ----
// Nilai tersimpan lama (Mendesak/Kritis) tampil "Tinggi"; enum/histori tidak diubah. `value` = peringkat urut (bukan label).
export function priorityOfV1(unit) { const p = priorityOf(unit); return { ...p, value: p.key === "COMPLAINT" ? 3 : p.key === "HIGH" ? 1 : 0 }; }
export function priorityOfV2(item) { const p = priorityOf(item); return { ...p, value: p.key === "COMPLAINT" ? 3 : p.key === "HIGH" ? 1 : 0 }; }

const dash = (s) => (s && String(s).trim() ? String(s).trim() : null);
export const kasurLine = (view) => { const m = mattressInfo(view); return [m.jenis, m.merk, m.ukuran].filter(Boolean).join(" · ") || null; };

// ---- Kartu V2 ----
export function jobFromV2(item) {
  const customer = item?.customer || {};
  const view = { customer, unit: item?.unit };
  const style = bucketStyle(item?.bucket);
  const waiting = item?.bucket === "MENUNGGU_BAHAN" || !!item?.shortage || item?.next?.wait === "MATERIAL_SHORTAGE";
  const prog = item?.progress && Number.isFinite(item.progress.total) ? { done: item.progress.done ?? 0, skipped: item.progress.skipped ?? 0, remaining: item.progress.remaining ?? 0, total: item.progress.total, source: "server-v2" } : null;
  return {
    key: `v2:${item.runId}`, source: "V2", id: item.runId, unitId: item.unit?.id ?? null, revision: item.revision,
    unitCode: item.unit?.unitCode ?? "—", orderNumber: customer.orderNumber ?? item.unit?.orderNumber ?? null,
    customerName: dash(customer.name) || "Customer belum dicatat",
    photoUrl: item.unit?.photoUrl || null,
    salesServices: Array.isArray(customer.salesServices) ? customer.salesServices : [],
    kasur: kasurLine(view),
    note: salesNoteOf(view), salesName: dash(customer.salesName),
    gantiKain: isGantiKain(view), gantiKainNoteMissing: isGantiKain(view) && !salesNoteOf(view),
    priority: priorityOfV2(item),
    status: viewStatus(item), presence: viewPresence(item),
    stage: { label: stageText(item), bucket: item.bucket, tone: style.badge, bucketLabel: bucketLabelOf(item?.bucket, item?.track) },
    stationLabel: item.plan?.stationLabel ?? null, sequence: item.plan?.stationSequence ?? null,
    adaptation: !!item?.adaptation, delayKind: item?.activeOp?.status === "PAUSED" ? (item.activeOp.delayKind ?? null) : null, delayNote: item?.activeOp?.delayNote ?? null,
    progress: prog, materialWaiting: waiting, material: materialBadge(item), late: !!item.timer?.late,
    active: ["BONGKAR", "DIAGNOSA", "FONDASI", "LAPISAN", "QC", "CORNER"].includes(item.bucket) && item.next?.action !== "WAIT" && !!item.activeOp,
    raw: item,
  };
}

// ---- Kartu V1 ----
// `item` = baris antrean V1 dari server (GET /production/v1-worker-queue): { unit, state, stage, prerequisite, waitingFor }; `timeline` = GET /units/:id/timeline
// (null bila belum dimuat -> field yang belum diketahui kosong, bukan tebakan). Keadaan (siap / berjalan / menunggu prasyarat / menunggu penugasan) SELALU dari server.
export const V1_STATE_LABEL = Object.freeze({
  READY: "Siap dikerjakan", IN_PROGRESS: "Sedang berjalan", PAUSED: "Dijeda", BLOCKED: "Tertunda",
  WAITING_PREREQUISITE: "Menunggu tahap prasyarat", WAITING_ASSIGNMENT: "Menunggu penugasan berikutnya",
});
const V1_STATE_TONE = Object.freeze({ READY: "accent", IN_PROGRESS: "accent", PAUSED: "orange", BLOCKED: "red", WAITING_PREREQUISITE: "orange", WAITING_ASSIGNMENT: "neutral" });
// Hanya keadaan ini yang membuka aksi (mulai / selesaikan / lanjutkan); sisanya informasi saja.
export const V1_ACTIONABLE = Object.freeze(["READY", "IN_PROGRESS", "PAUSED", "BLOCKED"]); // slice 2: BLOCKED (tertunda) dapat dilanjutkan lewat SATU aksi Lanjutkan Pekerjaan
export const isV1Actionable = (state) => V1_ACTIONABLE.includes(state);

export function v1Progress(timeline) {
  const path = timeline?.path;
  if (!Array.isArray(path) || path.length === 0) return null;
  return { done: path.filter((p) => p.status === "DONE" || p.status === "SKIPPED").length, total: path.length, source: "server-v1" };
}
// Teks info untuk keadaan menunggu (kartu & detail): siapa/apa yang ditunggu — dari server.
export function v1WaitInfo(item) {
  if (!item) return null;
  if (item.state === "WAITING_PREREQUISITE" && item.prerequisite) {
    const who = item.prerequisite.assigned ? (item.prerequisite.assignee || "PIC lain") : "belum ditugaskan";
    return { title: "Menunggu tahap prasyarat", text: `${item.prerequisite.stage.labelId} — ${who}. Tombol muncul setelah tahap itu selesai dan giliran Anda tiba.` };
  }
  if (item.state === "WAITING_ASSIGNMENT" && item.waitingFor) {
    return { title: "Menunggu penugasan berikutnya", text: `Tahap ${item.waitingFor.labelId} belum ditugaskan. Unit tetap di daftar Anda sampai Production Lead menugaskannya ke PIC berikutnya.` };
  }
  return null;
}
export function jobFromV1(item, timeline = null) {
  const unit = item.unit;
  const sales = Array.isArray(timeline?.salesServices) ? timeline.salesServices : [];
  const ctx = timeline?.salesContext || {};
  const customer = { salesServices: sales, request: ctx.request ?? null, productType: null };
  const view = { customer, unit };
  const stageLabel = item.stage?.labelId || null;
  const delayText = item.state === "BLOCKED" && timeline?.activeBlocker ? delayStatusText(timeline.activeBlocker.reason, timeline.activeBlocker.note) : null;
  const info = delayText || V1_STATE_LABEL[item.state] || "Antrean";
  const wait = v1WaitInfo(item);
  return {
    key: `v1:${unit.id}`, source: "V1", id: unit.id, unitId: unit.id, // "source" = istilah internal kode; tidak pernah ditampilkan
    unitCode: unit.unitCode, orderNumber: unit.order?.orderNumber ?? null,
    customerName: dash(unit.order?.customer?.name) || "Customer belum dicatat",
    photoUrl: ctx.photoUrl || null,
    salesServices: sales,
    kasur: [unit.merk, unit.ukuran].filter(Boolean).join(" · ") || null,
    note: salesNoteOf(view), salesName: dash(ctx.salesName),
    gantiKain: isGantiKain(view), gantiKainNoteMissing: isGantiKain(view) && !salesNoteOf(view),
    priority: priorityOfV1(unit),
    status: statusOf({ unitStatusDisplay: unit.unitStatusDisplay, status: unit.status }), presence: null,
    stage: { label: stageLabel ? `${info} · ${stageLabel}` : info, bucket: item.state, tone: V1_STATE_TONE[item.state] || "neutral", bucketLabel: info },
    v1: { state: item.state, stage: item.stage, prerequisite: item.prerequisite || null, waitingFor: item.waitingFor || null, actionable: isV1Actionable(item.state), wait },
    stationLabel: null, sequence: null,
    progress: v1Progress(timeline), materialWaiting: false, material: null,
    late: false, active: item.state === "IN_PROGRESS",
    loadedDetail: !!timeline, createdAt: unit.createdAt, item, raw: item,
  };
}

// Urutan: yang sedang dikerjakan dulu; V2 mengikuti urutan SERVER (tanggal > meja > urutan manual); V1 mengikuti urutan SERVER (keadaan > prioritas > umur) dan
// ditempatkan sesudah V2. TIDAK ada pengurutan ulang oleh klien (kecuali "sedang dikerjakan" naik ke atas, stabil).
export function orderJobs(jobs) {
  const all = [...jobs.filter((j) => j.source === "V2"), ...jobs.filter((j) => j.source === "V1")];
  const active = all.filter((j) => j.active);
  return [...active, ...all.filter((j) => !j.active)];
}
export function splitJobs(jobs) {
  const ordered = orderJobs(jobs);
  const active = ordered.find((j) => j.active) || null;
  return { active, queue: ordered.filter((j) => j !== active) };
}

// Ringkasan PIC untuk beranda: nama operator + meja yang sedang dilayani (dari plan, bukan tebakan).
export function picSummary(jobs, { lane, user, all } = {}) {
  const stations = [...new Set(jobs.filter((j) => j.source === "V2").map((j) => j.stationLabel).filter(Boolean))];
  const centers = [...new Set(jobs.filter((j) => j.source === "V1").map((j) => j.stationLabel).filter(Boolean))];
  return { name: user?.name || "—", lane, all: !!all, stations, centers };
}

// ---- Aksi utama V1 (satu aksi; keadaan dari timeline server). Aksi lain (jeda/terhambat) sekunder; putusan QC & penyelesaian blokir BUKAN di aplikasi. ----
export function primaryActionV1(timeline, roles = [], { state = null } = {}) {
  // Keadaan antrean dari server (bila diberikan) membatasi: menunggu prasyarat/penugasan tidak membuka aksi apa pun.
  if (state && !isV1Actionable(state)) {
    if (state === "BLOCKED" && timeline?.activeBlocker?.reason !== "MATERIAL_SHORTAGE") return { kind: "RESUME_WORK", label: "Lanjutkan Pekerjaan" };
    return { kind: "NONE", reason: state === "BLOCKED" ? resumeInfo({ source: "BLOCKER", reason: timeline?.activeBlocker?.reason, canResume: false }).text : "Belum giliran Anda — lihat keterangan di atas." };
  }
  const st = stageStateOf(timeline);
  if (!canStageV1(roles)) return { kind: "NONE", reason: "Hanya tim produksi yang dapat menjalankan tahap." };
  const label = st.current?.stage?.labelId || st.first?.labelId || null;
  switch (st.kind) {
    case "NEEDS_SERVICE": return { kind: "NONE", reason: "Rute pengerjaan belum ditentukan — menunggu Production Lead." };
    case "ALL_DONE": return { kind: "NONE", reason: "Seluruh tahap selesai." };
    case "NOT_STARTED": case "READY": return { kind: "START", label: label ? `Mulai ${label}` : "Mulai tahap", stage: st.current?.stage || st.first };
    case "PAUSED": return { kind: "RESUME_WORK", label: "Lanjutkan Pekerjaan", stage: st.current.stage };
    case "IN_PROGRESS": return { kind: "COMPLETE", label: label ? `Selesaikan ${label}` : "Selesaikan tahap", stage: st.current.stage, needsPhoto: needsPhotoOf(st), secondary: ["PAUSE", "BLOCK"] };
    case "IN_PROGRESS_QC": return { kind: "NONE", reason: "Tahap gerbang QC berjalan — putusan hanya oleh QC.", stage: st.current.stage };
    case "BLOCKED": return timeline?.activeBlocker?.reason === "MATERIAL_SHORTAGE" ? { kind: "NONE", reason: resumeInfo({ source: "BLOCKER", reason: "MATERIAL_SHORTAGE", canResume: false }).text, stage: st.current.stage } : { kind: "RESUME_WORK", label: "Lanjutkan Pekerjaan", stage: st.current.stage };
    default: return { kind: "NONE", reason: "Belum ada tindakan yang tersedia." };
  }
}
export const canRecordMaterialV1 = canMaterialV1;

// ---- Offline: aksi TIDAK dianggap berhasil sebelum diterima server ----
export function submitState({ online, busy }) {
  if (busy) return { disabled: true, reason: null };
  if (!online) return { disabled: true, reason: "Offline — kirim saat sinyal kembali. Isian tersimpan di HP ini; belum ada yang terkirim ke server." };
  return { disabled: false, reason: null };
}

// ---- Kartu Bahan (tab Bahan): dari server. V2 = status bahan & kekurangan dari item antrean; V1 = tidak ada rencana bahan (pemakaian dicatat di detail). ----
export function materialRows(jobs) {
  const rows = jobs.map((j) => {
    if (j.source === "V2") {
      const shortage = j.raw?.shortage;
      return { key: j.key, job: j, kind: shortage ? "SHORTAGE" : j.materialWaiting ? "WAITING" : j.material ? "STATUS" : "NONE", badge: shortage ? { label: "Bahan kurang", tone: "red" } : j.material, items: shortage?.items || [] };
    }
    return { key: j.key, job: j, kind: "V1", badge: null, items: [] };
  });
  const rank = { SHORTAGE: 0, WAITING: 1, STATUS: 2, NONE: 3, V1: 4 };
  return rows.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

// Teks galat -> aman ditampilkan (tidak pernah UUID/kode teknis).
export const safeText = (v, max = 140) => { const s = String(v ?? "").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "…"); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };

// Penolakan SERVER karena penugasan/tahap berubah (guard V1 P12C.2): kartu tidak lagi milik PIC ini. Kode dari backend/src/lib/domain/v1StageActor.js.
export const HANDOFF_CODES = Object.freeze(["UNIT_V1_NOT_YOUR_ASSIGNMENT", "UNIT_V1_STAGE_CHANGED", "UNIT_V1_STAGE_NOT_ASSIGNED"]);
export const isHandoffError = (e) => !!e && HANDOFF_CODES.includes(e.code);
export const HANDOFF_TITLE = "Pekerjaan sudah dialihkan";
// Pesan yang TETAP terlihat setelah antrean dimuat ulang (disimpan di induk, bukan di detail yang ikut hilang bersama kartunya).
export const handoffNotice = ({ unitCode = "", orderNumber = "" } = {}) => ({
  key: unitCode || "unit",
  unitCode,
  title: HANDOFF_TITLE,
  text: `${[unitCode, orderNumber].filter(Boolean).join(" · ") || "Unit ini"}: penugasan tahap ini sudah dialihkan ke PIC lain atau tahap sudah berubah. Aksi Anda tidak dikirim dan tidak ada yang berubah.`,
});

// Inisial untuk foto kosong (mis. "Ibu Maya Sari" -> "IM").
export const initialsOf = (name) => String(name || "?").split(/[\s/]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("") || "?";
