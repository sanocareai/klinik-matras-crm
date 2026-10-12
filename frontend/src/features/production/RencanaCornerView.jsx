import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, Info, RefreshCw, Scissors, UserCog } from "lucide-react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { UnitPhoto } from "@/features/production/UnitCard.jsx";
import { friendlyError } from "@/features/production/experience.js";
import { priorityOf, statusOf } from "@/features/production/productionLabels.js";
import { formatTanggal } from "@/utils/formatDate.js";

// Tampilan Corner di Rencana Produksi (Tahap A baca + Tahap B penetapan PIC). SEMUA keadaan datang dari server (GET /production-v2/corner-board): kelompok, QC, hambatan,
// "siapa yang perlu bertindak", izin pengalihan — frontend hanya memformat. TIDAK ada drag, kapasitas, target, atau urutan Corner (belum ada kontrak server) dan TIDAK ada tombol
// eksekusi tahap: PIC mencatat pekerjaan + bukti di Aplikasi Corner. Klik kartu membuka Unit 360 di drawer yang sama.
const QC_TONE = { LULUS: "green", DIABAIKAN: "orange", TIDAK_DILAKUKAN: "neutral", GAGAL: "red", MENUNGGU: "orange", BELUM: "neutral" };
const GROUP_HINT = {
  MENUNGGU_PRASYARAT: "Meja dan QC belum selesai, atau ada hambatan.",
  SIAP_CORNER: "Gerbang Meja/QC terpenuhi — tinggal dikerjakan PIC Corner.",
  SEDANG_DIKERJAKAN: "PIC Corner sudah memulai (tidak dialihkan diam-diam).",
  SELESAI: "Corner selesai (7 hari terakhir).",
};
const SEVERITY_TONE = { block: "text-red", warn: "text-orange", info: "text-ink3" };

function AssignPic({ item, operators, canAssign, onAssigned, onError }) {
  const current = item.pic.corner?.id || "";
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setValue(item.pic.corner?.id || ""); }, [item.pic.corner?.id, item.plan?.revision]);
  const a = item.assign;
  if (!canAssign) return <span className="text-[12.5px] text-ink">{item.pic.corner?.name || "Belum ditetapkan"}</span>;
  if (!a.allowed) {
    return (
      <span className="block">
        <span className="text-[12.5px] text-ink">{item.pic.corner?.name || "Belum ditetapkan"}</span>
        {a.reason && <span data-testid="corner-assign-locked" data-code={a.code} className="mt-0.5 block text-[11.5px] text-ink3">{a.reason}</span>}
      </span>
    );
  }
  async function submit() {
    if (!value || value === current) return;
    setBusy(true);
    try {
      const r = await api.setProductionV2CornerOperator(item.runId, { operatorId: value, expectedRevision: item.plan.revision });
      onAssigned(r.changed ? `PIC Corner ${item.unit.unitCode}: ${r.cornerOperator.name}${r.previousCornerOperator ? ` (sebelumnya ${r.previousCornerOperator.name})` : ""}.` : "PIC Corner tidak berubah.");
    } catch (e) {
      // Konflik revisi: data terbaru dimuat tanpa menimpa penugasan orang lain; pesan spesifik untuk PIC Corner (bukan teks drag kartu).
      onError(e?.code === "PLAN_REVISION_CONFLICT" ? "Rencana unit ini sudah diubah orang lain — data terbaru sudah dimuat. Periksa PIC Corner dan jadwalnya, lalu ulangi bila masih perlu." : friendlyError(e));
    } finally { setBusy(false); }
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <select aria-label={`PIC Corner ${item.unit.unitCode}`} data-testid="corner-pic-select" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy}
        className="min-h-[40px] min-w-0 max-w-full flex-1 rounded-btn border border-line bg-surface px-2 text-[13px] text-ink">
        <option value="">— pilih PIC Corner —</option>
        {operators.map((o) => <option key={o.id} value={o.id}>{o.name || o.user?.name || o.employeeCode}</option>)}
      </select>
      <Button size="sm" data-mutates data-testid="corner-pic-save" className="min-h-[40px]" disabled={busy || !value || value === current} onClick={submit}>
        <UserCog size={13} aria-hidden /> {busy ? "Menyimpan…" : current ? "Ganti" : "Tetapkan"}
      </Button>
    </span>
  );
}

