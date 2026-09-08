import { useQuery } from "@tanstack/react-query";
import { api } from "@/api.js";

// TanStack Query untuk seluruh papan Route Planner (8 September 2026, lihat
// catatan panjang di useArmadaTracking.js soal alasan migrasi). ArmadaRoutes
// SEBELUMNYA memuat 6 fetch paralel (rute, job belum-masuk-rute, job belum
// bertanggal, driver, kendaraan, helper) lewat satu `load()` manual —
// dipertahankan APA ADANYA di sini sebagai SATU queryFn (bukan 6 useQuery
// terpisah): halaman ini butuh SEMUA 6 sekaligus untuk render papan
// (drag-drop job antar rute butuh unrouted+routes bersamaan), memecahnya
// jadi query terpisah cuma menambah kerumitan koordinasi tanpa manfaat nyata
// untuk kasus ini. Filter client-side (buang job COMPLETED/FAILED, buang
// job undated dari daftar draggable) TETAP di sini, PERSIS logic lama —
// lihat komentar asli D-063/D-069 di ArmadaRoutes.jsx untuk alasan tiap
// baris filter, TIDAK diulang di sini supaya tidak ada dua sumber
// penjelasan yang bisa diam-diam beda.
export function useArmadaRoutesBoard(range, toApiParams) {
  return useQuery({
    queryKey: ["armada", "routes-board", toApiParams(range)],
    queryFn: async () => {
      const rangeParams = toApiParams(range);
      const [routesRes, jobsRes, undatedRes, driversRes, vehiclesRes, helpersRes] = await Promise.all([
        api.getRoutes(rangeParams),
        api.getArmadaJobs({ routeId: "none", date: "any", take: 500 }),
        api.getArmadaJobs({ date: "none", routeId: "none" }),
        api.getDrivers(),
        api.getVehicles(),
        api.getHelpers(),
      ]);
      return {
        routes: routesRes.routes,
        unrouted: jobsRes.jobs.filter((j) => j.scheduledDate != null && !["COMPLETED", "FAILED"].includes(j.status)),
        undated: undatedRes.jobs.filter((j) => !["COMPLETED", "FAILED"].includes(j.status)),
        drivers: driversRes,
        vehicles: vehiclesRes.vehicles,
        helpers: helpersRes || [],
      };
    },
  });
}
