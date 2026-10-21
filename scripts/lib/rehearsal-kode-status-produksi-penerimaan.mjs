// Pemeriksaan KODE BARU terhadap data restore yang SUDAH dimigrasi (rehearsal mode image; BACA-SAJA — tidak ada tulisan). Dijalankan di container backend baru dengan DATABASE_URL = DB rehearsal.
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { listWorkList } = await import("/app/src/services/productionWorkListService.js");
const { listWorkOrders, perkayaBarisUnit, UNIT_INCLUDE } = await import("/app/src/services/productionOrderList.js");
const { daftarMenungguPenerimaan, ambilPenerimaanWorkshop, pratinjauKoreksi } = await import("/app/src/services/unitWorkshopReceiptService.js");
const { loadMilestoneEvidence } = await import("/app/src/services/workshopMilestoneEvidence.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d !== "" ? " — " + String(d).slice(0, 200) : "")); };
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const TABEL = { sm: "stock_movements", unit: "units", job: "jobs", run: "production_runs_v2", qc: "quality_inspections_v2", jur: "fin_journal_entries", cmd: "v2_commands", act: "activity_events", serah: "unit_custody_handoffs_v2", outbox: "domain_outbox", order: "\"Order\"" };
const snap = async () => Object.fromEntries(await Promise.all(Object.entries(TABEL).map(async ([k, t]) => [k, await hitung(`select count(*)::int n from ${t}`)])));
const awal = await snap();
cek("data restore memuat unit nyata", awal.unit > 0, "unit=" + awal.unit);
for (const t of ["unit_workshop_receipts", "unit_workshop_receipt_corrections"]) cek(`tabel baru ${t} kosong (tanpa backfill)`, (await hitung(`select count(*)::int n from ${t}`)) === 0);

// ── Daftar kerja: SEMUA order nyata terbaca; antrean aktif + riwayat konsisten dengan database
const aktifSql = await hitung(`select count(*)::int n from "Order" o join "Customer" c on c.id = o."customerId" where o.status::text <> 'CANCELLED' and c."pipelineStage"::text <> 'SPAM' and c.is_internal_staff = false and exists (select 1 from units u where u.order_id = o.id and u.status::text not in ('DELIVERED','CANCELLED'))`);
const riwayatSql = await hitung(`select count(*)::int n from "Order" o join "Customer" c on c.id = o."customerId" where o.status::text <> 'CANCELLED' and c."pipelineStage"::text <> 'SPAM' and c.is_internal_staff = false and exists (select 1 from units u where u.order_id = o.id) and not exists (select 1 from units u where u.order_id = o.id and u.status::text not in ('DELIVERED','CANCELLED'))`);
const aktif = await listWorkList(prisma, { scope: "aktif", pageSize: "100", page: "1" });
cek("daftar kerja aktif: jumlah order = database (aktif)", aktif.counts.aktif === aktifSql && aktif.total === aktifSql, `${aktif.counts.aktif}/${aktifSql}`);
const riwayat = await listWorkList(prisma, { scope: "riwayat", pageSize: "100", page: "1" });
cek("daftar kerja riwayat: jumlah order = database (selesai/terkirim)", riwayat.counts.riwayat === riwayatSql && riwayat.total === riwayatSql, `${riwayat.counts.riwayat}/${riwayatSql}`);
cek("order selesai TIDAK ada di antrean aktif dan sebaliknya", aktif.orders.every((o) => o.units.some((u) => !["DELIVERED", "CANCELLED"].includes(u.status))) && riwayat.orders.every((o) => o.units.every((u) => ["DELIVERED", "CANCELLED"].includes(u.status))));
const semua = aktif.orders.flatMap((o) => o.units);
const salah = semua.filter((u) => !u.posisi?.key || !u.kerja?.key || !("tindakan" in u));
cek("setiap unit aktif punya posisi + status kerja + tindakan (kontrak empat status)", salah.length === 0, salah.slice(0, 3).map((u) => u.unitCode).join(","));
cek("status order Sales apa adanya (mentah = Order.status) untuk setiap order", aktif.orders.every((o) => o.statusOrder?.mentah && o.statusOrder.label));
cek("Tahap Meja HANYA untuk unit yang punya pekerjaan Run non-terminal (tidak dikarang)", semua.every((u) => !u.alurMeja || ["PENDING_ARRIVAL", "ACTIVE", "BLOCKED"].includes(u.alurMeja.status)));
cek("tanpa penerimaan di data restore: tidak ada unit berbukti terima WORKSHOP_RECEIPT", [...(await loadMilestoneEvidence(prisma, semua.map((u) => u.id))).values()].every((e) => e.receivedBasis !== "WORKSHOP_RECEIPT"));
console.log(`INFO daftar kerja: aktif=${aktifSql} riwayat=${riwayatSql} unit aktif=${aktif.ringkas.unitAktif} perlu tindakan=${aktif.ringkas.perluTindakan}`);
const cari = await listWorkList(prisma, { scope: "aktif", q: aktif.orders[0]?.orderNumber ?? "x", pageSize: "50" });
cek("pencarian nomor order menemukan ordernya", !aktif.orders.length || cari.orders.some((o) => o.orderId === aktif.orders[0].orderId));

// ── Antrean penerimaan Gudang = unit yang posisinya 'Sudah dijemput' (satu sumber kebenaran)
const menunggu = await daftarMenungguPenerimaan(prisma, { limit: "200" });
const unitsM = await prisma.unit.findMany({ where: { id: { in: menunggu.units.map((u) => u.unitId) } }, include: UNIT_INCLUDE });
const barisM = await perkayaBarisUnit(prisma, unitsM);
cek("antrean menunggu diterima: setiap unit berposisi 'Sudah dijemput · belum diterima'", barisM.every((b) => b.adopsi.posisi.key === "SUDAH_DIJEMPUT"), `n=${menunggu.units.length}/${menunggu.total}`);
cek("antrean menunggu diterima ⊆ unit berposisi Sudah dijemput di daftar kerja", menunggu.units.every((u) => semua.some((x) => x.id === u.unitId) || menunggu.total > 100));
const contoh = semua[0];
if (contoh) {
  const r = await ambilPenerimaanWorkshop(prisma, contoh.id);
  cek("unit contoh: belum ada penerimaan (null) dan riwayat kosong", r.penerimaan === null && r.riwayat.length === 0);
  let kode = null; try { await pratinjauKoreksi(prisma, contoh.id); } catch (e) { kode = e.code; }
  cek("pratinjau koreksi tanpa penerimaan = PENERIMAAN_TIDAK_ADA (tidak menulis)", kode === "PENERIMAAN_TIDAK_ADA", kode);
}
const lama = await listWorkOrders(prisma, { pageSize: "200" }, { semua: true });
cek("daftar Order Produksi (kontrak lama) tetap memuat semua unit", lama.units.length === awal.unit, `${lama.units.length}/${awal.unit}`);

// ── tidak ada tulisan
const akhir = await snap();
for (const k of Object.keys(awal)) cek(`tidak ada tulisan: ${k} tetap ${awal[k]}`, akhir[k] === awal[k]);
for (const t of ["unit_workshop_receipts", "unit_workshop_receipt_corrections"]) cek(`tidak ada tulisan: ${t} tetap kosong`, (await hitung(`select count(*)::int n from ${t}`)) === 0);
await prisma.$disconnect();
console.log("REHEARSAL_KODE_BARU gagal=" + gagal);
process.exit(gagal ? 1 : 0);
