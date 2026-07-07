import { prisma } from "../db.js";

const PREFIX_MAP = { LAYANAN: "RES", SEWA: "SWS", BARU: "NEW" };

// Generate nomor order otomatis: RES-07072026-001
// Counter terpisah per prefix + bulan + tahun, aman dari race condition via transaction
export async function generateOrderNumber(category) {
  const prefix = PREFIX_MAP[category] || "RES";
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const seq = await prisma.$transaction(async (tx) => {
    const record = await tx.orderSequence.upsert({
      where: { prefix_year_month: { prefix, year, month } },
      update: { lastSeq: { increment: 1 } },
      create: { prefix, year, month, lastSeq: 1 },
    });
    return record.lastSeq;
  });

  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  const nnn = String(seq).padStart(3, "0");
  return `${prefix}-${dd}${mm}${year}-${nnn}`;
}
