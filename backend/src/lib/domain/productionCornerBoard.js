// Tampilan Corner di Rencana Produksi — fungsi MURNI (tanpa DB; diuji node --test). SATU read-model server untuk kelompok, hambatan, dan "siapa yang perlu bertindak":
// frontend hanya memformat — tidak menebak dari next.actor. Tidak ada urutan/kapasitas/target Corner (belum ada kontrak server).
// Sumber status: cornerStatusOf (productionCorner.js) — SATU sumber untuk Meja, Corner, Dokumentasi, Unit 360, Status Produksi, dan laporan.

export const CORNER_GROUPS = Object.freeze([
  Object.freeze({ key: "MENUNGGU_PRASYARAT", label: "Menunggu prasyarat" }),
  Object.freeze({ key: "SIAP_CORNER", label: "Siap Corner" }),
  Object.freeze({ key: "SEDANG_DIKERJAKAN", label: "Sedang dikerjakan" }),
  Object.freeze({ key: "SELESAI", label: "Selesai" }),
]);
export const CORNER_GROUP_KEYS = Object.freeze(CORNER_GROUPS.map((g) => g.key));

/** cornerStatusOf().status -> kelompok. TIDAK_BERLAKU = null: tetap di alur Meja (bukan pekerjaan Corner). */
export function cornerGroupOf(status) {
  switch (status) {
    case "BELUM_SAMPAI": return "MENUNGGU_PRASYARAT";
    case "MENUNGGU_CORNER": return "SIAP_CORNER";
    case "DIKERJAKAN":
    case "JAHIT_SELESAI": return "SEDANG_DIKERJAKAN";
    case "SELESAI": return "SELESAI";
    default: return null;
  }
}

export const ACTORS = Object.freeze({
  TABLE: { key: "TABLE", label: "PIC Meja" },
  CORNER: { key: "CORNER", label: "PIC Corner" },
  QC: { key: "QC", label: "PIC QC" },
  WAREHOUSE: { key: "WAREHOUSE", label: "Gudang" },
  MATERIAL_PIC: { key: "MATERIAL_PIC", label: "PIC Bahan" },
  PLANNER: { key: "PLANNER", label: "Kepala Produksi" },
  SALES: { key: "SALES", label: "Sales" },
  RECEIVER: { key: "RECEIVER", label: "Petugas penerima unit" },
});
const actor = (key) => ({ ...ACTORS[key] });

const WAIT_TEXT = Object.freeze({
  PENDING_ARRIVAL: ["Unit belum diterima di workshop", "RECEIVER"],
  EXCEPTION_OPEN: ["Ada kendala terbuka pada pekerjaan", "PLANNER"],
  HANDOFF_REJECTED: ["Serah barang jadi ditolak Gudang", "PLANNER"],
  UNIT_NOT_IN_PRODUCTION: ["Status unit di luar alur produksi", "PLANNER"],
  MATERIAL_SHORTAGE: ["Menunggu bahan dari Gudang", "WAREHOUSE"],
  MATERIAL_NOT_READY: ["Bahan belum diserahkan Gudang", "WAREHOUSE"],
  AWAITING_QC: ["Menunggu pemeriksaan PIC QC", "QC"],
  QC_BEFORE_PENDING: ["Menunggu catatan QC sebelum bongkar", "QC"],
  FOUNDATION_TEST_PENDING: ["Menunggu uji fondasi PIC QC", "QC"],
  FOUNDATION_NEW_TEST_PENDING: ["Menunggu uji fondasi baru PIC QC", "QC"],
  FINISHED_TEST_PENDING: ["Menunggu uji kasur jadi PIC QC", "QC"],
  AFTER_PENDING: ["Menunggu hasil akhir dicatat PIC Meja", "TABLE"],
  RACIKAN_NOT_RECORDED: ["Menunggu racikan dicatat PIC Bahan", "MATERIAL_PIC"],
  USAGE_NOT_RECORDED: ["Menunggu pemakaian bahan dicatat PIC Bahan", "MATERIAL_PIC"],
  SERVICE_NOT_SET: ["Layanan/jalur pekerjaan belum ditetapkan", "PLANNER"],
  DIAGNOSIS_MANUAL_UNMAPPED: ["Bahan manual Diagnosis belum dipetakan", "PLANNER"],
  DIAGNOSIS_BOM_EMPTY: ["BOM belum berisi bahan", "PLANNER"],
  READY_TO_FINISH: ["Siap diselesaikan PIC Meja", "TABLE"],
  AWAITING_WAREHOUSE: ["Menunggu Gudang menerima barang jadi", "WAREHOUSE"],
});
export const CORNER_DECISION_WAIT = "CORNER_NOT_CONFIRMED"; // = CORNER_UNCONFIRMED_WAIT di productionBuildTrack.js (kebutuhan Corner belum diputuskan)

