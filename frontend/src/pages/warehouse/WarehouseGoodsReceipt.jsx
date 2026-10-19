import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronRight, Inbox, Plus, RefreshCw, Search } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import { useFilterDaftar, querySaringan } from "@/features/warehouse/dokumen/useFilterDaftar.js";
import GoodsReceiptFormModal from "@/features/warehouse/components/GoodsReceiptFormModal.jsx";
import SumberPO from "@/features/warehouse/components/SumberPO.jsx";
import PenerimaanDetail from "@/features/warehouse/penerimaan/PenerimaanDetail.jsx";
import { TAHAP_FILTER, TAHAP_PIPELINE, TAHAP_TUTUP, cocokCari, filterTahap, hitungPerTahap, identitasPenerimaan, perluTindakan, tanggalPendek } from "@/features/warehouse/penerimaan/penerimaanLogic.js";

// PENERIMAAN BARANG — pipeline dokumen penerimaan: Draf → Terjadwal → Barang tiba → Pemeriksaan → Siap masuk stok → Sudah masuk stok. Setiap baris menampilkan identitas lengkap (nomor penerimaan, nomor PO,
// supplier, pembuat, tanggal) dan TINDAKAN BERIKUTNYA (dari server) supaya dua dokumen untuk bahan yang sama tidak tertukar. Detail dibuka sebagai JENDELA FOKUS berbasis rute (/warehouse/goods-receipt/:id):
// daftar tetap terpasang di belakangnya, jadi saringan, pencarian, dan posisi gulir kembali persis seperti sebelumnya saat jendela ditutup (Esc / Back / tombol Tutup).
const PATH = "/warehouse/goods-receipt";
const KUNCI = ["tahap", "q"];
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
const Berikutnya = ({ r }) => <span className={cn("text-[12px]", perluTindakan(r) ? "font-semibold text-ink" : "text-ink3")} data-testid="tindakan-berikutnya">{r.tampilan?.berikutnya ?? "—"}</span>;

