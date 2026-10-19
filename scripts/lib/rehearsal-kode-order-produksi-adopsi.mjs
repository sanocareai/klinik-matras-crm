// Pemeriksaan KODE BARU terhadap data restore yang SUDAH dimigrasi (rehearsal mode image; BACA-SAJA — tidak ada tulisan). Dijalankan di container backend baru dengan DATABASE_URL = DB rehearsal.
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const ExcelJS = require("exceljs");
const prisma = new PrismaClient();
const { listWorkOrders } = await import("/app/src/services/productionOrderList.js");
const { buatWorkbookOrderProduksi } = await import("/app/src/services/productionOrderExport.js");
const { katalogBahan, ambilRencanaBahan, ambilPemakaianAktual } = await import("/app/src/services/productionAdoptionService.js");
const { WORK_STATUS } = await import("/app/src/lib/domain/productionWorkStatus.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d !== "" ? " — " + String(d).slice(0, 200) : "")); };
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const awal = {
  sm: await hitung("select count(*)::int n from stock_movements"), unit: await hitung("select count(*)::int n from units"), job: await hitung("select count(*)::int n from jobs"), run: await hitung("select count(*)::int n from production_runs_v2"),
  qc: await hitung("select count(*)::int n from quality_inspections_v2"), jur: await hitung("select count(*)::int n from fin_journal_entries"), cmd: await hitung("select count(*)::int n from v2_commands"), act: await hitung("select count(*)::int n from activity_events"),
};
cek("data restore memuat unit nyata", awal.unit > 0, "unit=" + awal.unit);
for (const t of ["production_unit_work_progress", "production_unit_material_plans", "production_unit_material_plan_revisions"]) cek(`tabel baru ${t} kosong (tanpa backfill)`, (await hitung(`select count(*)::int n from ${t}`)) === 0);

// ── daftar Order Produksi: SEMUA unit nyata terbaca dengan kontrak tiga sumbu
const daftar = await listWorkOrders(prisma, { pageSize: "200" }, { semua: true });
cek("daftar memuat semua unit (jumlah = tabel units)", daftar.units.length === awal.unit && daftar.total === awal.unit, `${daftar.units.length}/${awal.unit}`);
const salah = daftar.units.filter((u) => !u.adopsi?.kerja || !WORK_STATUS[u.adopsi.kerja.key] || !u.adopsi.statusOrder?.label || !u.adopsi.posisi?.key || !u.adopsi.tindakan?.label);
cek("setiap unit punya status order + posisi + status kerja (kosakata kamus) + tindakan berikutnya", salah.length === 0, salah.slice(0, 3).map((u) => u.unitCode).join(","));
cek("tanpa catatan manual di data restore: tidak ada status kerja bersumber MANUAL", daftar.units.every((u) => u.adopsi.kerja.source !== "MANUAL"));
cek("satu unit = satu status kerja (tidak ada kunci ganda)", new Set(daftar.units.map((u) => u.id)).size === daftar.units.length);
const per = (k) => daftar.units.filter((u) => u.adopsi.kerja.key === k).length;
console.log(`INFO status kerja: ${Object.keys(WORK_STATUS).map((k) => `${k}=${per(k)}`).join(" ")}`);
const sesat = daftar.units.filter((u) => u.status === "CANCELLED" && u.adopsi.kerja.key !== "DIBATALKAN");
cek("unit dibatalkan selalu berstatus kerja Dibatalkan", sesat.length === 0);
const selesaiOrder = daftar.units.filter((u) => ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED"].includes(u.status) && !u.adopsi.buktiAplikasi);
cek("unit Siap Kirim ke atas tanpa bukti aplikasi = status kerja Selesai (mengikuti status order)", selesaiOrder.every((u) => u.adopsi.kerja.key === "SELESAI"), `n=${selesaiOrder.length}`);
// filter status kerja memakai kamus yang sama
const f = await listWorkOrders(prisma, { statusKerja: "BELUM_DIJADWALKAN", pageSize: "200" }, {});
cek("filter statusKerja=BELUM_DIJADWALKAN konsisten dengan daftar penuh", f.total === per("BELUM_DIJADWALKAN"), `${f.total}/${per("BELUM_DIJADWALKAN")}`);
// kontrak lama tetap ada (aditif)
cek("field lama tetap ada (globalStatus, unitStatusDisplay, productionStatus, priorityDisplay)", daftar.units.every((u) => u.globalStatus && u.unitStatusDisplay && u.productionStatus && u.priorityDisplay));

// ── katalog bahan per kelompok dan pemakaian aktual dari ledger nyata
const kat = await katalogBahan(prisma, { limit: "300" });
cek("katalog bahan: kelompok Gudang terbaca, bahan aktif ada", kat.kelompok.length >= 8 && kat.total > 0, `bahan=${kat.total}; kelompok=${kat.kelompok.map((k) => `${k.kode}:${k.jumlah}`).join(" ")}`);
cek("katalog: saldo tidak diketahui TIDAK tampil sebagai nol", kat.rows.every((r) => r.saldoDiketahui || (r.saldo === null && r.tersedia === null)));
const unitIssue = (await prisma.$queryRawUnsafe(`select unit_id::text id, count(*)::int n from stock_movements where unit_id is not null and type::text = 'ISSUE' group by unit_id order by n desc limit 5`));
for (const u of unitIssue) {
  const a = await ambilPemakaianAktual(prisma, u.id); const r = await ambilRencanaBahan(prisma, u.id);
  cek(`pemakaian aktual unit ${u.id.slice(0, 8)}: ${u.n} pergerakan ISSUE terbaca lengkap dengan pelaku`, a.baris.filter((b) => b.tipe === "ISSUE").length === u.n && a.baris.every((b) => b.dokumen?.jenis), `${a.baris.length} baris`);
  cek(`rencana bahan unit ${u.id.slice(0, 8)}: kosong (belum dibuat), pemakaian aktual tidak dianggap rencana`, r.plan === null);
}
if (!unitIssue.length) console.log("INFO tidak ada unit dengan pergerakan ISSUE di data restore (pemeriksaan pemakaian aktual dilewati)");

// ── ekspor Excel dari data nyata (di memori): jumlah baris = daftar
const buf = await buatWorkbookOrderProduksi(prisma, { rows: daftar.units, unitIds: daftar.units.map((u) => u.id), filter: daftar.filterDipakai, pengguna: "rehearsal" });
const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(buf));
const ws = wb.getWorksheet("Ringkasan Unit");
cek("ekspor xlsx: 4 sheet, baris data = jumlah unit, AutoFilter + freeze header", wb.worksheets.length === 4 && ws.rowCount - 1 === daftar.units.length && !!ws.autoFilter && ws.views?.[0]?.ySplit === 1, `sheet=${wb.worksheets.map((s) => s.name).join("|")} baris=${ws.rowCount - 1}`);

// ── tidak ada tulisan
const akhir = {
  sm: await hitung("select count(*)::int n from stock_movements"), unit: await hitung("select count(*)::int n from units"), job: await hitung("select count(*)::int n from jobs"), run: await hitung("select count(*)::int n from production_runs_v2"),
  qc: await hitung("select count(*)::int n from quality_inspections_v2"), jur: await hitung("select count(*)::int n from fin_journal_entries"), cmd: await hitung("select count(*)::int n from v2_commands"), act: await hitung("select count(*)::int n from activity_events"),
};
for (const k of Object.keys(awal)) cek(`tidak ada tulisan: ${k} tetap ${awal[k]}`, akhir[k] === awal[k]);
await prisma.$disconnect();
console.log("REHEARSAL_KODE_BARU gagal=" + gagal);
process.exit(gagal ? 1 : 0);
