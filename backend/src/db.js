import { PrismaClient } from "@prisma/client";

// Satu instance Prisma dipakai di seluruh aplikasi (best practice)
//
// transactionOptions (24 Sep 2026): bawaan Prisma untuk $transaction interaktif hanya menunggu 2 detik
// (maxWait) untuk MENDAPATKAN koneksi lalu memberi waktu 5 detik (timeout) untuk seluruh transaksi.
// Saat server/DB sibuk (deploy, backup, banyak permintaan paralel) batas itu terlampaui dan Prisma melempar
// P2028 "Unable to start a transaction in the given time" — transaksi keuangan yang SAH gagal, dan sebagian
// rute memetakannya jadi 409 "sedang diproses di perangkat lain" (menyesatkan). Terbukti dengan mereproduksi
// tes idempotensi insentif di bawah beban CPU: pemenang balapan gagal memulai transaksi, dua lainnya kena
// IDEMPOTENCY_IN_PROGRESS -> [409, 409, 409]. Menunggu lebih lama (bukan gagal cepat) adalah perilaku yang
// benar untuk transaksi uang; lock baris tetap menjamin tidak ada pemrosesan ganda.
export const prisma = new PrismaClient({
  transactionOptions: { maxWait: 15_000, timeout: 30_000 },
});
