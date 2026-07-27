// Laporan + ASSIGN OTOMATIS (opsional via --apply) — tunjukkan order bulan ini
// yang TIDAK ikut terhitung di "Target Tim" (mobile) / GET /analytics/sales-performance,
// karena customer-nya unassigned (assignedSalesId null) atau di-assign ke user
// ber-role ADMIN (bukan SALES) — sementara Dashboard "Revenue" (/analytics/overview)
// menghitung SEMUA order tanpa filter assignedSalesId. Ini akar penyebab gap
// "Target Tim" (mobile) vs "Revenue" (Dashboard web).
//
// SARAN OTOMATIS: untuk tiap customer unassigned, cek siapa sales yang SUDAH
// menangani percakapannya (Conversation.assignedToId — pemegang SEKARANG;
// fallback ke firstResponderId kalau assignedToId kosong). Kalau semua
// percakapan customer itu konsisten mengarah ke 1 sales yang sama → itu
// kandidat assign yang aman. Kalau tidak ada sinyal atau sinyalnya BEDA-BEDA
// (>1 sales berbeda pernah pegang) → dilewati, WAJIB assign manual (terlalu
// ambigu untuk ditebak otomatis).
//
// DEFAULT = dry-run (TIDAK mengubah data). Pola sama seperti fix-lid-customers.js.
//   docker compose exec backend node scripts/report-unassigned-orders.js
//   docker compose exec backend node scripts/report-unassigned-orders.js --year 2026 --month 7
//   docker compose exec backend node scripts/report-unassigned-orders.js --apply   # TERAPKAN assign yang confident
import { prisma } from "../src/db.js";
import { startOfMonthWIB, endOfMonthExclusiveWIB, nowPartsWIB } from "../src/utils/wib.js";

const APPLY = process.argv.includes("--apply");
function argVal(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}
function rp(n) {
  return "Rp" + (n || 0).toLocaleString("id-ID");
}

// Tentukan kandidat sales dari riwayat percakapan customer. null = tidak
// confident (tidak ada sinyal, atau sinyalnya bentrok antar percakapan).
function suggestOwner(conversations) {
  const candidates = new Set();
  for (const c of conversations) {
    const pick = c.assignedToId || c.firstResponderId;
    if (pick) candidates.add(pick);
  }
  if (candidates.size !== 1) return null;
  const [userId] = candidates;
  return userId;
}

async function main() {
  const now = nowPartsWIB();
  const year = argVal("year", now.year);
  const month = argVal("month", now.month);
  const start = startOfMonthWIB(year, month);
  const end = endOfMonthExclusiveWIB(year, month);

  console.log(`\n=== Laporan order tanpa sales — ${year}-${String(month).padStart(2, "0")} (WIB) ${APPLY ? "— MODE APPLY (akan mengubah data)" : "— dry-run"} ===\n`);

  const orders = await prisma.order.findMany({
    where: { createdAt: { gte: start, lt: end }, status: { not: "CANCELLED" } },
    select: {
      id: true, orderNumber: true, value: true, createdAt: true,
      customer: {
        select: {
          id: true, name: true, phone: true, assignedSalesId: true,
          assignedSales: { select: { name: true, role: true } },
          conversations: { select: { assignedToId: true, firstResponderId: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const totalAll = orders.reduce((s, o) => s + (o.value || 0), 0);
  const gapOrders = orders.filter((o) => !o.customer?.assignedSalesId || o.customer?.assignedSales?.role === "ADMIN");
  const gapTotal = gapOrders.reduce((s, o) => s + (o.value || 0), 0);

  // Satu baris per CUSTOMER unik (bukan per order) — supaya tiap customer cuma di-assign sekali.
  const byCustomer = new Map();
  for (const o of gapOrders) {
    const c = o.customer;
    if (!c || byCustomer.has(c.id)) continue;
    byCustomer.set(c.id, c);
  }

  const salesUsers = await prisma.user.findMany({ where: { role: "SALES" }, select: { id: true, name: true } });
  const salesNameById = Object.fromEntries(salesUsers.map((u) => [u.id, u.name]));

  console.log(`Total order bulan ini (semua, = angka "Revenue" Dashboard): ${orders.length} order, ${rp(totalAll)}`);
  console.log(`Tidak ikut "Target Tim": ${gapOrders.length} order dari ${byCustomer.size} customer, ${rp(gapTotal)}\n`);

  const confident = [];
  const needsManual = [];

  for (const c of byCustomer.values()) {
    const suggestedId = suggestOwner(c.conversations);
    const suggestedName = suggestedId ? salesNameById[suggestedId] : null;
    if (suggestedId && suggestedName) {
      confident.push({ customer: c, suggestedId, suggestedName });
    } else {
      needsManual.push(c);
    }
  }

  if (confident.length) {
    console.log(`── BISA DI-ASSIGN OTOMATIS (1 sales konsisten dari riwayat chat) — ${confident.length} customer ──`);
    for (const { customer: c, suggestedName } of confident) {
      console.log(`  ${c.name || "Tanpa nama"} (${c.phone || "-"}) → ${suggestedName}`);
    }
    console.log("");
  }

  if (needsManual.length) {
    console.log(`── PERLU ASSIGN MANUAL (tidak ada riwayat chat / sinyal bentrok >1 sales) — ${needsManual.length} customer ──`);
    for (const c of needsManual) {
      const seen = [...new Set(c.conversations.map((cv) => cv.assignedToId || cv.firstResponderId).filter(Boolean))];
      let hint;
      if (seen.length > 1) hint = ` (pernah dipegang ${seen.length} sales berbeda — cek manual siapa yang benar)`;
      else if (c.conversations.length === 0) hint = " (TIDAK PUNYA percakapan sama sekali — kemungkinan order dientri manual/telepon, bukan dari chat WA)";
      else hint = ` (punya ${c.conversations.length} percakapan, tapi belum pernah ada sales yang assigned/balas — lead masuk tapi belum ditangani)`;
      console.log(`  ${c.name || "Tanpa nama"} (${c.phone || "-"})${hint}`);
    }
    console.log("");
  }

  if (!APPLY) {
    console.log(`Dry-run selesai. Jalankan ulang dengan --apply untuk BENAR-BENAR meng-assign ${confident.length} customer di atas ke sales yang disarankan.`);
    console.log(`Customer di bagian "PERLU ASSIGN MANUAL" TIDAK PERNAH disentuh script ini (di --apply sekalipun) — assign sendiri lewat CRM web.\n`);
    await prisma.$disconnect();
    return;
  }

  console.log(`=== MENERAPKAN ${confident.length} assignment ===`);
  let done = 0;
  for (const { customer: c, suggestedId, suggestedName } of confident) {
    await prisma.customer.update({ where: { id: c.id }, data: { assignedSalesId: suggestedId } });
    console.log(`  ✓ ${c.name || "Tanpa nama"} → ${suggestedName}`);
    done++;
  }
  console.log(`\nSelesai: ${done} customer di-assign. ${needsManual.length} customer masih perlu assign manual lewat CRM web.\n`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error("ERROR:", e); process.exit(1); });
