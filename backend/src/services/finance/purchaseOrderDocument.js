// VIEW DOKUMEN PURCHASE ORDER untuk PDF (dan pratinjau): satu pintu data = bentukPO (angka sama dengan layar PO) + data supplier + termin + jumlah revisi.
// Murni baca. Hanya Finance (finance:read): dokumen memuat harga dan nilai; Gudang tidak mendapat PDF ini.
import { bentukPO } from "./purchaseOrder.js";
import { PERUSAHAAN } from "../documentPdf.js";

const TEKS_SUMBER = { MASTER_SUPPLIER: "Mengikuti pengaturan supplier", PO: "Ditetapkan pada PO ini" };

export async function bangunViewPO(db, id) {
  const po = await bentukPO(db, id, { harga: true, denganPenerimaan: false });
  if (!po) return null;
  const [sup, events] = await Promise.all([
    db.finSupplier.findUnique({ where: { id: po.supplier.id }, select: { code: true, name: true, address: true, phone: true, email: true } }),
    db.finPurchaseOrderEvent.findMany({ where: { purchaseOrderId: id, type: "REVISI_JUMLAH" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  const t = po.termin;
  return {
    po: {
      id: po.id, poNumber: po.poNumber, status: po.status, orderDate: po.orderDate, expectedDate: po.expectedDate, notes: po.notes,
      approvedBy: po.approvedBy, approvedAt: po.approvedAt, cancelledAt: po.cancelledAt, cancelReason: po.cancelReason,
      lines: po.lines.map((l) => ({
        kode: l.kode, nama: l.nama, satuan: l.satuan, catatan: l.catatan, dipesan: l.dipesan, hargaSatuan: l.hargaSatuan, nilaiDipesan: l.nilaiDipesan,
        // Baris berkonversi satuan: PDF menambah catatan "Setara dengan [jumlah] [satuan stok]." (tanpa konversi: tidak ada field → tampilan lama persis).
        ...(l.konversi && { setaraQty: Math.round(l.dipesan * l.konversi.faktor * 10000) / 10000, setaraSatuan: l.konversi.satuanStok }),
      })),
      totalDipesan: po.totalDipesan,
    },
    supplier: { kode: sup?.code ?? po.supplier.code, nama: sup?.name ?? po.supplier.name, alamat: sup?.address ?? "", telepon: sup?.phone ?? "", email: sup?.email ?? "" },
    termin: { label: t?.label ?? null, sumber: t ? (TEKS_SUMBER[t.sumber] ?? null) : null },
    revisi: { jumlah: events.length, terakhir: events.length ? events[events.length - 1].createdAt : null },
    perusahaan: { namaPenerima: "Klinik Matras — Gudang Penerimaan", alamatPenerimaan: PERUSAHAAN.alamat, whatsapp: PERUSAHAAN.whatsapp },
  };
}

export const namaBerkasPO = (poNumber) => `${String(poNumber).replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
