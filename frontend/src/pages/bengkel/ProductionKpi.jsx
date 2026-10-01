import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Card } from "@/components/ui/card.jsx";
import { UnitOverviewDrawer } from "@/features/production/UnitOverviewDrawer.jsx";
import { CoverageBar, DrillModal, ExportButtons, FilterBar, MetricCard, OffNotice, ReportTable, TrendChart } from "@/features/production/ReportParts.jsx";
import {
  EXPORTABLE, emptyFilters, formatCell, formatMinutes, groupMetrics, offMessage, reportQuery, tabsFor,
} from "@/features/production/reporting.js";
import { makeRange, toApiParams } from "@/lib/dateRange.js";

// P11 — KPI Produksi & Gudang. BACA-SAJA: semua angka dari /api/production-v2/reports (satu kontrak metrik kanonis). Layar, drill-down, dan
// Excel/PDF memakai dokumen & query yang sama. Hanya Produksi V2 dalam cohort; V1 tidak dicampur.
const WAREHOUSE_LISTS = [
  ["requested", "Permintaan bahan"], ["openIssues", "Permintaan menunggu"], ["overSla", "Melewati SLA"], ["returnsPending", "Retur pending"], ["returnsPartial", "Retur parsial"],
  ["returnsDone", "Retur selesai"], ["shortages", "Kekurangan bahan"], ["fgWaiting", "Barang jadi menunggu"], ["waste", "Unit dengan waste"],
];
const DEFAULT_TAB = "ringkasan";

