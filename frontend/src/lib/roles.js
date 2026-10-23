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

// Peran yang BOLEH mencatat pemakaian bahan (izin unit:material:write) — cermin backend (constants/permissions.js ROLE_PERMISSIONS). Hanya untuk LABEL tombol di daftar ("Catat bahan" vs "Lihat bahan");
// penegak tetap server (403). Dijaga tes frontend/tests/bahanDrawerRilis.test.js: daftar ini HARUS sama dengan peran ber-izin di backend.
export const PERAN_CATAT_BAHAN = Object.freeze(["ADMIN", "OWNER", "PRODUCTION_WORKER", "PRODUCTION_LEAD", "WAREHOUSE"]);
export const bisaCatatBahan = (user) => rolesOf(user).some((r) => PERAN_CATAT_BAHAN.includes(r));

export function isAdminUser(user) {
  return rolesOf(user).includes("ADMIN");
}
