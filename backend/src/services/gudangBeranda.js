// BERANDA GUDANG — "yang perlu dikerjakan hari ini" (Okt 2026). SATU endpoint baca-saja; angka & daftar dihitung server dari dokumen NYATA (tidak ada angka contoh).
// Setiap ringkasan membawa tautan ke daftar yang relevan dan beberapa contoh dengan identitas jelas (nomor PO, nomor penerimaan, pembuat, tanggal) — dua dokumen untuk bahan yang sama
// tidak pernah digabung atau disimpulkan duplikat.
//
// Definisi (tertulis di respons agar layar tidak mengarang):
//  • AKAN_DATANG        PO disetujui Finance yang barangnya belum lengkap datang (menunggu / sebagian / terlambat). Sumber: status Barang Akan Datang.
//  • PERLU_DICATAT_TIBA penerimaan dari PO berstatus Draf/Terjadwal, tanggal tiba belum dicatat, dan jadwalnya hari ini atau sudah lewat. Bukan bukti barang sudah tiba.
//  • BELUM_MASUK_STOK   penerimaan yang barangnya sudah dicatat tiba tetapi belum Simpan ke stok (perlu diperiksa atau siap masuk stok).
//  • PERMINTAAN_BAHAN   permintaan bahan (alur biasa) yang menunggu persetujuan, diambil, atau dikeluarkan. Antrean bahan Produksi V2 punya halaman sendiri (tidak dihitung di sini).
//  • SELISIH_MENUNGGU   hitungan stok menunggu review, penyesuaian menunggu persetujuan/posting, dan koreksi dokumen menunggu persetujuan.
import { daftarBarangAkanDatang, penerimaanKosong } from "./finance/kedatangan.js";
import { todayBookDateWIB } from "./finance/journal.js";
import { tampilanPenerimaan } from "./penerimaanStatus.js";

const hari = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const CONTOH = 5;

