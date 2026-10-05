import React, { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { FileSpreadsheet, FileText, Filter, Info, X } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import {
  FILTER_FIELDS, activeFilterCount, coverageChips, formatCell, hasUnit, metricView, reportQuery, trendSeries, trendTick, wibStamp,
} from "./reporting.js";

// ---------------------------------------------------------------- cakupan -------------------------------------------------------------------
export function CoverageBar({ doc }) {
  const chips = coverageChips(doc);
  if (!chips.length) return null;
  return (
    <div className="min-w-0 rounded-card bg-surface p-3" data-testid="coverage-bar">
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {chips.map((c) => (
          <div key={c.key} className="min-w-0">
            <p className="m-0 text-[10.5px] uppercase tracking-wide text-ink3">{c.label}</p>
            <p className="m-0 break-words text-[13px] font-semibold tabular-nums text-ink">{c.value}</p>
          </div>
        ))}
      </div>
      <p className="m-0 mt-2 flex items-start gap-1.5 text-[11.5px] text-ink3">
        <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          Data dibuat {wibStamp(doc.generatedAt)}. Target harian {doc.targetPerHari} unit/hari — {doc.targetNote} Hanya unit yang sudah masuk rencana produksi; unit yang belum berencana tidak termasuk.
          Persentase/rata-rata dengan sampel &lt; {doc.minSample} ditampilkan “Data belum cukup”.
          {doc.filters?.length ? ` Filter aktif: ${doc.filters.join("; ")}.` : " Tanpa filter."}
        </span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- kartu KPI -----------------------------------------------------------------
export function MetricCard({ metric, onOpen }) {
  const v = metricView(metric);
  const clickable = metric.drillCount > 0 || metric.kind !== "count";
  const body = (
    <>
      <p className="m-0 flex items-center gap-1 text-[11.5px] font-medium text-ink3">
        <span className="min-w-0 break-words">{metric.label}</span>
        {metric.snapshot && <span className="shrink-0 rounded-chip bg-inset px-1 text-[9px] font-semibold text-ink3" title="Posisi saat laporan dibuat, bukan menurut periode">Sekarang</span>}
      </p>
      <p className={`m-0 mt-1 break-words font-bold tabular-nums ${v.insufficient ? "text-[13px] text-ink3" : "text-[22px] text-ink"}`} data-testid={`kpi-value-${metric.key}`}>
        {v.text}
        {!v.insufficient && metric.unit === "unit" && <span className="ml-1 text-[11px] font-medium text-ink3">unit</span>}
      </p>
      {v.sub && <p className="m-0 mt-0.5 break-words text-[11px] text-ink3">{v.sub}</p>}
    </>
  );
  const cls = "min-w-0 rounded-card bg-surface p-3 text-left";
  return clickable ? (
    <button type="button" className={`${cls} cursor-pointer border-0 hover:bg-hovertint focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`} onClick={() => onOpen(metric)} data-testid={`kpi-${metric.key}`} aria-label={`${metric.label}: ${v.text}. Lihat daftar unit`}>{body}</button>
  ) : <div className={cls} data-testid={`kpi-${metric.key}`}>{body}</div>;
}

// ---------------------------------------------------------------- tabel generik (layar = dokumen yang sama dengan export) -------------------
export function ReportTable({ table, onUnit, onCell, emptyText }) {
  if (!table) return null;
  const rows = table.rows || [];
  return (
    <section className="min-w-0" data-testid={`table-${table.key}`}>
      <h3 className="m-0 mb-2 text-[13.5px] font-bold text-ink">{table.title}</h3>
      {rows.length === 0 ? (
        <p className="m-0 rounded-card bg-surface px-4 py-5 text-[12.5px] text-ink3">{emptyText || table.empty || "Tidak ada data."}</p>
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <TR>{table.columns.map((c) => <TH key={c.key} numeric={c.tipe === "angka"}>{c.header}</TH>)}</TR>
            </THead>
            <TBody>
              {rows.map((r, i) => (
                <TR key={r.runId ? `${r.runId}-${i}` : i}>
                  {table.columns.map((c) => {
                    const raw = r[c.key];
                    const txt = formatCell(raw, c.tipe);
                    if (c.key === "unitCode" && hasUnit(r) && onUnit) {
                      return <TD key={c.key}><button type="button" className="cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 text-left text-[13px] font-semibold text-accent underline" onClick={() => onUnit(r.unitId)} title="Buka Unit 360">{txt}</button></TD>;
                    }
                    if (onCell && c.tipe === "angka" && typeof raw === "number" && raw > 0 && onCell(r, c)) {
                      return <TD key={c.key} numeric><button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-semibold tabular-nums text-accent underline" onClick={() => onCell(r, c, true)} title="Lihat daftar unit">{txt}</button></TD>;
                    }
                    return <TD key={c.key} numeric={c.tipe === "angka"} title={raw == null || raw === "" ? "Tidak ada data / data belum cukup" : undefined}>{txt}</TD>;
                  })}
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
      {table.note && <p className="m-0 mt-1.5 text-[11.5px] text-ink3">{table.note}</p>}
    </section>
  );
}

// ---------------------------------------------------------------- tren ----------------------------------------------------------------------
export function TrendChart({ table, granularity }) {
  const data = trendSeries(table);
  if (!data.length) return null;
  return (
    <section className="min-w-0" data-testid="trend-chart">
      <h3 className="m-0 mb-2 text-[13.5px] font-bold text-ink">{table.title}</h3>
      <div className="h-[220px] min-w-0 rounded-card bg-surface p-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid strokeDasharray="4 4" stroke="var(--hairline)" vertical={false} />
            <XAxis dataKey="bucket" tickFormatter={(b) => trendTick(b, granularity)} tick={{ fontSize: 11, fill: "var(--ink3)" }} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--ink3)" }} />
            <Tooltip cursor={{ fill: "var(--hairline)" }} contentStyle={{ fontSize: 12, borderRadius: 10 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="terjadwal" name="Terjadwal" fill="var(--hairline)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="masuk" name="Masuk" fill="var(--orange)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="selesai" name="Selesai produksi" fill="var(--accent)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="m-0 mt-1 text-[11.5px] text-ink3">Tabel di bawah memuat angka yang sama dengan grafik.</p>
    </section>
  );
}

// ---------------------------------------------------------------- export --------------------------------------------------------------------
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ExportButtons({ report, extra = {}, period, filters, disabled, label = "Unduh" }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const go = async (format) => {
    setBusy(format); setErr("");
    try {
      const { blob, namaFile } = await api.exportProductionReport(reportQuery(period, filters, { report, format, ...extra }));
      downloadBlob(blob, namaFile);
    } catch (e) { setErr(e.message); } finally { setBusy(""); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="export-buttons">
      <span className="text-[12px] text-ink3">{label}:</span>
      <Button size="sm" variant="secondary" data-mutates disabled={disabled || !!busy} onClick={() => go("xlsx")} className="min-h-[36px]"><FileSpreadsheet size={14} aria-hidden /> {busy === "xlsx" ? "Menyiapkan…" : "Excel"}</Button>
      <Button size="sm" variant="secondary" data-mutates disabled={disabled || !!busy} onClick={() => go("pdf")} className="min-h-[36px]"><FileText size={14} aria-hidden /> {busy === "pdf" ? "Menyiapkan…" : "PDF"}</Button>
      {err && <span className="text-[12px] text-red" role="alert">{err}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- drill-down ----------------------------------------------------------------
// `load()` mengembalikan dokumen drill/daftar; `exportExtra` (opsional) membuat tombol unduh yang identik dengan layar.
export function DrillModal({ title, load, onClose, onUnit, period, filters, exportExtra }) {
  const [doc, setDoc] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    setDoc(null); setErr("");
    load().then((d) => alive && setDoc(d)).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [load]);
  const table = doc?.tables?.[0];
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={title} className="w-[min(1100px,96vw)]">
      <div className="min-w-0 space-y-3" data-testid="drill-modal">
        {err && <div className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red" role="alert">{err}</div>}
        {!doc && !err && <p className="m-0 text-[12.5px] text-ink3">Memuat daftar unit…</p>}
        {doc?.metric && (
          <div className="rounded-btn bg-inset px-3 py-2 text-[12.5px] text-ink2" data-testid="drill-summary">
            {doc.metric.kind === "count" ? <><b>{doc.metric.countedUnits} unit</b> membentuk angka ini.</> : (
              <><b>{doc.metric.sufficient === false ? "Data belum cukup" : `${formatCell(doc.metric.value, "angka")} ${doc.metric.unit}`}</b>{doc.metric.sufficient === false ? ` (${doc.metric.reason})` : ""} · {doc.metric.countedUnits} dari {doc.metric.listedUnits} unit dalam sampel memenuhi.</>
            )} <span className="text-ink3">Rumus: {doc.metric.formula}</span>
          </div>
        )}
        {doc && <ReportTable table={table} onUnit={onUnit} />}
        {doc && exportExtra && <ExportButtons report={exportExtra.report} extra={exportExtra.extra} period={period} filters={filters} label="Unduh daftar ini" />}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- filter --------------------------------------------------------------------
const selectCls = "h-9 min-w-0 w-full rounded-btn border border-line bg-transparent px-2.5 text-[13px] text-ink";
export function FilterBar({ meta, range, onRange, filters, onFilters, granularity, onGranularity, show = FILTER_FIELDS, onReset }) {
  const set = (k) => (e) => onFilters({ ...filters, [k]: e.target.value });
  const field = (label, k, options) => show.includes(k) && (
    <label className="min-w-0 text-[11px] font-medium text-ink3">{label}
      <select className={`${selectCls} mt-0.5`} value={filters[k] ?? ""} onChange={set(k)} data-testid={`filter-${k}`}>
        <option value="">Semua</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
  const n = activeFilterCount(filters);
  const [open, setOpen] = useState(false); // di HP filter dilipat (KPI harus terlihat dulu); di md+ selalu terbuka
  return (
    <div className="min-w-0 space-y-2 rounded-card bg-surface p-3" data-testid="filter-bar">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0" data-testid="period-picker"><DateRangePicker value={range} onChange={onRange} showCompare={false} allowAll={false} /></div>
        {onGranularity && (
          <label className="text-[11px] font-medium text-ink3">Tren per
            <select className={`${selectCls} mt-0.5 w-[7.5rem]`} value={granularity} onChange={(e) => onGranularity(e.target.value)} data-testid="granularity">
              <option value="day">Hari</option><option value="week">Minggu</option><option value="month">Bulan</option>
            </select>
          </label>
        )}
        <button type="button" className="inline-flex min-h-[36px] cursor-pointer items-center gap-1 rounded-btn border-0 bg-inset px-3 text-[12.5px] font-semibold text-ink2 md:hidden" aria-expanded={open} aria-controls="kpi-filter-fields" onClick={() => setOpen((v) => !v)} data-testid="filter-toggle"><Filter size={13} aria-hidden /> {open ? "Tutup filter" : "Filter"}{n ? ` (${n})` : ""}</button>
        <span className="ml-auto flex items-center gap-1 text-[11.5px] text-ink3"><Filter size={13} aria-hidden className="max-md:hidden" /> {n ? <Badge variant="accent">{n} filter</Badge> : "Tanpa filter"}
          {n > 0 && <button type="button" className="ml-1 inline-flex cursor-pointer items-center gap-0.5 border-0 bg-transparent p-0 text-accent underline" onClick={onReset}><X size={12} aria-hidden />Reset</button>}
        </span>
      </div>
      <div id="kpi-filter-fields" className={`${open ? "grid" : "hidden"} grid-cols-2 gap-2 md:grid md:grid-cols-4 xl:grid-cols-8`}>
        {field("Meja", "station", (meta?.stations || []).map((s) => ({ value: s.code, label: s.label })))}
        {field("PIC", "operator", (meta?.operators || []).map((o) => ({ value: o.id, label: o.name })))}
        {field("Tahap", "step", Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `Tahap ${i + 1}` })))}
        {field("Status", "status", (meta?.statuses || []).map((s) => ({ value: s.key, label: s.label })))}
        {field("Prioritas", "priority", (meta?.priorities || []).map((p) => ({ value: p.key, label: p.label })))}
        {field("Layanan", "service", (meta?.services || []).map((s) => ({ value: s.code, label: s.label })))}
        {field("QC", "qc", [{ value: "PASS", label: "Lulus pertama kali" }, { value: "FAIL", label: "Pernah gagal (rework)" }, { value: "BELUM", label: "Belum QC" }])}
        {field("Dokumentasi", "docs", [{ value: "LENGKAP", label: "Lengkap" }, { value: "KURANG", label: "Kurang" }])}
      </div>
    </div>
  );
}

export function OffNotice({ message }) {
  return (
    <div className="rounded-card bg-orangebg px-4 py-4 text-[13px] text-orange" role="status" data-testid="reader-off">
      <b>Laporan belum tersedia.</b> {message}
    </div>
  );
}
