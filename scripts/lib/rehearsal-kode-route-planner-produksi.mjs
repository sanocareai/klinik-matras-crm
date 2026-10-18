// Pemeriksaan KODE BARU "status produksi tidak menahan pengiriman" terhadap data restore backup NYATA. Dijalankan di container backend baru dengan DATABASE_URL = DB rehearsal (salinan).
// Satu-satunya tulisan terjadi DI DALAM transaksi yang selalu DIBATALKAN (rollback) pada salinan; skrip rilis membuktikan sidik jari seluruh tabel sama sebelum dan sesudah.
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const { validasiPenempatanUnitProduksi, unitMenungguPerJob, STATUS_PRODUKSI_BISA_DIKIRIM, STATUS_ORDER_SAH_PRODUKSI } = await import("/app/src/services/deliveryMenungguKonfirmasi.js");
const { bacaOverrideAdmin } = await import("/app/src/services/deliveryOverrideAdmin.js");
const { adminOverrideReport } = await import("/app/src/services/adminOverrideSwitch.js");
const { tandaiRunDilepasKarenaDispatchInTx } = await import("/app/src/services/unitCustodyCommandService.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d ? " — " + d : "")); };
const n = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);

// 1. Penempatan: unit produksi nyata yang sah lolos validasi; unit/order yang tidak sah ditolak dengan kode
const kandidat = await prisma.unit.findMany({ where: { status: { in: [...STATUS_PRODUKSI_BISA_DIKIRIM] }, order: { status: { in: [...STATUS_ORDER_SAH_PRODUKSI] }, penjualanKaryawanId: null } }, include: { order: { select: { id: true, orderNumber: true, status: true } } }, take: 200 });
let lolos = 0; let tolakKode = 0; const alasan = new Set();
for (const u of kandidat) {
  try { await validasiPenempatanUnitProduksi(prisma, [u]); lolos += 1; } catch (e) { if (e?.code === "JOB_GANDA") tolakKode += 1; else alasan.add(e?.code || e?.message); }
}
cek(`Penempatan: ${kandidat.length} unit produksi sah dinilai; yang lolos = yang belum punya job pengiriman aktif; sisanya hanya ditolak JOB_GANDA`, alasan.size === 0 && lolos + tolakKode === kandidat.length, `lolos=${lolos}, JOB_GANDA=${tolakKode}, lain=[${[...alasan].join(",")}]`);
const sqlLolos = await n("select count(*)::int n from units u join \"Order\" o on o.id = u.order_id where u.status in ('RECEIVED','IN_PRODUCTION') and o.status in ('PROCESSING','READY') and o.penjualan_karyawan_id is null and not exists (select 1 from job_units ju join jobs j on j.id = ju.job_id where ju.unit_id = u.id and j.type = 'DELIVERY' and j.status in ('UNSCHEDULED','SCHEDULED','ASSIGNED','EN_ROUTE','ARRIVED'))");
cek("Penempatan: jumlah yang lolos = hitungan SQL independen", kandidat.length > 200 || lolos === sqlLolos, `kode=${lolos} sql=${sqlLolos}`);
const terminal = await prisma.unit.findFirst({ where: { status: { in: ["CANCELLED", "DELIVERED"] } }, include: { order: { select: { id: true, orderNumber: true, status: true } } } });
if (terminal) { let kode = null; try { await validasiPenempatanUnitProduksi(prisma, [terminal]); } catch (e) { kode = e?.code; } cek("Unit batal/terkirim ditolak (UNIT_BATAL / UNIT_SUDAH_BERANGKAT)", ["UNIT_BATAL", "UNIT_SUDAH_BERANGKAT"].includes(kode), String(kode)); } else cek("Unit batal/terkirim: tidak ada contoh di data (dilewati)", true);

// 2. Penanda informasi per job pada job pengiriman nyata (baca-saja)
const jobs = await prisma.job.findMany({ where: { type: "DELIVERY" }, select: { id: true }, take: 500 });
const peta = await unitMenungguPerJob(prisma, jobs.map((j) => j.id));
cek(`Penanda informasi: dihitung untuk ${jobs.length} job pengiriman nyata tanpa galat`, peta instanceof Map, `job bertanda=${peta.size}`);

