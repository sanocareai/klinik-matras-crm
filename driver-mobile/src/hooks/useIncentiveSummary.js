// Insentif per ALAMAT selesai per driver/helper — AdminHomeScreen tab
// Performa (13 September 2026, D-162 — GANTI dari useRouteIncentiveSummary/
// "per jalur", cara Klinik Matras SUNGGUHAN menghitung insentif adalah per
// alamat: "1 pelanggan, lokasi sama, tanggal sama, ambil dan kirim hingga
// finish = dihitung 1, tapi kalau pelanggan yang sama order lagi di lain
// hari tetap dihitung lagi"). from/to dari preset (Minggu Ini/Bulan Ini/
// Bulan Lalu) yang dihitung AdminHomeScreen — hook ini murni pemanggil
// endpoint.
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export function useIncentiveSummary(from, to) {
  return useQuery({
    queryKey: ["admin", "incentive-summary", from, to],
    queryFn: () => api.getIncentiveSummary(from, to),
  });
}
