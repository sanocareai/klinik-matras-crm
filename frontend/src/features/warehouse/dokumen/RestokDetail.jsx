import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api.js";
import { UNIT_LABEL } from "@/features/warehouse/inventoryReal.js";
import JejakDokumen from "./JejakDokumen.jsx";
import { HalamanDokumen, KartuStatusDokumen, KartuAksiDokumen, useDokumen } from "./KartuDokumen.jsx";
import { PRIORITAS, SUMBER_RESTOK } from "./labelDokumen.js";
import { tanggalPendek, teksJumlah, waktuTeks } from "./dokumenLogic.js";

// DETAIL PERMINTAAN RESTOK — halaman. Restok TIDAK PERNAH mengubah stok: selesai = ditautkan ke penerimaan barang yang stoknya masuk lewat Penerimaan Barang. Status/aksi dari server.
// Saran restok hanya muncul untuk bahan yang punya batas minimum (kosong = "belum diatur", tidak ada angka buatan).
const satuan = (u) => UNIT_LABEL[u] || String(u || "").toLowerCase();
const STATUS_MAJU = { AJUKAN: "WAITING_APPROVAL", SETUJUI: "APPROVED", TANDAI_DIPESAN: "ORDERED" };
const OPSI_PRIORITAS = Object.entries(PRIORITAS).map(([nilai, label]) => ({ nilai, label }));

