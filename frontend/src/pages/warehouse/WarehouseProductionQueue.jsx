import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Clock, Package, PackageCheck, PackageX, RefreshCw, Truck, Undo2 } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { formatMinutes, friendlyError } from "@/features/production/experience.js";

// Antrean Gudang untuk Produksi V2 (P8D) — satu layar untuk yang perlu ditangani hari ini: unit masuk dari pickup, bahan yang harus
// disiapkan/diserahkan (dari Planned BOM + reservasi P3/P4), laporan "Menunggu Bahan Baku" dari meja, dan barang jadi dari Produksi.
// Stok TIDAK berkurang di layar ini: penyerahan bahan tetap lewat Pengambilan Bahan Produksi (Material Issue P4); saldo negatif tetap ditolak.
const NEED_STATUS = {
  MENUNGGU_DISIAPKAN: { label: "Menunggu disiapkan", variant: "neutral" },
  MENUNGGU_PERMINTAAN: { label: "Direservasi — menunggu permintaan produksi", variant: "neutral" },
  SIAP_DIAMBIL: { label: "Siap diserahkan", variant: "orange" },
  SUDAH_DISERAHKAN: { label: "Sudah diserahkan", variant: "green" },
  KEKURANGAN: { label: "Kekurangan", variant: "red" },
};
const TABS = [["all", "Semua"], ["inbound", "Unit Masuk"], ["material", "Bahan"], ["shortage", "Kekurangan"], ["return", "Retur Sisa"], ["finished", "Barang Jadi"]];

