// KOREKSI PENERIMAAN SESUDAH "SIMPAN KE STOK" (Okt 2026) — dipanggil dari koreksiKedatangan (SATU pintu koreksi; modul ini bukan pintu kedua).
//
// Catatan lama TIDAK diubah/dihapus. Koreksi jumlah BAIK pada penerimaan yang sudah COMPLETED dibuat sebagai:
//   • stok  : pergerakan RECEIPT pembalik (qty negatif, harga sama dengan aslinya) + RECEIPT pengganti (qty baru) — keduanya bertaut ke penerimaan, dengan catatan koreksi;
//   • buku  : SATU jurnal koreksi (selisih nilai saja; sumber PENERIMAAN_BAHAN, kunci PENERIMAAN_BAHAN:{id}:KOREKSI:{revisi}). Jurnal penerimaan asli tetap POSTED — pembaca lama
//             (tagihan lama, gerbang retur) mencarinya lewat kunci aslinya.
// Hanya dijalankan bila SEMUA hal berikut bisa dibuktikan aman; selain itu DIBLOKIR dengan sebab dan arah tindakan:
//   1. tidak ada Retur Supplier aktif pada baris (kontrak Retur: pastikanTanpaReturAktif; trigger DB = pagar terakhir),
//   2. tidak ada faktur disetujui yang mengklaim baris itu, dan tidak ada tagihan lama aktif yang menutup penerimaan,
//   3. bahan itu belum bergerak SEJAK penerimaan disimpan (tidak ada ISSUE/WASTE/ADJUSTMENT/TRANSFER/RETURN/SUPPLIER_RETURN): rata-rata tertimbang tanpa lot → asal stok tak bisa dipastikan,
//   4. harga perolehan ada, jurnal penerimaan asli ada & berlaku, ledger sinkron dengan jumlah baik tercatat,
//   5. stok tersedia (stok − reservasi) cukup untuk pengurangan, dan periode pembukuan HARI INI terbuka (koreksi dibukukan hari ini; periode lama tidak disentuh),
//   6. jumlah baru tidak melampaui PO. Faktur disetujui, pembayaran, dan periode tertutup TIDAK pernah diubah diam-diam.
import { Decimal, toMoney, sumMoney, ZERO } from "./money.js";
import { postStockMovement, lockMaterialBalance, RESERVED_STATUSES } from "../inventoryLedger.js";
import { postJournal, todayBookDateWIB } from "./journal.js";
import { resolveAccount, SYSTEM_KEYS } from "./accounts.js";
import { nilaiBarisPenerimaan } from "./posting/supplier.js";
import { periksaKonversiBaris } from "./skuBaru.js";
import { hitungKuantitas } from "./purchaseOrder.js";

const MASUK_BUKU = ["DISETUJUI", "DIBAYAR_SEBAGIAN", "LUNAS"];
const TIDAK_AKTIF = ["DIBATALKAN", "DITOLAK"];
const k = (v) => Math.round(Number(v ?? 0) * 1000);
const dariK = (n) => n / 1000;
const d = (v) => new Decimal(String(v ?? 0));

/** Pesan kegagalan dengan kode + arah tindakan. `Galat` dilempar dari kedatangan.js (KedatanganError) supaya satu jenis galat. */
export function buatGalat(Galat) {
  return (pesan, status, kode, arah) => { const e = new Galat(pesan, status, kode); if (arah) e.arah = arah; return e; };
}

/** Kontrak Retur Supplier: koreksi kuantitas ditolak (409 RETUR_AKTIF) bila baris punya retur draf/keluar/selesai. Tidak berbuat apa pun bila fitur Retur belum terpasang di build ini. */
export async function pastikanTanpaReturAktifJikaAda(tx, opsi) {
  if (!tx?.supplierReturnLine) return;
  const { pastikanTanpaReturAktif } = await import("./returSupplier.js");
  await pastikanTanpaReturAktif(tx, opsi);
}

