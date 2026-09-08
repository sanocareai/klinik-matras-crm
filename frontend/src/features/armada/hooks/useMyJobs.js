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
export function useMyJobs() {
  return useQuery({
    queryKey: ["armada", "my-jobs"],
    queryFn: async () => (await api.getMyJobs()).jobs,
  });
}
