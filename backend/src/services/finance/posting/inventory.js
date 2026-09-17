// POSTING PERSEDIAAN — HPP (harga pokok) bahan yang dipakai produksi,
// susut/waste, dan selisih stock opname.
//
// ════════════════════════════════════════════════════════════════════════
// DUA ATURAN YANG TIDAK BOLEH DILANGGAR
// ════════════════════════════════════════════════════════════════════════
//
// 1. TIDAK MENULIS SATU BARIS PUN KE stock_movements. Kuantitas adalah milik
//    services/inventoryLedger.js. File ini cuma MEMBACA baris yang sudah
//    ditulis gudang dan menurunkan nilai rupiahnya. Kalau suatu saat ada
//    godaan "sekalian catat pergerakan stoknya dari finance" — itu persis
//    sumber data tandingan yang dilarang aturan 1 di kepala blok finance.
//
// 2. HPP TIDAK PERNAH DIKARANG. Harga perolehan hanya diketahui dari baris
//    RECEIPT yang punya unitCost (diisi gudang saat goods receipt). Material
//    yang belum pernah punya riwayat harga TIDAK dinilai dengan angka
//    tebakan, tidak dengan Material.referenceUnitCost (itu SNAPSHOT import
//    Excel Agustus 2026, bukan nilai hidup — lihat komentarnya di
//    schema.prisma), dan tidak dengan rata-rata material lain. Yang terjadi:
//    baris FinPostingGap lahir, angkanya tampil sebagai pekerjaan di
//    workspace Finance, dan Laba Rugi JUJUR menyebut ada HPP yang belum
//    terbukukan alih-alih terlihat lebih untung dari kenyataan.
//
// ── METODE PENILAIAN: RATA-RATA TERTIMBANG BERJALAN ─────────────────────
// hargaRataRata(material) = Σ(qty × unitCost) ÷ Σ(qty) atas SELURUH baris
// RECEIPT bermuatan harga sampai saat itu. Dipilih (bukan FIFO) karena
// stock_movements TIDAK menyimpan lot/batch yang bisa ditelusuri per
// pengeluaran — memaksa FIFO berarti mengarang pasangan "keluar ini dari
// lot yang mana", yang justru melanggar aturan 2.

import { postJournal, recordPostingGap, findEntryByKey } from "../journal.js";
import { resolveAccount, SYSTEM_KEYS, AccountError } from "../accounts.js";
import { toMoney, sumMoney, ZERO } from "../money.js";

export const KEY = {
  materialIssue: (id) => `PEMAKAIAN_BAHAN:${id}`,
  movement: (id) => `PEMAKAIAN_BAHAN_MOVEMENT:${id}`,
};

/**
 * Harga rata-rata tertimbang satu material dari ledger stok.
 * Mengembalikan null kalau material itu belum pernah punya penerimaan
 * bermuatan harga — pemanggil WAJIB memperlakukan null sebagai gap, bukan
 * sebagai nol.
 */
export async function hargaRataRata(tx, materialId) {
  const receipts = await tx.stockMovement.findMany({
    where: { materialId, type: "RECEIPT", unitCost: { not: null } },
    select: { qty: true, unitCost: true },
  });
  const berharga = receipts.filter((r) => Number(r.qty) > 0 && r.unitCost > 0);
  if (berharga.length === 0) return null;

  const totalNilai = sumMoney(berharga.map((r) => toMoney(r.qty).times(toMoney(r.unitCost))));
  const totalQty = sumMoney(berharga.map((r) => r.qty));
  if (totalQty.isZero()) return null;
  return totalNilai.dividedBy(totalQty);
}

// Jenis pergerakan yang MENGURANGI persediaan dan akun beban tujuannya.
// ISSUE (ke produksi) = harga pokok. WASTE = susut. ADJUSTMENT = selisih
// opname, satu-satunya yang bisa dua arah.
const AKUN_PER_TIPE = {
  ISSUE: SYSTEM_KEYS.BEBAN_POKOK_BAHAN,
  WASTE: SYSTEM_KEYS.BEBAN_SUSUT_BAHAN,
  ADJUSTMENT: SYSTEM_KEYS.SELISIH_STOK,
  RETURN: SYSTEM_KEYS.BEBAN_POKOK_BAHAN, // retur bahan dari produksi = HPP berkurang
};

