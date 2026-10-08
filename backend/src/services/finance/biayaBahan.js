// JEJAK BIAYA BAHAN PER UNIT (read-model + pembekuan nilai).
//
// PRINSIP (jangan dilanggar):
//   1. Stok keluar/masuk HANYA lewat command Gudang (postStockMovement). File ini tidak menulis stok maupun jurnal. Satu-satunya tulisan adalah baris
//      append-only fin_stock_movement_valuations, di transaksi yang SAMA dengan pergerakan stoknya (hook di inventoryLedger.postStockMovement).
//   2. Nilai & dasar harga DIBEKUKAN saat pergerakan diposting. Biaya historis tidak berubah ketika ada penerimaan bertanggal mundur atau harga rata-rata bergeser.
//   3. Biaya persediaan = menurut HARGA PO/perolehan (rata-rata tertimbang, metode yang sama dengan jurnal HPP). Selisih harga FAKTUR dihitung terpisah dan
//      TIDAK pernah dijumlahkan ke biaya persediaan (di buku besar ia masuk akun Selisih Harga Pembelian).
//   4. Tidak ada Rp0 palsu: TANPA_HARGA → nilai NULL; pergerakan lama tanpa pembekuan → ESTIMASI_HISTORIS (BELUM_FINAL, tidak dijumlahkan ke total pasti).
//   5. Retur mengurangi biaya HANYA saat Gudang menerimanya (baris RETURN di ledger). Retur yang masih PENDING dilaporkan sebagai BELUM_FINAL.
//   6. Catatan pemakaian PIC (production_step_evidence_v2.payload.materials) hanya DIBACA sebagai pembanding fisik; tidak pernah menjadi stok/jurnal kedua.
//   7. Unit tidak menyimpan total biaya; semuanya dihitung dari ledger + pembekuan.
import { dasarHargaRataRata } from "./posting/inventory.js";
import { Decimal, ZERO, toMoney, moneyToNumber } from "./money.js";

const JENIS_BIAYA = { ISSUE: "PEMAKAIAN", RETURN: "RETUR", WASTE: "SUSUT", ADJUSTMENT: "PENYESUAIAN" };
export const TIPE_DINILAI = Object.keys(JENIS_BIAYA);
const MAKS_SUMBER = 60;
const STATUS_TAGIHAN_MASUK_BUKU = ["DISETUJUI", "DIBAYAR_SEBAGIAN", "LUNAS"];
const d = (v) => new Decimal(String(v ?? 0));
const num = (v) => (v == null ? null : Number(v));

// ── Pembekuan (dipanggil postStockMovement di dalam transaksi yang sama) ─────────────────────────────

/** Bentuk rincian dasar harga yang dibekukan: sumber penerimaan dilengkapi nomor penerimaan & PO (jejak PO → penerimaan). */
async function rincianDasar(tx, dasar) {
  const ids = [...new Set(dasar.sumber.map((s) => s.goodsReceiptId).filter(Boolean))];
  const penerimaan = ids.length
    ? await tx.goodsReceipt.findMany({
        where: { id: { in: ids } },
        select: { id: true, receiptNumber: true, purchaseOrder: { select: { poNumber: true } }, lines: { select: { materialId: true, purchaseOrderLineId: true } } },
      })
    : [];
  const peta = new Map(penerimaan.map((p) => [p.id, p]));
  const sumber = dasar.sumber.map((s) => {
    const p = s.goodsReceiptId ? peta.get(s.goodsReceiptId) : null;
    return { ...s, receiptNumber: p?.receiptNumber ?? null, poNumber: p?.purchaseOrder?.poNumber ?? null };
  });
  const dipakai = sumber.length > MAKS_SUMBER ? sumber.slice(-MAKS_SUMBER) : sumber;
  return {
    asOf: dasar.asOf ? new Date(dasar.asOf).toISOString() : null,
    totalQty: dasar.totalQty.toString(), totalNilai: dasar.totalNilai.toString(),
    sumber: dipakai, sumberDipangkas: sumber.length > MAKS_SUMBER ? sumber.length - MAKS_SUMBER : 0,
    opening: dasar.opening,
  };
}

