import type { RunCard, RunNext } from "@/api/types";

// MODEL MURNI aksi tahap Produksi V2 — CERMIN frontend/src/features/production/experience.js (validateStepForm,
// buildStepPayload, MEDIA_RULES, isQuickAction, actionLabel) yang sendiri mencerminkan kontrak server.
// Server tetap penentu: `next` (aksi berikutnya) dari kartu, expectedRevision dari kartu, server menolak bila tidak sah.
// Bila salah satu berkas ini berubah, samakan yang lain (tes di __tests__/langkah.test.ts menjaga bentuk payload).

export const LABEL_TAHAP: Record<number, string> = {
  1: "Sebelum Bongkar", 2: "Uji Rasa Awal", 3: "Hasil Bongkar", 4: "Uji Fondasi Lama", 5: "Diagnosa", 6: "Fondasi Baru",
  7: "Lapisan Baru", 8: "Uji Tekstur Akhir", 9: "Kirim ke Corner", 10: "Mulai Jahit", 11: "Jahit Selesai", 12: "Konfirmasi Selesai",
};
export const PETUNJUK: Record<number, string> = {
  1: "Foto/video kasur utuh dari luar. Cek ukuran & kondisi kain luar.",
  2: "Video uji tekan/rebah sebelum dibongkar + catatan rasa awal.",
  3: "Foto/video bagian dalam setelah dibuka + centang material lama.",
  4: "Video uji fondasi oleh penguji seberat customer + tinggi awal & saat ditekan.",
  9: "Foto/video kasur siap dibungkus kain, lalu kirim ke meja jahit.",
  11: "Foto/video hasil jahitan + checklist kerapian.",
  12: "Foto kasur selesai/terbungkus, lalu serahkan ke Gudang.",
};

/** Kebutuhan media per tahap (cermin MEDIA_RULES web/server). video=true → minimal satu video. */
export const ATURAN_MEDIA: Record<number, { min: number; video: boolean }> = {
  1: { min: 1, video: false }, 2: { min: 1, video: true }, 3: { min: 1, video: false }, 4: { min: 1, video: true },
  5: { min: 0, video: false }, 6: { min: 1, video: true }, 7: { min: 1, video: false }, 8: { min: 1, video: true },
  9: { min: 1, video: false }, 10: { min: 0, video: false }, 11: { min: 1, video: false }, 12: { min: 1, video: false },
};
export const aturanMedia = (stepNo: number, track?: string) =>
  track === "BUILD" && stepNo === 6 ? { min: 1, video: false } : ATURAN_MEDIA[stepNo] ?? { min: 0, video: false };

export const MATERIAL_LAMA = [
  { value: "PER", label: "Per / Spring" }, { value: "BUSA", label: "Busa" }, { value: "REBONDED", label: "Rebonded" },
  { value: "KAIN", label: "Kain" }, { value: "LATEX", label: "Latex" }, { value: "KAPUK", label: "Kapuk" }, { value: "LAINNYA", label: "Lainnya" },
] as const;
export const CHECKLIST_CORNER = [
  { key: "jahitan", label: "Jahitan rapi & kuat" }, { key: "list", label: "List terpasang rata" },
  { key: "resleting", label: "Resleting berfungsi" }, { key: "kebersihan", label: "Kasur bersih" },
] as const;

/** Alasan Tunda yang bisa langsung dikirim dari HP (BAHAN butuh daftar bahan Gudang → tetap di Web). Kunci = yang dikirim web. */
export const ALASAN_TUNDA = [
  { key: "ARAHAN", label: "Menunggu arahan" },
  { key: "KENDALA", label: "Kendala pengerjaan" },
  { key: "LAINNYA", label: "Lainnya" },
] as const;
export type AlasanTunda = (typeof ALASAN_TUNDA)[number]["key"];
export const tundaSah = (key: string, catatan: string) => ALASAN_TUNDA.some((a) => a.key === key) && (key !== "LAINNYA" || catatan.trim().length >= 3);