export async function berandaGudang(db, { hariIni = null } = {}) {
  const today = hariIni ?? hari(todayBookDateWIB());

  // 1. Barang akan datang (PO)
  const akan = await daftarBarangAkanDatang(db, { finance: false, hariIni: today });
  const BENDERA_TUNGGU = ["MENUNGGU_KEDATANGAN", "DITERIMA_SEBAGIAN", "TERLAMBAT"];
  const poTunggu = akan.purchaseOrders.filter((p) => p.bendera.some((b) => BENDERA_TUNGGU.includes(b.kode)) && p.status !== "DIBATALKAN" && p.status !== "SELESAI");
  const terlambat = poTunggu.filter((p) => p.bendera.some((b) => b.kode === "TERLAMBAT")).length;

  // 2. Perlu dicatat tiba: Draf/Terjadwal dari PO, belum dicatat tiba, jadwal (penerimaan, atau estimasi PO bila kosong) <= hari ini
  const jadwal = await db.goodsReceipt.findMany({
    where: { purchaseOrderId: { not: null }, status: { in: ["DRAFT", "SCHEDULED"] }, arrivalRevision: 0, purchaseOrder: { status: { in: ["DISETUJUI", "DITERIMA_SEBAGIAN"] } } },
    orderBy: [{ expectedDate: "asc" }, { createdAt: "asc" }],
    select: { id: true, receiptNumber: true, status: true, supplier: true, expectedDate: true, createdAt: true, createdBy: { select: { name: true } }, purchaseOrder: { select: { poNumber: true, expectedDate: true } }, lines: { select: { id: true } } },
  });
  const jatuhTempo = jadwal.map((g) => ({ ...g, jadwalEfektif: hari(g.expectedDate) ?? hari(g.purchaseOrder?.expectedDate) })).filter((g) => g.jadwalEfektif && g.jadwalEfektif <= today);

  // 3. Belum masuk stok
  const berjalan = await db.goodsReceipt.findMany({
    where: { status: { in: ["ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"] } },
    orderBy: [{ createdAt: "asc" }],
    select: { id: true, receiptNumber: true, status: true, supplier: true, arrivedDate: true, arrivalRevision: true, purchaseOrderId: true, createdAt: true, createdBy: { select: { name: true } }, purchaseOrder: { select: { poNumber: true } }, lines: { select: { receivedQty: true, acceptedQty: true, rejectedQty: true, companionQty: true } } },
  });
  const belumStok = berjalan.filter((g) => !penerimaanKosong({ ...g, lines: g.lines }));
  const perluDiperiksa = belumStok.filter((g) => ["ARRIVED", "INSPECTION"].includes(g.status)).length;
  const siapMasuk = belumStok.filter((g) => g.status === "READY_FOR_PUTAWAY").length;

  // 4. Permintaan bahan (alur biasa; V2 Produksi punya antrean sendiri)
  const permintaan = await db.materialIssue.findMany({
    where: { status: { in: ["WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED"] }, productionPlanId: null },
    orderBy: [{ requiredDate: "asc" }, { createdAt: "asc" }],
    select: { id: true, issueNumber: true, status: true, department: true, requiredDate: true, priority: true, requestedBy: { select: { name: true } }, lines: { select: { id: true } } },
  });

  // 5. Selisih & koreksi menunggu keputusan
  const [hitungReview, penyesuaian, koreksi] = await Promise.all([
    db.stockCount.findMany({ where: { status: "WAITING_REVIEW" }, select: { id: true, countNumber: true, completedAt: true, submittedAt: true }, orderBy: { submittedAt: "asc" } }),
    db.stockAdjustmentRequest.findMany({ where: { status: { in: ["WAITING_APPROVAL", "APPROVED"] } }, select: { id: true, adjustmentNumber: true, status: true, material: { select: { code: true } } }, orderBy: { createdAt: "asc" } }),
    db.warehouseCorrection.findMany({ where: { status: "PENDING_APPROVAL" }, select: { id: true, correctionNumber: true, docNumber: true, requestedAt: true, requestedBy: { select: { name: true } } }, orderBy: { requestedAt: "asc" } }),
  ]);
  const jumlahSelisih = hitungReview.length + penyesuaian.length + koreksi.length;

  const label = (g) => tampilanPenerimaan(g).label;
  return {
    hariIni: today,
    dihitungPada: new Date().toISOString(),
    tugas: [
      {
        kode: "AKAN_DATANG", judul: "Barang akan datang", jumlah: poTunggu.length, ada: poTunggu.length > 0,
        rincian: poTunggu.length === 0 ? "Tidak ada PO yang sedang ditunggu." : `${poTunggu.length} PO belum lengkap datang${terlambat > 0 ? ` · ${terlambat} lewat estimasi` : ""}.`,
        tautan: "/warehouse/barang-akan-datang", tautanLabel: "Buka Barang Akan Datang",
        contoh: poTunggu.slice(0, CONTOH).map((p) => ({ id: p.id, judul: p.poNumber, sub: `${p.supplier?.name ?? "—"} · estimasi ${p.expectedDate ?? "belum ada"}${p.hariTerlambat > 0 ? ` (lewat ${p.hariTerlambat} hari)` : ""}`, status: p.statusAkanDatang.label, jumlahPenerimaan: p.penerimaan.length })),
      },
      {
        kode: "PERLU_DICATAT_TIBA", judul: "Barang tiba yang perlu dicatat", jumlah: jatuhTempo.length, ada: jatuhTempo.length > 0,
        rincian: jatuhTempo.length === 0 ? "Tidak ada jadwal yang jatuh tempo tanpa catatan tiba." : `${jatuhTempo.length} penerimaan terjadwal hari ini atau lewat dan belum dicatat tiba (belum tentu barangnya sudah datang).`,
        tautan: "/warehouse/goods-receipt?tahap=jadwal", tautanLabel: "Buka penerimaan terjadwal",
        contoh: jatuhTempo.slice(0, CONTOH).map((g) => ({ id: g.id, judul: g.receiptNumber, sub: `${g.purchaseOrder?.poNumber ?? "—"} · ${g.supplier ?? "—"} · jadwal ${g.jadwalEfektif} · dibuat ${g.createdBy?.name ?? "—"} ${hari(g.createdAt)}`, status: label(g) })),
      },
      {
        kode: "BELUM_MASUK_STOK", judul: "Penerimaan belum masuk stok", jumlah: belumStok.length, ada: belumStok.length > 0,
        rincian: belumStok.length === 0 ? "Semua barang yang tiba sudah masuk stok." : `${perluDiperiksa} perlu diperiksa · ${siapMasuk} siap masuk stok.`,
        tautan: "/warehouse/goods-receipt?tahap=belum-masuk-stok", tautanLabel: "Buka penerimaan belum masuk stok",
        contoh: belumStok.slice(0, CONTOH).map((g) => ({ id: g.id, judul: g.receiptNumber, sub: `${g.purchaseOrder?.poNumber ?? "tanpa PO"} · ${g.supplier ?? "—"} · tiba ${hari(g.arrivedDate) ?? "—"}`, status: label(g) })),
      },
      {
        kode: "PERMINTAAN_BAHAN", judul: "Permintaan bahan", jumlah: permintaan.length, ada: permintaan.length > 0,
        rincian: permintaan.length === 0 ? "Tidak ada permintaan bahan yang menunggu." : `${permintaan.length} permintaan menunggu persetujuan, diambil, atau dikeluarkan. Antrean bahan Produksi ada di Permintaan Bahan (Produksi).`,
        tautan: "/warehouse/material-issue", tautanLabel: "Buka Pengeluaran Material",
        contoh: permintaan.slice(0, CONTOH).map((i) => ({ id: i.id, judul: i.issueNumber, sub: `${i.department ?? "—"} · ${i.requestedBy?.name ?? "—"} · dibutuhkan ${hari(i.requiredDate) ?? "—"} · ${i.lines.length} item`, status: i.status })),
      },
      {
        kode: "SELISIH_MENUNGGU", judul: "Selisih & koreksi menunggu keputusan", jumlah: jumlahSelisih, ada: jumlahSelisih > 0,
        rincian: jumlahSelisih === 0 ? "Tidak ada selisih atau koreksi yang menunggu." : `${hitungReview.length} hitungan menunggu review · ${penyesuaian.length} penyesuaian menunggu persetujuan/posting · ${koreksi.length} koreksi dokumen menunggu persetujuan.`,
        tautan: koreksi.length > 0 && hitungReview.length === 0 && penyesuaian.length === 0 ? "/warehouse/adjustments?tab=koreksi" : hitungReview.length > 0 && penyesuaian.length === 0 && koreksi.length === 0 ? "/warehouse/stock-count" : "/warehouse/adjustments",
        tautanLabel: "Buka daftar keputusan",
        contoh: [
          ...hitungReview.map((c) => ({ id: c.id, judul: c.countNumber, sub: "Hitungan stok menunggu review", status: "Menunggu review" })),
          ...penyesuaian.map((a) => ({ id: a.id, judul: a.adjustmentNumber, sub: `Penyesuaian ${a.material?.code ?? ""}`, status: a.status === "APPROVED" ? "Disetujui, menunggu posting" : "Menunggu persetujuan" })),
          ...koreksi.map((k) => ({ id: k.id, judul: k.correctionNumber, sub: `Koreksi ${k.docNumber} · diajukan ${k.requestedBy?.name ?? "—"}`, status: "Menunggu persetujuan" })),
        ].slice(0, CONTOH),
      },
    ],
    definisi: {
      AKAN_DATANG: "PO disetujui Finance yang barangnya belum lengkap datang.",
      PERLU_DICATAT_TIBA: "Penerimaan terjadwal yang jadwalnya hari ini atau lewat dan belum dicatat tiba. Bukan bukti barang sudah tiba dan belum memengaruhi stok.",
      BELUM_MASUK_STOK: "Barang sudah dicatat tiba, belum Simpan ke stok.",
      PERMINTAAN_BAHAN: "Permintaan bahan alur biasa; antrean bahan Produksi punya halaman sendiri.",
      SELISIH_MENUNGGU: "Hitungan stok, penyesuaian, dan koreksi dokumen yang menunggu keputusan orang lain.",
    },
  };
}
