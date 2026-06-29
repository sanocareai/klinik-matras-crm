import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "./src/db.js";

// Jalankan: npm run seed
const users = [
  { name: "OWNER (Admin)", email: "admin@klinikmatras.com", password: "kasursehat1", role: "ADMIN" },
  { name: "Novi", email: "novi@klinikmatras.com", password: "kasursehat1", role: "SALES" },
  { name: "Risel", email: "risel@klinikmatras.com", password: "kasursehat1", role: "SALES" },
  { name: "Farhan", email: "farhan@klinikmatras.com", password: "kasursehat1", role: "SALES" },
  { name: "Mila", email: "mila@klinikmatras.com", password: "kasursehat1", role: "SALES" },
  { name: "Kiki", email: "kiki@klinikmatras.com", password: "kasursehat1", role: "SALES" },
  { name: "Sales 6", email: "sales6@klinikmatras.com", password: "kasursehat1", role: "SALES" },
];

async function main() {
  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { name: u.name, email: u.email, passwordHash, role: u.role },
    });
    console.log(`User dibuat/ada: ${u.email}`);
  }
  await prisma.$disconnect();
}

main();