export default function RestokDetail({ id, onTutup, onBerubah }) {
  const { r, galat, memuat, sibuk, setSibuk, versi, muat } = useDokumen(api.getReplenishmentRequest, id, onBerubah);
  const [kandidat, setKandidat] = useState(null);
  useEffect(() => {
    if (r?.status !== "ORDERED") { setKandidat(null); return; }
    api.getGoodsReceipts({}).then((d) => setKandidat((d.receipts ?? []).filter((g) => g.lines?.some((l) => l.materialId === r.materialId)))).catch(() => setKandidat([]));
  }, [r?.status, r?.materialId]);

  const jalankan = async (kode, v = {}) => {
    setSibuk(true);
    try {
      if (STATUS_MAJU[kode]) await api.updateReplenishmentRequest(id, { status: STATUS_MAJU[kode] });
      else if (kode === "UBAH") await api.updateReplenishmentRequest(id, { suggestedQty: v.suggestedQty, requiredDate: v.requiredDate || null, priority: v.priority, supplier: v.supplier, notes: v.notes });
      else if (kode === "HUBUNGKAN_PENERIMAAN") await api.linkReplenishmentReceipt(id, v.goodsReceiptId);
      else if (kode === "TOLAK") await api.rejectReplenishmentRequest(id, v.alasan);
      await muat();
    } catch (e) { await muat(); throw e; } finally { setSibuk(false); }
  };

  if (!r) return <HalamanDokumen r={r} memuat={memuat} galat={galat} onTutup={onTutup} nama="permintaan restok" />;
  const t = r.tampilan; const u = satuan(r.material?.unit);
  const SPEC = {
    SETUJUI: { panel: { judul: "Setujui permintaan restok ini?", tombol: "Setujui", peringatan: "Persetujuan tidak mengubah stok. Pemesanan ke pemasok dilakukan di luar halaman ini (Finance/PO).", bidang: [] } },
    UBAH: { panel: { judul: "Ubah permintaan restok", tombol: "Simpan perubahan", peringatan: "Jumlah, tanggal dibutuhkan, prioritas, pemasok, dan catatan boleh diubah selama belum selesai/ditolak.", bidang: [
      { nama: "suggestedQty", label: "Jumlah diminta", wajib: true, awal: String(r.suggestedQty ?? ""), maks: 20 }, { nama: "requiredDate", label: "Dibutuhkan tanggal", tipe: "date", awal: r.requiredDate ? String(r.requiredDate).slice(0, 10) : "" },
      { nama: "priority", label: "Prioritas", tipe: "pilih", opsi: OPSI_PRIORITAS, awal: r.priority }, { nama: "supplier", label: "Pemasok", maks: 120, awal: r.supplier ?? "" }, { nama: "notes", label: "Catatan", tipe: "area", maks: 500, awal: r.notes ?? "" }] } },
    HUBUNGKAN_PENERIMAAN: { panel: { judul: "Tautkan ke penerimaan barang", tombol: "Tautkan & selesaikan", peringatan: "Menandai barang pesanan benar-benar tiba. Stok TIDAK ditambah dari sini: stok masuk lewat Penerimaan Barang yang ditautkan. Hanya penerimaan yang memuat bahan ini ditawarkan.",
      catatan: kandidat && kandidat.length === 0 ? "Belum ada penerimaan barang yang memuat bahan ini. Catat penerimaannya dulu di Penerimaan Barang." : undefined, galat: kandidat && kandidat.length === 0 ? "Belum ada penerimaan untuk bahan ini" : undefined,
      bidang: [{ nama: "goodsReceiptId", label: "Penerimaan barang", tipe: "pilih", wajib: true, awal: "", opsi: [{ nilai: "", label: "Pilih penerimaan…" }, ...(kandidat ?? []).map((g) => ({ nilai: g.id, label: `${g.receiptNumber} · ${g.tampilan?.label ?? g.status}${g.purchaseOrder?.poNumber ? ` · PO ${g.purchaseOrder.poNumber}` : ""}` }))] }] } },
    TOLAK: { panel: { judul: "Tolak permintaan restok ini?", tombol: "Ya, tolak", peringatan: "Permintaan tersimpan sebagai Ditolak beserta alasan; tidak ada pengaruh ke stok.", bidang: [{ nama: "alasan", label: "Alasan penolakan", wajib: true, min: 3, maks: 300 }] } },
  };
  const identitas = [
    { label: "No. permintaan", isi: r.requestNumber, testid: "id-nomor" }, { label: "Sumber", isi: SUMBER_RESTOK[r.source] ?? r.source }, { label: "Prioritas", isi: PRIORITAS[r.priority] ?? r.priority }, { label: "Dibutuhkan", isi: tanggalPendek(r.requiredDate) },
    { label: "Bahan", isi: `${r.material?.code} — ${r.material?.name}`, lebar: true, testid: "id-bahan" }, { label: "Jumlah diminta", isi: `${teksJumlah(r.suggestedQty)} ${u}`, testid: "id-jumlah" },
    { label: "Saldo saat dibuat", isi: `${teksJumlah(r.currentStockSnapshot)} ${u}` }, { label: "Batas minimum", isi: r.minimumStockSnapshot == null ? "belum diatur" : `${teksJumlah(r.minimumStockSnapshot)} ${u}`, testid: "id-minimum" },
    { label: "Pemasok", isi: r.supplier || "—" }, { label: "Diajukan oleh", isi: r.requestedBy?.name }, { label: "Disetujui oleh", isi: r.approvedBy?.name }, { label: "Dipesan", isi: r.orderedAt ? waktuTeks(r.orderedAt) : "—" },
    { label: "Penerimaan tertaut", isi: r.goodsReceipt ? <Link to={`/warehouse/goods-receipt/${r.goodsReceipt.id}`} className="font-semibold text-accent" data-testid="tautan-penerimaan">{r.goodsReceipt.receiptNumber}</Link> : "—", lebar: true },
  ];
  return (
    <HalamanDokumen judul={r.requestNumber} subjudul={`${r.material?.code} · ${teksJumlah(r.suggestedQty)} ${u}`} onTutup={onTutup} r={r} memuat={memuat} galat={galat} onMuat={muat} nama="permintaan restok" footer={<KartuAksiDokumen tampilan={t} izin={r.izin} spec={SPEC} onJalankan={jalankan} sibuk={sibuk} versi={versi} namaDokumen="permintaan restok ini" kaki="Permintaan restok tidak pernah menambah atau mengurangi stok. Stok bertambah hanya lewat Penerimaan Barang." />}>
      <KartuStatusDokumen tampilan={t} identitas={identitas} alurLabel="Alur permintaan restok" catatan={r.notes} />
      <JejakDokumen jejak={r.jejak} basePath="/warehouse/replenishment" />
    </HalamanDokumen>
  );
}
