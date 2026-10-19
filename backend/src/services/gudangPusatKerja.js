// PUSAT KERJA GUDANG (UX Tahap 4) — Beranda berbasis PEKERJAAN, Pusat Masalah ("Perlu perhatian"), dan pencarian lintas dokumen. SEMUA baca-saja: tidak membuat/mengubah dokumen, stok, jurnal, atau koreksi.
// Satu sumber hitungan untuk layar (tidak ada angka dikarang di browser). Definisi tiap antrean (tabel sumber, kondisi masuk/keluar, siapa yang boleh bertindak, satuan hitung) ada di DEFINISI di bawah dan ikut di respons.
//
// Prinsip kejujuran:
//  • "Terlambat" HANYA bila ada tanggal yang sah di data (jadwal penerimaan / estimasi PO / tanggal dibutuhkan / jadwal hitung) dan tanggal itu SUDAH LEWAT. Tanpa tanggal → tidak pernah disebut terlambat; hanya "umur" (sejak terakhir diubah).
//  • Umur = sejak dokumen TERAKHIR DIUBAH (updatedAt). Bukan SLA.
//  • Antrean = DOKUMEN (bukan baris item) kecuali dinyatakan "bahan". Satu dokumen muncul di satu antrean "perlu dikerjakan" (tahap sekarang), dan boleh juga di "tertahan" bila ada sebab nyata.
//  • Masalah yang hanya menyangkut satu bahan/dokumen tidak pernah dijadikan blocker seluruh proses (kolom `cakupan`).
//  • "Konflik revisi" TIDAK punya sumber data (terjadi saat dua orang mengubah bersamaan dan hanya tampil di dokumen) — sengaja tidak dihitung di antrean.
import { todayBookDateWIB } from "./finance/journal.js";
import { tampilanPenerimaan } from "./penerimaanStatus.js";
import { tampilanMaterialIssue, tampilanTransfer } from "./dokumenGudang.js";
import { tampilanOpname } from "./dokumenGudangLain.js";
import { selisihTerbukaDaftar, selisihTerbukaQty } from "./selisihTransfer.js";
import { computeStockSnapshot } from "./inventoryLedger.js";
import { stokLokasi } from "./stokLokasi.js";
import { hasPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

export const JENIS = Object.freeze({
  penerimaan: { label: "Penerimaan", daftar: "/warehouse/goods-receipt" },
  po: { label: "PO", daftar: "/warehouse/barang-akan-datang" },
  "pengeluaran-material": { label: "Pengeluaran Material", daftar: "/warehouse/material-issue" },
  transfer: { label: "Transfer", daftar: "/warehouse/transfers" },
  opname: { label: "Stock Opname", daftar: "/warehouse/stock-count" },
  restok: { label: "Restok", daftar: "/warehouse/replenishment" },
  rusak: { label: "Barang Rusak", daftar: "/warehouse/adjustments/damaged" },
  retur: { label: "Retur", daftar: "/warehouse/adjustments/returns" },
  penyesuaian: { label: "Penyesuaian Stok", daftar: "/warehouse/adjustments/stock" },
  koreksi: { label: "Koreksi Gudang", daftar: "/warehouse/adjustments/koreksi" },
  "retur-supplier": { label: "Retur Supplier", daftar: "/warehouse/retur-supplier" },
  bahan: { label: "Bahan", daftar: "/warehouse/inventory" },
});
const tautanFokus = (jenis, id) => `/warehouse/dashboard/${jenis}/${id}`;

export const PEMILIK = Object.freeze({ GUDANG: "Gudang", FINANCE: "Finance", PRODUKSI: "Produksi", OWNER: "Owner / penyetuju" });

/** Definisi tertulis tiap antrean — dikirim ke layar (tombol "Definisi"), bukan dikarang di browser. */
export const DEFINISI = Object.freeze({
  PENERIMAAN_AKAN_DATANG: { judul: "Dijadwalkan datang", tabel: "goods_receipts", masuk: "Status Draf atau Terjadwal (barang belum dicatat tiba).", keluar: "Barang dicatat tiba, atau penerimaan dibatalkan.", pemilik: "Gudang (izin tulis Inventory)", satuan: "dokumen", catatan: "Terlambat hanya bila jadwal penerimaan (atau estimasi PO bila jadwal kosong) sudah lewat." },
  PENERIMAAN_PERIKSA: { judul: "Barang tiba — perlu diperiksa", tabel: "goods_receipts + goods_receipt_lines", masuk: "Status Barang tiba atau Pemeriksaan (barang tercatat tiba, hasil belum lengkap untuk semua item).", keluar: "Hasil lengkap lalu dinyatakan Siap masuk stok.", pemilik: "Gudang", satuan: "dokumen", catatan: "Dokumen kosong lama (tanpa jumlah apa pun) tidak dihitung." },
  PENERIMAAN_SIAP_STOK: { judul: "Siap masuk stok", tabel: "goods_receipts", masuk: "Status Siap masuk stok.", keluar: "Simpan ke Stok (stok bertambah) atau dikembalikan ke Pemeriksaan.", pemilik: "Gudang; sesudahnya Finance mencatat faktur supplier.", satuan: "dokumen" },
  PERMINTAAN_BAHAN: { judul: "Permintaan bahan", tabel: "material_issues (production_plan_id kosong)", masuk: "Menunggu persetujuan, Disetujui, Siap diambil, atau Sudah diambil.", keluar: "Dikeluarkan atau dibatalkan.", pemilik: "Gudang (izin tulis Inventory)", satuan: "dokumen", catatan: "Antrean bahan Produksi V2 dihitung terpisah (PRODUKSI_*)." },
  TRANSFER: { judul: "Transfer stok", tabel: "stock_transfers", masuk: "Menunggu persetujuan, Disetujui, Sudah diambil, Dalam perjalanan, atau Selesai dengan selisih belum diselesaikan.", keluar: "Selesai tanpa selisih terbuka, atau dibatalkan.", pemilik: "Gudang", satuan: "dokumen" },
  STOCK_COUNT: { judul: "Stock Count", tabel: "stock_counts", masuk: "Terjadwal (mulai hitung), Sedang dihitung, atau Menunggu tinjauan.", keluar: "Selesai atau dibatalkan.", pemilik: "Gudang; selisih disetujui penyetuju yang bukan pembuat/penghitung.", satuan: "dokumen" },
  KOREKSI_PENYESUAIAN: { judul: "Koreksi & penyesuaian menunggu keputusan", tabel: "warehouse_corrections + stock_adjustment_requests", masuk: "Koreksi Menunggu persetujuan; penyesuaian Menunggu persetujuan atau Disetujui (belum diposting).", keluar: "Diterapkan, ditolak, atau dibatalkan.", pemilik: "Penyetuju (izin persetujuan Inventory — Owner/Finance); pemohon tidak boleh menyetujui sendiri.", satuan: "dokumen" },
  RESTOK_RUSAK_RETUR: { judul: "Restok, barang rusak, dan retur", tabel: "replenishment_requests + damaged_stock_records + return_records", masuk: "Restok Menunggu persetujuan/Disetujui; barang rusak Dilaporkan/Diperiksa; retur Dibuat/Diterima/Diperiksa.", keluar: "Selesai, ditolak, atau dibatalkan.", pemilik: "Gudang", satuan: "dokumen" },
  RETUR_SUPPLIER: { judul: "Retur Supplier", tabel: "supplier_returns", masuk: "Draf (barang belum keluar).", keluar: "Barang keluar dikonfirmasi atau dibatalkan.", pemilik: "Gudang (konfirmasi barang keluar); sesudahnya Finance (debit note).", satuan: "dokumen" },
  PRODUKSI_BAHAN: { judul: "Bahan Produksi menunggu diserahkan", tabel: "production plan + material issue V2 (hanya bila pembaca Produksi V2 aktif)", masuk: "Kebutuhan bahan berstatus Menunggu disiapkan atau Siap diambil.", keluar: "Sudah diserahkan.", pemilik: "Gudang; sesudahnya Produksi.", satuan: "rencana produksi (unit)" },
  PRODUKSI_UNIT_MASUK: { judul: "Unit dari Delivery menunggu diterima", tabel: "unit_custody_handoffs_v2 (INBOUND, OFFERED)", masuk: "Serah-terima ditawarkan.", keluar: "Diterima atau ditolak.", pemilik: "Gudang", satuan: "unit" },
  PRODUKSI_BARANG_JADI: { judul: "Barang jadi menunggu diterima", tabel: "unit_custody_handoffs_v2 (FINISHED_GOODS, OFFERED)", masuk: "Serah-terima barang jadi ditawarkan Produksi.", keluar: "Diterima (lokasi wajib) atau ditolak.", pemilik: "Gudang; sesudahnya Delivery.", satuan: "unit" },
  PRODUKSI_KEKURANGAN: { judul: "Kekurangan bahan dilaporkan Produksi", tabel: "production_material_shortages_v2 (OPEN)", masuk: "Laporan kekurangan terbuka.", keluar: "Diselesaikan Gudang.", pemilik: "Gudang", satuan: "laporan" },
  PRODUKSI_SISA_BAHAN: { judul: "Sisa bahan menunggu diterima", tabel: "pengembalian bahan V2 (PENDING)", masuk: "Pengembalian bahan dari Produksi tertunda.", keluar: "Diterima Gudang.", pemilik: "Gudang", satuan: "pengembalian" },
});
export const DEFINISI_TERTAHAN = Object.freeze({
  JADWAL_LEWAT: "Ada tanggal yang sah (jadwal penerimaan/estimasi PO, tanggal dibutuhkan permintaan bahan, jadwal hitung) dan tanggal itu sudah lewat. Dokumen tanpa tanggal tidak pernah disebut terlambat.",
  STOK_TIDAK_CUKUP: "Permintaan bahan/transfer yang sudah disetujui meminta jumlah lebih besar dari saldo fisik bahan itu; Konfirmasi keluar/Kirim akan ditolak sistem. Hanya menahan dokumen itu, bukan proses lain.",
  DATA_WAJIB: "Data yang diwajibkan tahap berikutnya belum lengkap (hasil pemeriksaan belum diisi untuk semua item, atau pemeriksaan sebelumnya dibatalkan sehingga hasil baru wajib).",
  MENUNGGU_WORKSPACE: "Tindakan berikutnya ada pada workspace/peran lain (penyetuju untuk koreksi/penyesuaian, Finance untuk retur supplier) — bukan Gudang.",
  PERLU_KOREKSI_RESMI: "Perubahan hanya boleh lewat jalur resmi (tinjau selisih hitungan, selesaikan selisih transfer, koreksi dokumen) — tidak bisa diubah langsung.",
});

const hariStr = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const selisihHari = (a, b) => Math.round((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86_400_000);
const umurHari = (t, sekarang) => (t ? Math.max(0, Math.floor((sekarang - new Date(t)) / 86_400_000)) : null);
const umurTeks = (h) => (h === null ? "—" : h === 0 ? "hari ini" : `${h} hari`);

/** Kemampuan pengguna untuk menentukan tombol yang boleh tampil (server menegakkan ulang di endpoint aksi). */
export function izinPengguna(user) {
  return { baca: hasPermission(user, P.INVENTORY_READ), tulis: hasPermission(user, P.INVENTORY_WRITE), setujui: hasPermission(user, P.INVENTORY_ADJUSTMENT_APPROVE) };
}
const aksiUtama = (daftar, izin, perlu = "tulis") => {
  const a = (daftar ?? []).find((x) => x.jenis === "maju");
  if (!a || !izin[perlu]) return null;
  return { kode: a.kode, label: a.label };
};

const SEL_GR = {
  id: true, receiptNumber: true, status: true, supplier: true, expectedDate: true, arrivedDate: true, arrivalRevision: true, purchaseOrderId: true, updatedAt: true, createdAt: true,
  createdBy: { select: { name: true } }, purchaseOrder: { select: { poNumber: true, expectedDate: true, status: true } },
  lines: { select: { id: true, receivedQty: true, acceptedQty: true, rejectedQty: true, companionQty: true, material: { select: { code: true, name: true } } } },
};

function item(o, sekarang) {
  const umur = umurHari(o.sejak, sekarang);
  return {
    kunci: `${o.jenis}:${o.id}${o.sub ? ":" + o.sub : ""}`, jenis: o.jenis, jenisLabel: JENIS[o.jenis]?.label ?? o.jenis, id: o.id, nomor: o.nomor, judul: o.judul ?? o.nomor, terkait: o.terkait ?? null,
    umurHari: umur, umurTeks: umurTeks(umur), status: o.status, alasan: o.alasan, aksi: o.aksi ?? null, pemilik: o.pemilik ?? "GUDANG", pemilikLabel: PEMILIK[o.pemilik ?? "GUDANG"], sesudahnya: o.sesudahnya ? PEMILIK[o.sesudahnya] : null,
    tautan: o.tautan ?? (o.id ? tautanFokus(o.jenis, o.id) : JENIS[o.jenis]?.daftar), tautanLangsung: o.tautanLangsung ?? null, tertahan: o.tertahan ?? null, jumlahItem: o.jumlahItem ?? null,
  };
}
const urut = (a, b) => (b.umurHari ?? -1) - (a.umurHari ?? -1) || String(a.nomor).localeCompare(String(b.nomor));

/**
 * @param antreanProduksi  hasil getWarehouseProductionQueue (atau null bila pembaca Produksi V2 mati) — disuntik pemanggil supaya layanan ini tidak bergantung pada alur Produksi.
 */
export async function pusatKerja(db, { user, hariIni = null, batas = 8, antreanProduksi = null, sekarang = new Date() } = {}) {
  const izin = izinPengguna(user);
  const today = hariIni ?? hariStr(todayBookDateWIB());
  const snapshot = await computeStockSnapshot(db);
  const saldo = new Map(snapshot.map((s) => [s.materialId, s]));

  const [grs, mis, sts, scs, korelasi, penyesuaian, restok, rusak, retur, returSup] = await Promise.all([
    db.goodsReceipt.findMany({ where: { status: { in: ["DRAFT", "SCHEDULED", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"] } }, select: SEL_GR, orderBy: { updatedAt: "asc" }, take: 2000 }),
    db.materialIssue.findMany({
      where: { status: { in: ["WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED"] }, productionPlanId: null },
      select: { id: true, issueNumber: true, status: true, department: true, requiredDate: true, productionPlanId: true, updatedAt: true, sourceType: true, unit: { select: { unitCode: true, order: { select: { orderNumber: true, status: true, customer: { select: { name: true } } } } } }, requestedBy: { select: { name: true } }, lines: { select: { materialId: true, requestedQty: true, material: { select: { code: true, name: true } } } } },
      orderBy: { updatedAt: "asc" }, take: 2000,
    }),
    db.stockTransfer.findMany({
      where: { OR: [{ status: { in: ["WAITING_APPROVAL", "APPROVED", "PICKED", "IN_TRANSIT"] } }, { status: "COMPLETED", updatedAt: { gte: new Date(sekarang.getTime() - 60 * 86_400_000) } }] },
      select: { id: true, transferNumber: true, status: true, updatedAt: true, lines: { select: { id: true, materialId: true, qtySent: true, qtyReceived: true, material: { select: { code: true, name: true } } } } }, orderBy: { updatedAt: "asc" }, take: 2000,
    }),
    db.stockCount.findMany({ where: { status: { in: ["SCHEDULED", "IN_PROGRESS", "WAITING_REVIEW"] } }, select: { id: true, countNumber: true, status: true, countType: true, scheduledDate: true, updatedAt: true }, orderBy: { updatedAt: "asc" }, take: 500 }),
    db.warehouseCorrection.findMany({ where: { status: "PENDING_APPROVAL" }, select: { id: true, correctionNumber: true, docNumber: true, requestedAt: true, requestedBy: { select: { name: true } }, requestedById: true }, orderBy: { requestedAt: "asc" }, take: 500 }),
    db.stockAdjustmentRequest.findMany({ where: { status: { in: ["WAITING_APPROVAL", "APPROVED"] } }, select: { id: true, adjustmentNumber: true, status: true, updatedAt: true, requestedById: true, material: { select: { code: true } } }, orderBy: { updatedAt: "asc" }, take: 500 }),
    db.replenishmentRequest.findMany({ where: { status: { in: ["WAITING_APPROVAL", "APPROVED"] } }, select: { id: true, requestNumber: true, status: true, updatedAt: true, material: { select: { code: true } } }, orderBy: { updatedAt: "asc" }, take: 500 }),
    db.damagedStockRecord.findMany({ where: { status: { in: ["REPORTED", "UNDER_INSPECTION"] } }, select: { id: true, recordNumber: true, status: true, updatedAt: true, material: { select: { code: true } } }, orderBy: { updatedAt: "asc" }, take: 500 }),
    db.returnRecord.findMany({ where: { status: { in: ["CREATED", "RECEIVED", "INSPECTION"] } }, select: { id: true, returnNumber: true, status: true, updatedAt: true, material: { select: { code: true } } }, orderBy: { updatedAt: "asc" }, take: 500 }),
    db.supplierReturn.findMany({ where: { status: { in: ["DRAFT", "KELUAR"] } }, select: { id: true, returnNumber: true, status: true, updatedAt: true, supplier: { select: { name: true } }, _count: { select: { debitNotes: true } } }, orderBy: { updatedAt: "asc" }, take: 500 }),
  ]);

  const antrean = new Map(); const tertahan = new Map();
  const tambah = (map, kode, it) => { if (!map.has(kode)) map.set(kode, []); map.get(kode).push(it); };
  const T = (sebab, teks) => ({ sebab, teks });

  // ── Penerimaan
  for (const g of grs) {
    const tp = tampilanPenerimaan(g); const nomorPO = g.purchaseOrder?.poNumber;
    const terkait = [nomorPO ? `PO ${nomorPO}` : "Tanpa PO", g.supplier ?? "supplier belum diisi"].join(" · ");
    const dasar = { jenis: "penerimaan", id: g.id, nomor: g.receiptNumber, terkait, sejak: g.updatedAt, status: tp.label, jumlahItem: g.lines.length };
    const aksi = aksiUtama(tp.aksi.filter((a) => !["UBAH_JADWAL", "ISI_PEMERIKSAAN"].includes(a.kode)).map((a) => (a.kode === "KEMBALI_DRAFT" ? { ...a, jenis: "ubah" } : a)), izin);
    if (g.status === "DRAFT" || g.status === "SCHEDULED") {
      if (penerimaanKosongLama(g)) continue;
      const jadwal = hariStr(g.expectedDate) ?? hariStr(g.purchaseOrder?.expectedDate);
      const lewat = jadwal && jadwal < today ? selisihHari(today, jadwal) : 0;
      const alasan = g.status === "DRAFT" ? "Draf belum dijadwalkan." : !jadwal ? "Terjadwal tanpa tanggal; barang belum dicatat tiba." : jadwal === today ? "Dijadwalkan datang hari ini." : jadwal > today ? `Dijadwalkan datang ${jadwal}.` : `Jadwal ${jadwal} sudah lewat ${lewat} hari dan barang belum dicatat tiba.`;
      const it = item({ ...dasar, alasan, aksi: g.status === "DRAFT" ? aksiUtama([{ kode: "JADWALKAN", label: "Jadwalkan kedatangan", jenis: "maju" }], izin) : aksiUtama([{ kode: g.purchaseOrderId ? "CATAT_TIBA" : "TANDAI_TIBA", label: "Catat barang tiba", jenis: "maju" }], izin), sesudahnya: "GUDANG" }, sekarang);
      tambah(antrean, "PENERIMAAN_AKAN_DATANG", it);
      if (lewat > 0) tambah(tertahan, "JADWAL_LEWAT", { ...it, tertahan: T("JADWAL_LEWAT", `Lewat jadwal ${lewat} hari (${jadwal}).`), cakupan: "DOKUMEN" });
    } else if (g.status === "ARRIVED" || g.status === "INSPECTION") {
      if (penerimaanKosongLama(g)) continue;
      const kurang = g.lines.filter((l) => l.acceptedQty == null || l.rejectedQty == null).length;
      const batalLama = await hasilDibatalkanMenunggu(db, g, kurang);
      const alasan = g.status === "ARRIVED" ? "Barang sudah tercatat tiba dan belum diperiksa." : kurang === 0 ? "Hasil pemeriksaan lengkap; tinggal dinyatakan Siap masuk stok." : `Pemeriksaan belum lengkap: ${kurang} dari ${g.lines.length} item belum punya hasil (baik dan ditolak).`;
      const it = item({ ...dasar, alasan: batalLama ? `${alasan} Pemeriksaan sebelumnya dibatalkan — hasil baru wajib.` : alasan, aksi: aksiUtama([{ kode: g.status === "ARRIVED" ? "MAJUKAN" : kurang === 0 ? "MAJUKAN" : "ISI_PEMERIKSAAN", label: g.status === "ARRIVED" ? "Periksa barang" : kurang === 0 ? "Nyatakan siap masuk stok" : "Lengkapi hasil pemeriksaan", jenis: "maju" }], izin), sesudahnya: "GUDANG" }, sekarang);
      tambah(antrean, "PENERIMAAN_PERIKSA", it);
      if (batalLama) tambah(tertahan, "DATA_WAJIB", { ...it, tertahan: T("DATA_WAJIB", "Pemeriksaan sebelumnya dibatalkan; hasil baru wajib diisi/dikonfirmasi sebelum Siap masuk stok."), cakupan: "DOKUMEN", masalah: "PEMERIKSAAN_DIBATALKAN" });
      else if (g.status === "INSPECTION" && kurang > 0) tambah(tertahan, "DATA_WAJIB", { ...it, tertahan: T("DATA_WAJIB", `${kurang} item belum punya hasil pemeriksaan.`), cakupan: "DOKUMEN" });
    } else if (g.status === "READY_FOR_PUTAWAY") {
      const adaBaik = g.lines.some((l) => Number(l.acceptedQty ?? 0) > 0);
      const it = item({ ...dasar, alasan: adaBaik ? "Hasil pemeriksaan lengkap; stok bertambah saat Simpan ke Stok." : "Siap masuk stok, tetapi tidak ada jumlah baik — Simpan ke Stok akan ditolak.", aksi: aksiUtama([{ kode: "SIMPAN_KE_STOK", label: "Simpan ke stok", jenis: "maju" }], izin), sesudahnya: g.purchaseOrderId ? "FINANCE" : "GUDANG" }, sekarang);
      tambah(antrean, "PENERIMAAN_SIAP_STOK", it);
      if (!adaBaik) tambah(tertahan, "DATA_WAJIB", { ...it, tertahan: T("DATA_WAJIB", "Tidak ada item dengan jumlah baik > 0."), cakupan: "DOKUMEN" });
    }
  }

  // ── Permintaan bahan (alur biasa)
  const AKSI_MI = { WAITING_APPROVAL: { kode: "SETUJUI", label: "Setujui permintaan" }, APPROVED: { kode: "SIAPKAN", label: "Siapkan barang" }, READY_TO_PICK: { kode: "TANDAI_DIAMBIL", label: "Serahkan / tandai diambil" }, PICKED: { kode: "KONFIRMASI_KELUAR", label: "Konfirmasi keluar" } };
  for (const m of mis) {
    const tp = tampilanMaterialIssue(m); const untuk = m.unit ? `${m.unit.unitCode} · ${m.unit.order?.customer?.name ?? ""}` : (m.department ?? "Gudang");
    const dibutuhkan = hariStr(m.requiredDate); const lewat = dibutuhkan && dibutuhkan < today ? selisihHari(today, dibutuhkan) : 0;
    const kurangBahan = ["APPROVED", "READY_TO_PICK", "PICKED"].includes(m.status) ? m.lines.filter((l) => (saldo.get(l.materialId)?.balance ?? 0) < Number(l.requestedQty)) : [];
    const alasan = ({ WAITING_APPROVAL: "Menunggu persetujuan.", APPROVED: "Disetujui; bahan perlu disiapkan.", READY_TO_PICK: "Bahan siap diambil; menunggu diserahkan.", PICKED: "Sudah diambil; stok baru berkurang saat Konfirmasi keluar." })[m.status] + (lewat > 0 ? ` Dibutuhkan ${dibutuhkan} (lewat ${lewat} hari).` : "");
    const it = item({ jenis: "pengeluaran-material", id: m.id, nomor: m.issueNumber, terkait: `${untuk} · ${m.lines.length} item`, sejak: m.updatedAt, status: tp.label, alasan, aksi: aksiUtama([{ ...AKSI_MI[m.status], jenis: "maju" }], izin), sesudahnya: m.sourceType === "PRODUCTION_WORK_ORDER" ? "PRODUKSI" : "GUDANG", jumlahItem: m.lines.length }, sekarang);
    tambah(antrean, "PERMINTAAN_BAHAN", it);
    if (lewat > 0) tambah(tertahan, "JADWAL_LEWAT", { ...it, tertahan: T("JADWAL_LEWAT", `Dibutuhkan ${dibutuhkan}, belum dikeluarkan (${lewat} hari).`), cakupan: "DOKUMEN" });
    if (kurangBahan.length) tambah(tertahan, "STOK_TIDAK_CUKUP", { ...it, tertahan: T("STOK_TIDAK_CUKUP", `Saldo kurang untuk ${kurangBahan.length} bahan: ${kurangBahan.slice(0, 3).map((l) => `${l.material.code} (butuh ${Number(l.requestedQty)}, saldo ${saldo.get(l.materialId)?.balance ?? 0})`).join("; ")}.`), cakupan: "BAHAN", bahan: kurangBahan.map((l) => l.material.code) });
    if (m.unit?.order?.status === "CANCELLED") tambah(tertahan, "PERLU_KOREKSI_RESMI", { ...it, tertahan: T("PERLU_KOREKSI_RESMI", `Order ${m.unit.order.orderNumber} dibatalkan; permintaan ini masih berjalan.`), cakupan: "DOKUMEN" });
  }

  // ── Transfer
  const selisih = await selisihTerbukaDaftar(db, sts.filter((s) => s.status === "COMPLETED").map((s) => ({ ...s })));
  const AKSI_ST = { WAITING_APPROVAL: { kode: "SETUJUI", label: "Setujui transfer" }, APPROVED: { kode: "TANDAI_DIAMBIL", label: "Tandai sudah diambil" }, PICKED: { kode: "KIRIM", label: "Kirim barang" }, IN_TRANSIT: { kode: "TERIMA", label: "Terima transfer" } };
  for (const t of sts) {
    const buka = t.status === "COMPLETED" ? Number(selisih?.get?.(t.id) ?? selisih?.[t.id] ?? 0) : 0;
    if (t.status === "COMPLETED" && !(buka > 0)) continue;
    const tp = tampilanTransfer(t, { selisihTerbuka: buka });
    const kurangBahan = ["APPROVED", "PICKED"].includes(t.status) ? t.lines.filter((l) => (saldo.get(l.materialId)?.balance ?? 0) < Number(l.qtySent)) : [];
    const alasan = t.status === "COMPLETED" ? `Selesai diterima dengan selisih ${buka} belum diselesaikan (ditemukan atau susut tercatat).` : ({ WAITING_APPROVAL: "Menunggu persetujuan.", APPROVED: "Disetujui; barang belum diambil.", PICKED: "Barang diambil; saldo berkurang saat dikirim.", IN_TRANSIT: "Dalam perjalanan; saldo sudah dikurangi sampai diterima." })[t.status];
    const it = item({ jenis: "transfer", id: t.id, nomor: t.transferNumber, terkait: `${t.lines.length} item`, sejak: t.updatedAt, status: tp.label, alasan, aksi: aksiUtama([t.status === "COMPLETED" ? { kode: "SELESAIKAN_SELISIH", label: "Selesaikan selisih", jenis: "maju" } : { ...AKSI_ST[t.status], jenis: "maju" }], izin), jumlahItem: t.lines.length }, sekarang);
    tambah(antrean, "TRANSFER", it);
    if (t.status === "COMPLETED") tambah(tertahan, "PERLU_KOREKSI_RESMI", { ...it, tertahan: T("PERLU_KOREKSI_RESMI", `Selisih ${buka} hanya dapat diselesaikan lewat Selesaikan selisih (tercatat, tanpa jurnal otomatis).`), cakupan: "DOKUMEN", masalah: "SELISIH_TRANSFER" });
    if (kurangBahan.length) tambah(tertahan, "STOK_TIDAK_CUKUP", { ...it, tertahan: T("STOK_TIDAK_CUKUP", `Saldo kurang untuk ${kurangBahan.length} bahan: ${kurangBahan.slice(0, 3).map((l) => l.material.code).join(", ")}.`), cakupan: "BAHAN", bahan: kurangBahan.map((l) => l.material.code) });
  }

  // ── Stock Count
  const AKSI_SC = { SCHEDULED: { kode: "MULAI_HITUNG", label: "Mulai hitung" }, IN_PROGRESS: { kode: "SERAHKAN_HITUNGAN", label: "Serahkan hitungan" }, WAITING_REVIEW: { kode: "SELESAIKAN_OPNAME", label: "Tinjau & selesaikan" } };
  for (const c of scs) {
    const tp = tampilanOpname(c, { adaSelisih: c.status === "WAITING_REVIEW", bisaMenyetujuiSelisih: izin.setujui });
    const jadwal = hariStr(c.scheduledDate); const lewat = c.status === "SCHEDULED" && jadwal && jadwal < today ? selisihHari(today, jadwal) : 0;
    const alasan = c.status === "SCHEDULED" ? (jadwal ? `Terjadwal ${jadwal}${lewat ? ` (lewat ${lewat} hari)` : ""}; belum dihitung.` : "Terjadwal tanpa tanggal; belum dihitung.") : c.status === "IN_PROGRESS" ? "Sedang dihitung; hasil belum diserahkan." : "Hitungan diserahkan; menunggu tinjauan selisih.";
    const butuhSetuju = c.status === "WAITING_REVIEW";
    const it = item({ jenis: "opname", id: c.id, nomor: c.countNumber, terkait: c.countType === "FULL_STOCK_OPNAME" ? "Opname penuh" : "Hitung siklus", sejak: c.updatedAt, status: tp.label, alasan, aksi: aksiUtama([{ ...AKSI_SC[c.status], jenis: "maju" }], izin, butuhSetuju ? "tulis" : "tulis") }, sekarang);
    tambah(antrean, "STOCK_COUNT", it);
    if (lewat > 0) tambah(tertahan, "JADWAL_LEWAT", { ...it, tertahan: T("JADWAL_LEWAT", `Jadwal hitung ${jadwal} sudah lewat ${lewat} hari.`), cakupan: "DOKUMEN" });
    if (butuhSetuju) tambah(tertahan, "PERLU_KOREKSI_RESMI", { ...it, tertahan: T("PERLU_KOREKSI_RESMI", "Selisih hitungan hanya diselesaikan lewat tinjauan resmi; penyetuju harus berbeda dari pembuat/penghitung."), cakupan: "DOKUMEN", masalah: "STOCK_COUNT_SELISIH" });
  }

  // ── Koreksi & penyesuaian (penyetuju)
  for (const k of korelasi) {
    const sendiri = k.requestedById && user?.id && k.requestedById === user.id;
    const it = item({ jenis: "koreksi", id: k.id, nomor: k.correctionNumber, terkait: `Koreksi ${k.docNumber} · diajukan ${k.requestedBy?.name ?? "—"}`, sejak: k.requestedAt, status: "Menunggu persetujuan", alasan: sendiri ? "Anda pemohon; keputusan harus dari penyetuju lain." : "Menunggu keputusan penyetuju (stok/jurnal baru berubah setelah disetujui).", aksi: izin.setujui && !sendiri ? { kode: "PUTUSKAN", label: "Putuskan koreksi" } : null, pemilik: "OWNER", sesudahnya: "GUDANG" }, sekarang);
    if (it.aksi) tambah(antrean, "KOREKSI_PENYESUAIAN", it);
    else tambah(tertahan, "MENUNGGU_WORKSPACE", { ...it, tertahan: T("MENUNGGU_WORKSPACE", "Menunggu penyetuju (Owner/Finance) — bukan tindakan Gudang."), cakupan: "DOKUMEN", masalah: "KOREKSI_MENUNGGU" });
  }
  for (const a of penyesuaian) {
    const sendiri = a.requestedById && user?.id && a.requestedById === user.id;
    const bisa = a.status === "APPROVED" ? izin.tulis : izin.setujui && !sendiri;
    const it = item({ jenis: "penyesuaian", id: a.id, nomor: a.adjustmentNumber, terkait: `Penyesuaian ${a.material?.code ?? ""}`, sejak: a.updatedAt, status: a.status === "APPROVED" ? "Disetujui, menunggu posting" : "Menunggu persetujuan", alasan: a.status === "APPROVED" ? "Disetujui; stok berubah saat diposting." : sendiri ? "Anda pemohon; keputusan harus dari penyetuju lain." : "Menunggu keputusan penyetuju.", aksi: bisa ? { kode: a.status === "APPROVED" ? "POSTING" : "SETUJUI", label: a.status === "APPROVED" ? "Posting penyesuaian" : "Putuskan penyesuaian" } : null, pemilik: a.status === "APPROVED" ? "GUDANG" : "OWNER" }, sekarang);
    if (it.aksi) tambah(antrean, "KOREKSI_PENYESUAIAN", it); else tambah(tertahan, "MENUNGGU_WORKSPACE", { ...it, tertahan: T("MENUNGGU_WORKSPACE", "Menunggu penyetuju (Owner/Finance)."), cakupan: "DOKUMEN" });
  }

  // ── Restok, rusak, retur
  for (const r of restok) tambah(antrean, "RESTOK_RUSAK_RETUR", item({ jenis: "restok", id: r.id, nomor: r.requestNumber, terkait: `Restok ${r.material?.code ?? ""}`, sejak: r.updatedAt, status: r.status === "APPROVED" ? "Disetujui — belum dipesan" : "Menunggu persetujuan", alasan: r.status === "APPROVED" ? "Disetujui; langkah berikutnya memesan ke pemasok lewat Finance." : "Menunggu persetujuan.", aksi: aksiUtama([{ kode: r.status === "APPROVED" ? "TANDAI_DIPESAN" : "SETUJUI", label: r.status === "APPROVED" ? "Tandai sudah dipesan" : "Setujui restok", jenis: "maju" }], izin), pemilik: r.status === "APPROVED" ? "FINANCE" : "GUDANG" }, sekarang));
  for (const d of rusak) tambah(antrean, "RESTOK_RUSAK_RETUR", item({ jenis: "rusak", id: d.id, nomor: d.recordNumber, terkait: `Barang rusak ${d.material?.code ?? ""}`, sejak: d.updatedAt, status: d.status === "REPORTED" ? "Dilaporkan" : "Sedang diperiksa", alasan: d.status === "REPORTED" ? "Laporan barang rusak belum diperiksa." : "Diperiksa; belum diputuskan penyelesaiannya.", aksi: aksiUtama([{ kode: d.status === "REPORTED" ? "PERIKSA" : "SELESAIKAN", label: d.status === "REPORTED" ? "Periksa barang rusak" : "Putuskan penyelesaian", jenis: "maju" }], izin) }, sekarang));
  for (const r of retur) tambah(antrean, "RESTOK_RUSAK_RETUR", item({ jenis: "retur", id: r.id, nomor: r.returnNumber, terkait: `Retur ${r.material?.code ?? ""}`, sejak: r.updatedAt, status: r.status === "CREATED" ? "Dibuat" : r.status === "RECEIVED" ? "Diterima" : "Sedang diperiksa", alasan: r.status === "CREATED" ? "Retur belum diterima." : r.status === "RECEIVED" ? "Retur diterima; belum diperiksa." : "Diperiksa; belum diputuskan penyelesaiannya.", aksi: aksiUtama([{ kode: r.status === "CREATED" ? "TERIMA" : r.status === "RECEIVED" ? "PERIKSA" : "SELESAIKAN", label: r.status === "CREATED" ? "Terima retur" : r.status === "RECEIVED" ? "Periksa retur" : "Putuskan penyelesaian", jenis: "maju" }], izin) }, sekarang));

  // ── Retur Supplier
  for (const s of returSup) {
    const menungguFinance = s.status === "KELUAR" && s._count.debitNotes === 0;
    const it = item({ jenis: "retur-supplier", id: s.id, nomor: s.returnNumber, terkait: s.supplier?.name ?? "—", sejak: s.updatedAt, status: s.status === "DRAFT" ? "Draf — barang belum keluar" : "Barang sudah keluar", alasan: s.status === "DRAFT" ? "Barang belum dikonfirmasi keluar." : menungguFinance ? "Barang sudah keluar; debit note belum dibuat Finance." : "Barang keluar; ada debit note.", aksi: s.status === "DRAFT" ? aksiUtama([{ kode: "KELUAR", label: "Konfirmasi barang keluar", jenis: "maju" }], izin) : null, pemilik: s.status === "DRAFT" ? "GUDANG" : "FINANCE", sesudahnya: s.status === "DRAFT" ? "FINANCE" : null }, sekarang);
    if (s.status === "DRAFT") tambah(antrean, "RETUR_SUPPLIER", it);
    else if (menungguFinance) tambah(tertahan, "MENUNGGU_WORKSPACE", { ...it, tertahan: T("MENUNGGU_WORKSPACE", "Menunggu Finance membuat debit note."), cakupan: "DOKUMEN" });
  }

  // ── Antrean Produksi V2 (disuntik; tautan ke halaman antrean masing-masing karena aksinya inline di sana)
  if (antreanProduksi) {
    const q = antreanProduksi; const kode = (j, a) => ({ jenis: j, id: null, ...a });
    for (const n of q.materialNeeds ?? []) if (["SIAP_DIAMBIL", "MENUNGGU_DISIAPKAN"].includes(n.status)) tambah(antrean, "PRODUKSI_BAHAN", item({ jenis: "bahan", id: n.planId, sub: "pb", nomor: n.unitCode, judul: n.unitCode, terkait: `${n.customerName ?? "—"} · ${n.stationLabel ?? ""} · ${n.productionDate ?? ""}`, sejak: null, status: n.status === "SIAP_DIAMBIL" ? "Siap diambil" : "Menunggu disiapkan", alasan: n.status === "SIAP_DIAMBIL" ? "Bahan siap; menunggu diserahkan ke Produksi." : "Kebutuhan bahan rencana produksi belum disiapkan.", aksi: izin.tulis ? { kode: "BUKA_ANTREAN", label: n.status === "SIAP_DIAMBIL" ? "Serahkan bahan" : "Siapkan bahan" } : null, sesudahnya: "PRODUKSI", tautan: "/warehouse/material-pickup" }, sekarang));
    for (const h of q.inbound ?? []) tambah(antrean, "PRODUKSI_UNIT_MASUK", item({ jenis: "bahan", id: h.handoffId, sub: "um", nomor: h.unitCode, terkait: h.customerName ?? "—", sejak: h.offeredAt, status: "Ditawarkan", alasan: "Unit dari Delivery menunggu diterima Gudang.", aksi: izin.tulis ? { kode: "BUKA_ANTREAN", label: "Terima unit" } : null, tautan: "/warehouse/unit-custody" }, sekarang));
    for (const h of q.finishedGoods ?? []) tambah(antrean, "PRODUKSI_BARANG_JADI", item({ jenis: "bahan", id: h.handoffId, sub: "bj", nomor: h.unitCode, terkait: h.customerName ?? "—", sejak: h.offeredAt, status: "Ditawarkan", alasan: "Barang jadi menunggu diterima Gudang (lokasi wajib).", aksi: izin.tulis ? { kode: "BUKA_ANTREAN", label: "Terima barang jadi" } : null, sesudahnya: "GUDANG", tautan: "/warehouse/finished-goods" }, sekarang));
    for (const s of q.shortages ?? []) tambah(antrean, "PRODUKSI_KEKURANGAN", item({ jenis: "bahan", id: s.id, sub: "kk", nomor: s.unitCode, terkait: `${s.customerName ?? "—"} · ${s.stationLabel ?? ""}`, sejak: s.reportedAt, status: "Dilaporkan", alasan: "Produksi melaporkan kekurangan bahan.", aksi: izin.tulis ? { kode: "BUKA_ANTREAN", label: "Tangani kekurangan" } : null, tautan: "/warehouse/antrean-produksi" }, sekarang));
    for (const r of q.returns ?? []) tambah(antrean, "PRODUKSI_SISA_BAHAN", item({ jenis: "bahan", id: r.id ?? r.returnId, sub: "sb", nomor: r.unitCode ?? r.issueNumber ?? "Sisa bahan", terkait: r.customerName ?? "—", sejak: r.requestedAt ?? r.createdAt ?? null, status: "Menunggu diterima", alasan: "Sisa bahan dari Produksi menunggu diterima.", aksi: izin.tulis ? { kode: "BUKA_ANTREAN", label: "Terima sisa bahan" } : null, tautan: "/warehouse/antrean-produksi" }, sekarang));
    void kode;
  }

  const ringkas = (kode, daftar, meta) => { const d = [...daftar].sort(urut); return { kode, judul: meta.judul, definisi: meta, jumlah: d.length, satuanHitung: meta.satuan, item: d.slice(0, batas), lebih: Math.max(0, d.length - batas), tautanDaftar: null }; };
  const urutanAntrean = ["PENERIMAAN_AKAN_DATANG", "PENERIMAAN_PERIKSA", "PENERIMAAN_SIAP_STOK", "PERMINTAAN_BAHAN", "TRANSFER", "STOCK_COUNT", "KOREKSI_PENYESUAIAN", "RESTOK_RUSAK_RETUR", "RETUR_SUPPLIER", "PRODUKSI_BAHAN", "PRODUKSI_UNIT_MASUK", "PRODUKSI_BARANG_JADI", "PRODUKSI_KEKURANGAN", "PRODUKSI_SISA_BAHAN"];
  const antreanOut = urutanAntrean.filter((k) => DEFINISI[k] && (antrean.has(k) || !k.startsWith("PRODUKSI_"))).map((k) => ringkas(k, antrean.get(k) ?? [], DEFINISI[k]));
  const sebab = Object.keys(DEFINISI_TERTAHAN).map((k) => { const d = (tertahan.get(k) ?? []).sort(urut); const unik = new Set(d.map((x) => x.kunci)).size; return { kode: k, judul: { JADWAL_LEWAT: "Melewati jadwal", STOK_TIDAK_CUKUP: "Stok tidak cukup", DATA_WAJIB: "Data wajib belum lengkap", MENUNGGU_WORKSPACE: "Menunggu workspace lain", PERLU_KOREKSI_RESMI: "Perlu keputusan/koreksi resmi" }[k], definisi: DEFINISI_TERTAHAN[k], jumlah: unik, item: d.slice(0, batas), lebih: Math.max(0, d.length - batas) }; });
  const selesaiTerbaru = await selesai(db, { sekarang });
  return {
    hariIni: today, dihitungPada: sekarang.toISOString(), izin, batasPerAntrean: batas, umurDefinisi: "Umur = sejak dokumen terakhir diubah (bukan SLA).",
    ringkasan: { perluDikerjakan: antreanOut.reduce((n, a) => n + a.jumlah, 0), tertahan: new Set([...tertahan.values()].flat().map((x) => x.kunci)).size, produksiV2: antreanProduksi ? "AKTIF" : "TIDAK_AKTIF" },
    antrean: antreanOut, tertahan: sebab, selesaiTerbaru,
    tidakDihitung: [{ kode: "KONFLIK_REVISI", alasan: "Terjadi saat dua orang mengubah dokumen yang sama dan hanya tampil di dokumen; tidak ada data tersimpan untuk dihitung." }],
  };
}

function penerimaanKosongLama(g) {
  if (["DRAFT", "SCHEDULED"].includes(g.status) || Number(g.arrivalRevision ?? 0) > 0 || g.arrivedDate) return false;
  return g.lines.length > 0 && g.lines.every((l) => [l.receivedQty, l.acceptedQty, l.rejectedQty, l.companionQty].every((v) => v === null || v === undefined || Number(v) === 0));
}
async function hasilDibatalkanMenunggu(db, g, kurang) {
  if (kurang === 0) return false;
  const ev = await db.activityEvent.findFirst({ where: { entityType: ENTITY_TYPES.GOODS_RECEIPT, entityId: g.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, metadata: { path: ["aksi"], equals: "KEMBALI_KE_TIBA" } }, orderBy: { createdAt: "desc" }, select: { metadata: true } });
  return !!ev?.metadata?.hasilDibatalkan?.baris?.length;
}

/** Pekerjaan yang baru selesai (umpan balik): 7 hari terakhir, paling banyak 15, dari dokumen berstatus final. */
export async function selesai(db, { sekarang = new Date(), hari = 7, batas = 15 } = {}) {
  const sejak = new Date(sekarang.getTime() - hari * 86_400_000);
  const [gr, mi, st, sc, kor, adj] = await Promise.all([
    db.goodsReceipt.findMany({ where: { status: "COMPLETED", updatedAt: { gte: sejak } }, select: { id: true, receiptNumber: true, supplier: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 30 }),
    db.materialIssue.findMany({ where: { status: "ISSUED", issuedAt: { gte: sejak } }, select: { id: true, issueNumber: true, department: true, issuedAt: true, issuedBy: { select: { name: true } } }, orderBy: { issuedAt: "desc" }, take: 30 }),
    db.stockTransfer.findMany({ where: { status: "COMPLETED", updatedAt: { gte: sejak } }, select: { id: true, transferNumber: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 30 }),
    db.stockCount.findMany({ where: { status: "COMPLETED", completedAt: { gte: sejak } }, select: { id: true, countNumber: true, completedAt: true }, orderBy: { completedAt: "desc" }, take: 30 }),
    db.warehouseCorrection.findMany({ where: { status: "POSTED", decidedAt: { gte: sejak } }, select: { id: true, correctionNumber: true, docNumber: true, decidedAt: true }, orderBy: { decidedAt: "desc" }, take: 30 }),
    db.stockAdjustmentRequest.findMany({ where: { status: "POSTED", postedAt: { gte: sejak } }, select: { id: true, adjustmentNumber: true, postedAt: true, material: { select: { code: true } } }, orderBy: { postedAt: "desc" }, take: 30 }),
  ]);
  const baris = [
    ...gr.map((x) => ({ jenis: "penerimaan", id: x.id, nomor: x.receiptNumber, teks: `Masuk stok · ${x.supplier ?? "—"}`, waktu: x.updatedAt, entity: ENTITY_TYPES.GOODS_RECEIPT })),
    ...mi.map((x) => ({ jenis: "pengeluaran-material", id: x.id, nomor: x.issueNumber, teks: `Dikeluarkan · ${x.department ?? "—"}`, waktu: x.issuedAt, oleh: x.issuedBy?.name ?? null })),
    ...st.map((x) => ({ jenis: "transfer", id: x.id, nomor: x.transferNumber, teks: "Transfer selesai diterima", waktu: x.updatedAt })),
    ...sc.map((x) => ({ jenis: "opname", id: x.id, nomor: x.countNumber, teks: "Hitungan stok selesai", waktu: x.completedAt })),
    ...kor.map((x) => ({ jenis: "koreksi", id: x.id, nomor: x.correctionNumber, teks: `Koreksi ${x.docNumber} diterapkan`, waktu: x.decidedAt })),
    ...adj.map((x) => ({ jenis: "penyesuaian", id: x.id, nomor: x.adjustmentNumber, teks: `Penyesuaian ${x.material?.code ?? ""} diposting`, waktu: x.postedAt })),
  ].sort((a, b) => new Date(b.waktu) - new Date(a.waktu)).slice(0, batas);
  const grIds = baris.filter((b) => b.entity).map((b) => b.id);
  if (grIds.length) {
    const ev = await db.activityEvent.findMany({ where: { entityType: ENTITY_TYPES.GOODS_RECEIPT, entityId: { in: grIds }, eventType: EVENT_TYPES.DOCUMENT_POSTED }, select: { entityId: true, actorId: true } });
    const pel = new Map((await db.user.findMany({ where: { id: { in: [...new Set(ev.map((e) => e.actorId).filter(Boolean))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const per = new Map(ev.map((e) => [e.entityId, pel.get(e.actorId) ?? null]));
    for (const b of baris) if (b.entity) b.oleh = per.get(b.id) ?? null;
  }
  return baris.map((b) => ({ kunci: `${b.jenis}:${b.id}`, jenis: b.jenis, jenisLabel: JENIS[b.jenis]?.label, id: b.id, nomor: b.nomor, teks: b.teks, waktu: b.waktu, oleh: b.oleh ?? null, tautan: tautanFokus(b.jenis, b.id) }));
}

/** Pusat Masalah — pengecualian nyata beserta dampak, pemilik, tindakan resmi, dan CAKUPAN (satu bahan / satu dokumen / satu fitur / seluruh proses). Tidak ada blocker global kecuali benar-benar seluruh proses. */
export async function perluPerhatian(db, { user, sekarang = new Date(), batas = 8, pusat = null } = {}) {
  const izin = izinPengguna(user);
  const stok = await stokLokasi(db);
  const rows = stok.rows.filter((r) => r.aktif);
  const bahan = (arr, n = batas) => arr.slice(0, n).map((r) => ({ jenis: "bahan", id: r.materialId, nomor: r.kode, judul: r.nama, teks: `${r.kode} — ${r.nama}`, tautan: `/warehouse/inventory?q=${encodeURIComponent(r.kode)}` }));
  const minus = rows.filter((r) => r.keadaan === "MINUS"); const belumTahu = rows.filter((r) => r.keadaan === "BELUM_ADA_CATATAN"); const belumKel = rows.filter((r) => r.kelompok?.kode === "BELUM"); const tanpaMin = rows.filter((r) => r.batasMinimum === null);
  const k = pusat ?? (await pusatKerja(db, { user, sekarang, batas: 50 }));
  const dari = (kodeSebab, masalah) => (k.tertahan.find((s) => s.kode === kodeSebab)?.item ?? []).filter((x) => !masalah || x.masalah === masalah);
  const dok = (arr) => arr.slice(0, batas).map((x) => ({ jenis: x.jenis, id: x.id, nomor: x.nomor, judul: x.nomor, teks: `${x.nomor} — ${x.tertahan?.teks ?? x.alasan}`, tautan: x.tautan }));
  const m = [];
  const tambah = (o) => { if (o.jumlah > 0) m.push({ ...o, pemilikLabel: PEMILIK[o.pemilik], contoh: o.contoh ?? [] }); };
  tambah({ kode: "STOK_NEGATIF", judul: "Stok negatif", apa: `${minus.length} bahan bersaldo minus menurut catatan.`, dampak: "Konfirmasi keluar/Kirim yang mengurangi bahan itu ditolak sistem; catatan perlu dihitung fisik.", cakupan: "BAHAN", cakupanTeks: "Hanya bahan yang bersangkutan — bahan lain tetap berjalan.", pemilik: "GUDANG", tindakan: [{ label: "Hitung fisik (Stock Count) lalu selesaikan selisih", tautan: "/warehouse/stock-count" }, { label: "Ajukan Penyesuaian Stok", tautan: "/warehouse/adjustments/stock" }], jumlah: minus.length, satuan: "bahan", contoh: bahan(minus), tautanDaftar: "/warehouse/inventory?keadaan=MINUS", memblokir: "Satu bahan" });
  tambah({ kode: "SALDO_BELUM_DIKETAHUI", judul: "Saldo belum diketahui", apa: `${belumTahu.length} bahan aktif belum punya catatan pergerakan stok.`, dampak: "Bukan berarti habis. Saldo dan ketersediaannya tidak bisa dipakai untuk memutuskan.", cakupan: "BAHAN", cakupanTeks: "Hanya bahan yang bersangkutan.", pemilik: "GUDANG", tindakan: [{ label: "Catat saldo awal lewat Stock Count / Opname Cutover", tautan: "/warehouse/stock-count" }], jumlah: belumTahu.length, satuan: "bahan", contoh: bahan(belumTahu), tautanDaftar: "/warehouse/inventory?keadaan=BELUM_ADA_CATATAN", memblokir: "Tidak memblokir proses; hanya mengurangi kepastian angka" });
  tambah({ kode: "BELUM_DIKELOMPOKKAN", judul: "Bahan belum dikelompokkan", apa: `${belumKel.length} bahan aktif belum punya kelompok (itemGroup kosong atau campuran).`, dampak: "Tampil di kartu 'Belum dikelompokkan' di Stok & Lokasi; pencarian tetap menemukannya.", cakupan: "BAHAN", cakupanTeks: "Hanya tampilan pengelompokan; tidak memengaruhi stok.", pemilik: "OWNER", tindakan: [{ label: "Isi daftar keputusan kelompok (docs/gudang-kelompok-bahan-keputusan.csv)", tautan: "/warehouse/inventory?kelompok=BELUM" }], jumlah: belumKel.length, satuan: "bahan", contoh: bahan(belumKel), tautanDaftar: "/warehouse/inventory?kelompok=BELUM", memblokir: "Tidak ada" });
  tambah({ kode: "BATAS_MINIMUM_BELUM_DIATUR", judul: "Batas minimum belum diatur", apa: `${tanpaMin.length} dari ${rows.length} bahan aktif belum punya batas minimum.`, dampak: "Sistem tidak bisa menyatakan bahan mana yang perlu dipesan ulang (Restok tidak punya dasar saran).", cakupan: "FITUR", cakupanTeks: "Hanya fitur saran restok; semua dokumen tetap berjalan.", pemilik: "GUDANG", tindakan: [{ label: "Isi batas minimum lewat Ubah Item di Stok & Lokasi", tautan: "/warehouse/inventory" }], jumlah: tanpaMin.length, satuan: "bahan", contoh: bahan(tanpaMin, 5), tautanDaftar: "/warehouse/inventory", memblokir: "Tidak ada" });
  tambah({ kode: "PENERIMAAN_TERTAHAN", judul: "Penerimaan tertahan", apa: "Penerimaan melewati jadwal, atau data wajib tahap berikutnya belum lengkap.", dampak: "Stok belum bertambah untuk barang itu; PO terkait belum tergenapi.", cakupan: "DOKUMEN", cakupanTeks: "Hanya dokumen yang bersangkutan.", pemilik: "GUDANG", tindakan: [{ label: "Buka dokumen dan lengkapi / catat tiba", tautan: "/warehouse/goods-receipt" }], jumlah: new Set([...dari("JADWAL_LEWAT"), ...dari("DATA_WAJIB")].filter((x) => x.jenis === "penerimaan").map((x) => x.id)).size, satuan: "dokumen", contoh: dok([...dari("JADWAL_LEWAT"), ...dari("DATA_WAJIB")].filter((x) => x.jenis === "penerimaan")), tautanDaftar: "/warehouse/goods-receipt", memblokir: "Satu dokumen" });
  const pd = dari("DATA_WAJIB", "PEMERIKSAAN_DIBATALKAN"); tambah({ kode: "PEMERIKSAAN_DIBATALKAN", judul: "Pemeriksaan dibatalkan", apa: `${pd.length} penerimaan punya pemeriksaan yang dibatalkan dan belum diisi ulang.`, dampak: "Hasil lama tidak berlaku (diarsipkan); tidak bisa Siap masuk stok sebelum hasil baru diisi.", cakupan: "DOKUMEN", cakupanTeks: "Hanya dokumen yang bersangkutan.", pemilik: "GUDANG", tindakan: [{ label: "Isi atau konfirmasi hasil pemeriksaan baru", tautan: "/warehouse/goods-receipt" }], jumlah: pd.length, satuan: "dokumen", contoh: dok(pd), tautanDaftar: "/warehouse/goods-receipt", memblokir: "Satu dokumen" });
  const sel = dari("PERLU_KOREKSI_RESMI", "SELISIH_TRANSFER"); tambah({ kode: "SELISIH_TRANSFER", judul: "Selisih transfer belum diselesaikan", apa: `${sel.length} transfer selesai dengan kekurangan yang belum diselesaikan.`, dampak: "Kekurangan sudah hilang dari saldo; tanpa penyelesaian tidak ada catatan apakah ditemukan atau susut. Pencatatan Finance untuk susut belum ada.", cakupan: "DOKUMEN", cakupanTeks: "Hanya transfer yang bersangkutan.", pemilik: "GUDANG", tindakan: [{ label: "Selesaikan selisih (ditemukan / susut tercatat)", tautan: "/warehouse/transfers" }], jumlah: sel.length, satuan: "dokumen", contoh: dok(sel), tautanDaftar: "/warehouse/transfers", memblokir: "Satu dokumen" });
  const sc = dari("PERLU_KOREKSI_RESMI", "STOCK_COUNT_SELISIH"); tambah({ kode: "STOCK_COUNT_SELISIH", judul: "Stock Count menunggu tinjauan selisih", apa: `${sc.length} hitungan menunggu tinjauan.`, dampak: "Saldo belum disesuaikan dengan hasil hitung; selisih tinggal di catatan.", cakupan: "DOKUMEN", cakupanTeks: "Hanya hitungan yang bersangkutan.", pemilik: "OWNER", tindakan: [{ label: "Tinjau dan selesaikan (penyetuju ≠ pembuat/penghitung)", tautan: "/warehouse/stock-count" }], jumlah: sc.length, satuan: "dokumen", contoh: dok(sc), tautanDaftar: "/warehouse/stock-count", memblokir: "Satu dokumen" });
  const kr = (k.tertahan.find((s) => s.kode === "MENUNGGU_WORKSPACE")?.item ?? []).filter((x) => x.jenis === "koreksi" || x.jenis === "penyesuaian").concat((k.antrean.find((a) => a.kode === "KOREKSI_PENYESUAIAN")?.item ?? [])); tambah({ kode: "KOREKSI_MENUNGGU", judul: "Koreksi / penyesuaian menunggu persetujuan", apa: `${kr.length} koreksi atau penyesuaian menunggu keputusan penyetuju.`, dampak: "Dokumen sumber tidak diubah; stok/jurnal baru berubah setelah disetujui.", cakupan: "DOKUMEN", cakupanTeks: "Hanya dokumen yang dikoreksi.", pemilik: "OWNER", tindakan: [{ label: "Putuskan koreksi (penyetuju)", tautan: "/warehouse/adjustments/koreksi" }], jumlah: kr.length, satuan: "dokumen", contoh: dok(kr), tautanDaftar: "/warehouse/adjustments/koreksi", memblokir: "Satu dokumen" });
  const ob = (k.tertahan.find((s) => s.kode === "PERLU_KOREKSI_RESMI")?.item ?? []).filter((x) => x.jenis === "pengeluaran-material"); tambah({ kode: "BAHAN_ORDER_BATAL", judul: "Permintaan bahan untuk order yang dibatalkan", apa: `${ob.length} permintaan bahan masih berjalan untuk order yang sudah dibatalkan.`, dampak: "Bahan bisa keluar dari stok untuk order yang tidak jadi; yang sudah dikeluarkan perlu dikembalikan lewat jalur resmi.", cakupan: "DOKUMEN", cakupanTeks: "Hanya permintaan yang bersangkutan.", pemilik: "GUDANG", tindakan: [{ label: "Batalkan permintaan / kembalikan bahan lewat jalur resmi", tautan: "/warehouse/material-issue" }], jumlah: ob.length, satuan: "dokumen", contoh: dok(ob), tautanDaftar: "/warehouse/material-issue", memblokir: "Satu dokumen" });
  const mf = (k.tertahan.find((s) => s.kode === "MENUNGGU_WORKSPACE")?.item ?? []).filter((x) => x.jenis === "retur-supplier"); tambah({ kode: "MENUNGGU_FINANCE", judul: "Menunggu tindakan Finance", apa: `${mf.length} retur supplier menunggu Finance membuat debit note.`, dampak: "Barang sudah keluar dari stok; kredit supplier belum tercatat.", cakupan: "DOKUMEN", cakupanTeks: "Hanya retur yang bersangkutan.", pemilik: "FINANCE", tindakan: [{ label: "Pantau status di Retur Supplier", tautan: "/warehouse/retur-supplier" }], jumlah: mf.length, satuan: "dokumen", contoh: dok(mf), tautanDaftar: "/warehouse/retur-supplier", memblokir: "Satu dokumen" });
  const sk = (k.tertahan.find((s) => s.kode === "STOK_TIDAK_CUKUP")?.item ?? []); tambah({ kode: "STOK_TIDAK_CUKUP", judul: "Dokumen tertahan karena stok tidak cukup", apa: `${sk.length} permintaan/transfer meminta lebih dari saldo fisik.`, dampak: "Konfirmasi keluar/Kirim ditolak sistem sampai saldo cukup atau jumlah dikurangi.", cakupan: "DOKUMEN", cakupanTeks: "Hanya dokumen itu dan bahan yang kurang.", pemilik: "GUDANG", tindakan: [{ label: "Terima barang / kurangi jumlah / ajukan restok", tautan: "/warehouse/replenishment" }], jumlah: sk.length, satuan: "dokumen", contoh: dok(sk), tautanDaftar: "/warehouse/material-issue", memblokir: "Satu dokumen" });
  const urutCakupan = { PROSES: 0, DOKUMEN: 1, BAHAN: 2, FITUR: 3 };
  m.sort((a, b) => (urutCakupan[a.cakupan] ?? 9) - (urutCakupan[b.cakupan] ?? 9));
  return { dihitungPada: sekarang.toISOString(), izin, masalah: m, tidakAda: m.length === 0, catatan: "Tidak ada masalah yang memblokir SELURUH proses Gudang; setiap masalah dibatasi pada bahan, dokumen, atau fitur yang disebut pada kolom cakupan.", definisiCakupan: { BAHAN: "Menyangkut satu/beberapa bahan tertentu", DOKUMEN: "Menyangkut satu dokumen tertentu", FITUR: "Menyangkut satu fitur (mis. saran restok)", PROSES: "Menyangkut seluruh proses (tidak ada saat ini)" } };
}

/** Pencarian lintas dokumen Gudang (baca-saja). Minimal 2 karakter; hasil dikelompokkan per jenis, paling banyak `batas` per jenis. */
export async function cariGudang(db, { q, batas = 6 }) {
  const kata = String(q ?? "").trim(); if (kata.length < 2) return { q: kata, kelompok: [], total: 0, pesan: "Ketik minimal 2 karakter." };
  const c = { contains: kata, mode: "insensitive" };
  const [gr, po, mat, mi, st, sc, kor, adj, rsp, rus, rtr, rep] = await Promise.all([
    db.goodsReceipt.findMany({ where: { OR: [{ receiptNumber: c }, { supplier: c }, { sourceReference: c }, { purchaseOrder: { poNumber: c } }, { lines: { some: { material: { OR: [{ code: c }, { name: c }] } } } }] }, select: { id: true, receiptNumber: true, status: true, supplier: true, purchaseOrder: { select: { poNumber: true } }, purchaseOrderId: true, arrivalRevision: true, arrivedDate: true, lines: { select: { acceptedQty: true, rejectedQty: true, receivedQty: true, companionQty: true } }, createdAt: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: batas }),
    db.finPurchaseOrder.findMany({ where: { OR: [{ poNumber: c }, { supplier: { name: c } }] }, select: { id: true, poNumber: true, status: true, supplier: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: batas }),
    db.material.findMany({ where: { OR: [{ code: c }, { name: c }, { vendor: c }] }, select: { id: true, code: true, name: true, active: true }, orderBy: { name: "asc" }, take: batas }),
    db.materialIssue.findMany({ where: { OR: [{ issueNumber: c }, { department: c }, { sourceReference: c }, { unit: { unitCode: c } }, { unit: { order: { orderNumber: c } } }, { unit: { order: { customer: { name: c } } } }, { lines: { some: { material: { OR: [{ code: c }, { name: c }] } } } }] }, select: { id: true, issueNumber: true, status: true, department: true, productionPlanId: true, unit: { select: { unitCode: true } } }, orderBy: { updatedAt: "desc" }, take: batas }),
    db.stockTransfer.findMany({ where: { OR: [{ transferNumber: c }, { lines: { some: { material: { OR: [{ code: c }, { name: c }] } } } }] }, select: { id: true, transferNumber: true, status: true }, orderBy: { updatedAt: "desc" }, take: batas }),
    db.stockCount.findMany({ where: { OR: [{ countNumber: c }] }, select: { id: true, countNumber: true, status: true, countType: true }, orderBy: { updatedAt: "desc" }, take: batas }),
    db.warehouseCorrection.findMany({ where: { OR: [{ correctionNumber: c }, { docNumber: c }] }, select: { id: true, correctionNumber: true, docNumber: true, status: true }, orderBy: { requestedAt: "desc" }, take: batas }),
    db.stockAdjustmentRequest.findMany({ where: { OR: [{ adjustmentNumber: c }, { material: { OR: [{ code: c }, { name: c }] } }] }, select: { id: true, adjustmentNumber: true, status: true, material: { select: { code: true } } }, orderBy: { updatedAt: "desc" }, take: batas }),
    db.supplierReturn.findMany({ where: { OR: [{ returnNumber: c }, { supplier: { name: c } }] }, select: { id: true, returnNumber: true, status: true, supplier: { select: { name: true } } }, orderBy: { updatedAt: "desc" }, take: batas }),
    db.damagedStockRecord.findMany({ where: { OR: [{ recordNumber: c }, { material: { OR: [{ code: c }, { name: c }] } }] }, select: { id: true, recordNumber: true, status: true, material: { select: { code: true } } }, take: batas }),
    db.returnRecord.findMany({ where: { OR: [{ returnNumber: c }, { material: { OR: [{ code: c }, { name: c }] } }] }, select: { id: true, returnNumber: true, status: true, material: { select: { code: true } } }, take: batas }),
    db.replenishmentRequest.findMany({ where: { OR: [{ requestNumber: c }, { material: { OR: [{ code: c }, { name: c }] } }] }, select: { id: true, requestNumber: true, status: true, material: { select: { code: true } } }, take: batas }),
  ]);
  const kel = [];
  const dorong = (jenis, arr, f) => { if (arr.length) kel.push({ jenis, label: JENIS[jenis].label, hasil: arr.map((x) => { const r = f(x); return { jenis, id: x.id, nomor: r.nomor, judul: r.judul ?? r.nomor, sub: r.sub ?? null, status: r.status ?? null, tautan: jenis === "bahan" ? `/warehouse/inventory?q=${encodeURIComponent(r.nomor)}` : tautanFokus(jenis, x.id) }; }) }); };
  dorong("penerimaan", gr, (g) => ({ nomor: g.receiptNumber, sub: `${g.purchaseOrder?.poNumber ? `PO ${g.purchaseOrder.poNumber}` : "Tanpa PO"} · ${g.supplier ?? "—"}`, status: tampilanPenerimaan(g).label }));
  dorong("po", po, (p) => ({ nomor: p.poNumber, sub: p.supplier?.name, status: p.status }));
  dorong("bahan", mat, (m) => ({ nomor: m.code, judul: m.name, sub: m.active ? null : "nonaktif" }));
  dorong("pengeluaran-material", mi, (m) => ({ nomor: m.issueNumber, sub: m.unit?.unitCode ?? m.department, status: tampilanMaterialIssue(m).label }));
  dorong("transfer", st, (t) => ({ nomor: t.transferNumber, status: tampilanTransfer(t).label }));
  dorong("opname", sc, (s) => ({ nomor: s.countNumber, status: tampilanOpname(s, {}).label }));
  dorong("koreksi", kor, (k) => ({ nomor: k.correctionNumber, sub: `Koreksi ${k.docNumber}`, status: k.status }));
  dorong("penyesuaian", adj, (a) => ({ nomor: a.adjustmentNumber, sub: a.material?.code, status: a.status }));
  dorong("retur-supplier", rsp, (r) => ({ nomor: r.returnNumber, sub: r.supplier?.name, status: r.status }));
  dorong("rusak", rus, (r) => ({ nomor: r.recordNumber, sub: r.material?.code, status: r.status }));
  dorong("retur", rtr, (r) => ({ nomor: r.returnNumber, sub: r.material?.code, status: r.status }));
  dorong("restok", rep, (r) => ({ nomor: r.requestNumber, sub: r.material?.code, status: r.status }));
  return { q: kata, kelompok: kel, total: kel.reduce((n, g) => n + g.hasil.length, 0) };
}
