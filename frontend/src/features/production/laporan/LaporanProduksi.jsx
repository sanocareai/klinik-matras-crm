import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FileSpreadsheet, RefreshCw, Target } from "lucide-react";
import { api } from "@/api.js";
import { PageBody, PageContainer, PageHeader } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import TargetPanel from "@/features/production/TargetPanel.jsx";
import { downloadBlob } from "@/features/production/ReportParts.jsx";
import { FILTER_KOSONG, filterUntukTab, paramsDariRange, queryEkspor, queryLaporan, rangeDariParams, tabAktif, tabsUntuk } from "./laporanModel.js";
import { Galat } from "./parts.jsx";
import TabRingkasan from "./TabRingkasan.jsx";
import TabBiaya from "./TabBiaya.jsx";
import TabKinerja from "./TabKinerja.jsx";
import TabBahan from "./TabBahan.jsx";

// LAPORAN PRODUKSI TERPADU — empat tab: Ringkasan · Biaya per Order · Kinerja Produksi · Bahan & Gudang. BACA-SAJA (satu-satunya tulis: Pengaturan target lewat TargetPanel yang sudah ada).
// Periode memakai DateRangePicker + skema tanggal standar app (sama dengan Sales/CRM), dipegang di SINI sehingga bertahan saat pindah tab, tercermin di URL (?preset=&dari=&sampai=), dan dipakai tombol Export.
// Tab aktif dan periode disimpan di state LOKAL (disinkronkan ke URL): di sistem tab dalam-app, perubahan HANYA query tidak menggeser lokasi virtual (lihat catatan P12A).
export default function LaporanProduksi({ defaultTab = "ringkasan", metaAwal = null }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [meta, setMeta] = useState(metaAwal);
  const [metaErr, setMetaErr] = useState("");
  const [range, setRange] = useState(() => rangeDariParams(params));
  const urlTab = params.get("tab") || defaultTab;
  const [tabKey, setTabKey] = useState(urlTab);
  const [filters, setFilters] = useState(FILTER_KOSONG);
  const [page, setPage] = useState(1);
  const [targetBuka, setTargetBuka] = useState(false);
  const [tick, setTick] = useState(0); // muat ulang paksa
  const [ekspor, setEkspor] = useState({ busy: false, err: "" });

  useEffect(() => { if (!metaAwal) api.getLaporanMeta().then(setMeta).catch((e) => setMetaErr(e.message)); }, [metaAwal]);
  useEffect(() => { setTabKey(urlTab); }, [urlTab]);

  const tabs = useMemo(() => tabsUntuk(meta?.capabilities), [meta]);
  const tab = tabAktif(tabKey, tabs);
  const qs = useMemo(() => queryLaporan(range, filterUntukTab(tab?.key, filters)) + (tick ? `&_=${tick}` : ""), [range, filters, tick, tab?.key]);

  const sinkron = useCallback((nextTab, nextRange) => {
    setParams((p) => { const n = paramsDariRange(p, nextRange); n.set("tab", nextTab); return n; }, { replace: true });
  }, [setParams]);
  const pindahTab = (key, ekstra = null) => {
    setTabKey(key); setPage(1);
    if (ekstra) setFilters((f) => ({ ...FILTER_KOSONG, ...f, ...ekstra }));
    sinkron(key, range);
  };
  const ubahRange = (r) => { setRange(r); setPage(1); sinkron(tab?.key ?? tabKey, r); };
  const ubahFilter = (f) => setFilters(f);

  const unduh = async () => {
    setEkspor({ busy: true, err: "" });
    try { const { blob, namaFile } = await api.exportLaporan(queryEkspor(tab.key, range, filters)); downloadBlob(blob, namaFile); setEkspor({ busy: false, err: "" }); }
    catch (e) { setEkspor({ busy: false, err: e.message }); }
  };
  const ke = (key) => (key === "biaya" || key === "ringkasan" || key === "kinerja" || key === "bahan" ? key : "ringkasan");

  const cap = meta?.capabilities;
  return (
    <PageContainer fluid>
      <PageHeader
        title="Laporan Produksi"
        subtitle="Biaya bahan per order, kinerja, dan bahan & gudang — semua unit non-batal, bukan hanya unit dalam rencana."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {cap?.targetWrite && <Button variant="secondary" size="sm" onClick={() => setTargetBuka(true)} data-testid="btn-target"><Target size={14} aria-hidden /> Pengaturan target</Button>}
            <Button size="sm" variant="secondary" disabled={!tab || ekspor.busy} onClick={unduh} data-testid="btn-export" data-mutates><FileSpreadsheet size={14} aria-hidden /> {ekspor.busy ? "Menyiapkan…" : `Export ${tab?.label ?? ""}`}</Button>
            <Button variant="ghost" size="sm" onClick={() => setTick((t) => t + 1)} disabled={!tab} aria-label="Muat ulang"><RefreshCw size={14} aria-hidden /></Button>
          </div>
        )}
      />
      <PageBody>
        <Galat pesan={metaErr || ekspor.err} />
        {tabs.length > 0 && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-inset/80 p-1 [scrollbar-width:none]" role="tablist" aria-label="Bagian laporan" data-testid="kpi-tabs">
              {tabs.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={tab?.key === t.key} onClick={() => pindahTab(t.key)} data-testid={`tab-${t.key}`}
                  className={`shrink-0 cursor-pointer rounded-xl border-0 px-3.5 py-1.5 text-sm font-medium transition-all ${tab?.key === t.key ? "bg-surface text-accent shadow-card" : "bg-transparent text-ink2 hover:text-accent"}`}>{t.label}</button>
              ))}
            </div>
            <div className="min-w-0" data-testid="period-picker"><DateRangePicker value={range} onChange={ubahRange} showCompare={false} allowAll={false} /></div>
          </div>
        )}
        {meta && tabs.length === 0 && <p className="m-0 text-[13px] text-ink3">Anda tidak punya akses ke laporan produksi.</p>}
        {tab?.key === "ringkasan" && <TabRingkasan qs={qs} meta={meta} onPindah={(k, ekstra) => pindahTab(ke(k), ekstra)} />}
        {tab?.key === "biaya" && <TabBiaya qs={qs} meta={meta} filters={filters} onFilters={ubahFilter} page={page} onPage={setPage} />}
        {tab?.key === "kinerja" && <TabKinerja qs={qs} meta={meta} filters={filters} onFilters={ubahFilter} />}
        {tab?.key === "bahan" && <TabBahan qs={qs} meta={meta} filters={filters} onFilters={ubahFilter} page={page} onPage={setPage} onKeOrderProduksi={() => navigate("/bengkel/order-produksi")} />}
      </PageBody>
      {targetBuka && (
        <Modal open onOpenChange={(o) => { if (!o) setTargetBuka(false); }} title="Pengaturan target harian" className="w-[min(720px,96vw)]">
          <TargetPanel canWrite={!!cap?.targetWrite} onChanged={() => setTick((t) => t + 1)} />
        </Modal>
      )}
    </PageContainer>
  );
}
