// Sementara — rehearsal staging Tahap 5 (dihapus setelah selesai).
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const dbUrl = process.argv[2];
if (!dbUrl || !dbUrl.includes("staging")) throw new Error("refuse: perlu DATABASE_URL staging sebagai argumen");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const PASSWORD = "Staging-Test-Pass-456!";
const hash = bcrypt.hashSync(PASSWORD, 4);

// Idempoten SUNGGUHAN: rehearsal sebelumnya (mis. skenario revoke) bisa
// meninggalkan baris ini active:false atau perannya tercabut — re-seed
// harus mengembalikannya ke baseline, bukan cuma "buat kalau belum ada".
async function mkUser(name, email, roles, active = true) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    user = await prisma.user.update({ where: { email }, data: { name, passwordHash: hash, role: roles[0], active } });
  } else {
    user = await prisma.user.create({ data: { name, email, passwordHash: hash, role: roles[0], active } });
  }
  await prisma.userRole.deleteMany({ where: { userId: user.id } });
  await prisma.userRole.createMany({ data: roles.map((role) => ({ userId: user.id, role })) });
  return user;
}

const owner = await mkUser("Owner Staging S5", "owner-staging-s5@example.test", ["OWNER"]);
const adminActor = await mkUser("Admin Aktor Staging S5", "admin-actor-staging-s5@example.test", ["ADMIN"]);
const adminTarget = await mkUser("Admin Target Staging S5", "admin-target-staging-s5@example.test", ["ADMIN"]);
const sales = await mkUser("Sales Staging S5", "sales-staging-s5@example.test", ["SALES"]);

// Main Hub — Pantauan Leader (Okt 2026). DUA leader dengan bentuk BERBEDA
// sengaja, supaya rehearsal menguji kedua jalur nyata sekaligus:
//   leaderA — ADMIN (punya HUB_ACCESS) -> akan benar-benar login ke HUB dan
//             punya data nyata -> jalur "connected:true" dengan tugas asli.
//   leaderB — SALES saja (TIDAK punya HUB_ACCESS, seperti kebanyakan leader
//             divisi sungguhan saat ini) -> tidak pernah terhubung ke HUB ->
//             jalur jujur "connected:false", bukan dikarang datanya.
// Ditandai isLeader via UserDivision di bawah (C2.1) — BUKAN lewat role.
const leaderA = await mkUser("Leader Produksi Staging S5", "leader-a-staging-s5@example.test", ["ADMIN"]);
const leaderB = await mkUser("Leader Gudang Staging S5", "leader-b-staging-s5@example.test", ["SALES"]);
for (const [user, division] of [[leaderA, "PRODUCTION"], [leaderB, "WAREHOUSE"]]) {
  await prisma.userDivision.upsert({
    where: { userId_division: { userId: user.id, division } },
    update: { isLeader: true },
    create: { userId: user.id, division, isLeader: true },
  });
}

process.stdout.write(
  "RESULT:" +
    JSON.stringify({
      password: PASSWORD,
      owner: { id: owner.id, email: owner.email },
      adminActor: { id: adminActor.id, email: adminActor.email },
      adminTarget: { id: adminTarget.id, email: adminTarget.email },
      sales: { id: sales.id, email: sales.email },
      leaderA: { id: leaderA.id, email: leaderA.email, division: "PRODUCTION" },
      leaderB: { id: leaderB.id, email: leaderB.email, division: "WAREHOUSE" },
    }) +
    "\n",
);
await prisma.$disconnect();
