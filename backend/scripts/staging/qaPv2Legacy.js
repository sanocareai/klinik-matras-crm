// Staging QA-PV2 (P12B.5): unit NON-V2 (V1 murni) berisi DATA NYATA di DB terisolasi — order + item layanan Sales + unit TANPA masuk cohort, tanpa Run V2, tanpa pickup/custody.
// Dipakai menguji drawer Unit 360 untuk unit di luar cohort (aksi V1: layanan teknis, prioritas, target, blokir) tanpa mock 404. Perubahan lewat endpoint ASLI (kit).
// Semua entitas ber-prefix QA-PV2; idempoten. Pemanggil wajib sudah lolos assertQaPv2Safe().
import { PREFIX, qaCode } from "./qaPv2Safety.js";

export const LEGACY_SPECS = Object.freeze([
  { n: 1, cust: "V1 Polos", city: "Bandung", sales: "kiki", svc: "Servis Spring & Busa", kasur: ["King Koil", "180 x 200"], note: "unit V1 tanpa layanan teknis" },
  { n: 2, cust: "V1 Berlayanan", city: "Depok", sales: "rifki", svc: "Upgrade Fondasi Matras Sehat", kasur: ["Serta", "160 x 200"], note: "layanan teknis sudah ditetapkan", technical: true, priority: "HIGH" },
  { n: 3, cust: "V1 Terblokir", city: "Bekasi", sales: "ervina", svc: "Ganti Kain & Busa", kasur: ["Comforta", "120 x 200"], note: "tahap pertama terblokir (bahan)", technical: true, blocked: true },
]);
const codeOf = (n) => qaCode(`V1-${String(n).padStart(2, "0")}`);
const orderNoOf = (n) => qaCode(`RES-V1${String(n).padStart(2, "0")}`);

export async function seedLegacyUnits(ctx, W) {
  const { prisma, kit } = ctx; const A = W.accounts; const out = [];
  for (const spec of LEGACY_SPECS) {
    const code = codeOf(spec.n);
    const existing = await prisma.unit.findUnique({ where: { unitCode: code } });
    if (existing) { ctx.log(`  ${code}: sudah ada — dilewati (idempoten)`); out.push({ code, unitId: existing.id, existed: true }); continue; }
    const customer = await prisma.customer.create({ data: { name: `${PREFIX} ${spec.cust}`, city: spec.city, assignedSalesId: A[`sales_${spec.sales}`]?.id ?? null } });
    const order = await prisma.order.create({ data: { customerId: customer.id, orderNumber: orderNoOf(spec.n), value: 900_000 + spec.n * 100_000, category: "LAYANAN", productType: "KASUR_SPRING" } });
    await prisma.orderItem.create({ data: { orderId: order.id, layananName: spec.svc, harga: 900_000 + spec.n * 100_000, sortOrder: 0 } });
    const unit = await prisma.unit.create({ data: { unitCode: code, orderId: order.id, seq: 1, status: "AWAITING_PICKUP", merk: spec.kasur[0], ukuran: spec.kasur[1] } });
    ctx.log(`  ${code}: order+unit V1 dibuat (${spec.note}) — TIDAK masuk cohort, tanpa Run V2`);
    if (spec.technical) await kit.patch(A.lead, `/api/units/${unit.id}/service`, { serviceId: W.service.id });
    if (spec.priority) await kit.patch(A.lead, `/api/units/${unit.id}/production`, { priority: spec.priority, productionDueAt: "2026-10-20T00:00:00+07:00" });
    if (spec.blocked) {
      const started = await kit.post(A.meja1, `/api/units/${unit.id}/stages/start`, {});
      const stageId = started?.stageId || started?.stage?.id || (await prisma.unit.findUniqueOrThrow({ where: { id: unit.id }, select: { currentStageId: true } })).currentStageId;
      await kit.post(A.meja1, `/api/units/${unit.id}/stages/${stageId}/fail`, { blockReason: "MATERIAL_SHORTAGE", note: "Busa kurang (data uji V1)" });
    }
    out.push({ code, unitId: unit.id, existed: false });
  }
  return out;
}

// Pembuktian tidak ada tulisan V2 untuk unit non-V2: jumlah baris tabel V2 yang menyangkut unit ini (harus 0).
export async function v2FootprintOf(ctx, unitId) {
  const { prisma } = ctx;
  const q = (sql) => prisma.$queryRawUnsafe(sql).then((r) => Number(r[0].c));
  return {
    runs: await q(`select count(*)::int c from production_runs_v2 where unit_id='${unitId}'`),
    custody: await q(`select count(*)::int c from unit_custody_handoffs_v2 where unit_id='${unitId}'`),
    commands: await q(`select count(*)::int c from v2_commands where payload::text like '%${unitId}%'`),
  };
}

// Unit V1 BARU untuk uji lifecycle penuh di UI (kode unik per pemanggilan; tanpa layanan teknis, belum ada tahap). Bukan bagian dari 3 unit tetap — tak mengganggu idempotensi.
export async function seedLifecycleUnit(ctx, W) {
  const { prisma } = ctx; const A = W.accounts;
  const tag = Date.now().toString(36).toUpperCase();
  const customer = await prisma.customer.create({ data: { name: `${PREFIX} V1 Lifecycle ${tag}`, city: "Bogor", assignedSalesId: A.sales_kiki?.id ?? null } });
  const order = await prisma.order.create({ data: { customerId: customer.id, orderNumber: qaCode(`RES-VL${tag}`), value: 1_200_000, category: "LAYANAN", productType: "KASUR_SPRING" } });
  await prisma.orderItem.create({ data: { orderId: order.id, layananName: "Servis Spring & Busa", harga: 1_200_000, sortOrder: 0 } });
  const unit = await prisma.unit.create({ data: { unitCode: qaCode(`V1-L${tag}`), orderId: order.id, seq: 1, status: "AWAITING_PICKUP", merk: "Serta", ukuran: "160 x 200" } });
  ctx.log(`  ${unit.unitCode}: unit V1 lifecycle dibuat (di luar cohort, tanpa Run V2)`);
  return { code: unit.unitCode, unitId: unit.id };
}