/**
 * Bekukan nilai pergerakan bertaut unit. Dipanggil SETELAH baris stock_movements ditulis, di transaksi yang sama. Tidak pernah menggagalkan perintah Gudang:
 * kegagalan non-database ditelan (SAVEPOINT) — pergerakan itu kemudian tampil sebagai ESTIMASI_HISTORIS (BELUM_FINAL), bukan angka palsu.
 */
export async function catatValuasiPergerakan(tx, mov) {
  if (!mov?.unitId || !JENIS_BIAYA[mov.type]) return null;
  if (typeof tx?.$executeRawUnsafe !== "function" || !tx?.finStockMovementValuation) return null; // klien transaksi tiruan (tes unit)
  await tx.$executeRawUnsafe("SAVEPOINT sp_valuasi_pergerakan");
  try {
    const qty = d(mov.qty);
    const dasar = await dasarHargaRataRata(tx, mov.materialId, { asOf: mov.createdAt });
    let data;
    if (dasar.harga == null) {
      data = { status: "TANPA_HARGA", unitCostBasis: null, value: null, basis: { asOf: mov.createdAt ? new Date(mov.createdAt).toISOString() : null, alasan: "Material belum punya harga perolehan saat pergerakan ini diposting" } };
    } else {
      const mutlak = toMoney(qty.abs().times(dasar.harga));
      data = { status: "DINILAI", unitCostBasis: dasar.harga, value: qty.isNegative() ? mutlak : mutlak.negated(), basis: await rincianDasar(tx, dasar) };
    }
    const baris = await tx.finStockMovementValuation.create({
      data: { movementId: mov.id, materialId: mov.materialId, unitId: mov.unitId, movementType: mov.type, costKind: JENIS_BIAYA[mov.type], qty, ...data },
    });
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT sp_valuasi_pergerakan");
    return baris;
  } catch (e) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT sp_valuasi_pergerakan");
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT sp_valuasi_pergerakan");
    console.error("[biaya-bahan] pembekuan nilai pergerakan gagal (perintah Gudang tetap berjalan):", mov.id, e?.message);
    return null;
  }
}

// ── Baca: jejak satu unit ────────────────────────────────────────────────────────────────────────────

const STEP_PEMAKAIAN = [6, 7, 10];

async function selisihFakturPerLot(db, sumberSemua, bahanId) {
  // lot = penerimaan (goods_receipt) + material. Harga faktur dari alokasi faktur atas PO (per baris penerimaan).
  const idPenerimaan = [...new Set(sumberSemua.map((s) => s.goodsReceiptId).filter(Boolean))];
  if (idPenerimaan.length === 0) return new Map();
  const baris = await db.goodsReceiptLine.findMany({
    where: { goodsReceiptId: { in: idPenerimaan }, materialId: { in: bahanId } },
    select: {
      id: true, goodsReceiptId: true, materialId: true, acceptedQty: true, purchaseOrderLineId: true,
      purchaseOrderLine: { select: { unitPrice: true } },
      billAllocations: {
        where: { bill: { status: { in: STATUS_TAGIHAN_MASUK_BUKU } } },
        select: { qty: true, billPoLine: { select: { invoiceUnitPrice: true } } },
      },
      goodsReceipt: { select: { finSupplierBills: { where: { status: { in: STATUS_TAGIHAN_MASUK_BUKU } }, select: { billNumber: true } } } },
    },
  });
  const peta = new Map();
  for (const b of baris) {
    const diterima = d(b.acceptedQty);
    const tercakup = b.billAllocations.reduce((a, x) => a.plus(d(x.qty)), ZERO);
    const nilaiFaktur = b.billAllocations.reduce((a, x) => a.plus(d(x.qty).times(d(x.billPoLine.invoiceUnitPrice))), ZERO);
    peta.set(`${b.goodsReceiptId}|${b.materialId}`, {
      adaPO: !!b.purchaseOrderLineId,
      hargaPO: b.purchaseOrderLine?.unitPrice ?? null,
      diterima, tercakup: tercakup.greaterThan(diterima) ? diterima : tercakup,
      hargaFakturRata: tercakup.isZero() ? null : nilaiFaktur.dividedBy(tercakup),
      fakturLama: b.goodsReceipt.finSupplierBills.map((x) => x.billNumber),
    });
  }
  return peta;
}