/**
 * Bukukan nilai SEKUMPULAN pergerakan stok yang lahir dari satu dokumen
 * (Material Issue, stock count, dst) jadi SATU jurnal.
 *
 * Satu jurnal per DOKUMEN, bukan per baris movement — supaya buku besar
 * terbaca sebagai peristiwa bisnis ("Pengeluaran material MI-001 untuk unit
 * X") alih-alih ratusan baris tanpa konteks yang mustahil dicocokkan dengan
 * dokumen gudangnya.
 *
 * @param movementWhere  filter Prisma untuk stock_movements dokumen itu
 */
async function bukukanPergerakan(tx, {
  movementWhere, source, sourceId, idempotencyKey, description, date, userId = null, gapLabel,
}) {
  const sudahAda = await findEntryByKey(tx, idempotencyKey);
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  const movements = await tx.stockMovement.findMany({
    where: movementWhere,
    select: {
      id: true, type: true, qty: true, unitId: true,
      material: { select: { id: true, code: true, name: true } },
    },
  });
  if (movements.length === 0) return { posted: false, reason: "tidak_ada_pergerakan" };

  const persediaanNaik = []; // baris yang MENAMBAH persediaan (qty positif)
  const persediaanTurun = [];
  const tanpaHarga = [];

  for (const m of movements) {
    const harga = await hargaRataRata(tx, m.material.id);
    if (harga == null) {
      tanpaHarga.push(m);
      continue;
    }
    const qty = toMoney(m.qty);
    const nilai = qty.times(harga).abs();
    if (nilai.isZero()) continue;
    const baris = { movement: m, nilai, akunKey: AKUN_PER_TIPE[m.type] || SYSTEM_KEYS.SELISIH_STOK };
    if (qty.greaterThan(0)) persediaanNaik.push(baris);
    else persediaanTurun.push(baris);
  }

  if (tanpaHarga.length > 0) {
    await recordPostingGap(tx, {
      source,
      sourceId,
      reason: "TANPA_HARGA_PEROLEHAN",
      detail:
        `${gapLabel}: ${tanpaHarga.length} dari ${movements.length} baris bahan belum punya harga perolehan ` +
        "di ledger stok, jadi nilainya belum masuk Laba Rugi. Isi harga satuan lewat Penerimaan Barang " +
        `di Gudang, lalu posting ulang. Material: ${tanpaHarga.map((m) => m.material.code).join(", ")}`,
      metadata: {
        sourceId,
        materialTanpaHarga: tanpaHarga.map((m) => ({ code: m.material.code, name: m.material.name, qty: String(m.qty) })),
      },
    });
  }

  if (persediaanNaik.length === 0 && persediaanTurun.length === 0) {
    return { posted: false, gap: tanpaHarga.length > 0, reason: "tidak_ada_nilai" };
  }

  try {
    const persediaan = await resolveAccount(tx, SYSTEM_KEYS.PERSEDIAAN_BAHAN);
    const lines = [];

    // Gabungkan per akun beban supaya jurnalnya ringkas & terbaca, tapi
    // dimensi unitId tetap dibawa per baris kalau seluruh pergerakan dalam
    // kelompok itu memang menunjuk unit yang sama.
    const perAkun = new Map();
    for (const b of [...persediaanTurun, ...persediaanNaik]) {
      const key = `${b.akunKey}|${b.movement.unitId || ""}|${b.movement.qty > 0 ? "naik" : "turun"}`;
      if (!perAkun.has(key)) {
        perAkun.set(key, { akunKey: b.akunKey, unitId: b.movement.unitId, naik: Number(b.movement.qty) > 0, nilai: ZERO, jumlah: 0 });
      }
      const g = perAkun.get(key);
      g.nilai = g.nilai.plus(b.nilai);
      g.jumlah += 1;
    }

    let totalTurun = ZERO;
    let totalNaik = ZERO;

    for (const g of perAkun.values()) {
      const akun = await resolveAccount(tx, g.akunKey);
      if (g.naik) {
        // Persediaan BERTAMBAH → beban berkurang (kredit akun beban).
        totalNaik = totalNaik.plus(g.nilai);
        lines.push({
          accountId: akun.id,
          credit: g.nilai,
          description: `${g.jumlah} baris bahan masuk kembali`,
          unitId: g.unitId,
        });
      } else {
        totalTurun = totalTurun.plus(g.nilai);
        lines.push({
          accountId: akun.id,
          debit: g.nilai,
          description: `${g.jumlah} baris bahan terpakai`,
          unitId: g.unitId,
        });
      }
    }

    if (totalTurun.greaterThan(0)) {
      lines.push({ accountId: persediaan.id, credit: totalTurun, description: "Persediaan bahan berkurang" });
    }
    if (totalNaik.greaterThan(0)) {
      lines.push({ accountId: persediaan.id, debit: totalNaik, description: "Persediaan bahan bertambah" });
    }

    const { entry, created } = await postJournal(tx, {
      date, description, source, sourceId, idempotencyKey, userId, lines,
    });
    return { posted: true, entry, created, gap: tanpaHarga.length > 0 };
  } catch (err) {
    if (!(err instanceof AccountError)) throw err;
    await recordPostingGap(tx, {
      source, sourceId,
      reason: "AKUN_SISTEM_BELUM_SIAP",
      detail: `${gapLabel} belum dibukukan: ${err.message}`,
      metadata: { sourceId },
    });
    return { posted: false, gap: true };
  }
}

