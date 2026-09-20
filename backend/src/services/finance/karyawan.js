// DAFTAR KARYAWAN SANO untuk Kasbon (uang muka gaji). Sumber satu-satunya: tabel User (akun sistem), bukan riwayat nama kasbon.
//
// Karyawan = akun AKTIF, kecuali:
//   • akun bersama "OWNER (Admin)" (admin@klinikmatras.com) — bukan orang, tidak menerima kasbon;
//   • "Kurir Eksternal (Lalamove/dst)" — vendor/kurir luar, bukan karyawan;
//   • akun yang sudah dinonaktifkan (mis. Farhan, Mila, Andes).
// Semua peran lain (Sales, Driver, Helper, Produksi/QC, Admin, dan pemilik yang juga karyawan seperti Gilang/Juri/Kemal) masuk.
// Aturan dipisah di sini supaya daftar pilihan (UI) dan penjaga server memakai definisi yang sama.

const EMAIL_AKUN_BERSAMA = new Set(["admin@klinikmatras.com"]);
const POLA_NAMA_BUKAN_KARYAWAN = [/^owner\b/i, /kurir\s+eksternal/i];
const POLA_EMAIL_BUKAN_KARYAWAN = [/^kurir\.eksternal@/i];

/** Alasan sebuah akun BUKAN karyawan untuk kasbon (null = boleh). */
export function alasanBukanKaryawan(u) {
  if (!u?.active) return "akunnya sudah dinonaktifkan";
  const email = String(u.email || "").toLowerCase();
  if (EMAIL_AKUN_BERSAMA.has(email)) return "akun bersama owner, bukan karyawan";
  if (POLA_EMAIL_BUKAN_KARYAWAN.some((p) => p.test(email))) return "kurir eksternal, bukan karyawan";
  if (POLA_NAMA_BUKAN_KARYAWAN.some((p) => p.test(String(u.name || "")))) return "bukan karyawan Sano (akun owner/kurir eksternal)";
  return null;
}

export const layakKaryawan = (u) => alasanBukanKaryawan(u) === null;

/** Pilihan karyawan untuk form kasbon: [{ id, name, roles }] urut abjad. */
export async function daftarKaryawanKasbon(db) {
  const users = await db.user.findMany({
    where: { active: true },
    select: { id: true, name: true, email: true, active: true, role: true, roles: { select: { role: true } } },
  });
  return users
    .filter(layakKaryawan)
    .map((u) => ({ id: u.id, name: u.name, roles: [...new Set([u.role, ...u.roles.map((r) => r.role)])] }))
    .sort((a, b) => a.name.localeCompare(b.name, "id"));
}

/**
 * Penjaga server: menolak nama yang JELAS bukan karyawan (akun nonaktif, akun owner, kurir eksternal). Nama yang tidak punya akun sama
 * sekali tidak ditolak di sini (mis. karyawan baru yang belum dibuatkan akun) — pilihan di UI-lah yang membatasi ke daftar resmi.
 */
export async function pastikanBolehMenerimaKasbon(db, nama, err) {
  const cocok = await db.user.findMany({
    where: { name: { equals: nama, mode: "insensitive" } },
    select: { name: true, email: true, active: true },
  });
  if (cocok.length > 0) {
    if (cocok.some(layakKaryawan)) return;
    throw err(`Kasbon tidak bisa diberikan ke ${nama}: ${alasanBukanKaryawan(cocok[0])}.`, 400);
  }
  if (POLA_NAMA_BUKAN_KARYAWAN.some((p) => p.test(nama))) throw err(`Kasbon tidak bisa diberikan ke ${nama}: bukan karyawan Sano.`, 400);
}
