import { useQueries, useQuery } from "@tanstack/react-query";
import { api, useSession } from "@/auth/session";
import { mingguIniWib } from "@/lib/waktu";
import type { AndonBoard, ProductionReport, RunCard, RunView, V1Queue, WorkerQueue } from "./types";

// BACAAN PRODUKSI — semua endpoint SUDAH ADA dan dipakai versi web (WorkerLane, ProductionAndon, laporan).
// "Live": diambil ulang tiap 20 detik saat aplikasi di depan (sama dengan Andon TV web) + tarik-untuk-muat-ulang.
// TIDAK ada mutasi di berkas ini.

export const LIVE_MS = 20_000;

export type Lane = "table" | "corner";

export function useWorkerQueue(lane: Lane, enabled = true) {
  return useQuery({
    queryKey: ["worker", lane],
    queryFn: () => api.get<WorkerQueue>(`/production-v2/worker/${lane}`),
    refetchInterval: LIVE_MS,
    enabled,
  });
}

/** Antrean V1 (unit warisan di luar cohort V2). Gagal tidak menjatuhkan antrean V2 — layar menampilkannya terpisah. */
export function useV1Queue(lane: Lane, enabled = true) {
  return useQuery({
    queryKey: ["v1", lane],
    queryFn: () => api.get<V1Queue>("/production/v1-worker-queue", { query: { lane: lane === "corner" ? "CORNER" : "TABLE" } }),
    refetchInterval: LIVE_MS,
    enabled,
  });
}

export function useAndon(date?: string | null) {
  return useQuery({
    queryKey: ["andon", date ?? "hari-ini"],
    queryFn: () => api.get<AndonBoard>("/production-v2/andon", { query: { date: date ?? undefined } }),
    refetchInterval: LIVE_MS,
  });
}

/**
 * "Minggu ini" di kartu Beranda (mockup): jumlah selesai / terjadwal Senin–Minggu (WIB), dijumlah dari papan per tanggal
 * (endpoint yang SAMA dengan Target & Andon). Bukan live: disegarkan tiap 10 menit — angka hari ini yang live ada di cincin.
 */
export function useMingguIni(enabled = true) {
  const hari = mingguIniWib();
  const q = useQueries({
    queries: hari.map((date) => ({
      queryKey: ["andon", "minggu", date],
      queryFn: () => api.get<AndonBoard>("/production-v2/andon", { query: { date } }),
      staleTime: 10 * 60_000,
      enabled,
    })),
  });
  const siap = enabled && q.every((x) => x.data);
  const selesai = q.reduce((n, x) => n + (x.data?.kpi?.completed ?? 0), 0);
  const terjadwal = q.reduce((n, x) => n + (x.data?.kpi?.planned ?? 0), 0);
  return { siap, selesai, terjadwal };
}

export function useRunCard(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["card", runId],
    queryFn: () => api.get<RunCard>(`/production-v2/runs/${runId}/card`),
    enabled: !!runId,
    refetchInterval: LIVE_MS,
  });
}

export function useReport(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["report", runId],
    queryFn: () => api.get<ProductionReport>(`/production-v2/runs/${runId}/report`),
    enabled: !!runId,
    // Media bertanda tangan kedaluwarsa; ambil ulang berkala supaya URL tetap sah.
    refetchInterval: 5 * 60_000,
  });
}

/** Tab & lane yang dipakai pengguna ini, dari capability server (bukan dari nama peran). */
export function useLayout() {
  const caps = useSession((s) => s.capabilities);
  const p = caps?.production;
  const preset = caps?.productionPreset ?? "NONE";
  return {
    preset,
    admin: !!p?.plan,
    lane: !!p?.lane,
    qc: !!p?.qc,
    docs: !!p?.docs,
    executeAny: !!p?.executeAny,
  };
}

/** Papan rencana per tanggal (GET /production-v2/board) — kartu lengkap dengan plan.id, dipakai Target untuk mengatur urutan. */
export type BoardStation = { code: string; label: string; operatorNames: string[]; items: RunView[] };
export function useBoard(date: string) {
  return useQuery({
    queryKey: ["board", date],
    queryFn: () => api.get<{ readerMode: string; date?: string; stations?: BoardStation[] }>("/production-v2/board", { query: { date } }),
    refetchInterval: LIVE_MS,
  });
}

/** Simpan urutan SATU meja: daftar LENGKAP plan id menurut urutan baru (server 409 STATION_ORDER_STALE bila isi meja berubah). */
export function simpanUrutan(productionDate: string, stationCode: string, orderedPlanIds: string[], kunci: string) {
  return api.command<unknown>("POST", "/production-v2/stations/reorder", kunci, { body: { productionDate, stationCode, orderedPlanIds } });
}