/** Keadaan QC untuk tampilan Corner (dari indikator + aksi berikutnya yang sudah dihitung server). */
export function qcStateOf({ qcIndicator = "BELUM", next = null, qcResult = null } = {}) {
  if (qcIndicator === "LULUS" || qcResult === "PASS") return { key: "LULUS", label: "QC lulus" };
  if (qcIndicator === "WAIVED" || qcResult === "OVERRIDDEN") return { key: "DIABAIKAN", label: "QC dilewati dengan pengesahan" };
  if (qcIndicator === "TIDAK_DILAKUKAN") return { key: "TIDAK_DILAKUKAN", label: "QC tidak dilakukan (mode adaptasi)" };
  if (qcIndicator === "REWORK" || qcResult === "FAIL_REWORK") return { key: "GAGAL", label: "QC gagal — rework di Meja" };
  if (next?.actor === "QC" || (next?.action === "WAIT" && ["AWAITING_QC", "QC_BEFORE_PENDING", "FOUNDATION_TEST_PENDING", "FOUNDATION_NEW_TEST_PENDING", "FINISHED_TEST_PENDING"].includes(next.wait))) {
    return { key: "MENUNGGU", label: "Menunggu pemeriksaan QC" };
  }
  return { key: "BELUM", label: "Belum sampai QC" };
}

/**
 * Hambatan + siapa yang perlu bertindak untuk satu kartu Corner. Urutan = prioritas (yang pertama = `primary`).
 * @param {object} p
 * @param {string} p.group            kelompok Corner
 * @param {string} p.runStatus
 * @param {object|null} p.next        view.next (aksi berikutnya dari server)
 * @param {object} p.qc               hasil qcStateOf
 * @param {boolean|null} p.cornerRequired  keputusan Corner jalur BUILD (true|false|null belum diputuskan); null untuk jalur lain
 * @param {boolean} p.buildTrack
 * @param {string|null} p.picCornerName
 * @param {object} p.request          buildCornerRequest(...)
 * @param {boolean} p.shortageOpen
 */
