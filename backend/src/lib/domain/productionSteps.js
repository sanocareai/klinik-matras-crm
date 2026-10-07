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

import { CORNER_UNCONFIRMED_WAIT, PRODUCT_FLOW, PRODUCT_UNCONFIRMED_WAIT, stepLabelFor } from "./productionBuildTrack.js";

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
  const PRODUCT_UNCONFIRMED_WAIT_CODE = "STEP_WAITING_" + PRODUCT_UNCONFIRMED_WAIT;
const label = `Tahap ${stepNo} (${stepLabelFor(stepNo, step.label, ctx.buildTrack)})`; // jalur pengerjaan: tahap 6 = Pengerjaan Pesanan
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
    case 6: {
      // Jalur pengerjaan (pesanan BARU/custom): foto ATAU video hasil pengerjaan (video tidak wajib — itu khas uji fondasi restorasi); jalur restorasi tetap wajib video.
      requireMedia(media, { label, video: !ctx.buildTrack });
      if (ctx.buildTrack && ctx.productFlow === PRODUCT_FLOW.UNCONFIRMED) {
        throw stepError("Jenis produk belum jelas pada order — konfirmasi jenis produk dulu (Sales memperbaiki order) sebelum bukti pengerjaan dikirim", 409, PRODUCT_UNCONFIRMED_WAIT_CODE);
      }
      // PIC Bahan per pekerjaan (jalur pengerjaan): pemakaian & racikan dicatat PIC Bahan lewat command resminya — satu sumber, tidak ada hitung ganda di bukti PIC Meja.
      const p6Materials = Array.isArray(p.materials) ? p.materials : [];
      if (ctx.buildTrack && ctx.materialsByPic && p6Materials.length) {
        throw stepError("Pemakaian bahan pekerjaan ini dicatat PIC Bahan — kosongkan daftar bahan pada bukti pengerjaan", 409, "STEP_MATERIAL_BY_MATERIAL_PIC");
      }
      // Bahan dari Gudang BOLEH kosong pada jalur pengerjaan (pemakaian dicatat sesuai pekerjaan nyata); jalur restorasi tetap wajib.
      const base = { materials: normalizeMaterialLines(p.materials, { ...ctx, required: !ctx.buildTrack, label }), note: text(p.note, 3, ctx.buildTrack ? "Penjelasan pengerjaan" : "Penjelasan isi fondasi") };
      // Kasur custom: racikan fondasi/lapisan (ditentukan PIC Meja bersama PIC QC) wajib tercatat — dari bukti ini ATAU dari catatan PIC Bahan. Non-kasur (divan/sofa) tidak memakai racikan kasur.
      if (ctx.buildTrack && ctx.productFlow === PRODUCT_FLOW.KASUR) {
        const r = p.racikan && typeof p.racikan === "object" && !Array.isArray(p.racikan) ? p.racikan : {};
        const fondasi = optionalText(r.fondasi, "Racikan fondasi", 400); const lapisan = optionalText(r.lapisan, "Racikan lapisan", 400);
        const given = (fondasi?.length ?? 0) >= 3 || (lapisan?.length ?? 0) >= 3;
        if (!given && !ctx.racikanRecorded) throw invalid(`${label}: isi racikan fondasi dan/atau lapisan (minimal 3 karakter)`);
        if (given) base.racikan = { fondasi: fondasi || null, lapisan: lapisan || null };
      }
      return { media, payload: base };
    }
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
// Flow adaptasi (slice 2): tahap boleh DILEWATI lewat aksi sah; dicatat sebagai bukti berstatus SKIPPED (tanpa media, tanpa hasil uji).
// Bukti SKIPPED tetap baris immutable di production_step_evidence_v2 (payload.outcome = "SKIPPED"); progres membedakan dikerjakan vs dilewati.
// ---------------------------------------------------------------------------
export const SKIP_OUTCOME = "SKIPPED";
export const SKIP_REASON = "Adaptasi sistem";
export const isSkippedEvidence = (e) => e?.payload?.outcome === SKIP_OUTCOME;
export const skippedEvidencePayload = (note = null) => ({ outcome: SKIP_OUTCOME, reason: SKIP_REASON, policy: "ADAPTATION_V1", note: note || null });