export default function WarehouseGoodsReceipt() {
  const navigate = useNavigate(); const { id } = useParams(); const { search } = useLocation();
  const [sp] = useSearchParams();
  const [f, ubahF] = useFilterDaftar(PATH, KUNCI); const tahap = f.tahap; const cari = f.q;
  const [rows, setRows] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const jarak = useRef(0); // berapa langkah riwayat dari daftar ke jendela (agar menutup kembali ke daftar, bukan ke dokumen sebelumnya)

  // Tautan lama "?buka=<id>" (mis. dari Barang Akan Datang) → jendela detail.
  useEffect(() => { const b = sp.get("buka"); if (b) navigate(`${PATH}/${b}`, { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- tautan dalam dibaca sekali saat halaman dibuka

  const load = useCallback((tenang = false) => {
    if (!tenang) setLoading(true); setError("");
    api.getGoodsReceipts({}).then((d) => setRows(d.receipts)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const hitung = useMemo(() => (rows ? hitungPerTahap(rows) : {}), [rows]);
  const terfilter = useMemo(() => (rows ? filterTahap(rows, tahap).filter((r) => cocokCari(r, cari)) : null), [rows, tahap, cari]);
  const kosong = !loading && terfilter && terfilter.length === 0;
  const saringan = querySaringan(f, KUNCI);
  const buka = (rid) => { jarak.current = 1; navigate(`${PATH}/${rid}${saringan}`); };
  const tutup = () => { if (jarak.current > 0) { const n = jarak.current; jarak.current = 0; navigate(-n); } else navigate(`${PATH}${saringan}`, { replace: true }); };
  const memantik = (e, rid) => { if (e.type === "keydown" && !["Enter", " "].includes(e.key)) return; e.preventDefault(); buka(rid); };
  const perluDitindak = useMemo(() => (rows ?? []).filter(perluTindakan).length, [rows]);

  return (
    <PageContainer>
      <PageHeader
        title="Penerimaan Barang"
        subtitle="Dokumen penerimaan dari PO, supplier, produksi, atau retur — dari jadwal kedatangan sampai masuk stok."
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => load()} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button>
            <Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> Penerimaan Baru</Button>
          </>
        }
      />
      <PageBody>
        <p className="m-0 text-[12px] text-ink2" data-testid="alur-ringkas"><Link to="/warehouse/barang-akan-datang" className="font-semibold text-accent">PO yang ditunggu ada di Barang Akan Datang</Link>; di sini Anda memeriksa barang dan memasukkannya ke stok.{rows && perluDitindak > 0 && <> <strong className="text-ink">{perluDitindak} dokumen menunggu tindakan Anda.</strong></>}</p>

        <div role="tablist" aria-label="Pipeline penerimaan" className="flex items-stretch gap-1 overflow-x-auto pb-1" data-testid="pipeline-daftar">
          <button role="tab" aria-selected={tahap === ""} onClick={() => ubahF("tahap", "")} data-testid="tahap-semua"
            className={cn("flex shrink-0 flex-col items-start rounded-btn px-3 py-1.5 text-left transition-colors max-sm:min-h-11", tahap === "" ? "bg-accentbg text-accent" : "bg-inset text-ink2 hover:bg-hovertint")}>
            <span className="text-[16px] font-bold tabular-nums leading-tight">{rows ? hitung[""] ?? 0 : "–"}</span><span className="text-[11.5px] font-semibold">Semua</span>
          </button>
          {TAHAP_PIPELINE.map((t, i) => (
            <React.Fragment key={t.key}>
              <ChevronRight size={14} className="mt-3 shrink-0 text-ink3 max-sm:hidden" aria-hidden />
              <button role="tab" aria-selected={tahap === t.key} onClick={() => ubahF("tahap", tahap === t.key ? "" : t.key)} data-testid={`tahap-${t.key}`}
                className={cn("flex shrink-0 flex-col items-start rounded-btn px-3 py-1.5 text-left transition-colors max-sm:min-h-11", tahap === t.key ? "bg-accentbg text-accent" : "bg-inset text-ink2 hover:bg-hovertint")}>
                <span className="flex items-center gap-1 text-[16px] font-bold tabular-nums leading-tight">{rows ? hitung[t.key] ?? 0 : "–"}{rows && (hitung[t.key] ?? 0) > 0 && ["DRAF", "TIBA", "PERIKSA", "SIAP"].includes(t.key) && <span className="h-1.5 w-1.5 rounded-full bg-orange" title="Menunggu tindakan Gudang" aria-label="menunggu tindakan" />}</span>
                <span className="whitespace-nowrap text-[11.5px] font-semibold">{i + 1}. {t.label}</span>
              </button>
            </React.Fragment>
          ))}
          <button role="tab" aria-selected={tahap === TAHAP_TUTUP.key} onClick={() => ubahF("tahap", tahap === TAHAP_TUTUP.key ? "" : TAHAP_TUTUP.key)} data-testid={`tahap-${TAHAP_TUTUP.key}`}
            className={cn("ml-2 flex shrink-0 flex-col items-start rounded-btn px-3 py-1.5 text-left transition-colors max-sm:min-h-11", tahap === TAHAP_TUTUP.key ? "bg-redbg text-red" : "bg-inset text-ink3 hover:bg-hovertint")}>
            <span className="text-[16px] font-bold tabular-nums leading-tight">{rows ? hitung[TAHAP_TUTUP.key] ?? 0 : "–"}</span><span className="whitespace-nowrap text-[11.5px] font-semibold">{TAHAP_TUTUP.label}</span>
          </button>
        </div>
        {TAHAP_FILTER.find((t) => t.key === tahap)?.lama && <p className="m-0 text-[11.5px] text-ink3" data-testid="saringan-lama">Saringan dari tautan lama: {TAHAP_FILTER.find((t) => t.key === tahap).label}. Pilih tahap pipeline di atas untuk menyaring lebih rinci.</p>}

        <div className="relative max-w-md">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
          <Input value={cari} onChange={(e) => ubahF("q", e.target.value)} placeholder="Cari no. GR, no. PO, supplier, bahan" aria-label="Cari penerimaan" className="pl-9" />
        </div>
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        <Card className="overflow-hidden p-0">
          {kosong ? (
            <EmptyState icon={Inbox} title={cari || tahap ? "Tidak ada penerimaan yang cocok" : "Belum ada Penerimaan Barang"} description={cari || tahap ? "Ubah pencarian atau tahap." : "Penerimaan dari PO, supplier, atau retur akan tampil di sini."} action={<Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> Penerimaan Baru</Button>} />
          ) : (
            <>
              <TableWrap className="hidden md:block">
                <Table>
                  <THead><TR><TH>Penerimaan</TH><TH>No. PO</TH><TH>Supplier</TH><TH>Jadwal</TH><TH numeric>Item</TH><TH>Tahap</TH><TH>Tindakan berikutnya</TH></TR></THead>
                  <TBody>
                    {loading && <TableSkeletonRows rows={6} cols={7} />}
                    {!loading && terfilter?.map((r) => {
                      const i = identitasPenerimaan(r);
                      return (
                        <TR key={r.id} clickable onClick={() => buka(r.id)} data-testid="baris-penerimaan" data-nomor={r.receiptNumber} data-status={r.status}>
                          <TD className="whitespace-nowrap"><a href={`${PATH}/${r.id}`} onClick={(e) => memantik(e, r.id)} className="font-semibold text-ink no-underline hover:underline">{r.receiptNumber}</a><div className="text-[11px] text-ink3">dibuat {i.pembuat ?? "—"} · {tanggalPendek(r.createdAt)}</div></TD>
                          <TD className="whitespace-nowrap"><span className="font-medium text-ink2">{i.nomorPO ?? "—"}</span> <SumberPO receipt={r} className="ml-1" /></TD>
                          <TD truncate>{r.supplier || "—"}</TD>
                          <TD className="whitespace-nowrap text-ink2">{r.expectedDate ? tanggalPendek(r.expectedDate) : "—"}</TD>
                          <TD numeric>{r.lines.length}</TD>
                          <TD className="min-w-[150px]"><StatusPenerimaan r={r} /></TD>
                          <TD className="min-w-[170px]"><Berikutnya r={r} /></TD>
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
                      <button type="button" onClick={() => buka(r.id)} className="w-full px-4 py-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset max-sm:min-h-11" data-testid="baris-penerimaan" data-nomor={r.receiptNumber} data-status={r.status}>
                        <div className="flex items-center gap-2"><span className="text-[13px] font-semibold text-ink">{r.receiptNumber}</span><SumberPO receipt={r} /><span className="ml-auto shrink-0"><StatusPenerimaan r={r} /></span></div>
                        <div className="mt-0.5 text-[12.5px] text-ink">{i.nomorPO ? <>PO <strong>{i.nomorPO}</strong> · </> : null}{r.supplier || "—"}</div>
                        <div className="mt-0.5 text-[11px] text-ink2">{r.lines.length} item · jadwal {r.expectedDate ? tanggalPendek(r.expectedDate) : "—"} · dibuat {i.pembuat ?? "—"} {tanggalPendek(r.createdAt)}</div>
                        <div className="mt-1 flex items-center gap-1 text-[11.5px] text-ink3">Berikutnya: <Berikutnya r={r} /></div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>
      </PageBody>
      {id && <PenerimaanDetail key="fokus" id={id} onTutup={tutup} onBerubah={() => load(true)} saringan={saringan} />}
      <GoodsReceiptFormModal open={formOpen} onClose={() => setFormOpen(false)} onCreated={(g) => { load(); if (g?.id) buka(g.id); }} />
    </PageContainer>
  );
}
