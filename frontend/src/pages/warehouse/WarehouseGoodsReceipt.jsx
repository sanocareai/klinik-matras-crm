import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Inbox, Plus, RefreshCw, Search } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import GoodsReceiptFormModal from "@/features/warehouse/components/GoodsReceiptFormModal.jsx";
import SumberPO from "@/features/warehouse/components/SumberPO.jsx";
import { TAHAP_FILTER, filterTahap, hitungPerTahap, identitasPenerimaan, tanggalPendek } from "@/features/warehouse/penerimaan/penerimaanLogic.js";

// PENERIMAAN BARANG — daftar dokumen penerimaan (jadwal kedatangan → barang tiba → pemeriksaan → masuk stok). Setiap baris menampilkan identitas lengkap (nomor penerimaan, nomor PO,
// supplier, pembuat, tanggal) supaya dua dokumen untuk bahan yang sama tidak tertukar. Detail dibuka sebagai halaman (bukan drawer). Baris stok baru ditulis SATU KALI saat Simpan ke Stok.
const PO_ALUR = ["PO disetujui", "Jadwal kedatangan", "Barang tiba", "Pemeriksaan", "Masuk stok"];
const BADGE = { neutral: "neutral", accent: "accent", orange: "orange", green: "green", red: "red" };

function StatusPenerimaan({ r }) {
  const t = r.tampilan;
  return (
    <div className="space-y-0.5">
      <Badge variant={BADGE[t?.warna] ?? "neutral"} data-testid="status-baris" className="h-auto whitespace-normal text-left leading-tight">{t?.label ?? r.status}</Badge>
      {t?.pengaruhStok === "BELUM" && ["DRAFT", "SCHEDULED"].includes(r.status) && <div className="text-[10.5px] text-ink3">Belum memengaruhi stok</div>}
    </div>
  );
}

