import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, Loader2, Package, Plus, Truck, User, X, MapPin, Trash2,
  ArrowUp, ArrowDown, Navigation, Route,
} from "lucide-react";
import { api } from "../api.js";
import { PageContainer, PageHeader } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import { WorkspaceHero } from "@/components/ui/workspace-hero.jsx";
import Avatar from "@/components/Avatar.jsx";
import ChipPilih from "@/features/armada/components/ChipPilih.jsx";
import AssignDropdown from "@/features/armada/components/AssignDropdown.jsx";
import DriverJobs from "./DriverJobs.jsx";
import { EDITABLE_JOB_STATUSES, mapsUrl } from "@/features/armada/jobStatus.js";

// ARMADA — dispatcher menjadwalkan pengambilan & pengiriman harian.
//
// SENGAJA MINIMAL per PRD §1.5/§11 Phase 1: TANPA route builder, TANPA
// optimasi rute (VRP), TANPA kapasitas kendaraan — itu semua Phase 2/3.
// Dispatcher pilih unit + driver + tanggal secara manual. Sano tidak cuma
// mengirim — setiap hari ada jalur PENGAMBILAN juga (workflow Gilang,
// 31 Juli 2026), jadi dua tab terpisah, bukan satu daftar campur.

function todayWibISO() {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

function currentRoles() {
  try {
    return JSON.parse(localStorage.getItem("user"))?.roles || [];
  } catch {
    return [];
  }
}

const STATUS_LABEL = {
  UNSCHEDULED: "Belum Dijadwalkan",
  SCHEDULED: "Terjadwal",
  ASSIGNED: "Ditugaskan",
  EN_ROUTE: "Dalam Perjalanan",
  ARRIVED: "Tiba di Lokasi",
  COMPLETED: "Selesai",
  FAILED: "Gagal",
  RESCHEDULED: "Dijadwal Ulang",
};
const STATUS_BADGE = {
  UNSCHEDULED: "neutral", SCHEDULED: "accent", ASSIGNED: "accent",
  EN_ROUTE: "accent", ARRIVED: "accent", COMPLETED: "green", FAILED: "red", RESCHEDULED: "orange",
};
const EDITABLE_STATUSES = EDITABLE_JOB_STATUSES;

function formatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}
function formatDuration(s) {
  const min = Math.round(s / 60);
  if (min < 60) return `${min} mnt`;
  return `${Math.floor(min / 60)} j ${min % 60} mnt`;
}

