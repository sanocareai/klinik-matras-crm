// ATRIBUSI DIVISI (Fase 2 Laporan Divisi). BACA-SAJA — tidak pernah menulis, tidak ada backfill.
//
// Divisi ditentukan dari DOKUMEN SUMBER, dengan prioritas (lihat divisi.js):
//   a. EKSPLISIT → b. RELASI → c. KATEGORI (mapping terkonfigurasi) → SHARED (biaya bersama resmi) → TIDAK_TERKLASIFIKASI.
// Pembuat/pengaju TIDAK PERNAH dipakai untuk menebak divisi. Jurnal pembalik (reversalOfId) mengikuti entri ASLI-nya.
//
// Dua pintu masuk yang memakai SATU aturan yang sama:
//   atribusiEntri(db, entries)   — per entri jurnal (Aktual & Kas Keluar)
//   atribusiDokumenKomitmen(...) — per dokumen yang belum/ belum seluruhnya dibukukan (Komitmen)
// Hasil: { bagian:[{scope,bobot}], tahap, aturan, dokumen:{modul,id,nomor}|null, kategori:{kode,nama}|null, sensitif, konflik:[scope...], status?, proyek? }
import {
  DARI_FIN_DIVISION, SUMBER_TETAP, KATEGORI_PEMBELIAN_DIVISI, JENIS_TAGIHAN_DIVISI, SUMBER_ISSUE_PRODUKSI, KATEGORI_SENSITIF, TIDAK_TERKLASIFIKASI, DI_LUAR_DIVISI, SUMBER_BIAYA,
} from "./divisi.js";

export const TAHAP = Object.freeze({ EKSPLISIT: "EKSPLISIT", RELASI: "RELASI", KATEGORI: "KATEGORI", SHARED: "SHARED", TIDAK: "TIDAK_TERKLASIFIKASI", BUKAN_BIAYA: "BUKAN_BIAYA" });

const satu = (scope, tahap, aturan, ekstra = {}) => ({ bagian: [{ scope, bobot: 1 }], tahap, aturan, dokumen: null, kategori: null, sensitif: false, konflik: [], ...ekstra });
const tidak = (aturan, ekstra = {}) => satu(TIDAK_TERKLASIFIKASI, TAHAP.TIDAK, aturan, ekstra);
const peta = (div) => (div ? DARI_FIN_DIVISION[div] ?? null : null);
const uniq = (a) => [...new Set(a.filter(Boolean))];
const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idsValid = (a) => uniq(a).filter((x) => POLA_UUID.test(x));

/** Putuskan scope dari kandidat berprioritas. null = tidak ada bukti sama sekali (bukan UMUM). */
function putuskan({ eksplisit, relasi, relasiLabel, kategori, kategoriLabel, umum }) {
  const kandidat = [];
  if (eksplisit && eksplisit !== "SHARED") kandidat.push({ scope: eksplisit, tahap: TAHAP.EKSPLISIT, aturan: "Divisi tertulis pada dokumen" });
  if (relasi && relasi !== "SHARED") kandidat.push({ scope: relasi, tahap: TAHAP.RELASI, aturan: relasiLabel || "Relasi dokumen sumber" });
  if (kategori && kategori !== "SHARED") kandidat.push({ scope: kategori, tahap: TAHAP.KATEGORI, aturan: kategoriLabel || "Pemetaan kategori terkonfigurasi" });
  const beda = uniq(kandidat.map((k) => k.scope));
  if (kandidat.length > 0) {
    const k = kandidat[0];
    return { scope: k.scope, tahap: k.tahap, aturan: k.aturan, konflik: beda.length > 1 ? beda : [] };
  }
  if (umum || eksplisit === "SHARED" || relasi === "SHARED" || kategori === "SHARED") return { scope: "SHARED", tahap: TAHAP.SHARED, aturan: "Biaya bersama (divisi UMUM/kantor) — belum ada alokasi resmi", konflik: [] };
  return null;
}
const dariPutusan = (p, fallback) => (p ? { bagian: [{ scope: p.scope, bobot: 1 }], tahap: p.tahap, aturan: p.aturan, konflik: p.konflik } : fallback);

