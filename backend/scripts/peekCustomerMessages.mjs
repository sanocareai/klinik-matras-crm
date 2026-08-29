// ═══ DIAGNOSTIK SEKALI PAKAI — lihat window pesan mentah 1 customer ════════
// Jalankan: docker compose exec backend node scripts/peekCustomerMessages.mjs "<nama>"
import { prisma } from "../src/db.js";

const nameQuery = process.argv[2];
if (!nameQuery) { console.error("Usage: node peekCustomerMessages.mjs <nama>"); process.exit(1); }

const c = await prisma.customer.findFirst({
  where: { name: { contains: nameQuery, mode: "insensitive" } },
  include: {
    conversations: {
      where: { type: "INDIVIDUAL" }, orderBy: { lastMessageAt: "desc" }, take: 1,
      include: { messages: { orderBy: { createdAt: "desc" }, take: 10 } },
    },
  },
});
if (!c) { console.log("Tidak ditemukan."); process.exit(0); }
console.log(`Customer: ${c.name} (${c.phone})`);
const msgs = c.conversations[0]?.messages || [];
for (const m of msgs.slice().reverse()) {
  console.log(`[${m.direction}] ${m.createdAt.toISOString()} :: ${m.content}`);
}
await prisma.$disconnect();
