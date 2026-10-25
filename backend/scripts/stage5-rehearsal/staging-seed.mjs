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

process.stdout.write(
  "RESULT:" +
    JSON.stringify({
      password: PASSWORD,
      owner: { id: owner.id, email: owner.email },
      adminActor: { id: adminActor.id, email: adminActor.email },
      adminTarget: { id: adminTarget.id, email: adminTarget.email },
      sales: { id: sales.id, email: sales.email },
    }) +
    "\n",
);
await prisma.$disconnect();