/**
 * HPP dari satu Material Issue yang sudah ISSUED (stock_movements-nya sudah
 * ditulis gudang). Dipanggil SETELAH postStockMovement, bukan sebelum.
 */
export async function postMaterialIssueCost(tx, { materialIssueId, userId = null }) {
  const mi = await tx.materialIssue.findUnique({
    where: { id: materialIssueId },
    select: { id: true, issueNumber: true, department: true, issuedAt: true, createdAt: true, unitId: true },
  });
  if (!mi) throw new Error(`Material issue ${materialIssueId} tidak ditemukan`);

  return bukukanPergerakan(tx, {
    movementWhere: { materialIssueId },
    source: "PEMAKAIAN_BAHAN",
    sourceId: materialIssueId,
    idempotencyKey: KEY.materialIssue(materialIssueId),
    description: `Pemakaian bahan ${mi.issueNumber}${mi.department ? ` — ${mi.department}` : ""}`,
    date: mi.issuedAt || mi.createdAt,
    userId,
    gapLabel: `Pemakaian bahan ${mi.issueNumber}`,
  });
}

/**
 * HPP dari satu pergerakan stok LEPAS — jalur satu langkah yang sudah ada
 * sejak v1 inventory (POST /inventory/movements/issue|waste|adjustment,
 * lihat komentar "v1 inventory cuma punya POST /movements/issue" di
 * schema.prisma). Jalur itu TIDAK punya dokumen induk, jadi idempotensinya
 * per baris movement.
 */
export async function postStockMovementCost(tx, { movementId, userId = null }) {
  const m = await tx.stockMovement.findUnique({
    where: { id: movementId },
    select: {
      id: true, type: true, createdAt: true, materialIssueId: true, goodsReceiptId: true,
      material: { select: { code: true, name: true } },
    },
  });
  if (!m) throw new Error(`Stock movement ${movementId} tidak ditemukan`);
  // Baris yang punya dokumen induk dibukukan lewat dokumennya — kalau ikut
  // dibukukan di sini juga, nilainya dobel.
  if (m.materialIssueId || m.goodsReceiptId) return { posted: false, reason: "punya_dokumen_induk" };
  if (!AKUN_PER_TIPE[m.type]) return { posted: false, reason: "tipe_tidak_dinilai" };

  return bukukanPergerakan(tx, {
    movementWhere: { id: movementId },
    source: "PEMAKAIAN_BAHAN",
    sourceId: movementId,
    idempotencyKey: KEY.movement(movementId),
    description: `${m.type} bahan ${m.material.code} — ${m.material.name}`,
    date: m.createdAt,
    userId,
    gapLabel: `Pergerakan stok ${m.material.code}`,
  });
}

/** Selisih hasil stock opname — satu jurnal per sesi StockCount. */
export async function postStockCountVariance(tx, { stockCountId, userId = null }) {
  const sc = await tx.stockCount.findUnique({
    where: { id: stockCountId },
    select: { id: true, countNumber: true, scheduledDate: true, createdAt: true },
  });
  if (!sc) throw new Error(`Stock count ${stockCountId} tidak ditemukan`);

  return bukukanPergerakan(tx, {
    movementWhere: { stockCountId },
    source: "PEMAKAIAN_BAHAN",
    sourceId: stockCountId,
    idempotencyKey: `SELISIH_OPNAME:${stockCountId}`,
    description: `Selisih stock opname ${sc.countNumber || stockCountId}`,
    // StockCount tidak punya kolom "tanggal hitung selesai" — scheduledDate
    // adalah tanggal sesi yang dimaksud, createdAt jaring pengamannya.
    date: sc.scheduledDate || sc.createdAt,
    userId,
    gapLabel: `Selisih stock opname ${sc.countNumber || ""}`.trim(),
  });
}
