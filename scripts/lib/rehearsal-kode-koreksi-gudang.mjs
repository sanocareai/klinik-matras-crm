// Pemeriksaan KODE BARU terhadap data restore yang SUDAH dimigrasi (rehearsal mode image; BACA-SAJA — tidak ada tulisan). Dijalankan di container backend baru dengan DATABASE_URL = DB rehearsal.
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const { keadaanKoreksiGR, daftarKoreksi } = await import("/app/src/services/warehouseCorrection.js");
const { jalurDokumen, JALUR, TIPE } = await import("/app/src/services/warehouseCoverage.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d ? " — " + d : "")); };
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const sebelumSM = await hitung("select count(*)::int n from stock_movements");
const grs = await prisma.goodsReceipt.findMany({ select: { id: true, receiptNumber: true, status: true, purchaseOrderId: true }, orderBy: { receiptNumber: "asc" } });
cek("data restore memuat penerimaan nyata", grs.length > 0, "n=" + grs.length);
const daftar = await daftarKoreksi(prisma, {});
cek("daftar koreksi kosong pada data restore (tanpa backfill)", (daftar.koreksi ?? []).length === 0);
let nSelesai = 0;
for (const g of grs) {
  const j = jalurDokumen(TIPE.GOODS_RECEIPT, g);
  const harap = g.status === "REJECTED" ? JALUR.FINAL : g.status !== "COMPLETED" ? JALUR.EDIT_DRAF : g.purchaseOrderId ? JALUR.ALUR_RESMI : JALUR.KOREKSI_UI;
  cek(`jalur ${g.receiptNumber} (${g.status}${g.purchaseOrderId ? ", PO" : ""}) = ${harap}`, j.jalur === harap, j.jalur);
  if (g.status === "COMPLETED") {
    nSelesai += 1;
    const k = await keadaanKoreksiGR(prisma, g.id);
    cek(`keadaan koreksi ${g.receiptNumber}: bisaMengajukan sesuai status, tanpa koreksi tertunda, baris terbaca`, k.bisaMengajukan === true && k.koreksiTertunda === 0 && Array.isArray(k.baris) && k.baris.length > 0, "baris=" + k.baris.length);
  } else {
    const k = await keadaanKoreksiGR(prisma, g.id).catch((e) => ({ galat: e.message }));
    cek(`keadaan koreksi ${g.receiptNumber} (belum masuk stok): tidak bisa diajukan`, k.bisaMengajukan === false || !!k.galat, k.galat ? "galat sah: " + k.galat.slice(0, 60) : "");
  }
}
cek("ada penerimaan COMPLETED nyata yang diperiksa", nSelesai > 0, "n=" + nSelesai);
cek("tidak ada pergerakan stok yang ditulis oleh pemeriksaan ini", (await hitung("select count(*)::int n from stock_movements")) === sebelumSM);
cek("tidak ada koreksi yang ditulis oleh pemeriksaan ini", (await hitung("select count(*)::int n from warehouse_corrections")) === 0);
await prisma.$disconnect();
console.log("REHEARSAL_KODE_BARU gagal=" + gagal);
process.exit(gagal ? 1 : 0);
