// Export Excel Rencana Produksi (snapshot baca-saja) — kontrak data MURNI (tanpa DB; diuji node --test).
// Prinsip: SEMUA nilai berasal dari server (view papan yang sama: toRunView + riwayat jadwal); frontend hanya memformat. Tidak ada status yang dihitung ulang di klien,
// tidak ada teks yang dibaca dari DOM. Harga TIDAK ada kecuali pemanggil ADMIN/OWNER meminta "Sertakan nilai order" — selain itu server tidak pernah memuatnya.
import { RESCHEDULE_REASONS, compareStationOrder, effectiveTargetKey, formatProductionDate, stationLabel } from "./productionBoard.js";

export const EXPORT_MAX_ROWS = 5000;
export const EXPORT_MAX_RANGE_DAYS = 62;
export const UNSCHEDULED_LABEL = "Belum Dijadwalkan";
export const NO_PIC_LABEL = "Belum ada PIC";
export const PIC_PENDING_LABEL = "Belum ditetapkan";
export const NOT_REQUIRED_LABEL = "Tidak diperlukan";
export const MATERIAL_BLOCKED_PREFIX = "Tertahan — ";
export const LATE_PREFIX = "Lewat target";

const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const isKey = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(`${s}T00:00:00.000Z`)) && new Date(`${s}T00:00:00.000Z`).toISOString().slice(0, 10) === s;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / 86_400_000);

