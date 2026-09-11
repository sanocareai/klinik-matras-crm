import { prisma } from "../db.js";

const PREFIX_MAP = { LAYANAN: "RES", SEWA: "SWS", BARU: "NEW" };

// Counter generik per prefix + bulan + tahun, aman dari race condition via
// transaction — dipakai generateOrderNumber (RES/SWS/NEW) DAN
// generateComplaintCaseNumber (CMP, D-116) supaya keduanya berbagi SATU
// mesin counter (OrderSequence), bukan menduplikasi logika upsert+format.
async function generateSequenceNumber(prefix) {
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

// Generate nomor order otomatis: RES-07072026-001
// Counter terpisah per prefix + bulan + tahun, aman dari race condition via transaction
export async function generateOrderNumber(category) {
  return generateSequenceNumber(PREFIX_MAP[category] || "RES");
}

// Generate nomor kasus komplain otomatis: CMP-11092026-001 (D-116, Complaint
// Case). Prefix TERPISAH dari RES/SWS/NEW — kasus komplain bukan Order baru,
// tapi butuh nomor yang enak disebut lisan/WA sama seperti Order Number.
export async function generateComplaintCaseNumber() {
  return generateSequenceNumber("CMP");
}