export default function ProductionKpi({ defaultTab = DEFAULT_TAB }) {
  const [params, setParams] = useSearchParams();
  const [meta, setMeta] = useState(null);
  const [metaErr, setMetaErr] = useState("");
  // Periode = kalender WIB lewat DateRangePicker standar app (satu skema tanggal di seluruh CRM); default 30 hari terakhir.
  const [range, setRange] = useState(() => makeRange("last_30_days"));
  const period = useMemo(() => toApiParams(range), [range]);
  const [filters, setFilters] = useState(emptyFilters);
  const [granularity, setGranularity] = useState("day");
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [drill, setDrill] = useState(null); // { title, load, exportExtra }
  const [unitId, setUnitId] = useState(null);
  const seq = useRef(0);

  useEffect(() => { api.getProductionReportMeta().then(setMeta).catch((e) => setMetaErr(e.message)); }, []);

  const tabs = useMemo(() => tabsFor(meta?.capabilities), [meta]);
  const wanted = params.get("tab") || defaultTab;
  const tab = tabs.find((t) => t.key === wanted) || tabs[0] || null;
  const setTab = (key) => setParams((p) => { const n = new URLSearchParams(p); n.set("tab", key); return n; }, { replace: true });

  const qs = useMemo(() => reportQuery(period, filters, tab?.key === "ringkasan" ? { granularity } : {}), [period, filters, granularity, tab?.key]);
  const baseQs = useMemo(() => reportQuery(period, filters), [period, filters]);

  const load = useCallback(() => {
    if (!tab) return;
    const mine = ++seq.current;
    setLoading(true); setError("");
    api.getProductionReport(tab.kind === "mine" ? "my-summary" : tab.kind, qs)
      .then((d) => { if (mine === seq.current) setDoc(d); })
      .catch((e) => { if (mine === seq.current) { setError(e.message); setDoc(null); } })
      .finally(() => { if (mine === seq.current) setLoading(false); });
  }, [tab, qs]);
  useEffect(() => { load(); }, [load]);

  const openList = (title, path, exportExtra) => setDrill({ title, load: () => api.getProductionReportList(path, baseQs), exportExtra });
  const openMetric = (m) => setDrill({
    title: m.label, load: () => api.getProductionReportDrill(m.key, baseQs), exportExtra: { report: "drill", extra: { metric: m.key } },
  });
  const openWarehouseList = (key, label) => setDrill({
    title: `Gudang — ${label}`,
    load: async () => {
      const r = await api.getProductionReportList(`warehouse/units/${key}`, baseQs);
      return { tables: [{ key: "units", title: label, columns: [{ key: "unitCode", header: "Kode Unit", tipe: "teks" }, { key: "orderNumber", header: "Resi/Order", tipe: "teks" }, { key: "station", header: "Meja", tipe: "teks" }], rows: r.rows, empty: "Tidak ada unit pada daftar ini." }] };
    },
  });

  const off = offMessage(doc) || offMessage(meta);
  const showFilters = tab && tab.kind !== "mine";
  const filterShow = tab?.key === "gudang" ? ["station", "status", "priority"] : undefined;
  const exportKind = tab ? EXPORTABLE[tab.key] : null;
  const readOnlyHint = meta?.capabilities && !meta.capabilities.summary && meta.capabilities.warehouse ? "Tampilan Gudang: hanya indikator Gudang untuk Produksi." : null;

  return (
    <PageContainer fluid>
      <PageHeader
        title="KPI Produksi & Gudang"
        subtitle={readOnlyHint || "Satu kontrak metrik untuk dashboard, daftar unit, dan export. Hanya Produksi V2 dalam cohort."}
        actions={<Button variant="ghost" size="sm" onClick={load} disabled={loading || !tab}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button>}
      />
      <PageBody>
        {metaErr && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red" role="alert">{metaErr}</div>}
        {tabs.length > 1 && (
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-inset/80 p-1 [scrollbar-width:none]" role="tablist" aria-label="Bagian laporan" data-testid="kpi-tabs">
            {tabs.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab?.key === t.key} onClick={() => setTab(t.key)} data-testid={`tab-${t.key}`}
                className={`shrink-0 cursor-pointer rounded-xl border-0 px-3.5 py-1.5 text-sm font-medium transition-all ${tab?.key === t.key ? "bg-surface text-accent shadow-card" : "bg-transparent text-ink2 hover:text-accent"}`}>{t.label}</button>
            ))}
          </div>
        )}

        {showFilters && !off && (
          <FilterBar meta={meta} range={range} onRange={setRange} filters={filters} onFilters={setFilters} onReset={() => setFilters(emptyFilters())}
            granularity={granularity} onGranularity={tab?.key === "ringkasan" ? setGranularity : undefined} show={filterShow} />
        )}

        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red" role="alert">{error}</div>}
        {off && <OffNotice message={off} />}
        {loading && !doc && <p className="m-0 text-[12.5px] text-ink3">Memuat laporan…</p>}

        {doc && !off && tab?.kind !== "mine" && (
          <div className={`min-w-0 space-y-4 ${loading ? "opacity-60" : ""}`} data-testid={`panel-${tab.key}`}>
            <CoverageBar doc={doc} />
            {tab.key === "ringkasan" && <SummaryPanel doc={doc} granularity={granularity} onMetric={openMetric} onUnit={setUnitId} />}
            {tab.key === "meja" && <StationsPanel doc={doc} onList={openList} onUnit={setUnitId} />}
            {tab.key === "pic" && <OperatorsPanel doc={doc} onList={openList} />}
            {tab.key === "gudang" && <WarehousePanel doc={doc} onList={openWarehouseList} />}
            {tab.key === "laporan" && <UnitsPanel doc={doc} onUnit={setUnitId} />}
            {exportKind && <Card className="p-3"><ExportButtons report={exportKind} period={period} filters={filters} extra={tab.key === "ringkasan" ? { granularity } : {}} label={`Unduh laporan ${tab.label}`} /></Card>}
            <Definitions doc={doc} />
          </div>
        )}
        {doc && tab?.kind === "mine" && <MyPanel doc={doc} />}
      </PageBody>

      {drill && <DrillModal title={drill.title} load={drill.load} onClose={() => setDrill(null)} onUnit={(id) => { setDrill(null); setUnitId(id); }} period={period} filters={filters} exportExtra={drill.exportExtra} />}
      {unitId && <UnitOverviewDrawer unitId={unitId} onClose={() => setUnitId(null)} />}
    </PageContainer>
  );
}