export function cornerBlockersOf({ group, runStatus, next = null, qc, cornerRequired = null, buildTrack = false, picCornerName = null, request = null, shortageOpen = false } = {}) {
  const out = [];
  const push = (code, text, who, severity = "block") => out.push({ code, text, actor: actor(who), severity });
  if (group === "SELESAI") return { blockers: [], primary: null, needsAction: null };
  if (runStatus === "PENDING_ARRIVAL") push("PENDING_ARRIVAL", ...WAIT_TEXT.PENDING_ARRIVAL.slice(0, 1), "RECEIVER");
  if (next?.action === "WAIT" && next.wait && next.wait !== "PENDING_ARRIVAL" && WAIT_TEXT[next.wait]) {
    const [text, who] = WAIT_TEXT[next.wait];
    const isQcWait = who === "QC";
    if (!(isQcWait && qc?.key === "GAGAL")) push(next.wait, text, who);
  }
  if (buildTrack && cornerRequired == null) push(CORNER_DECISION_WAIT, "Kebutuhan Corner belum diputuskan Kepala Produksi", "PLANNER");
  if (qc?.key === "GAGAL") push("QC_FAILED", "QC gagal — pekerjaan diulang di Meja, belum boleh ke Corner", "TABLE");
  if (shortageOpen && !out.some((b) => b.code === "MATERIAL_SHORTAGE")) push("MATERIAL_SHORTAGE", WAIT_TEXT.MATERIAL_SHORTAGE[0], "WAREHOUSE");
  if (next?.hold === "PRODUCT_TYPE_UNCONFIRMED") push("PRODUCT_TYPE_UNCONFIRMED", "Jenis produk belum dikonfirmasi Sales pada order", "SALES");
  if (!picCornerName) push("PIC_CORNER_UNSET", "PIC Corner belum ditetapkan", "PLANNER", group === "MENUNGGU_PRASYARAT" ? "info" : "block");
  if (request?.needsSalesConfirmation && (group === "SIAP_CORNER" || group === "SEDANG_DIKERJAKAN")) {
    push("SALES_CONFIRM", `Perlu konfirmasi Sales: ${request.missing.join(" dan ")} belum tertulis`, "SALES", "warn");
  }
  const blocking = out.filter((b) => b.severity === "block");
  const primary = blocking[0] || out[0] || null;
  let needsAction = null;
  if (blocking[0]) needsAction = { actor: blocking[0].actor, text: blocking[0].text }; // hanya penahan (block) yang menentukan "siapa bertindak"; peringatan/info tidak
  else if (group === "SIAP_CORNER") needsAction = { actor: actor("CORNER"), text: "Siap dikerjakan — PIC Corner memulai di Aplikasi Corner" };
  else if (group === "SEDANG_DIKERJAKAN") needsAction = { actor: actor("CORNER"), text: "Sedang dikerjakan PIC Corner" };
  else if (group === "MENUNGGU_PRASYARAT") {
    const who = next?.actor && ACTORS[next.actor] && next.actor !== "NONE" ? next.actor : "TABLE";
    needsAction = { actor: actor(who), text: "Menyelesaikan tahap Meja dan QC lebih dulu" };
  }
  return { blockers: out, primary, needsAction };
}

/**
 * Boleh/tidaknya mengganti PIC Corner (aturan SERVER; UI hanya menampilkan). allowed=false + reason berkode.
 * Pekerjaan Corner yang sudah berjalan TIDAK dialihkan diam-diam (tidak ada alur pengalihan resmi untuk pekerjaan aktif).
 */
export function canReassignCorner({ cornerStatus, buildTrack = false, cornerRequired = null, runStatus = "ACTIVE", planStatus = "PLANNED", hasPlan = true } = {}) {
  if (!hasPlan || planStatus === "CANCELLED") return { allowed: false, code: "CORNER_PLAN_MISSING", reason: "Belum ada rencana produksi aktif untuk unit ini" };
  if (["COMPLETED", "CANCELLED"].includes(runStatus)) return { allowed: false, code: "CORNER_RUN_TERMINAL", reason: "Pekerjaan produksi sudah selesai atau dibatalkan" };
  if (cornerStatus === "TIDAK_BERLAKU") return { allowed: false, code: "CORNER_NOT_REQUIRED", reason: "Corner tidak diperlukan untuk unit ini (keputusan Lead)" };
  if (buildTrack && cornerRequired !== true) return { allowed: false, code: "CORNER_DECISION_PENDING", reason: "Putuskan kebutuhan Corner lebih dulu" };
  if (["DIKERJAKAN", "JAHIT_SELESAI", "SELESAI"].includes(cornerStatus)) {
    return { allowed: false, code: "CORNER_WORK_STARTED", reason: "Pekerjaan Corner sudah berjalan — tidak dialihkan diam-diam. Selesaikan atau hubungi Kepala Produksi" };
  }
  return { allowed: true, code: null, reason: null };
}
