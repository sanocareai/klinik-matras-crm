import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, FileText, Monitor, PackageX, RefreshCw, Target, Timer, Truck,
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
import { formatRupiah } from "@/utils/format.js";
import {
  PRIORITIES, bucketStyle, formatMinutes, friendlyError, indicatorList, initials, priorityTone, stationCapacity,
  targetDateBadge, wibDate,
} from "@/features/production/experience.js";
import { UnitPhotoThumb, UnitPhotoPanel } from "@/features/production/UnitPhotoThumb.jsx";

// Status Produksi (P8A "Rencana Produksi" -> P9B.1 ganti nama tampilan) — Papan Meja/Daftar/Kalender dalam satu
// workspace, MURNI status pipeline (Akan Masuk..Siap Kirim). URL TETAP /bengkel/production-v2 (kompatibilitas
// bookmark/tab lama, lihat tabTitles.js#SEGMENT_LABEL_OVERRIDE) — hanya label tampilan yang berubah. Penjadwalan
// SUNGGUHAN (assign meja/PIC/tanggal/BOM) sekarang punya workspace SENDIRI: "Rencana Produksi" (P9B.1, halaman
// baru, lihat ProductionRencanaWorkspace.jsx) — halaman ini TETAP bisa menjadwalkan (drag/tombol) sebagai jalan
// pintas dari kartu, tapi bukan lagi tempat UTAMA mengelola BOM/reservasi bahan.
// Papan Meja dikelompokkan per TAHAP PIPELINE (Akan Masuk..Siap Kirim, bukan lagi per meja fisik) — kapasitas meja
// TETAP ditegakkan server, dipilih di dalam ScheduleModal (dropdown meja+kapasitas), bukan sebagai kolom papan.
// Server menegakkan kapasitas, izin, dan cohort writer V2 — unit di luar cohort tidak pernah tampil (reader) dan
// tidak bisa diubah (writer). Work Order lama tetap tersedia sebagai histori/fallback.

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
// P9B — kartu diperkaya: kota, Sales, order value (HANYA bila server mengirim
// orderValue — role tanpa ORDER_PRICE_READ tidak pernah menerima field ini
// sama sekali, lihat getProductionCommandCenter), badge tanggal target
// (terpisah dari badge prioritas — permintaan eksplisit P9B), dan ringkasan
// keluhan/request customer untuk konteks cepat tanpa buka drawer.
function RunCard({ item, onOpen, onConfirmArrival, draggable = true, today, tomorrow }) {
  const st = bucketStyle(item.bucket);
  const warn = item.warnings?.find((w) => ["KEKURANGAN", "LAYANAN_BELUM", "BAHAN_BELUM", "BOM_BELUM", "TERLAMBAT"].includes(w.code));
  const waiting = item.bucket === "MENUNGGU_BAHAN";
  const inTransit = item.bucket === "DALAM_PERJALANAN";
  const dateBadge = today && tomorrow ? targetDateBadge(item, today, tomorrow) : null;
  const c = item.customer || {};
  return (
    <div draggable={draggable} onDragStart={(e) => { e.dataTransfer.setData("text/plain", item.runId); e.dataTransfer.effectAllowed = "move"; }}
      className={`w-full overflow-hidden rounded-card transition-colors ${waiting ? "bg-orangebg/60" : "bg-surface"} shadow-sm`}>
      <button type="button" onClick={() => onOpen(item)} className="w-full p-3 text-left hover:bg-hovertint">
        <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
          <div className="flex min-w-0 flex-1 gap-2">
            <UnitPhotoThumb photoUrl={item.unit.photoUrl} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold text-ink">{item.unit.unitCode}{c.orderNumber ? ` · ${c.orderNumber}` : ""}</p>
              <p className="truncate text-[12.5px] text-ink2">{c.name || "—"}{c.city ? ` · ${c.city}` : ""}</p>
              <p className="truncate text-[12px] text-ink3">{[item.unit.ukuran, item.unit.service?.label || "Layanan belum ditetapkan"].filter(Boolean).join(" · ")}</p>
              {c.salesName && <p className="truncate text-[11px] text-ink3">Sales: {c.salesName}</p>}
            </div>
          </div>
          {/* flex-wrap pada baris induk (bukan flex-col shrink-0) — di kartu sempit (mobile), grup badge pindah ke
              baris sendiri di bawah judul alih-alih terpotong overflow-hidden kartu (P9B, ditemukan lewat QA visual 390px). */}
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            {item.plan?.priority > 0 && <Badge variant={priorityTone(item.plan.priority)}>{item.plan.priorityLabel}</Badge>}
            {dateBadge && <Badge variant={dateBadge.tone}>{dateBadge.label}</Badge>}
            {/* P9B.1 — status jadwal (meja/belum dijadwalkan) TIDAK LAGI menentukan kolom papan, jadi harus tetap
                terlihat sebagai badge di kartu — paling relevan untuk Dalam Perjalanan & Tiba/Belum Mulai, tapi
                ditampilkan konsisten di semua kartu (murni informasi, tidak berbahaya di kolom lain). */}
            <Badge variant="neutral">{item.plan?.stationCode ? item.plan.stationLabel : "Belum dijadwalkan"}</Badge>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge variant={st.badge}>{st.label}</Badge>
          {c.weightKg != null && <span className="text-[11.5px] text-ink3">{c.weightKg} kg</span>}
          {item.orderValue != null && <span className="text-[11.5px] font-semibold text-ink2">{formatRupiah(item.orderValue)}</span>}
        </div>
        {(c.complaints?.length || c.request) && (
          <p className="mt-1.5 truncate text-[11.5px] text-ink3">{[c.complaints?.join(", "), c.request].filter(Boolean).join(" — ")}</p>
        )}
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

// P9B — kartu "Akan Masuk": pickup terjadwal tetapi belum selesai. BACA-SAJA (belum ada Run sama sekali) — tidak ada
// aksi apa pun di sini, murni visibilitas supaya Rencana Produksi tidak buta terhadap unit yang akan datang.
function UpcomingPickupCard({ item }) {
  return (
    <div className="flex w-full gap-2 rounded-card bg-surface p-3 shadow-sm">
      <UnitPhotoThumb photoUrl={item.unit.photoUrl} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold text-ink">{item.unit.unitCode}{item.unit.orderNumber ? ` · ${item.unit.orderNumber}` : ""}</p>
        <p className="truncate text-[12.5px] text-ink2">{item.customer?.name || "—"}{item.customer?.city ? ` · ${item.customer.city}` : ""}</p>
        <p className="truncate text-[12px] text-ink3">{[item.unit.merk, item.unit.ukuran].filter(Boolean).join(" · ") || "—"}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge variant="neutral">Akan Masuk</Badge>
          {item.scheduledDate && <span className="text-[11px] text-ink3">Pickup {formatTanggal(item.scheduledDate)}</span>}
          {item.driverName && <span className="text-[11px] text-ink3">· {item.driverName}</span>}
        </div>
      </div>
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
        <UnitPhotoPanel unitId={item.unit.id} photoUrl={item.unit.photoUrl} canUpload={canRoute} onUploaded={() => onChanged("Foto identitas unit disimpan.")} />
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
  const [cc, setCc] = useState(null);
  const [refs, setRefs] = useState({ workCenters: [], operators: [], services: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("board");
  const [drawer, setDrawer] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [arrival, setArrival] = useState(null);
  const today = wibDate(0);
  const tomorrow = wibDate(1);

  // P9B — cc (Command Center, TIDAK terikat tanggal) SEKARANG sumber tunggal untuk tab Papan Meja/Daftar & KPI ringkas
  // di halaman ini — SAMA payload dipakai Ringkasan Produksi (CommandCenterSummary.jsx), jadi angka tidak pernah beda.
  // `board` (per-tanggal) DIPERTAHANKAN hanya untuk 2 hal yang MEMANG per-tanggal: kapasitas meja di ScheduleModal, dan
  // tab Kalender (WeekStrip) — BUKAN sumber data paralel untuk jadwal, murni proyeksi tanggal dari data yang sama.
  const load = useCallback(() => {
    setLoading(true); setError("");
    return Promise.all([api.getProductionV2Board(date), api.getProductionV2CommandCenter()])
      .then(([b, c]) => { setBoard(b); setCc(c); })
      .catch((e) => setError(friendlyError(e))).finally(() => setLoading(false));
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

  const columns = cc?.columns || [];
  // Daftar (tabel datar): seluruh kartu berbasis Run (punya runId nyata) di semua kolom KECUALI Akan Masuk (belum ada Run).
  const allItems = useMemo(() => columns.filter((c) => c.key !== "AKAN_MASUK").flatMap((c) => c.items.filter((i) => i.runId)), [columns]);
  // P9B.1 — halaman ini TIDAK LAGI punya kolom "Dijadwalkan" sebagai drop target (dihapus sebagai kolom tahap,
  // lihat productionSteps.js#commandCenterColumn) — papan di sini jadi READ-ONLY untuk seret/lepas. Penjadwalan
  // SUNGGUHAN (drag-and-drop) sekarang HANYA di workspace "Rencana Produksi" (ProductionRencanaWorkspace.jsx);
  // di sini penjadwalan tetap tersedia sebagai jalan pintas tombol "Jadwalkan/Pindahkan" di kartu/drawer saja.

  const reader = cc?.readerMode;
  return (
    <PageContainer fluid>
      <PageHeader title="Status Produksi" subtitle={fmtDate(date)}
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
            {/* P9B — KPI ringkas dari cc.kpi (SUMBER SAMA dengan Ringkasan Produksi & kolom papan di bawah — tidak ada
                hitungan bayangan). Ringkas saat benar-benar kosong (P8.1); selebihnya link ke Ringkasan lengkap
                (bukan duplikasi 9 kartu KPI penuh di dua halaman). */}
            {cc && cc.kpi?.target === 0 && allItems.length === 0 ? (
              <Card className="flex items-center gap-2 p-3 text-[12.5px] text-ink3">
                <Target size={16} className="shrink-0 text-ink3" aria-hidden /> Belum ada target maupun unit aktif di Production V2 saat ini.
              </Card>
            ) : (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
                <Kpi icon={Target} label="Target Harian" value={`${cc?.kpi?.target ?? "—"} unit`} />
                <Kpi icon={ClipboardList} label="Dijadwalkan Hari Ini" value={`${cc?.kpi?.dijadwalkanHariIni ?? 0} unit`} />
                <Kpi icon={CheckCircle2} label="Selesai Hari Ini" value={`${cc?.kpi?.selesaiHariIni ?? 0} unit`} tone="green" />
                <Kpi icon={PackageX} label="Menunggu bahan" value={cc?.kpi?.menungguBahan ?? 0} tone={cc?.kpi?.menungguBahan ? "red" : "neutral"} />
                <Kpi icon={Timer} label="Terlambat" value={cc?.kpi?.terlambat ?? 0} tone={cc?.kpi?.terlambat ? "orange" : "neutral"} />
                <Card className="flex items-center justify-center p-4"><Button variant="secondary" size="sm" asChild><Link to="/bengkel/ringkasan">Ringkasan lengkap →</Link></Button></Card>
              </div>
            )}

            <div role="tablist" aria-label="Tampilan" className="flex gap-1 border-b border-line">
              {[["board", "Papan Meja"], ["list", "Daftar"], ["calendar", "Kalender"]].map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${tab === k ? "border-accent text-accent" : "border-transparent text-ink3 hover:text-ink2"}`}>{l}</button>
              ))}
            </div>

            {tab === "calendar" ? (
              <WeekStrip centerDate={date} onPick={(d) => { setDate(d); setTab("board"); }} />
            ) : loading && !cc ? (
              <div className="grid gap-3 md:grid-cols-4">{[1, 2, 3, 4].map((n) => <Card key={n} className="h-72 animate-pulse bg-inset" />)}</div>
            ) : tab === "board" ? (
              // P9B.1 — kolom pipeline mencerminkan KEADAAN FISIK (Akan Masuk/Dalam Perjalanan/Tiba-Belum Mulai/
              // Fondasi../Siap Kirim), BUKAN status jadwal (itu sudah jadi badge di kartu, lihat RunCard) dan BUKAN
              // per meja fisik (kapasitas meja tetap ditegakkan server, dipilih di dalam ScheduleModal). Papan di
              // sini READ-ONLY untuk seret/lepas — penjadwalan drag-and-drop yang SUNGGUHAN sekarang di workspace
              // "Rencana Produksi" terpisah; di sini penjadwalan tetap ada sebagai tombol "Jadwalkan/Pindahkan"
              // pada kartu/drawer, bukan drop target kolom.
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {columns.map((col) => (
                  <section key={col.key} aria-label={col.label} className="flex flex-col gap-2 rounded-card bg-inset p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[14px] font-bold text-ink">{col.label}</p>
                      <span className="text-[12px] font-semibold tabular-nums text-ink3">{col.count}</span>
                    </div>
                    {col.items.length === 0 ? (
                      <p className="flex min-h-[64px] items-center justify-center rounded-card border-2 border-dashed border-line text-center text-[11.5px] text-ink3">Tidak ada unit</p>
                    ) : col.items.map((item) => (
                      item.kind === "UPCOMING_PICKUP" ? <UpcomingPickupCard key={`${item.jobId}-${item.unit.id}`} item={item} />
                      : item.kind === "AWAITING_ARRIVAL_LEGACY" ? (
                        <div key={item.handoffId} className="overflow-hidden rounded-card bg-surface shadow-sm">
                          <div className="flex gap-2 p-3">
                            <UnitPhotoThumb photoUrl={item.unit.photoUrl} />
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] font-bold text-ink">{item.unit.unitCode}</p>
                              <p className="text-[12px] text-ink3">{[item.unit.merk, item.unit.ukuran].filter(Boolean).join(" · ") || "—"} · data lama</p>
                              <Badge variant="neutral" className="mt-1.5">Dalam perjalanan ke workshop</Badge>
                            </div>
                          </div>
                          <div className="border-t border-line px-3 py-2">
                            <Button size="sm" variant="secondary" className="w-full" onClick={() => setArrival(item)}><Truck size={13} aria-hidden /> Unit Tiba di Workshop</Button>
                          </div>
                        </div>
                      ) : (
                        <RunCard key={item.runId} item={item} onOpen={setDrawer} onConfirmArrival={setArrival} draggable={false} today={today} tomorrow={tomorrow} />
                      )
                    ))}
                  </section>
                ))}
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

            {/* P9B — kartu warisan tanpa Run sama sekali (mis. canary lama) TIDAK muncul di tab Daftar (tabel butuh
                bucket/progress yang cuma ada di kartu berbasis Run) — baris ringkas ini menjaga visibilitas mereka di
                LUAR tab Papan Meja (yang sudah menampilkannya di kolom Belum Dijadwalkan). Kosong -> tidak render apa pun. */}
            {tab === "list" && belumDijadwalkanItems.some((i) => !i.runId) && (
              <Card className="space-y-2 p-4">
                <p className="text-[13px] font-bold text-ink">Unit Menunggu Kedatangan (data lama, belum ada Run)</p>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {belumDijadwalkanItems.filter((i) => !i.runId).map((item) => (
                    <div key={item.handoffId} className="overflow-hidden rounded-card bg-surface shadow-sm">
                      <div className="p-3">
                        <p className="text-[13px] font-bold text-ink">{item.unit.unitCode}</p>
                        <p className="text-[12px] text-ink3">{[item.unit.merk, item.unit.ukuran].filter(Boolean).join(" · ") || "—"}</p>
                        <Badge variant="neutral" className="mt-1.5">Dalam perjalanan ke workshop</Badge>
                      </div>
                      <div className="border-t border-line px-3 py-2">
                        <Button size="sm" variant="secondary" className="w-full" onClick={() => setArrival(item)}><Truck size={13} aria-hidden /> Unit Tiba di Workshop</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}
      </PageBody>

      {drawer && <RunDrawer item={drawer} refs={refs} onClose={() => setDrawer(null)} onSchedule={(i) => { setDrawer(null); setSchedule(i); }} onConfirmArrival={(i) => { setDrawer(null); setArrival(i); }} onChanged={(msg) => { setDrawer(null); setNotice(msg); load(); }} />}
      {arrival && <ArrivalModal target={arrival} onClose={() => setArrival(null)} onDone={(msg) => { setArrival(null); setNotice(msg); load(); }} />}
      {schedule && board && (
        <ScheduleModal target={schedule} board={board} date={date} refs={refs} onClose={() => setSchedule(null)} onDone={(msg) => { setSchedule(null); setNotice(msg); load(); }} />
      )}
    </PageContainer>
  );
}
