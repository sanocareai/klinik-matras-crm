import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeftRight, Plus, RefreshCw } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows } from "@/components/ui/table.jsx";
import StockTransferFormModal from "@/features/warehouse/components/StockTransferFormModal.jsx";
import { TRANSFER_TYPE_REAL } from "@/features/warehouse/inventoryReal.js";
import { useTahapFilter } from "@/features/warehouse/dokumen/useTahapFilter.js";
import { FilterTahapDokumen, StatusDokumen, RingkasItem } from "@/features/warehouse/dokumen/FilterTahapDokumen.jsx";
import { TAHAP_FILTER_ST, cocokCari, filterTahap, hitungPerTahap, tanggalPendek, teksCariST } from "@/features/warehouse/dokumen/dokumenLogic.js";

// TRANSFER STOK — daftar perpindahan barang antar lokasi (Draf → persetujuan → diambil → dalam perjalanan → selesai). Dua langkah menulis stok: Kirim barang (saldo dikurangi) dan Terima barang (saldo bertambah).
// Status "Dalam perjalanan" berarti saldo SUDAH berkurang di sistem tetapi barang belum diterima di tujuan. Detail dibuka sebagai halaman.
export default function WarehouseTransfers() {
  const navigate = useNavigate(); const [sp] = useSearchParams();
  const [tahap, setTahap] = useTahapFilter(); const [cari, setCari] = useState("");
  const [rows, setRows] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [formOpen, setFormOpen] = useState(false);
  const buka = (id) => navigate(`/warehouse/transfers/${id}`);
  useEffect(() => { const id = sp.get("buka"); if (id) navigate(`/warehouse/transfers/${id}`, { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- tautan dalam dibaca sekali saat halaman dibuka

  const load = useCallback(() => {
    setLoading(true); setError("");
    api.getStockTransfers({}).then((d) => setRows(d.transfers)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const hitung = useMemo(() => (rows ? hitungPerTahap(TAHAP_FILTER_ST, rows) : null), [rows]);
  const terfilter = useMemo(() => (rows ? filterTahap(TAHAP_FILTER_ST, rows, tahap).filter((r) => cocokCari(teksCariST(r), cari)) : null), [rows, tahap, cari]);
  const kosong = !loading && terfilter && terfilter.length === 0;

  return (
    <PageContainer>
      <PageHeader
        title="Transfer Stok"
        subtitle="Perpindahan barang antar lokasi, rak, atau gudang — dari pengajuan sampai diterima di tujuan."
        actions={<>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button>
          <Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> Transfer Baru</Button>
        </>}
      />
      <PageBody>
        <FilterTahapDokumen filters={TAHAP_FILTER_ST} aktif={tahap} hitung={hitung} onPilih={setTahap} cari={cari} onCari={setCari}
          placeholder="Cari no., lokasi, bahan" labelCari="Cari transfer stok" labelTab="Saring tahap transfer" />
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        <Card className="overflow-hidden p-0">
          {kosong ? (
            <EmptyState icon={ArrowLeftRight} title={cari || tahap ? "Tidak ada transfer yang cocok" : "Belum ada Transfer Stok"} description={cari || tahap ? "Ubah pencarian atau tahap." : "Perpindahan barang antar lokasi akan tampil di sini."}
              action={!cari && !tahap ? <Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> Transfer Baru</Button> : undefined} />
          ) : (
            <>
              <TableWrap className="hidden md:block">
                <Table>
                  <THead><TR><TH>Transfer</TH><TH>Dari → ke</TH><TH>Item</TH><TH>Status</TH></TR></THead>
                  <TBody>
                    {loading && <TableSkeletonRows rows={6} cols={4} />}
                    {!loading && terfilter?.map((r) => (
                      <TR key={r.id} clickable onClick={() => buka(r.id)} data-testid="baris-dokumen" data-nomor={r.transferNumber}>
                        <TD className="whitespace-nowrap"><div className="font-semibold text-ink">{r.transferNumber}</div><div className="text-[11px] text-ink3">{r.requestedBy?.name ?? "—"} · {tanggalPendek(r.createdAt)}</div></TD>
                        <TD className="text-ink2"><span className="font-medium text-ink">{r.sourceLocation.code}</span> → <span className="font-medium text-ink">{r.destinationLocation.code}</span><span className="block text-[10.5px] text-ink3">{TRANSFER_TYPE_REAL[r.transferType]?.labelId ?? r.transferType}</span></TD>
                        <TD className="text-[12.5px]"><RingkasItem lines={r.lines} kunci="qtySent" /></TD>
                        <TD className="min-w-[170px]"><StatusDokumen r={r} /></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
              <ul className="m-0 list-none divide-y divide-line p-0 md:hidden">
                {!loading && terfilter?.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => buka(r.id)} data-testid="baris-dokumen" data-nomor={r.transferNumber}
                      className="w-full px-4 py-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset max-sm:min-h-11">
                      <div className="flex items-start gap-2"><span className="text-[13px] font-semibold text-ink">{r.transferNumber}</span><span className="ml-auto shrink-0"><StatusDokumen r={r} /></span></div>
                      <div className="mt-0.5 text-[12.5px] text-ink">{r.sourceLocation.code} → {r.destinationLocation.code}</div>
                      <div className="mt-0.5 text-[12px]"><RingkasItem lines={r.lines} kunci="qtySent" /></div>
                      <div className="mt-0.5 text-[11px] text-ink2">{r.requestedBy?.name ?? "—"} · {tanggalPendek(r.createdAt)}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </PageBody>
      <StockTransferFormModal open={formOpen} onClose={() => setFormOpen(false)} onCreated={(d) => { load(); if (d?.id) buka(d.id); }} />
    </PageContainer>
  );
}
