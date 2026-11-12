import { useQuery } from "@tanstack/react-query";
import { api } from "@/auth/session";
import type { EntriKomponen, KunciBagian, MediaKomponen, RefBahan } from "@/features/komponen";
import { mimeBerkas, type BerkasLokal } from "./aksi";
import { LIVE_MS } from "./production";

// CATATAN KOMPONEN — endpoint yang SAMA dengan panel web (backend/src/routes/productionComponentNotes.js):
//   GET  /production-v2/component-notes/units/:unitId                 bacaan kanonis (seksi terkini + assembly)
//   POST /production-v2/component-notes/units/:unitId/sections/:sec    { expectedVersion, data, media, reason? } + Idempotency-Key
//   POST /production-v2/component-notes/units/:unitId/upload           multipart files[] (foto/video) → { items: [{ url, kind, previewUrl }] }
//   GET  /production-v2/component-notes/materials?q=                   katalog bahan (tautan, tanpa stok)
//   GET  /production-v2/component-notes/qc-queue                       antrean pengujian PIC QC (403 untuk non-QC)
// Bagian pengujian (QC) hanya bisa disimpan pemegang qc:write / eksekusi lintas-lini — server menolak 403 COMPONENT_QC_ONLY.

export type CatatanKomponen = {
  readerMode?: string;
  canWrite?: boolean;
  canWriteQc?: boolean;
  unitCode?: string;
  sections?: Partial<Record<KunciBagian, EntriKomponen | null>>;
  assembly?: unknown;
};

export function useKomponen(unitId: string | null | undefined) {
  return useQuery({
    queryKey: ["catatan-komponen", unitId], // kunci SAMA dengan useAssembly (qc.ts) — satu cache
    queryFn: () => api.get<CatatanKomponen>(`/production-v2/component-notes/units/${unitId}`),
    enabled: !!unitId,
  });
}

export function simpanKomponen(unitId: string, bagian: KunciBagian, body: { expectedVersion: number; data: unknown; media: unknown; reason?: string }, kunci: string) {
  return api.command<unknown>("POST", `/production-v2/component-notes/units/${unitId}/sections/${bagian}`, kunci, { body });
}

export async function unggahMediaKomponen(unitId: string, b: BerkasLokal): Promise<MediaKomponen> {
  const type = mimeBerkas(b);
  const sub = type.split("/")[1];
  const ext = sub === "quicktime" ? "mov" : sub === "jpeg" ? "jpg" : sub;
  const fd = new FormData();
  fd.append("files", { uri: b.uri, name: `komponen.${ext}`, type } as unknown as Blob);
  const r = await api.upload<{ items: { url: string; kind: string; previewUrl: string }[] }>(`/production-v2/component-notes/units/${unitId}/upload`, fd);
  const it = r?.items?.[0];
  if (!it?.url) throw new Error("Server tidak mengembalikan berkas");
  return { url: it.url, previewUrl: it.previewUrl || it.url, kind: it.kind || "image", caption: "" };
}

export type BahanKomponen = Extract<RefBahan, { kind: "CATALOG" }> & { materialId: string; label?: string };
export function cariBahanKomponen(q: string) {
  return api.get<{ items: BahanKomponen[] }>("/production-v2/component-notes/materials", { query: { q } });
}

export type ItemAntreanUji = {
  runId: string; unitId: string; unitCode: string; section: KunciBagian | "QC_DECISION"; wait: string; stepNo: number | null;
  customer: { name: string | null; complaints: string[]; weightKg: number | null };
  station: string | null; merk: string | null; ukuran: string | null;
};
export function useAntreanUji(enabled = true) {
  return useQuery({
    queryKey: ["antrean-uji"],
    queryFn: () => api.get<{ readerMode: string; items: ItemAntreanUji[] }>("/production-v2/component-notes/qc-queue"),
    refetchInterval: LIVE_MS,
    enabled,
  });
}