// ── aturan per jenis dokumen (dipakai atribusiEntri DAN komitmen) ─────────────────────────────────────────────────────
export function atribusiPengeluaran(d) {
  const p = putuskan({
    eksplisit: d.division !== "UMUM" ? peta(d.division) : null,
    relasi: d.submission ? peta(d.submission.division) : null, relasiLabel: `Pengajuan biaya ${d.submission?.submissionNumber ?? ""} (workspace pemohon)`,
    kategori: peta(d.category.division), kategoriLabel: `Kategori ${d.category.code} → divisi terkonfigurasi`,
    umum: d.division === "UMUM",
  });
  return {
    ...satu(TIDAK_TERKLASIFIKASI, TAHAP.TIDAK, "Pengeluaran tanpa bukti divisi"), ...dariPutusan(p, tidak("Pengeluaran tanpa bukti divisi")),
    dokumen: { modul: "pengeluaran", id: d.id, nomor: d.expenseNumber }, kategori: { kode: d.category.code, nama: d.category.name },
    sensitif: KATEGORI_SENSITIF.includes(d.category.code), status: d.status,
  };
}
export function atribusiPembelian(d) {
  const p = putuskan({ eksplisit: d.division !== "UMUM" ? peta(d.division) : null, kategori: KATEGORI_PEMBELIAN_DIVISI[d.category.code] ?? null, kategoriLabel: `Kategori pembelian ${d.category.code} → divisi terkonfigurasi`, umum: d.division === "UMUM" });
  return {
    ...tidak("Pembelian tanpa bukti divisi"), ...dariPutusan(p, tidak("Pembelian tanpa bukti divisi")),
    dokumen: { modul: "pembelian", id: d.id, nomor: d.purchaseNumber }, kategori: { kode: d.category.code, nama: d.category.name }, status: d.status,
  };
}
export function atribusiTagihan(b, kat /* FinExpenseCategory | null */) {
  const kodeKat = kat ? { kode: kat.code, nama: kat.name } : b.purchaseCategory ? { kode: b.purchaseCategory.code, nama: b.purchaseCategory.name } : b.billType ? { kode: b.billType, nama: b.billType } : null;
  const p = putuskan({
    relasi: JENIS_TAGIHAN_DIVISI[b.billType] ?? null, relasiLabel: `Jenis tagihan ${b.billType} (bahan baku = Produksi)`,
    kategori: kat ? peta(kat.division) : b.purchaseCategory ? KATEGORI_PEMBELIAN_DIVISI[b.purchaseCategory.code] ?? null : null,
    kategoriLabel: kat ? `Kategori ${kat.code} → divisi terkonfigurasi` : "Kategori pembelian terkonfigurasi",
  });
  return { ...tidak("Tagihan supplier tanpa bukti divisi (jenis/kategori belum terpetakan)"), ...dariPutusan(p, tidak("Tagihan supplier tanpa bukti divisi (jenis/kategori belum terpetakan)")), dokumen: { modul: "supplier-utang", id: b.id, nomor: b.billNumber }, kategori: kodeKat, status: b.status };
}

const SEL_EXP = { id: true, expenseNumber: true, status: true, division: true, category: { select: { code: true, name: true, division: true } }, submission: { select: { division: true, submissionNumber: true } } };
const SEL_BELI = { id: true, purchaseNumber: true, status: true, division: true, category: { select: { code: true, name: true } } };
const SEL_BILL = { id: true, billNumber: true, billType: true, status: true, expenseCategoryId: true, purchaseCategory: { select: { code: true, name: true } } };
export const SELEKTOR = { SEL_EXP, SEL_BELI, SEL_BILL };

async function muatKategoriTagihan(db, bills) {
  const ids = uniq(bills.map((b) => b.expenseCategoryId));
  const rows = ids.length ? await db.finExpenseCategory.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, division: true } }) : [];
  return new Map(rows.map((k) => [k.id, k]));
}

/**
 * @param db       klien Prisma (BACA-SAJA)
 * @param entries  [{ id, source, sourceId, reversalOfId }]
 * @returns Map<entryId, atribusi>
 */