export type FormLangkah = {
  conditionConfirmed?: boolean; conditionNote?: string;
  feelNote?: string;
  oldMaterials?: string[]; note?: string;
  heightBeforeCm?: string; heightCompressedCm?: string; testerWeightKg?: string;
  checklist?: Record<string, boolean>; cornerWork?: string; noDifference?: boolean; differenceNote?: string;
  confirm?: boolean;
};
export type MediaTerunggah = { url: string; kind: "image" | "video"; previewUrl?: string | null };

/** Aksi satu-ketuk (tanpa formulir): Mulai, Lanjutkan, atau "Lanjutkan" ketika buktinya sudah ada di sumbernya. */
export const aksiCepat = (next: RunNext | null | undefined) =>
  !!next && (next.action === "START" || next.action === "RESUME" || ((next.action === "COMPLETE" || next.action === "TEST") && !!next.continueOnly));

export function labelAksi(next: RunNext | null | undefined, stageLabel?: string | null): string | null {
  if (!next || next.stepNo == null) return null;
  const nama = LABEL_TAHAP[next.stepNo] ?? "Tahap";
  switch (next.action) {
    case "START_WITH_EVIDENCE": return "Mulai: Foto Sebelum Bongkar";
    case "START": return `Mulai ${stageLabel || nama}`;
    case "RESUME": return "Lanjutkan Pekerjaan";
    case "COMPLETE": return next.continueOnly ? "Lanjutkan" : `Kirim ${nama}`;
    case "EVIDENCE": return next.rework ? `Ulangi ${nama} (Rework)` : `Kirim Bukti ${nama}`;
    case "TEST": return next.continueOnly ? "Lanjutkan ke Gerbang QC" : "Kirim Uji Tekstur Akhir";
    case "HANDOFF": return "Kirim ke Corner";
    case "START_CORNER": return "Mulai Jahit";
    case "FINISH": return "Konfirmasi Selesai";
    default: return null;
  }
}

/**
 * Formulir tahap ini bisa diisi dari HP? Tahap 5 (wizard Diagnosa), 6/7/10 (pilih bahan Gudang), 8 (uji tekstur ditulis PIC QC),
 * tahap 3 yang menunggu Catatan Komponen, dan tahap 12 dengan kontrak Corner V2 (pratinjau barang jadi) masih lewat SANSS Web.
 */
export function formulirDidukung(card: Pick<RunCard, "track" | "cornerView">, next: RunNext): { ok: true } | { ok: false; alasan: string } {
  const n = next.stepNo ?? 0;
  if (card.track === "BUILD") return { ok: false, alasan: "Jalur Pengerjaan Pesanan masih lewat SANSS Web." };
  if (n === 3 && next.gated && next.layersRequired) return { ok: false, alasan: "Catat susunan lapisan awal di Catatan Komponen (SANSS Web) dulu." };
  if (n === 12 && card.cornerView?.contractV2) return { ok: false, alasan: "Konfirmasi selesai dengan serah ke Gudang masih lewat SANSS Web." };
  if ([1, 2, 3, 4, 9, 11, 12].includes(n)) return { ok: true };
  return { ok: false, alasan: `${LABEL_TAHAP[n] ?? "Tahap ini"} butuh pilihan bahan/wizard — isi lewat Aplikasi Meja di SANSS Web.` };
}

const angka = (v: unknown) => Number(String(v ?? "").replace(",", "."));

export function validasiLangkah(stepNo: number, f: FormLangkah, media: MediaTerunggah[], opsi: { track?: string; gated?: boolean; cornerV2?: boolean } = {}): string | null {
  const r = aturanMedia(stepNo, opsi.track);
  if (media.length < r.min) return `Lampirkan minimal ${r.min} foto/video.`;
  if (r.video && !media.some((m) => m.kind === "video")) return "Tahap ini wajib video.";
  switch (stepNo) {
    case 1: return f.conditionConfirmed ? null : "Centang konfirmasi ukuran & kondisi kain luar.";
    case 2: return (f.feelNote ?? "").trim().length >= 3 ? null : "Tulis catatan rasa awal.";
    case 3: return opsi.gated || (f.oldMaterials ?? []).length ? null : "Centang minimal satu material lama.";
    case 4: {
      const a = angka(f.heightBeforeCm); const b = angka(f.heightCompressedCm); const w = angka(f.testerWeightKg);
      if (!(a > 0) || !(b > 0)) return "Isi tinggi awal dan tinggi saat ditekan (cm).";
      if (b > a) return "Tinggi saat ditekan tidak boleh lebih besar dari tinggi awal.";
      if (!(w > 0)) return "Isi berat penguji (kg).";
      return null;
    }
    case 9: return null;
    case 11:
      if (!CHECKLIST_CORNER.every((c) => f.checklist?.[c.key])) return "Lengkapi checklist jahitan.";
      if (opsi.cornerV2) {
        if ((f.cornerWork ?? "").trim().length < 3) return "Tulis pekerjaan Corner yang dilakukan.";
        if (!f.noDifference && (f.differenceNote ?? "").trim().length < 1) return "Isi catatan perbedaan, atau centang \"Tidak ada perbedaan\".";
      }
      return null;
    case 12: return f.confirm ? null : "Centang konfirmasi selesai.";
    default: return "Tahap ini belum bisa diisi dari HP.";
  }
}