// Nomor tahap blueprint yang ditutup bila SATU tahap routing dilewati. isLastPreQc: modul terakhir sebelum QC juga menutup tahap 8 (uji tekstur PIC).
export function stepsCoveredByStage(stage, { isLastPreQc = false } = {}) {
  if (!stage) return [];
  switch (stage.code) {
    case "pre_teardown_test": return [1, 2];
    case "teardown": return [3];
    case "foundation_test": return [4];
    case "diagnosis": return [5];
    case "corner_sewing": return [10, 11];
    case "finished": return [12];
    default: break;
  }
  if (stage.requiresQc) return [];
  if (stage.phase === "MODULE") return [Number(stage.sequence) <= 10 ? 6 : 7, ...(isLastPreQc ? [8] : [])];
  return [];
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
  // P9A (One-Location Production Intake) — "Masuk Produksi", pickup berhasil,
  // TAPI belum dikonfirmasi tiba di workshop. Diperiksa LEBIH DULU dari
  // exceptionOpen/unitStatus/dst di bawah — tidak satu pun itu relevan sebelum
  // unit benar-benar tiba secara fisik.
  if (state.runStatus === "PENDING_ARRIVAL") return wait("NONE", "PENDING_ARRIVAL");
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
    if (state.buildTrack && op.stagePhase === "MODULE") {
      // Jenis produk kanonis belum jelas: bukti pengerjaan/uji khusus kasur DITAHAN (pekerjaan fisik boleh berjalan) sampai Sales mengonfirmasi jenis pada order.
      if (state.productFlow === PRODUCT_FLOW.UNCONFIRMED) return wait("SALES", PRODUCT_UNCONFIRMED_WAIT, { stepNo, problem: state.productProblem ?? null });
      // Produk NON-kasur (divan/sofa): tanpa uji tekstur PIC (tahap 8) — satu kiriman bukti menutup tahap lalu menunggu pemeriksaan hasil PIC QC.
      if (state.productFlow === PRODUCT_FLOW.NON_KASUR) return { actor, stepNo, action: "COMPLETE" };
      // Kasur dengan PIC Bahan: racikan dicatat PIC Bahan lebih dulu (PIC Meja menutup pengerjaan setelahnya).
      if (state.materialOperatorId && !state.racikanRecorded) return wait("MATERIAL_PIC", "RACIKAN_NOT_RECORDED", { stepNo });
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
    // P9D: selain layanan/jalur modul (P8, lama), tahap 5 juga menunggu Diagnosis Produksi selesai — bahan
    // manual terpetakan semua DAN Planned BOM sudah berisi (lihat productionDiagnosisCommandService.js).
    const diagnosisPending = !state.diagnosisManualMapped || !state.diagnosisBomHasLines;
    if (op.stageCode === "diagnosis" && (!state.serviceSet || !state.pathHasModules || diagnosisPending)) {
      const diagnosed = (state.opEvidence || []).some((e) => e.stepNo === 5);
      if (!diagnosed) return { actor, stepNo: 5, action: "COMPLETE", serviceMissing: true };
      // Alasan menunggu DIBEDAKAN (sandbox QA: pesan lama selalu menyuruh Lead "menetapkan layanan" padahal yang tertunda bahan manual).
      if (!state.serviceSet || !state.pathHasModules) return wait("PLANNER", "SERVICE_NOT_SET", { stepNo: 5, retryAction: "COMPLETE" });
      if (!state.diagnosisManualMapped) return wait("PLANNER", "DIAGNOSIS_MANUAL_UNMAPPED", { stepNo: 5, retryAction: "COMPLETE" });
      return wait("PLANNER", "DIAGNOSIS_BOM_EMPTY", { stepNo: 5, retryAction: "COMPLETE" });
    }
    // Diagnosa SUDAH tercatat & semua syarat (layanan, jalur, bahan manual terpetakan, BOM terisi) terpenuhi: PIC cukup "Lanjutkan"
    // satu ketuk (payload kosong -> recordProductionStep memakai ulang diagnosa yang sudah ada). Sebelumnya flag ini tidak pernah
    // dikirim server sehingga PIC dipaksa mengisi ulang wizard dari kosong.
    if (op.stageCode === "diagnosis" && (state.opEvidence || []).some((e) => e.stepNo === 5)) return { actor, stepNo, action: "COMPLETE", continueOnly: true };
    return { actor, stepNo, action: "COMPLETE" };
  }

  const target = state.target;
  if (!target) return wait("NONE", "NO_TARGET");
  // Mode adaptasi: semua tahap sudah tuntas -> tinggal "Selesaikan Produksi" (pratinjau + konfirmasi). Tidak ada tahap yang diulang.
  if (state.adaptation && target.done) return wait("TABLE", "READY_TO_FINISH", { stepNo: 12 });
  // Mode adaptasi: Meja -> Corner TETAP berjalan tanpa putusan QC. Tahap 9 "Kirim ke Corner" (bukti foto) mencatat gerbang QC sebagai TIDAK DILAKUKAN (bukan lulus, bukan di-waive).
  if (target.requiresQc) {
    if (state.buildTrack) {
      // Kebutuhan Corner harus DIKONFIRMASI pada rencana sebelum gerbang QC dilewati (jalur Corner ditentukan olehnya; tidak diasumsikan dari jenis produk).
      if (state.cornerRequired == null) return wait("PLANNER", CORNER_UNCONFIRMED_WAIT, { stepNo: 9 });
      // Corner tidak diperlukan + adaptasi: tidak ada tahap "Kirim ke Corner" sebagai pemicu — QC dicatat tidak dilakukan lewat Selesaikan Produksi.
      if (state.cornerRequired === false && state.adaptation) return wait("TABLE", "READY_TO_FINISH", { stepNo: 12 });
    }
    // Produk non-kasur (jalur pengerjaan) tidak punya tahap 8 (uji tekstur kasur): menunggu pemeriksaan hasil PIC QC tanpa nomor tahap.
    return state.adaptation ? { actor: "TABLE", stepNo: 9, action: "HANDOFF", qcNotPerformed: true } : wait("QC", "AWAITING_QC", { stepNo: state.buildTrack && state.productFlow === PRODUCT_FLOW.NON_KASUR ? null : 8 });
  }
  if (target.isPostQc) {
    if (target.code === "corner_sewing") {
      if (state.buildTrack && state.cornerRequired == null) return wait("PLANNER", CORNER_UNCONFIRMED_WAIT, { stepNo: 9 });
      if (!state.step9SinceQc) return { actor: "TABLE", stepNo: 9, action: "HANDOFF" };
      return { actor: "CORNER", stepNo: 10, action: "START_CORNER" };
    }
    // Tanpa Corner (dikonfirmasi pada rencana): Finish dikonfirmasi PIC Meja (tahap Jahit Corner tidak ada di jalur).
    if (target.code === "finished") return { actor: state.buildTrack && state.cornerRequired === false ? "TABLE" : "CORNER", stepNo: 12, action: "FINISH" };
    return { actor: "CORNER", stepNo: stepNoForStage(target), action: "START" };
  }
  if (target.code === "pre_teardown_test") return { actor: "TABLE", stepNo: 1, action: "START_WITH_EVIDENCE" };
  const stepNo = stepNoForStage(target);
  // Jalur pengerjaan (pesanan BARU): unit langsung dapat dikerjakan setelah dijadwalkan + PIC ditentukan; BOM/serah bahan tetap tersedia tetapi TIDAK menahan mulai.
  if (target.phase === "MODULE" && !state.materialReady && !state.buildTrack) {
    return state.openShortage ? wait("WAREHOUSE", "MATERIAL_SHORTAGE", { stepNo }) : wait("WAREHOUSE", "MATERIAL_NOT_READY", { stepNo });
  }
  return { actor: "TABLE", stepNo, action: "START" };
}