function CornerCard({ item, operators, canAssign, onOpen, onAssigned, onError }) {
  const pr = priorityOf({ priority: item.priority });
  const st = statusOf({ globalStatus: item.globalStatus });
  const req = item.request;
  return (
    <article data-testid="corner-card" data-unit-code={item.unit.unitCode} data-group={item.group} className="relative min-w-0 overflow-hidden rounded-card bg-surface shadow-sm">
      <button type="button" onClick={() => onOpen(item.unit.id)} aria-label={`Buka Unit 360 ${item.unit.unitCode}`} className="flex w-full min-w-0 items-start gap-3 py-3 pl-4 pr-3 text-left hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <UnitPhoto photoUrl={item.unit.photoUrl} variant="plan" />
        <span className="min-w-0 flex-1 space-y-1.5">
          <span className="block break-words text-[15px] font-bold leading-tight text-ink [overflow-wrap:anywhere]">{item.customer.name || "Pelanggan belum dicatat"}</span>
          <span className="block truncate text-[12.5px] text-ink3">{item.unit.unitCode}{item.customer.orderNumber ? ` · ${item.customer.orderNumber}` : ""}</span>
          <span className="flex flex-wrap items-center gap-1.5">
            {pr.key !== "NORMAL" && <Badge variant={pr.tone}>{pr.label}</Badge>}
            {st.label && <Badge variant={st.tone} data-testid="corner-global-status">{st.label}</Badge>}
            <Badge variant="neutral" data-testid="corner-status-badge">{item.corner.label}</Badge>
            <Badge variant={QC_TONE[item.qc.key] || "neutral"} data-testid="corner-qc">{item.qc.label}</Badge>
          </span>
        </span>
      </button>
      <div className="space-y-2 border-t border-line px-4 py-3 text-[12.5px]">
        <div data-testid="corner-pic" className="flex flex-col gap-1"><span className="text-[11.5px] font-semibold uppercase tracking-wide text-ink3">PIC Corner</span>
          <AssignPic item={item} operators={operators} canAssign={canAssign} onAssigned={onAssigned} onError={onError} />
        </div>
        <p className="m-0 text-ink2"><span className="font-semibold text-ink3">PIC Meja: </span>{item.pic.table?.name || "Belum ditetapkan"}
          {item.plan?.stationLabel && <span className="text-ink3"> · {item.plan.stationLabel}</span>}</p>
        {item.plan?.targetEffective && (
          <p className="m-0 flex flex-wrap items-center gap-1.5 text-ink2" data-testid="corner-target"><CalendarDays size={12} aria-hidden /><span className="font-semibold text-ink3">Target:</span> {formatTanggal(item.plan.targetEffective)}
            {item.plan.targetMissed && <Badge variant="red">Lewat Target</Badge>}</p>
        )}
        <div data-testid="corner-request" className="rounded-btn bg-inset px-2.5 py-2">
          <p className="m-0 flex items-start gap-1.5 font-semibold text-ink2"><Scissors size={13} className="mt-0.5 shrink-0" aria-hidden />
            {req.fabricChangeRequested ? `Ganti kain: ${req.fabricItems.join(", ")}` : "Tidak ada permintaan ganti kain"}</p>
          {req.notes && <p className="m-0 mt-1 whitespace-pre-wrap break-words text-ink2" data-testid="corner-request-notes">{req.notes}</p>}
          {req.needsSalesConfirmation && <p className="m-0 mt-1 font-semibold text-orange" data-testid="corner-sales-confirm">Perlu konfirmasi Sales — {req.missing.join(" dan ")} belum tertulis</p>}
          {!req.fabricChangeRequested && req.hint && <p className="m-0 mt-1 text-[12px] text-ink3">{req.hint}</p>}
        </div>
        {item.blockers.length > 0 && (
          <ul data-testid="corner-blockers" className="m-0 list-none space-y-1 p-0">
            {item.blockers.map((b) => (
              <li key={b.code} data-code={b.code} className={`flex items-start gap-1.5 ${SEVERITY_TONE[b.severity] || "text-ink2"}`}>
                <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
                <span><span className="font-semibold">{b.text}</span><span className="text-ink3"> — {b.actor.label}</span></span>
              </li>
            ))}
          </ul>
        )}
        {item.needsAction && (
          <p data-testid="corner-needs-action" className="m-0 flex items-start gap-1.5 rounded-btn bg-accentbg px-2.5 py-1.5 font-semibold text-accent"><Info size={13} className="mt-0.5 shrink-0" aria-hidden />
            Perlu bertindak: {item.needsAction.actor.label} — {item.needsAction.text}</p>
        )}
      </div>
    </article>
  );
}

