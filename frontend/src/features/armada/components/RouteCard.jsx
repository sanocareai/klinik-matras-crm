import React, { useState } from "react";
import { GripVertical, X, ArrowUpDown, Send, Ban, Trash2, Loader2, User, Truck } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { FilterDropdown } from "@/components/ui/filter-dropdown.jsx";
import Avatar from "@/components/Avatar.jsx";
import StatusBadge from "./StatusBadge.jsx";
import { ROUTE_STATUS_REAL } from "../vehicleStatus.js";
import { customerOf, unitCountOf } from "../jobStatus.js";
import { JobMetaRow } from "./JobBadges.jsx";

// Satu kolom rute di Route Planner — drop target untuk job dari panel kiri
// ATAU dari kolom rute lain, plus drag-reorder stop di dalamnya.
//
// KAPASITAS dihitung dari SUM(unitCount job) vs vehicle.capacitySlots — kalau
// kendaraan belum dipilih, kapasitas tidak ditampilkan (bukan dianggap 0/∞).
// Peringatan kapasitas MUNCUL, TIDAK MEMBLOKIR drop: dispatcher yang tahu
// konteks nyata (satu kasur king vs single beda ruang sebenarnya, kapasitas
// slot ini masih perkiraan kasar) — sistem menandai, manusia memutuskan.
export default function RouteCard({
  route, drivers, vehicles, draggingJobId,
  onDrop, onReorder, onRemoveJob, onAssign, onPublish, onCancel, onDelete, onOptimize,
}) {
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [busy, setBusy] = useState(false);

  const jobs = route.jobs || [];
  const totalUnits = jobs.reduce((sum, j) => sum + unitCountOf(j), 0);
  const kapasitas = route.vehicle?.capacitySlots;
  const overCapacity = kapasitas != null && totalUnits > kapasitas;
  const isDraft = route.status === "DRAFT";

  async function jalankan(fn) {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }

  function handleDropOnCard(e) {
    e.preventDefault();
    setDragOverIdx(null);
    if (!isDraft) return;
    const jobId = e.dataTransfer.getData("text/job-id") || draggingJobId;
    if (jobId) jalankan(() => onDrop(route, jobId, jobs.length));
  }

  function handleDropAtIndex(e, idx) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIdx(null);
    if (!isDraft) return;
    const jobId = e.dataTransfer.getData("text/job-id") || draggingJobId;
    if (!jobId) return;
    const sudahDiRuteIni = jobs.some((j) => j.id === jobId);
    if (sudahDiRuteIni) jalankan(() => onReorder(route, jobId, idx));
    else jalankan(() => onDrop(route, jobId, idx));
  }

  return (
    <div className={cn(
      "flex w-[300px] shrink-0 flex-col rounded-card border bg-surface",
      route.status === "CANCELLED" ? "border-border opacity-60" : "border-border"
    )}>
      {/* Header */}
      <div className="shrink-0 space-y-2 border-b border-line p-3">
        {/* `flex-wrap` (D-055, 4 September 2026) — jaga-jaga kode rute
            panjang + badge status tidak pernah dipaksa berdesakan satu
            baris sampai terpotong. Beda kasus dari baris aksi di bawah
            (overflow SUNGGUHAN, bukan cuma jaga-jaga) — badge status boleh
            turun baris kalau memang mepet, tidak masalah secara makna. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[12.5px] font-bold text-ink">{route.code}</span>
          <StatusBadge map={ROUTE_STATUS_REAL} value={route.status} className="ml-auto shrink-0" />
        </div>

        {isDraft ? (
          // FilterDropdown menggantikan <select> polos (D-055) — komponen
          // ini SUDAH dibangun 31 Agustus 2026 justru untuk kasus persis
          // ini (lihat komentarnya sendiri: menggantikan native select di
          // filter bar Delivery), tapi driver/kendaraan di kartu rute ini
          // terlewat migrasinya. `triggerClassName="w-full max-w-none"`
          // karena aslinya lebar select mengikuti kartu (300px), bukan
          // lebar teks terpilih seperti default FilterDropdown filter bar.
          <>
            <FilterDropdown
              value={route.driverId || ""}
              onChange={(id) => jalankan(() => onAssign(route, { driverId: id || null }))}
              options={drivers.map((d) => ({ value: d.id, label: d.name }))}
              placeholder="Pilih driver…"
              icon={User}
              ariaLabel={`Driver untuk ${route.code}`}
              triggerClassName="w-full max-w-none"
            />
            <FilterDropdown
              value={route.vehicleId || ""}
              onChange={(id) => jalankan(() => onAssign(route, { vehicleId: id || null }))}
              options={vehicles.map((v) => ({ value: v.id, label: `${v.plateNumber} · ${v.capacitySlots} slot` }))}
              placeholder="Pilih kendaraan…"
              icon={Truck}
              ariaLabel={`Kendaraan untuk ${route.code}`}
              triggerClassName="w-full max-w-none"
            />
          </>
        ) : (
          <div className="text-[11.5px] text-ink2">
            {route.driver?.name || "Tanpa driver"} · {route.vehicle?.plateNumber || "Tanpa kendaraan"}
          </div>
        )}

        <div className={cn("flex items-center justify-between text-[10.5px]", overCapacity ? "font-semibold text-red" : "text-ink3")}>
          <span>{jobs.length} stop{kapasitas != null && ` · ${totalUnits}/${kapasitas} slot`}</span>
          {route.plannedDistanceKm != null && <span>{route.plannedDistanceKm} km · {route.plannedDurationMin} mnt</span>}
        </div>
        {overCapacity && (
          <p className="text-[10px] font-semibold text-red">Melebihi kapasitas kendaraan yang dipilih.</p>
        )}
      </div>

      {/* Daftar stop — drop target */}
      <div
        onDragOver={(e) => { if (isDraft) { e.preventDefault(); setDragOverIdx(jobs.length); } }}
        onDrop={handleDropOnCard}
        className={cn("min-h-[80px] flex-1 space-y-1.5 p-2", dragOverIdx !== null && isDraft && "bg-accentbg/40")}
      >
        {jobs.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11px] text-ink3">
            {isDraft ? "Seret job ke sini" : "Tidak ada stop"}
          </p>
        ) : (
          jobs
            .slice()
            .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
            .map((j, idx) => (
              <div
                key={j.id}
                draggable={isDraft}
                onDragStart={(e) => e.dataTransfer.setData("text/job-id", j.id)}
                onDragOver={(e) => { if (isDraft) { e.preventDefault(); e.stopPropagation(); setDragOverIdx(idx); } }}
                onDrop={(e) => handleDropAtIndex(e, idx)}
                className={cn(
                  "flex items-start gap-1.5 rounded-btn border border-border bg-inset px-2 py-1.5",
                  isDraft && "cursor-grab active:cursor-grabbing",
                  dragOverIdx === idx && "ring-2 ring-accent"
                )}
              >
                {isDraft && <GripVertical size={12} className="mt-0.5 shrink-0 text-ink3" aria-hidden />}
                <span className="mt-0.5 shrink-0 text-[10px] font-bold text-ink3">{idx + 1}.</span>
                {/* Avatar gradien (D-055) — konsisten dengan pola
                    avatar-forward di seluruh Delivery Hub (Dashboard,
                    Papan); sebelumnya stop di sini cuma teks polos tanpa
                    identitas visual sama sekali. */}
                <Avatar name={customerOf(j) || "?"} size="sm" gradient className="mt-0.5 h-5 w-5 shrink-0 text-[8px]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] font-semibold text-ink">{customerOf(j) || "Tanpa nama"}</div>
                  <div className="truncate text-[10px] text-ink2">{j.addressText || "—"}</div>
                  <JobMetaRow job={j} className="mt-1" />
                </div>
                {isDraft && (
                  <button
                    type="button"
                    onClick={() => jalankan(() => onRemoveJob(route, j.id))}
                    aria-label={`Keluarkan job dari ${route.code}`}
                    className="mt-0.5 shrink-0 text-ink3 transition-colors hover:text-red"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))
        )}
      </div>

      {/* Aksi — dirombak (D-055, 4 September 2026): 3 tombol icon+teks
          berdampingan ("Urutkan"+"Batal"+"Terbitkan") tidak muat dalam kartu
          300px (284px setelah padding) — laporan owner: tombol "Terbitkan"
          kepotong jadi "Ter" di layar. Urutkan & Batal SEKARANG ikon-saja
          (title tetap ada untuk tooltip + aria-label untuk screen reader),
          menyisakan ruang penuh untuk Terbitkan sebagai CTA utama —
          satu-satunya aksi di sini yang benar-benar tidak boleh gagal
          terbaca (itu yang mengirim rute ke driver). */}
      {isDraft && (
        <div className="flex shrink-0 items-center gap-1.5 border-t border-line p-2">
          <button
            type="button"
            onClick={() => jalankan(() => onOptimize(route))}
            disabled={jobs.length < 2 || busy}
            title="Urutkan stop berdasarkan jam, lalu jarak terdekat (kalau semua stop sudah punya koordinat) — kalau belum, diurutkan berdasarkan alamat"
            aria-label="Urutkan stop"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-chip text-ink2 transition-colors hover:bg-hovertint disabled:opacity-40"
          >
            <ArrowUpDown size={13} />
          </button>
          <button
            type="button"
            onClick={() => jalankan(() => onCancel(route))}
            disabled={busy}
            title="Batalkan rute (riwayatnya tetap tersimpan)"
            aria-label="Batalkan rute"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-chip text-ink3 transition-colors hover:bg-redbg hover:text-red disabled:opacity-40"
          >
            <Ban size={13} />
          </button>
          {/* Hapus permanen (D-059) — TERPISAH dari Batalkan: draft yang
              salah pilih/coba-coba dibuang total, bukan disimpan sebagai
              riwayat. Cuma tampil untuk DRAFT (halaman ini memang cuma
              merender aksi ini di dalam `{isDraft && (...)}`), backend
              menegakkan ulang aturan yang sama. */}
          <button
            type="button"
            onClick={() => jalankan(() => onDelete(route))}
            disabled={busy}
            title="Hapus rute permanen"
            aria-label="Hapus rute permanen"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-chip text-ink3 transition-colors hover:bg-redbg hover:text-red disabled:opacity-40"
          >
            <Trash2 size={13} />
          </button>
          <button
            type="button"
            onClick={() => jalankan(() => onPublish(route))}
            disabled={busy || jobs.length === 0 || !route.driverId}
            title={!route.driverId ? "Pilih driver dulu" : jobs.length === 0 ? "Tambahkan job dulu" : "Terbitkan ke driver"}
            className="ml-auto flex h-8 flex-1 max-w-[160px] items-center justify-center gap-1.5 rounded-btn bg-accent text-[12px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Terbitkan
          </button>
        </div>
      )}
    </div>
  );
}
