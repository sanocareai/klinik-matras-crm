import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000"; // rehearsal menjalankan kode smoke YANG SAMA terhadap salinan restore
const APP = process.env.APP_DIR ?? "/app";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE "TIDAK MENULIS" penjaga satuan berubah sejak penerimaan: hanya membaca. Dibuktikan hitung baris sebelum vs sesudah.
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
const JEJAK = [["materials", "select count(*)::int n from materials"], ["transisi", "select count(*)::int n from material_unit_transitions"], ["stock_movements", "select count(*)::int n from stock_movements"], ["retur_supplier", "select count(*)::int n from supplier_returns"], ["retur_supplier_baris", "select count(*)::int n from supplier_return_lines"],
  ["retur_pelanggan", "select count(*)::int n from return_records"], ["jurnal", "select count(*)::int n from fin_journal_entries"], ["goods_receipts", "select count(*)::int n from goods_receipts"], ["gr_lines", "select count(*)::int n from goods_receipt_lines"], ["harga_berlaku", "select count(*)::int n from material_harga_berlaku"],
  ["satuan_master", "select md5(coalesce(string_agg(code || ':' || unit::text, ',' order by code), '')) n from materials"]];
const jejak = async () => { const o = {}; for (const [k, q] of JEJAK) { try { const r = (await prisma.$queryRawUnsafe(q))[0].n; o[k] = typeof r === "string" ? r : Number(r); } catch { o[k] = null; } } return o; };
const s0 = await jejak();
rec("health 200", (await fetch(BASE + "/api/health").then((r) => r.status, () => 0)) === 200);
const modul = await imp("src/services/referensiHargaSatuan.js").catch(() => null);
rec("penjaga satuan terpasang di kode baru (transisiSesudah + kode SATUAN_BERUBAH_SEJAK_PENERIMAAN)", typeof modul?.transisiSesudah === "function" && modul?.KODE_SATUAN_BERUBAH === "SATUAN_BERUBAH_SEJAK_PENERIMAAN");
const { kapasitasBaris } = await imp("src/services/finance/returSupplier.js");
const baris = await prisma.$queryRawUnsafe("select l.id::text id, l.material_id::text mid, g.id::text gid from goods_receipt_lines l join goods_receipts g on g.id = l.goods_receipt_id where g.status::text = 'COMPLETED' and g.purchase_order_id is not null and l.purchase_order_line_id is not null order by g.created_at desc, l.id limit 60");
if (!baris.length) skip("kapasitas retur supplier per baris penerimaan", "tidak ada baris penerimaan PO selesai");
else {
  let kena = 0; let harapan = 0; let diperiksa = 0; const contoh = [];
  for (const b of baris) {
    const k = await kapasitasBaris(prisma, b.id); if (!k) continue; diperiksa += 1;
    const ada = k.blokir.some((x) => x.kode === "SATUAN_BERUBAH_SEJAK_PENERIMAAN");
    // harapan INDEPENDEN: ada transisi satuan bahan itu sesudah pergerakan penerimaan pertama baris ini
    const [{ n }] = await prisma.$queryRawUnsafe("select count(*)::int n from material_unit_transitions t where t.material_id = $1::uuid and t.created_at > coalesce((select min(s.created_at) from stock_movements s where s.goods_receipt_id = $2::uuid and s.material_id = $1::uuid and s.type::text = 'RECEIPT'), (select created_at from goods_receipts where id = $2::uuid))", b.mid, b.gid);
    if (ada) kena += 1; if (n > 0) harapan += 1; if (ada !== (n > 0) && contoh.length < 3) contoh.push(b.id);
  }
  rec("kapasitas retur: penjaga satuan berlaku TEPAT pada baris penerimaan yang bahan-nya bertransisi sesudah penerimaan (tanpa positif/negatif palsu)", diperiksa > 0 && kena === harapan && contoh.length === 0, `diperiksa ${diperiksa}; terblokir ${kena}; diharapkan ${harapan}${contoh.length ? "; beda " + contoh.join(",") : ""}`);
}
const s1 = await jejak(); rec("SMOKE tidak menulis: master, satuan master, transisi, stok, retur supplier/pelanggan, jurnal, GR, harga — sama", Object.keys(s0).every((k) => s0[k] === s1[k]), JSON.stringify({ s0, s1 }));
console.log(`SMOKE_HASIL fail=${fail} skip=${dilewati}`);
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
