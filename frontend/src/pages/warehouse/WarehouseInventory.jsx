import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Info, MapPin, Package, Plus, RefreshCw, Search } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import ItemDetailDrawer from "@/features/warehouse/components/ItemDetailDrawer.jsx";
import ItemFormModal from "@/features/warehouse/components/ItemFormModal.jsx";
import { CATEGORY_REAL } from "@/features/warehouse/inventoryReal.js";
import { FILTER_KEADAAN, saringStok, teksSaldo, teksBatasMinimum, warnaKeadaan, tampilSaldo, riwayatLokasi } from "@/features/warehouse/stok/stokLogic.js";

// STOK & LOKASI — satu halaman untuk mencari bahan dan membaca saldonya dengan jujur (Okt 2026). Semua angka berasal dari GET /inventory/beranda/stok (ledger pergerakan):
//  • "—" pada Saldo = BELUM ADA CATATAN stok (belum diketahui), bukan nol. "0" hanya untuk bahan yang punya pergerakan dan hasilnya nol.
//  • "—" pada Batas minimum = belum diatur (bukan 0). Selama belum diatur, sistem tidak menyimpulkan "perlu dipesan ulang".
//  • Sistem tidak menyimpan saldo per lokasi: kolom Lokasi = lokasi penerimaan terakhir, bukan saldo di lokasi itu.
// Detail/ubah bahan memakai drawer dan form yang sama dengan sebelumnya (data referensi vendor/nilai stok ada di drawer).
const TABS = [
  { key: "", label: "Semua" }, { key: "RAW_MATERIAL", label: "Bahan Baku" }, { key: "WIP", label: "Setengah Jadi" },
  { key: "FINISHED_GOODS", label: "Barang Jadi" }, { key: "CONSUMABLE", label: "Habis Pakai" }, { key: "none", label: "Tanpa Kategori" },
];

function SaldoSel({ r, inline = false }) {
  const t = tampilSaldo(r);
  if (t.jenis === "BELUM_DIKETAHUI") return <span className="text-[11.5px] font-medium italic text-ink3">{t.teks}</span>;
  if (t.jenis === "MINUS") return <span className="font-bold text-red">{t.teks}<span className="ml-1 text-[10.5px] font-semibold uppercase">minus</span></span>;
  if (t.jenis === "NOL") return <span className="font-semibold text-ink2">0<span className="ml-1 text-[10.5px] font-normal text-ink3">habis</span></span>;
  return <span className={inline ? "font-semibold text-ink" : "font-semibold text-ink"}>{t.teks}</span>;
}

