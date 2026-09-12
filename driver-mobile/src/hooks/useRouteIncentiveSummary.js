// Ringkasan jalur (rute Selesai) per driver/helper — AdminHomeScreen tab
// Performa (12 Sep 2026, permintaan owner: "insentif sistem kita
// menghitung nya per jalur ... boleh ada status masing-masing driver/
// helper ada status sudah berapa jalur mereka ... bisa disetting
// tanggal"). from/to dari preset (Minggu Ini/Bulan Ini/Bulan Lalu) yang
// dihitung AdminHomeScreen — hook ini murni pemanggil endpoint.
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export function useRouteIncentiveSummary(from, to) {
  return useQuery({
    queryKey: ["admin", "route-incentive-summary", from, to],
    queryFn: () => api.getRouteIncentiveSummary(from, to),
  });
}
