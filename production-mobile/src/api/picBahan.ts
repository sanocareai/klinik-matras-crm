import { useQuery } from "@tanstack/react-query";
import { api } from "@/auth/session";
import type { WorkerQueue } from "./types";
import { LIVE_MS } from "./production";

// PIC BAHAN & PENGERJAAN PESANAN — endpoint yang SAMA dengan Aplikasi PIC Bahan & Unit 360 web (backend/src/routes/productionExperience.js):
//   GET  /production-v2/worker/material                 antrean PIC Bahan (pekerjaan yang PIC Bahan-nya = saya; Admin/Owner: semua)
//   POST /production-v2/runs/:runId/build/materials      { expectedRevision (run), racikan?, materials: [{materialId, qty}], note? }
//        → 200 tercatat, atau 202 { menungguVerifikasi } = PENGAJUAN (stok & HPP berubah sesudah verifikasi ADMIN)
//   POST /production-v2/runs/:runId/build/plan-bom       { expectedRevision (RENCANA), lines: [{materialId, qty}] }
//   POST /production-v2/runs/:runId/build/rework-material { expectedRevision (run), lines: [{materialId, qty}] }
//   POST /production-v2/runs/:runId/build/material-operator { expectedRevision (run), operatorId | null }   (Lead/Admin/Owner)
//   POST /production-v2/runs/:runId/build/corner         { expectedRevision (run), required, reason? }     (Lead/Admin/Owner)
//   GET  /production/pengajuan-pemakaian?runId=          pemakaian yang sudah dilaporkan tetapi belum diverifikasi ADMIN
// Tidak ada yang menulis stok: stok keluar hanya saat Gudang menyerahkan bahan.

export function useAntreanBahan(enabled = true) {
  return useQuery({
    queryKey: ["worker", "material"],
    queryFn: () => api.get<WorkerQueue>("/production-v2/worker/material"),
    refetchInterval: LIVE_MS,
    enabled,
  });
}

export type HasilCatatBahan = { menungguVerifikasi?: boolean; changed?: boolean; version?: number; pesan?: string };
export function catatRacikanBahan(runId: string, body: Record<string, unknown>, kunci: string) {
  return api.command<HasilCatatBahan>("POST", `/production-v2/runs/${runId}/build/materials`, kunci, { body });
}

export function simpanRencanaBahan(runId: string, planRevision: number, lines: { materialId: string; qty: number }[], kunci: string) {
  return api.command<unknown>("POST", `/production-v2/runs/${runId}/build/plan-bom`, kunci, { body: { expectedRevision: planRevision, lines } });
}

export function mintaBahanRework(runId: string, revision: number, lines: { materialId: string; qty: number }[], kunci: string) {
  return api.command<unknown>("POST", `/production-v2/runs/${runId}/build/rework-material`, kunci, { body: { expectedRevision: revision, lines } });
}

export function tetapkanPicBahan(runId: string, revision: number, operatorId: string | null, kunci: string) {
  return api.command<{ changed?: boolean }>("POST", `/production-v2/runs/${runId}/build/material-operator`, kunci, { body: { expectedRevision: revision, operatorId } });
}

export function konfirmasiCorner(runId: string, body: Record<string, unknown>, kunci: string) {
  return api.command<{ changed?: boolean }>("POST", `/production-v2/runs/${runId}/build/corner`, kunci, { body });
}

export type PengajuanPemakaian = { id: string; jalur: string; status?: string; ringkasan?: { baris?: { materialId?: string; qty: number; nama?: string; name?: string }[] } };
/** Pemakaian yang sudah dilaporkan (non-ADMIN) tetapi belum diverifikasi — isian dibuka dari situ supaya tidak dilaporkan ulang dari nol. */
export function usePengajuanTertunda(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["pengajuan-pemakaian", runId],
    queryFn: () => api.get<{ pengajuan?: PengajuanPemakaian[] }>("/production/pengajuan-pemakaian", { query: { runId: runId ?? undefined } }),
    enabled: !!runId,
    select: (d) => (d.pengajuan ?? []).find((p) => p.jalur === "RUN_V2") ?? null,
  });
}