// ---------------------------------------------------------------- panel ---------------------------------------------------------------------
function SummaryPanel({ doc, granularity, onMetric, onUnit }) {
  const groups = groupMetrics(doc.metrics);
  const table = (key) => doc.tables.find((t) => t.key === key);
  return (
    <>
      {groups.map((g) => (
        <section key={g.group} className="min-w-0" data-testid={`group-${g.group}`}>
          <h3 className="m-0 mb-2 text-[13.5px] font-bold text-ink">{g.group}</h3>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
            {g.items.map((m) => <MetricCard key={m.key} metric={m} onOpen={onMetric} />)}
          </div>
        </section>
      ))}
      <TrendChart table={table("trend")} granularity={granularity} />
      <ReportTable table={table("trend")} />
      <ReportTable table={table("attention")} onUnit={onUnit} />
      <ReportTable table={table("materials")} />
    </>
  );
}

function StationsPanel({ doc, onList, onUnit }) {
  const stationTable = doc.tables.find((t) => t.key === "stations");
  const onCell = (row, col, click) => {
    if (!["scheduled", "finished"].includes(col.key) || !row.code) return false;
    if (click) onList(`${row.label} — ${col.key === "scheduled" ? "unit terjadwal" : "unit selesai"}`, `stations/${row.code}/units/${col.key}`, null);
    return true;
  };
  const withCode = { ...stationTable, rows: stationTable.rows.map((r, i) => ({ ...r, code: doc.stations[i]?.code })) };
  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="station-cards">
        {doc.stations.map((s) => (
          <Card key={s.code} className="min-w-0 p-3" data-testid={`station-${s.code}`}>
            <div className="flex items-center justify-between gap-2"><h3 className="m-0 text-[14px] font-bold text-ink">{s.label}</h3><span className="text-[11px] text-ink3">kapasitas {s.capacityPerDay}/hari</span></div>
            <div className="mt-2" aria-label={`Utilisasi ${s.utilizationPct ?? "tidak tersedia"}%`}>
              <div className="flex items-baseline justify-between text-[11.5px] text-ink3"><span>Utilisasi</span><b className="text-[15px] tabular-nums text-ink">{s.utilizationPct == null ? "—" : `${formatCell(s.utilizationPct, "angka")}%`}</b></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-inset"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, s.utilizationPct || 0)}%` }} /></div>
            </div>
            <dl className="m-0 mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
              <Stat label="Masuk (terjadwal)" value={s.scheduled} onClick={s.scheduled ? () => onList(`${s.label} — unit terjadwal`, `stations/${s.code}/units/scheduled`) : null} />
              <Stat label="Selesai" value={s.finished} onClick={s.finished ? () => onList(`${s.label} — unit selesai`, `stations/${s.code}/units/finished`) : null} />
              <Stat label="Rata-rata durasi" value={s.avgDurationMin == null ? "Data belum cukup" : formatMinutes(s.avgDurationMin)} muted={s.avgDurationMin == null} />
              <Stat label="Terlambat" value={`${s.lateFinished} selesai · ${s.lateOpen} berjalan`} />
              <Stat label="Aktif / jeda / blokir" value={`${formatMinutes(s.activeMin)} / ${formatMinutes(s.pauseMin)} / ${formatMinutes(s.blockedMin)}`} />
              <Stat label="Urutan manual" value={s.manualOrderPct == null ? "—" : `${s.manualOrderUnits} (${formatCell(s.manualOrderPct, "angka")}%)`} />
            </dl>
            <p className="m-0 mt-2 text-[11.5px] text-ink3" data-testid={`bottleneck-${s.code}`}>Bottleneck: {s.bottleneck ? `${s.bottleneck.label} (${formatMinutes(s.bottleneck.avgMin)}, n=${s.bottleneck.n})` : "Data belum cukup"}</p>
          </Card>
        ))}
      </div>
      <ReportTable table={withCode} onCell={onCell} onUnit={onUnit} />
      <ReportTable table={doc.tables.find((t) => t.key === "stages")} />
    </>
  );
}

