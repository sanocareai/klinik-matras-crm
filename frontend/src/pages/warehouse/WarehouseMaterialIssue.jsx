import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ClipboardList, Plus, RefreshCw } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows } from "@/components/ui/table.jsx";
import StatusBadge from "@/features/warehouse/components/StatusBadge.jsx";
import MaterialIssueFormModal from "@/features/warehouse/components/MaterialIssueFormModal.jsx";
import { ISSUE_PRIORITY_REAL } from "@/features/warehouse/inventoryReal.js";
import { useTahapFilter } from "@/features/warehouse/dokumen/useTahapFilter.js";
import { FilterTahapDokumen, StatusDokumen, RingkasItem } from "@/features/warehouse/dokumen/FilterTahapDokumen.jsx";
import { TAHAP_FILTER_MI, cocokCari, filterTahap, hitungPerTahap, tanggalPendek, teksCariMI } from "@/features/warehouse/dokumen/dokumenLogic.js";

// PENGELUARAN MATERIAL — daftar permintaan bahan (Draf → persetujuan → disiapkan → dikeluarkan). Baris menampilkan yang dibutuhkan untuk memilih pekerjaan: nomor, untuk apa/siapa, ringkasan item, kapan dibutuhkan,
// status beserta dampaknya ke stok. Detail dibuka sebagai halaman. Stok baru berkurang saat Konfirmasi keluar; selama disetujui sampai diambil, jumlah hanya dicadangkan.
const untukApa = (r) => (r.unit ? <>{r.unit.unitCode}<span className="block text-[10.5px] text-ink3">{r.unit.order?.orderNumber} · {r.unit.order?.customer?.name}</span></> : (r.sourceReference || r.department || <span className="text-ink3">—</span>));

export default function WarehouseMaterialIssue() {
  const navigate = useNavigate(); const [sp] = useSearchParams();
  const [tahap, setTahap] = useTahapFilter(); const [cari, setCari] = useState("");
  const [rows, setRows] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [formOpen, setFormOpen] = useState(false);
  const buka = (id) => navigate(`/warehouse/material-issue/${id}`);
  // Tautan lama "?buka=<id>" (mis. dari jejak biaya bahan) → langsung ke halaman detail.
  useEffect(() => { const id = sp.get("buka"); if (id) navigate(`/warehouse/material-issue/${id}`, { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- tautan dalam dibaca sekali saat halaman dibuka

  const load = useCallback(() => {
    setLoading(true); setError("");
    api.getMaterialIssues({}).then((d) => setRows(d.issues)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const hitung = useMemo(() => (rows ? hitungPerTahap(TAHAP_FILTER_MI, rows) : null), [rows]);
  const terfilter = useMemo(() => (rows ? filterTahap(TAHAP_FILTER_MI, rows, tahap).filter((r) => cocokCari(teksCariMI(r), cari)) : null), [rows, tahap, cari]);
  const kosong = !loading && terfilter && terfilter.length === 0;

  return (
    <PageContainer>
      <PageHeader
        title="Pengeluaran Material"
        subtitle="Permintaan bahan dari Produksi atau Gudang — dari pengajuan sampai bahan keluar dari stok."
        actions={<>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button>
          <Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> Permintaan Baru</Button>
        </>}
      />
      <PageBody>
        <FilterTahapDokumen filters={TAHAP_FILTER_MI} aktif={tahap} hitung={hitung} onPilih={setTahap} cari={cari} onCari={setCari}
          placeholder="Cari no., bahan, unit, order" labelCari="Cari permintaan material" labelTab="Saring tahap permintaan" />
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        <Card className="overflow-hidden p-0">
          {kosong ? (
            <EmptyState icon={ClipboardList} title={cari || tahap ? "Tidak ada permintaan yang cocok" : "Belum ada Pengeluaran Material"} description={cari || tahap ? "Ubah pencarian atau tahap." : "Permintaan bahan akan tampil di sini."}
              action={!cari && !tahap ? <Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> Permintaan Baru</Button> : undefined} />
          ) : (
            <>
              <TableWrap className="hidden md:block">
                <Table>
                  <THead><TR><TH>Permintaan</TH><TH>Untuk</TH><TH>Item</TH><TH>Dibutuhkan</TH><TH>Prioritas</TH><TH>Status</TH></TR></THead>
                  <TBody>
                    {loading && <TableSkeletonRows rows={6} cols={6} />}
                    {!loading && terfilter?.map((r) => (
                      <TR key={r.id} clickable onClick={() => buka(r.id)} data-testid="baris-dokumen" data-nomor={r.issueNumber}>
                        <TD className="whitespace-nowrap"><div className="font-semibold text-ink">{r.issueNumber}</div><div className="text-[11px] text-ink3">{r.requestedBy?.name ?? "—"} · {tanggalPendek(r.createdAt)}</div></TD>
                        <TD className="text-ink2">{untukApa(r)}{r.department && r.unit ? <span className="block text-[10.5px] text-ink3">{r.department}</span> : null}</TD>
                        <TD className="text-[12.5px]"><RingkasItem lines={r.lines} kunci="requestedQty" /></TD>
                        <TD className="whitespace-nowrap text-ink2">{r.requiredDate ? tanggalPendek(r.requiredDate) : "—"}</TD>
                        <TD><StatusBadge map={ISSUE_PRIORITY_REAL} value={r.priority} /></TD>
                        <TD className="min-w-[160px]"><StatusDokumen r={r} /></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
              <ul className="m-0 list-none divide-y divide-line p-0 md:hidden">
                {!loading && terfilter?.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => buka(r.id)} data-testid="baris-dokumen" data-nomor={r.issueNumber}
                      className="w-full px-4 py-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset max-sm:min-h-11">
                      <div className="flex items-start gap-2"><span className="text-[13px] font-semibold text-ink">{r.issueNumber}</span><span className="ml-auto shrink-0"><StatusDokumen r={r} /></span></div>
                      <div className="mt-0.5 text-[12.5px] text-ink">{r.unit ? `${r.unit.unitCode} · ${r.unit.order?.customer?.name ?? ""}` : (r.department || r.sourceReference || "—")}</div>
                      <div className="mt-0.5 text-[12px]"><RingkasItem lines={r.lines} kunci="requestedQty" /></div>
                      <div className="mt-0.5 text-[11px] text-ink2">{r.requestedBy?.name ?? "—"} · {tanggalPendek(r.createdAt)}{r.requiredDate ? ` · butuh ${tanggalPendek(r.requiredDate)}` : ""}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </PageBody>
      <MaterialIssueFormModal open={formOpen} onClose={() => setFormOpen(false)} onCreated={(d) => { load(); if (d?.id) buka(d.id); }} />
    </PageContainer>
  );
}
