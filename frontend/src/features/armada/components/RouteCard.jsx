import React, { useState } from "react";
import { GripVertical, X, ArrowUpDown, Send, Ban, Trash2, Loader2, User, Users, Truck, Pencil, Check } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { FilterDropdown } from "@/components/ui/filter-dropdown.jsx";
import Avatar from "@/components/Avatar.jsx";
import StatusBadge from "./StatusBadge.jsx";
import { ROUTE_STATUS_REAL } from "../vehicleStatus.js";
import { customerOf, unitCountOf, jobTypeCardStyle, rentalCardAccentStyle, isRentalOrder } from "../jobStatus.js";
import { JobMetaRow, JobTypeBadge, RentalBadge, ConfirmedTimeBadge, ServiceLabel } from "./JobBadges.jsx";
import { formatTanggal } from "@/utils/formatDate.js";

// Satu kolom rute di Route Planner — drop target untuk job dari panel kiri
// ATAU dari kolom rute lain, plus drag-reorder stop di dalamnya.
//
// KAPASITAS dihitung dari SUM(unitCount job) vs vehicle.capacitySlots — kalau
// kendaraan belum dipilih, kapasitas tidak ditampilkan (bukan dianggap 0/∞).
// Peringatan kapasitas MUNCUL, TIDAK MEMBLOKIR drop: dispatcher yang tahu
// konteks nyata (satu kasur king vs single beda ruang sebenarnya, kapasitas
// slot ini masih perkiraan kasar) — sistem menandai, manusia memutuskan.
export default function RouteCard({
  route, drivers, vehicles, helpers = [], draggingJobId,
  onDrop, onReorder, onRemoveJob, onAssign, onPublish, onCancel, onDelete, onOptimize,
}) {
  const [dragOverIdx, setDragOverIdx] = useState(null);
  // Stop yang SEDANG diseret (D-072, 4 September 2026) — SEBELUMNYA tidak
  // ada tanda visual apa pun pada item sumbernya sendiri saat digeser
  // (cuma target drop yang dapat ring), beda dari UnroutedJobsPanel yang
  // sudah memudarkan item sumber. Ditambahkan supaya drag terasa satu
  // bahasa gerak yang sama di kedua tempat — laporan owner: "animasi
  // drag & drop-nya ga smooth".
  const [draggingStopId, setDraggingStopId] = useState(null);
  const [busy, setBusy] = useState(false);
  // Edit rute setelah diterbitkan (redesain Route Planner, Sep 2026) — null
  // = terkunci seperti biasa. String = SEDANG diedit darurat, isinya alasan
  // yang diminta sekali di awal (window.prompt, pola sama dengan confirm()
  // yang sudah dipakai Batalkan/Hapus di ArmadaRoutes.jsx — bukan modal
  // baru untuk satu field teks) dan dikirim ke SETIAP mutasi selama sesi
  // edit ini (backend PATCH /routes/:id & /routes/:id/jobs mewajibkannya
  // untuk rute PUBLISHED, lihat armada.js). Tidak ada tombol "Simpan"
  // terpisah — tiap aksi (drag, ganti driver, dst) sudah menyimpan LANGSUNG
  // persis seperti mode Draft, "Selesai" di bawah cuma menutup mode edit.
  const [editingReason, setEditingReason] = useState(null);

  const jobs = route.jobs || [];
  const totalUnits = jobs.reduce((sum, j) => sum + unitCountOf(j), 0);
  const kapasitas = route.vehicle?.capacitySlots;
  const overCapacity = kapasitas != null && totalUnits > kapasitas;
  const isDraft = route.status === "DRAFT";
  const canEmergencyEdit = route.status === "PUBLISHED";
  // Kontrol interaktif (drag/drop, dropdown driver, tombol keluarkan) tampil
  // untuk DRAFT seperti biasa ATAU rute PUBLISHED yang SEDANG dalam sesi
  // edit darurat — dua kondisi beda tapi bentuk UI-nya sama persis.
  const isEditable = isDraft || editingReason != null;

  async function jalankan(fn) {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }

  function mulaiEditDarurat() {
    const alasan = window.prompt("Rute ini sudah diterbitkan (driver sudah lihat). Tulis alasan singkat kenapa perlu diedit sekarang:");
    if (!alasan?.trim()) return; // batal kalau kosong/Cancel
    setEditingReason(alasan.trim());
  }

  function handleDropOnCard(e) {
    e.preventDefault();
    setDragOverIdx(null);
    if (!isEditable) return;
    const jobId = e.dataTransfer.getData("text/job-id") || draggingJobId;
    if (jobId) jalankan(() => onDrop(route, jobId, jobs.length, editingReason));
  }

  function handleDropAtIndex(e, idx) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIdx(null);
    if (!isEditable) return;
    const jobId = e.dataTransfer.getData("text/job-id") || draggingJobId;
    if (!jobId) return;
    const sudahDiRuteIni = jobs.some((j) => j.id === jobId);
    if (sudahDiRuteIni) jalankan(() => onReorder(route, jobId, idx, editingReason));
    else jalankan(() => onDrop(route, jobId, idx, editingReason));
  }

  return (
    // w-full (D-060, 4 September 2026) — SEBELUMNYA w-[300px] shrink-0,
    // dibuat untuk baris flex yang digulir horizontal (ArmadaRoutes.jsx
    // lama). Sekarang parent-nya grid yang membungkus ke baris baru, jadi
    // kartu ini harus mengisi lebar KOLOM grid (ditentukan grid-cols di
    // ArmadaRoutes.jsx), bukan memaksa lebar sendiri 300px yang bisa
    // meleset dari lebar kolom sesungguhnya.
    <div className={cn(
      "flex h-full min-h-[280px] w-full flex-col rounded-card border bg-surface",
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
        {/* Tanggal rute (D-063, 4 September 2026) — Route Planner sekarang
            defaultnya menampilkan SEMUA tanggal sekaligus (bukan terkunci
            satu hari), jadi kartu-kartu ini bisa bercampur dari hari
            berbeda — tanpa baris ini, satu-satunya petunjuk tanggal cuma
            tersirat di dalam kode rute (mis. "RTE-040926-01"). */}
        {route.date && <p className="text-[10.5px] text-ink3">{formatTanggal(route.date)}</p>}

        {isEditable ? (
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
              onChange={(id) => jalankan(() => onAssign(route, { driverId: id || null }, editingReason))}
              options={drivers.map((d) => ({ value: d.id, label: d.name }))}
              placeholder="Pilih driver…"
              icon={User}
              ariaLabel={`Driver untuk ${route.code}`}
              triggerClassName="w-full max-w-none"
            />
            {/* Helper (D-077, 4 September 2026) — DULU cuma driver+kendaraan
                di sini, helper wajib diisi manual per-job di Penjadwalan
                setelah rute diterbitkan (2 skema penugasan terpisah,
                laporan owner). Sekarang satu tempat, satu skema: driver,
                helper, kendaraan semua diatur DI SINI, ikut disalin ke
                setiap job saat "Terbitkan" (lihat POST /routes/:id/publish). */}
            <FilterDropdown
              value={route.helperId || ""}
              onChange={(id) => jalankan(() => onAssign(route, { helperId: id || null }, editingReason))}
              options={helpers.map((h) => ({ value: h.id, label: h.name }))}
              placeholder="Pilih helper (opsional)…"
              icon={Users}
              ariaLabel={`Helper untuk ${route.code}`}
              triggerClassName="w-full max-w-none"
            />
            <FilterDropdown
              value={route.vehicleId || ""}
              onChange={(id) => jalankan(() => onAssign(route, { vehicleId: id || null }, editingReason))}
              options={vehicles.map((v) => ({ value: v.id, label: `${v.plateNumber} · ${v.capacitySlots} slot` }))}
              placeholder="Pilih kendaraan…"
              icon={Truck}
              ariaLabel={`Kendaraan untuk ${route.code}`}
              triggerClassName="w-full max-w-none"
            />
            {/* Cuma tampil saat SEDANG edit darurat (bukan Draft biasa) —
                Draft tidak butuh tombol "selesai", tidak pernah masuk mode
                ini. */}
            {editingReason != null && (
              <button
                type="button"
                onClick={() => setEditingReason(null)}
                className="flex h-8 w-full items-center justify-center gap-1.5 rounded-btn bg-greenbg text-[11.5px] font-bold text-green transition-opacity hover:opacity-80"
              >
                <Check size={13} /> Selesai Edit
              </button>
            )}
          </>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 text-[11.5px] text-ink2">
              {route.driver?.name || "Tanpa driver"}
              {route.helper?.name && ` + ${route.helper.name}`} · {route.vehicle?.plateNumber || "Tanpa kendaraan"}
            </div>
            {/* Edit darurat (redesain Sep 2026) — HANYA untuk PUBLISHED.
                IN_PROGRESS/COMPLETED/CANCELLED tetap terkunci total (lihat
                canEmergencyEdit) — rute yang sedang/sudah dijalankan atau
                dibatalkan bukan kasus "rencana berubah mendadak". */}
            {canEmergencyEdit && (
              <button
                type="button"
                onClick={mulaiEditDarurat}
                title="Rute sudah diterbitkan — edit tetap bisa, wajib isi alasan (tercatat)"
                className="flex shrink-0 items-center gap-1 rounded-chip px-1.5 py-1 text-[10.5px] font-semibold text-ink3 transition-colors hover:bg-hovertint hover:text-accent"
              >
                <Pencil size={11} /> Edit
              </button>
            )}
          </div>
        )}
        {/* Jejak edit darurat terakhir (Route.lastEditReason, kolom biasa
            bukan ledger — lihat catatan panjang di schema.prisma) — tampil
            terus walau sesi edit sudah selesai, supaya dispatcher lain yang
            buka Route Planner tahu rute ini pernah diubah setelah
            diterbitkan, bukan cuma orang yang mengedit yang tahu. */}
        {route.status !== "DRAFT" && route.lastEditReason && (
          <p className="rounded-btn bg-orangebg px-2 py-1 text-[10px] text-orange">
            Diedit {route.lastEditedBy?.name ? `oleh ${route.lastEditedBy.name} ` : ""}
            {route.lastEditedAt ? `(${formatTanggal(route.lastEditedAt)}) ` : ""}
            — {route.lastEditReason}
          </p>
        )}

        <div className={cn("flex items-center justify-between text-[10.5px]", overCapacity ? "font-semibold text-red" : "text-ink3")}>
          <span>{jobs.length} stop{kapasitas != null && ` · ${totalUnits}/${kapasitas} slot`}</span>
          {route.plannedDistanceKm != null && <span>{route.plannedDistanceKm} km · {route.plannedDurationMin} mnt</span>}
        </div>
        {overCapacity && (
          <p className="text-[10px] font-semibold text-red">Melebihi kapasitas kendaraan yang dipilih.</p>
        )}
      </div>

      {/* Daftar stop — drop target. `transition-colors` (D-072) — tint
          drop-zone SEBELUMNYA muncul/hilang seketika, terasa "kedip"
          dibanding transisi halus yang sudah jadi standar di tempat lain
          (kartu, popover). */}
      <div
        onDragOver={(e) => { if (isEditable) { e.preventDefault(); setDragOverIdx(jobs.length); } }}
        onDrop={handleDropOnCard}
        className={cn(
          "min-h-[80px] flex-1 space-y-1.5 p-2 transition-colors duration-150",
          dragOverIdx !== null && isEditable && "bg-accentbg/40"
        )}
      >
        {jobs.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11px] text-ink3">
            {isEditable ? "Seret job ke sini" : "Tidak ada stop"}
          </p>
        ) : (
          jobs
            .slice()
            .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
            .map((j, idx) => (
              <div
                key={j.id}
                draggable={isEditable}
                onDragStart={(e) => { e.dataTransfer.setData("text/job-id", j.id); setDraggingStopId(j.id); }}
                onDragOver={(e) => { if (isEditable) { e.preventDefault(); e.stopPropagation(); setDragOverIdx(idx); } }}
                onDrop={(e) => handleDropAtIndex(e, idx)}
                onDragEnd={() => { setDraggingStopId(null); setDragOverIdx(null); }}
                style={{ ...jobTypeCardStyle(j), ...rentalCardAccentStyle(j) }}
                className={cn(
                  // `dh-stop-card` (D-072) — kaca bertingkat di atas kartu
                  // rute yang sudah kaca, MENGGANTIKAN `bg-inset` polos yang
                  // laporan owner nilai "kurang cocok dengan style yang
                  // sudah dibangun" (lihat delivery-dark.css/delivery-light.css
                  // untuk definisi visualnya). `transition-all` (bukan cuma
                  // transition-colors) supaya ring, opacity, DAN transform
                  // (drag state di bawah) semua ikut halus, bukan cuma
                  // sebagian.
                  // `select-none` (D-073, 4 September 2026) — laporan
                  // owner: "skema saat ini klik dulu, baru bisa pindahkan".
                  // Akar masalahnya: TANPA ini, gestur drag PERTAMA di atas
                  // teks nama/alamat sering "dimakan" oleh seleksi teks
                  // bawaan browser (bukan native drag), bukan cuma di sini
                  // — perilaku browser umum untuk elemen draggable berisi
                  // teks. Baru di percobaan KEDUA (setelah seleksi
                  // ke-clear oleh klik) drag benar-benar jalan. Menonaktifkan
                  // seleksi teks di sini memastikan gestur drag PERTAMA
                  // langsung terbaca sebagai drag, bukan seleksi.
                  //
                  // jobTypeCardTint (lanjutan redesain Sep 2026) — gradasi
                  // PENUH per tipe job (Pengambilan/Pengiriman), lihat catatan
                  // panjang di jobStatus.js. `bg-inset` DIPERTAHANKAN sebagai
                  // background-color dasar (gradient-nya background-image,
                  // dua-duanya tampil bersamaan, bukan saling menimpa).
                  // `dh-bar-left` untuk Sewa (rentalCardAccentStyle di atas
                  // mengisi --dh-bar oranye) — kalau bukan Sewa, class ini
                  // tidak py efek apa pun (fallback var(--dh-accent) TIDAK
                  // dipakai di sini karena style inline tidak di-set).
                  "dh-stop-card relative flex select-none items-start gap-1.5 rounded-btn border border-border bg-inset px-2 py-1.5 transition-all duration-150",
                  isRentalOrder(j) && "dh-bar-left",
                  isEditable && "cursor-grab active:cursor-grabbing",
                  dragOverIdx === idx && "ring-2 ring-accent",
                  // Item yang sedang digeser memudar + sedikit mengecil —
                  // penanda visual yang SEBELUMNYA tidak ada sama sekali di
                  // sini (beda dari UnroutedJobsPanel yang sudah punya ini),
                  // sekarang bahasa gerak drag konsisten di kedua tempat.
                  draggingStopId === j.id && "scale-[0.97] opacity-40"
                )}
              >
                {isEditable && <GripVertical size={12} className="mt-0.5 shrink-0 text-ink3" aria-hidden />}
                <span className="mt-0.5 shrink-0 text-[10px] font-bold text-ink3">{idx + 1}.</span>
                {/* Avatar gradien (D-055) — konsisten dengan pola
                    avatar-forward di seluruh Delivery Hub (Dashboard,
                    Papan); sebelumnya stop di sini cuma teks polos tanpa
                    identitas visual sama sekali. */}
                <Avatar name={customerOf(j) || "?"} size="sm" gradient className="mt-0.5 h-5 w-5 shrink-0 text-[8px]" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <JobTypeBadge job={j} />
                    <RentalBadge job={j} />
                  </div>
                  <div className="mt-1 truncate text-[11.5px] font-semibold text-ink">{customerOf(j) || "Tanpa nama"}</div>
                  <ServiceLabel job={j} />
                  <div className="truncate text-[10px] text-ink2">{j.addressText || "—"}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <ConfirmedTimeBadge job={j} />
                  </div>
                  <JobMetaRow job={j} className="mt-1" />
                </div>
                {isEditable && (
                  <button
                    type="button"
                    onClick={() => jalankan(() => onRemoveJob(route, j.id, editingReason))}
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

      {/* Hapus untuk rute yang SUDAH dibatalkan (D-061, 4 September 2026 —
          laporan owner: "tadi gue coba batalkan, buatkan skema yang
          dibatalkan juga bisa dihapus"). Urutkan/Terbitkan tidak relevan
          lagi di sini (rute ini tidak akan pernah jalan) — cuma Hapus,
          sengaja SATU tombol saja supaya tidak ambigu dengan aksi rute
          aktif di atas. */}
      {route.status === "CANCELLED" && (
        <div className="flex shrink-0 items-center justify-end border-t border-line p-2">
          <button
            type="button"
            onClick={() => jalankan(() => onDelete(route))}
            disabled={busy}
            className="flex h-7 items-center gap-1.5 rounded-chip px-2.5 text-[11.5px] font-semibold text-ink3 transition-colors hover:bg-redbg hover:text-red disabled:opacity-40"
          >
            <Trash2 size={13} /> Hapus rute ini
          </button>
        </div>
      )}
    </div>
  );
}
