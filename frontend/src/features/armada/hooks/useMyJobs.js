import { useQuery } from "@tanstack/react-query";
import { api } from "@/api.js";

// TanStack Query untuk GET /armada/my-jobs (8 September 2026, lihat catatan
// panjang di useArmadaTracking.js soal alasan migrasi ini). Dipakai HANYA
// oleh DriverJobs.jsx.
//
// "SENGAJA TIDAK menimpa jobs yang sudah ada" (perilaku offline-first lama
// yang WAJIB dipertahankan — driver di lapangan sinyal lemah, error refetch
// tidak boleh mengosongkan layar) DIDAPAT GRATIS dari react-query: `data`
// SECARA BAWAAN tetap berisi hasil sukses TERAKHIR sampai refetch berikutnya
// benar-benar berhasil — beda dari pola manual lama yang butuh guard
// `if (!jobs) setError(...)` eksplisit. `error` object react-query TETAP
// terisi terpisah kalau refetch gagal, pemanggil (DriverJobs.jsx) yang
// putuskan mau tampilkan atau tidak berdasarkan ada/tidaknya `data`.
// refetchInterval 30s (12 September 2026, BUG lintas-klien: admin
// menyelesaikan job lewat web [JobDetailDrawer, Input Manual proof of
// delivery], driver yang buka DriverJobs.jsx di tab/HP LAIN tidak
// pernah tahu kecuali reload manual — refetchOnWindowFocus bawaan
// react-query cuma menolong kalau tab-nya sempat kehilangan lalu
// mendapat kembali fokus, bukan kalau tab dibiarkan terbuka terus.
// Sama pola dgn driver-mobile/src/hooks/useMyJobs.js (RN, gerbang
// sinkronnya beda — focusManager+AppState, lihat App.js) supaya app dan
// web PWA driver sama-sama tidak pernah "menempel" job yang sudah
// tuntas dari sisi lain.
export function useMyJobs() {
  return useQuery({
    queryKey: ["armada", "my-jobs"],
    queryFn: async () => (await api.getMyJobs()).jobs,
    refetchInterval: 30_000,
  });
}