const opt = (s?: string) => (s && s.trim() ? s.trim() : undefined);

/** Payload server dari formulir (bentuk SAMA dengan buildStepPayload web). */
export function payloadLangkah(stepNo: number, f: FormLangkah, opsi: { cornerV2?: boolean } = {}): Record<string, unknown> {
  switch (stepNo) {
    case 1: return { conditionConfirmed: !!f.conditionConfirmed, conditionNote: opt(f.conditionNote) };
    case 2: return { feelNote: (f.feelNote ?? "").trim() };
    case 3: return { oldMaterials: (f.oldMaterials ?? []).map((type) => ({ type })), note: opt(f.note) };
    case 4: return { heightBeforeCm: angka(f.heightBeforeCm), heightCompressedCm: angka(f.heightCompressedCm), testerWeightKg: angka(f.testerWeightKg), foundationIssues: [], note: opt(f.note) };
    case 9: return { note: opt(f.note) };
    case 11: return {
      ...(opsi.cornerV2 ? { cornerWork: (f.cornerWork ?? "").trim(), noDifference: !!f.noDifference, differenceNote: f.noDifference ? undefined : opt(f.differenceNote) } : {}),
      checklist: Object.fromEntries(CHECKLIST_CORNER.map((c) => [c.key, !!f.checklist?.[c.key]])),
      note: opt(f.note),
    };
    case 12: return { confirm: !!f.confirm, note: opt(f.note) };
    default: return {};
  }
}

/**
 * Giliran saya? Aksi tampil hanya bila `next` milik lane yang saya pegang DAN (saya PIC rencana itu ATAU boleh
 * menjalankan semua PIC). Server tetap menolak bila tidak berhak — ini hanya supaya tidak ada tombol yang pasti 403.
 */
export function giliranSaya(card: Pick<RunCard, "next" | "plan">, userId: string | null | undefined, caps: { lane: boolean; executeAny: boolean }): "TABLE" | "CORNER" | null {
  const n = card.next;
  if (!caps.lane || !n || n.action === "WAIT" || !n.action || (n.actor !== "TABLE" && n.actor !== "CORNER")) return null;
  if (caps.executeAny) return n.actor;
  const pic = n.actor === "CORNER" ? card.plan?.cornerOperator?.userId : card.plan?.operator?.userId;
  return pic && pic === userId ? n.actor : null;
}

/** Kunci idempotensi per NIAT (run + tahap + revisi): coba lagi setelah galat jaringan memakai kunci yang sama. */
export function buatKunciNiat(baru: () => string) {
  const m = new Map<string, string>();
  return {
    untuk(runId: string, stepNo: number | string, revision: number) {
      const k = `${runId}:${stepNo}:${revision}`;
      if (!m.has(k)) m.set(k, `pm-${stepNo}-${baru()}`.slice(0, 110));
      return m.get(k)!;
    },
    lepas(runId: string, stepNo: number | string, revision: number) { m.delete(`${runId}:${stepNo}:${revision}`); },
  };
}

/** Galat jaringan/server sementara → kunci dipertahankan untuk Coba Lagi; galat final → kunci dilepas. */
export const bolehCobaLagi = (e: unknown) => {
  const s = (e as { status?: number })?.status;
  return !s || (s >= 500 && s !== 503);
};
