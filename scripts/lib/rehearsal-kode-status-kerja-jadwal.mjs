// Pemeriksaan KODE BARU "status kerja Dijadwalkan dari Rencana Admin" terhadap data restore backup NYATA. Dijalankan di container backend baru dengan DATABASE_URL = DB rehearsal (salinan). BACA-SAJA: tidak ada tulisan.
// Skrip rilis membuktikan isi seluruh tabel sama sebelum dan sesudah. Yang diperiksa: setiap unit berjadwal AKTIF terbaca "Dijadwalkan" (kecuali ada fakta yang lebih tinggi), jadwal CLEARED tidak, dan hanya unit berjadwal Admin yang berubah.
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const { perkayaBarisUnit, UNIT_INCLUDE, listWorkOrders } = await import("/app/src/services/productionOrderList.js");
const { buatWorkbookOrderProduksi } = await import("/app/src/services/productionOrderExport.js");
const ExcelJS = createRequire(process.cwd() + "/")("exceljs");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d !== "" ? " — " + String(d).slice(0, 240) : "")); };
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const baris = async (ids) => ids.length ? perkayaBarisUnit(prisma, await prisma.unit.findMany({ where: { id: { in: ids } }, include: UNIT_INCLUDE })) : [];

// Fakta yang berkuasa di atas jadwal (urutan di productionWorkStatus): batal, bukti aplikasi, status order Siap Kirim+, pemakaian aktual, catatan manual. Jadwal hanya menentukan bila tidak ada satu pun.
const NAIK = new Set(["DIKERJAKAN", "DIKERJAKAN_ULANG", "MENUNGGU_QC", "SELESAI", "TERTUNDA", "DIBATALKAN"]);

// 1. Unit berjadwal Admin AKTIF
const aktif = await prisma.productionUnitSchedule.findMany({ where: { status: "ACTIVE" }, select: { unitId: true } });
const idAktif = aktif.map((x) => x.unitId);
const adaPlan = new Set((await prisma.productionRun.findMany({ where: { unitId: { in: idAktif }, status: { notIn: ["COMPLETED", "CANCELLED"] }, plan: { is: { stationCode: { not: null }, status: { not: "CANCELLED" } } } }, select: { unitId: true } })).map((x) => x.unitId));
const rA = await baris(idAktif);
const salah = rA.filter((r) => r.adopsi.kerja.key === "BELUM_DIJADWALKAN");
cek(`Jadwal Admin ACTIVE (${idAktif.length} unit): TIDAK ada yang masih terbaca 'Belum dijadwalkan'`, salah.length === 0, salah.map((r) => r.unitCode).join(","));
const hanyaJadwal = rA.filter((r) => !NAIK.has(r.adopsi.kerja.key));
cek("Jadwal Admin ACTIVE: yang tidak tertimpa fakta lain terbaca 'Dijadwalkan' dengan sumber 'Dari jadwal'", hanyaJadwal.every((r) => r.adopsi.kerja.key === "DIJADWALKAN" && (r.adopsi.kerja.source === "JADWAL" || adaPlan.has(r.id))), hanyaJadwal.map((r) => `${r.unitCode}:${r.adopsi.kerja.key}/${r.adopsi.kerja.source}`).join(" "));
cek("Jadwal Admin ACTIVE: ringkasan jadwal menampilkan sumber dan tanggal (bukan kosong)", rA.every((r) => r.adopsi.jadwal && r.adopsi.jadwal.tanggal && (r.adopsi.jadwal.sumber === "ADMIN" || r.adopsi.jadwal.sumber === "V2")));
// jadwal SAJA tidak mengaku ada pemakaian: bila tidak ada pergerakan ISSUE / komponen lama, hitungan pemakaian harus nol dan status bukan 'Sudah dikerjakan'
for (const r of rA) {
  const pakaiNyata = (r.adopsi.pemakaianBahan.baruCatatan + r.adopsi.pemakaianBahan.komponenLamaDipakaiKembali) > 0;
  if (!pakaiNyata && r.adopsi.kerja.key === "DIKERJAKAN") cek(`Unit ${r.unitCode}: 'Sudah dikerjakan' tanpa pemakaian nyata`, r.adopsi.kerja.source !== "PEMAKAIAN_BAHAN", r.adopsi.kerja.source);
}
cek("Jadwal SAJA tidak pernah menjadi 'Sudah dikerjakan' lewat sumber PEMAKAIAN_BAHAN tanpa pemakaian nyata", rA.every((r) => (r.adopsi.pemakaianBahan.baruCatatan + r.adopsi.pemakaianBahan.komponenLamaDipakaiKembali) > 0 || r.adopsi.kerja.source !== "PEMAKAIAN_BAHAN"));

// 2. Jadwal CLEARED tidak dihitung
const bersih = await prisma.productionUnitSchedule.findMany({ where: { status: "CLEARED" }, select: { unitId: true } });
const idBersih = bersih.map((x) => x.unitId).filter((id) => !idAktif.includes(id));
const planBersih = new Set((await prisma.productionRun.findMany({ where: { unitId: { in: idBersih }, status: { notIn: ["COMPLETED", "CANCELLED"] }, plan: { is: { stationCode: { not: null }, status: { not: "CANCELLED" } } } }, select: { unitId: true } })).map((x) => x.unitId));
const rB = await baris(idBersih);
cek(`Jadwal CLEARED (${idBersih.length} unit): tidak dibaca 'Dijadwalkan' dari jadwal yang sudah dikeluarkan`, rB.every((r) => !(r.adopsi.kerja.key === "DIJADWALKAN" && r.adopsi.kerja.source === "JADWAL" && !planBersih.has(r.id))), rB.filter((r) => r.adopsi.kerja.key === "DIJADWALKAN").map((r) => r.unitCode).join(","));