// Bucket Andon/Papan (murni) dari aksi berikutnya + konteks.
export const ANDON_BUCKETS = Object.freeze([
  // P9A — unit sudah "Masuk Produksi" (pickup berhasil) tapi masih dalam
  // perjalanan fisik ke workshop; DIBEDAKAN dari ANTREAN (yang sudah tiba,
  // tinggal menunggu giliran dikerjakan).
  { key: "DALAM_PERJALANAN", label: "Dalam Perjalanan", tone: "neutral" },
  { key: "ANTREAN", label: "Antrean", tone: "neutral" },
  { key: "BONGKAR", label: "Proses Bongkar", tone: "info" },
  { key: "DIAGNOSA", label: "Diagnosa", tone: "info" },
  { key: "MENUNGGU_BAHAN", label: "Tertunda — menunggu bahan", tone: "danger" },
  { key: "FONDASI", label: "Fondasi Baru", tone: "info" },
  { key: "LAPISAN", label: "Lapisan Baru", tone: "info" },
  { key: "QC", label: "QC / Rework", tone: "warning" },
  { key: "CORNER", label: "Di Meja Corner", tone: "accent" },
  { key: "HANDOFF", label: "Serah ke Gudang", tone: "accent" },
  { key: "SELESAI", label: "Selesai", tone: "success" },
  { key: "TERHENTI", label: "Perlu Tindakan", tone: "danger" },
]);

