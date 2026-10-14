// DRY-RUN RELASI PEMBELI PENJUALAN KARYAWAN — BACA-SAJA (hanya SELECT; tidak ada create/update/delete).
//   docker compose exec -T backend node scripts/pkr-pembeli-dry-run.js [--limit 2000]
// Keluaran JSON: order PKR yang MASIH menunjuk profil internal karyawan penjual (legacy), snapshot nama pembeli di PKR, data apa yang tersedia (alamat/kota/Maps/keluhan)
// dan apa yang masih kosong (nomor telepon TIDAK ada di data lama dan TIDAK ditebak). Tidak ada backfill otomatis: Admin melengkapi per order lewat UI
// ("Lengkapi Data Customer"), yang memindahkan order ke Customer aktual tanpa mengubah PKR, unit, job, pembayaran, atau jurnal.
import { prisma } from "../src/db.js";
import { dryRunPembeliLegacy } from "../src/services/penjualanKaryawanPembeliKoreksi.js";

const i = process.argv.indexOf("--limit");
const batas = i > 0 ? Math.min(Math.max(parseInt(process.argv[i + 1], 10) || 2000, 1), 5000) : 2000;
try {
  const hasil = await dryRunPembeliLegacy(prisma, { batas });
  console.log(JSON.stringify(hasil, null, 2));
} finally {
  await prisma.$disconnect();
}
