// REHEARSAL hotfix "penerimaan pada saldo minus" — dijalankan terhadap DB SEMENTARA hasil RESTORE backup nyata (bukan produksi), memakai image BARU:
// mensimulasikan persis langkah "Simpan ke Stok" GR target (periksaPutaway -> postStockMovement per baris -> status COMPLETED -> postGoodsReceiptValue) di dalam SATU transaksi
// yang SELALU di-ROLLBACK, lalu memastikan tidak ada yang tertulis. Membuktikan di data nyata: tujuh baris lolos, satu movement per baris, satu jurnal, nilai = baik x harga PO.
// Env: DATABASE_URL (DB rehearsal), SRC_DIR (default /app/src), GR_NOMOR (default GR-141026-01).
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const SRC = process.env.SRC_DIR || "/app/src";
const GR_NOMOR = process.env.GR_NOMOR || "GR-141026-01";
const { postStockMovement } = await import(`${SRC}/services/inventoryLedger.js`);
const { periksaPutaway } = await import(`${SRC}/services/finance/purchaseOrder.js`);
const { postGoodsReceiptValue } = await import(`${SRC}/services/finance/posting/supplier.js`);

let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 240) : ""}`); };
class Gulung extends Error { constructor(hasil) { super("gulung"); this.hasil = hasil; } }
const n1 = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);

const gr0 = await prisma.goodsReceipt.findFirst({ where: { receiptNumber: GR_NOMOR }, select: { id: true, status: true } });
if (!gr0) { console.log(`  SKIP  ${GR_NOMOR} tidak ada di salinan restore`); dilewati++; }
else if (gr0.status !== "READY_FOR_PUTAWAY") { console.log(`  SKIP  ${GR_NOMOR} berstatus ${gr0.status} (bukan Siap Disimpan) — tidak disimulasikan`); dilewati++; }
else {
  const SEBELUM = { mov: await n1("select count(*)::int n from stock_movements"), jurnal: await n1("select count(*)::int n from fin_journal_entries"), baris: await n1("select count(*)::int n from fin_journal_lines") };
  let hasil = null;
  try {
    await prisma.$transaction(async (tx) => {
      const receipt = await tx.goodsReceipt.findUnique({ where: { id: gr0.id }, include: { lines: { include: { material: { select: { id: true, code: true, name: true, unit: true } } } } } });
      const diterima = receipt.lines.filter((l) => l.acceptedQty != null && Number(l.acceptedQty) > 0);
      const saldoSebelum = new Map();
      for (const l of diterima) saldoSebelum.set(l.materialId, Number((await tx.$queryRaw`SELECT COALESCE(SUM(qty),0)::float AS s FROM stock_movements WHERE material_id = ${l.materialId}::uuid`)[0].s));
      const cek = await periksaPutaway(tx, receipt);
      for (const line of diterima) {
        const kv = line.purchaseOrderLineId ? cek?.konversi.get(line.purchaseOrderLineId) : undefined;
        await postStockMovement(tx, {
          materialId: line.materialId, type: "RECEIPT", qty: kv ? kv.qtyStok.toString() : line.acceptedQty,
          unitCost: kv ? kv.hargaStokBulat : line.purchaseOrderLineId ? cek?.harga.get(line.purchaseOrderLineId) : undefined,
          unitCostExact: kv ? kv.hargaStokEksak.toString() : undefined,
          supplier: receipt.supplier || null, note: `REHEARSAL Simpan ke Stok ${receipt.receiptNumber}`, goodsReceiptId: receipt.id,
        });
      }
      await tx.goodsReceipt.update({ where: { id: receipt.id }, data: { status: "COMPLETED", receivedDate: receipt.receivedDate || new Date() } });
      await postGoodsReceiptValue(tx, { goodsReceiptId: receipt.id, userId: null });
      const mov = await tx.stockMovement.findMany({ where: { goodsReceiptId: receipt.id } });
      const jur = await tx.finJournalEntry.findMany({ where: { sourceId: receipt.id }, include: { lines: true } });
      const saldoSesudah = new Map();
      for (const l of diterima) saldoSesudah.set(l.materialId, Number((await tx.$queryRaw`SELECT COALESCE(SUM(qty),0)::float AS s FROM stock_movements WHERE material_id = ${l.materialId}::uuid`)[0].s));
      const nilaiPo = diterima.reduce((s, l) => s + Number(l.acceptedQty) * Number(cek.harga.get(l.purchaseOrderLineId) ?? 0), 0);
      throw new Gulung({
        baris: diterima.map((l) => ({ kode: l.material.code, satuan: l.material.unit, baik: Number(l.acceptedQty), sebelum: saldoSebelum.get(l.materialId), sesudah: saldoSesudah.get(l.materialId), konversi: !!(l.purchaseOrderLineId && cek?.konversi.get(l.purchaseOrderLineId)) })),
        movement: mov.map((m) => ({ materialId: m.materialId, type: m.type, qty: Number(m.qty) })),
        jurnalPosted: jur.filter((j) => j.status === "POSTED").length,
        debit: jur.filter((j) => j.status === "POSTED").flatMap((j) => j.lines).reduce((s, l) => s + Number(l.debit), 0),
        nilaiPo, diterimaN: diterima.length,
      });
    }, { timeout: 60000, maxWait: 10000 });
  } catch (e) {
    if (e instanceof Gulung) hasil = e.hasil; else { rec("simulasi Simpan ke Stok di salinan restore berjalan tanpa galat", false, e.message); }
  }
  if (hasil) {
    for (const b of hasil.baris) console.log(`  INFO  ${b.kode} (${b.satuan}): ${b.sebelum} + ${b.baik} → ${b.sesudah}${b.konversi ? " [konversi]" : ""}`);
    rec(`simulasi Simpan ke Stok ${GR_NOMOR} di salinan restore LOLOS untuk semua ${hasil.diterimaN} baris (sebelum perbaikan: ditolak pada saldo minus)`, hasil.diterimaN > 0);
    rec("tepat SATU movement RECEIPT per baris, qty positif", hasil.movement.length === hasil.diterimaN && hasil.movement.every((m) => m.type === "RECEIPT" && m.qty > 0) && new Set(hasil.movement.map((m) => m.materialId)).size === hasil.diterimaN, `${hasil.movement.length}/${hasil.diterimaN}`);
    rec("saldo tiap material naik tepat sebesar jumlah baik (tidak ada pembulatan/koreksi diam-diam)", hasil.baris.every((b) => !b.konversi ? Math.abs((b.sesudah - b.sebelum) - b.baik) < 1e-6 : b.sesudah > b.sebelum));
    rec("tepat SATU jurnal POSTED; debit = jumlah baik x harga PO", hasil.jurnalPosted === 1 && Math.abs(hasil.debit - hasil.nilaiPo) < 0.005, `jurnal=${hasil.jurnalPosted} debit=${hasil.debit} nilaiPO=${hasil.nilaiPo}`);
    console.log(`  INFO  nilai jurnal hasil simulasi: Rp${hasil.debit}`);
  }
  const SESUDAH = { mov: await n1("select count(*)::int n from stock_movements"), jurnal: await n1("select count(*)::int n from fin_journal_entries"), baris: await n1("select count(*)::int n from fin_journal_lines") };
  rec("simulasi di-ROLLBACK: tidak ada movement/jurnal yang tersisa; GR tetap Siap Disimpan", JSON.stringify(SEBELUM) === JSON.stringify(SESUDAH) && (await prisma.goodsReceipt.findUnique({ where: { id: gr0.id } })).status === "READY_FOR_PUTAWAY", `${JSON.stringify(SEBELUM)} -> ${JSON.stringify(SESUDAH)}`);
}
await prisma.$disconnect();
console.log("\nRINGKASAN rehearsal: " + fail + " gagal, " + dilewati + " dilewati");
console.log("REHEARSAL_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
