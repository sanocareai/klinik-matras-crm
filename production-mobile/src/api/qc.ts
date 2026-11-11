import { useQuery } from "@tanstack/react-query";
import { api } from "@/auth/session";
import { LIVE_MS } from "./production";
import type { ProfilQc, TahapRun } from "@/features/qc";

// QC PRODUKSI V2 — endpoint yang SAMA dengan Hub QC / Aplikasi PIC QC web:
//   GET  /production-planning/qc/queue?tab=AWAITING_QC
//   GET  /production-planning/qc/runs/:runId
//   GET  /production-v2/component-notes/units/:unitId   (assembly → gerbang Lulus)
//   POST /units/:unitId/photos  (multipart "photos")  → { urls }
//   POST /production-planning/qc/runs/:runId/inspect  (Idempotency-Key)

export type QcItem = {
  runId: string; revision: number; state: string;
  unit: { id: string; unitCode: string; status: string; orderNumber: string | null; category: string | null };
  conflict: unknown | null;
};
export type QcRun = {
  revision: number; state: string; track: "BUILD" | "RESTORATION"; qcProfile?: ProfilQc;
  unit: { id: string; unitCode: string; status: string };
  stages: TahapRun[];
  conflict: unknown | null;
};

export function useQcQueue(enabled = true) {
  return useQuery({
    queryKey: ["qc", "queue"],
    queryFn: () => api.get<{ items: QcItem[]; readerMode: string }>("/production-planning/qc/queue", { query: { tab: "AWAITING_QC" } }),
    refetchInterval: LIVE_MS,
    enabled,
  });
}

export function useQcRun(runId: string | null | undefined) {
  return useQuery({ queryKey: ["qc", "run", runId], queryFn: () => api.get<QcRun>(`/production-planning/qc/runs/${runId}`), enabled: !!runId });
}

export function useAssembly(unitId: string | null | undefined) {
  return useQuery({
    queryKey: ["catatan-komponen", unitId],
    queryFn: () => api.get<{ assembly?: unknown }>(`/production-v2/component-notes/units/${unitId}`),
    enabled: !!unitId,
  });
}

export function simpanPutusanQc(runId: string, body: Record<string, unknown>, kunci: string) {
  return api.command<unknown>("POST", `/production-planning/qc/runs/${runId}/inspect`, kunci, { body });
}

/** Foto bukti QC (foto saja) ke penyimpanan foto unit. */
export async function unggahFotoUnit(unitId: string, uri: string, mimeType?: string | null): Promise<string> {
  const type = mimeType && /^image\/(jpeg|png|webp)$/.test(mimeType) ? mimeType : "image/jpeg";
  const fd = new FormData();
  fd.append("photos", { uri, name: `qc.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`, type } as unknown as Blob);
  const r = await api.upload<{ urls: string[] }>(`/units/${unitId}/photos`, fd);
  const url = r?.urls?.[0];
  if (!url) throw new Error("Server tidak mengembalikan foto");
  return url;
}