export function andonBucketOf({ next, started, rework = false, buildTrack = false }) {
  if (!next) return "ANTREAN";
  if (next.wait === "PENDING_ARRIVAL") return "DALAM_PERJALANAN";
  if (next.wait === "COMPLETED") return "SELESAI";
  if (["RUN_CANCELLED", "EXCEPTION_OPEN", "UNIT_NOT_IN_PRODUCTION", "HANDOFF_REJECTED", "NO_TARGET"].includes(next.wait)) return "TERHENTI";
  if (next.wait === "MATERIAL_SHORTAGE" || next.wait === "MATERIAL_NOT_READY") return "MENUNGGU_BAHAN";
  if (next.wait === "AWAITING_WAREHOUSE") return "HANDOFF";
  if (next.wait === "AWAITING_QC" || rework || next.rework) return "QC";
  if (next.stepNo === 1 && !started) return "ANTREAN";
  if (buildTrack && next.stepNo === 6 && !started) return "ANTREAN"; // jalur pengerjaan: tahap pertama = Pengerjaan Pesanan (tahap 6)
  if (next.stepNo >= 10) return "CORNER";
  if (next.stepNo === 9) return "QC";
  if (next.stepNo === 8 || next.stepNo === 7) return "LAPISAN";
  if (next.stepNo === 6) return "FONDASI";
  if (next.stepNo === 5) return "DIAGNOSA";
  return "BONGKAR";
}

