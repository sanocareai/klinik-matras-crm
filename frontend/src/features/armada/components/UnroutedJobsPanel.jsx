import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Package, MapPinned, Plus, X, Loader2, AlertTriangle, ChevronDown, ArrowUpRight } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { FilterDropdown } from "@/components/ui/filter-dropdown.jsx";
import Avatar from "@/components/Avatar.jsx";
import { cn } from "@/lib/utils.js";
import { customerOf, unitCountOf, cityOf } from "../jobStatus.js";

// Panel kiri Route Planner: job pada tanggal terpilih yang BELUM masuk rute
// mana pun (routeId=null). Diseret SATU-SATU ke salah satu RouteCard di
// kanan, ATAU (D-058, 4 September 2026) dipilih BANYAK sekaligus lalu
// ditambahkan ke satu rute dengan satu aksi — laporan owner: hari ramai
// (puluhan order) drag satu-satu jadi lambat.
//
// Drag & drop HTML5 native — pola yang SAMA dengan Pipeline.jsx (Kanban lead),
// bukan library baru. `draggable` + onDragStart menaruh job.id di dataTransfer;
// RouteCard yang membacanya di onDrop.
//
// PENGELOMPOKAN KOTA (D-058) — job dikelompokkan per Order.deliveryCity,
// kota dengan 2+ job muncul PALING ATAS dengan label "kandidat 1 rute"
// (bukan otomatis dibuatkan rute — cuma petunjuk visual, dispatcher yang
// putuskan apa searah beneran layak digabung). Kota dengan 1 job atau tanpa
// kota (alamat belum lengkap) tetap tampil di kelompok "Lainnya" di bawah,
// TIDAK disembunyikan — order itu tetap harus terlihat & terjadwalkan.
export default function UnroutedJobsPanel({
  jobs, undatedJobs = [], loading, draggingId, onDragStart, onDragEnd,
  draftRoutes = [], onBulkAdd,
}) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState(() => new Set());
  const [targetRouteId, setTargetRouteId] = useState("");
  const [adding, setAdding] = useState(false);
  const [showUndated, setShowUndated] = useState(false);

  const groups = useMemo(() => {
    const byCity = new Map();
    for (const j of jobs) {
      const kota = cityOf(j) || "__lainnya";
      if (!byCity.has(kota)) byCity.set(kota, []);
      byCity.get(kota).push(j);
    }
    const kandidat = [];
    const lainnya = [];
    for (const [kota, list] of byCity) {
      if (kota !== "__lainnya" && list.length >= 2) kandidat.push({ kota, list });
      else lainnya.push(...list);
    }
    // Kota dengan job TERBANYAK duluan — itu peluang gabung rute paling besar.
    kandidat.sort((a, b) => b.list.length - a.list.length);
    return { kandidat, lainnya };
  }, [jobs]);

  function toggle(jobId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId); else next.add(jobId);
      return next;
    });
  }

  function toggleGroup(list) {
    setSelected((prev) => {
      const next = new Set(prev);
      const semuaTerpilih = list.every((j) => next.has(j.id));
      for (const j of list) semuaTerpilih ? next.delete(j.id) : next.add(j.id);
      return next;
    });
  }

  async function tambahkan() {
    if (!targetRouteId || selected.size === 0) return;
    setAdding(true);
    try {
      await onBulkAdd(targetRouteId, [...selected]);
      setSelected(new Set());
      setTargetRouteId("");
    } finally {
      setAdding(false);
    }
  }

  function JobRow({ j }) {
    return (
      <li
        draggable
        onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/job-id", j.id); onDragStart(j); }}
        onDragEnd={onDragEnd}
        className={cn(
          "flex cursor-grab items-start gap-2 rounded-btn border border-border bg-surface px-2.5 py-2 transition-opacity active:cursor-grabbing",
          draggingId === j.id && "opacity-40"
        )}
      >
        <input
          type="checkbox"
          checked={selected.has(j.id)}
          onChange={() => toggle(j.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Pilih job ${customerOf(j) || j.id}`}
          className="mt-1 h-3.5 w-3.5 shrink-0 accent-accent"
        />
        <Avatar name={customerOf(j) || "?"} size="sm" gradient className="mt-0.5 h-6 w-6 shrink-0 text-[9px]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-ink">{customerOf(j) || "Tanpa nama"}</div>
          <div className="mt-0.5 truncate text-[10.5px] text-ink2">{j.addressText || "Alamat belum diisi"}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-ink3">
            <span>{j.timeWindow || "Tanpa jam"}</span>
            <span aria-hidden>·</span>
            <span>{unitCountOf(j)} unit</span>
          </div>
        </div>
      </li>
    );
  }

  return (
    <div className="flex h-full flex-col rounded-card border border-border bg-surface">
      <div className="shrink-0 border-b border-line px-3 py-2.5">
        <h3 className="text-[12.5px] font-bold text-ink">Belum Masuk Rute</h3>
        <p className="text-[10.5px] text-ink3">{jobs?.length ?? 0} job — seret ke rute, atau centang lalu tambahkan sekaligus</p>
      </div>

      {/* Backlog TANPA TANGGAL SAMA SEKALI (D-062, 4 September 2026 —
          laporan owner: "di Jadwal & Penugasan banyak order yang belum
          dijadwalkan dan belum masuk rute", tapi panel di atas cuma
          mengecek tanggal yang SEDANG dibuka — job tanpa tanggal apa pun
          tidak pernah cocok filter tanggal manapun, jadi tidak pernah
          kelihatan). SENGAJA TIDAK draggable/checkable seperti job di
          bawah — rute selalu terikat SATU tanggal pasti, jadi job ini
          wajib dikasih tanggal dulu (di Jadwal & Penugasan) sebelum bisa
          masuk rute mana pun. Ini murni pengingat + jalan pintas ke
          sana, bukan drag source kedua. */}
      {undatedJobs.length > 0 && (
        <div className="shrink-0 border-b border-line bg-orangebg/40 px-2.5 py-2">
          <button
            type="button"
            onClick={() => setShowUndated((v) => !v)}
            className="flex w-full items-center gap-1.5 text-left text-[11px] font-semibold text-orange"
          >
            <AlertTriangle size={13} className="shrink-0" />
            <span className="flex-1">{undatedJobs.length} job belum ada tanggal sama sekali</span>
            <ChevronDown size={13} className={cn("shrink-0 transition-transform", showUndated && "rotate-180")} />
          </button>
          {showUndated && (
            <div className="mt-2 space-y-1.5">
              <ul className="space-y-1">
                {undatedJobs.map((j) => (
                  <li key={j.id} className="truncate text-[11px] text-ink2">
                    {customerOf(j) || "Tanpa nama"} <span className="text-ink3">· {j.type === "PICKUP" ? "Pengambilan" : "Pengiriman"}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => navigate("/armada/jobs")}
                className="flex items-center gap-1 text-[10.5px] font-semibold text-orange hover:underline"
              >
                Atur tanggalnya di Jadwal & Penugasan <ArrowUpRight size={11} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Bilah aksi massal — cuma muncul kalau ada yang dicentang. */}
      {selected.size > 0 && (
        <div className="shrink-0 space-y-1.5 border-b border-line bg-accentbg/40 px-2.5 py-2">
          <div className="flex items-center justify-between text-[11px] font-semibold text-accent">
            <span>{selected.size} job dipilih</span>
            <button type="button" onClick={() => setSelected(new Set())} className="text-ink3 hover:text-ink">
              <X size={13} />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <FilterDropdown
              value={targetRouteId}
              onChange={setTargetRouteId}
              options={draftRoutes.map((r) => ({ value: r.id, label: r.code }))}
              placeholder={draftRoutes.length === 0 ? "Belum ada rute draft" : "Pilih rute tujuan…"}
              disabled={draftRoutes.length === 0}
              className="flex-1"
              triggerClassName="w-full"
            />
            <button
              type="button"
              onClick={tambahkan}
              disabled={!targetRouteId || adding}
              className="flex h-8 shrink-0 items-center gap-1 rounded-btn bg-accent px-2.5 text-[11.5px] font-bold text-white disabled:opacity-40"
            >
              {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Tambahkan
            </button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-btn bg-inset" />)}
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Semua job sudah masuk rute"
            description="Atau belum ada job terjadwal pada tanggal ini."
          />
        ) : (
          <div className="space-y-3">
            {groups.kandidat.map(({ kota, list }) => (
              <div key={kota}>
                <div className="mb-1 flex items-center justify-between px-0.5">
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-accent">
                    <MapPinned size={11} /> {kota} · kandidat 1 rute
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleGroup(list)}
                    className="text-[10px] font-semibold text-accent hover:underline"
                  >
                    Pilih semua ({list.length})
                  </button>
                </div>
                <ul className="space-y-1.5">
                  {list.map((j) => <JobRow key={j.id} j={j} />)}
                </ul>
              </div>
            ))}

            {groups.lainnya.length > 0 && (
              <div>
                {groups.kandidat.length > 0 && (
                  <p className="mb-1 px-0.5 text-[10px] font-bold uppercase tracking-wide text-ink3">Lainnya</p>
                )}
                <ul className="space-y-1.5">
                  {groups.lainnya.map((j) => <JobRow key={j.id} j={j} />)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
