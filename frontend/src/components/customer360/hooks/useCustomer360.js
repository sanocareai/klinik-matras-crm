import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../api.js";

// Data hook Customer 360 — HANYA endpoint yang SUDAH ADA (getCustomer +
// getCustomerConversations). Tidak menyentuh inbox/WAHA/SSE/backend. Tiap query
// punya status sendiri (loading/error) + refetch (retry). `invalidate()` dipakai
// setelah edit (via komponen domain: OrderSection/NotesSection/ProfileFields).
export function useCustomer360(customerId) {
  const qc = useQueryClient();

  const customer = useQuery({
    queryKey: ["customer360", customerId],
    queryFn: () => api.getCustomer(customerId),
    enabled: !!customerId,
    staleTime: 30_000,
  });

  const conversations = useQuery({
    queryKey: ["customer360-convos", customerId],
    queryFn: () => api.getCustomerConversations(customerId),
    enabled: !!customerId,
    staleTime: 30_000,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["customer360", customerId] });
    qc.invalidateQueries({ queryKey: ["customer360-convos", customerId] });
  }

  return { customer, conversations, invalidate };
}
