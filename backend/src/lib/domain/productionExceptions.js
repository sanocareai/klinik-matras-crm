// Risiko & pengecualian operasional — Production Core Slice 2.
//
// TIGA KONSEP TERPISAH, sengaja tidak digabung (spec Slice 2):
//   OVERDUE  = productionDueAt SUDAH lewat. Kondisi PALING kuat — begitu
//              overdue, unit TIDAK LAGI dilabeli sekadar "at risk".
//   AT RISK  = KEMUNGKINAN meleset dari productionDueAt (belum overdue).
//              Deterministik & SELALU punya alasan (riskReasons) — tidak
//              pernah `isAtRisk: true` tanpa penjelasan kenapa.
//   BLOCKED  = ada ProductionBlocker TERBUKA untuk unit ini. Independen
//              dari overdue/at-risk (unit bisa blocked tanpa due date sama
//              sekali), tapi juga salah satu MASUKAN untuk deriveAtRisk.
//
// Fungsi MURNI — tidak menyentuh Prisma/database. Pemanggil (routes/
// production.js, unitStageEngine.js) yang bertanggung jawab memuat data
// (unit, blocker, riwayat QC) lewat query BATCH, lihat komentar di
// routes/production.js soal kenapa ini penting untuk daftar ratusan unit.
//
// TIDAK ADA prediksi/AI di sini — murni ambang deterministik, SELURUHNYA
// terpusat di RISK_CONFIG di bawah (bukan angka ajaib tersebar di route/
// komponen). Nilai AWAL, belum dikalibrasi dari data nyata (production
// baru mulai memakai productionDueAt sejak Slice 1) — sama filosofinya
// dengan SLA_BALAS_PERTAMA_MENIT/THRESHOLDS lain yang sudah ada di repo
// ini: kebijakan operasional yang boleh disetel ulang, bukan pengukuran
// yang harus "benar" sejak awal.

import { PRODUCTION_COMPLETE_UNIT_STATUSES } from "./productionState.js";

// Nilai enum BlockReason (schema.prisma) — pola yang sama dengan
// PRODUCTION_PRIORITY_VALUES di productionState.js.
export const BLOCK_REASON_VALUES = [
  "MATERIAL_SHORTAGE", "AWAITING_CUSTOMER_APPROVAL", "MACHINE_DOWN", "QUALITY_ISSUE", "OTHER",
  "AWAITING_CUSTOMER", "AWAITING_OPERATOR", "AWAITING_TOOL",
];

// blockReason yang secara bisnis berarti "menunggu KEPUTUSAN pelanggan/
// sales", bukan sumber daya fisik — diklasifikasikan exception
// WAITING_APPROVAL, bukan BLOCKED generik (spec Slice 2D). HANYA satu
// nilai hari ini (proposeScopeRevision() SELALU memakai reason ini untuk
// blokir revisi lingkup, lihat services/scopeRevision.js) — sengaja TIDAK
// menambah nilai enum baru ("SCOPE_REVISION") yang tidak punya penulis
// nyata; itu akan melanggar "jangan mengarang data yang tidak dilacak
// sistem".
const APPROVAL_BLOCK_REASONS = new Set(["AWAITING_CUSTOMER_APPROVAL"]);

// Label Inggris pendek per blockReason — konsisten dengan aturan bilingual
// (istilah operasional dalam Inggris: "Blocked", "Waiting material", dst),
// dipakai membangun `reason`/`title` exception yang manusiawi. Diekspor
// supaya lib/activityLog.js (linimasa PRODUCTION_BLOCKED/RESOLVED) memakai
// label yang SAMA, bukan salinan kedua.
export const BLOCK_REASON_LABEL = {
  MATERIAL_SHORTAGE: "Waiting material",
  AWAITING_CUSTOMER_APPROVAL: "Waiting approval",
  MACHINE_DOWN: "Tool/machine issue",
  QUALITY_ISSUE: "Quality issue",
  OTHER: "Other",
  AWAITING_CUSTOMER: "Waiting customer",
  AWAITING_OPERATOR: "Waiting operator",
  AWAITING_TOOL: "Waiting tool",
};

