// Jalankan sekali: node scripts/delete-sales6.js
// Menghapus user "Sales 6" dari database, unassign customer & conversation-nya dulu
import { prisma } from "../src/db.js";

const user = await prisma.user.findFirst({
  where: { name: { contains: "Sales 6", mode: "insensitive" } },
});

if (!user) {
  console.log("User Sales 6 tidak ditemukan — mungkin sudah dihapus.");
  await prisma.$disconnect();
  process.exit(0);
}

console.log("Hapus user:", user.name, user.email);

await prisma.conversation.updateMany({ where: { assignedToId: user.id }, data: { assignedToId: null } });
await prisma.customer.updateMany({ where: { assignedSalesId: user.id }, data: { assignedSalesId: null } });
await prisma.salesTarget.deleteMany({ where: { userId: user.id } });
await prisma.note.deleteMany({ where: { authorId: user.id } });
await prisma.user.delete({ where: { id: user.id } });

console.log("Selesai.");
await prisma.$disconnect();
