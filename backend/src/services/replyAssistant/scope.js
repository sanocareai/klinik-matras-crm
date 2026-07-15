// ─── WAVE 4B.0 — ROLE SCOPING (PURE) ────────────────────────────────────────
// Aturan sama persis dengan GET /customers/:id/intelligence (Wave 4A):
// ADMIN → semua; SALES → hanya miliknya ATAU yang belum di-assign (claimable).
export function canAccessCustomer(customer, user) {
  if (!customer || !user) return false;
  if (user.role === "ADMIN") return true;
  return !customer.assignedSalesId || customer.assignedSalesId === user.id;
}
