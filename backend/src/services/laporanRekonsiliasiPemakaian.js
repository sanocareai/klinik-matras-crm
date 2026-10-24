// LAPORAN REKONSILIASI PEMAKAIAN (baca-saja): kejanggalan per bahan & per order, yang bisa tampil segera vs menunggu koreksi, dampak stok dan HPP.
// Semua angka berasal dari catatan historis + ledger SAAT INI; tidak menulis apa pun. Nilai HPP = rata-rata tertimbang sampai tanggal pemakaian (dasar yang sama dengan valuasi beku) — bukan angka final.
import { terapkanKeadaanEfektif } from "./catatanPemakaianHistoris.js";
import { dasarHargaRataRata } from "./finance/posting/inventory.js";
import { rencanakanPosting } from "./postingPemakaianHistoris.js";
import { STATE, r4 } from "../lib/domain/pemakaianHistoris.js";

const bulanDari = (n) => { const d = n.usedAt ? new Date(new Date(n.usedAt).getTime() + 7 * 3600_000) : null; if (!d) return "?"; return d.getUTCMonth() === 8 ? "SEP" : d.getUTCMonth() === 9 ? "OKT" : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const tambah = (o, k, v = 1) => { o[k] = (o[k] ?? 0) + v; return o; };
const blok = (n) => (n.flags ?? []).filter((f) => f.tingkat === "BLOK");

export async function susunLaporan(db) {
  const notes = await terapkanKeadaanEfektif(db, await db.unitUsageNote.findMany({ include: { material: { select: { id: true, code: true, name: true, unit: true } }, unit: { select: { unitCode: true, status: true } } }, orderBy: [{ orderNumber: "asc" }, { sourceRow: "asc" }] }));
  const excel = notes.filter((n) => n.origin === "EXCEL"); const ledger = notes.filter((n) => n.origin === "LEDGER");
  const tampil = excel.filter((n) => n.state !== STATE.TIDAK_DIHITUNG);

  // ── ringkasan
  const perState = {}; const perBulan = {};
  for (const n of excel) { tambah(perState, n.state); const b = (perBulan[bulanDari(n)] ??= { total: 0, perState: {}, order: new Set() }); b.total++; tambah(b.perState, n.state); b.order.add(n.orderNumber); }
  const ordersTampil = new Set(tampil.map((n) => n.orderNumber));
  const ringkas = {
    catatanExcel: excel.length, catatanLedger: ledger.length, orderUnik: new Set(excel.map((n) => n.orderNumber)).size, perState,
    perBulan: Object.fromEntries(Object.entries(perBulan).map(([k, v]) => [k, { total: v.total, order: v.order.size, perState: v.perState }])),
    bisaTampilSegera: { catatan: tampil.length, order: ordersTampil.size }, // semua catatan (kecuali jumlah 0) tampil di Produksi begitu diimpor, termasuk yang belum bisa jadi pengeluaran stok
    menungguKoreksi: { catatan: excel.filter((n) => n.state === STATE.PERLU_DICEK).length, order: new Set(excel.filter((n) => n.state === STATE.PERLU_DICEK).map((n) => n.orderNumber)).size },
    siapPosting: { catatan: excel.filter((n) => n.state === STATE.SIAP_POSTING).length },
    sudahDiStok: { catatan: excel.filter((n) => [STATE.TERCATAT_DI_STOK, STATE.DIPOSTING].includes(n.state)).length },
  };

  // ── kejanggalan per bahan dan per order
  const bahanMap = new Map(); const orderMap = new Map();
  for (const n of notes.filter((x) => x.state === STATE.PERLU_DICEK)) {
    const kunciB = n.material?.code ?? `(tanpa kode) ${n.rawName}`;
    const b = bahanMap.get(kunciB) ?? { bahan: kunciB, nama: n.material?.name ?? n.rawName, satuan: n.material?.unit ?? n.rawUom, catatan: 0, order: new Set(), penanda: {}, contoh: null }; b.catatan++; b.order.add(n.orderNumber);
    for (const f of blok(n)) tambah(b.penanda, f.kode); b.contoh ??= blok(n)[0] ? `${n.orderNumber}: ${blok(n)[0].teks} ${blok(n)[0].aksi}` : null; bahanMap.set(kunciB, b);
    const o = orderMap.get(n.orderNumber) ?? { order: n.orderNumber, unit: n.unit?.unitCode ?? null, statusUnit: n.unit?.status ?? null, bulan: bulanDari(n), catatanPerluDicek: 0, penanda: {}, bahan: new Set(), tindakan: [] }; o.catatanPerluDicek++; blok(n).forEach((f) => tambah(o.penanda, f.kode)); o.bahan.add(kunciB);
    if (o.tindakan.length < 3 && blok(n)[0]) o.tindakan.push(`${n.material?.code ?? n.rawName}: ${blok(n)[0].aksi}`); orderMap.set(n.orderNumber, o);
  }
  const kejanggalanPerBahan = [...bahanMap.values()].map((b) => ({ ...b, order: b.order.size })).sort((a, b) => b.catatan - a.catatan);
  const kejanggalanPerOrder = [...orderMap.values()].map((o) => ({ ...o, bahan: [...o.bahan] })).sort((a, b) => a.order.localeCompare(b.order));
  const flagTotal = {}; for (const n of notes.filter((x) => x.state === STATE.PERLU_DICEK)) for (const f of blok(n)) tambah(flagTotal, f.kode);

  // ── dampak stok + HPP bila rencana siap-posting dijalankan
  const rencana = await rencanakanPosting(db);
  const idMat = [...new Set(rencana.transaksi.map((t) => t.materialId))];
  const saldoRows = idMat.length ? await db.stockMovement.groupBy({ by: ["materialId"], where: { materialId: { in: idMat } }, _sum: { qty: true } }) : [];
  const saldo = new Map(saldoRows.map((r) => [r.materialId, Number(r._sum.qty)]));
  const perBahanPosting = new Map(); let hppPosting = 0; let tanpaHarga = 0;
  for (const t of rencana.transaksi) {
    const d = await dasarHargaRataRata(db, t.materialId, { asOf: t.usedAt });
    const nilai = d.harga == null ? null : Math.round(t.qty * Number(d.harga)); if (nilai == null) tanpaHarga++; else hppPosting += nilai;
    const p = perBahanPosting.get(t.materialId) ?? { kode: t.kodeBahan, satuan: t.satuan, transaksi: 0, qty: 0, saldoSekarang: saldo.get(t.materialId) ?? 0, nilaiHPP: 0, tanpaHarga: 0 }; p.transaksi++; p.qty = r4(p.qty + t.qty); if (nilai == null) p.tanpaHarga++; else p.nilaiHPP += nilai; perBahanPosting.set(t.materialId, p);
  }
  const dampakStok = [...perBahanPosting.values()].map((p) => ({ ...p, saldoSesudah: r4(p.saldoSekarang - p.qty) })).sort((a, b) => a.kode.localeCompare(b.kode));
  const negatif = dampakStok.filter((p) => p.saldoSesudah < -1e-6);

  // ── koreksi ISSUE lama (selisih qty × harga hari ini) dan nilai Excel yang tertahan
  let hppKoreksi = 0; const koreksiBahan = new Map();
  for (const n of excel.filter((x) => (x.flags ?? []).some((f) => f.kode === "ISSUE_LAMA_BERBEDA"))) {
    const f = n.flags.find((x) => x.kode === "ISSUE_LAMA_BERBEDA"); const k = `${n.unitId}|${n.materialId}`; if (koreksiBahan.has(k)) continue;
    const d = await dasarHargaRataRata(db, n.materialId, { asOf: new Date() }); const nilai = d.harga == null ? null : Math.round(f.data.selisih * Number(d.harga));
    koreksiBahan.set(k, { order: n.orderNumber, bahan: n.material.code, satuan: n.material.unit, ledger: f.data.ledger, excel: f.data.excel, selisih: f.data.selisih, nilai }); if (nilai != null) hppKoreksi += nilai;
  }
  const tertahanNilaiExcel = excel.filter((n) => n.state === STATE.PERLU_DICEK).reduce((s, n) => { const t = Number(String(n.rawTotal ?? "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")); return s + (Number.isFinite(t) ? t : 0); }, 0);
  return {
    ringkas, flagTotal, kejanggalanPerBahan, kejanggalanPerOrder,
    siapPosting: { transaksi: rencana.jumlah, orderUnik: rencana.orderUnik, hash: rencana.hash, dampakStok, bahanSaldoNegatif: negatif },
    dampakHPP: { siapPostingEstimasi: hppPosting, siapPostingTanpaHarga: tanpaHarga, koreksiIssueLamaEstimasi: hppKoreksi, koreksiIssueLamaDaftar: [...koreksiBahan.values()], tertahanNilaiMenurutExcel: Math.round(tertahanNilaiExcel),
      catatan: "Estimasi memakai harga rata-rata tertimbang sampai tanggal pemakaian (siap posting) atau hari ini (koreksi). Bukan HPP final; yang tanpa harga perolehan tidak dihitung (bukan Rp0). Nilai tertahan = Total Biaya Bahan menurut Excel." },
  };
}