export async function atribusiEntri(db, entries) {
  const hasil = new Map();
  if (!entries.length) return hasil;

  const idAsli = entries.filter((e) => e.reversalOfId).map((e) => e.reversalOfId);
  const asli = idAsli.length ? await db.finJournalEntry.findMany({ where: { id: { in: idAsli } }, select: { id: true, source: true, sourceId: true } }) : [];
  const asliMap = new Map(asli.map((a) => [a.id, a]));
  const efektif = entries.map((e) => {
    const o = e.reversalOfId ? asliMap.get(e.reversalOfId) : null;
    return { entry: e, source: o?.source ?? e.source, sourceId: o?.sourceId ?? e.sourceId, balik: !!e.reversalOfId };
  });
  const per = (src) => efektif.filter((x) => x.source === src && x.sourceId).map((x) => x.sourceId);

  const idExp = idsValid(per("PENGELUARAN")); const idBeli = idsValid(per("PEMBELIAN")); const idBill = idsValid(per("TAGIHAN_SUPPLIER"));
  const idPaySup = idsValid(per("PEMBAYARAN_SUPPLIER")); const idAdv = idsValid(per("UANG_MUKA_OPERASIONAL")); const idPakai = idsValid(per("PEMAKAIAN_BAHAN"));
  const idKend = idsValid(per("BIAYA_KENDARAAN")); const idAd = uniq(per("BIAYA_IKLAN"));

  const [expenses, purchases, bills0, supPays, advances, issues, movs, counts, vExp, vSvc, adSpends, katAuto] = await Promise.all([
    idExp.length ? db.finExpense.findMany({ where: { id: { in: idExp } }, select: SEL_EXP }) : [],
    idBeli.length ? db.finPurchase.findMany({ where: { id: { in: idBeli } }, select: SEL_BELI }) : [],
    idBill.length ? db.finSupplierBill.findMany({ where: { id: { in: idBill } }, select: SEL_BILL }) : [],
    idPaySup.length ? db.finSupplierPayment.findMany({ where: { id: { in: idPaySup } }, select: { id: true, paymentNumber: true, allocations: { select: { billId: true, amount: true } } } }) : [],
    idAdv.length ? db.finOperationalAdvance.findMany({ where: { id: { in: idAdv } }, select: { id: true, advanceNumber: true, division: true } }) : [],
    idPakai.length ? db.materialIssue.findMany({ where: { id: { in: idPakai } }, select: { id: true, issueNumber: true, sourceType: true, unitId: true } }) : [],
    idPakai.length ? db.stockMovement.findMany({ where: { id: { in: idPakai } }, select: { id: true, type: true, unitId: true } }) : [],
    idPakai.length ? db.stockCount.findMany({ where: { id: { in: idPakai } }, select: { id: true, countNumber: true } }) : [],
    idKend.length ? db.vehicleExpense.findMany({ where: { id: { in: idKend } }, select: { id: true, category: true } }) : [],
    idKend.length ? db.vehicleService.findMany({ where: { id: { in: idKend } }, select: { id: true } }) : [],
    idAd.length ? db.adSpend.findMany({ where: { id: { in: idAd } }, select: { id: true, source: true, year: true, month: true } }) : [],
    db.finExpenseCategory.findMany({ where: { autoMapKey: { not: null } }, select: { autoMapKey: true, code: true, name: true, division: true } }),
  ]);
  const katOtomatis = new Map(katAuto.map((k) => [k.autoMapKey, k]));

  // tagihan yang dibayar lewat pembayaran supplier (alokasi) dimuat juga
  const idBillBayar = idsValid(supPays.flatMap((p) => p.allocations.map((a) => a.billId))).filter((id) => !bills0.some((b) => b.id === id));
  const bills1 = idBillBayar.length ? await db.finSupplierBill.findMany({ where: { id: { in: idBillBayar } }, select: SEL_BILL }) : [];
  const semuaBill = [...bills0, ...bills1];
  const katBill = await muatKategoriTagihan(db, semuaBill);
  const billMap = new Map(semuaBill.map((b) => [b.id, atribusiTagihan(b, b.expenseCategoryId ? katBill.get(b.expenseCategoryId) ?? null : null)]));

  const M = {
    exp: new Map(expenses.map((x) => [x.id, x])), beli: new Map(purchases.map((x) => [x.id, x])), pay: new Map(supPays.map((x) => [x.id, x])),
    adv: new Map(advances.map((x) => [x.id, x])), iss: new Map(issues.map((x) => [x.id, x])), mov: new Map(movs.map((x) => [x.id, x])),
    cnt: new Map(counts.map((x) => [x.id, x])), vexp: new Map(vExp.map((x) => [x.id, x])), vsvc: new Map(vSvc.map((x) => [x.id, x])), ad: new Map(adSpends.map((x) => [x.id, x])),
  };

  for (const x of efektif) {
    const id = x.sourceId;
    let a;
    if (SUMBER_TETAP[x.source]) {
      const t = SUMBER_TETAP[x.source];
      a = satu(t.scope, TAHAP.RELASI, t.aturan, { sensitif: !!t.sensitif });
      if (x.source === "BIAYA_KENDARAAN") {
        const ve = M.vexp.get(id);
        const kat = ve ? katOtomatis.get(`VEHICLE:${ve.category}`) : M.vsvc.get(id) ? katOtomatis.get("VEHICLE_SERVICE") : null;
        a.kategori = kat ? { kode: kat.code, nama: kat.name } : null;
        a.dokumen = { modul: "armada-biaya", id, nomor: null };
      }
    } else if (x.source === "PENGELUARAN") {
      const d = M.exp.get(id);
      a = d ? atribusiPengeluaran(d) : tidak("Pengeluaran sumber tidak ditemukan");
    } else if (x.source === "PEMBELIAN") {
      const d = M.beli.get(id);
      a = d ? atribusiPembelian(d) : tidak("Pembelian sumber tidak ditemukan");
    } else if (x.source === "TAGIHAN_SUPPLIER") {
      a = billMap.get(id) ?? tidak("Tagihan supplier sumber tidak ditemukan");
    } else if (x.source === "PEMBAYARAN_SUPPLIER") {
      const d = M.pay.get(id);
      if (!d || d.allocations.length === 0) a = tidak("Pembayaran supplier tanpa alokasi tagihan");
      else {
        // pecah proporsional alokasi per tagihan; tagihan tanpa bukti divisi → bagiannya TIDAK_TERKLASIFIKASI
        const total = d.allocations.reduce((s, al) => s + Number(al.amount), 0) || 1;
        const bagian = new Map(); const aturan = []; let tahap = TAHAP.RELASI; const konflik = [];
        for (const al of d.allocations) {
          const t = billMap.get(al.billId);
          const scope = t?.bagian?.[0]?.scope ?? TIDAK_TERKLASIFIKASI;
          bagian.set(scope, (bagian.get(scope) ?? 0) + Number(al.amount) / total);
          if (!t || t.tahap === TAHAP.TIDAK) tahap = TAHAP.TIDAK;
          else if (tahap !== TAHAP.TIDAK && t.tahap === TAHAP.SHARED) tahap = TAHAP.SHARED;
          if (t?.konflik?.length) konflik.push(...t.konflik);
          aturan.push(t?.aturan ?? "tagihan tanpa bukti divisi");
        }
        a = satu(TIDAK_TERKLASIFIKASI, tahap, `Mengikuti divisi tagihan yang dibayar (${uniq(aturan).join("; ")})`, { dokumen: { modul: "supplier-utang", id, nomor: d.paymentNumber } });
        a.bagian = [...bagian].map(([scope, bobot]) => ({ scope, bobot })); a.konflik = uniq(konflik);
      }
    } else if (x.source === "UANG_MUKA_OPERASIONAL") {
      const d = M.adv.get(id);
      if (!d) a = tidak("Uang muka sumber tidak ditemukan");
      else {
        const p = putuskan({ eksplisit: d.division !== "UMUM" ? peta(d.division) : null, umum: d.division === "UMUM" });
        a = { ...dariPutusan(p, tidak("Uang muka tanpa bukti divisi")), dokumen: { modul: "uang-muka", id, nomor: d.advanceNumber }, kategori: null, sensitif: false };
      }
    } else if (x.source === "BIAYA_IKLAN") {
      const ad = M.ad.get(id);
      const kat = katOtomatis.get("ADSPEND");
      const scope = kat ? peta(kat.division) : null;
      const dok = { modul: "ad-spend", id, nomor: ad ? `${ad.source} ${String(ad.month).padStart(2, "0")}/${ad.year}` : null };
      a = scope && scope !== "SHARED"
        ? satu(scope, TAHAP.KATEGORI, `Pemilik belanja iklan platform = ${kat.division} (kategori ${kat.code} terkonfigurasi)`, { kategori: { kode: kat.code, nama: kat.name }, dokumen: dok, proyek: ad?.source ?? null })
        : tidak("Kategori ADSPEND belum dipetakan ke divisi", { dokumen: dok, proyek: ad?.source ?? null });
    } else if (x.source === "PEMAKAIAN_BAHAN") {
      const mi = M.iss.get(id); const mv = M.mov.get(id); const ct = M.cnt.get(id);
      if (mi) {
        a = SUMBER_ISSUE_PRODUKSI.includes(mi.sourceType) || mi.unitId
          ? satu("PRODUCTION", TAHAP.RELASI, `Material issue ${mi.issueNumber} untuk produksi (${mi.sourceType}${mi.unitId ? ", unit produksi" : ""})`, { dokumen: { modul: "material-issue", id, nomor: mi.issueNumber } })
          : tidak(`Material issue ${mi.issueNumber} jenis ${mi.sourceType} — pemakaian non-produksi tidak terbukti milik divisi`, { dokumen: { modul: "material-issue", id, nomor: mi.issueNumber } });
      } else if (mv) {
        a = mv.type === "WASTE" || mv.type === "ADJUSTMENT" ? satu("WAREHOUSE", TAHAP.RELASI, `Pergerakan stok ${mv.type} (kerusakan/kehilangan/selisih) dikelola Gudang`, { dokumen: { modul: "stock-movement", id, nomor: null } })
          : mv.unitId ? satu("PRODUCTION", TAHAP.RELASI, "Pergerakan stok ke unit produksi", { dokumen: { modul: "stock-movement", id, nomor: null } })
          : tidak(`Pergerakan stok ${mv.type} lepas tanpa unit/dokumen`, { dokumen: { modul: "stock-movement", id, nomor: null } });
      } else if (ct) a = satu("WAREHOUSE", TAHAP.RELASI, `Selisih stock opname ${ct.countNumber ?? ""} dikelola Gudang`, { dokumen: { modul: "stock-count", id, nomor: ct.countNumber } });
      else a = tidak("Sumber pemakaian bahan tidak ditemukan");
    } else if (x.source === "PENERIMAAN_BAHAN") {
      a = satu("WAREHOUSE", TAHAP.RELASI, "Penerimaan barang = nilai persediaan yang dikelola Gudang (bukan beban)", { dokumen: { modul: "goods-receipt", id, nomor: null } });
    } else {
      // MANUAL (dan pembaliknya) = biaya tanpa dokumen → TIDAK_TERKLASIFIKASI. Sumber yang BUKAN biaya divisi (pembayaran/pengakuan order, saldo awal, rekonsiliasi,
      // pemasukan lain, persediaan awal) → DI_LUAR_DIVISI: dilaporkan di jembatan, tidak dihitung sebagai kebocoran klasifikasi.
      a = x.source === "MANUAL"
        ? tidak("Jurnal manual tanpa dokumen sumber — divisi tidak terbukti")
        : SUMBER_BIAYA.includes(x.source) ? tidak(`Sumber ${x.source} tidak membawa divisi`) : satu(DI_LUAR_DIVISI, TAHAP.BUKAN_BIAYA, `Sumber ${x.source} bukan biaya divisi (pendapatan/saldo awal/rekonsiliasi)`);
    }
    hasil.set(x.entry.id, { ...a, balik: x.balik, sumberAsli: x.source });
  }
  return hasil;
}

/**
 * Atribusi DOKUMEN yang menjadi Komitmen (belum/tidak seluruhnya menjadi beban atau kas keluar). Aturan SAMA dengan atribusiEntri.
 * @returns { pengeluaran:Map, pembelian:Map, tagihan:Map } id → atribusi
 */
export async function atribusiDokumenKomitmen(db, { expenses = [], purchases = [], bills = [] }) {
  const katBill = await muatKategoriTagihan(db, bills);
  return {
    pengeluaran: new Map(expenses.map((d) => [d.id, atribusiPengeluaran(d)])),
    pembelian: new Map(purchases.map((d) => [d.id, atribusiPembelian(d)])),
    tagihan: new Map(bills.map((b) => [b.id, atribusiTagihan(b, b.expenseCategoryId ? katBill.get(b.expenseCategoryId) ?? null : null)])),
  };
}
