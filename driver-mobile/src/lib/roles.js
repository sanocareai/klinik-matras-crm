// Routing berdasar role (10 Sep 2026, permintaan owner: "tambahkan
// tampilan untuk login admin"). `user.roles` (array, dari POST /auth/login
// — SAMA field yang dipakai web utk portalsFor()) menentukan layar mana
// yang jadi "beranda" begitu login, BUKAN dua app terpisah.
//
// ADMIN/DISPATCHER (job:read penuh, lihat SEMUA driver) -> AdminHomeScreen.
// DRIVER/HELPER/LEADER_DRIVER (job:own, kerja lapangan sendiri) ->
// JobListScreen. LEADER_DRIVER SENGAJA masuk kelompok driver (dia bisa
// jadi driver aktif sendiri, lihat komentar Role enum backend) — kalau
// nanti perlu lihat dashboard admin juga, itu keputusan terpisah.
const ADMIN_ROLES = ["ADMIN", "DISPATCHER"];
const DRIVER_ROLES = ["DRIVER", "HELPER", "LEADER_DRIVER"];

function rolesOf(user) {
  if (Array.isArray(user?.roles) && user.roles.length > 0) return user.roles;
  return user?.role ? [user.role] : [];
}

export function isAdminView(user) {
  return rolesOf(user).some((r) => ADMIN_ROLES.includes(r));
}

export function isDriverView(user) {
  return rolesOf(user).some((r) => DRIVER_ROLES.includes(r));
}

// Tanggal "hari ini" WIB — SAMA formula dengan default GET /armada/my-jobs
// di backend (Date.now() + 7 jam, ambil tanggalnya) — kontainer backend
// jalan UTC, browser/HP pengguna bisa zona apa saja, jadi dihitung manual
// alih-alih new Date().toISOString() polos.
export function todayWIB() {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}