export default function WarehouseInventory() {
  const [data, setData] = useState(null); const [stok, setStok] = useState(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [tab, setTab] = useState(""); const [cari, setCari] = useState(""); const [keadaan, setKeadaan] = useState(""); const [nonaktif, setNonaktif] = useState(false);
  const [selected, setSelected] = useState(null); const [formOpen, setFormOpen] = useState(false); const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError("");
    Promise.all([api.getStokLokasi(), api.getStock()]).then(([a, b]) => { setData(a); setStok(new Map(b.map((x) => [x.materialId, x]))); }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const terfilter = useMemo(() => (data ? saringStok(data.rows, { tab, cari, keadaan, nonaktif }) : null), [data, tab, cari, keadaan, nonaktif]);
  const ringkas = data?.ringkasan; const k = ringkas?.kesimpulan;
  const kosong = !loading && terfilter && terfilter.length === 0;

  return (
    <PageContainer>
      <PageHeader
        title="Stok & Lokasi"
        subtitle="Cari bahan, lihat saldo, satuan, lokasi, dan dari mana angkanya."
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button>
            <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus size={14} /> Tambah Bahan</Button>
          </>
        }
      />
      <PageBody>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
            <Input type="search" value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari kode, nama, atau vendor" aria-label="Cari bahan" className="pl-9" autoFocus />
          </div>
          <select value={keadaan} onChange={(e) => setKeadaan(e.target.value)} aria-label="Saring keadaan stok" className="h-9 rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-accent max-sm:min-h-11">
            {FILTER_KEADAAN.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-[12px] text-ink2 max-sm:min-h-11"><input type="checkbox" checked={nonaktif} onChange={(e) => setNonaktif(e.target.checked)} /> Tampilkan nonaktif</label>
        </div>
        {ringkas && (
          <details open={typeof window !== "undefined" && !!window.matchMedia?.("(min-width: 768px)").matches} aria-label="Ringkasan stok" className="rounded-btn border border-line bg-surface p-3" data-testid="ringkasan-stok">
            <summary className="cursor-pointer list-none text-[12.5px] font-semibold text-ink max-sm:flex max-sm:min-h-11 max-sm:items-center md:hidden" data-testid="ringkasan-ringkas">Ringkasan stok · {ringkas.aktif} aktif · {ringkas.belumAdaCatatan} belum ada catatan · {ringkas.minus} minus <span className="font-normal text-ink3">(ketuk untuk rincian)</span></summary>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-ink2 max-sm:mt-2">
              <span><strong className="text-ink" data-testid="n-terdaftar">{ringkas.terdaftar}</strong> bahan terdaftar</span>
              <span><strong className="text-ink" data-testid="n-aktif">{ringkas.aktif}</strong> aktif{ringkas.nonaktif > 0 && ` (${ringkas.nonaktif} nonaktif disembunyikan)`}</span>
              <span><strong className="text-ink">{ringkas.ada}</strong> ada stok</span>
              <span><strong className="text-ink">{ringkas.belumAdaCatatan}</strong> belum ada catatan stok</span>
              <span><strong className="text-ink">{ringkas.nolTerhitung}</strong> nol menurut pergerakan</span>
              <span><strong className="text-ink">{ringkas.minus}</strong> bersaldo minus</span>
            </div>
            <ul className="m-0 mt-2 list-none space-y-0.5 p-0 text-[11.5px] text-ink2" data-testid="kesimpulan-stok">
              {k.belumDiketahui && <li>• {k.belumDiketahui}.</li>}
              {k.minus && <li>• {k.minus}.</li>}
              <li>• {k.reorder}.</li>
            </ul>
            <p className="m-0 mt-1.5 flex items-start gap-1 text-[11px] text-ink3" data-testid="catatan-sumber"><Info size={12} className="mt-px shrink-0" aria-hidden /> {data.catatan}</p>
          </details>
        )}

        <div role="tablist" aria-label="Saring kategori bahan" className="flex gap-1 overflow-x-auto border-b border-line pb-2 md:flex-wrap">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={cn("shrink-0 whitespace-nowrap rounded-chip px-3 py-1.5 text-[12.5px] font-semibold transition-colors max-sm:min-h-11", tab === t.key ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint hover:text-ink2")}>{t.label}</button>
          ))}
          {terfilter && <span className="ml-auto shrink-0 self-center whitespace-nowrap pl-2 text-[11.5px] text-ink3" data-testid="jumlah-tampil">{terfilter.length} bahan tampil</span>}
        </div>

        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        <Card className="overflow-hidden p-0">
          {kosong ? (
            <EmptyState icon={Package} title="Tidak ada bahan yang cocok" description="Ubah kata kunci, kategori, atau saringan keadaan stok." />
          ) : (
            <>
              <TableWrap className="hidden md:block">
                <Table>
                  <THead><TR><TH>Bahan</TH><TH numeric>Saldo</TH><TH numeric>Tersedia</TH><TH>Satuan</TH><TH numeric>Batas minimum</TH><TH title="Riwayat penerimaan, bukan lokasi stok saat ini">Riwayat penerimaan</TH><TH>Keadaan</TH></TR></THead>
                  <TBody>
                    {loading && <TableSkeletonRows rows={8} cols={7} />}
                    {!loading && terfilter?.map((r) => (
                      <TR key={r.materialId} clickable onClick={() => setSelected(stok?.get(r.materialId) ?? null)} data-testid="baris-stok" data-kode={r.kode} title={r.sumberAngka?.teks ?? "Belum ada catatan pergerakan stok untuk bahan ini"}>
                        <TD className="min-w-[220px]"><div className="font-semibold text-ink" data-testid="nama-bahan">{r.nama}</div><div className="text-[11px] text-ink3 [overflow-wrap:anywhere]">{r.kode}{r.kategori ? ` · ${CATEGORY_REAL[r.kategori]?.label}` : ""}</div></TD>
                        <TD numeric data-testid="sel-saldo" data-jenis={tampilSaldo(r).jenis} title={tampilSaldo(r).keterangan}><SaldoSel r={r} /></TD>
                        <TD numeric className="text-ink2">{r.tersedia === null ? "—" : r.tersedia}</TD>
                        <TD className="text-ink2">{String(r.satuan ?? "").toLowerCase()}</TD>
                        <TD numeric className="text-ink3" data-testid="sel-minimum">{teksBatasMinimum(r)}</TD>
                        <TD className="whitespace-nowrap text-ink2" data-testid="sel-riwayat-lokasi">{riwayatLokasi(r) ? <span title="Dari riwayat penerimaan. Sistem tidak menyimpan saldo per lokasi, jadi ini bukan lokasi stok saat ini."><MapPin size={11} className="mr-0.5 inline text-ink3" aria-hidden />{riwayatLokasi(r).teks}</span> : <span className="text-ink3">tidak ada riwayat</span>}</TD>
                        <TD className="min-w-[140px]"><Badge variant={warnaKeadaan(r.keadaan)} className="h-auto whitespace-normal text-left leading-tight">{r.keadaanLabel}</Badge></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
              <ul className="m-0 list-none divide-y divide-line p-0 md:hidden">
                {!loading && terfilter?.map((r) => (
                  <li key={r.materialId}>
                    <button type="button" onClick={() => setSelected(stok?.get(r.materialId) ?? null)} data-testid="baris-stok" data-kode={r.kode}
                      className="w-full px-4 py-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset max-sm:min-h-11">
                      <div className="text-[12.5px] font-semibold text-ink [overflow-wrap:anywhere]">{r.kode}</div>
                      <div className="mt-0.5 text-[13px] text-ink">{r.nama}</div>
                      <div className="mt-1"><Badge variant={warnaKeadaan(r.keadaan)} className="h-auto whitespace-normal text-left leading-tight">{r.keadaanLabel}</Badge></div>
                      <div className="mt-1 text-[11.5px] text-ink2">Saldo <SaldoSel r={r} inline /> · minimum {teksBatasMinimum(r)}</div>
                      <div className="mt-0.5 text-[11px] text-ink3">{r.sumberAngka?.teks ?? "Belum ada catatan pergerakan stok"}</div>
                      {riwayatLokasi(r) && <div className="mt-0.5 text-[11px] text-ink3" data-testid="riwayat-lokasi">{riwayatLokasi(r).teks} — riwayat, bukan lokasi stok saat ini</div>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </PageBody>
      <ItemDetailDrawer item={selected} onClose={() => setSelected(null)} onEdit={(it) => { setSelected(null); setEditing(it); setFormOpen(true); }} onChanged={load} />
      <ItemFormModal open={formOpen} item={editing} onClose={() => { setFormOpen(false); setEditing(null); }} onSaved={load} />
    </PageContainer>
  );
}
