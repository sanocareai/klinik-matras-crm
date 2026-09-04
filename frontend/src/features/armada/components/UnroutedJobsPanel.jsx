import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Package, MapPinned, AlertTriangle, ChevronDown, ArrowUpRight } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import Avatar from "@/components/Avatar.jsx";
import { cn } from "@/lib/utils.js";
import { customerOf, unitCountOf, cityOf } from "../jobStatus.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";

// Panel kiri Route Planner: job pada rentang terpilih yang BELUM masuk rute
// mana pun (routeId=null). Diseret ke salah satu RouteCard di kanan.
//
// SEDERHANAKAN (D-068, 4 September 2026) — MENGGANTIKAN bulk-add checkbox +
// dropdown "Pilih rute tujuan" + tombol "Tambahkan" (D-058, sehari
// sebelumnya). Laporan owner: drag-and-drop saja sudah cukup, gak perlu
// jalur kedua yang justru nambah langkah (centang → pilih dropdown → klik
// tombol) untuk hal yang bisa langsung diseret. Setiap job SEKARANG hanya
// draggable — ke RouteCard MANAPUN yang masih DRAFT (RouteCard.jsx sendiri
// yang menolak drop kalau rute sudah DITERBITKAN/dibatalkan, lewat guard
// `isDraft` di situ — tidak diulang di sini).
//
// Drag & drop HTML5 native — pola yang SAMA dengan Pipeline.jsx (Kanban lead),
// bukan library baru. `draggable` + onDragStart menaruh job.id di dataTransfer;
// RouteCard yang membacanya di onDrop.
//
// PENGELOMPOKAN KOTA (D-058, DIPERTAHANKAN) — job dikelompokkan per
// Order.deliveryCity, kota dengan 2+ job muncul PALING ATAS dengan label
// "kandidat 1 rute" (bukan otomatis dibuatkan rute — cuma petunjuk visual,
// dispatcher yang putuskan apa searah beneran layak digabung, lalu seret
// satu-satu ke rute yang sama). Kota dengan 1 job atau tanpa kota (alamat
// belum lengkap) tetap tampil di kelompok "Lainnya" di bawah, TIDAK
// disembunyikan — order itu tetap harus terlihat & terjadwalkan.
export default function UnroutedJobsPanel({
  jobs, undatedJobs = [], loading, draggingId, onDragStart, onDragEnd,
}) {
  const navigate = useNavigate();
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

  function JobRow({ j }) {
    return (
      <li
        draggable
        onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/job-id", j.id); onDragStart(j); }}
        onDragEnd={onDragEnd}
        className={cn(
          // `dh-job-card` (D-072, 4 September 2026) — kaca bertingkat di
          // atas panel yang sudah kaca, MENGGANTIKAN `bg-surface` polos
          // yang laporan owner nilai "kurang cocok dengan style yang sudah
          // dibangun" (lihat delivery-dark.css/delivery-light.css untuk
          // definisi visualnya). `transition-all` (bukan cuma
          // transition-opacity) + `scale` saat digeser — bahasa gerak yang
          // SAMA dengan stop card di RouteCard.jsx (D-072 juga di sana).
          // `select-none` (D-073) — sama alasan dengan RouteCard.jsx: tanpa
          // ini, gestur drag PERTAMA di atas teks nama/alamat sering
          // "dimakan" seleksi teks bawaan browser, baru percobaan KEDUA
          // yang benar-benar jalan sebagai drag ("klik dulu, baru bisa
          // pindahkan" — laporan owner).
          "dh-job-card flex cursor-grab select-none items-start gap-2 rounded-btn border border-border bg-surface px-2.5 py-2 transition-all duration-150 active:cursor-grabbing",
          draggingId === j.id && "scale-[0.97] opacity-40"
        )}
      >
        <Avatar name={customerOf(j) || "?"} size="sm" gradient className="mt-0.5 h-6 w-6 shrink-0 text-[9px]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-ink">{customerOf(j) || "Tanpa nama"}</div>
          <div className="mt-0.5 truncate text-[10.5px] text-ink2">{j.addressText || "Alamat belum diisi"}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-ink3">
            {/* Tanggal ikut ditampilkan (D-063, 4 September 2026) — sejak
                panel ini bisa menampilkan RENTANG tanggal (bukan cuma satu
                hari terkunci), job dari hari berbeda tercampur dalam satu
                daftar; tanpa ini tidak ada cara tahu job mana untuk hari
                apa hanya dari kartunya sendiri. */}
            {j.scheduledDate && (
              <>
                <span className="font-semibold text-ink2">{formatTanggalPendek(j.scheduledDate)}</span>
                <span aria-hidden>·</span>
              </>
            )}
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
        <p className="text-[10.5px] text-ink3">{jobs?.length ?? 0} job — seret ke rute mana pun (selama belum diterbitkan)</p>
      </div>

      {/* Backlog TANPA TANGGAL SAMA SEKALI (D-062, 4 September 2026 —
          laporan owner: "di Jadwal & Penugasan banyak order yang belum
          dijadwalkan dan belum masuk rute", tapi panel di atas cuma
          mengecek tanggal yang SEDANG dibuka — job tanpa tanggal apa pun
          tidak pernah cocok filter tanggal manapun, jadi tidak pernah
          kelihatan). SENGAJA TIDAK draggable seperti job di bawah — rute
          selalu terikat SATU tanggal pasti, jadi job ini wajib dikasih
          tanggal dulu (di Jadwal & Penugasan) sebelum bisa masuk rute
          mana pun. Ini murni pengingat + jalan pintas ke sana, bukan drag
          source kedua. */}
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

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-btn bg-inset" />)}
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Semua job sudah masuk rute"
            description="Atau belum ada job terjadwal pada rentang tanggal ini."
          />
        ) : (
          <div className="space-y-3">
            {groups.kandidat.map(({ kota, list }) => (
              <div key={kota}>
                <span className="mb-1 flex items-center gap-1 px-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                  <MapPinned size={11} /> {kota} · kandidat 1 rute
                </span>
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