// P9B.1 — kolom Status Produksi (Command Center): pemetaan LEBIH HALUS dari andonBucketOf, KHUSUS untuk papan pipeline
// (Akan Masuk/Dalam Perjalanan/Tiba-Belum Mulai/Fondasi/Lapisan/Uji Tekstur/QC/Corner/Siap Kirim). TIDAK mengubah
// andonBucketOf (dipakai Andon TV, WorkerLane, badge kartu lama — tetap harus stabil). "Akan Masuk" murni dari Job
// pickup (bukan Run), jadi TIDAK dihasilkan di sini — dipetakan terpisah oleh pemanggil (unit belum punya Run sama
// sekali). "Uji Tekstur" (tahap 8) dipisah dari "Lapisan" (tahap 7) di sini walau andonBucketOf menggabungkannya —
// permintaan P9B eksplisit minta kolom terpisah; run yang MENUNGGU_BAHAN tetap ditempatkan di kolom tahapnya sendiri
// (bukan kolom terpisah) — kekurangan bahan ditandai lewat badge pada kartu (lihat indicatorsOf/warningsOf).
//
// P9B.1 (revisi) — "Dijadwalkan"/"Belum Dijadwalkan" DIHAPUS sebagai kolom TAHAP: status penjadwalan bukan tahap
// pipeline, jadi sekarang murni badge pada kartu (lihat targetDateBadge/priorityTone + badge meja baru di
// RunCard), bukan kolom papan. Sebagai gantinya kolom mencerminkan KEADAAN FISIK unit:
//   - DALAM_PERJALANAN: pickup selesai TAPI belum dikonfirmasi tiba (run PENDING_ARRIVAL) — TERMASUK unit yang
//     SUDAH dijadwalkan sebelum tiba (P9A); badge meja/tanggal tetap tampil di kartunya, tapi kartunya sendiri
//     TETAP di kolom ini sampai kedatangan fisik dikonfirmasi.
//   - TIBA_BELUM_MULAI: kedatangan sudah dikonfirmasi (bukan lagi PENDING_ARRIVAL), tahap 1-5 (intake: sebelum
//     bongkar..diagnosa) belum menjadi Fondasi, ATAU macet/TERHENTI — baik yang sudah dijadwalkan maupun belum,
//     dibedakan lewat badge, bukan kolom.
export const COMMAND_CENTER_COLUMNS = Object.freeze([
  { key: "AKAN_MASUK", label: "Akan Masuk — Pickup Terjadwal" },
  { key: "DALAM_PERJALANAN", label: "Dalam Perjalanan" },
  { key: "TIBA_BELUM_MULAI", label: "Tiba / Belum Mulai" },
  { key: "PENGERJAAN", label: "Pengerjaan Pesanan" }, // jalur pengerjaan (BARU/custom): bukan "Fondasi Jadi" — tidak ada tahap bongkar/uji fondasi
  { key: "UJI_HASIL", label: "Uji Hasil Sebelum Corner" }, // jalur pengerjaan: uji tekstur PIC (kasur) / pemeriksaan hasil QC, sebelum Corner
  { key: "BONGKAR", label: "Tahap Bongkar" },
  { key: "UJI_FONDASI", label: "Uji Fondasi" },
  { key: "FONDASI", label: "Fondasi Jadi" },
  { key: "LAPISAN", label: "Lapisan Jadi" },
  { key: "UJI_TEKSTUR", label: "Uji Tekstur Sebelum Corner" },
  { key: "CORNER", label: "Corner" },
  { key: "SIAP_KIRIM", label: "Serah ke Gudang" }, // tahap kerja (unit Diproses menunggu Gudang) — BUKAN status Siap Kirim (itu status order/unit)
]);

