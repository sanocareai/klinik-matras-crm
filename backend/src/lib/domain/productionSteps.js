// Production Experience V2 (P8) — 12 tahap blueprint sebagai lapisan BUKTI di atas stage engine P5 (bukan state paralel).
// Modul MURNI: definisi tahap, kontrak bukti, validasi, pemetaan tahap routing -> nomor tahap, derivasi aksi berikutnya, dan bucket Andon.
//
// Pemetaan ke routing (routing_stages) — transisi tetap milik P5/P6:
//   1  Sebelum Bongkar          = MULAI pre_teardown_test (bukti foto/video kondisi)
//   2  Uji Rasa Awal            = SELESAI pre_teardown_test (video)          -> otomatis mulai tahap berikutnya
//   3  Hasil Bongkar            = SELESAI teardown (foto + checklist material lama)
//   4  Uji Fondasi Lama         = SELESAI foundation_test (video + tinggi awal/ditekan + berat penguji)
//   5  Diagnosa                 = SELESAI diagnosis (teks/voice-to-text; layanan unit WAJIB sudah ditetapkan)
//   6  Fondasi Baru             = tahap MODULE sequence 10 (foundation_upgrade/foundation_service)
//   7  Lapisan Baru             = tahap MODULE sequence >= 20 (comfort_layer_upgrade/foam_addition/cover_replacement)
//      Modul TERAKHIR sebelum QC tidak diselesaikan di tahap 6/7 — buktinya dicatat, penyelesaiannya menunggu tahap 8 PAS.
//   8  Uji Tekstur Akhir (PIC)  = PAS -> SELESAI modul terakhir -> AWAITING_QC; TERLALU KERAS/EMPUK -> wajib ulang bukti modul (rework meja)
//      Gerbang QC resmi (fit_test) tetap diputuskan pemegang QC_WRITE lewat P6 — uji PIC BUKAN QC.
//   9  Kirim ke Corner          = setelah QC LULUS: bukti siap dibungkus (tanpa transisi tahap; membuka antrean Corner)
//  10  Mulai Jahit              = MULAI corner_sewing (spesifikasi kain/list/model)
//  11  Jahit Selesai            = SELESAI corner_sewing (foto/video + checklist)
//  12  Konfirmasi Selesai       = (foto kasur selesai) MULAI+SELESAI finished -> penawaran barang jadi ke Gudang (P6) + event laporan (outbox, PENDING)

export const STEP_ACTOR = Object.freeze({ TABLE: "TABLE", CORNER: "CORNER" });

export const STEPS = Object.freeze([
  { no: 1, code: "S01_BEFORE", label: "Sebelum Bongkar", actor: "TABLE", short: "Foto sebelum bongkar" },
  { no: 2, code: "S02_FEEL_TEST", label: "Uji Rasa Awal", actor: "TABLE", short: "Uji rasa awal" },
  { no: 3, code: "S03_TEARDOWN", label: "Hasil Bongkar & Material Lama", actor: "TABLE", short: "Hasil bongkar" },
  { no: 4, code: "S04_OLD_FOUNDATION_TEST", label: "Uji Fondasi Lama", actor: "TABLE", short: "Uji fondasi" },
  { no: 5, code: "S05_DIAGNOSIS", label: "Diagnosa Teknis", actor: "TABLE", short: "Diagnosa" },
  { no: 6, code: "S06_NEW_FOUNDATION", label: "Fondasi Baru", actor: "TABLE", short: "Fondasi baru" },
  { no: 7, code: "S07_NEW_LAYER", label: "Lapisan Baru", actor: "TABLE", short: "Lapisan baru" },
  { no: 8, code: "S08_TEXTURE_TEST", label: "Uji Tekstur Akhir", actor: "TABLE", short: "Uji tekstur" },
  { no: 9, code: "S09_SEND_TO_CORNER", label: "Kirim ke Corner", actor: "TABLE", short: "Ke Corner" },
  { no: 10, code: "S10_START_SEWING", label: "Mulai Jahit", actor: "CORNER", short: "Mulai jahit" },
  { no: 11, code: "S11_SEWING_DONE", label: "Jahit Selesai", actor: "CORNER", short: "Jahit selesai" },
  { no: 12, code: "S12_CONFIRM_DONE", label: "Konfirmasi Selesai", actor: "CORNER", short: "Konfirmasi selesai" },
]);
export const STEP_BY_NO = Object.freeze(Object.fromEntries(STEPS.map((s) => [s.no, s])));

