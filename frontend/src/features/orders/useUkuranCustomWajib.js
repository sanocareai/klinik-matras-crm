import { useQuery } from "@tanstack/react-query";
import { api } from "@/api.js";

// Tanggal mulai penegakan Lebar/Panjang Ukuran Custom (ISO) dari pengaturan server, atau null (MATI — default). Dipakai kesiapan order BARU.
// Gagal-aman: bila tidak terbaca → null (tidak menahan order mana pun).
export function useUkuranCustomWajibSejak() {
  const { data } = useQuery({ queryKey: ["order-options"], queryFn: () => api.getOrderOptions(), staleTime: 5 * 60_000, retry: false });
  return data?.ukuranCustomWajibSejak ?? null;
}