async function reservasi(tx, materialId) {
  const [{ reserved }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(qty), 0)::float AS reserved FROM (
      SELECT mil.requested_qty AS qty FROM material_issue_lines mil JOIN material_issues mi ON mi.id = mil.material_issue_id
      WHERE mil.material_id = ${materialId}::uuid AND mi.status = ANY(${RESERVED_STATUSES}::"IssueStatus"[]) AND mi.production_plan_id IS NULL
      UNION ALL
      SELECT r.qty::float FROM material_reservations_v2 r WHERE r.material_id = ${materialId}::uuid AND r.status = 'ACTIVE'
    ) u`;
  return reserved;
}

async function periodeTertutupHariIni(tx, sekarang) {
  const t = todayBookDateWIB(sekarang);
  const p = await tx.finPeriod.findUnique({ where: { year_month: { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1 } }, select: { status: true } });
  return { tutup: p?.status === "CLOSED", bulan: `${String(t.getUTCMonth() + 1).padStart(2, "0")}/${t.getUTCFullYear()}` };
}

/**
 * Periksa & rencanakan koreksi jumlah BAIK satu baris penerimaan COMPLETED. Murni baca (kecuali kunci yang sudah dipegang pemanggil).
 * Mengembalikan rencana { baris, pl, material, lama, baru, qtyStok{lama,baru,selisih}, harga{bulat,eksak}, nilai{lama,baru,selisih}, lokasi, supplier, faktur[] } atau melempar galat.
 */
export async function rencanaBaikSesudahStok(tx, { galat, receipt, baris, pl, po, baruBaik, sekarang = new Date() }) {
  const kode = pl.material.code;
  const lama = Number(baris.acceptedQty ?? 0);
  if (k(baruBaik) === k(lama)) return null;
  if (po.status === "DIBATALKAN") throw galat(`PO ${po.poNumber} dibatalkan — jumlah baik ${kode} tidak bisa dikoreksi.`, 409, "PO_DIBATALKAN", "Hubungi Finance.");

  // 1. Retur aktif (kontrak Retur Supplier)
  await pastikanTanpaReturAktifJikaAda(tx, { goodsReceiptLineId: baris.id });

  // 2. Faktur / tagihan
  const alokasi = await tx.finSupplierBillAllocation.findMany({
    where: { goodsReceiptLineId: baris.id, bill: { status: { in: MASUK_BUKU } } },
    select: { qty: true, bill: { select: { billNumber: true, status: true } } },
  });
  if (alokasi.length > 0) {
    const nomor = [...new Set(alokasi.map((a) => `${a.bill.billNumber} (${a.bill.status})`))].join(", ");
    throw galat(`Jumlah baik ${kode} pada ${receipt.receiptNumber} sudah ditagih faktur disetujui: ${nomor}. Faktur disetujui, pembayaran, dan jurnalnya tidak diubah diam-diam.`, 409, "FAKTUR_DISETUJUI",
      "Finance: batalkan faktur itu (jurnal dibalik, klaim dilepas; batalkan pembayarannya lebih dulu bila ada), koreksi jumlah baik di sini, lalu catat ulang faktur.");
  }
  const lain = await tx.finSupplierBill.findMany({ where: { goodsReceiptId: receipt.id, status: { notIn: TIDAK_AKTIF } }, select: { billNumber: true, status: true } });
  if (lain.length > 0) {
    throw galat(`Penerimaan ${receipt.receiptNumber} ditutup tagihan lama (${lain.map((b) => `${b.billNumber} ${b.status}`).join(", ")}) yang nilainya bertumpu pada jumlah baik tercatat.`, 409, "TAGIHAN_LAMA",
      "Finance: batalkan atau koreksi tagihan itu lebih dulu, lalu ulangi koreksi penerimaan.");
  }

  // Ledger: pergerakan RECEIPT penerimaan ini untuk bahan tsb. Dua baris bahan sama pada satu penerimaan tidak bisa dipisahkan dari ledger → blokir.
  const sama = receipt.lines.filter((l) => l.materialId === baris.materialId && Number(l.acceptedQty ?? 0) > 0 && l.id !== baris.id);
  if (sama.length > 0) throw galat(`Penerimaan ${receipt.receiptNumber} memuat lebih dari satu baris ${kode} yang masuk stok — koreksi per baris tidak bisa dipisahkan dari ledger.`, 409, "BARIS_GANDA_BAHAN", "Hubungi pengembang/Admin: koreksi lewat penyesuaian stok manual.");
  const gerakan = await tx.stockMovement.findMany({ where: { goodsReceiptId: receipt.id, materialId: baris.materialId, type: "RECEIPT" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, qty: true, unitCost: true, unitCostExact: true, location: true, supplier: true, createdAt: true } });
  const faktorStok = pl.purchaseUnit && pl.conversionFactor != null ? d(pl.conversionFactor) : d(1);
  const qtyLama = d(lama).times(faktorStok);
  const bersih = gerakan.reduce((s, m) => s.plus(d(m.qty)), ZERO);
  if (lama > 0 && gerakan.length === 0) throw galat(`Pergerakan stok penerimaan ${receipt.receiptNumber} untuk ${kode} tidak ditemukan padahal jumlah baik ${lama} tercatat.`, 409, "LEDGER_TIDAK_SINKRON", "Periksa Stok & Lokasi; selesaikan lewat penyesuaian stok oleh Gudang.");
  if (!bersih.equals(qtyLama.toDecimalPlaces(4))) throw galat(`Ledger stok ${kode} dari ${receipt.receiptNumber} (${bersih.toString()}) tidak sama dengan jumlah baik tercatat (${qtyLama.toString()}).`, 409, "LEDGER_TIDAK_SINKRON", "Selesaikan lewat penyesuaian stok (opname) oleh Gudang; koreksi penerimaan tidak menambal selisih ledger.");

  // 3. Bahan sudah bergerak sejak disimpan?
  const awal = gerakan[0]?.createdAt ?? null;
  if (awal) {
    const bergerak = await tx.stockMovement.groupBy({ by: ["type"], where: { materialId: baris.materialId, createdAt: { gt: awal }, NOT: { type: "RECEIPT" } }, _sum: { qty: true }, _count: { _all: true } });
    if (bergerak.length > 0) {
      const ringkas = bergerak.map((b) => `${b.type} ${Math.abs(Number(b._sum.qty ?? 0))} (${b._count._all}×)`).join(", ");
      throw galat(`Bahan ${kode} sudah bergerak sejak ${receipt.receiptNumber} disimpan ke stok: ${ringkas}. Sistem memakai rata-rata tertimbang tanpa lot, jadi asal barang yang keluar tidak bisa dipastikan dan koreksi pembalik/pengganti tidak bisa dibuktikan aman bagi pemakaian Produksi.`, 409, "STOK_SUDAH_BERGERAK",
        "Selesaikan lewat koreksi stok (opname/penyesuaian) oleh Gudang setelah memastikan fisik di rak; koreksi penerimaan hanya untuk bahan yang belum bergerak.");
    }
  }

  // 4. Harga & jurnal asli
  const sumber = gerakan.find((m) => Number(m.qty) > 0) ?? null;
  const hargaEksak = sumber ? (sumber.unitCostExact != null ? d(sumber.unitCostExact) : sumber.unitCost != null ? d(sumber.unitCost) : null)
    : pl.unitPrice != null ? (pl.purchaseUnit && pl.conversionFactor != null ? d(pl.unitPrice).dividedBy(d(pl.conversionFactor)).toDecimalPlaces(8) : d(pl.unitPrice)) : null;
  if (hargaEksak == null || !hargaEksak.greaterThan(0)) throw galat(`Harga perolehan ${kode} pada ${receipt.receiptNumber} tidak ada — tidak bisa dinilai.`, 409, "HARGA_TIDAK_ADA", "Lengkapi harga penerimaan di Finance (Data Belum Lengkap) lebih dulu.");
  const jurnalAsal = await tx.finJournalEntry.findFirst({ where: { source: "PENERIMAAN_BAHAN", sourceId: receipt.id, idempotencyKey: `PENERIMAAN_BAHAN:${receipt.id}`, status: "POSTED" }, select: { id: true, entryNumber: true } });
  if (!jurnalAsal) throw galat(`Nilai penerimaan ${receipt.receiptNumber} belum dibukukan ke Persediaan (atau jurnalnya sudah dibalik) — koreksi jumlah akan membuat selisih tanpa dasar.`, 409, "PENERIMAAN_BELUM_DIBUKUKAN", "Selesaikan pembukuan penerimaan (Finance › Data Belum Lengkap / Posting Tertunda), lalu ulangi.");

  // 5. Jumlah baru: presisi konversi, batas PO, stok tersedia, periode
  let qtyBaru = d(baruBaik).times(faktorStok);
  if (pl.purchaseUnit && pl.conversionFactor != null && baruBaik > 0) {
    try { qtyBaru = periksaKonversiBaris({ qty: baruBaik, faktor: pl.conversionFactor, hargaBeli: pl.unitPrice }); }
    catch (e) { if (typeof e?.statusCode === "number") throw galat(e.message, 409, e.code ?? "PRESISI_STOK", "Ubah jumlah baik supaya hasil konversi satuan stok bulat."); throw e; }
  }
  const q = (await hitungKuantitas(tx, po)).get(pl.id);
  const maks = dariK(k(q.belumDiterima) + k(lama));
  if (k(baruBaik) > k(maks)) throw galat(`Jumlah baik ${kode} (${baruBaik} ${pl.unit}) melebihi sisa PO ${po.poNumber}: maksimal ${maks} ${pl.unit} (dipesan ${q.dipesan}).`, 409, "MELEBIHI_PO", "Kurangi jumlah baik, atau minta Finance merevisi jumlah PO.");
  const selisihStok = qtyBaru.minus(qtyLama);
  if (selisihStok.isNegative()) {
    const [{ saldo }] = await tx.$queryRaw`SELECT COALESCE(SUM(qty), 0)::float AS saldo FROM stock_movements WHERE material_id = ${baris.materialId}::uuid`;
    const tersedia = saldo - (await reservasi(tx, baris.materialId));
    if (tersedia + 1e-6 < selisihStok.abs().toNumber()) {
      throw galat(`Stok ${kode} tersedia ${Math.max(0, tersedia)} (stok ${saldo}, termasuk reservasi) tidak cukup untuk mengurangi ${selisihStok.abs().toString()}.`, 409, tersedia < saldo - 1e-6 ? "STOK_DIRESERVASI" : "STOK_TIDAK_CUKUP", "Batalkan/selesaikan reservasi Material Issue yang memakai bahan ini, atau selesaikan lewat penyesuaian stok.");
    }
  }
  const per = await periodeTertutupHariIni(tx, sekarang);
  if (per.tutup) throw galat(`Periode ${per.bulan} sudah ditutup — koreksi dibukukan pada tanggal hari ini sehingga tidak bisa diposting.`, 409, "PERIODE_TERTUTUP", "Minta Finance membuka kembali periodenya (Finance › Pengaturan), lalu ulangi.");

  const nilaiLama = nilaiBarisPenerimaan(qtyLama, hargaEksak);
  const nilaiBaru = nilaiBarisPenerimaan(qtyBaru, hargaEksak);
  // Pending (belum disetujui): hanya informasi — dihitung ulang saat disetujui.
  const tertunda = await tx.finSupplierBill.findMany({ where: { purchaseOrderId: po.id, status: { in: ["DRAFT", "MENUNGGU_APPROVAL"] } }, select: { billNumber: true, status: true } });
  return {
    baris, pl, kode, satuan: pl.unit, lama, baru: baruBaik,
    qtyStok: { lama: qtyLama, baru: qtyBaru, selisih: selisihStok },
    harga: { eksak: hargaEksak, bulat: Math.max(1, hargaEksak.toDecimalPlaces(0).toNumber()), eksakDisimpan: sumber?.unitCostExact != null || (pl.purchaseUnit && pl.conversionFactor != null) },
    nilai: { lama: nilaiLama, baru: nilaiBaru, selisih: nilaiBaru.minus(nilaiLama) },
    lokasi: sumber?.location ?? "GUDANG_UTAMA", supplier: sumber?.supplier ?? receipt.supplier ?? null,
    jurnalAsal, fakturTertunda: tertunda.map((b) => `${b.billNumber} (${b.status})`),
  };
}

/**
 * Tulis pembalik + pengganti (stok) dan satu jurnal koreksi (buku) untuk semua rencana. Dipanggil SETELAH semua pemeriksaan lulus, di transaksi pemanggil.
 * Urutan kunci: penerimaan → PO (pemanggil) → material (urut id; lockMaterialBalance di dalam postStockMovement).
 */
export async function terapkanBaikSesudahStok(tx, { galat, receipt, rencana, aktor, revisiBaru, alasan, sekarang = new Date() }) {
  const urut = [...rencana].sort((a, b) => (a.baris.materialId < b.baris.materialId ? -1 : a.baris.materialId > b.baris.materialId ? 1 : 0));
  const pergerakan = [];
  for (const r of urut) await lockMaterialBalance(tx, r.baris.materialId);
  for (const r of urut) {
    const bersih = (await tx.stockMovement.aggregate({ where: { goodsReceiptId: receipt.id, materialId: r.baris.materialId, type: "RECEIPT" }, _sum: { qty: true } }))._sum.qty;
    const cat = `Koreksi penerimaan ${receipt.receiptNumber} rev.${revisiBaru}: jumlah baik ${r.lama} → ${r.baru} ${r.satuan}`.slice(0, 480);
    const harga = { unitCost: r.harga.bulat, ...(r.harga.eksakDisimpan ? { unitCostExact: r.harga.eksak.toString() } : {}) };
    if (d(bersih).greaterThan(0)) {
      const m = await postStockMovement(tx, { materialId: r.baris.materialId, type: "RECEIPT", qty: d(bersih).negated().toString(), ...harga, location: r.lokasi, supplier: r.supplier, goodsReceiptId: receipt.id, reason: alasan.slice(0, 400), note: `Pembalik — ${cat}`, createdById: aktor.userId });
      pergerakan.push({ id: m.id, peran: "PEMBALIK", kode: r.kode, qty: Number(m.qty) });
    }
    if (r.qtyStok.baru.greaterThan(0)) {
      const m = await postStockMovement(tx, { materialId: r.baris.materialId, type: "RECEIPT", qty: r.qtyStok.baru.toString(), ...harga, location: r.lokasi, supplier: r.supplier, goodsReceiptId: receipt.id, reason: alasan.slice(0, 400), note: `Pengganti — ${cat}`, createdById: aktor.userId });
      pergerakan.push({ id: m.id, peran: "PENGGANTI", kode: r.kode, qty: Number(m.qty) });
    }
  }
  const selisih = sumMoney(rencana.map((r) => r.nilai.selisih));
  let jurnal = null;
  if (!selisih.isZero()) {
    const persediaan = await resolveAccount(tx, SYSTEM_KEYS.PERSEDIAAN_BAHAN);
    const grni = await resolveAccount(tx, SYSTEM_KEYS.UTANG_BELUM_DITAGIH);
    const turun = selisih.isNegative();
    const nilai = turun ? selisih.negated() : selisih;
    const ket = rencana.map((r) => `${r.kode} ${r.lama}→${r.baru} ${r.satuan}`).join("; ");
    try {
      const { entry } = await postJournal(tx, {
        date: todayBookDateWIB(sekarang), description: `Koreksi penerimaan ${receipt.receiptNumber} (rev.${revisiBaru}): ${ket}`.slice(0, 240),
        source: "PENERIMAAN_BAHAN", sourceId: receipt.id, idempotencyKey: `PENERIMAAN_BAHAN:${receipt.id}:KOREKSI:${revisiBaru}`, userId: aktor.userId,
        lines: turun
          ? [{ accountId: grni.id, debit: nilai, description: `Koreksi penerimaan ${receipt.receiptNumber}: barang baik berkurang` }, { accountId: persediaan.id, credit: nilai, description: `Koreksi penerimaan ${receipt.receiptNumber}: persediaan dikurangi` }]
          : [{ accountId: persediaan.id, debit: nilai, description: `Koreksi penerimaan ${receipt.receiptNumber}: persediaan bertambah` }, { accountId: grni.id, credit: nilai, description: `Koreksi penerimaan ${receipt.receiptNumber}: barang baik bertambah` }],
      });
      jurnal = { id: entry.id, nomor: entry.entryNumber, arah: turun ? "KURANG" : "TAMBAH", nilai: nilai.toFixed(2) };
    } catch (e) {
      if (e?.statusCode || e?.name === "JournalError" || e?.name === "AccountError") throw galat(`Jurnal koreksi tidak bisa diposting: ${e.message}`, 409, "JURNAL_GAGAL", "Periksa bagan akun/periode di Finance, lalu ulangi. Tidak ada stok atau data yang berubah.");
      throw e;
    }
  }
  return { pergerakan, jurnal, selisihNilai: selisih };
}

export const _uji = { k, dariK };
