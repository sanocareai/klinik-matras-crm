import { useQuery } from "@tanstack/react-query";
import { api } from "@/api.js";
import { ACTIVE_STATUSES } from "@/features/armada/jobStatus.js";

// TanStack Query untuk GET /armada/jobs (Jadwal & Penugasan) — 8 September
// 2026, lihat catatan panjang di useArmadaTracking.js soal alasan migrasi.
// Semua parameter filter (search, rentang tanggal, status job/order, driver,
// tab tipe) masuk ke `queryKey` — react-query otomatis fetch ulang HANYA
// kalau salah satu berubah, dan cache tiap kombinasi filter terpisah (balik
// ke filter yang SAMA sebelumnya tampil instan dari cache).
//
// Filter tab "active" (gabungan beberapa status job) TETAP disaring di
// klien di dalam queryFn — backend cuma terima SATU status per permintaan,
// sama seperti versi lama. ACTIVE_STATUSES di-import (satu sumber
// kebenaran), bukan disalin ulang di sini.

export function useArmadaJobs({ enabled = true, debounced, range, fStatus, fOrderStatus, fDriver, tab, toApiParams, fHasConfirmedDate, sortBy }) {
  return useQuery({
    queryKey: ["armada", "jobs", { debounced, range, fStatus, fOrderStatus, fDriver, tab, fHasConfirmedDate, sortBy }],
    queryFn: async () => {
      const params = {
        q: debounced || undefined,
        ...toApiParams(range),
        status: fStatus || undefined,
        orderStatus: fOrderStatus || undefined,
        driverId: fDriver || undefined,
        // Filter+sort tanggal PASTI (9 September 2026) — lihat catatan
        // panjang di routes/armada.js GET /jobs.
        hasConfirmedDate: fHasConfirmedDate ? "true" : undefined,
        sortBy: sortBy || undefined,
      };
      if (tab === "PICKUP" || tab === "DELIVERY") params.type = tab;
      if (tab === "COMPLETED") params.status = "COMPLETED";

      const res = await api.getArmadaJobs(params);
      let list = res.jobs || [];
      if (tab === "active") list = list.filter((j) => ACTIVE_STATUSES.includes(j.status));
      return list;
    },
    enabled,
    // refetchInterval 30s (12 September 2026) — dispatcher yang membuka
    // Jadwal & Penugasan dan cuma MENGAMATI (tanpa klik apa pun) tidak
    // pernah lihat perubahan yang dibuat driver via app (mis. tandai
    // Selesai) sampai reload manual. Halaman ini TIDAK punya drag-drop
    // (itu di Route Planner/useArmadaRoutesBoard.js, dijaga terpisah
    // karena poll di tengah drag bisa mengacaukan state-nya) — aman
    // polling tanpa syarat tambahan.
    refetchInterval: 30_000,
  });
}
