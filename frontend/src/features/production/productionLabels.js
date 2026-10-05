// Simplifikasi Production slice 1 — kosakata tampilan SATU tempat (murni, diuji node --test). CERMIN backend/src/lib/domain/productionDisplay.js:
// tes paritas menjaga keduanya sama. Hanya LABEL: tidak mengubah enum, histori, permission, atau mekanisme apa pun.
import { PRODUCTION_PRIORITY_REAL, UNIT_STATUS_REAL } from "../bengkel/unitStatus.js";

// ---- Status order/unit: Pengambilan · Diproses · Siap Kirim · Terkirim -----------------------------------------------------------------
export const DISPLAY_STATUS_TABS = Object.freeze([
  Object.freeze({ key: "PENGAMBILAN", label: "Pengambilan" }),
  Object.freeze({ key: "DIPROSES", label: "Diproses" }),
  Object.freeze({ key: "SIAP_KIRIM", label: "Siap Kirim" }),
  Object.freeze({ key: "TERKIRIM", label: "Terkirim" }),
]);
const KEY_OF_LABEL = Object.freeze({ Pengambilan: "PENGAMBILAN", Diproses: "DIPROSES", "Siap Kirim": "SIAP_KIRIM", Terkirim: "TERKIRIM", Dibatalkan: "DIBATALKAN" });
/** { key, label, tone, detail } untuk satu unit/baris; memakai `unitStatusDisplay` dari server bila ada, jika tidak turunan dari enum UnitStatus (peta yang sama). */
export function statusOf(row) {
  const s = row?.unitStatusDisplay || row?.unitStatus;
  const base = UNIT_STATUS_REAL[row?.status];
  if (s?.label) return { key: s.key || KEY_OF_LABEL[s.label] || "DIPROSES", label: s.label, tone: base?.tone || "neutral", detail: s.detail ?? base?.detail ?? null };
  if (!base) return { key: "DIPROSES", label: String(row?.status ?? "—"), tone: "neutral", detail: null };
  return { key: KEY_OF_LABEL[base.label] || "DIPROSES", label: base.label, tone: base.tone, detail: base.detail ?? null };
}
export const statusTone = (key) => ({ PENGAMBILAN: "neutral", DIPROSES: "accent", SIAP_KIRIM: "green", TERKIRIM: "green", DIBATALKAN: "neutral" }[key] || "neutral");

// ---- Keberadaan fisik (tidak pernah memalsukan konfirmasi tiba) ------------------------------------------------------------------------
export const presenceLabel = (p) => p?.label || null;
export const presenceTone = (p) => (p?.key === "NOT_ARRIVED" ? "orange" : p?.key === "ARRIVED_CONFIRMED" ? "green" : "neutral");

// ---- Prioritas: Normal · Tinggi · Komplain ------------------------------------------------------------------------------------------------
export const PRIORITY_TONE = Object.freeze({ NORMAL: "neutral", HIGH: "orange", COMPLAINT: "red" });
/**
 * Prioritas tampilan dari objek yang membawa `priority` (objek server {key,label}), `priorityDisplay`, atau nilai lama (angka 0/1/2, enum NORMAL/HIGH/URGENT/CRITICAL).
 * Komplain hanya muncul bila server mengirim kasus resmi — klien TIDAK PERNAH menurunkannya dari teks.
 */
export function priorityOf(row) {
  const obj = row?.priorityDisplay || (row?.priority && typeof row.priority === "object" ? row.priority : null);
  if (obj?.key) return { key: obj.key, label: obj.label, tone: PRIORITY_TONE[obj.key] || "neutral", complaintCases: obj.complaintCases || [] };
  const stored = row?.priority ?? row?.plan?.priority; // snapshot lama (Mode Latihan) hanya punya plan.priority
  const raw = typeof stored === "number" ? (stored >= 1 ? "HIGH" : "NORMAL") : (["HIGH", "URGENT", "CRITICAL"].includes(stored) ? "HIGH" : "NORMAL");
  return { key: raw, label: PRODUCTION_PRIORITY_REAL[raw]?.label || "Normal", tone: PRIORITY_TONE[raw], complaintCases: [] };
}
/** Pilihan yang boleh dipilih pengguna (Komplain turunan, bukan pilihan): nilai tersimpan 0/1. */
export const PRIORITY_CHOICES = Object.freeze([{ value: 0, label: "Normal" }, { value: 1, label: "Tinggi" }]);

// ---- Layanan Sales saja ----------------------------------------------------------------------------------------------------------------
export const salesServicesText = (list) => (Array.isArray(list) && list.length ? list.join(", ") : "—");

