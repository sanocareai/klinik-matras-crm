// PRATINJAU manifest posting historis (BACA-SAJA) untuk UI Admin: apa yang akan diposting, dampaknya pada stok dan HPP, apa yang tertahan, dan berapa yang belum dijurnal.
// Tidak menulis apa pun. Memakai rencana EFEKTIF (rencanakanPosting) sehingga angka yang ditampilkan = yang akan dieksekusi mesin. Hash rencana ikut dikembalikan sebagai pin persetujuan.
import { dasarHargaRataRata } from "./finance/posting/inventory.js";
import { rencanakanPosting } from "./postingPemakaianHistoris.js";
import { terapkanKeadaanEfektif } from "./catatanPemakaianHistoris.js";
import { r4 } from "../lib/domain/pemakaianHistoris.js";

const memo = new Map(); // hash rencana → { t, janji } (30 dtk): SATU perhitungan harga untuk semua tab/pengguna serentak (single-flight; yang gagal dibuang)
const TTL = 30_000;

export async function pratinjauPosting(db, { unitIds = null } = {}) {
  const rencana = await rencanakanPosting(db, { unitIds });
  const ada = memo.get(rencana.hash); if (ada && Date.now() - ada.t < TTL) return ada.janji;
  const janji = hitungPratinjau(db, rencana);
  memo.set(rencana.hash, { t: Date.now(), janji }); if (memo.size > 20) memo.delete(memo.keys().next().value);
  janji.catch(() => { if (memo.get(rencana.hash)?.janji === janji) memo.delete(rencana.hash); });
  return janji;
}

async function hitungPratinjau(db, rencana) {

  const cacheHarga = new Map(); // bahan|tanggal → harga
  const harga = async (t) => { const k = `${t.materialId}|${t.tanggal}`; if (!cacheHarga.has(k)) { const d = await dasarHargaRataRata(db, t.materialId, { asOf: new Date(t.usedAt) }); cacheHarga.set(k, d.harga == null ? null : Number(d.harga)); } return cacheHarga.get(k); };
  const materialIds = [...new Set(rencana.transaksi.map((t) => t.materialId))];
  const saldoRows = materialIds.length ? await db.stockMovement.groupBy({ by: ["materialId"], where: { materialId: { in: materialIds } }, _sum: { qty: true } }) : [];
  const saldoNow = new Map(saldoRows.map((r) => [r.materialId, Number(r._sum.qty ?? 0)]));

  const perOrder = new Map(); const perBahan = new Map();
  let hppBerbukti = 0; let tanpaHarga = 0;
  for (const t of rencana.transaksi) {
    const h = await harga(t); const nilai = h == null ? null : Math.round(t.qty * h);
    if (nilai == null) tanpaHarga++; else hppBerbukti += nilai;
    const o = perOrder.get(t.unitId) ?? { unitId: t.unitId, unitCode: t.unitCode, orderNumber: t.orderNumber, statusUnit: t.statusUnit, trx: [], nilaiBerbukti: 0, trxTanpaHarga: 0 };
    o.trx.push({ kunci: t.kunci, kodeBahan: t.kodeBahan, satuan: t.satuan, qty: t.qty, tanggal: t.tanggal, hargaSatuan: h, nilai }); if (nilai == null) o.trxTanpaHarga++; else o.nilaiBerbukti += nilai;
    perOrder.set(t.unitId, o);
    const b = perBahan.get(t.materialId) ?? { materialId: t.materialId, kode: t.kodeBahan, satuan: t.satuan, trx: 0, qty: 0, nilai: 0, trxTanpaHarga: 0, saldoSekarang: r4(saldoNow.get(t.materialId) ?? 0) };
    b.trx++; b.qty = r4(b.qty + t.qty); if (nilai == null) b.trxTanpaHarga++; else b.nilai += nilai; perBahan.set(t.materialId, b);
  }
  const bahan = [...perBahan.values()].map((b) => ({ ...b, saldoSesudah: r4(b.saldoSekarang - b.qty) })).sort((a, b) => a.kode.localeCompare(b.kode));

  // catatan yang TERTAHAN (perlu dicek) pada order yang sama — dengan alasan (penanda) dari keadaan efektif
  const unitList = [...perOrder.keys()];
  const catatan = unitList.length ? await terapkanKeadaanEfektif(db, await db.unitUsageNote.findMany({ where: { unitId: { in: unitList }, origin: "EXCEL", state: "PERLU_DICEK" }, select: { id: true, unitId: true, origin: true, state: true, flags: true, rawName: true, rawQty: true, rawUom: true } })) : [];
  let tertahanTotal = 0;
  for (const n of catatan) {
    if (n.state !== "PERLU_DICEK") continue;
    const o = perOrder.get(n.unitId); if (!o) continue;
    (o.tertahan ??= []).push({ nama: n.rawName, nilaiAsli: `${n.rawQty ?? "—"} ${n.rawUom ?? ""}`.trim(), alasan: (n.flags ?? []).filter((f) => f.tingkat === "BLOK").map((f) => f.teks).slice(0, 2) }); tertahanTotal++;
  }
  const order = [...perOrder.values()].map((o) => ({ ...o, tertahan: o.tertahan ?? [], jumlahTertahan: (o.tertahan ?? []).length })).sort((a, b) => a.orderNumber.localeCompare(b.orderNumber));
  const parsial = tanpaHarga > 0 || tertahanTotal > 0;
  const hasil = {
    hash: rencana.hash, jumlahTrx: rencana.jumlah, jumlahOrder: rencana.orderUnik, unitIds: unitList,
    hpp: {
      status: parsial ? "PARSIAL" : "LENGKAP", hppBerbukti, trxTanpaHarga: tanpaHarga, catatanTertahan: tertahanTotal, jurnalDibuat: false,
      selisihBelumDijurnal: hppBerbukti,
      catatan: "Posting hanya mengurangi KUANTITAS stok dan membekukan nilai per transaksi. Jurnal HPP TIDAK dibuat (kebijakan Finance): nilai persediaan di buku besar belum berkurang sebesar selisih ini sampai keputusan HPP final.",
    },
    dampakStok: { bahan: bahan.length, bahanNegatifSesudah: bahan.filter((b) => b.saldoSesudah < -1e-6).length },
    bahan, order,
  };
  return hasil;
}