export const SEVERITY = Object.freeze({
  INFO: "INFO",
  WARNING: "WARNING",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
});
const SEVERITY_RANK = { CRITICAL: 3, HIGH: 2, WARNING: 1, INFO: 0 };

export const EXCEPTION_TYPE = Object.freeze({
  OVERDUE: "OVERDUE",
  AT_RISK: "AT_RISK",
  BLOCKED: "BLOCKED",
  WAITING_APPROVAL: "WAITING_APPROVAL",
  REWORK: "REWORK",
});

// ─── AMBANG TERPUSAT ────────────────────────────────────────────────────
export const RISK_CONFIG = Object.freeze({
  // AT_RISK: due dalam N jam ke depan (dan belum overdue).
  DUE_SOON_HOURS: 4,
  // AT_RISK naik ke severity HIGH (bukan WARNING) kalau sisa waktu <= ini.
  DUE_CRITICAL_HOURS: 2,
  // OVERDUE naik ke severity CRITICAL (bukan HIGH) setelah lewat N jam.
  SEVERE_OVERDUE_HOURS: 4,
  // Workspace health -> CRITICAL kalau jumlah blocked/overdue >= ini.
  HEALTH_CRITICAL_BLOCKED_COUNT: 3,
  HEALTH_CRITICAL_OVERDUE_COUNT: 2,
  // Command Center TIDAK mengembalikan seluruh exception mentah — dibatasi
  // supaya payload tetap terkendali. summary.* (hitungan asli) TIDAK ikut
  // dipotong oleh batas ini.
  MAX_EXCEPTIONS_RETURNED: 30,
});

/** true kalau unit ini SECARA PRODUKSI masih berjalan (belum selesai/batal). */
export function isProductionEligible(unitStatus) {
  return unitStatus !== "CANCELLED" && !PRODUCTION_COMPLETE_UNIT_STATUSES.has(unitStatus);
}

/**
 * Validasi OPEN BLOCKER (spec Slice 2A: "opening a blocker requires valid
 * type", "OTHER requires a meaningful note") — fungsi MURNI, ditarik keluar
 * dari failStage() (unitStageEngine.js) supaya bisa diuji tanpa database
 * (tests/productionExceptions.test.js), pola yang sama dengan
 * harusMemblokir() di services/scopeRevision.js.
 *
 * @param {object} params
 * @param {string} params.reason - nilai BlockReason yang diajukan
 * @param {string|null|undefined} params.note
 * @returns {string|null} pesan error, atau null kalau valid
 */
export function validateBlockReason({ reason, note }) {
  if (!reason) return "blockReason wajib diisi saat menggagalkan tahap";
  if (!BLOCK_REASON_VALUES.includes(reason)) {
    return `blockReason harus salah satu dari: ${BLOCK_REASON_VALUES.join(", ")}`;
  }
  if (reason === "OTHER" && (!note || note.trim().length < 3)) {
    return 'blockReason "OTHER" wajib disertai catatan yang jelas kenapa terhambat';
  }
  return null;
}