/**
 * Jejak biaya bahan SATU unit: PO → penerimaan → Material Issue → pemakaian PIC → waste/retur → faktur.
 * `izinHarga=false` membuang semua nominal & harga (tampilan Produksi): kuantitas, status, dan dokumen tetap tampil.
 */
export async function bacaJejakUnit(db, unitId, { izinHarga = false } = {}) {
  const unit = await db.unit.findUnique({ where: { id: unitId }, select: { id: true, unitCode: true, order: { select: { orderNumber: true } } } });
  if (!unit) return null;

  const [pergerakan, runs, retur, dokumenBelumKeluar] = await Promise.all([
    db.stockMovement.findMany({
      where: { unitId, type: { in: TIPE_DINILAI } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true, type: true, qty: true, createdAt: true, note: true, reason: true, materialId: true, materialIssueId: true,
        material: { select: { id: true, code: true, name: true, unit: true } },
        materialIssue: { select: { id: true, issueNumber: true, status: true } },
        createdBy: { select: { name: true } },
        valuation: true,
      },
    }),
    db.productionRun.findMany({ where: { unitId }, select: { id: true, status: true, currentPhase: true } }),
    db.productionMaterialReturn.findMany({
      where: { unitId, status: "PENDING" },
      select: { id: true, materialId: true, qty: true, requestedAt: true, material: { select: { id: true, code: true, name: true, unit: true } } },
    }),
    db.materialIssue.findMany({
      where: { unitId, status: { in: ["APPROVED", "READY_TO_PICK", "PICKED"] } },
      select: { id: true, issueNumber: true, status: true, lines: { select: { requestedQty: true, material: { select: { code: true, name: true } } } } },
    }),
  ]);

  const evidence = runs.length
    ? await db.productionStepEvidence.findMany({
        where: { runId: { in: runs.map((r) => r.id) }, stepNo: { in: STEP_PEMAKAIAN }, NOT: { stepCode: { startsWith: "DOC_" } } },
        orderBy: [{ createdAt: "asc" }],
        select: { id: true, stepNo: true, stepCode: true, version: true, payload: true, actorId: true, createdAt: true },
      })
    : [];
  const aktorIds = [...new Set(evidence.map((e) => e.actorId).filter(Boolean))];
  const aktor = aktorIds.length ? new Map((await db.user.findMany({ where: { id: { in: aktorIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])) : new Map();

  // status jurnal HPP (read-only): jurnal pemakaian per dokumen/pergerakan
  const kunciJurnal = pergerakan.flatMap((m) => [m.materialIssueId ? `PEMAKAIAN_BAHAN:${m.materialIssueId}` : null, `PEMAKAIAN_BAHAN_MOVEMENT:${m.id}`].filter(Boolean));
  const jurnal = kunciJurnal.length
    ? new Set((await db.finJournalEntry.findMany({ where: { idempotencyKey: { in: kunciJurnal }, status: { in: ["POSTED", "REVERSED"] } }, select: { idempotencyKey: true } })).map((j) => j.idempotencyKey))
    : new Set();

  // selisih harga faktur per lot
  const sumberSemua = pergerakan.flatMap((m) => (m.valuation?.basis?.sumber ?? []));
  const lot = await selisihFakturPerLot(db, sumberSemua, [...new Set(pergerakan.map((m) => m.materialId))]);

  // ── baris pergerakan ──
  const sekarang = new Date();
  const baris = [];
  for (const m of pergerakan) {
    const v = m.valuation;
    const qty = d(m.qty);
    const mutlak = qty.abs();
    const jenis = JENIS_BIAYA[m.type];
    const tandaBiaya = qty.isNegative() ? 1 : -1;
    let status; let nilai = null; let harga = null; let basis = null; let estimasi = null;
    if (v) {
      status = v.status;
      nilai = v.value == null ? null : d(v.value);
      harga = v.unitCostBasis == null ? null : d(v.unitCostBasis);
      basis = v.basis;
      if (status === "TANPA_HARGA") {
        const kini = await dasarHargaRataRata(db, m.materialId, { asOf: sekarang });
        if (kini.harga != null) estimasi = toMoney(mutlak.times(kini.harga)).times(tandaBiaya);
      }
    } else {
      status = "ESTIMASI_HISTORIS";
      const dasar = await dasarHargaRataRata(db, m.materialId, { asOf: m.createdAt });
      if (dasar.harga != null) { estimasi = toMoney(mutlak.times(dasar.harga)).times(tandaBiaya); harga = dasar.harga; }
    }

    // selisih faktur (di luar biaya persediaan)
    let selisihDiketahui = ZERO; let qtyFakturBelumAda = ZERO; let qtyTanpaPO = ZERO; const fakturLama = new Set();
    const sumber = basis?.sumber ?? [];
    const totalQtyDasar = d(basis?.totalQty ?? 0);
    if (status === "DINILAI" && totalQtyDasar.greaterThan(0)) {
      for (const s of sumber) {
        const bobot = d(s.qty).dividedBy(totalQtyDasar);
        const qtyLot = mutlak.times(bobot);
        const l = lot.get(`${s.goodsReceiptId}|${m.materialId}`);
        if (!s.goodsReceiptId || !l || !l.adaPO) { qtyTanpaPO = qtyTanpaPO.plus(qtyLot); l?.fakturLama.forEach((n) => fakturLama.add(n)); continue; }
        const porsiTercakup = l.diterima.isZero() ? ZERO : l.tercakup.dividedBy(l.diterima);
        const qtyTercakup = qtyLot.times(porsiTercakup);
        if (l.hargaFakturRata != null) selisihDiketahui = selisihDiketahui.plus(qtyTercakup.times(l.hargaFakturRata.minus(d(l.hargaPO))).times(tandaBiaya));
        qtyFakturBelumAda = qtyFakturBelumAda.plus(qtyLot.minus(qtyTercakup));
      }
    }
    const eps = d("0.00005");
    const tercakupQty = mutlak.minus(qtyTanpaPO).minus(qtyFakturBelumAda);
    const statusFaktur = status !== "DINILAI" ? null
      : qtyTanpaPO.greaterThanOrEqualTo(mutlak.minus(eps)) ? "TANPA_PO"
      : qtyTanpaPO.lessThan(eps) && qtyFakturBelumAda.lessThan(eps) ? "FAKTUR_LENGKAP"
      : qtyTanpaPO.lessThan(eps) && tercakupQty.lessThan(eps) ? "FAKTUR_BELUM_ADA"
      : "FAKTUR_SEBAGIAN";

    baris.push({
      movementId: m.id, tipe: m.type, jenisBiaya: jenis, tanggal: m.createdAt, qty: Number(qty),
      materialId: m.materialId, kode: m.material.code, nama: m.material.name, satuan: m.material.unit,
      status, finalitas: status === "DINILAI" ? "FINAL" : "BELUM_FINAL",
      nilai, hargaDasar: harga, estimasi,
      dokumen: m.materialIssue ? { materialIssueId: m.materialIssue.id, nomor: m.materialIssue.issueNumber } : null,
      oleh: m.createdBy?.name ?? null, catatan: m.reason || m.note || null,
      jurnal: jurnal.has(`PEMAKAIAN_BAHAN:${m.materialIssueId}`) || jurnal.has(`PEMAKAIAN_BAHAN_MOVEMENT:${m.id}`) ? "TERBUKU" : "BELUM_DIJURNAL",
      sumber: sumber.map((s) => ({ receiptNumber: s.receiptNumber ?? null, poNumber: s.poNumber ?? null, qty: Number(s.qty), unitCost: s.unitCost, goodsReceiptId: s.goodsReceiptId ?? null })),
      sumberDipangkas: basis?.sumberDipangkas ?? 0,
      asOfDasar: basis?.asOf ?? null,
      faktur: status === "DINILAI" ? { status: statusFaktur, selisih: selisihDiketahui, qtyBelumAdaFaktur: qtyFakturBelumAda, qtyTanpaPO, fakturLama: [...fakturLama] } : null,
    });
  }

  // ── rollup per bahan ──
  const bahanMap = new Map();
  const ambil = (mat) => {
    if (!bahanMap.has(mat.id)) bahanMap.set(mat.id, { materialId: mat.id, kode: mat.code, nama: mat.name, satuan: mat.unit, diserahkan: ZERO, dipakaiPIC: ZERO, waste: ZERO, retur: ZERO, penyesuaian: ZERO, returPending: ZERO, pergerakan: [], pemakaianPIC: [] });
    return bahanMap.get(mat.id);
  };
  for (const [i, m] of pergerakan.entries()) {
    const b = ambil(m.material); const q = d(m.qty);
    if (m.type === "ISSUE") b.diserahkan = b.diserahkan.plus(q.abs());
    else if (m.type === "WASTE") b.waste = b.waste.plus(q.abs());
    else if (m.type === "RETURN") b.retur = b.retur.plus(q);
    else b.penyesuaian = b.penyesuaian.plus(q);
    b.pergerakan.push(baris[i]);
  }
  for (const e of evidence) {
    for (const l of e.payload?.materials ?? []) {
      if (!l?.materialId) continue;
      const mat = pergerakan.find((m) => m.materialId === l.materialId)?.material ?? (await db.material.findUnique({ where: { id: l.materialId }, select: { id: true, code: true, name: true, unit: true } }));
      if (!mat) continue;
      const b = ambil(mat); const q = d(l.qty);
      b.dipakaiPIC = b.dipakaiPIC.plus(q);
      b.pemakaianPIC.push({ stepNo: e.stepNo, stepCode: e.stepCode, version: e.version, qty: Number(q), oleh: aktor.get(e.actorId) ?? null, waktu: e.createdAt });
    }
  }
  for (const r of retur) { const b = ambil(r.material); b.returPending = b.returPending.plus(d(r.qty)); }

  // ── ringkasan & daftar belum final ──
  const belumFinal = [];
  let biaya = ZERO; let adaDinilai = false; let susut = ZERO; let selisihFaktur = ZERO; let penyesuaian = ZERO;
  let estimasiBelumFinal = ZERO;
  for (const r of baris) {
    if (r.status === "DINILAI") {
      adaDinilai = true;
      if (r.jenisBiaya === "SUSUT") susut = susut.plus(r.nilai);
      else if (r.jenisBiaya === "PENYESUAIAN") { penyesuaian = penyesuaian.plus(r.nilai); biaya = biaya.plus(r.nilai); }
      else biaya = biaya.plus(r.nilai);
      if (r.jenisBiaya !== "SUSUT") selisihFaktur = selisihFaktur.plus(r.faktur?.selisih ?? ZERO);
      if (r.faktur?.status === "FAKTUR_BELUM_ADA" || r.faktur?.status === "FAKTUR_SEBAGIAN") belumFinal.push({ jenis: "FAKTUR_BELUM_ADA", movementId: r.movementId, kode: r.kode, pesan: `${r.kode}: sebagian harga masih menurut PO, faktur supplier belum disetujui (selisih harga faktur belum diketahui)`, qty: Number(r.faktur.qtyBelumAdaFaktur) });
    } else if (r.status === "TANPA_HARGA") {
      belumFinal.push({ jenis: "TANPA_HARGA", movementId: r.movementId, kode: r.kode, pesan: `${r.kode}: ${r.tipe === "ISSUE" ? "pemakaian" : r.tipe.toLowerCase()} ${Math.abs(r.qty)} ${r.satuan} belum punya harga perolehan — tidak dihitung (bukan Rp0)`, qty: Math.abs(r.qty) });
      if (r.estimasi) estimasiBelumFinal = estimasiBelumFinal.plus(r.estimasi);
    } else {
      belumFinal.push({ jenis: "ESTIMASI_HISTORIS", movementId: r.movementId, kode: r.kode, pesan: `${r.kode}: pergerakan ini terjadi sebelum nilai dibekukan — hanya estimasi`, qty: Math.abs(r.qty) });
      if (r.estimasi) estimasiBelumFinal = estimasiBelumFinal.plus(r.estimasi);
    }
  }
  for (const r of retur) belumFinal.push({ jenis: "RETUR_BELUM_DITERIMA", kode: r.material.code, pesan: `${r.material.code}: retur sisa ${Number(r.qty)} ${r.material.unit} belum diterima Gudang — baru mengurangi biaya saat diterima`, qty: Number(r.qty) });
  const produksiSelesai = runs.length === 0 ? null : runs.every((r) => r.status === "COMPLETED");
  if (produksiSelesai === false) belumFinal.push({ jenis: "PRODUKSI_BELUM_SELESAI", pesan: "Produksi unit ini belum selesai — pemakaian, waste, dan retur masih bisa bertambah" });
  for (const dk of dokumenBelumKeluar) belumFinal.push({ jenis: "ISSUE_BELUM_KELUAR", dokumen: dk.issueNumber, pesan: `Material Issue ${dk.issueNumber} (${dk.status}) belum dikeluarkan Gudang — belum menjadi biaya`, });

  const semuaTanpaNilai = baris.length > 0 && !adaDinilai;
  const keras = belumFinal.filter((x) => !["FAKTUR_BELUM_ADA"].includes(x.jenis));
  const statusBiaya = baris.length === 0 ? "BELUM_ADA_PEMAKAIAN" : keras.length === 0 ? "FINAL_MENURUT_HARGA_PO" : "BELUM_FINAL";

  const bahan = [...bahanMap.values()].sort((a, b) => a.kode.localeCompare(b.kode)).map((b) => {
    const sisa = b.diserahkan.minus(b.dipakaiPIC).minus(b.waste).minus(b.retur);
    return { ...b, diserahkan: Number(b.diserahkan), dipakaiPIC: Number(b.dipakaiPIC), waste: Number(b.waste), retur: Number(b.retur), penyesuaian: Number(b.penyesuaian), returPending: Number(b.returPending), sisaDiUnit: Number(sisa) };
  });

  const hasil = {
    unit: { id: unit.id, unitCode: unit.unitCode, orderNumber: unit.order?.orderNumber ?? null },
    izinHarga,
    statusBiaya,
    produksiSelesai,
    ringkasan: {
      biayaPersediaan: { nilai: adaDinilai ? biaya : null, lengkap: adaDinilai && statusBiaya === "FINAL_MENURUT_HARGA_PO", sebagian: adaDinilai && statusBiaya !== "FINAL_MENURUT_HARGA_PO", dasar: "Harga PO/perolehan (rata-rata tertimbang) yang dibekukan saat pergerakan diposting" },
      nilaiSusut: adaDinilai ? susut : null,
      penyesuaian: penyesuaian,
      selisihHargaFaktur: { nilai: selisihFaktur, catatan: "Di luar biaya persediaan; dibukukan ke Selisih Harga Pembelian saat faktur disetujui. Hanya bagian yang fakturnya sudah disetujui." },
      estimasiBelumFinal: baris.some((r) => r.status !== "DINILAI") ? estimasiBelumFinal : null,
      jumlahPergerakan: baris.length, jumlahTanpaHarga: baris.filter((r) => r.status === "TANPA_HARGA").length, jumlahEstimasiHistoris: baris.filter((r) => r.status === "ESTIMASI_HISTORIS").length,
      semuaTanpaNilai,
    },
    belumFinal,
    bahan,
  };
  return izinHarga ? serialisasi(hasil) : sembunyikanHarga(serialisasi(hasil));
}

// Decimal → number untuk JSON (nilai uang 2 desimal; harga dasar 4 desimal)
function serialisasi(h) {
  const uang = (v) => (v == null ? null : moneyToNumber(toMoney(v)));
  const harga = (v) => (v == null ? null : Number(new Decimal(String(v)).toDecimalPlaces(4)));
  return {
    ...h,
    ringkasan: {
      ...h.ringkasan,
      biayaPersediaan: { ...h.ringkasan.biayaPersediaan, nilai: uang(h.ringkasan.biayaPersediaan.nilai) },
      nilaiSusut: uang(h.ringkasan.nilaiSusut), penyesuaian: uang(h.ringkasan.penyesuaian),
      selisihHargaFaktur: { ...h.ringkasan.selisihHargaFaktur, nilai: uang(h.ringkasan.selisihHargaFaktur.nilai) },
      estimasiBelumFinal: uang(h.ringkasan.estimasiBelumFinal),
    },
    bahan: h.bahan.map((b) => ({
      ...b,
      pergerakan: b.pergerakan.map((r) => ({
        ...r, nilai: uang(r.nilai), hargaDasar: harga(r.hargaDasar), estimasi: uang(r.estimasi),
        faktur: r.faktur && { ...r.faktur, selisih: uang(r.faktur.selisih), qtyBelumAdaFaktur: Number(r.faktur.qtyBelumAdaFaktur), qtyTanpaPO: Number(r.faktur.qtyTanpaPO) },
      })),
    })),
  };
}

function sembunyikanHarga(h) {
  return {
    ...h,
    ringkasan: { ...h.ringkasan, biayaPersediaan: { nilai: null, lengkap: h.ringkasan.biayaPersediaan.lengkap, sebagian: h.ringkasan.biayaPersediaan.sebagian, dasar: null }, nilaiSusut: null, penyesuaian: null, selisihHargaFaktur: null, estimasiBelumFinal: null },
    bahan: h.bahan.map((b) => ({
      ...b,
      pergerakan: b.pergerakan.map((r) => ({
        ...r, nilai: null, hargaDasar: null, estimasi: null,
        sumber: r.sumber.map((s) => ({ ...s, unitCost: null })),
        faktur: r.faktur && { status: r.faktur.status, qtyBelumAdaFaktur: r.faktur.qtyBelumAdaFaktur, qtyTanpaPO: r.faktur.qtyTanpaPO, fakturLama: r.faktur.fakturLama, selisih: null },
      })),
    })),
  };
}

// ── Daftar unit (Finance) ─────────────────────────────────────────────────────────────────────────────
export async function daftarUnitBiaya(db, { q = "", limit = 100 } = {}) {
  const grup = await db.stockMovement.groupBy({
    by: ["unitId"], where: { unitId: { not: null }, type: { in: TIPE_DINILAI } }, _max: { createdAt: true }, _count: { _all: true },
    orderBy: { _max: { createdAt: "desc" } }, take: 400,
  });
  const ids = grup.map((g) => g.unitId);
  if (ids.length === 0) return [];
  const units = await db.unit.findMany({
    where: { id: { in: ids }, ...(q ? { OR: [{ unitCode: { contains: q, mode: "insensitive" } }, { order: { orderNumber: { contains: q, mode: "insensitive" } } }] } : {}) },
    select: { id: true, unitCode: true, order: { select: { orderNumber: true } } },
  });
  const petaUnit = new Map(units.map((u) => [u.id, u]));
  const vals = await db.finStockMovementValuation.findMany({ where: { unitId: { in: units.map((u) => u.id) } }, select: { unitId: true, status: true, costKind: true, value: true } });
  const hasil = [];
  for (const g of grup) {
    const u = petaUnit.get(g.unitId);
    if (!u) continue;
    const v = vals.filter((x) => x.unitId === g.unitId);
    const dinilai = v.filter((x) => x.status === "DINILAI" && x.costKind !== "SUSUT");
    hasil.push({
      unitId: u.id, unitCode: u.unitCode, orderNumber: u.order?.orderNumber ?? null, terakhir: g._max.createdAt,
      jumlahPergerakan: g._count._all, jumlahDibekukan: v.length,
      biayaPersediaan: dinilai.length ? moneyToNumber(dinilai.reduce((a, x) => a.plus(d(x.value)), ZERO)) : null,
      jumlahTanpaHarga: v.filter((x) => x.status === "TANPA_HARGA").length,
      jumlahBelumDibekukan: g._count._all - v.length,
    });
    if (hasil.length >= limit) break;
  }
  return hasil;
}