// ── Kartu satu job ───────────────────────────────────────────────────────
// route: opsional — { index, isFirst, isLast, onMoveUp, onMoveDown, busy,
// legToNext } — hanya diisi kalau job ini bagian dari grup driver+tanggal
// yang punya >1 stop (FR-L-03: kontrol urutan rute manual).
function JobCard({ job, drivers, vehicles, helpers, onChanged, route }) {
  const [driverId, setDriverId] = useState(job.driverId || "");
  const [helperId, setHelperId] = useState(job.helperId || "");
  const [vehicleId, setVehicleId] = useState(job.vehicleId || "");
  const [address, setAddress] = useState(job.addressText || "");
  // D-032 — alamat SALES/rencana (Order.deliveryAddress/deliveryCity,
  // D-027), dipakai SEBAGAI SARAN, bukan auto-fill langsung — field ini
  // auto-save on blur (lihat saveAddress di bawah), jadi mengisi `address`
  // di sini akan diam-diam TERSIMPAN begitu dispatcher klik keluar field
  // walau dia belum sempat baca/setuju. Ditampilkan sebagai tombol "Pakai
  // alamat order" (klik = niat jelas) alih-alih placeholder biasa, supaya
  // tetap kelihatan walau field sudah ada isinya dari sumber lain.
  const orderForJob = job.units[0]?.unit?.order;
  const prefillAddress = orderForJob
    ? [orderForJob.deliveryAddress, orderForJob.deliveryCity].filter(Boolean).join(", ")
    : "";
  const [busy, setBusy] = useState(false);
  const editable = EDITABLE_STATUSES.has(job.status);
  // ChipPilih butuh {id, name} — vehicles asli cuma punya `plateNumber`
  // (tidak ada field `name`), jadi dipetakan di sini supaya chip-nya
  // menampilkan plat nomor, bukan "undefined".
  const vehicleItems = vehicles.map((v) => ({ id: v.id, name: v.plateNumber }));

  // Kontrak SAMA dengan tugaskanCepat di ArmadaDashboard.jsx (D-036/D-054):
  // `newHelperId` HANYA dikirim ke API kalau memang eksplisit dipilih lewat
  // AssignDropdown (bukan `undefined`) — klik nama driver polos TIDAK
  // diam-diam menghapus helper yang sudah ada di job ini.
  async function saveAssignment(newDriverId, newHelperId) {
    setDriverId(newDriverId);
    if (newHelperId !== undefined) setHelperId(newHelperId);
    setBusy(true);
    try {
      const patch = { driverId: newDriverId || null };
      if (newHelperId !== undefined) patch.helperId = newHelperId || null;
      await api.updateArmadaJob(job.id, patch);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function saveVehicle(newVehicleId) {
    setVehicleId(newVehicleId);
    setBusy(true);
    try {
      await api.updateArmadaJob(job.id, { vehicleId: newVehicleId || null });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function saveAddress() {
    if (address === (job.addressText || "")) return;
    setBusy(true);
    try {
      await api.updateArmadaJob(job.id, { addressText: address });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await api.deleteArmadaJob(job.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const customer = job.units[0]?.unit?.order?.customer;
  const maps = mapsUrl(job);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {route && (
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-inset text-[10px] font-bold text-ink2">
              {route.index + 1}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{customer?.name || "—"}</p>
            <p className="font-mono text-xs text-ink2">{job.units[0]?.unit?.order?.orderNumber}</p>
          </div>
        </div>
        <Badge variant={STATUS_BADGE[job.status]}>{STATUS_LABEL[job.status]}</Badge>
      </div>

      {route && (
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button" onClick={route.onMoveUp} disabled={route.busy || route.isFirst}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-ink2 disabled:opacity-30"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button" onClick={route.onMoveDown} disabled={route.busy || route.isLast}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-ink2 disabled:opacity-30"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          {route.legToNext && (
            <span className="text-[11px] text-ink3">
              → {formatDistance(route.legToNext.distanceMeters)} · {formatDuration(route.legToNext.durationSeconds)} ke stop berikutnya
              {/* estimate=true -> jarak garis lurus (haversine), BUKAN jarak
                  jalan asli — Google Distance Matrix belum bisa dipakai
                  (billing). Lihat catatan Fase 2 di services/maps.js. */}
              {route.legToNext.estimate && (
                <span title="Jarak garis lurus, bukan jarak jalan sungguhan — Google Maps belum aktif" className="text-orange"> (≈ estimasi)</span>
              )}
            </span>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1">
        {job.units.map((ju) => (
          <span key={ju.id} className="rounded bg-inset px-1.5 py-0.5 font-mono text-[10px] text-ink2">
            {ju.unit.unitCode}
          </span>
        ))}
      </div>

      {editable ? (
        <>
          {/* AssignDropdown menggantikan ChipPilih untuk driver+helper
              (D-054, 4 September 2026) — laporan owner: 9 driver + helper
              yang SELALU tampil sebagai chip di SETIAP kartu (D-053, sehari
              sebelumnya) "numpuk" di grid 3 kolom. Satu tombol ringkas
              menampilkan nama yang sedang aktif, daftarnya baru muncul saat
              diketuk — pola yang sama dengan TugaskanDropdown Dashboard,
              diekstrak jadi komponen bersama (AssignDropdown.jsx) supaya
              tidak ada 2 salinan logic yang bisa diam-diam beda. Ini
              SEKALIGUS menambah kemampuan yang belum ada di kartu ini:
              menugaskan HELPER — sebelumnya cuma bisa lewat JobDetailDrawer. */}
          <div className="mt-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink3">
              <User className="h-3 w-3" /> Driver &amp; Helper
            </p>
            <AssignDropdown
              drivers={drivers}
              helpers={helpers}
              currentDriverId={driverId}
              currentHelperId={helperId}
              busy={busy}
              onPick={saveAssignment}
            />
          </div>
          <div className="mt-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink3">
              <Truck className="h-3 w-3" /> Kendaraan
            </p>
            <ChipPilih
              items={vehicleItems}
              selectedId={vehicleId}
              disabled={busy}
              onPick={saveVehicle}
              kosongLabel="Belum ada kendaraan"
              size="sm"
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-ink3" />
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onBlur={saveAddress}
              placeholder="Alamat (opsional)"
              disabled={busy}
              className="h-9 flex-1 rounded-lg border border-border px-2 text-xs text-ink outline-none focus:border-accent"
            />
          </div>
          {/* D-032 — cuma muncul kalau field masih kosong DAN order-nya
              punya alamat sales (D-027). Klik = niat jelas isi + langsung
              simpan (bukan cuma numpang di draft, supaya konsisten dgn
              perilaku onBlur field di atas — tidak ada "draft nyangkut"
              yang beda state dari yang tersimpan). */}
          {!address && prefillAddress && (
            <button
              type="button"
              onClick={() => { setAddress(prefillAddress); api.updateArmadaJob(job.id, { addressText: prefillAddress }).then(onChanged); }}
              className="ml-6 mt-1 text-[11px] text-accent hover:underline"
            >
              Pakai alamat order: {prefillAddress}
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="mt-2 flex items-center gap-1 text-[11px] text-red hover:underline disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" /> Batalkan job
          </button>
        </>
      ) : (
        <div className="mt-3 space-y-1 text-xs text-ink2">
          {job.driver && <p className="flex items-center gap-1.5"><User className="h-3 w-3" /> {job.driver.name}</p>}
          {/* Helper (D-037, 31 Agustus 2026) — read-only di kartu papan ini,
              sengaja TIDAK dibuat editable di sini. Penugasan helper
              lengkap (bareng driver+kendaraan+tanggal) tetap di
              JobDetailDrawer supaya tidak ada 2 tempat kontrol yang bisa
              drift satu sama lain untuk field yang sama. */}
          {job.helper && <p className="flex items-center gap-1.5"><User className="h-3 w-3" /> {job.helper.name} <span className="text-ink3">(helper)</span></p>}
          {job.vehicle && <p className="flex items-center gap-1.5"><Truck className="h-3 w-3" /> {job.vehicle.plateNumber}</p>}
          {job.addressText && <p className="flex items-center gap-1.5"><MapPin className="h-3 w-3" /> {job.addressText}</p>}
          {job.status === "FAILED" && job.failureReason && (
            <p className="rounded bg-redbg px-2 py-1 text-red">{job.failureReason}</p>
          )}
        </div>
      )}

      {maps && (
        <a href={maps} target="_blank" rel="noreferrer"
          className="mt-2 flex h-8 items-center justify-center gap-1.5 rounded-lg bg-accentbg text-[11px] font-semibold text-accent">
          <Navigation className="h-3 w-3" /> Navigasi
        </a>
      )}
    </Card>
  );
}

// ── Grup job per driver — urutan rute manual (FR-L-03) ───────────────────
// Kontrol urutan+jarak/durasi HANYA muncul kalau driver ini punya >1 job
// aktif di tanggal itu (satu job saja tidak ada "rute" untuk diurutkan).
function DriverRouteGroup({ driverId, driverName, jobs, date, type, drivers, vehicles, helpers, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState(null);
  const hasRoute = jobs.length > 1;
  const jobIdsKey = jobs.map((j) => j.id).join(",");

  useEffect(() => {
    if (!hasRoute) { setSummary(null); return; }
    let cancelled = false;
    api.getArmadaRouteSummary(driverId, date, type).then((s) => { if (!cancelled) setSummary(s); }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId, date, type, jobIdsKey]);

  async function move(index, dir) {
    const next = jobs.map((j) => j.id);
    const swapWith = index + dir;
    if (swapWith < 0 || swapWith >= next.length) return;
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    setBusy(true);
    try {
      await api.reorderArmadaRoute({ driverId, date, type, jobIds: next });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        {/* Avatar gradien (D-053) — konsisten dengan chip driver/helper di
            ChipPilih/TugaskanDropdown di bawah/atasnya; ikon User polos di
            sini jadi satu-satunya identitas driver TANPA warna, terasa
            lepas dari sisa halaman begitu chip-nya sudah bergradien. */}
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Avatar name={driverName} size="sm" gradient className="h-6 w-6 text-[10px]" /> {driverName}
        </h3>
        {hasRoute && summary && (
          summary.legsError ? (
            <span className="text-[11px] text-orange">{summary.legsError}</span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-ink2">
              <Route className="h-3 w-3" /> {formatDistance(summary.totalDistanceMeters)} · {formatDuration(summary.totalDurationSeconds)} total
            </span>
          )
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {jobs.map((job, i) => (
          <JobCard
            key={job.id} job={job} drivers={drivers} vehicles={vehicles} helpers={helpers} onChanged={onChanged}
            route={hasRoute ? {
              index: i, isFirst: i === 0, isLast: i === jobs.length - 1,
              onMoveUp: () => move(i, -1), onMoveDown: () => move(i, 1), busy,
              legToNext: summary?.legs?.[i] || null,
            } : null}
          />
        ))}
      </div>
    </div>
  );
}

// ── Panel pilih unit untuk job baru ──────────────────────────────────────
function CreateJobPanel({ type, available, date, onCreated, onClose }) {
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);

  // Dikelompokkan per ORDER — job tidak boleh mencampur unit lintas-order
  // (PRD §5.2), jadi pemilihan dikunci per-order: pilih order dulu, baru
  // sub-unit di dalamnya.
  const byOrder = available.reduce((acc, u) => {
    const key = u.order?.orderNumber || u.order?.id || "—";
    (acc[key] = acc[key] || []).push(u);
    return acc;
  }, {});
  const selectedOrder = selected.size > 0 ? available.find((u) => selected.has(u.id))?.order?.orderNumber : null;

  function toggle(unit) {
    const orderNo = unit.order?.orderNumber;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(unit.id)) {
        next.delete(unit.id);
      } else {
        // Order berbeda dari yang sudah dipilih -> mulai ulang seleksi,
        // BUKAN menolak diam-diam (dispatcher harus sadar kenapa pilihan
        // lamanya hilang).
        if (selectedOrder && selectedOrder !== orderNo) next.clear();
        next.add(unit.id);
      }
      return next;
    });
  }

  async function save() {
    setBusy(true);
    try {
      await api.createArmadaJob({ type, unitIds: [...selected], scheduledDate: date });
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">
          Pilih Unit untuk {type === "PICKUP" ? "Pengambilan" : "Pengiriman"}
        </h3>
        <button onClick={onClose} className="text-ink2 hover:text-ink"><X className="h-4 w-4" /></button>
      </div>

      {selectedOrder && (
        <p className="mb-2 text-[11px] text-ink3">
          Order terpilih: <b>{selectedOrder}</b> — satu job hanya boleh dari satu order.
        </p>
      )}

      {available.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink2">
          Tidak ada unit yang {type === "PICKUP" ? "menunggu pengambilan" : "siap dikirim"}.
        </p>
      ) : (
        <div className="max-h-80 space-y-3 overflow-y-auto">
          {Object.entries(byOrder).map(([orderNo, units]) => {
            const disabled = !!selectedOrder && selectedOrder !== orderNo;
            return (
              <div key={orderNo} className={disabled ? "opacity-40" : ""}>
                <p className="mb-1 font-mono text-xs font-semibold text-ink2">
                  {orderNo} · {units[0]?.order?.customer?.name}
                </p>
                <div className="space-y-1">
                  {units.map((u) => (
                    <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-hovertint">
                      <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u)} disabled={disabled} />
                      <span className="flex-1 truncate text-xs text-ink">{u.unitCode}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Button className="mt-3 h-11 w-full" disabled={busy || selected.size === 0} onClick={save}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Buat Job ${selected.size} unit`}
      </Button>
    </Card>
  );
}

// ── Pengaturan Grup Driver (D-018) — ADMIN only, sekali setup ────────────
// Sengaja MINIMAL: satu dropdown + tombol simpan, bukan halaman pengaturan
// tersendiri. Ini konfigurasi yang dilakukan SEKALI di awal, bukan aksi
// rutin harian dispatcher — tidak perlu tempat mewah.
function DriverGroupSettings() {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState(null);
  const [current, setCurrent] = useState(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || groups) return;
    Promise.all([api.getGroupConversations(), api.getDriverGroup()]).then(([gs, cur]) => {
      setGroups(gs);
      setCurrent(cur.group);
      setSelected(cur.group?.id || "");
    });
  }, [open, groups]);

  async function save() {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await api.setDriverGroup(selected);
      setCurrent(r.group);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mb-3 text-xs text-ink2 hover:text-accent hover:underline">
        Grup WhatsApp Driver: {current?.groupName || "belum diatur"} — atur
      </button>
    );
  }

  return (
    <Card className="mb-4 p-3">
      <p className="mb-2 text-xs font-semibold text-ink">Grup WhatsApp Driver</p>
      <p className="mb-2 text-[11px] text-ink2">
        Dokumentasi foto pickup/delivery driver dikirim otomatis ke grup ini.
      </p>
      {!groups ? (
        <Loader2 className="h-4 w-4 animate-spin text-ink2" />
      ) : (
        <div className="flex gap-2">
          <select
            value={selected} onChange={(e) => setSelected(e.target.value)}
            className="h-9 flex-1 rounded-lg border border-border px-2 text-xs text-ink outline-none focus:border-accent"
          >
            <option value="">Pilih grup…</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.groupName || g.id}</option>)}
          </select>
          <Button className="h-9 text-xs" disabled={busy || !selected} onClick={save}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Simpan"}
          </Button>
          <button onClick={() => setOpen(false)} className="text-ink2 hover:text-ink"><X className="h-4 w-4" /></button>
        </div>
      )}
    </Card>
  );
}

// ── Halaman ───────────────────────────────────────────────────────────────
export default function Armada() {
  const [type, setType] = useState("PICKUP");
  const [date, setDate] = useState(todayWibISO());
  const [board, setBoard] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [helpers, setHelpers] = useState([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const roles = currentRoles();
  // LEADER_DRIVER (D-042, 2 September 2026) digabung ke grup "allowed" —
  // punya JOB_READ penuh, berhak papan dispatcher lengkap seperti ADMIN/
  // DISPATCHER, bukan cuma "Job Saya".
  const allowed = roles.some((r) => ["ADMIN", "DISPATCHER", "LEADER_DRIVER"].includes(r));
  // HELPER (D-037, 31 Agustus 2026) ikut mendarat di tampilan "Job Saya"
  // driver — permission-nya identik (JOB_OWN_READ/WRITE).
  const isDriverOnly = !allowed && roles.some((r) => ["DRIVER", "HELPER"].includes(r));

  const load = useCallback(async () => {
    try {
      const [b, d, v, h] = await Promise.all([api.getArmadaBoard(type, date), api.getDrivers(), api.getVehicles(), api.getHelpers()]);
      setBoard(b);
      setDrivers(d);
      setVehicles((v.vehicles || []).filter((x) => x.active));
      setHelpers(h || []);
    } catch (e) {
      setError(e.message);
    }
  }, [type, date]);

  useEffect(() => { if (allowed) { setBoard(null); load(); } }, [allowed, load]);

  if (isDriverOnly) {
    return (
      <PageContainer>
        <PageHeader title="Job Saya" subtitle="Pengambilan & pengiriman yang ditugaskan ke Anda hari ini." />
        <DriverJobs />
      </PageContainer>
    );
  }

  if (!allowed) {
    return (
      <PageContainer>
        <div className="py-16 text-center">
          <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-orange" />
          <h2 className="text-lg font-semibold text-ink">Tidak Punya Akses</h2>
          <p className="mt-1 text-sm text-ink2">Halaman ini khusus dispatcher/admin.</p>
        </div>
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <div className="py-16 text-center">
          <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-red" />
          <p className="text-sm text-ink2">{error}</p>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Delivery & Fulfillment"
        subtitle="Penjadwalan armada, rute, dan proof of delivery."
        actions={
          <div className="flex items-center gap-2">
            {/* DatePicker menggantikan native <input type="date"> (D-053,
                4 September 2026) — komponen ini dibangun 31 Agustus 2026
                justru untuk kasus persis ini (lihat komentarnya sendiri:
                "gaya browser mm/dd/yyyy... jelek banget") dan sudah dipakai
                filter tanggal ArmadaJobs/ArmadaDashboard, tapi header Papan
                ini terlewat migrasinya. `allowFuture` default true di
                komponennya sudah cocok (job dijadwalkan ke depan). */}
            <DatePicker value={date} onChange={setDate} placeholder="Pilih tanggal" />
            <Button onClick={() => setCreating((v) => !v)} className="h-10">
              <Plus className="h-4 w-4" /> Buat Job
            </Button>
          </div>
        }
      />

      {/* Command center — SEMUA angka dihitung dari board yang sedang tampil
          (data nyata endpoint /armada/board), bukan contoh. Kalau board belum
          termuat, komponen ini tidak dirender sama sekali. */}
      {board && (
        <div className="mb-5">
          <WorkspaceHero
            // "blue" (D-053, 4 September 2026) — SEBELUMNYA "emerald",
            // warisan sebelum Delivery Hub mengunci biru sebagai identitas
            // divisi (D-045..D-051, lihat styles/delivery-dark.css). Hijau
            // di sini membuat Papan terasa seperti divisi lain (Bengkel=amber,
            // Gudang=sky, Kendali=violet — pola warna per-divisi yang
            // DISENGAJA di seluruh app), padahal ini SATU divisi yang sama
            // dengan Dashboard. Cuma prop tone yang berubah, komponennya
            // sendiri tetap dipakai bersama Bengkel/Gudang/Kendali.
            tone="blue"
            title="Delivery command center"
            subtitle="Pantau jadwal pengambilan & pengiriman hari ini, penugasan driver, dan unit yang belum masuk job."
            health={
              board.available.length > 0
                ? { label: `${board.available.length} unit belum dijadwalkan`, tone: "warn" }
                : { label: "Semua unit terjadwal", tone: "ok" }
            }
            stats={[
              {
                label: type === "PICKUP" ? "Job pengambilan" : "Job pengiriman",
                value: board.jobs.length,
                hint: date,
              },
              {
                label: "Sudah ada driver",
                value: board.jobs.filter((j) => j.driverId).length,
                hint: `dari ${board.jobs.length} job`,
              },
              {
                label: "Selesai",
                value: board.jobs.filter((j) => j.status === "COMPLETED").length,
                hint: "hari ini",
              },
              {
                label: "Menunggu jadwal",
                value: board.available.length,
                hint: type === "PICKUP" ? "unit siap diambil" : "unit siap dikirim",
              },
            ]}
          />
        </div>
      )}

      {roles.includes("ADMIN") && <DriverGroupSettings />}

      <div className="mb-4 flex gap-1 rounded-xl bg-inset p-1">
        {[
          { key: "PICKUP", label: "Pengambilan", icon: Package },
          { key: "DELIVERY", label: "Pengiriman", icon: Truck },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => { setType(t.key); setCreating(false); }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-semibold transition-colors ${
              type === t.key ? "bg-base text-ink shadow-card" : "text-ink2 hover:text-ink"
            }`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {!board ? (
        <div className="flex items-center justify-center gap-2 py-16 text-ink2">
          <Loader2 className="h-4 w-4 animate-spin" /> <span className="text-sm">Memuat…</span>
        </div>
      ) : (
        <>
          {creating && (
            <CreateJobPanel
              type={type} available={board.available} date={date}
              onClose={() => setCreating(false)}
              onCreated={() => { setCreating(false); load(); }}
            />
          )}

          {board.jobs.length === 0 ? (
            <Card className="p-8 text-center">
              <Truck className="mx-auto mb-3 h-10 w-10 text-ink2" strokeWidth={1.5} />
              <h3 className="text-base font-semibold text-ink">
                Belum ada job {type === "PICKUP" ? "pengambilan" : "pengiriman"} di tanggal ini
              </h3>
              <p className="mt-1 text-sm text-ink2">Pilih unit lewat tombol "Buat Job".</p>
            </Card>
          ) : (
            (() => {
              const grouped = {};
              const unassigned = [];
              for (const job of board.jobs) {
                if (job.driverId) (grouped[job.driverId] = grouped[job.driverId] || []).push(job);
                else unassigned.push(job);
              }
              return (
                <>
                  {Object.entries(grouped).map(([driverId, jobs]) => (
                    <DriverRouteGroup
                      key={driverId} driverId={driverId} driverName={jobs[0].driver?.name || "Driver"}
                      jobs={jobs} date={date} type={type} drivers={drivers} vehicles={vehicles} helpers={helpers} onChanged={load}
                    />
                  ))}
                  {unassigned.length > 0 && (
                    <div className="mb-5">
                      {Object.keys(grouped).length > 0 && (
                        <h3 className="mb-2 text-sm font-semibold text-ink2">Belum ada driver</h3>
                      )}
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                        {unassigned.map((job) => (
                          <JobCard key={job.id} job={job} drivers={drivers} vehicles={vehicles} helpers={helpers} onChanged={load} />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()
          )}

          {board.available.length > 0 && (
            <p className="mt-6 text-center text-xs text-ink2">
              {board.available.length} unit {type === "PICKUP" ? "menunggu pengambilan" : "siap dikirim"} belum
              masuk job apa pun.
            </p>
          )}
        </>
      )}
    </PageContainer>
  );
}
