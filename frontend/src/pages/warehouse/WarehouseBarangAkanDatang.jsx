import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Inbox, RefreshCw, Search } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import PanelKedatangan from "@/features/kedatangan/PanelKedatangan.jsx";
import { STATUS_AKAN_DATANG, TAB_AKAN_DATANG, jumlahTeks, tanggalTeks, ringkasKuantitas } from "@/features/kedatangan/kedatanganLogic.js";

// BARANG AKAN DATANG (Gudang) — PO bahan baku yang sama dengan Finance, TANPA harga, total, utang, atau pembayaran.
// Gudang melihat apa yang dipesan, kapan diperkirakan datang, apa yang sudah datang, dan mencatat barang tiba. Memeriksa baik/ditolak dan Simpan ke Stok tetap di Penerimaan Barang.
// Angka dan status dihitung server (satu sumber); halaman ini hanya menampilkan.
const BadgeStatus = ({ kode, label, className }) => <Badge variant={STATUS_AKAN_DATANG[kode]?.variant || "neutral"} className={className}>{label ?? STATUS_AKAN_DATANG[kode]?.label ?? kode}</Badge>;

export default function WarehouseBarangAkanDatang() {
  const [tab, setTab] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bukaId, setBukaId] = useState(null);

  const muat = useCallback(() => {
    setLoading(true); setError("");
    return api.getBarangAkanDatang({ status: tab || undefined, q: q.trim() || undefined })
      .then(setData).catch((e) => setError(e.message || "Gagal memuat")).finally(() => setLoading(false));
  }, [tab, q]);
  useEffect(() => { const t = setTimeout(muat, q ? 250 : 0); return () => clearTimeout(t); }, [muat, q]);

  const rows = data?.purchaseOrders ?? [];
  const kosong = !loading && data && rows.length === 0;

  return (
    <PageContainer>
      <PageHeader
        title="Barang Akan Datang"
        subtitle="PO bahan baku dari Finance: yang ditunggu, yang sudah tiba, dan yang siap disimpan. Tanpa harga atau nilai."
        actions={<Button variant="ghost" size="sm" onClick={muat} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button>}
      />
      <PageBody>
        <div role="tablist" aria-label="Saring status barang akan datang" className="flex flex-wrap gap-1 border-b border-line pb-2">
          {TAB_AKAN_DATANG.map((t) => {
            const jml = t.key ? data?.hitungan?.[t.key] : null;
            return (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} data-testid={`tab-${t.key || "semua"}`}
                className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium max-sm:min-h-11", tab === t.key ? "bg-accentbg text-accent" : "text-ink2 hover:bg-hovertint")}>
                {t.label}{jml != null && <span className="rounded-full bg-inset px-1.5 text-[11px] tabular-nums text-ink2" data-testid={`hitung-${t.key}`}>{jml}</span>}
              </button>
            );
          })}
        </div>
        <div className="relative max-w-md">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor PO, supplier, atau nama barang" aria-label="Cari PO" className="pl-9" />
        </div>
        {error && <p role="alert" className="rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">{error}</p>}

        {kosong ? (
          <Card><EmptyState icon={Inbox} title="Belum ada barang yang akan datang" description={tab ? "Tidak ada PO pada status ini." : "PO yang disetujui Finance akan muncul di sini."} /></Card>
        ) : (
          <>
            <TableWrap className="hidden md:block">
              <Table>
                <THead><TR><TH>PO</TH><TH>Supplier</TH><TH>Estimasi tiba</TH><TH>Progres</TH><TH>Status</TH><TH>Pengiriman</TH></TR></THead>
                <TBody>
                  {loading && !data && <TableSkeletonRows rows={6} cols={6} />}
                  {rows.map((po) => {
                    const r = ringkasKuantitas(po);
                    return (
                      <TR key={po.id} clickable onClick={() => setBukaId(po.id)} data-testid="baris-po" data-po={po.poNumber}>
                        <TD className="font-semibold text-ink">{po.poNumber}</TD>
                        <TD>{po.supplier?.name}</TD>
                        <TD>{tanggalTeks(po.expectedDate)}{po.hariTerlambat > 0 && <span className="ml-1.5 text-[11.5px] font-semibold text-red">lewat {po.hariTerlambat} hari</span>}</TD>
                        <TD><div className="text-[12.5px] tabular-nums text-ink2">{r.teks}</div></TD>
                        <TD>
                          <div className="flex flex-wrap gap-1" data-testid="status-po">
                            <BadgeStatus kode={po.statusAkanDatang.kode} label={po.statusAkanDatang.label} />
                            {po.bendera.filter((b) => b.kode !== po.statusAkanDatang.kode).map((b) => <BadgeStatus key={b.kode} kode={b.kode} label={b.label} />)}
                          </div>
                        </TD>
                        <TD className="tabular-nums">{po.penerimaan.length}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrap>
            <ul className="list-none space-y-2 p-0 md:hidden">
              {rows.map((po) => {
                const r = ringkasKuantitas(po);
                return (
                  <li key={po.id}>
                    <button type="button" onClick={() => setBukaId(po.id)} className="w-full rounded-lg border border-line bg-surface p-3 text-left hover:bg-hovertint" data-testid="baris-po" data-po={po.poNumber}>
                      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[13.5px] font-semibold text-ink">{po.poNumber}</span><BadgeStatus kode={po.statusAkanDatang.kode} label={po.statusAkanDatang.label} /></div>
                      <div className="mt-0.5 text-[12.5px] text-ink2">{po.supplier?.name}</div>
                      <div className="mt-1 text-[12px] text-ink2">Estimasi tiba {tanggalTeks(po.expectedDate)}{po.hariTerlambat > 0 && <span className="ml-1 font-semibold text-red">· lewat {po.hariTerlambat} hari</span>}</div>
                      <div className="mt-0.5 text-[12px] tabular-nums text-ink2">{r.teks}</div>
                      <div className="mt-1 flex flex-wrap gap-1">{po.bendera.filter((b) => b.kode !== po.statusAkanDatang.kode).map((b) => <BadgeStatus key={b.kode} kode={b.kode} label={b.label} />)}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </PageBody>
      {bukaId && <DetailPO id={bukaId} onClose={() => setBukaId(null)} onChanged={muat} />}
    </PageContainer>
  );
}

function DetailPO({ id, onClose, onChanged }) {
  const [po, setPo] = useState(null);
  const [galat, setGalat] = useState("");
  const muat = useCallback(async () => {
    try { setPo(await api.getBarangAkanDatangDetail(id)); setGalat(""); } catch (e) { setGalat(e.message || "Gagal memuat PO"); }
  }, [id]);
  useEffect(() => { muat(); }, [muat]);
  const perluTindakan = (po?.penerimaan ?? []).filter((r) => ["ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"].includes(r.status));
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()} className="w-[920px]"
      title={po ? po.poNumber : "Memuat PO…"}
      description={po ? `${po.supplier?.name} · tanggal PO ${tanggalTeks(po.orderDate)}${po.expectedDate ? ` · estimasi tiba ${tanggalTeks(po.expectedDate)}` : ""}` : undefined}
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
          <PanelKedatangan po={po} workspace="GUDANG" bolehTulis={po.status !== "DIBATALKAN"} onChanged={async () => { await muat(); await onChanged(); }} />
          {perluTindakan.length > 0 && (
            <p className="m-0 rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink2" data-testid="petunjuk-periksa">
              Pemeriksaan (baik/ditolak) dan <strong>Simpan ke Stok</strong> dilakukan di{" "}
              <Link to={`/warehouse/goods-receipt?buka=${perluTindakan[0].id}`} className="font-semibold text-accent">Penerimaan Barang</Link>. Stok baru bertambah saat Simpan ke Stok.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
