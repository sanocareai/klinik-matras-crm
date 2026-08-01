// Helper multi-role (D-010) untuk FRONTEND — cermin dari rolesOf()/isAdmin
// di backend (middleware/authorize.js). JANGAN cek `user.role === "ADMIN"`
// langsung di komponen: itu field LEGACY tunggal, bukan sistem multi-role
// yang sebenarnya berlaku (lihat bug ditemukan QA 1 Agustus 2026 — admin
// yang HANYA dapat role lewat halaman "Pengguna & Peran", bukan field
// legacy, akan salah dianggap bukan admin kalau komponen cek field lama).
export function rolesOf(user) {
  if (!user) return [];
  if (Array.isArray(user.roles) && user.roles.length > 0) return user.roles;
  return user.role ? [user.role] : [];
}

export function isAdminUser(user) {
  return rolesOf(user).includes("ADMIN");
}