export default function WarehouseGoodsReceipt() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const tahap = sp.get("tahap") ?? "";
  const [cari, setCari] = useState("");
  const [rows, setRows] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  // Tautan lama "?buka=<id>" (mis. dari Barang Akan Datang) → langsung ke halaman detail.
  useEffect(() => { const id = sp.get("buka"); if (id) navigate(`/warehouse/goods-receipt/${id}`, { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- tautan dalam dibaca sekali saat halaman dibuka

  const load = useCallback(() => {
    setLoading(true); setError("");
    api.getGoodsReceipts({}).then((d) => setRows(d.receipts)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const hitung = useMemo(() => (rows ? hitungPerTahap(rows) : {}), [rows]);
  const terfilter = useMemo(() => {
    if (!rows) return null;
    const q = cari.trim().toLowerCase();
    return filterTahap(rows, tahap).filter((r) => !q || [r.receiptNumber, r.purchaseOrder?.poNumber, r.supplier, r.sourceReference, ...(r.lines ?? []).map((l) => `${l.material?.code} ${l.material?.name}`)].join(" ").toLowerCase().includes(q));
  }, [rows, tahap, cari]);
  const kosong = !loading && terfilter && terfilter.length === 0;
  const buka = (id) => navigate(`/warehouse/goods-receipt/${id}`);

  return (
    <PageContainer>
      <PageHeader
        title="Penerimaan Barang"
        subtitle="Dokumen penerimaan dari PO, supplier, produksi, atau retur — dari jadwal kedatangan sampai masuk stok."
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button>
            <Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> Penerimaan Baru</Button>
          </>
        }
      />
      <PageBody>
        <nav aria-label="Alur penerimaan" className="rounded-btn bg-inset px-3 py-2 text-[12px] text-ink2" data-testid="alur-ringkas">
          <span className="font-semibold text-ink">Alur: </span>{PO_ALUR.join(" → ")}.{" "}
          <Link to="/warehouse/barang-akan-datang" className="font-semibold text-accent">PO yang ditunggu ada di Barang Akan Datang</Link>; di sini Anda memeriksa dan memasukkan barang ke stok.
        </nav>

        <div role="tablist" aria-label="Saring tahap penerimaan" className="flex gap-1 overflow-x-auto border-b border-line pb-2 md:flex-wrap">
          {TAHAP_FILTER.map((t) => (
            <button key={t.key} role="tab" aria-selected={tahap === t.key} onClick={() => setSp(t.key ? { tahap: t.key } : {})} data-testid={`tahap-${t.key || "semua"}`}
              className={cn("flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-chip px-3 py-1.5 text-[12.5px] font-semibold transition-colors max-sm:min-h-11", tahap === t.key ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint hover:text-ink2")}>
              {t.label}{rows && <span className="rounded-full bg-inset px-1.5 text-[11px] tabular-nums text-ink2">{hitung[t.key] ?? 0}</span>}
            </button>
          ))}
        </div>
        <div className="relative max-w-md">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
          <Input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari no. GR, no. PO, supplier, bahan" aria-label="Cari penerimaan" className="pl-9" />
        </div>
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        <Card className="overflow-hidden p-0">
          {kosong ? (
            <EmptyState icon={Inbox} title={cari || tahap ? "Tidak ada penerimaan yang cocok" : "Belum ada Penerimaan Barang"} description={cari || tahap ? "Ubah pencarian atau tahap." : "Penerimaan dari PO, supplier, atau retur akan tampil di sini."} action={<Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> Penerimaan Baru</Button>} />
          ) : (
            <>
              <TableWrap className="hidden md:block">
                <Table>
                  <THead><TR><TH>Penerimaan</TH><TH>No. PO</TH><TH>Supplier</TH><TH>Jadwal</TH><TH numeric>Item</TH><TH>Status</TH></TR></THead>
                  <TBody>
                    {loading && <TableSkeletonRows rows={6} cols={6} />}
                    {!loading && terfilter?.map((r) => {
                      const i = identitasPenerimaan(r);
                      return (
                        <TR key={r.id} clickable onClick={() => buka(r.id)} data-testid="baris-penerimaan" data-nomor={r.receiptNumber}>
                          <TD className="whitespace-nowrap"><div className="font-semibold text-ink">{r.receiptNumber}</div><div className="text-[11px] text-ink3">dibuat {i.pembuat ?? "—"} · {tanggalPendek(r.createdAt)}</div></TD>
                          <TD className="whitespace-nowrap"><span className="font-medium text-ink2">{i.nomorPO ?? "—"}</span> <SumberPO receipt={r} className="ml-1" /></TD>
                          <TD truncate>{r.supplier || "—"}</TD>
                          <TD className="whitespace-nowrap text-ink2">{r.expectedDate ? tanggalPendek(r.expectedDate) : "—"}</TD>
                          <TD numeric>{r.lines.length}</TD>
                          <TD className="min-w-[150px]"><StatusPenerimaan r={r} /></TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </TableWrap>
              <ul className="m-0 list-none divide-y divide-line p-0 md:hidden">
                {!loading && terfilter?.map((r) => {
                  const i = identitasPenerimaan(r);
                  return (
                    <li key={r.id}>
                      <button type="button" onClick={() => buka(r.id)} className="w-full px-4 py-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset max-sm:min-h-11" data-testid="baris-penerimaan" data-nomor={r.receiptNumber}>
                        <div className="flex items-center gap-2"><span className="text-[13px] font-semibold text-ink">{r.receiptNumber}</span><SumberPO receipt={r} /><span className="ml-auto shrink-0"><StatusPenerimaan r={r} /></span></div>
                        <div className="mt-0.5 text-[12.5px] text-ink">{i.nomorPO ? <>PO <strong>{i.nomorPO}</strong> · </> : null}{r.supplier || "—"}</div>
                        <div className="mt-0.5 text-[11px] text-ink2">{r.lines.length} item · jadwal {r.expectedDate ? tanggalPendek(r.expectedDate) : "—"} · dibuat {i.pembuat ?? "—"} {tanggalPendek(r.createdAt)}</div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>
      </PageBody>
      <GoodsReceiptFormModal open={formOpen} onClose={() => setFormOpen(false)} onCreated={(g) => { load(); if (g?.id) buka(g.id); }} />
    </PageContainer>
  );
}