function formatDurationShort(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/**
 * OVERDUE — deterministik, TIDAK PERNAH dipersist (dihitung tiap dibaca).
 *
 * @param {object} params
 * @param {{status:string, productionDueAt?:string|Date|null}} params.unit
 * @param {Date} [params.now]
 * @returns {{isOverdue:boolean, overdueMinutes:number}}
 */
export function deriveOverdue({ unit, now = new Date() }) {
  if (!unit.productionDueAt) return { isOverdue: false, overdueMinutes: 0 };
  if (!isProductionEligible(unit.status)) return { isOverdue: false, overdueMinutes: 0 };

  const dueMs = new Date(unit.productionDueAt).getTime();
  const nowMs = now.getTime();
  if (nowMs <= dueMs) return { isOverdue: false, overdueMinutes: 0 };
  return { isOverdue: true, overdueMinutes: Math.floor((nowMs - dueMs) / 60000) };
}

/**
 * AT RISK — konservatif, deterministik, SELALU dengan riskReasons kalau
 * isAtRisk true (PRD: "Never return only AT_RISK = true tanpa alasan").
 *
 * Sekali OVERDUE, fungsi ini SELALU mengembalikan isAtRisk:false — overdue
 * adalah kondisi yang LEBIH KUAT (spec: "do not label only as At Risk").
 * Sinyal yang dipakai HANYA yang datanya benar-benar bisa dipercaya hari
 * ini: blocker terbuka + jarak ke productionDueAt. TIDAK memakai
 * expectedDurationMinutes (masih NULL semua di seed, lihat DECISIONS.md)
 * atau sinyal lain yang datanya belum ada — itu akan "mengarang" risiko.
 *
 * @param {object} params
 * @param {{status:string, productionDueAt?:string|Date|null}} params.unit
 * @param {Date} [params.now]
 * @param {boolean} [params.hasOpenBlocker]
 * @param {string|null} [params.blockerReason]
 * @param {{isOverdue:boolean}} [params.overdue] - hasil deriveOverdue, dihitung ulang kalau tidak diberikan
 * @returns {{isAtRisk:boolean, riskLevel:string|null, riskReasons:{code:string,label:string}[]}}
 */
export function deriveAtRisk({ unit, now = new Date(), hasOpenBlocker = false, blockerReason = null, overdue = null }) {
  const ov = overdue || deriveOverdue({ unit, now });
  if (ov.isOverdue) return { isAtRisk: false, riskLevel: null, riskReasons: [] };
  if (!isProductionEligible(unit.status)) return { isAtRisk: false, riskLevel: null, riskReasons: [] };

  const reasons = [];
  let dueSoonSeverityHigh = false;

  if (hasOpenBlocker) {
    reasons.push({
      code: "BLOCKED",
      label: `Blocked — ${BLOCK_REASON_LABEL[blockerReason] || blockerReason || "unknown reason"}`,
    });
  }

  if (unit.productionDueAt) {
    const dueMs = new Date(unit.productionDueAt).getTime();
    const hoursLeft = (dueMs - now.getTime()) / 3_600_000;
    if (hoursLeft <= RISK_CONFIG.DUE_SOON_HOURS) {
      reasons.push({ code: "DUE_SOON", label: `Production due in ${formatDurationShort(dueMs - now.getTime())}` });
      dueSoonSeverityHigh = hoursLeft <= RISK_CONFIG.DUE_CRITICAL_HOURS;
    }
  }

  if (reasons.length === 0) return { isAtRisk: false, riskLevel: null, riskReasons: [] };

  const riskLevel = hasOpenBlocker || dueSoonSeverityHigh ? "HIGH" : "WARNING";
  return { isAtRisk: true, riskLevel, riskReasons: reasons };
}

/**
 * Workspace health — STABLE/ATTENTION/CRITICAL, murni dari kondisi
 * operasional terhitung (bukan label dekoratif hardcode). `reasons` sudah
 * berupa kalimat siap tampil (pola bilingual: kata benda Inggris,
 * struktur kalimat Indonesia — sama seperti contoh spec).
 */
export function deriveWorkspaceHealth({ blockedCount = 0, overdueCount = 0, atRiskCount = 0, severeOverdueCount = 0 }) {
  const reasons = [];
  if (blockedCount > 0) reasons.push(`${blockedCount} unit blocked`);
  if (overdueCount > 0) reasons.push(`${overdueCount} unit overdue`);
  if (atRiskCount > 0) reasons.push(`${atRiskCount} unit berisiko terlambat`);

  let level = "STABLE";
  if (
    severeOverdueCount > 0 ||
    blockedCount >= RISK_CONFIG.HEALTH_CRITICAL_BLOCKED_COUNT ||
    overdueCount >= RISK_CONFIG.HEALTH_CRITICAL_OVERDUE_COUNT
  ) {
    level = "CRITICAL";
  } else if (blockedCount > 0 || overdueCount > 0 || atRiskCount > 0) {
    level = "ATTENTION";
  }

  return { level, reasons };
}

/**
 * Bangun 0+ exception untuk SATU unit. Dipanggil per unit dari
 * buildExceptions() (batch) — fungsi ini sendiri MURNI, tidak melakukan
 * query apa pun; seluruh data (blocker, isReworkTarget) sudah harus
 * dimuat pemanggil lewat query batch.
 *
 * ATURAN ANTI-DUPLIKASI: kalau unit sedang BLOCKED, TIDAK ADA exception
 * AT_RISK terpisah yang ditambahkan untuk unit yang sama (walau
 * deriveAtRisk() sendiri akan bilang isAtRisk:true karena blocker) —
 * BLOCKED/WAITING_APPROVAL sudah lebih spesifik & actionable, menampilkan
 * keduanya untuk unit yang sama cuma bising tanpa informasi baru. Halaman
 * lain (mis. detail unit) yang ingin risk holistik boleh memanggil
 * deriveAtRisk() langsung tanpa pembatasan ini.
 *
 * @param {object} params
 * @param {{id:string, unitCode:string, status:string, productionDueAt?:string|Date|null, orderId?:string, order?:object}} params.unit
 * @param {Date} [params.now]
 * @param {{reason:string, note?:string|null, openedAt:string|Date}|null} [params.blocker] - blocker TERBUKA unit ini, null kalau tidak ada
 * @param {boolean} [params.isReworkTarget]
 * @returns {object[]} exception[]
 */
export function buildExceptionsForUnit({ unit, now = new Date(), blocker = null, isReworkTarget = false }) {
  const exceptions = [];
  const hasOpenBlocker = !!blocker;
  const overdue = deriveOverdue({ unit, now });

  const base = {
    unitId: unit.id,
    unitCode: unit.unitCode,
    orderId: unit.orderId ?? unit.order?.id ?? null,
    orderNumber: unit.order?.orderNumber ?? null,
    customerName: unit.order?.customer?.name ?? null,
    href: `/bengkel/units/${unit.id}`,
  };

  if (hasOpenBlocker) {
    const isApproval = APPROVAL_BLOCK_REASONS.has(blocker.reason);
    const openedMs = new Date(blocker.openedAt).getTime();
    const durationMinutes = Math.max(0, Math.floor((now.getTime() - openedMs) / 60000));
    const reasonLabel = BLOCK_REASON_LABEL[blocker.reason] || blocker.reason;
    exceptions.push({
      ...base,
      type: isApproval ? EXCEPTION_TYPE.WAITING_APPROVAL : EXCEPTION_TYPE.BLOCKED,
      severity: SEVERITY.HIGH,
      title: isApproval ? "Waiting Approval" : "Production Blocked",
      reason: blocker.note ? `${reasonLabel} — ${blocker.note}` : reasonLabel,
      startedAt: blocker.openedAt,
      durationMinutes,
      recommendedAction: isApproval ? "Follow up customer decision" : "Resolve blocker",
      urgencyMinutes: durationMinutes,
    });
  }

  if (overdue.isOverdue) {
    const severity = overdue.overdueMinutes >= RISK_CONFIG.SEVERE_OVERDUE_HOURS * 60 ? SEVERITY.CRITICAL : SEVERITY.HIGH;
    exceptions.push({
      ...base,
      type: EXCEPTION_TYPE.OVERDUE,
      severity,
      title: "Overdue",
      reason: `Production due ${formatDurationShort(overdue.overdueMinutes * 60000)} ago`,
      startedAt: unit.productionDueAt,
      durationMinutes: overdue.overdueMinutes,
      recommendedAction: "Review and reprioritize",
      urgencyMinutes: overdue.overdueMinutes,
    });
  } else if (!hasOpenBlocker) {
    // AT_RISK hanya dievaluasi kalau TIDAK overdue DAN TIDAK sudah punya
    // exception BLOCKED/WAITING_APPROVAL — lihat komentar anti-duplikasi.
    const risk = deriveAtRisk({ unit, now, hasOpenBlocker: false, overdue });
    if (risk.isAtRisk) {
      const dueMs = unit.productionDueAt ? new Date(unit.productionDueAt).getTime() : null;
      const minutesUntilDue = dueMs != null ? Math.max(0, Math.round((dueMs - now.getTime()) / 60000)) : null;
      exceptions.push({
        ...base,
        type: EXCEPTION_TYPE.AT_RISK,
        severity: risk.riskLevel === "HIGH" ? SEVERITY.HIGH : SEVERITY.WARNING,
        title: "At Risk",
        reason: risk.riskReasons.map((r) => r.label).join(" · "),
        startedAt: null,
        durationMinutes: null,
        recommendedAction: "Monitor closely",
        riskReasons: risk.riskReasons,
        // Urgensi AT_RISK terbalik dari BLOCKED/OVERDUE: makin DEKAT due
        // date (minutesUntilDue kecil), makin urgent — dinormalisasi ke
        // skala yang sama (angka besar = lebih mendesak).
        urgencyMinutes: minutesUntilDue != null ? Math.max(0, RISK_CONFIG.DUE_SOON_HOURS * 60 - minutesUntilDue) : 0,
      });
    }
  }

  if (isReworkTarget && !hasOpenBlocker) {
    // REWORK murni informasional saat TIDAK sedang blocked — kalau QC gagal
    // DAN unit-nya keblok (mis. bahan lapisan penggantinya habis), BLOCKED
    // di atas sudah lebih actionable & sudah muncul.
    exceptions.push({
      ...base,
      type: EXCEPTION_TYPE.REWORK,
      severity: SEVERITY.WARNING,
      title: "Rework",
      reason: "Unit dikembalikan ke modul lapisan setelah QC gagal",
      startedAt: null,
      durationMinutes: null,
      recommendedAction: "Selesaikan rework",
      urgencyMinutes: 0,
    });
  }

  return exceptions;
}

function compareExceptions(a, b) {
  const sevDiff = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
  if (sevDiff !== 0) return sevDiff;
  return (b.urgencyMinutes ?? 0) - (a.urgencyMinutes ?? 0);
}

/**
 * Batch: bangun + urutkan exception SELURUH unit yang diberikan. Data
 * (blocker per unit, rework per unit) HARUS sudah dimuat pemanggil lewat
 * query batch (lihat routes/production.js) — fungsi ini sendiri tidak
 * pernah menyentuh database, jadi biayanya murni O(unit) di memori,
 * TIDAK menambah satu pun query per unit.
 *
 * @param {object} params
 * @param {object[]} params.units
 * @param {Record<string, object>} [params.blockersByUnitId] - unitId -> blocker terbuka
 * @param {Set<string>} [params.reworkUnitIds] - unitId yang sedang isReworkTarget
 * @param {Date} [params.now]
 * @returns {object[]} exceptions, terurut severity desc lalu urgencyMinutes desc
 */
export function buildExceptions({ units, blockersByUnitId = {}, reworkUnitIds = new Set(), now = new Date() }) {
  const all = [];
  for (const unit of units) {
    const exceptions = buildExceptionsForUnit({
      unit, now,
      blocker: blockersByUnitId[unit.id] || null,
      isReworkTarget: reworkUnitIds.has(unit.id),
    });
    all.push(...exceptions);
  }
  return all.sort(compareExceptions);
}