export const OLD_MATERIAL_TYPES = Object.freeze(["PER", "BUSA", "REBONDED", "KAIN", "LATEX", "KAPUK", "LAINNYA"]);
export const TEXTURE_VERDICTS = Object.freeze(["PAS", "TERLALU_KERAS", "TERLALU_EMPUK"]);
export const MATTRESS_STYLES = Object.freeze(["BIASA", "PLUSHTOP", "PILLOWTOP"]);
export const CORNER_CHECKLIST = Object.freeze(["jahitan", "list", "resleting", "kebersihan"]);

// Berkas bukti hanya dari unggahan P8 (nama = sha1 isi); jenis ditentukan dari ekstensi.
export const EVIDENCE_URL_PREFIX = "/media/production-evidence/";
export const EVIDENCE_FILE_PATTERN = /^[a-f0-9]{40}\.(jpg|png|webp|mp4|webm|mov)$/;
const VIDEO_EXT = new Set(["mp4", "webm", "mov"]);
export const MAX_MEDIA_PER_STEP = 12;

function stepError(message, statusCode, code, details) {
  return Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });
}
const invalid = (message, details) => stepError(message, 400, "STEP_EVIDENCE_INVALID", details);

export function mediaKindOf(url) {
  const s = String(url || "");
  if (!s.startsWith(EVIDENCE_URL_PREFIX)) return null;
  const file = s.slice(EVIDENCE_URL_PREFIX.length);
  if (!EVIDENCE_FILE_PATTERN.test(file)) return null;
  return VIDEO_EXT.has(file.split(".").pop()) ? "video" : "image";
}

export function normalizeMedia(media) {
  if (media == null) return [];
  if (!Array.isArray(media)) throw invalid("Daftar bukti media tidak valid");
  if (media.length > MAX_MEDIA_PER_STEP) throw invalid(`Maksimal ${MAX_MEDIA_PER_STEP} media per tahap`);
  const seen = new Set();
  return media.map((item) => {
    const url = typeof item === "string" ? item : item?.url;
    const kind = mediaKindOf(url);
    if (!kind) throw invalid("Media bukti harus diunggah lewat aplikasi produksi (tautan tidak dikenal)");
    if (seen.has(url)) throw invalid("Media bukti yang sama terkirim dua kali");
    seen.add(url);
    return { url, kind };
  });
}

const text = (value, min, label, max = 2000) => {
  const s = typeof value === "string" ? value.trim() : "";
  if (s.length < min) throw invalid(`${label} wajib diisi (minimal ${min} karakter)`);
  if (s.length > max) throw invalid(`${label} terlalu panjang (maksimal ${max} karakter)`);
  return s;
};
const optionalText = (value, label, max = 2000) => {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw invalid(`${label} tidak valid`);
  const s = value.trim();
  if (s.length > max) throw invalid(`${label} terlalu panjang (maksimal ${max} karakter)`);
  return s || null;
};
const positiveNumber = (value, label, { max = 1000 } = {}) => {
  const n = Number(value);
  if (value == null || value === "" || !Number.isFinite(n) || n <= 0 || n > max) throw invalid(`${label} wajib berupa angka lebih dari 0`);
  return Math.round(n * 10) / 10;
};
function requireMedia(media, { min = 1, video = false, label }) {
  if (media.length < min) throw invalid(`${label}: wajib melampirkan minimal ${min} foto/video`);
  if (video && !media.some((m) => m.kind === "video")) throw invalid(`${label}: wajib melampirkan video`);
}