function OperatorsPanel({ doc, onList }) {
  const t = doc.tables.find((x) => x.key === "operators");
  const rows = t.rows.map((r) => ({ ...r, roleKey: r.role === "PIC Meja" ? "MEJA" : "CORNER" }));
  const onCell = (row, col, click) => {
    if (!["assigned", "finished"].includes(col.key) || !row.id) return false;
    if (click) onList(`${row.name} — ${col.key === "assigned" ? "unit ditugaskan" : "unit selesai"}`, `operators/${row.roleKey}:${row.id}/units/${col.key}`, null);
    return true;
  };
  return (
    <>
      <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[12px] text-ink2" data-testid="pic-note">Daftar diurutkan menurut nama, bukan peringkat: perbandingan antar PIC hanya bermakna dengan volume (n) dan periode yang sama. Persentase muncul bila n ≥ {doc.minSample}.</p>
      <ReportTable table={{ ...t, rows }} onCell={onCell} />
      <ReportTable table={doc.tables.find((x) => x.key === "operatorStages")} />
    </>
  );
}

function WarehousePanel({ doc, onList }) {
  return (
    <>
      <div className="flex flex-wrap gap-1.5" data-testid="warehouse-lists" role="group" aria-label="Daftar unit Gudang">
        {WAREHOUSE_LISTS.map(([key, label]) => <Button key={key} size="sm" variant="secondary" className="min-h-[36px]" onClick={() => onList(key, label)}>{label}</Button>)}
      </div>
      {doc.tables.map((t) => <ReportTable key={t.key} table={t} />)}
    </>
  );
}

function UnitsPanel({ doc, onUnit }) {
  return <ReportTable table={doc.tables[0]} onUnit={onUnit} />;
}

function Definitions({ doc }) {
  if (!doc.definitions?.length) return null;
  return (
    <details className="min-w-0 rounded-card bg-surface p-3" data-testid="definitions">
      <summary className="cursor-pointer text-[13px] font-bold text-ink">Definisi metrik ({doc.definitions.length})</summary>
      <dl className="m-0 mt-2 space-y-2">
        {doc.definitions.map((d) => (
          <div key={d.key} className="min-w-0">
            <dt className="m-0 text-[12.5px] font-semibold text-ink">{d.label}</dt>
            <dd className="m-0 break-words text-[12px] text-ink2">{d.formula} <span className="text-ink3">[Dasar: {d.basis}]{d.note ? ` — ${d.note}` : ""}</span></dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function MyPanel({ doc }) {
  const p = doc.pekerjaan;
  const cards = [["Ditugaskan", p.ditugaskan], ["Selesai", p.selesai], ["Berjalan", p.berjalan], ["Terlambat", p.terlambat], ["Pengiriman dokumentasi", doc.dokumentasi.pengirimanDokumentasi], ["Unit didokumentasi", doc.dokumentasi.unitDidokumentasi], ["Inspeksi QC", doc.qc.inspeksiDilakukan]];
  return (
    <div className="space-y-4" data-testid="panel-saya">
      <p className="m-0 text-[12px] text-ink3">{doc.scope} · periode {doc.period.from} s/d {doc.period.to} ({doc.timezone}). Hanya pekerjaan Anda sendiri; tanpa harga/pembayaran.</p>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {cards.map(([label, value]) => <div key={label} className="rounded-card bg-surface p-3"><p className="m-0 text-[11.5px] text-ink3">{label}</p><p className="m-0 mt-1 text-[22px] font-bold tabular-nums text-ink">{value}</p></div>)}
      </div>
      {doc.unit?.length > 0 && (
        <Card className="p-3"><h3 className="m-0 mb-2 text-[13.5px] font-bold text-ink">Unit berjalan</h3>
          <ul className="m-0 list-none divide-y divide-line p-0">{doc.unit.map((u) => <li key={u.runId} className="flex items-center justify-between gap-2 py-2 text-[13px]"><b>{u.unitCode}</b><span className="text-ink3">{u.status}</span></li>)}</ul>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, onClick, muted }) {
  return (
    <div className="min-w-0">
      <dt className="m-0 text-[10.5px] text-ink3">{label}</dt>
      <dd className={`m-0 break-words font-semibold tabular-nums ${muted ? "text-ink3" : "text-ink"}`}>
        {onClick ? <button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-semibold tabular-nums text-accent underline" onClick={onClick} title="Lihat daftar unit">{value}</button> : value}
      </dd>
    </div>
  );
}
