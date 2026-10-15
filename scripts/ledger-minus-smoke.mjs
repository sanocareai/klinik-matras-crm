// SMOKE PASCA-SWITCH hotfix "penerimaan pada saldo minus" — BACA-SAJA. Dijalankan DI DALAM container backend (stdin): node --input-type=module - < berkas ini.
// Tidak pernah menulis data: postStockMovement diberi `tx` TIRUAN — pembacaan (saldo ledger, material) memakai DB produksi sungguhan, kunci baris dilewati, dan `stockMovement.create` hanya
// MENANGKAP argumen. Jumlah baris tabel ledger/jurnal/penyesuaian dibandingkan sebelum-sesudah di proses yang sama. (SELECT FOR UPDATE ditolak Postgres di transaksi READ ONLY, jadi READ ONLY tidak dipakai.)
// Env: SRC_DIR (default /app/src), GR_NOMOR (default GR-141026-01), GR_SEBELUM (ringkasan GR sebelum rilis; harus sama persis).
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const SRC = process.env.SRC_DIR || "/app/src";
const GR_NOMOR = process.env.GR_NOMOR || "GR-141026-01";
const { postStockMovement, LedgerError } = await import(`${SRC}/services/inventoryLedger.js`);

let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 220) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
const n1 = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);

function stubTx() {
  const creates = [];
  return {
    creates,
    $queryRawUnsafe: async (sql, ...a) => (/FOR UPDATE/i.test(sql) ? [] : prisma.$queryRawUnsafe(sql, ...a)),
    $queryRaw: (...a) => prisma.$queryRaw(...a),
    material: prisma.material,
    stockMovement: { create: async (args) => { creates.push(args.data); return { ...args.data, id: "stub", unitId: null, material: { code: "?", name: "?", unit: "?" } }; } },
  };
}
const coba = async (type, materialId, qty) => {
  const tx = stubTx();
  try { await postStockMovement(tx, { materialId, type, qty }); return { ok: true, creates: tx.creates }; }
  catch (e) { return { ok: false, galat: e, creates: tx.creates }; }
};
const saldoDari = async (materialId) => Number((await prisma.$queryRaw`SELECT COALESCE(SUM(qty),0)::float AS s FROM stock_movements WHERE material_id = ${materialId}::uuid`)[0].s);

const SEBELUM = { mov: await n1("select count(*)::int n from stock_movements"), jurnal: await n1("select count(*)::int n from fin_journal_entries"), adj: await n1("select count(*)::int n from stock_adjustment_requests"), opname: await n1("select count(*)::int n from stock_counts") };

// ── A. GR target tidak tersentuh oleh rilis ──
const gr = await prisma.goodsReceipt.findFirst({ where: { receiptNumber: GR_NOMOR }, include: { lines: { include: { material: { select: { id: true, code: true, unit: true } } } } } });
if (!gr) skip("GR target", `${GR_NOMOR} tidak ditemukan`); else {
  const mov = await prisma.stockMovement.count({ where: { goodsReceiptId: gr.id } });
  const jur = await prisma.finJournalEntry.count({ where: { sourceId: gr.id } });
  const ringkas = `${gr.status}|${gr.lines.length}|${mov}|${jur}`;
  rec(`${GR_NOMOR} tidak diposting oleh rilis: tetap sama seperti sebelum rilis`, !process.env.GR_SEBELUM || process.env.GR_SEBELUM === ringkas, `sekarang=${ringkas} sebelum=${process.env.GR_SEBELUM || "-"}`);
  rec(`${GR_NOMOR}: 0 movement dan 0 jurnal (belum diposting; Gudang sendiri yang menekan Simpan ke Stok)`, mov === 0 && jur === 0, `mov=${mov} jurnal=${jur}`);

  // ── B. Aturan penerimaan POSITIF: setiap baris diterima-baik lolos pemeriksaan saldo (saldo produksi nyata) ──
  const diterima = gr.lines.filter((l) => Number(l.acceptedQty) > 0);
  let lolos = 0; const rinci = [];
  for (const l of diterima) {
    const saldo = await saldoDari(l.materialId);
    const r = await coba("RECEIPT", l.materialId, Number(l.acceptedQty));
    if (r.ok && r.creates.length === 1 && Number(r.creates[0].qty) === Number(l.acceptedQty)) lolos += 1;
    rinci.push(`${l.material.code}: ${saldo} + ${Number(l.acceptedQty)} → ${r.ok ? "lolos" : "DITOLAK: " + r.galat.message}`);
  }
  rec(`penerimaan positif lolos untuk SEMUA ${diterima.length} baris diterima-baik GR ${GR_NOMOR} (termasuk yang saldonya minus)`, diterima.length > 0 && lolos === diterima.length, `${lolos}/${diterima.length}`);
  for (const s of rinci) console.log("  INFO  " + s);
}