// view: hasil toRunView (punya .plan, .next, .bucket). Mengembalikan null untuk SELESAI (sudah diserahkan tuntas —
// dikeluarkan dari papan aktif harian, tetap terhitung di KPI "selesai hari ini").
//
// Revisi stage (permintaan Owner 2 Okt 2026): kolom = KEADAAN FISIK unit menurut `next.stepNo` (tahap berikutnya yang
// harus dikerjakan), dinamai menurut capaian terakhir:
//   Tiba / Belum Mulai          — sudah tiba, Langkah 1 belum dimulai (atau terhenti/tanpa tahap)
//   Tahap Bongkar               — Langkah 1-3 (sebelum bongkar, uji rasa awal, hasil bongkar) sudah berjalan
//   Uji Fondasi                 — Langkah 4-6 (uji fondasi lama, diagnosa, fondasi baru dikerjakan/diuji)
//   Fondasi Jadi                — Langkah 6 selesai; berikutnya Langkah 7 (lapisan baru)
//   Lapisan Jadi                — Langkah 7 selesai; berikutnya Langkah 8 (uji tekstur akhir belum dikirim)
//   Uji Tekstur Sebelum Corner  — uji tekstur terkirim: menunggu QC / rework / Langkah 9 (kirim ke Corner)
//   Corner                      — Langkah 10-12 (jahit & konfirmasi selesai)
// Kolom "QC" lama DILEBUR ke Uji Tekstur Sebelum Corner (QC memang uji sebelum Corner). Kunci FONDASI/LAPISAN/UJI_TEKSTUR
// dipertahankan (hanya label berubah) supaya konsumen lain tidak patah.
export function commandCenterColumn(view) {
  if (view.bucket === "SELESAI") return null;
  // Fisik belum tiba -> kolom KEADAAN FISIK, TIDAK PEDULI status jadwal (stationCode ada atau tidak) — jadwal
  // hanya badge di kartu, bukan penentu kolom lagi (beda dari perilaku P9B sebelumnya).
  if (view.bucket === "DALAM_PERJALANAN") return "DALAM_PERJALANAN";
  // Bucket semantik (QC/HANDOFF) diperiksa LEBIH DULU dari stepNo mentah: rework yang menunggu QC bisa terpicu dari
  // stepNo 7/8 (uji tekstur gagal) tapi TETAP harus jatuh ke kolom uji tekstur, bukan Fondasi/Lapisan Jadi.
  if (view.bucket === "QC") return view.track === "BUILD" ? "UJI_HASIL" : "UJI_TEKSTUR";
  if (view.bucket === "HANDOFF") return "SIAP_KIRIM";
  const stepNo = view.next?.stepNo;
  // Jalur pengerjaan (BARU/custom): belum mulai = Tiba / Belum Mulai; Pengerjaan Pesanan berjalan = kolom Pengerjaan Pesanan (BUKAN "Fondasi Jadi" sebelum ada fondasi selesai);
  // uji tekstur PIC / pemeriksaan hasil QC / Kirim ke Corner = Uji Hasil. Tahap Corner (>=10) tetap kolom Corner.
  if (view.track === "BUILD") {
    if (stepNo === 6) return view.bucket === "ANTREAN" || view.bucket === "TERHENTI" ? "TIBA_BELUM_MULAI" : "PENGERJAAN";
    if (stepNo === 8 || stepNo === 9) return "UJI_HASIL";
  }
  if (stepNo === 9) return "UJI_TEKSTUR";
  if (stepNo === 8) return "LAPISAN";
  if (stepNo === 7) return "FONDASI";
  if (stepNo != null && stepNo >= 10) return "CORNER";
  if (stepNo >= 4 && stepNo <= 6) return "UJI_FONDASI";
  // Langkah 1-3: belum dimulai (ANTREAN) = Tiba / Belum Mulai; sudah berjalan = Tahap Bongkar. Terhenti/tanpa tahap -> Tiba.
  if (stepNo >= 1 && stepNo <= 3 && view.bucket !== "ANTREAN" && view.bucket !== "TERHENTI") return "BONGKAR";
  return "TIBA_BELUM_MULAI";
}

// Jumlah tahap selesai (untuk "x dari 12 tahap"): tahap dianggap selesai bila buktinya tercatat, kecuali tahap tanpa bukti yang dilewati jalur
// (N/A tidak dihitung sebagai selesai; total disesuaikan).
export function progressOf({ recordedSteps, applicableSteps }) {
  const done = applicableSteps.filter((n) => recordedSteps.has(n)).length;
  return { done, total: applicableSteps.length };
}
