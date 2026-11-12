// TIPE RESPONS backend SANSS yang dipakai aplikasi Produksi (ringkasan — hanya field yang dibaca layar).
// Sumber kebenaran: backend/src/services/productionExperienceReadService.js (toRunView, getAndonBoard,
// getProductionReport), backend/src/routes/production.js (v1-worker-queue), services/capabilities.js.

export type ProductionPreset = "ADMIN" | "QC" | "DOKUMENTASI" | "MEJA" | "NONE";

export type Capabilities = {
  productionApp: boolean;
  productionPreset: ProductionPreset;
  production: { lane: boolean; qc: boolean; plan: boolean; docs: boolean; executeAny: boolean };
};

export type SessionUser = { id: string; name: string; role: string; roles: string[]; avatarUrl?: string | null };

export type LoginResponse = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  session: { id: string; deviceId: string };
  user: SessionUser;
  capabilities: Capabilities;
};

/** "OFF" = fitur Produksi V2 belum aktif untuk unit mana pun (server membalas daftar kosong, bukan galat). */
export type ReaderMode = "COHORT" | "OFF";

export type Bucket =
  | "DALAM_PERJALANAN" | "ANTREAN" | "BONGKAR" | "DIAGNOSA" | "MENUNGGU_BAHAN" | "FONDASI" | "LAPISAN" | "QC" | "CORNER" | "HANDOFF" | "SELESAI";

export type Progress = { done: number; skipped: number; remaining: number; total: number };
export type Timer = { startedAt: string | null; stepStartedAt: string | null; elapsedMinutes: number; stepElapsedMinutes: number; late: boolean };
export type Priority = { key: string; label: string; rank: number; complaintCases?: unknown[] };

/** Satu kartu kerja V2 (toRunView). */
export type RunView = {
  runId: string;
  revision: number;
  status: string;
  track: "BUILD" | "RESTORATION";
  bucket: Bucket;
  bucketLabel: string;
  priority: Priority;
  unit: { id: string; unitCode: string; merk: string | null; ukuran: string | null; status: string; photoUrl: string | null; service: { code: string; label: string } | null };
  customer: {
    orderNumber: string | null; name: string | null; city: string | null; weightKg: number | null;
    /** Berat per pemakai dari order (mis. Suami 80 kg, Istri 60 kg). Kosong = pakai weightKg (Order.beratBadan). */
    weightEntries?: { label: string; beratKg: number }[];
    complaints: string[]; request: string | null; salesServices: string[]; promiseDate: string | null; salesName: string | null;
  };
  plan: {
    id?: string;
    productionDate: string | null; stationCode: string | null; stationLabel: string | null; stationSequence: number | null;
    priorityLabel: string; priorityRank: number; targetDate: string | null; targetMissed: boolean;
    operator: { id: string; userId?: string; name: string | null } | null; cornerOperator: { id: string; userId?: string; name: string | null } | null;
  } | null;
  next: RunNext | null;
  progress: Progress;
  timer: Timer;
  activeOp: { stageLabel: string | null; status: string; startedAt: string | null; delayKind: string | null; delayNote: string | null } | null;
  shortage: { items: { name: string }[]; note: string | null } | null;
  steps?: StepStatus[];
  warnings?: { code: string; label?: string }[];
};

/** Aksi berikutnya dari server (lib/domain/productionSteps.js#nextAction). */
export type RunNext = {
  actor?: "TABLE" | "CORNER" | "QC" | "WAREHOUSE" | "NONE";
  stepNo?: number | null;
  action?: "START_WITH_EVIDENCE" | "START" | "RESUME" | "COMPLETE" | "EVIDENCE" | "TEST" | "HANDOFF" | "START_CORNER" | "FINISH" | "WAIT";
  wait?: string;
  label?: string;
  continueOnly?: boolean;
  rework?: boolean;
  gated?: boolean;
  layersRequired?: boolean;
  /** Tahap 7 (LAYANAN): hasil aktual susunan wajib dicatat di Catatan Komponen dulu. */
  layersAfterRequired?: boolean;
  /** Tahap 8: hasil uji tekstur sebelumnya (rework). */
  lastVerdict?: string | null;
};