// ── C. Aturan pengeluaran: ISSUE/WASTE/ADJUSTMENT−/TRANSFER− pada saldo minus tetap DITOLAK ──
const minus = (await prisma.$queryRawUnsafe(`select m.id, m.code, s.saldo from materials m join (select material_id, sum(qty)::float saldo from stock_movements group by 1) s on s.material_id = m.id where s.saldo < -0.000001 order by (m.code = 'LIST-WIBING-ABU') desc, s.saldo asc limit 1`))[0];
if (!minus) skip("penolakan pengeluaran pada saldo minus", "tidak ada material berminus saat ini");
else {
  console.log(`  INFO  material uji saldo minus: ${minus.code} (${minus.saldo})`);
  for (const t of ["ISSUE", "WASTE", "ADJUSTMENT", "TRANSFER"]) {
    const r = await coba(t, minus.id, -1);
    rec(`${t} -1 pada saldo minus DITOLAK (pesan tersedia/butuh + arahan opname), tidak menulis`, !r.ok && r.galat instanceof LedgerError && new RegExp(`tidak cukup — tersedia ${String(minus.saldo).replace(".", "\\.")}, butuh 1`).test(r.galat.message) && /opname/.test(r.galat.message) && r.creates.length === 0, r.galat?.message);
  }
  const rp = await coba("RECEIPT", minus.id, 5);
  rec("RECEIPT +5 pada saldo minus yang sama LOLOS (aturan baru)", rp.ok && rp.creates.length === 1, rp.galat?.message);
}
// ── D. Pengeluaran pada saldo positif: batas tepat nol tetap berlaku ──
const plus = (await prisma.$queryRawUnsafe(`select m.id, m.code, s.saldo from materials m join (select material_id, sum(qty)::float saldo from stock_movements group by 1) s on s.material_id = m.id where s.saldo >= 1 order by s.saldo asc limit 1`))[0];
if (!plus) skip("batas pengeluaran pada saldo positif", "tidak ada material bersaldo positif");
else {
  console.log(`  INFO  material uji saldo positif: ${plus.code} (${plus.saldo})`);
  const lebih = await coba("ISSUE", plus.id, -(plus.saldo + 1));
  rec("ISSUE melebihi saldo positif DITOLAK (tanpa arahan opname) dan tidak menulis", !lebih.ok && /tidak cukup — tersedia/.test(lebih.galat.message) && !/opname/.test(lebih.galat.message) && lebih.creates.length === 0, lebih.galat?.message);
  const pas = await coba("ISSUE", plus.id, -plus.saldo);
  rec("ISSUE tepat sebesar saldo (hasil 0) tetap LOLOS", pas.ok && pas.creates.length === 1, pas.galat?.message);
}

// ── E. Tidak ada tulisan ──
const SESUDAH = { mov: await n1("select count(*)::int n from stock_movements"), jurnal: await n1("select count(*)::int n from fin_journal_entries"), adj: await n1("select count(*)::int n from stock_adjustment_requests"), opname: await n1("select count(*)::int n from stock_counts") };
rec("smoke tidak menulis: jumlah movement, jurnal, permintaan penyesuaian, dan stock count tidak berubah selama smoke", JSON.stringify(SEBELUM) === JSON.stringify(SESUDAH), `${JSON.stringify(SEBELUM)} -> ${JSON.stringify(SESUDAH)}`);

await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
