// Siapa yang boleh menerima transfer percakapan: Sales atau Admin yang AKTIF (aturan sama dengan server, utils/perpindahanPercakapan.js).
// Sebelumnya daftar menampilkan SEMUA akun aktif (Driver, Helper, Produksi, ...) dan server menerima — 2 percakapan pernah ditransfer ke Driver/Helper.
const PERAN_PEGANG = ["SALES", "ADMIN"];
export const rolesPengguna = (u) => (Array.isArray(u?.roles) && u.roles.length ? u.roles : u?.role ? [u.role] : []);
export function bolehMenerimaTransfer(u) {
  return !!u && u.active !== false && rolesPengguna(u).some((r) => PERAN_PEGANG.includes(r));
}
export function labelPeranTransfer(u) {
  return rolesPengguna(u).includes("ADMIN") ? "Admin" : "Sales";
}
