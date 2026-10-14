// Urutan pencarian akun saat login.
//
// Akun BARU selalu disimpan sebagai trim+huruf-kecil (routes/users.js), tetapi
// login dulu mencari persis seperti diketik: "Nama@klinikmatras.com" tidak
// menemukan "nama@klinikmatras.com" dan dijawab "Email atau password salah"
// walau passwordnya benar. Pencarian lama (persis seperti diketik) TETAP
// dicoba lebih dulu — akun lama yang emailnya berhuruf besar, bila ada, tidak
// berubah perilakunya — baru bentuk baku sebagai cadangan.
export function kandidatEmailLogin(email) {
  if (typeof email !== "string") return [];
  const trimmed = email.trim();
  if (!trimmed) return [];
  const unik = [];
  for (const kandidat of [email, trimmed, trimmed.toLowerCase()]) {
    if (kandidat && !unik.includes(kandidat)) unik.push(kandidat);
  }
  return unik;
}

/** Cari akun menurut kandidat di atas; kembalikan record pertama yang cocok atau null. */
export async function cariUserUntukLogin(prisma, email) {
  for (const kandidat of kandidatEmailLogin(email)) {
    const user = await prisma.user.findUnique({ where: { email: kandidat } });
    if (user) return user;
  }
  return null;
}
