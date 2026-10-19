import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { FokusOverlay } from "@/components/ui/fokus-overlay.jsx";
import PanelKedatangan from "@/features/kedatangan/PanelKedatangan.jsx";
import { STATUS_AKAN_DATANG, tanggalTeks } from "@/features/kedatangan/kedatanganLogic.js";

// DETAIL PO (Gudang) sebagai JENDELA FOKUS — dipakai halaman Barang Akan Datang (rute /warehouse/barang-akan-datang/:id) dan Beranda Gudang (rute /warehouse/dashboard/po/:id). Tanpa harga/utang.
const BadgeStatus = ({ kode, label, className }) => <Badge variant={STATUS_AKAN_DATANG[kode]?.variant || "neutral"} className={className}>{label ?? STATUS_AKAN_DATANG[kode]?.label ?? kode}</Badge>;

export default function DetailPO({ id, onClose, onChanged }) {
  const [po, setPo] = useState(null);
  const [galat, setGalat] = useState("");
  const muat = useCallback(async () => {
    try { setPo(await api.getBarangAkanDatangDetail(id)); setGalat(""); } catch (e) { setGalat(e.message || "Gagal memuat PO"); }
  }, [id]);
  useEffect(() => { muat(); }, [muat]);
  const perluTindakan = (po?.penerimaan ?? []).filter((r) => ["ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"].includes(r.status));
  return (
    <FokusOverlay
      open onClose={onClose} testid="fokus-po"
      title={po ? po.poNumber : "Memuat PO…"}
      subtitle={po ? `${po.supplier?.name} · tanggal PO ${tanggalTeks(po.orderDate)}${po.expectedDate ? ` · estimasi tiba ${tanggalTeks(po.expectedDate)}` : ""}` : undefined}
    >
      {galat && <p role="alert" className="rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">{galat}</p>}
      {!po ? (galat ? null : <p className="py-6 text-[13px] text-ink3">Memuat…</p>) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5" data-testid="status-detail">
            {po.bendera.map((b) => <BadgeStatus key={b.kode} kode={b.kode} label={b.label} />)}
            {po.hariTerlambat > 0 && <span className="text-[12px] font-semibold text-red">Lewat estimasi {po.hariTerlambat} hari</span>}
          </div>
          {po.notes && <p className="m-0 text-[12.5px] text-ink2">{po.notes}</p>}
          {po.status === "DIBATALKAN" && <p className="m-0 rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">PO dibatalkan — {po.cancelReason}</p>}
          <PanelKedatangan po={po} workspace="GUDANG" ringkas bolehTulis={po.status !== "DIBATALKAN"} ekstraPenerimaan={(r) => <Link to={`/warehouse/goods-receipt/${r.id}`} className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-accent max-sm:min-h-11" data-testid="buka-halaman-penerimaan">Buka halaman penerimaan {r.nomor} →</Link>} onChanged={async () => { await muat(); await onChanged(); }} />
          {perluTindakan.length > 0 && (
            <p className="m-0 rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink2" data-testid="petunjuk-periksa">
              Pemeriksaan (baik/ditolak) dan <strong>Simpan ke Stok</strong> dilakukan di halaman penerimaan, mis.{" "}
              <Link to={`/warehouse/goods-receipt/${perluTindakan[0].id}`} className="font-semibold text-accent">{perluTindakan[0].nomor}</Link>. Stok baru bertambah saat Simpan ke Stok.
            </p>
          )}
        </div>
      )}
    </FokusOverlay>
  );
}
