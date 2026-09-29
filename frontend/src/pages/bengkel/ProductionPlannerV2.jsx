import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, FileText, Monitor, PackageX, Plus, RefreshCw, Target, Timer, Truck,
} from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { ProgressBar } from "@/components/ui/progress.jsx";
import { rolesOf } from "@/lib/roles.js";
import { formatTanggal } from "@/utils/formatDate.js";
import {
  PRIORITIES, bucketStyle, canDropOn, formatMinutes, friendlyError, indicatorList, initials, stationCapacity, wibDate,
} from "@/features/production/experience.js";

// Planner Produksi V2 (P8A) — papan meja H-1: target harian, Meja 1–4 (kapasitas per meja dari server), antrean belum dijadwalkan,
// penugasan workshop + PIC meja + PIC Corner, prioritas, dan indikator kesiapan (custody/layanan/BOM/bahan/workshop/QC/serah Gudang).
// Pindah meja: seret-lepas ATAU tombol "Pindah" (aksesibel keyboard). Server menegakkan kapasitas, izin, dan cohort writer V2 —
// unit di luar cohort tidak pernah tampil (reader) dan tidak bisa diubah (writer). Work Order lama tetap tersedia sebagai histori/fallback.

const user = (() => { try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; } })();
const canRoute = rolesOf(user).some((r) => ["ADMIN", "OWNER", "PRODUCTION_LEAD"].includes(r));
// Format tanggal Indonesia PENDEK ("29 Sep 2026", P8.1 UI & Navigation
// Consolidation) — SAMA dengan formatTanggal() yang dipakai di seluruh app
// (utils/formatDate.js), ganti format panjang lokal lama ("Senin, 29
// September 2026") yang cuma dipakai di halaman ini.
const fmtDate = (d) => formatTanggal(d);
const shiftDate = (d, days) => new Date(new Date(`${d}T00:00:00Z`).getTime() + days * 86400_000).toISOString().slice(0, 10);
const TONE_CLS = { green: "bg-greenbg text-green", red: "bg-redbg text-red", orange: "bg-orangebg text-orange", neutral: "bg-inset text-ink3" };

function Kpi({ icon: Icon, label, value, tone = "neutral" }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={`flex h-10 w-10 items-center justify-center rounded-btn ${tone === "red" ? "bg-redbg text-red" : tone === "orange" ? "bg-orangebg text-orange" : tone === "green" ? "bg-greenbg text-green" : "bg-accentbg text-accent"}`}><Icon size={19} aria-hidden /></span>
      <div><p className="text-[12px] text-ink3">{label}</p><p className="text-[20px] font-bold leading-tight text-ink tabular-nums">{value}</p></div>
    </Card>
  );
}