/** Status 12 langkah Produksi V2 (stepStatuses di server). NA = tidak berlaku untuk unit ini. */
export type StepStatus = { no: number; code: string; label: string; status: "DONE" | "CURRENT" | "WAITING" | "PENDING" | "SKIPPED" | "NA"; at: string | null };

export type BahanDiserahkan = { materialId: string; code: string; name: string; uom: string | null; qty: number; usedQty?: number; remainingQty?: number };

/** Permintaan Sales untuk Corner + status Corner (loadCornerView di server). */
export type CornerView = {
  contractV2?: boolean;
  request?: {
    fabricChangeRequested?: boolean; fabricItems?: string[]; notes?: string | null; noteOnly?: boolean;
    motifMentioned?: boolean; colorMentioned?: boolean; missing?: string[]; needsSalesConfirmation?: boolean; hint?: string | null;
  } | null;
  status?: { status?: string; reason?: string | null; note?: string | null; decidedBy?: string | null } | null;
  records?: { start?: { salesConfirmation?: string | null; byName?: string | null; at?: string | null } | null } | null;
};

/** Kartu kerja lengkap (GET /production-v2/runs/:runId/card) — RunView + bukti per langkah. */
export type RunCard = RunView & {
  workCenterId: string | null;
  adaptation: { policy: string } | null;
  cornerView?: CornerView | null;
  /** Bahan yang diserahkan Gudang untuk unit ini (diserahkan / terpakai / sisa — tiga angka terpisah). */
  issuedMaterials?: BahanDiserahkan[];
  /** Rencana bahan (BOM) — urutan pertama saat memilih bahan yang kurang. */
  bom?: { materialId: string; code: string; name: string; qty: number; uom: string | null }[];
  /** PIC Bahan (LAYANAN): bila sudah ada, pemakaian bahan tahap 6 (dan 7 restorasi PIC) tidak diisi lagi oleh Meja. */
  materialPic?: { materialOperator?: { name: string | null } | null; record?: { materials?: { name?: string | null; code?: string | null; qty: number }[] } | null } | null;
  evidence: { id: string; stepNo: number; stepLabel: string | null; createdAt: string; actor: string | null; media: { kind: string; url: string }[] }[];
};

export type WorkerQueue = { readerMode: ReaderMode; lane?: "TABLE" | "CORNER"; operator: { id: string | null; all?: boolean } | null; items: RunView[] };

/** Antrean V1 (unit di luar cohort V2 yang ditugaskan ke PIC ini). */
export type V1State = "READY" | "IN_PROGRESS" | "PAUSED" | "BLOCKED" | "WAITING_PREREQUISITE" | "WAITING_ASSIGNMENT";
export type V1QueueItem = {
  state: V1State;
  stage: { id: string; code: string; labelId: string } | null;
  unit: {
    id: string; unitCode: string; merk: string | null; ukuran: string | null; status: string; priority?: string | null;
    order?: { orderNumber: string | null; customer?: { name: string | null } | null } | null;
  };
};
export type V1Queue = { items: V1QueueItem[] };

export type AndonItem = {
  runId: string; unitCode: string; customerName: string | null; merk: string | null; ukuran: string | null;
  bucket: Bucket; bucketLabel: string; stepNo: number | null; stepLabel: string | null;
  progress: Progress; timer: Timer; priority: number; priorityLabel: string; operatorName: string | null; cornerName: string | null;
  shortage: string[] | null;
};
export type AndonStation = { code: string; label: string; capacity: number; operatorNames: string[]; items: AndonItem[] };
export type AndonBoard = {
  readerMode: ReaderMode;
  date?: string;
  generatedAt?: string;
  kpi?: { target: number; planned: number; completed: number; waitingMaterial: number; late: number };
  counts: Partial<Record<Bucket, number>>;
  stations: AndonStation[];
};

export type MediaItem = { stepNo?: number; stepLabel?: string; kind?: string; url: string | null; source?: string; caption?: string | null; category?: string; label?: string };
export type ProductionReport = {
  runId: string;
  unit: { unitCode: string; merk: string | null; ukuran: string | null; service: string | null };
  order: { orderNumber: string | null; customerName: string | null };
  media: { before: MediaItem[]; process: MediaItem[]; after: MediaItem[] };
  mediaCount: number;
};
