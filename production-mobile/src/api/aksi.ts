import { randomUUID } from "expo-crypto";
import { api } from "@/auth/session";
import { buatKunciNiat, type MediaTerunggah } from "@/features/langkah";

// PERINTAH PRODUKSI — memakai endpoint & kontrak yang SAMA dengan Aplikasi Meja web (backend/src/routes/productionExperience.js):
//   POST /production-v2/runs/:runId/steps/:stepNo   { expectedRevision, workCenterId, payload, media: [url] }
//   POST /production-v2/runs/:runId/delay            { expectedRevision, workCenterId, reason, note }
//   POST /production-v2/units/:unitId/resume-work    { expectedRevision }
//   POST /production-v2/evidence/upload              multipart files[] + runId → { items: [{ url, kind, previewUrl }] }
// Setiap perintah membawa Idempotency-Key per NIAT; server menolak revisi basi (STEP_REVISION_CONFLICT) → layar memuat ulang kartu.

export const kunciNiat = buatKunciNiat(() => randomUUID());

export type KartuRef = { runId: string; revision: number; workCenterId: string | null };

export function catatLangkah(card: KartuRef, stepNo: number, payload: Record<string, unknown>, media: string[], kunci: string) {
  return api.command<unknown>("POST", `/production-v2/runs/${card.runId}/steps/${stepNo}`, kunci, {
    body: { expectedRevision: card.revision, workCenterId: card.workCenterId, payload, media },
  });
}

export function tundaPekerjaan(card: KartuRef, reason: string, note: string, kunci: string) {
  return api.command<unknown>("POST", `/production-v2/runs/${card.runId}/delay`, kunci, {
    body: { expectedRevision: card.revision, workCenterId: card.workCenterId, reason, note: note.trim() || undefined },
  });
}

export function lanjutkanPekerjaan(unitId: string, revision: number, kunci: string) {
  return api.command<unknown>("POST", `/production-v2/units/${unitId}/resume-work`, kunci, { body: { expectedRevision: revision } });
}

export type BerkasLokal = { uri: string; mimeType?: string | null; fileName?: string | null; type?: "image" | "video" | "livePhoto" | "pairedVideo" | null };

const MIME_DIIZINKAN = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "video/quicktime"];

/** Tebak MIME yang diterima server (JPG/PNG/WEBP/MP4/WEBM/MOV) dari aset pemilih. */
export function mimeBerkas(b: BerkasLokal): string {
  if (b.mimeType && MIME_DIIZINKAN.includes(b.mimeType)) return b.mimeType;
  const ext = (b.fileName || b.uri).split("?")[0]!.split(".").pop()?.toLowerCase();
  const peta: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
  if (ext && peta[ext]) return peta[ext];
  return b.type === "video" ? "video/mp4" : "image/jpeg";
}

/** Unggah SATU berkas bukti (foto ≤ 15 MB, video ≤ 80 MB — dibatasi server). */
export async function unggahBukti(runId: string, b: BerkasLokal): Promise<MediaTerunggah> {
  const type = mimeBerkas(b);
  const ext = type.split("/")[1] === "quicktime" ? "mov" : type.split("/")[1] === "jpeg" ? "jpg" : type.split("/")[1];
  const fd = new FormData();
  fd.append("runId", runId);
  // React Native FormData menerima objek berkas { uri, name, type }.
  fd.append("files", { uri: b.uri, name: `bukti.${ext}`, type } as unknown as Blob);
  const r = await api.upload<{ items: MediaTerunggah[] }>("/production-v2/evidence/upload", fd);
  const it = r?.items?.[0];
  if (!it?.url) throw new Error("Server tidak mengembalikan berkas");
  return it;
}