// P9A — unit sudah "Masuk Produksi" (pickup berhasil) TAPI belum dikonfirmasi
// tiba secara fisik: kartu boleh dijadwalkan lebih dulu (bucket DALAM_PERJALANAN),
// tapi tahap produksi baru bisa dimulai setelah tombol ini diklik (ditegakkan
// server di loadRunForWrite). Tombol dipisah dari area klik "buka kartu" —
// wrapper diganti dari <button> jadi <div> supaya dua aksi tidak bertumpuk.
function RunCard({ item, onOpen, onConfirmArrival, draggable = true }) {
  const st = bucketStyle(item.bucket);
  const warn = item.warnings?.find((w) => ["KEKURANGAN", "LAYANAN_BELUM", "BAHAN_BELUM", "BOM_BELUM", "TERLAMBAT"].includes(w.code));
  const waiting = item.bucket === "MENUNGGU_BAHAN";
  const inTransit = item.bucket === "DALAM_PERJALANAN";
  return (
    <div draggable={draggable} onDragStart={(e) => { e.dataTransfer.setData("text/plain", item.runId); e.dataTransfer.effectAllowed = "move"; }}
      className={`w-full overflow-hidden rounded-card transition-colors ${waiting ? "bg-orangebg/60" : "bg-surface"} shadow-sm`}>
      <button type="button" onClick={() => onOpen(item)} className="w-full p-3 text-left hover:bg-hovertint">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold text-ink">{item.unit.unitCode}</p>
            <p className="truncate text-[12.5px] text-ink2">{item.customer.name || "—"}</p>
            <p className="truncate text-[12px] text-ink3">{[item.unit.ukuran, item.unit.service?.label || "Layanan belum ditetapkan"].filter(Boolean).join(" · ")}</p>
          </div>
          {item.plan?.priority > 0 && <Badge variant={item.plan.priority === 2 ? "red" : "orange"}>{item.plan.priorityLabel}</Badge>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge variant={st.badge}>{st.label}</Badge>
          {item.customer.weightKg && <span className="text-[11.5px] text-ink3">{item.customer.weightKg} kg</span>}
        </div>
        {warn && <p className="mt-1.5 flex items-center gap-1 text-[11.5px] font-medium text-orange"><AlertTriangle size={12} aria-hidden /> {warn.text}</p>}
        <div className="mt-2 flex items-center gap-2">
          {item.plan?.operator?.name && <span title={item.plan.operator.name} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">{initials(item.plan.operator.name)}</span>}
          <div className="flex-1">
            <ProgressBar value={item.progress.total ? (item.progress.done / item.progress.total) * 100 : 0} variant={waiting ? "warning" : "accent"} />
          </div>
          <span className="shrink-0 text-[11px] text-ink3 tabular-nums">{item.progress.done} dari {item.progress.total} tahap</span>
        </div>
      </button>
      {inTransit && onConfirmArrival && (
        <div className="border-t border-line px-3 py-2">
          <Button size="sm" variant="secondary" className="w-full" onClick={() => onConfirmArrival(item)}><Truck size={13} aria-hidden /> Unit Tiba di Workshop</Button>
        </div>
      )}
    </div>
  );
}

// P9A — pemilih lokasi Receiving/WIP untuk "Unit Tiba di Workshop". Tidak ada
// default terpilih (server juga menolak locationId kosong) — pengguna WAJIB
// memilih sendiri, sesuai kontrak "jangan pernah menebak lokasi".
function ArrivalModal({ target, onClose, onDone }) {
  const [locations, setLocations] = useState(null);
  const [locationId, setLocationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api.getProductionV2ReceivingLocations().then((r) => { if (alive) setLocations(r.locations || []); }).catch((e) => { if (alive) setError(friendlyError(e)); });
    return () => { alive = false; };
  }, []);
  async function submit() {
    if (!locationId) { setError("Pilih lokasi penyimpanan dulu."); return; }
    setBusy(true); setError("");
    try {
      await api.confirmProductionV2UnitArrival(target.unit.id, { locationId });
      onDone(`${target.unit.unitCode} tercatat tiba di workshop.`);
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  }
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={`Unit Tiba di Workshop — ${target.unit.unitCode}`}
      description="Konfirmasi kedatangan fisik unit ke lokasi Receiving/WIP. Tahap produksi baru bisa dimulai setelah ini."
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="neutral" onClick={onClose} disabled={busy}>Batal</Button>
          <Button onClick={submit} disabled={busy || !locationId}>{busy ? "Menyimpan…" : "Konfirmasi Tiba"}</Button>
        </div>
      }>
      <div className="space-y-3 px-6 pb-2">
        <label className="text-[12.5px] text-ink3">Lokasi penyimpanan (Receiving/WIP)
          <select className="mt-1 w-full rounded-btn border border-line bg-transparent px-3 py-2 text-[13.5px] text-ink" value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={!locations}>
            <option value="">{locations ? "— pilih lokasi —" : "Memuat…"}</option>
            {(locations || []).map((l) => <option key={l.id} value={l.id}>{l.code}{l.zone ? ` (${l.zone})` : ""}</option>)}
          </select>
        </label>
        {locations && locations.length === 0 && <p className="rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange">Belum ada lokasi Receiving/WIP aktif. Minta Gudang mengaktifkan satu lokasi dulu.</p>}
        {error && <p role="alert" className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{error}</p>}
      </div>
    </Modal>
  );
}