// ---- Pekerjaan Tertunda --------------------------------------------------------------------------------------------------------------------
export const DELAY_ACTION_LABEL = "Tunda Pekerjaan";
export const DELAY_QUESTION = "Kenapa pekerjaan ditunda?";
export const RESUME_ACTION_LABEL = "Lanjutkan Pekerjaan";
export const DELAY_TITLE = "Pekerjaan Tertunda";
export const DELAY_REASONS = Object.freeze({
  BAHAN: Object.freeze({ key: "BAHAN", label: "Menunggu bahan", submitAs: "MATERIAL_SHORTAGE" }),
  ARAHAN: Object.freeze({ key: "ARAHAN", label: "Menunggu arahan", submitAs: "AWAITING_CUSTOMER" }),
  KENDALA: Object.freeze({ key: "KENDALA", label: "Kendala pengerjaan", submitAs: "MACHINE_DOWN" }),
  LAINNYA: Object.freeze({ key: "LAINNYA", label: "Lainnya", submitAs: "OTHER" }),
});
export const DELAY_REASON_OPTIONS = Object.freeze(Object.values(DELAY_REASONS));
const BLOCK_TO_DELAY = Object.freeze({
  MATERIAL_SHORTAGE: "BAHAN",
  AWAITING_CUSTOMER_APPROVAL: "ARAHAN", AWAITING_CUSTOMER: "ARAHAN", AWAITING_OPERATOR: "ARAHAN",
  MACHINE_DOWN: "KENDALA", QUALITY_ISSUE: "KENDALA", AWAITING_TOOL: "KENDALA",
  OTHER: "LAINNYA",
});
export const delayReasonOfBlock = (blockReason) => DELAY_REASONS[BLOCK_TO_DELAY[blockReason]] || DELAY_REASONS.LAINNYA;
export const delayReasonOfKey = (key) => DELAY_REASONS[key] || null;
/** Enum BlockReason yang dikirim ke backend untuk alasan yang dipilih (tidak ada enum baru). */
export const blockReasonFor = (key) => DELAY_REASONS[key]?.submitAs || null;
/** "Lainnya" wajib keterangan (≥3 huruf) — sama dengan validateBlockReason di backend. */
export const delayFormValid = ({ key, note }) => !!DELAY_REASONS[key] && (key !== "LAINNYA" || String(note || "").trim().length >= 3);
/** Status kartu: "Tertunda — <alasan>"; Lainnya memakai keterangan. */
export function delayStatusText(blockReason, note = null) {
  const r = delayReasonOfBlock(blockReason);
  const extra = r.key === "LAINNYA" && String(note || "").trim() ? String(note).trim().slice(0, 80) : null;
  return `Tertunda — ${extra || r.label.toLowerCase()}`;
}
/**
 * Siapa yang perlu bertindak agar pekerjaan bisa dilanjutkan. Tombol "Lanjutkan Pekerjaan" HANYA untuk aksi pemulihan yang sah bagi pengguna;
 * selain itu tampilkan penjelasan siapa yang harus bertindak (tidak ada tombol palsu).
 *   source V1 (blokir tahap)  : UNIT_STAGE_WRITE (pekerja/Lead/QC/Admin/Owner) boleh melanjutkan.
 *   source V2 (kekurangan bahan): hanya Gudang (INVENTORY_WRITE) yang menutup; PIC menunggu.
 */
export function resumeInfo({ source, reason, canResume }) {
  const r = delayReasonOfBlock(reason);
  if (canResume) return { kind: "BUTTON", label: RESUME_ACTION_LABEL };
  if (source === "SHORTAGE") return { kind: "WAIT", who: "Gudang", text: "Menunggu Gudang menyediakan bahan. Setelah bahan diserahkan, pekerjaan bisa dilanjutkan." };
  if (r.key === "BAHAN") return { kind: "WAIT", who: "Gudang", text: "Menunggu bahan dari Gudang. Production Lead atau Gudang akan melanjutkan pekerjaan." };
  if (r.key === "ARAHAN") return { kind: "WAIT", who: "Production Lead", text: "Menunggu arahan. Hubungi Production Lead agar pekerjaan bisa dilanjutkan." };
  return { kind: "WAIT", who: "Production Lead", text: "Hubungi Production Lead agar pekerjaan bisa dilanjutkan." };
}

// ---- Peringkat urutan (bukan label): Komplain (3) > nilai tersimpan Mendesak lama (2) > Tinggi (1) > Normal (0) ----------------------------------------------
// Dipakai untuk urutan bawaan/peringatan inversi. Urutan MANUAL meja tetap menang atas peringkat apa pun (lihat stationOrder.js / planDnd.js).
export const rankOfView = (view) => view?.plan?.priorityRank ?? (view?.priority?.key === "COMPLAINT" ? 3 : view?.plan?.priority ?? 0);

// Status/keberadaan fisik kartu dari view server (toRunView). Server memberi `unitStatus` {key,label,detail} & `presence`; bila tidak ada (snapshot Mode Latihan lama),
// diturunkan dari enum UnitStatus unit — peta yang sama. `presence` TIDAK diturunkan di klien (tidak ada bukti → tidak ditampilkan).
export const viewStatus = (view) => statusOf({ unitStatusDisplay: view?.unitStatus, status: view?.unit?.status });
export const viewPresence = (view) => (view?.presence?.label ? view.presence : null);