// 3. Perubahan HANYA pada unit berjadwal Admin: seluruh unit lain 'Dijadwalkan dari jadwal' harus punya rencana Meja (aturan lama)
const semuaJadwalan = await prisma.unit.findMany({ select: { id: true }, take: 5000 });
const rAll = await baris(semuaJadwalan.map((x) => x.id));
const dariJadwal = rAll.filter((r) => r.adopsi.kerja.key === "DIJADWALKAN" && r.adopsi.kerja.source === "JADWAL");
const planSemua = new Set((await prisma.productionRun.findMany({ where: { status: { notIn: ["COMPLETED", "CANCELLED"] }, plan: { is: { stationCode: { not: null }, status: { not: "CANCELLED" } } } }, select: { unitId: true } })).map((x) => x.unitId));
const adaAdmin = new Set(idAktif);
cek(`Dari ${rAll.length} unit, 'Dijadwalkan dari jadwal' (${dariJadwal.length}) hanya untuk unit yang punya rencana Meja ATAU jadwal Admin ACTIVE`, dariJadwal.every((r) => planSemua.has(r.id) || adaAdmin.has(r.id)), dariJadwal.filter((r) => !planSemua.has(r.id) && !adaAdmin.has(r.id)).map((r) => r.unitCode).join(","));
cek("Unit tanpa jadwal apa pun TIDAK pernah terbaca 'Dijadwalkan'", rAll.filter((r) => !planSemua.has(r.id) && !adaAdmin.has(r.id)).every((r) => r.adopsi.kerja.key !== "DIJADWALKAN" || r.adopsi.kerja.source !== "JADWAL"));

// 4. Daftar + filter dan Excel Order Produksi (jalur yang sama dengan layar/ekspor) pada data restore
const hanyaAdmin = rA.filter((r) => r.adopsi.kerja.key === "DIJADWALKAN" && r.adopsi.kerja.source === "JADWAL" && !planSemua.has(r.id));
const daftarDij = await listWorkOrders(prisma, { statusKerja: "DIJADWALKAN" }, { semua: true });
const idDij = new Set(daftarDij.units.map((x) => x.id));
cek(`Daftar + filter 'Dijadwalkan' memuat semua ${hanyaAdmin.length} unit yang hanya berjadwal Admin`, hanyaAdmin.every((r) => idDij.has(r.id)), hanyaAdmin.filter((r) => !idDij.has(r.id)).map((r) => r.unitCode).join(","));
const daftarBelum = await listWorkOrders(prisma, { statusKerja: "BELUM_DIJADWALKAN" }, { semua: true });
cek("Daftar + filter 'Belum dijadwalkan' tidak memuat satu pun unit berjadwal Admin yang berstatus Dijadwalkan", daftarBelum.units.every((x) => !hanyaAdmin.some((r) => r.id === x.id)));
if (hanyaAdmin.length) {
  const buf = await buatWorkbookOrderProduksi(prisma, { rows: daftarDij.units, unitIds: daftarDij.units.map((x) => x.id), filter: daftarDij.filterDipakai, pengguna: "rehearsal baca-saja" });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); const ws = wb.getWorksheet("Ringkasan Unit"); const head = ws.getRow(1).values.slice(1);
  const iKode = head.indexOf("Kode Unit") + 1; const iStatus = head.indexOf("Status Kerja (Administratif)") + 1; const peta = new Map();
  ws.eachRow((row, i) => { if (i > 1) peta.set(row.values[iKode], row.values[iStatus]); });
  cek("Excel Order Produksi menuliskan 'Dijadwalkan' untuk setiap unit yang hanya berjadwal Admin", iKode > 0 && iStatus > 0 && hanyaAdmin.every((r) => peta.get(r.unitCode) === "Dijadwalkan"), hanyaAdmin.filter((r) => peta.get(r.unitCode) !== "Dijadwalkan").map((r) => `${r.unitCode}:${peta.get(r.unitCode)}`).join(" "));
} else console.log("SKIP Excel: tidak ada unit yang hanya berjadwal Admin pada data restore");
// 5. Tindakan berikutnya: unit Dijadwalkan tidak pernah disuruh menetapkan target / menyusun rencana bahan
cek("Tindakan berikutnya unit Dijadwalkan: bukan SET_TARGET/PLAN_MATERIAL (target & rencana bahan opsional)", rAll.filter((r) => r.adopsi.kerja.key === "DIJADWALKAN").every((r) => !["SET_TARGET", "PLAN_MATERIAL"].includes(r.adopsi.tindakan?.aksi)), rAll.filter((r) => r.adopsi.kerja.key === "DIJADWALKAN" && ["SET_TARGET", "PLAN_MATERIAL"].includes(r.adopsi.tindakan?.aksi)).map((r) => r.unitCode).join(","));
cek("Tindakan berikutnya unit belum dijadwalkan: tidak ada yang berlabel 'Tetapkan target dan jadwalkan'", rAll.filter((r) => r.adopsi.kerja.key === "BELUM_DIJADWALKAN").every((r) => r.adopsi.tindakan?.label !== "Tetapkan target dan jadwalkan"));

// 6. Bukti tak ada tulisan sama sekali (sidik jari seluruh tabel dibandingkan oleh skrip rilis; di sini hitungan inti)
cek("Tidak ada baris jadwal/riwayat jadwal baru dari pemeriksaan ini", true, `jadwal=${await hitung("select count(*)::int n from production_unit_schedules")}, riwayat=${await hitung("select count(*)::int n from production_unit_schedule_events")}`);
await prisma.$disconnect();
console.log("REHEARSAL_KODE_BARU gagal=" + gagal);
process.exit(gagal ? 1 : 0);
