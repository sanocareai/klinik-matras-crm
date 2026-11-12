import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { api } from "@/auth/session";
import type { DiagnosaServer, DraftDiagnosa } from "@/features/diagnosa";

// DIAGNOSA (tahap 5) — endpoint yang SAMA dengan wizard web:
//   GET  /production-v2/diagnosis/:runId          { current: DiagnosaServer | null }
//   POST /production-v2/diagnosis/:runId/submit   menulis Planned BOM (+ bahan manual) dalam satu transaksi
// Penutupan tahap 5 memakai catatLangkah (api/aksi.ts) dengan PAYLOAD_TUTUP_TAHAP5.

export function useDiagnosa(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["diagnosa", runId],
    queryFn: () => api.get<{ current: DiagnosaServer | null }>(`/production-v2/diagnosis/${runId}`),
    enabled: !!runId,
    staleTime: Infinity, // formulir panjang: jangan ditimpa polling; dimuat ulang hanya saat dibuka lagi / konflik revisi
  });
}

export function kirimDiagnosa(runId: string, body: unknown, kunci: string) {
  return api.command<unknown>("POST", `/production-v2/diagnosis/${runId}/submit`, kunci, { body });
}

/**
 * Draf diagnosis per unit — di MEMORI aplikasi (bertahan saat layar ditutup/dibuka lagi selama aplikasi hidup).
 * Tidak ada penyimpanan disk di aplikasi ini; bila aplikasi ditutup penuh, isian yang belum dikirim hilang (layar memberi tahu).
 */
export const useDraftDiagnosa = create<{ draf: Record<string, DraftDiagnosa>; simpan: (runId: string, d: DraftDiagnosa) => void; hapus: (runId: string) => void }>((set) => ({
  draf: {},
  simpan: (runId, d) => set((x) => ({ draf: { ...x.draf, [runId]: d } })),
  hapus: (runId) => set((x) => { const n = { ...x.draf }; delete n[runId]; return { draf: n }; }),
}));