function ScheduleModal({ target, board, date, refs, onClose, onDone }) {
  const plan = target.plan;
  const [form, setForm] = useState(() => ({
    productionDate: plan?.productionDate || date,
    stationCode: target.presetStation || plan?.stationCode || board.stations.find((s) => !stationCapacity(s).full)?.code || board.config.stations[0],
    priority: plan?.priority ?? 0,
    workCenterId: plan?.workCenter?.id || refs.workCenters[0]?.id || "",
    operatorId: plan?.operator?.id || "",
    cornerOperatorId: plan?.cornerOperator?.id || "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const unitCode = target.unit?.unitCode;
  const field = "mt-1 w-full rounded-btn border border-line bg-transparent px-3 py-2 text-[13.5px] text-ink";

  async function submit(unschedule = false) {
    if (!unschedule && (!form.workCenterId || !form.operatorId)) { setError("Pilih workshop dan PIC meja."); return; }
    setBusy(true); setError("");
    const body = unschedule
      ? { productionDate: null, stationCode: null, priority: form.priority }
      : { ...form, priority: Number(form.priority), cornerOperatorId: form.cornerOperatorId || undefined };
    try {
      if (plan) await api.scheduleProductionV2Plan(plan.id, { ...body, expectedRevision: plan.revision });
      else await api.planProductionV2Unit({ runId: target.runId, ...body });
      onDone(unschedule ? `${unitCode} dikeluarkan dari papan.` : `${unitCode} dijadwalkan ke ${form.stationCode.replace("TABLE_", "Meja ")}.`);
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  }

  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={plan ? `Jadwal ${unitCode}` : `Rencanakan ${unitCode}`} description="Tanggal produksi, meja bongkar, dan PIC. Kapasitas meja dijaga server."
      footer={
        <div className="flex w-full flex-wrap justify-end gap-2">
          {plan?.stationCode && <Button variant="neutral" disabled={busy} onClick={() => submit(true)}>Keluarkan dari papan</Button>}
          <Button variant="neutral" onClick={onClose} disabled={busy}>Batal</Button>
          <Button onClick={() => submit(false)} disabled={busy}>{busy ? "Menyimpan…" : "Simpan Jadwal"}</Button>
        </div>
      }>
      <div className="grid gap-3 px-6 pb-2 sm:grid-cols-2">
        <label className="text-[12.5px] text-ink3">Tanggal produksi<input type="date" className={field} value={form.productionDate} onChange={(e) => set({ productionDate: e.target.value })} /></label>
        <label className="text-[12.5px] text-ink3">Meja bongkar
          <select className={field} value={form.stationCode} onChange={(e) => set({ stationCode: e.target.value })}>
            {board.stations.map((s) => { const c = stationCapacity(s); return <option key={s.code} value={s.code} disabled={c.full && s.code !== plan?.stationCode}>{s.label} ({c.label}{c.full ? " — penuh" : ""})</option>; })}
          </select>
        </label>
        <label className="text-[12.5px] text-ink3">Prioritas
          <select className={field} value={form.priority} onChange={(e) => set({ priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
        </label>
        <label className="text-[12.5px] text-ink3">Workshop
          <select className={field} value={form.workCenterId} onChange={(e) => set({ workCenterId: e.target.value })}>
            <option value="">— pilih —</option>{refs.workCenters.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label className="text-[12.5px] text-ink3">PIC meja (bongkar & restorasi)
          <select className={field} value={form.operatorId} onChange={(e) => set({ operatorId: e.target.value })}>
            <option value="">— pilih —</option>{refs.operators.map((o) => <option key={o.id} value={o.id}>{o.user?.name || o.employeeCode}</option>)}
          </select>
        </label>
        <label className="text-[12.5px] text-ink3">PIC Corner (jahit) — opsional
          <select className={field} value={form.cornerOperatorId} onChange={(e) => set({ cornerOperatorId: e.target.value })}>
            <option value="">Sama dengan PIC meja</option>{refs.operators.map((o) => <option key={o.id} value={o.id}>{o.user?.name || o.employeeCode}</option>)}
          </select>
        </label>
        {refs.operators.length === 0 && <p className="sm:col-span-2 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange">Belum ada operator aktif. Tambahkan di Tim & Area Kerja → Operators.</p>}
        {error && <p role="alert" className="sm:col-span-2 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{error}</p>}
      </div>
    </Modal>
  );
}

function RunDrawer({ item, refs, onClose, onSchedule, onConfirmArrival, onChanged }) {
  const [serviceId, setServiceId] = useState(item.unit.service ? "" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function setService() {
    if (!serviceId) return;
    setBusy(true); setError("");
    try { await api.setUnitService(item.unit.id, serviceId); onChanged("Layanan unit ditetapkan."); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  }
  const c = item.customer;
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={item.unit.unitCode} description={`${c.name || "—"} · ${c.orderNumber || "tanpa nomor order"}`} className="w-[640px]">
      <div className="space-y-4 px-6 pb-4">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={bucketStyle(item.bucket).badge}>{bucketStyle(item.bucket).label}</Badge>
          <Badge variant="neutral">{item.plan?.stationLabel || "Belum dijadwalkan"}</Badge>
          {item.plan?.priority > 0 && <Badge variant={item.plan.priority === 2 ? "red" : "orange"}>{item.plan.priorityLabel}</Badge>}
          {item.timer.late && <Badge variant="red">Terlambat</Badge>}
        </div>
        <dl className="m-0 grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-3">
          {[
            ["Jenis layanan", item.unit.service?.label || "Belum ditetapkan"], ["Merk & ukuran", [item.unit.merk, item.unit.ukuran].filter(Boolean).join(" ") || "—"],
            ["Berat badan", c.weightKg ? `${c.weightKg} kg${c.weightEntries?.length > 1 ? ` (+${c.weightEntries.length - 1})` : ""}` : "—"], ["Posisi tidur", c.sleepPosition || "Belum dicatat Sales"],
            ["Keluhan", c.complaints?.join(", ") || "—"], ["Request", c.request || "—"],
            ["PIC meja", item.plan?.operator?.name || "—"], ["PIC Corner", item.plan?.cornerOperator?.name || (item.plan?.operator ? "Sama dengan PIC meja" : "—")],
            ["Waktu berjalan", formatMinutes(item.timer.elapsedMinutes)],
          ].map(([k, v]) => <div key={k} className="rounded-btn bg-inset px-3 py-2"><dt className="m-0 text-ink3">{k}</dt><dd className="m-0 font-semibold text-ink">{v}</dd></div>)}
        </dl>
        <div className="flex flex-wrap gap-1.5" aria-label="Indikator kesiapan">
          {indicatorList(item.indicators).map((i) => <span key={i.key} className={`rounded-chip px-2 py-1 text-[11.5px] font-medium ${TONE_CLS[i.tone]}`}>{i.label}: {i.value.replaceAll("_", " ").toLowerCase()}</span>)}
        </div>
        {item.warnings?.some((w) => w.code !== "KEKURANGAN") && <ul className="m-0 list-none p-0 space-y-1">{item.warnings.filter((w) => w.code !== "KEKURANGAN").map((w) => <li key={w.code} className="flex items-center gap-1.5 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange"><AlertTriangle size={13} aria-hidden /> {w.text}</li>)}</ul>}
        {item.shortage && <p className="flex items-center gap-1.5 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red"><PackageX size={13} aria-hidden /> Menunggu bahan: {item.shortage.items.map((i) => i.name).join(", ")}</p>}
        <ol className="m-0 list-none p-0 grid grid-cols-2 gap-1 sm:grid-cols-3" aria-label="12 tahap">
          {item.steps.map((s) => (
            <li key={s.no} className={`flex items-center gap-1.5 rounded-btn px-2 py-1.5 text-[12px] ${s.status === "DONE" ? "bg-greenbg text-green" : s.status === "CURRENT" ? "bg-accentbg font-semibold text-accent" : s.status === "WAITING" ? "bg-orangebg text-orange" : s.status === "NA" ? "text-ink3 line-through" : "bg-inset text-ink3"}`}>
              {s.status === "DONE" ? <CheckCircle2 size={12} aria-hidden /> : <span className="w-3 text-center tabular-nums">{s.no}</span>} {s.label}
            </li>
          ))}
        </ol>
        {canRoute && !item.unit.service && (
          <div className="flex flex-wrap items-end gap-2 rounded-btn border border-line p-3">
            <label className="flex-1 text-[12.5px] text-ink3">Tetapkan layanan (setelah diagnosa nyata)
              <select className="mt-1 w-full rounded-btn border border-line bg-transparent px-3 py-2 text-[13.5px] text-ink" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                <option value="">— pilih layanan —</option>{refs.services.map((s) => <option key={s.id} value={s.id}>{s.labelId}</option>)}
              </select>
            </label>
            <Button size="sm" disabled={!serviceId || busy} onClick={setService}>Tetapkan</Button>
          </div>
        )}
        {error && <p role="alert" className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {item.bucket === "DALAM_PERJALANAN" && onConfirmArrival && <Button size="sm" onClick={() => onConfirmArrival(item)}><Truck size={14} aria-hidden /> Unit Tiba di Workshop</Button>}
          <Button size="sm" onClick={() => onSchedule(item)}><CalendarDays size={14} aria-hidden /> {item.plan?.stationCode ? "Pindah / Ubah Jadwal" : "Jadwalkan"}</Button>
          {item.plan && <Button size="sm" variant="secondary" asChild><Link to={`/bengkel/production-v2/laporan/${item.runId}`}><FileText size={14} aria-hidden /> Laporan</Link></Button>}
          <Button size="sm" variant="neutral" asChild><Link to={`/bengkel/units/${item.unit.id}`}>Detail unit (lama)</Link></Button>
        </div>
      </div>
    </Modal>
  );
}

// Kalender (P8.1, UI & Navigation Consolidation) — tab BARU ke-3 di halaman
// Rencana Produksi (bersama Papan Meja & Daftar yang sudah ada). TIDAK ada
// endpoint baru: 7 hari di sekitar tanggal terpilih diambil lewat
// GET /production-v2/board?date= yang SAMA dipakai tab Papan Meja, dipanggil
// paralel per hari (reader/writer cohort V2 tetap berlaku sama persis).
// Klik satu hari pindah ke tab Papan Meja untuk hari itu — kalender ini
// murni navigasi cepat lintas hari, bukan state machine baru.
function WeekStrip({ centerDate, onPick }) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDate(centerDate, i - 3)), [centerDate]);
  const [byDay, setByDay] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all(days.map((d) => api.getProductionV2Board(d).then((b) => [d, b]).catch(() => [d, null])))
      .then((pairs) => { if (alive) setByDay(Object.fromEntries(pairs)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.join(",")]);

  const today = wibDate(0);
  return (
    <Card className="p-3">
      <p className="mb-2 text-[12.5px] text-ink3">7 hari di sekitar tanggal terpilih — direncanakan/target per hari. Klik satu hari untuk membuka Papan Meja hari itu.</p>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
        {days.map((d) => {
          const b = byDay[d];
          const planned = b?.kpi?.planned ?? null;
          const target = b?.kpi?.target ?? null;
          const attention = (b?.kpi?.waitingMaterial ?? 0) > 0 || (b?.kpi?.late ?? 0) > 0;
          const isToday = d === today;
          const isSelected = d === centerDate;
          const dow = new Date(`${d}T00:00:00+07:00`).toLocaleDateString("id-ID", { weekday: "short" });
          const dm = new Date(`${d}T00:00:00+07:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
          return (
            <button key={d} type="button" onClick={() => onPick(d)}
              className={`flex flex-col items-center gap-1 rounded-btn border p-2.5 text-center transition-colors ${isSelected ? "border-accent bg-accentbg" : "border-line hover:bg-hovertint"}`}>
              <span className={`text-[11px] font-semibold uppercase ${isToday ? "text-accent" : "text-ink3"}`}>{dow}{isToday ? " · hari ini" : ""}</span>
              <span className="text-[13px] font-bold text-ink">{dm}</span>
              {loading ? (
                <span className="h-4 w-10 animate-pulse rounded bg-inset" />
              ) : (
                <span className={`text-[12px] font-semibold tabular-nums ${attention ? "text-orange" : "text-ink3"}`}>{planned ?? "—"}/{target ?? "—"}</span>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

export default function ProductionPlannerV2() {
  const [date, setDate] = useState(() => wibDate(0));
  const dateInputRef = useRef(null);
  const [board, setBoard] = useState(null);
  const [refs, setRefs] = useState({ workCenters: [], operators: [], services: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("board");
  const [drawer, setDrawer] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [arrival, setArrival] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError("");
    return api.getProductionV2Board(date).then(setBoard).catch((e) => setError(friendlyError(e))).finally(() => setLoading(false));
  }, [date]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    Promise.all([
      api.getWorkCenters().catch(() => ({ workCenters: [] })),
      api.getProductionOperators().catch(() => ({ operators: [] })),
      api.getServiceCatalog().catch(() => ({ services: [] })),
    ]).then(([w, o, s]) => setRefs({
      workCenters: (w.workCenters || []).filter((x) => x.active !== false),
      operators: (o.operators || []).filter((x) => x.active !== false),
      services: s.services || [],
    }));
  }, []);
  useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(t); }, [notice]);

  const allItems = useMemo(() => (board?.stations || []).flatMap((s) => s.items).concat(board?.unscheduled?.plans || []), [board]);
  const unscheduledCount = (board?.unscheduled?.plans?.length || 0) + (board?.unscheduled?.units?.length || 0);

  async function dropOn(station, runId) {
    setDropTarget(null);
    const item = allItems.find((i) => i.runId === runId);
    const unit = board?.unscheduled?.units?.find((u) => u.runId === runId);
    if (unit) { setSchedule({ ...unit, presetStation: station.code }); return; }
    if (!item) return;
    if (!canDropOn(station, item)) { setError(stationCapacity(station).full ? `${station.label} sudah penuh.` : ""); return; }
    if (!item.plan?.operator?.id || !item.plan?.workCenter?.id) { setSchedule({ ...item, presetStation: station.code }); return; }
    try {
      await api.scheduleProductionV2Plan(item.plan.id, {
        expectedRevision: item.plan.revision, productionDate: date, stationCode: station.code, priority: item.plan.priority,
        workCenterId: item.plan.workCenter.id, operatorId: item.plan.operator.id, cornerOperatorId: item.plan.cornerOperator?.id,
      });
      setNotice(`${item.unit.unitCode} dipindah ke ${station.label}.`); load();
    } catch (e) { setError(friendlyError(e)); load(); }
  }

  const reader = board?.readerMode;
  return (
    <PageContainer fluid>
      <PageHeader title="Rencana Produksi" subtitle={fmtDate(date)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* P8.2 (UI Polish) — laporan owner dari screenshot live: input
                tanggal native menampilkan format browser mentah ("09/29/2026"),
                tidak konsisten dengan subjudul di bawah judul halaman yang
                sudah Indonesia ("29 Sep 2026"). Input native TETAP dipakai
                (dukungan a11y/mobile terbaik untuk kalender), tapi disembunyikan
                visual (sr-only — tetap ada di DOM & bisa diklik lewat ref,
                bukan display:none) di belakang tombol berlabel format Indonesia
                yang membuka pemilih tanggal via showPicker(). */}
            <div className="flex items-center rounded-btn bg-inset">
              <Button variant="neutral" size="icon" aria-label="Hari sebelumnya" onClick={() => setDate((d) => shiftDate(d, -1))}><ChevronLeft size={16} /></Button>
              <button type="button"
                onClick={() => { const el = dateInputRef.current; if (!el) return; if (typeof el.showPicker === "function") el.showPicker(); else el.click(); }}
                className="flex items-center gap-1.5 px-1 text-[13px] font-medium text-ink">
                <CalendarDays size={14} className="text-ink3" aria-hidden /> {fmtDate(date)}
              </button>
              <input ref={dateInputRef} type="date" aria-label="Tanggal produksi" className="sr-only" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
              <Button variant="neutral" size="icon" aria-label="Hari berikutnya" onClick={() => setDate((d) => shiftDate(d, 1))}><ChevronRight size={16} /></Button>
            </div>
            <Button variant="neutral" size="sm" onClick={() => setDate(wibDate(0))}>Hari Ini</Button>
            <Button variant="neutral" size="sm" onClick={() => setDate(wibDate(1))}>Besok (H-1)</Button>
            <Button variant="secondary" size="sm" asChild><Link to="/bengkel/andon"><Monitor size={14} aria-hidden /> Andon TV</Link></Button>
            <Button variant="neutral" size="sm" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button>
          </div>
        } />
      <PageBody>
        {notice && <div role="status" className="rounded-btn bg-greenbg px-3 py-2.5 text-[12.5px] text-green">{notice}</div>}
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        {reader === "OFF" ? (
          <Card className="p-0"><EmptyState icon={ClipboardList} title="Produksi V2 belum aktif" description="Papan meja tampil setelah Production V2 diaktifkan untuk unit terkait. Selama cutover, gunakan Work Order dan Papan Produksi lama." action={<Button size="sm" variant="secondary" asChild><Link to="/bengkel/work-orders">Buka Work Order</Link></Button>} /></Card>
        ) : (
          <>
            {/* Ringkas KPI saat papan benar-benar kosong (P8.1) — 5 kartu penuh
                cuma bermakna kalau ada target/aktivitas; tanggal tanpa apa-apa
                (mis. jauh di masa depan) cukup satu baris ringkas. */}
            {board && board.kpi?.target === 0 && unscheduledCount === 0 && allItems.length === 0 ? (
              <Card className="flex items-center gap-2 p-3 text-[12.5px] text-ink3">
                <Target size={16} className="shrink-0 text-ink3" aria-hidden /> Belum ada target maupun unit dijadwalkan untuk {fmtDate(date)}.
              </Card>
            ) : (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Kpi icon={Target} label="Target" value={`${board?.kpi?.target ?? "—"} unit`} />
                <Kpi icon={ClipboardList} label="Direncanakan" value={`${board?.kpi?.planned ?? 0} unit`} />
                <Kpi icon={CheckCircle2} label="Selesai" value={`${board?.kpi?.completed ?? 0} unit`} tone="green" />
                <Kpi icon={PackageX} label="Menunggu bahan" value={board?.kpi?.waitingMaterial ?? 0} tone={board?.kpi?.waitingMaterial ? "red" : "neutral"} />
                <Kpi icon={Timer} label="Terlambat" value={board?.kpi?.late ?? 0} tone={board?.kpi?.late ? "orange" : "neutral"} />
              </div>
            )}

            <div role="tablist" aria-label="Tampilan" className="flex gap-1 border-b border-line">
              {[["board", "Papan Meja"], ["list", "Daftar"], ["calendar", "Kalender"]].map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${tab === k ? "border-accent text-accent" : "border-transparent text-ink3 hover:text-ink2"}`}>{l}</button>
              ))}
            </div>

            {tab === "calendar" ? (
              <WeekStrip centerDate={date} onPick={(d) => { setDate(d); setTab("board"); }} />
            ) : loading && !board ? (
              <div className="grid gap-3 md:grid-cols-4">{[1, 2, 3, 4].map((n) => <Card key={n} className="h-72 animate-pulse bg-inset" />)}</div>
            ) : tab === "board" ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {board?.stations.map((s) => {
                  const cap = stationCapacity(s);
                  return (
                    <section key={s.code} aria-label={s.label}
                      onDragOver={(e) => { e.preventDefault(); setDropTarget(s.code); }} onDragLeave={() => setDropTarget(null)}
                      onDrop={(e) => { e.preventDefault(); dropOn(s, e.dataTransfer.getData("text/plain")); }}
                      className={`flex flex-col gap-2 rounded-card bg-inset p-3 transition-colors ${dropTarget === s.code ? (cap.full ? "ring-2 ring-red" : "ring-2 ring-accent") : ""}`}>
                      <div className="flex items-center justify-between">
                        <p className="text-[14px] font-bold text-ink">{s.label}</p>
                        <span className={`text-[12px] font-semibold tabular-nums ${cap.full ? "text-orange" : "text-ink3"}`}>{cap.label}</span>
                      </div>
                      <p className="-mt-1 text-[12px] text-ink3">{s.operatorNames.join(", ") || "Belum ada PIC"}</p>
                      {s.items.map((item) => <RunCard key={item.runId} item={item} onOpen={setDrawer} onConfirmArrival={setArrival} />)}
                      {!cap.full && (
                        // P8.2 (UI Polish) — dinonaktifkan saat Belum Dijadwalkan
                        // kosong: sebelumnya tombol tetap bisa diklik dan membuka
                        // modal "Pilih unit" yang kosong (cuma teks "Tidak ada
                        // unit yang menunggu dijadwalkan."), langkah tambahan
                        // tanpa guna. Tooltip Indonesia menjelaskan kenapa.
                        <button type="button" disabled={unscheduledCount === 0}
                          onClick={() => unscheduledCount > 0 && setSchedule({ pick: true, presetStation: s.code })}
                          title={unscheduledCount === 0 ? "Belum ada unit yang menunggu dijadwalkan" : undefined}
                          className="flex min-h-[72px] flex-col items-center justify-center rounded-card border-2 border-dashed border-line text-[12.5px] text-ink3 hover:bg-hovertint disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent">
                          <Plus size={16} aria-hidden /> Tambah unit ke {s.label}
                        </button>
                      )}
                    </section>
                  );
                })}
              </div>
            ) : (
              <Card className="overflow-x-auto p-0">
                <table className="w-full text-left text-[12.5px]">
                  <thead className="bg-inset text-ink3"><tr>{["Unit", "Customer", "Meja", "PIC", "Status", "Tahap", "Bahan", "Waktu"].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                  <tbody>
                    {allItems.map((i) => (
                      <tr key={i.runId} className="cursor-pointer border-t border-line hover:bg-hovertint" onClick={() => setDrawer(i)}>
                        <td className="px-3 py-2 font-semibold text-ink">{i.unit.unitCode}</td><td className="px-3 py-2">{i.customer.name}</td>
                        <td className="px-3 py-2">{i.plan?.stationLabel}</td><td className="px-3 py-2">{i.plan?.operator?.name || "—"}</td>
                        <td className="px-3 py-2"><Badge variant={bucketStyle(i.bucket).badge}>{bucketStyle(i.bucket).label}</Badge></td>
                        <td className="px-3 py-2 tabular-nums">{i.progress.done}/{i.progress.total}</td><td className="px-3 py-2">{i.materialStatus.label}</td>
                        <td className="px-3 py-2 tabular-nums">{formatMinutes(i.timer.elapsedMinutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}

            {tab !== "calendar" && (
            <Card className="space-y-3 p-4">
              <div className="flex items-center gap-2"><p className="text-[14px] font-bold text-ink">Belum Dijadwalkan</p><Badge variant="neutral">{unscheduledCount} unit</Badge></div>
              {unscheduledCount === 0 ? (
                // P9A — copy lama ("...setelah Gudang menerima unit dari pickup")
                // sudah tidak akurat: unit sekarang langsung "Masuk Produksi"
                // begitu PICKUP-nya sendiri berhasil, tanpa menunggu Gudang.
                <p className="text-[12.5px] text-ink3">Semua unit siap produksi sudah dijadwalkan. Unit baru muncul di sini segera setelah pickup ke customer berhasil.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {board.unscheduled.plans.map((item) => <RunCard key={item.runId} item={item} onOpen={setDrawer} onConfirmArrival={setArrival} />)}
                  {board.unscheduled.units.map((u) => {
                    // P9A — dua jenis kartu di sini sekarang: (a) unit dengan
                    // Run nyata (runId ada, TERMASUK yang masih PENDING_ARRIVAL)
                    // — boleh "Rencanakan" lebih dulu; (b) kartu WARISAN
                    // tanpa Run sama sekali (mis. canary lama) — belum bisa
                    // direncanakan (createProductionPlan butuh Run), HANYA bisa
                    // dikonfirmasi tiba dulu.
                    const schedulable = !!u.runId;
                    return (
                      <div key={u.handoffId || u.runId} className="overflow-hidden rounded-card bg-surface shadow-sm">
                        <button type="button" draggable={schedulable}
                          onDragStart={schedulable ? (e) => e.dataTransfer.setData("text/plain", u.runId) : undefined}
                          onClick={() => schedulable && setSchedule(u)} disabled={!schedulable}
                          className={`w-full p-3 text-left ${schedulable ? "hover:bg-hovertint" : "cursor-default"}`}>
                          <p className="text-[13px] font-bold text-ink">{u.unit.unitCode}</p>
                          <p className="text-[12px] text-ink3">{[u.unit.merk, u.unit.ukuran].filter(Boolean).join(" · ") || "—"}{u.isLegacyException ? " · data lama" : ""}</p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {u.inTransit && <Badge variant="neutral">Dalam perjalanan ke workshop</Badge>}
                            {schedulable && <span className="text-[11.5px] font-semibold text-accent">Rencanakan →</span>}
                          </div>
                        </button>
                        {u.inTransit && (
                          <div className="border-t border-line px-3 py-2">
                            <Button size="sm" variant="secondary" className="w-full" onClick={() => setArrival(u)}><Truck size={13} aria-hidden /> Unit Tiba di Workshop</Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
            )}
          </>
        )}
      </PageBody>

      {drawer && <RunDrawer item={drawer} refs={refs} onClose={() => setDrawer(null)} onSchedule={(i) => { setDrawer(null); setSchedule(i); }} onConfirmArrival={(i) => { setDrawer(null); setArrival(i); }} onChanged={(msg) => { setDrawer(null); setNotice(msg); load(); }} />}
      {arrival && <ArrivalModal target={arrival} onClose={() => setArrival(null)} onDone={(msg) => { setArrival(null); setNotice(msg); load(); }} />}
      {schedule?.pick && (
        <Modal open onOpenChange={(v) => !v && setSchedule(null)} title={`Pilih unit untuk ${schedule.presetStation.replace("TABLE_", "Meja ")}`}>
          <div className="space-y-2 px-6 pb-4">
            {unscheduledCount === 0 && <p className="text-[12.5px] text-ink3">Tidak ada unit yang menunggu dijadwalkan.</p>}
            {/* P9A — kartu warisan tanpa Run (runId null) belum bisa direncanakan; disaring dari pemilih ini. */}
            {[...(board?.unscheduled?.plans || []), ...(board?.unscheduled?.units || []).filter((u) => u.runId)].map((u) => (
              <button key={u.runId} type="button" onClick={() => setSchedule({ ...u, presetStation: schedule.presetStation })} className="flex w-full items-center justify-between rounded-btn bg-inset px-3 py-2.5 text-left text-[13px] hover:bg-hovertint">
                <span><b className="text-ink">{u.unit.unitCode}</b> <span className="text-ink3">{u.customer?.name || [u.unit.merk, u.unit.ukuran].filter(Boolean).join(" ")}</span></span><ChevronRight size={14} aria-hidden />
              </button>
            ))}
          </div>
        </Modal>
      )}
      {schedule && !schedule.pick && board && (
        <ScheduleModal target={schedule} board={board} date={date} refs={refs} onClose={() => setSchedule(null)} onDone={(msg) => { setSchedule(null); setNotice(msg); load(); }} />
      )}
    </PageContainer>
  );
}