function ActionCard({ icon: Icon, tone = "accent", title, subtitle, meta, badge, children, action }) {
  const toneCls = { accent: "bg-accentbg text-accent", red: "bg-redbg text-red", orange: "bg-orangebg text-orange", green: "bg-greenbg text-green" }[tone];
  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-card ${toneCls}`}><Icon size={22} aria-hidden /></span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2"><p className="text-[15px] font-bold text-ink">{title}</p>{badge}</div>
        <p className="text-[13px] text-ink2">{subtitle}</p>
        {meta && <p className="text-[12px] text-ink3">{meta}</p>}
        {children}
      </div>
      {action && <div className="flex shrink-0 flex-col items-stretch gap-1 sm:w-48">{action}</div>}
    </Card>
  );
}

// Retur sisa bahan: WAJIB diterima Gudang sebelum barang jadi unit itu bisa diterima. Stok bertambah (RETURN tertaut unit) saat diterima.
// Diterima kurang dari sisa -> catatan wajib; selisih dicatat Gudang sebagai waste manual (tidak dibukukan otomatis).
function ReturnCard({ r, busy, onReceive }) {
  const [qty, setQty] = useState(String(r.qty));
  const [note, setNote] = useState("");
  const short = Number(qty) > 0 && Number(qty) < r.qty - 1e-6;
  const invalid = !(Number(qty) > 0) || Number(qty) > r.qty + 1e-6 || (short && !note.trim());
  return (
    <ActionCard icon={Undo2} tone="orange" title={`Terima retur sisa bahan • ${r.unit.unitCode}`} subtitle={`${r.material.name} (${r.material.code})`}
      meta={`Sisa dari produksi: ${r.qty} ${String(r.material.unit || "").toLowerCase()}`}
      badge={<Badge variant="orange">Menunggu diterima Gudang</Badge>}
      action={<Button data-testid="receive-return" onClick={() => onReceive(r, { qty: Number(qty), note })} disabled={busy || invalid}>{busy ? "Menyimpan…" : "Terima Retur"}</Button>}>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-ink2">
        <label className="flex items-center gap-1">Jumlah diterima
          <input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Jumlah diterima" className="w-24 rounded-btn border border-line bg-surface px-2 py-1 text-[13px] text-ink" />
        </label>
        {short && <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan selisih (wajib)" aria-label="Catatan selisih" className="min-w-[12rem] flex-1 rounded-btn border border-line bg-surface px-2 py-1 text-[13px] text-ink" />}
      </div>
      <p className="text-[11px] text-ink3">Barang jadi unit ini baru bisa diterima setelah retur diterima.</p>
    </ActionCard>
  );
}

export default function WarehouseProductionQueue() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    return api.getProductionV2WarehouseQueue().then((d) => { setData(d); setError(""); }).catch((e) => setError(friendlyError(e))).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
    const tick = () => { if (document.visibilityState === "visible") load(); };
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [load]);

  async function resolve(s) {
    setBusy(s.id); setError("");
    try { await api.resolveProductionV2Shortage(s.id, { expectedRevision: s.revision, note: "Bahan diserahkan ke meja" }); setNotice(`Kekurangan bahan ${s.unitCode} ditandai selesai — produksi bisa melanjutkan.`); load(); }
    catch (e) { setError(friendlyError(e)); } finally { setBusy(null); }
  }

  async function receiveReturn(r, { qty, note }) {
    setBusy(r.id); setError("");
    try { await api.receiveProductionV2MaterialReturn(r.id, { expectedRevision: r.revision, qty, note: note || undefined }); setNotice(`Retur ${r.material.code} dari ${r.unit.unitCode} diterima — stok bertambah.`); load(); }
    catch (e) { setError(friendlyError(e)); } finally { setBusy(null); }
  }

  const show = (k) => tab === "all" || tab === k;
  const needs = (data?.materialNeeds || []).filter((m) => m.status !== "SUDAH_DISERAHKAN" || tab === "material");
  const empty = data && !data.inbound?.length && !needs.length && !data.shortages?.length && !data.finishedGoods?.length && !data.returns?.length;

  return (
    <PageContainer>
      <PageHeader title="Antrean Gudang" subtitle="Yang perlu ditangani untuk Produksi hari ini"
        actions={<Button variant="neutral" size="sm" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button>} />
      <PageBody>
        {notice && <div role="status" className="rounded-btn bg-greenbg px-3 py-2.5 text-[12.5px] text-green">{notice}</div>}
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}
        {data?.readerMode === "OFF" ? (
          <Card className="p-0"><EmptyState icon={Package} title="Produksi V2 belum aktif" description="Antrean ini terisi setelah Production V2 diaktifkan untuk unit terkait." /></Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {[[Truck, "unit masuk", data?.kpi?.inbound], [Package, "permintaan bahan", data?.kpi?.materialRequests], [PackageX, "kekurangan bahan", data?.kpi?.shortages], [Undo2, "retur sisa", data?.kpi?.returns], [PackageCheck, "barang jadi", data?.kpi?.finishedGoods]].map(([Icon, label, value]) => (
                <Card key={label} className="flex items-center gap-3 p-4">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-btn ${label === "kekurangan bahan" && value ? "bg-redbg text-red" : "bg-accentbg text-accent"}`}><Icon size={19} aria-hidden /></span>
                  <div><p className="text-[20px] font-bold leading-tight text-ink tabular-nums">{value ?? 0}</p><p className="text-[12px] text-ink3">{label}</p></div>
                </Card>
              ))}
            </div>
            <div role="tablist" aria-label="Saring antrean" className="flex flex-wrap gap-1 border-b border-line">
              {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${tab === k ? "border-accent text-accent" : "border-transparent text-ink3 hover:text-ink2"}`}>{l}</button>)}
            </div>
            {loading && !data ? <div className="space-y-3">{[1, 2, 3].map((n) => <Card key={n} className="h-28 animate-pulse bg-inset" />)}</div> : empty ? (
              <Card className="p-0"><EmptyState icon={CheckCircle2} title="Tidak ada pekerjaan Gudang untuk Produksi" description="Unit masuk, permintaan bahan, dan barang jadi akan muncul di sini." /></Card>
            ) : (
              <div className="space-y-3">
                {show("shortage") && data.shortages.map((s) => (
                  <ActionCard key={s.id} icon={PackageX} tone="red" title={`Menunggu bahan • ${s.stationLabel}`} subtitle={`${s.unitCode} • ${s.customerName || "—"}`}
                    meta={<span className="flex items-center gap-1"><Clock size={12} aria-hidden /> menunggu {formatMinutes(s.waitingMinutes)}{s.note ? ` — ${s.note}` : ""}</span>}
                    badge={<Badge variant="red"><AlertTriangle size={11} aria-hidden /> Produksi berhenti</Badge>}
                    action={<>
                      <Button onClick={() => resolve(s)} disabled={busy === s.id}>{busy === s.id ? "Menyimpan…" : "Tandai Sudah Diserahkan"}</Button>
                      <p className="text-[11px] text-ink3">Serahkan lewat Pengambilan Bahan bila bahan dari rencana; stok berkurang saat diserahkan.</p>
                    </>}>
                    <ul className="m-0 list-none p-0 mt-1 rounded-btn bg-inset px-3 py-2 text-[12.5px] text-ink2">{s.items.map((i) => <li key={i.materialId} className="flex justify-between gap-2"><span>{i.name} <span className="text-ink3">({i.code})</span></span><span>{i.qty ?? "—"} {String(i.uom || "").toLowerCase()}</span></li>)}</ul>
                  </ActionCard>
                ))}
                {show("inbound") && data.inbound.map((h) => (
                  <ActionCard key={h.handoffId} icon={Truck} title="Terima unit dari pickup" subtitle={`${h.unitCode} • ${h.customerName || "—"}`} meta="Lokasi penerimaan wajib dipilih"
                    badge={<Badge variant="red">Menunggu penerimaan</Badge>}
                    action={<Button asChild><Link to="/warehouse/unit-custody">Periksa & Terima</Link></Button>} />
                ))}
                {show("material") && needs.map((m) => (
                  <ActionCard key={m.planId} icon={Package} tone={m.status === "KEKURANGAN" ? "red" : m.status === "SIAP_DIAMBIL" ? "orange" : m.status === "SUDAH_DISERAHKAN" ? "green" : "accent"}
                    title={`Siapkan bahan • ${m.stationLabel}`} subtitle={`${m.unitCode} • ${m.customerName || "—"}`} meta={`Untuk: Produksi${m.operatorName ? ` (${m.operatorName})` : ""}${m.productionDate ? ` · ${m.productionDate}` : ""}`}
                    badge={<Badge variant={NEED_STATUS[m.status]?.variant}>{NEED_STATUS[m.status]?.label}</Badge>}
                    action={m.status === "SIAP_DIAMBIL" ? <><Button asChild><Link to="/warehouse/material-pickup">Serahkan Bahan</Link></Button><p className="text-[11px] text-ink3">Stok berkurang saat diserahkan</p></> : null}>
                    <ul className="m-0 list-none p-0 mt-1 rounded-btn bg-inset px-3 py-2 text-[12.5px] text-ink2">{m.lines.map((l) => <li key={l.materialId} className="flex justify-between gap-2"><span>{l.name}{l.supplemental ? " (rework)" : ""}</span><span>{l.qty} {String(l.uom || "").toLowerCase()}</span></li>)}</ul>
                  </ActionCard>
                ))}
                {show("return") && (data.returns || []).map((r) => <ReturnCard key={r.id} r={r} busy={busy === r.id} onReceive={receiveReturn} />)}
                {show("finished") && data.finishedGoods.map((h) => (
                  <ActionCard key={h.handoffId} icon={PackageCheck} tone="green" title="Terima barang jadi" subtitle={`${h.unitCode} • ${h.customerName || "—"}`} meta="Siap kirim setelah Gudang menerima"
                    badge={h.returnPending ? <Badge variant="orange">Retur sisa belum diterima</Badge> : <Badge variant="green">QC lulus • Finishing selesai</Badge>}
                    action={h.returnPending ? <p className="text-[11.5px] text-orange">Terima retur sisa bahan (tab Retur Sisa) dulu.</p> : <Button asChild><Link to="/warehouse/finished-goods">Periksa & Simpan</Link></Button>} />
                ))}
              </div>
            )}
          </>
        )}
      </PageBody>
    </PageContainer>
  );
}