// Baris material (tahap 6/7/10): harus bagian dari Planned BOM yang sudah DISERAHKAN Gudang untuk rencana ini; qty tidak melebihi yang diserahkan.
// Tidak ada potong stok di sini — stok berkurang sekali saat Gudang menyerahkan (Material Issue P4).
export function normalizeMaterialLines(lines, { issuedQtyByMaterial, required, label }) {
  if (lines == null || (Array.isArray(lines) && lines.length === 0)) {
    if (required) throw invalid(`${label}: pilih minimal satu bahan dari Gudang yang dipakai`);
    return [];
  }
  if (!Array.isArray(lines)) throw invalid(`${label}: daftar bahan tidak valid`);
  const seen = new Set();
  return lines.map((line) => {
    const materialId = line?.materialId;
    if (!materialId || typeof materialId !== "string") throw invalid(`${label}: bahan tidak valid`);
    if (seen.has(materialId)) throw invalid(`${label}: bahan yang sama dipilih dua kali`);
    seen.add(materialId);
    const qty = Number(line.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw invalid(`${label}: jumlah bahan harus lebih dari 0`);
    const issued = issuedQtyByMaterial?.get(materialId);
    if (issued == null) throw stepError(`${label}: bahan ini tidak ada di bahan yang diserahkan Gudang untuk unit ini`, 422, "STEP_MATERIAL_NOT_ISSUED", { materialId });
    if (qty > issued + 1e-9) throw stepError(`${label}: jumlah melebihi bahan yang diserahkan Gudang (${issued})`, 422, "STEP_MATERIAL_OVER_ISSUED", { materialId, issued });
    return { materialId, qty };
  });
}

// Validasi kontrak bukti per tahap. ctx: { issuedQtyByMaterial: Map<materialId, qty> }. Mengembalikan { payload, media } ternormalisasi.
export function validateStepEvidence(stepNo, input, ctx = {}) {
  const step = STEP_BY_NO[stepNo];
  if (!step) throw stepError("Tahap tidak dikenal", 400, "STEP_UNKNOWN");
  const p = input?.payload && typeof input.payload === "object" && !Array.isArray(input.payload) ? input.payload : {};
  const media = normalizeMedia(input?.media);
  const label = `Tahap ${stepNo} (${step.label})`;
  switch (stepNo) {
    case 1:
      requireMedia(media, { label });
      if (p.conditionConfirmed !== true) throw invalid(`${label}: konfirmasi ukuran & kondisi kain luar wajib dicentang`);
      return { media, payload: { conditionConfirmed: true, conditionNote: optionalText(p.conditionNote, "Catatan kondisi") } };
    case 2:
      requireMedia(media, { label, video: true });
      return { media, payload: { feelNote: text(p.feelNote, 3, "Catatan rasa awal") } };
    case 3: {
      requireMedia(media, { label });
      const items = Array.isArray(p.oldMaterials) ? p.oldMaterials : [];
      if (items.length === 0) throw invalid(`${label}: centang minimal satu material lama yang ditemukan`);
      const seen = new Set();
      const oldMaterials = items.map((item) => {
        const type = typeof item === "string" ? item : item?.type;
        if (!OLD_MATERIAL_TYPES.includes(type)) throw invalid(`${label}: jenis material lama tidak dikenal`);
        if (seen.has(type)) throw invalid(`${label}: jenis material lama dipilih dua kali`);
        seen.add(type);
        return { type, note: optionalText(typeof item === "string" ? null : item?.note, "Catatan material", 300) };
      });
      return { media, payload: { oldMaterials, note: optionalText(p.note, "Catatan") } };
    }
    case 4: {
      requireMedia(media, { label, video: true });
      const heightBeforeCm = positiveNumber(p.heightBeforeCm, "Tinggi awal (cm)", { max: 100 });
      const heightCompressedCm = positiveNumber(p.heightCompressedCm, "Tinggi saat ditekan (cm)", { max: 100 });
      if (heightCompressedCm > heightBeforeCm) throw invalid(`${label}: tinggi saat ditekan tidak boleh lebih besar dari tinggi awal`);
      const testerWeightKg = positiveNumber(p.testerWeightKg, "Berat penguji (kg)", { max: 300 });
      const issues = Array.isArray(p.foundationIssues) ? p.foundationIssues.map((s) => text(s, 2, "Masalah fondasi", 200)) : [];
      return {
        media,
        payload: {
          heightBeforeCm, heightCompressedCm, dropCm: Math.round((heightBeforeCm - heightCompressedCm) * 10) / 10,
          testerWeightKg, foundationIssues: issues, note: optionalText(p.note, "Catatan"),
        },
      };
    }
    case 5: {
      const inputMethod = p.inputMethod === "VOICE" ? "VOICE" : "TEXT";
      return { media, payload: { diagnosis: text(p.diagnosis, 10, "Penjelasan diagnosa", 4000), inputMethod } };
    }
    case 6:
      requireMedia(media, { label, video: true });
      return {
        media,
        payload: {
          materials: normalizeMaterialLines(p.materials, { ...ctx, required: true, label }),
          note: text(p.note, 3, "Penjelasan isi fondasi"),
        },
      };
    case 7:
      requireMedia(media, { label });
      return {
        media,
        payload: {
          materials: normalizeMaterialLines(p.materials, { ...ctx, required: true, label }),
          note: optionalText(p.note, "Catatan lapisan"),
        },
      };
    case 8: {
      requireMedia(media, { label, video: true });
      if (!TEXTURE_VERDICTS.includes(p.verdict)) throw invalid(`${label}: pilih hasil PAS, TERLALU KERAS, atau TERLALU EMPUK`);
      return { media, payload: { verdict: p.verdict, testerWeightKg: positiveNumber(p.testerWeightKg, "Berat penguji (kg)", { max: 300 }), note: optionalText(p.note, "Catatan uji") } };
    }
    case 9:
      requireMedia(media, { label });
      return { media, payload: { note: optionalText(p.note, "Catatan") } };
    case 10:
      if (!MATTRESS_STYLES.includes(p.mattressStyle)) throw invalid(`${label}: pilih model Biasa, Plushtop, atau Pillowtop`);
      return {
        media,
        payload: {
          mattressStyle: p.mattressStyle,
          fabricSpec: text(p.fabricSpec, 2, "Spesifikasi/warna kain", 200),
          borderColor: text(p.borderColor, 2, "Warna list", 100),
          materials: normalizeMaterialLines(p.materials, { ...ctx, required: false, label }),
          note: optionalText(p.note, "Catatan"),
        },
      };
    case 11: {
      requireMedia(media, { label });
      const checklist = p.checklist && typeof p.checklist === "object" ? p.checklist : {};
      const missing = CORNER_CHECKLIST.filter((key) => checklist[key] !== true);
      if (missing.length) throw invalid(`${label}: checklist belum lengkap (${missing.join(", ")})`);
      return { media, payload: { checklist: Object.fromEntries(CORNER_CHECKLIST.map((k) => [k, true])), note: optionalText(p.note, "Catatan") } };
    }
    case 12:
      // Tahap routing "finished" wajib foto (routing_stages.requires_photo) — foto kasur selesai/terbungkus.
      requireMedia(media, { label });
      if (p.confirm !== true) throw invalid(`${label}: konfirmasi selesai wajib dicentang`);
      return { media, payload: { confirm: true, note: optionalText(p.note, "Catatan") } };
    default:
      throw stepError("Tahap tidak dikenal", 400, "STEP_UNKNOWN");
  }
}

// Nomor tahap blueprint untuk tahap routing. stage: { code, phase, sequence, requiresQc }.
export function stepNoForStage(stage) {
  if (!stage) return null;
  switch (stage.code) {
    case "pre_teardown_test": return 2;
    case "teardown": return 3;
    case "foundation_test": return 4;
    case "diagnosis": return 5;
    case "corner_sewing": return 11;
    case "finished": return 12;
    default: break;
  }
  if (stage.requiresQc) return 8;
  if (stage.phase === "MODULE") return Number(stage.sequence) <= 10 ? 6 : 7;
  return null;
}

// ---------------------------------------------------------------------------
// Derivasi aksi berikutnya (murni). state:
//   { runStatus, currentPhase, qcCompleted, unitStatus, handoffPhaseStatus, exceptionOpen,
//     activeOp: { stageCode, stagePhase, stageSequence, status, isLastPreQc } | null,
//     target: { code, phase, sequence, requiresQc, isPostQc } | null,     // tahap berikutnya bila tidak ada operasi aktif
//     opEvidence: [{ stepNo, payload, version }] (bukti operasi aktif, urut naik),
//     step9SinceQc: boolean, openShortage: boolean, serviceSet: boolean, pathHasModules: boolean, materialReady: boolean }
// Hasil: { actor: TABLE|CORNER|QC|WAREHOUSE|NONE, stepNo, action, wait?, label }
//   action: START_WITH_EVIDENCE (1) | START (mulai ulang/tertunda) | COMPLETE (2-7,11) | EVIDENCE (bukti modul terakhir) | TEST (8)
//           | HANDOFF (9) | START_CORNER (10) | FINISH (12) | RESUME | WAIT
// ---------------------------------------------------------------------------
const wait = (actor, reason, extra = {}) => ({ actor, action: "WAIT", wait: reason, stepNo: extra.stepNo ?? null, ...extra });

export function latestTextureVerdict(opEvidence) {
  const tests = (opEvidence || []).filter((e) => e.stepNo === 8);
  return tests.length ? tests[tests.length - 1] : null;
}

export function deriveNextAction(state) {
  if (!state || state.runStatus === "CANCELLED") return wait("NONE", "RUN_CANCELLED");
  if (state.runStatus === "COMPLETED") return wait("NONE", "COMPLETED", { stepNo: 12 });
  if (state.exceptionOpen) return wait("NONE", "EXCEPTION_OPEN");
  if (state.currentPhase === "HANDOFF") {
    return state.handoffPhaseStatus === "BLOCKED" ? wait("NONE", "HANDOFF_REJECTED", { stepNo: 12 }) : wait("WAREHOUSE", "AWAITING_WAREHOUSE", { stepNo: 12 });
  }
  if (!["RECEIVED", "IN_PRODUCTION"].includes(state.unitStatus)) return wait("NONE", "UNIT_NOT_IN_PRODUCTION");

  const op = state.activeOp;
  if (op) {
    const stepNo = stepNoForStage({ code: op.stageCode, phase: op.stagePhase, sequence: op.stageSequence });
    const actor = op.isPostQc ? "CORNER" : "TABLE";
    if (op.status === "PAUSED") {
      if (state.openShortage) return wait("WAREHOUSE", "MATERIAL_SHORTAGE", { stepNo, pausedActor: actor });
      return { actor, stepNo, action: "RESUME" };
    }
    if (op.isLastPreQc && op.stagePhase === "MODULE") {
      // Bukti diurutkan kronologis (`order`). Hasil uji TERLALU KERAS/EMPUK setelah bukti modul terakhir = rework: bukti modul wajib diulang.
      const verdict = latestTextureVerdict(state.opEvidence);
      const moduleEvidence = (state.opEvidence || []).filter((e) => e.stepNo === stepNo);
      const lastModule = moduleEvidence[moduleEvidence.length - 1];
      const reworkPending = !!verdict && verdict.payload?.verdict !== "PAS" && (!lastModule || verdict.order > lastModule.order);
      if (!lastModule || reworkPending) return { actor, stepNo, action: "EVIDENCE", rework: reworkPending, lastVerdict: verdict?.payload?.verdict ?? null };
      return { actor, stepNo: 8, action: "TEST" };
    }
    if (op.stageCode === "diagnosis" && (!state.serviceSet || !state.pathHasModules)) {
      const diagnosed = (state.opEvidence || []).some((e) => e.stepNo === 5);
      return diagnosed
        ? wait("PLANNER", "SERVICE_NOT_SET", { stepNo: 5, retryAction: "COMPLETE" })
        : { actor, stepNo: 5, action: "COMPLETE", serviceMissing: true };
    }
    return { actor, stepNo, action: "COMPLETE" };
  }

  const target = state.target;
  if (!target) return wait("NONE", "NO_TARGET");
  if (target.requiresQc) return wait("QC", "AWAITING_QC", { stepNo: 8 });
  if (target.isPostQc) {
    if (target.code === "corner_sewing") {
      if (!state.step9SinceQc) return { actor: "TABLE", stepNo: 9, action: "HANDOFF" };
      return { actor: "CORNER", stepNo: 10, action: "START_CORNER" };
    }
    if (target.code === "finished") return { actor: "CORNER", stepNo: 12, action: "FINISH" };
    return { actor: "CORNER", stepNo: stepNoForStage(target), action: "START" };
  }
  if (target.code === "pre_teardown_test") return { actor: "TABLE", stepNo: 1, action: "START_WITH_EVIDENCE" };
  const stepNo = stepNoForStage(target);
  if (target.phase === "MODULE" && !state.materialReady) {
    return state.openShortage ? wait("WAREHOUSE", "MATERIAL_SHORTAGE", { stepNo }) : wait("WAREHOUSE", "MATERIAL_NOT_READY", { stepNo });
  }
  return { actor: "TABLE", stepNo, action: "START" };
}

// Bucket Andon/Papan (murni) dari aksi berikutnya + konteks.
export const ANDON_BUCKETS = Object.freeze([
  { key: "ANTREAN", label: "Antrean", tone: "neutral" },
  { key: "BONGKAR", label: "Proses Bongkar", tone: "info" },
  { key: "DIAGNOSA", label: "Diagnosa", tone: "info" },
  { key: "MENUNGGU_BAHAN", label: "Menunggu Bahan", tone: "danger" },
  { key: "FONDASI", label: "Fondasi Baru", tone: "info" },
  { key: "LAPISAN", label: "Lapisan Baru", tone: "info" },
  { key: "QC", label: "QC / Rework", tone: "warning" },
  { key: "CORNER", label: "Di Meja Corner", tone: "accent" },
  { key: "HANDOFF", label: "Serah ke Gudang", tone: "accent" },
  { key: "SELESAI", label: "Selesai", tone: "success" },
  { key: "TERHENTI", label: "Perlu Tindakan", tone: "danger" },
]);

export function andonBucketOf({ next, started, rework = false }) {
  if (!next) return "ANTREAN";
  if (next.wait === "COMPLETED") return "SELESAI";
  if (["RUN_CANCELLED", "EXCEPTION_OPEN", "UNIT_NOT_IN_PRODUCTION", "HANDOFF_REJECTED", "NO_TARGET"].includes(next.wait)) return "TERHENTI";
  if (next.wait === "MATERIAL_SHORTAGE" || next.wait === "MATERIAL_NOT_READY") return "MENUNGGU_BAHAN";
  if (next.wait === "AWAITING_WAREHOUSE") return "HANDOFF";
  if (next.wait === "AWAITING_QC" || rework || next.rework) return "QC";
  if (next.stepNo === 1 && !started) return "ANTREAN";
  if (next.stepNo >= 10) return "CORNER";
  if (next.stepNo === 9) return "QC";
  if (next.stepNo === 8 || next.stepNo === 7) return "LAPISAN";
  if (next.stepNo === 6) return "FONDASI";
  if (next.stepNo === 5) return "DIAGNOSA";
  return "BONGKAR";
}

// Jumlah tahap selesai (untuk "x dari 12 tahap"): tahap dianggap selesai bila buktinya tercatat, kecuali tahap tanpa bukti yang dilewati jalur
// (N/A tidak dihitung sebagai selesai; total disesuaikan).
export function progressOf({ recordedSteps, applicableSteps }) {
  const done = applicableSteps.filter((n) => recordedSteps.has(n)).length;
  return { done, total: applicableSteps.length };
}