// 3. Pembaca penanda memakai filter JSON kind pada data nyata (kolom JSONB) — override Admin tetap terbaca, dispatch tidak tercampur
const adaOverride = await n("select count(*)::int n from production_runs_v2 where delivery_released_at is not null and delivery_release->>'kind' = 'ADMIN_OVERRIDE'");
const unitOv = await prisma.productionRun.findMany({ where: { deliveryReleasedAt: { not: null } }, select: { unitId: true }, take: 50 });
const ov = await bacaOverrideAdmin(prisma, unitOv.map((r) => r.unitId));
cek("Pembaca override Admin: filter kind JSON berjalan pada data nyata", ov instanceof Map && ov.size <= unitOv.length, `override=${adaOverride}, terbaca=${ov.size}`);
const lap = await adminOverrideReport(prisma, { limit: 50 });
cek("Laporan override Admin: 200 baris bentuk benar; hanya kind ADMIN_OVERRIDE", Array.isArray(lap.items) && lap.items.length === Math.min(adaOverride, 50), `items=${lap.items.length}`);

// 4. Pelepasan Run karena dispatch — DICOBA di dalam transaksi yang selalu dibatalkan, pada unit nyata yang sah (RECEIVED/IN_PRODUCTION dengan Run berjalan)
const run = await prisma.productionRun.findFirst({ where: { status: { in: ["PENDING_ARRIVAL", "ACTIVE", "BLOCKED"] }, deliveryReleasedAt: null, unit: { status: { in: ["RECEIVED", "IN_PRODUCTION"] } } }, include: { unit: { select: { id: true, unitCode: true, status: true } } } });
if (!run) { cek("Pelepasan Run dispatch: tidak ada Run produksi berjalan di data (dilewati)", true); } else {
  class Batal extends Error {}
  let hasil = null; let sesudah = null;
  try {
    await prisma.$transaction(async (tx) => {
      hasil = await tandaiRunDilepasKarenaDispatchInTx(tx, { unitIds: [run.unit.id], jobId: null, actorId: null, via: "JOB_START" });
      sesudah = await tx.productionRun.findUnique({ where: { id: run.id }, select: { deliveryReleasedAt: true, deliveryRelease: true, revision: true, status: true } });
      const ulang = await tandaiRunDilepasKarenaDispatchInTx(tx, { unitIds: [run.unit.id], jobId: null, actorId: null, via: "JOB_START" });
      if (ulang.length !== 0) throw new Error("tidak idempoten");
      throw new Batal();
    });
  } catch (e) { if (!(e instanceof Batal)) { cek("Pelepasan Run dispatch (transaksi dibatalkan) tidak galat", false, e?.message); } }
  cek(`Pelepasan Run dispatch pada unit nyata ${run.unit.unitCode} (${run.unit.status}): penanda kind DISPATCH_ROUTE_PLANNER + revisi naik 1 + Run tetap ${run.status}; idempoten`, !!hasil && hasil.length === 1 && sesudah?.deliveryRelease?.kind === "DISPATCH_ROUTE_PLANNER" && sesudah.revision === run.revision + 1 && sesudah.status === run.status && !!sesudah.deliveryReleasedAt);
  const tetap = await prisma.productionRun.findUnique({ where: { id: run.id }, select: { deliveryReleasedAt: true, revision: true } });
  cek("Transaksi percobaan DIBATALKAN: Run di salinan tidak berubah", tetap.deliveryReleasedAt === null && tetap.revision === run.revision);
  const terkini = await prisma.unit.findUnique({ where: { id: run.unit.id }, select: { status: true } });
  cek("Status unit tidak tersentuh oleh pelepasan Run (ditulis pemanggil setelahnya)", terkini.status === run.unit.status);
}
await prisma.$disconnect();
console.log("REHEARSAL_KODE_BARU gagal=" + gagal);
process.exit(gagal ? 1 : 0);
