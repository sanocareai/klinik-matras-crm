// Port dari frontend/src/features/armada/hooks/useMyJobs.js (pola
// TanStack Query yang sudah jadi standar rumah, staleTime 30s konsisten
// dengan queryClient.js). GET /armada/my-jobs SUDAH ADA di backend, nol
// endpoint baru.
//
// refetchInterval 30s (12 September 2026, BUG laporan owner: "gue buka
// akun alwan... di web job sudah selesai, tapi di apps akun alwan masih
// ada job yang udah selesai") — AKAR MASALAH: hook ini SEBELUMNYA tidak
// polling sama sekali, jadi begitu JobListScreen mount sekali, data
// TIDAK PERNAH refresh lagi kecuali driver sendiri melakukan aksi
// (onChanged→refetch()) atau tarik-turun manual. Kalau job diselesaikan
// dari SISI LAIN (admin input manual proof of delivery lewat web —
// dipakai selama driver belum trial app, lihat JobDetailDrawer.jsx
// simpanBuktiManual) TIDAK ADA yang memicu refetch di app, jadi kartu
// job "menempel" seolah masih aktif walau backend sudah COMPLETED.
// Interval 30s SAMA dengan pola polling lain yang sudah ada di app ini
// (useAdminToday.js) — bukan angka baru yang dikarang.
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

// Query key DIBUBUHI userId (22 September 2026, audit "cache user A tidak
// boleh muncul di user B") — SEBELUM INI key-nya cuma ["armada","my-jobs"],
// SAMA untuk siapa pun yang login. Kalau HP dipakai bergantian 2 driver
// tanpa restart app penuh di antaranya (logout lalu login akun lain), react
// query BISA menampilkan cache job driver LAMA sepersekian detik sebelum
// refetch selesai — key per-user menghapus kemungkinan itu sama sekali
// (ganti user = ganti key = query dianggap "belum pernah ada", bukan stale
// data user lain). Dipasangkan dengan queryClient.clear() di
// AuthContext.js logout()/login() sebagai lapis pertahanan kedua.
export function useMyJobs() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["armada", "my-jobs", user?.id],
    // Backend GET /armada/my-jobs balikin { jobs: [...], routes: [...] }
    // (22 September 2026, `routes` = snapshot per rute: stopCount,
    // revision, dst — dipakai diagnostics Akun & kartu "Mulai Perjalanan"
    // supaya SEMUA angka berasal dari array `jobs` yang sama, bukan
    // dihitung ulang terpisah). Kembalikan objek UTUH (bukan unwrap .jobs
    // seperti sebelumnya) — JobListScreen yang memilah.
    queryFn: () => api.getMyJobs(),
    enabled: !!user?.id,
    refetchInterval: 30_000,
  });
}