/** "2026-10-12" -> "12 Oktober 2026". */
export function longDateId(key) {
  if (!isKey(key)) return "";
  const [y, m, d] = key.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS_ID[m - 1]} ${y}`;
}
/** Waktu WIB (UTC+7) untuk keterangan "Data dibuat": "12 Oktober 2026, 14.05 WIB". */
export function wibStamp(now = new Date()) {
  const w = new Date(new Date(now).getTime() + 7 * 3600_000);
  const key = w.toISOString().slice(0, 10);
  const hh = String(w.getUTCHours()).padStart(2, "0"); const mm = String(w.getUTCMinutes()).padStart(2, "0");
  return `${longDateId(key)}, ${hh}.${mm} WIB`;
}
/** Target-Produksi-DD-MMMM-YYYY.xlsx (satu tanggal). Rentang: ...-DD-MMMM-YYYY-sd-DD-MMMM-YYYY.xlsx. Tanpa karakter terlarang di nama berkas. */
export function exportFileName({ from, to }) {
  const part = (k) => longDateId(k).replace(/ /g, "-");
  const a = part(from); const b = part(to || from);
  return from && to && from !== to ? `Target-Produksi-${a}-sd-${b}.xlsx` : `Target-Produksi-${a}.xlsx`;
}

const err = (message, code, statusCode = 400) => Object.assign(new Error(message), { statusCode, code });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const list = (v) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((x) => String(x).trim()).filter(Boolean);

/**
 * Normalisasi masukan export (body JSON). from/to default = tanggal papan (todayWib bila kosong). stations: [] = semua Meja.
 * runIds/unitIds (mode "kartu yang terlihat"): daftar id yang sedang tampil di layar — server tetap memuat datanya sendiri dari DB.
 */
export function normalizeExportQuery(raw = {}, { today, stations: allowedStations = [] } = {}) {
  const from = raw.from || raw.date || today;
  const to = raw.to || from;
  if (!isKey(from) || !isKey(to)) throw err("Tanggal export tidak valid (format YYYY-MM-DD)", "EXPORT_DATE_INVALID");
  if (to < from) throw err("Tanggal akhir tidak boleh sebelum tanggal awal", "EXPORT_RANGE_INVALID");
  if (daysBetween(from, to) + 1 > EXPORT_MAX_RANGE_DAYS) throw err(`Rentang export maksimal ${EXPORT_MAX_RANGE_DAYS} hari`, "EXPORT_RANGE_TOO_LONG");
  const stations = [...new Set(list(raw.stations))];
  for (const s of stations) if (!allowedStations.includes(s)) throw err(`Meja tidak dikenal: ${s}`, "EXPORT_STATION_INVALID");
  const runIds = [...new Set(list(raw.runIds))]; const unitIds = [...new Set(list(raw.unitIds))];
  if ([...runIds, ...unitIds].some((id) => !UUID_RE.test(id))) throw err("Daftar kartu tidak valid", "EXPORT_IDS_INVALID");
  if (runIds.length + unitIds.length > EXPORT_MAX_ROWS) throw err(`Maksimal ${EXPORT_MAX_ROWS} kartu per export`, "EXPORT_TOO_MANY", 413);
  const visibleOnly = raw.visibleOnly === true || raw.visibleOnly === "true";
  return {
    from, to, stations, runIds, unitIds, visibleOnly,
    includeUnscheduled: raw.includeUnscheduled === undefined ? stations.length === 0 : raw.includeUnscheduled === true || raw.includeUnscheduled === "true",
    includeValue: raw.includeValue === true || raw.includeValue === "true",
  };
}

// ---- Kolom ------------------------------------------------------------------------------------------------------------------------------------
// type: teks | tanggal | angka | rupiah. wrap = bungkus teks panjang. width = lebar kolom (karakter Excel).
export const EXPORT_COLUMNS = Object.freeze([
  { key: "no", header: "No.", type: "angka", width: 6 },
  { key: "target", header: "Target", type: "tanggal", width: 13 },
  { key: "meja", header: "Meja", type: "teks", width: 18 },
  { key: "urutan", header: "Urutan", type: "angka", width: 8 },
  { key: "prioritas", header: "Prioritas", type: "teks", width: 11 },
  { key: "status", header: "Status", type: "teks", width: 20, wrap: true },
  { key: "resi", header: "Resi", type: "teks", width: 22 },
  { key: "unitCode", header: "Kode Unit", type: "teks", width: 18 },
  { key: "customer", header: "Customer", type: "teks", width: 24, wrap: true },
  { key: "sales", header: "Sales", type: "teks", width: 16 },
  { key: "layanan", header: "Layanan Sales", type: "teks", width: 30, wrap: true },
  { key: "jenisProduk", header: "Jenis Produk", type: "teks", width: 18, wrap: true },
  { key: "jenisKasur", header: "Jenis Kasur", type: "teks", width: 18, wrap: true },
  { key: "merek", header: "Merek", type: "teks", width: 16, wrap: true },
  { key: "ukuran", header: "Ukuran", type: "teks", width: 14, wrap: true },
  { key: "berat", header: "Berat Customer", type: "angka", width: 12 },
  { key: "catatanSales", header: "Keluhan/Catatan Sales", type: "teks", width: 44, wrap: true },
  { key: "gantiKain", header: "Ganti Kain", type: "teks", width: 11 },
  { key: "picMeja", header: "PIC Meja", type: "teks", width: 18, wrap: true },
  { key: "picBahan", header: "PIC Bahan", type: "teks", width: 18, wrap: true },
  { key: "picQc", header: "PIC QC", type: "teks", width: 18, wrap: true },
  { key: "picCorner", header: "PIC Corner", type: "teks", width: 18, wrap: true },
  { key: "statusBahan", header: "Status Bahan", type: "teks", width: 28, wrap: true },
  { key: "tahap", header: "Tahap Sekarang", type: "teks", width: 28, wrap: true },
  { key: "alasanLewat", header: "Alasan Lewat Target", type: "teks", width: 32, wrap: true },
  { key: "catatanLead", header: "Catatan Kepala Produksi", type: "teks", width: 44, wrap: true },
]);
export const EXPORT_VALUE_COLUMN = Object.freeze({ key: "nilaiOrder", header: "Nilai Order", type: "rupiah", width: 16 });
export const columnsFor = ({ includeValue = false } = {}) => (includeValue ? [...EXPORT_COLUMNS, EXPORT_VALUE_COLUMN] : [...EXPORT_COLUMNS]);

// ---- Pembentuk baris -----------------------------------------------------------------------------------------------------------------------
const clean = (v, max = 4000) => (v == null ? "" : String(v).replace(/\u0000/g, "").trim().slice(0, max));
const LINE_LABEL = Object.freeze({ KASUR: "Kasur", SOFA: "Sofa", DIVAN: "Divan" });
const TYPE_LABEL = Object.freeze({
  KASUR_SPRING: "Kasur Spring", KASUR_BUSA: "Kasur Busa", MULTIBED: "Multibed", KASUR_2IN1_ATAS: "Kasur 2in1 Atas", KASUR_2IN1_BAWAH: "Kasur 2in1 Bawah", KASUR_SEHAT: "Kasur Sehat", KASUR_2IN1: "Kasur 2in1", KASUR_LAINNYA: "Lainnya",
  SOFABED: "Sofabed", SOFA_L: "Sofa L", SOFA_1_SEATER: "Sofa 1 Seater", SOFA_2_SEATER: "Sofa 2 Seater", SOFA_3_SEATER: "Sofa 3 Seater", DIVAN_UTAMA: "Divan", DIVAN_SANDARAN: "Sandaran",
});
const KASUR_TYPES = new Set(["KASUR_SPRING", "KASUR_BUSA", "MULTIBED", "KASUR_2IN1_ATAS", "KASUR_2IN1_BAWAH", "KASUR_SEHAT", "KASUR_2IN1", "KASUR_LAINNYA"]);
/** { jenisProduk, jenisKasur } dari lini + jenis kanonis unit/order. Jenis Kasur hanya untuk keluarga kasur; sofa/divan menaruh jenisnya di Jenis Produk. */
export function productLabels({ productLine = null, productType = null } = {}) {
  const line = productLine ? LINE_LABEL[productLine] || null : null;
  const type = productType ? TYPE_LABEL[productType] || null : null;
  if (productType && KASUR_TYPES.has(productType)) return { jenisProduk: line || "Kasur", jenisKasur: type || "—" };
  if (productType && type) return { jenisProduk: line ? `${line} — ${type}` : type, jenisKasur: "—" };
  return { jenisProduk: line || "—", jenisKasur: "—" };
}

/** Teks "Lewat Target" dari server: sedang lewat (targetMissed) -> "Lewat target N hari"; riwayat jadwal ulang setelah lewat -> "Riwayat: ...". Kosong = tidak lewat. */
export function lateReasonText({ targetKey = null, todayKey, missedNow = false, events = [] } = {}) {
  const missedEvents = (events || []).filter((e) => e.missedTarget);
  const last = missedEvents.at(-1) || null;
  const reason = last?.reasonCode ? RESCHEDULE_REASONS[last.reasonCode] || last.reasonCode : null;
  if (missedNow && targetKey) {
    const days = Math.max(1, daysBetween(targetKey, todayKey));
    return `${LATE_PREFIX} ${days} hari${reason ? ` — jadwal ulang: ${reason}` : ""}`;
  }
  if (last) return `Riwayat: dijadwalkan ulang setelah lewat target${reason ? ` — ${reason}` : ""}`;
  return "";
}

/** Catatan Kepala Produksi = catatan terbaru pada riwayat jadwal (penjadwalan/jadwal ulang/ubah target) — apa adanya. */
export function leadNoteOf(events = []) {
  const withNote = (events || []).filter((e) => clean(e.note));
  return withNote.length ? clean(withNote.at(-1).note) : "";
}

/**
 * Baris export dari VIEW papan (toRunView) + data tambahan yang sudah dimuat server. Tidak menghitung status baru: label status/tahap/bahan = milik view.
 * @param {object} p  { view, extras: { productLine, productType, merk, ukuran, salesName, picQc, events, orderValue }, todayKey, includeValue }
 */
export function exportRowOf({ view, extras = {}, todayKey, includeValue = false }) {
  const plan = view.plan || null;
  const scheduled = !!plan?.stationCode && !!plan?.productionDate;
  const targetKey = plan ? effectiveTargetKey({ targetDate: plan.targetDate, productionDate: plan.productionDate }) : null;
  const { jenisProduk, jenisKasur } = productLabels(extras);
  const complaints = (view.customer?.complaints || []).join(", ");
  const request = clean(view.customer?.request);
  const catatanSales = [complaints && `Keluhan: ${complaints}`, request && `Catatan: ${request}`].filter(Boolean).join("\n");
  const fabric = extras.gantiKain === true;
  const blockedMaterial = view.warnings?.some((w) => w.code === "BAHAN_BELUM" || w.code === "KEKURANGAN") || view.materialStatus?.key === "KEKURANGAN";
  const cornerApplies = view.corner?.applies !== false;
  const picMeja = plan?.operator?.name || (scheduled ? NO_PIC_LABEL : "—");
  const materialOperator = view.build?.materialOperator?.name || view.materialPic?.materialOperator?.name || null;
  const picBahan = materialOperator || (plan ? PIC_PENDING_LABEL : "—");
  const steps = view.steps || [];
  const current = steps.find((s) => s.status === "CURRENT") || steps.find((s) => s.status === "WAITING") || null;
  const row = {
    runId: view.runId ?? null, unitId: view.unit?.id ?? null,
    target: scheduled || targetKey ? targetKey : null,
    meja: scheduled ? stationLabel(plan.stationCode) : UNSCHEDULED_LABEL,
    stationCode: scheduled ? plan.stationCode : null,
    urutan: scheduled ? plan.stationSequence ?? null : null, // diganti nomor POSISI di Meja saat diurutkan (sortExportRows); seqManual = nomor manual sudah diatur Kepala Produksi
    seqManual: scheduled && plan.stationSequence != null, productionDate: plan?.productionDate ?? null, targetStartAt: plan?.targetStartAt ?? null,
    prioritas: view.priority?.label || "Normal", priorityKey: view.priority?.key || "NORMAL", priorityRank: view.priority?.rank ?? 0,
    status: clean(view.globalStatus?.label || view.unitStatus?.label || "—") + (view.globalStatus?.detail ? ` — ${clean(view.globalStatus.detail)}` : ""),
    resi: clean(view.customer?.orderNumber) || "—", unitCode: clean(view.unit?.unitCode) || "—",
    customer: clean(view.customer?.name) || "—", sales: clean(view.customer?.salesName || extras.salesName) || "—",
    layanan: (view.customer?.salesServices || []).filter(Boolean).join(", ") || "—", // Layanan Sales saja; layanan teknis tidak pernah ikut
    jenisProduk, jenisKasur, merek: clean(extras.merk ?? view.unit?.merk) || "—", ukuran: clean(extras.ukuran ?? view.unit?.ukuran) || "—",
    berat: typeof view.customer?.weightKg === "number" ? view.customer.weightKg : (view.customer?.weightKg != null && Number.isFinite(Number(view.customer.weightKg)) ? Number(view.customer.weightKg) : null),
    catatanSales: catatanSales || "—", gantiKain: fabric ? "Ya" : "Tidak",
    picMeja, picBahan, picQc: clean(extras.picQc) || "—",
    picCorner: !cornerApplies ? NOT_REQUIRED_LABEL : (plan?.cornerOperator?.name || (plan ? PIC_PENDING_LABEL : "—")),
    statusBahan: view.materialStatus?.label ? `${blockedMaterial ? MATERIAL_BLOCKED_PREFIX : ""}${view.materialStatus.label}` : "—",
    tahap: current ? `${current.no}. ${current.label}` : clean(view.bucketLabel) || "—",
    alasanLewat: lateReasonText({ targetKey, todayKey, missedNow: !!plan?.targetMissed, events: extras.events || [] }),
    catatanLead: leadNoteOf(extras.events || []) || "—",
    createdAt: extras.createdAt ?? null,
    late: !!plan?.targetMissed,
  };
  if (includeValue) row.nilaiOrder = typeof extras.orderValue === "number" ? extras.orderValue : null;
  return row;
}

/** Baris untuk unit tanpa Run (kartu backlog ringkas): tanpa jadwal/PIC/tahap — kolom itu "—" (tidak ditebak). */
export function exportRowOfUnit({ unit, globalStatus = null, extras = {}, includeValue = false }) {
  const { jenisProduk, jenisKasur } = productLabels(extras);
  const fabric = extras.gantiKain === true;
  const row = {
    runId: null, unitId: unit.id, target: null, meja: UNSCHEDULED_LABEL, stationCode: null, urutan: null, seqManual: false, productionDate: null, targetStartAt: null,
    prioritas: extras.priorityLabel || "Normal", priorityKey: extras.priorityKey || "NORMAL", priorityRank: extras.priorityRank ?? 0,
    status: clean(globalStatus?.label || "—") + (globalStatus?.detail ? ` — ${clean(globalStatus.detail)}` : ""),
    resi: clean(extras.orderNumber) || "—", unitCode: clean(unit.unitCode) || "—", customer: clean(extras.customerName) || "—", sales: clean(extras.salesName) || "—",
    layanan: (extras.salesServices || []).filter(Boolean).join(", ") || "—",
    jenisProduk, jenisKasur, merek: clean(unit.merk) || "—", ukuran: clean(unit.ukuran) || "—",
    berat: extras.weightKg != null && Number.isFinite(Number(extras.weightKg)) ? Number(extras.weightKg) : null,
    catatanSales: [extras.complaints?.length ? `Keluhan: ${extras.complaints.join(", ")}` : "", clean(extras.request) ? `Catatan: ${clean(extras.request)}` : ""].filter(Boolean).join("\n") || "—",
    gantiKain: fabric ? "Ya" : "Tidak", picMeja: "—", picBahan: "—", picQc: "—", picCorner: "—", statusBahan: "—", tahap: "—", alasanLewat: "", catatanLead: "—", createdAt: extras.createdAt ?? null, late: false,
  };
  if (includeValue) row.nilaiOrder = typeof extras.orderValue === "number" ? extras.orderValue : null;
  return row;
}

// ---- Urutan -----------------------------------------------------------------------------------------------------------------------------------
const stationNo = (code) => { const m = /^TABLE_(\d+)$/.exec(code || ""); return m ? Number(m[1]) : 999; };
/** tanggal target -> Meja -> urutan manual di meja (nomor manual dulu, lalu prioritas); unit tanpa meja SETELAH unit terjadwal. */
export function compareExportRows(a, b) {
  const sa = !!a.stationCode; const sb = !!b.stationCode;
  if (sa !== sb) return sa ? -1 : 1;
  if (!sa && !sb) return (b.priorityRank - a.priorityRank) || String(a.unitCode).localeCompare(String(b.unitCode), "id", { numeric: true });
  const ta = a.target || "9999-12-31"; const tb = b.target || "9999-12-31";
  if (ta !== tb) return ta < tb ? -1 : 1;
  const ma = stationNo(a.stationCode); const mb = stationNo(b.stationCode);
  if (ma !== mb) return ma - mb;
  return (a.urutan ?? 0) - (b.urutan ?? 0) || String(a.unitCode).localeCompare(String(b.unitCode), "id", { numeric: true });
}
/**
 * Nomor POSISI di Meja = urutan yang dilihat Kepala Produksi di papan: nomor manual (hasil seret) lebih dulu, lalu urutan bawaan (prioritas lalu target mulai) — fungsi papan yang sama
 * (compareStationOrder), dihitung per Meja per TANGGAL PAPAN. seqManual menandai apakah nomornya hasil pengaturan manual.
 */
export function assignStationPositions(rows) {
  const groups = new Map();
  for (const r of rows) { if (!r.stationCode) continue; const k = `${r.productionDate || ""}|${r.stationCode}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const pos = new Map();
  for (const list of groups.values()) {
    [...list].sort((a, b) => compareStationOrder({ stationSequence: a.seqManual ? a.urutan : null, priorityRank: a.priorityRank, targetStartAt: a.targetStartAt }, { stationSequence: b.seqManual ? b.urutan : null, priorityRank: b.priorityRank, targetStartAt: b.targetStartAt }) || String(a.unitCode).localeCompare(String(b.unitCode), "id", { numeric: true }))
      .forEach((r, i) => pos.set(r, i + 1));
  }
  return rows.map((r) => (pos.has(r) ? { ...r, urutan: pos.get(r) } : { ...r, urutan: null }));
}
export const sortExportRows = (rows) => assignStationPositions(rows).sort(compareExportRows).map((r, i) => ({ ...r, no: i + 1 }));

/** Ringkasan di bagian atas sheet. perStation mengikuti urutan Meja konfigurasi; unit tanpa Meja dihitung sendiri. */
export function summaryOf(rows, { stations = [] } = {}) {
  const perStation = stations.map((code) => ({ code, label: stationLabel(code), count: rows.filter((r) => r.stationCode === code).length }));
  return {
    total: rows.length, perStation, unscheduled: rows.filter((r) => !r.stationCode).length,
    komplain: rows.filter((r) => r.priorityKey === "COMPLAINT").length, tinggi: rows.filter((r) => r.priorityKey === "HIGH").length,
    lewatTarget: rows.filter((r) => r.late).length,
    tanpaPic: rows.filter((r) => r.stationCode && r.picMeja === NO_PIC_LABEL).length, // hanya unit yang SUDAH di Meja tetapi belum punya PIC Meja
  };
}

export const periodLabel = ({ from, to }) => (from === to ? longDateId(from) : `${longDateId(from)} s.d. ${longDateId(to)}`);
export { formatProductionDate };
