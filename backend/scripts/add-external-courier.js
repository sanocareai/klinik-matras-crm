// AKUN KURIR EKSTERNAL (Lalamove/dst) — 6 September 2026, laporan owner.
//
// LATAR BELAKANG: 1 rute Klinik Matras (7-10 stop) selalu dipegang PIC
// tetap, hampir tidak pernah ganti driver di tengah jalan — KECUALI kasus
// darurat (mis. kecelakaan), di mana sisa stop yang belum terkirim
// dialihkan ke driver lain ATAU kurir pihak ketiga (Lalamove). Sistem cuma
// bisa assign driver dari akun User internal (Job.driverId/Route.driverId
// adalah FK ke User) — Lalamove bukan staf, tidak punya akun.
//
// KEPUTUSAN (dikonfirmasi owner, bukan diputuskan sepihak): daripada bikin
// model data terpisah untuk kurir eksternal, buat SATU akun placeholder
// yang diperlakukan sistem PERSIS seperti driver biasa — supaya seluruh
// mekanisme assignment/riwayat/laporan yang sudah ada langsung jalan tanpa
// kode baru. Konsekuensinya: kurir Lalamove TIDAK login sendiri ke app,
// dispatcher yang update status job atas nama akun ini (pola SAMA dengan
// "admin boleh operasikan atas nama driver" yang sudah ada di
// loadOwnedJob(), armada.js).
//
// PEMAKAIAN (dry-run dulu, JANGAN langsung --apply):
//   docker compose exec backend node scripts/add-external-courier.js
//   docker compose exec backend node scripts/add-external-courier.js --apply
//
// IDEMPOTEN — upsert berdasarkan User.email, aman dijalankan berkali-kali.
// TIDAK menyentuh data lain.

import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const APPLY = process.argv.includes("--apply");

const EMAIL = "kurir.eksternal@klinikmatras.com";
const NAMA = "Kurir Eksternal (Lalamove/dst)";
// Password sama dengan konvensi akun staf lain (CLAUDE.md §1) — akun ini
// dipegang/dioperasikan DISPATCHER, bukan dibagikan ke kurir Lalamove
// sungguhan, jadi tidak perlu password unik.
const PASSWORD = "kasursehat1";

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: EMAIL } });

  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "DRY-RUN (cuma pratinjau, tidak menulis apa pun)"}`);
  console.log(existing ? `Akun sudah ada (id: ${existing.id}) — akan dipastikan role DRIVER-nya, bukan dibuat ulang.` : "Akun belum ada — akan dibuat baru.");

  if (!APPLY) {
    console.log("\nJalankan ulang dengan --apply untuk benar-benar menulis.");
    return;
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // isExternalCourier (13 September 2026, D-161) — ditambahkan belakangan
  // supaya UI (badge, field ongkos Lalamove, laporan biaya) bisa mengenali
  // akun ini tanpa menebak dari nama/email. Idempoten, upsert existing juga
  // ikut disetel true kalau skrip ini dijalankan ulang di akun yang sudah ada.
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { name: NAMA, active: true, isExternalCourier: true },
    create: { email: EMAIL, name: NAMA, passwordHash, role: "DRIVER", active: true, isExternalCourier: true },
  });

  // UserRole DRIVER — ini yang benar-benar dibaca GET /armada/drivers
  // (query userRole.findMany({ where: { role: "DRIVER" } }), BUKAN
  // User.role legacy). Upsert lewat unique [userId, role].
  await prisma.userRole.upsert({
    where: { userId_role: { userId: user.id, role: "DRIVER" } },
    update: {},
    create: { userId: user.id, role: "DRIVER" },
  });

  console.log(`\nSelesai. "${NAMA}" (${EMAIL}) sekarang muncul di dropdown Driver Route Planner/Jadwal & Penugasan.`);
}

main()
  .catch((err) => {
    console.error("Gagal:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