export default function RencanaCornerView({ operators = [], canAssign = false, onOpen, onNotice, reloadKey = 0, onChanged = null }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.getProductionV2CornerBoard()); setError(""); } catch (e) { setError(friendlyError(e)); } finally { setLoading(false); }
  }, []);
  // Konflik/galat: muat data TERBARU lebih dulu, lalu tampilkan pesannya (pemuatan sukses tidak boleh menghapus penjelasan konflik).
  const reloadThenShow = useCallback(async (msg) => { await load(); setError(msg); }, [load]);
  useEffect(() => { load(); }, [load, reloadKey]);
  const total = useMemo(() => (data?.groups || []).reduce((n, g) => n + g.count, 0), [data]);
  const handleAssigned = (msg) => { onNotice?.(msg); load(); onChanged?.(); };
  const handleError = (msg) => { reloadThenShow(msg); }; // konflik: muat data terbaru; tidak menimpa penugasan orang lain

  if (data?.readerMode === "OFF") return <EmptyState icon={Scissors} title="Rencana produksi belum diaktifkan" description="Fitur ini sedang dalam tahap uji coba (canary)." />;
  return (
    <section data-testid="corner-view" aria-label="Corner" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 max-w-3xl text-[12.5px] text-ink3">Unit yang memerlukan Corner menurut keputusan Kepala Produksi. Pekerjaan dicatat PIC di Aplikasi Corner — halaman ini hanya memantau dan menetapkan PIC. Unit “Corner tidak diperlukan” tetap di tampilan Meja.</p>
        <Button variant="neutral" size="sm" className="min-h-[40px]" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button>
      </div>
      {error && <div role="alert" data-testid="corner-error" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}
      {!loading && data && total === 0 && !error && <EmptyState icon={Scissors} title="Belum ada unit untuk Corner" description="Unit muncul di sini setelah Kepala Produksi memutuskan Corner diperlukan." />}
      <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="corner-groups">
        {(data?.groups || []).map((g) => (
          <div key={g.key} data-testid={`corner-group-${g.key}`} className="flex min-w-0 flex-col gap-2.5 rounded-card bg-inset p-3">
            <div className="px-1">
              <div className="flex items-center justify-between"><h2 className="m-0 text-[14px] font-bold text-ink">{g.label}</h2>
                <span data-testid={`corner-count-${g.key}`} className="rounded-chip bg-surface px-2 py-0.5 text-[12px] font-bold tabular-nums text-ink2">{g.count}</span></div>
              <p className="m-0 mt-0.5 text-[11.5px] text-ink3">{GROUP_HINT[g.key]}</p>
            </div>
            {g.items.length === 0 && <p className="m-0 rounded-card border-2 border-dashed border-line p-4 text-center text-[12px] text-ink3">Kosong</p>}
            {g.items.map((it) => <CornerCard key={it.runId} item={it} operators={operators} canAssign={canAssign} onOpen={onOpen} onAssigned={handleAssigned} onError={handleError} />)}
          </div>
        ))}
      </div>
      {data && data.notApplicable > 0 && <p className="m-0 text-[12px] text-ink3" data-testid="corner-not-applicable">{data.notApplicable} unit “Corner tidak diperlukan” tetap di tampilan Meja.</p>}
    </section>
  );
}
