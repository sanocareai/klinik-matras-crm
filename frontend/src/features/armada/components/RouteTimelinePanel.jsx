// Histori Waktu Rute & Stop (fase 2 Checklist Persiapan Perjalanan, 7 Okt 2026).
// Disusun SERVER (Indonesia + WIB) dari ledger eksekusi yang sudah ada — panel ini hanya menampilkan apa adanya: tidak menghitung durasi sendiri, tidak mengisi
// waktu yang tidak ada ("Tidak tersedia"), tidak membedakan sumber data selain lewat label yang dikirim server. Dipakai web admin (modal di RouteCard),
// Driver Web (DriverJobs), dan sama isinya dengan layar Driver App. Koreksi (hanya bila server menandai canCorrect) bersifat append-only: alasan wajib + tercatat actor-nya.
import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CloudOff, Clock, Loader2, Pencil } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";

const tonePill = "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold";

// datetime-local (waktu setempat perangkat) -> ISO dengan zona; kosong/tidak valid -> null.
export function toIsoOrNull(localValue) {
  if (!localValue) return null;
  const d = new Date(localValue);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function CorrectionForm({ routeId, event, onDone, onCancel }) {
  const [when, setWhen] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function simpan() {
    const iso = toIsoOrNull(when);
    if (!iso) { setErr("Isi waktu yang benar."); return; }
    if (reason.trim().length < 5) { setErr("Alasan koreksi wajib diisi (minimal 5 karakter)."); return; }
    setBusy(true); setErr("");
    try { await api.correctRouteTime(routeId, { eventId: event.id, correctedOccurredAt: iso, reason: reason.trim() }); onDone(); }
    catch (e) { setErr(e.message || "Gagal menyimpan koreksi"); } finally { setBusy(false); }
  }
  return (
    <div className="mt-1.5 space-y-1.5 rounded-md border border-accent/40 p-2" data-testid="timeline-correction-form">
      <p className="text-[11px] text-ink2">Koreksi bersifat tambahan: waktu asli tetap tersimpan dan terlihat di riwayat.</p>
      <input type="datetime-local" aria-label="Waktu yang benar" className="h-8 w-full rounded-md border border-border bg-transparent px-2 text-xs" value={when} onChange={(e) => setWhen(e.target.value)} />
      <textarea aria-label="Alasan koreksi" rows={2} className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs" placeholder="Alasan koreksi (wajib)" value={reason} onChange={(e) => setReason(e.target.value)} />
      {err && <p role="alert" className="text-[11px] text-red">{err}</p>}
      <div className="flex gap-1.5">
        <Button variant="neutral" className="h-7 flex-1 text-[11px]" disabled={busy} onClick={onCancel}>Batal</Button>
        <Button className="h-7 flex-1 text-[11px]" disabled={busy} onClick={simpan} data-testid="timeline-correction-save">{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Simpan koreksi"}</Button>
      </div>
    </div>
  );
}

function EventRow({ routeId, event, canCorrect, onChanged }) {
  const [fixing, setFixing] = useState(false);
  return (
    <li className="py-1.5" data-testid="timeline-event" data-action={event.action}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-ink">{event.label}</p>
          <p className="text-[11px] text-ink2">{event.atText}{event.effectiveSource === "KOREKSI" ? " · dikoreksi" : ""}</p>
          <p className="text-[10.5px] text-ink3">
            {event.actorName ? `oleh ${event.actorName} · ` : ""}{event.sourceLabel}
            {event.receivedText && event.receivedText !== event.atText ? ` · diterima server ${event.receivedText}` : ""}
          </p>
          {event.detail && <p className="text-[11px] text-ink2">Alasan: {event.detail}</p>}
        </div>
        {canCorrect && event.id && !fixing && (
          <button type="button" onClick={() => setFixing(true)} className="shrink-0 rounded-md p-1 text-ink3 hover:text-accent" aria-label={`Koreksi waktu ${event.label}`} data-testid="timeline-correct-btn"><Pencil size={12} /></button>
        )}
      </div>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {event.lateSync && <span className={`${tonePill} bg-amber-100 text-amber-800`} data-testid="badge-late-sync"><CloudOff size={10} /> Sinkron terlambat</span>}
        {event.suspect && <span className={`${tonePill} bg-red-100 text-red-700`} data-testid="badge-clock-suspect"><AlertTriangle size={10} /> Jam perangkat janggal{event.deviceAtText ? ` (perangkat: ${event.deviceAtText})` : ""}</span>}
      </div>
      {event.flags.length > 0 && <p className="mt-0.5 text-[10.5px] text-ink3">{event.flags.join(" · ")}</p>}
      {event.corrections.map((c) => (
        <p key={c.eventId} className="mt-0.5 text-[10.5px] text-ink3" data-testid="timeline-correction-history">
          Koreksi oleh {c.actorName || "—"} ({c.receivedText}): {c.fromText || "—"} → {c.toText}. Alasan: {c.reason}
        </p>
      ))}
      {fixing && <CorrectionForm routeId={routeId} event={event} onCancel={() => setFixing(false)} onDone={() => { setFixing(false); onChanged(); }} />}
    </li>
  );
}

function MissingRow({ item }) {
  return (
    <li className="py-1.5" data-testid="timeline-missing">
      <p className="text-xs font-semibold text-ink">{item.label}</p>
      <p className="text-[11px] italic text-ink3">{item.atText}</p>
    </li>
  );
}

export default function RouteTimelinePanel({ routeId, className = "" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try { setData(await api.getRouteTimeline(routeId)); } catch (e) { setError(e.message || "Gagal memuat histori waktu"); }
  }, [routeId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <p role="alert" className={`text-xs text-red ${className}`}>{error}</p>;
  if (!data) return <div className={`flex items-center gap-2 text-xs text-ink3 ${className}`}><Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat histori waktu…</div>;
  return (
    <div className={`space-y-3 ${className}`} data-testid="route-timeline">
      <section aria-label="Waktu rute">
        <h4 className="mb-1 flex items-center gap-1.5 text-xs font-bold text-ink"><Clock size={13} /> Rute {data.route.code || ""}</h4>
        <ul className="divide-y divide-border rounded-lg border border-border px-2.5">
          {data.routeEvents.map((e) => <EventRow key={e.id || e.action} routeId={routeId} event={e} canCorrect={data.canCorrect} onChanged={load} />)}
          {data.routeMissing.map((m) => <MissingRow key={m.action} item={m} />)}
          {data.routeEvents.length === 0 && data.routeMissing.length === 0 && <li className="py-1.5 text-[11px] text-ink3">Rute belum berangkat.</li>}
        </ul>
        {data.routeDurationText && <p className="mt-1 text-[11px] text-ink2" data-testid="route-duration">Durasi rute: {data.routeDurationText}</p>}
        {data.routeDurationNote && <p className="mt-1 text-[11px] text-ink3">{data.routeDurationNote}</p>}
      </section>
      {data.stops.map((s) => (
        <section key={s.jobId} aria-label={`Stop ${s.sequence ?? ""}`} data-testid="timeline-stop">
          <h4 className="mb-1 text-xs font-bold text-ink">Stop {s.sequence ?? "—"} · {s.type === "PICKUP" ? "Pengambilan" : s.type === "DELIVERY" ? "Pengiriman" : "—"}{s.orderNumber ? ` · ${s.orderNumber}` : ""}{s.customerName ? ` · ${s.customerName}` : ""}</h4>
          <ul className="divide-y divide-border rounded-lg border border-border px-2.5">
            {s.events.map((e) => <EventRow key={e.id || `${e.action}-${e.at}`} routeId={routeId} event={e} canCorrect={data.canCorrect} onChanged={load} />)}
            {s.missing.map((m) => <MissingRow key={m.action} item={m} />)}
            {s.events.length === 0 && s.missing.length === 0 && <li className="py-1.5 text-[11px] text-ink3">Belum ada aktivitas.</li>}
          </ul>
          <p className="mt-1 text-[11px] text-ink2" data-testid="stop-durations">
            {[s.travelDurationText ? `Perjalanan: ${s.travelDurationText}` : s.travelDurationNote, s.serviceDurationText ? `Layanan: ${s.serviceDurationText}` : s.serviceDurationNote].filter(Boolean).join(" · ")}
          </p>
        </section>
      ))}
      <p className="text-[10.5px] text-ink3">{data.note}</p>
    </div>
  );
}
