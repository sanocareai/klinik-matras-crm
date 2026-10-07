// Cek idempotensi webhook untuk pesan WA: apakah pesan ini SUDAH tersimpan?
//
// Bug 7 Okt 2026 (ratusan baris kembar per hari sejak pertengahan September): pesan yang dikirim dari CRM disimpan dengan externalId
// "true_<nomor>@c.us_<ID>", lalu WAHA menggemakannya dengan "true_<lid>@lid_<ID>". Pencocokan exact (findUnique) gagal → gema tersimpan
// sebagai baris KEDUA (tanpa pengirim, centang macet di jam). Bagian yang stabil hanya ID pesan di tengah (lihat utils/idPesanWa.js).
//
// Exact match dicoba dulu (index unik, cepat). Pencocokan lewat ID inti HANYA untuk pesan keluar (fromMe) dan hanya terhadap pesan keluar,
// serta ID minimal 16 karakter — ID pendek terlalu berisiko cocok ke pesan lain, dan akibat salah cocok = pesan sungguhan dibuang.
import { idPesanInti } from "./idPesanWa.js";

export const PANJANG_MIN_ID_INTI = 16;

export async function cariPesanSudahAda(prismaClient, externalId, { fromMe = false } = {}) {
  if (!externalId) return null;
  const persis = await prismaClient.message.findUnique({ where: { externalId } });
  if (persis || !fromMe) return persis;
  const inti = idPesanInti(externalId);
  if (!inti || inti.length < PANJANG_MIN_ID_INTI) return null;
  return prismaClient.message.findFirst({ where: { externalId: { contains: inti }, direction: "OUTBOUND" } });
}
