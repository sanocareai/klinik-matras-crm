import React, { useMemo, useState } from "react";
import { Package, MapPinned, PackageCheck } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { FilterDropdown } from "@/components/ui/filter-dropdown.jsx";
import Avatar from "@/components/Avatar.jsx";
import { cn } from "@/lib/utils.js";
import { customerOf, unitCountOf, cityOf, jobTypeCardStyle, rentalCardAccentStyle, isRentalOrder, orderStatusOf } from "../jobStatus.js";
import { RentalBadge, ServiceLabel, ConfirmedTimeBadge, CityBadge, OrderStatusBadge } from "./JobBadges.jsx";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import { ORDER_STATUS_LABELS } from "@/utils/format.js";

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
// PENGELOMPOKAN KOTA (D-058, DIREVISI Sep 2026) — job dikelompokkan per
// Order.deliveryCity. SEBELUM revisi ini, kota dengan HANYA 1 job ikut
// dilempar ke "Lainnya" tanpa label kota sama sekali — laporan owner:
// "Esty Bagus kotanya udah diisi Bandung tapi kok gaada kotanya?" Dicek
// LANGSUNG ke database produksi: delivery_city order itu MEMANG terisi
// "Bandung" — bukan data kosong, bukan bug pembacaan field. Akar masalah
// SEBENARNYA: ambang "kandidat 1 rute" butuh 2+ job SEKOTA, dan saat itu
// dia satu-satunya job Bandung yang belum masuk rute — jadi menurut logic
// LAMA dianggap "tidak cukup ramai untuk section sendiri" dan disamakan
// dengan job yang MEMANG tidak ada kotanya sama sekali. Dua kasus itu beda
// makna (tidak ada kota vs cuma sendirian) tapi sebelumnya diperlakukan
// SAMA — itu yang diperbaiki di sini.
//
// SEKARANG: SETIAP kota (walau cuma 1 job) dapat section+label sendiri.
// Kota 2+ job TETAP ditandai "kandidat 1 rute" dan naik ke atas (peluang
// gabung rute paling besar) — bukan dihapus, cuma bukan lagi satu-satunya
// yang dapat label. Kota 1 job tampil di bawahnya, urut alfabet. HANYA job
// yang delivery_city-nya BENAR-BENAR kosong yang jatuh ke "Belum Ada Kota"
// di paling bawah — label ini sekarang JUJUR (cuma kasus kota kosong
// sungguhan), bukan bercampur dengan "kota sepi" seperti sebelumnya.
// Kartu SATU job di panel ini (D-074, 4 September 2026) — DIPINDAH ke luar
// UnroutedJobsPanel, jadi komponen level-atas sendiri, bukan lagi
// didefinisikan DI DALAM body UnroutedJobsPanel seperti sebelumnya.
//
// ⚠️ BUG NYATA yang diperbaiki: fungsi komponen yang didefinisikan DI DALAM
// body komponen lain dibuat ULANG (referensi fungsi baru) setiap parent-nya
// re-render — React mengidentifikasi tipe komponen dari REFERENSI fungsi,
// bukan namanya, jadi "komponen baru" berarti React MEMBONGKAR elemen DOM
// lama dan MEMASANG yang baru dari nol, bukan sekadar update props ke DOM
// yang sama. Laporan owner: job di panel ini butuh diklik SATU KALI dulu
// (warna sempat berubah) baru bisa benar-benar diseret — persis gejala drag
// native yang gagal karena target `mousedown`-nya (elemen DOM lama) sudah
// diganti elemen baru SEBELUM ambang jarak drag browser tercapai, dan
// gestur browser jadi "putus" di tengah jalan pada percobaan pertama.
// Percobaan KEDUA berhasil karena parent sudah berhenti re-render saat itu,
// DOM-nya stabil sepanjang gestur. Kartu stop di RouteCard.jsx TIDAK kena
// masalah ini karena ditulis inline (bukan komponen bersarang terpisah).
function JobRow({ j, draggingId, onDragStart, onDragEnd, onOpenJob }) {
  return (
    <li
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/job-id", j.id); onDragStart(j); }}
      onDragEnd={onDragEnd}
      // Klik 1x buka JobDetailDrawer — sama persis dengan RouteCard.jsx,
      // lihat catatan panjang di sana. Aman berdampingan dengan `draggable`.
      onClick={() => onOpenJob?.(j.id)}
      style={{ ...jobTypeCardStyle(j), ...rentalCardAccentStyle(j) }}
      className={cn(
        // `dh-job-card` (D-072, 4 September 2026) — kaca bertingkat di
        // atas panel yang sudah kaca, MENGGANTIKAN `bg-surface` polos
        // yang laporan owner nilai "kurang cocok dengan style yang sudah
        // dibangun" (lihat delivery-dark.css/delivery-light.css untuk
        // definisi visualnya). `transition-all` (bukan cuma
        // transition-opacity) + `scale` saat digeser — bahasa gerak yang
        // SAMA dengan stop card di RouteCard.jsx (D-072 juga di sana).
        // `select-none` (D-073) — mencegah gestur drag "dimakan" seleksi
        // teks bawaan browser (perbaikan valid, tapi TERNYATA bukan akar
        // masalah utama laporan "klik dulu baru bisa pindahkan" — itu
        // bug remount di atas).
        //
        // jobTypeCardTint/dh-bar-left (lanjutan redesain Sep 2026) — sama
        // persis dengan RouteCard.jsx, lihat catatan panjang di
        // jobStatus.js#jobTypeCardTint.
        "dh-job-card relative flex cursor-grab select-none items-start gap-2 rounded-btn border border-border bg-surface px-2.5 py-2 transition-all duration-150 active:cursor-grabbing",
        isRentalOrder(j) && "dh-bar-left",
        draggingId === j.id && "scale-[0.97] opacity-40"
      )}
    >
      <Avatar name={customerOf(j) || "?"} size="sm" gradient className="mt-0.5 h-6 w-6 shrink-0 text-[9px]" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1">
          <RentalBadge job={j} />
          {/* CityBadge di sini TERASA redundan dengan header section kota
              di panel ini sendiri, TAPI kartu yang sama (JobRow) juga
              dipakai secara visual sebagai acuan drag — begitu di-drag ke
              RouteCard, konteks section-nya hilang. Tetap sengaja
              ditampilkan, konsisten dengan permintaan "setiap card" &
              RouteCard.jsx/ArmadaJobs.jsx yang memang tidak py section kota
              sama sekali. */}
          <CityBadge job={j} />
          <OrderStatusBadge job={j} />
        </div>
        <div className="mt-1 truncate text-[12px] font-semibold text-ink">{customerOf(j) || "Tanpa nama"}</div>
        <ServiceLabel job={j} />
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
        <div className="mt-1"><ConfirmedTimeBadge job={j} /></div>
      </div>
    </li>
  );
}

export default function UnroutedJobsPanel({
  jobs, undatedJobs = [], loading, draggingId, onDragStart, onDragEnd, onOpenJob,
}) {
  // Job TANPA tanggal digabung LANGSUNG ke daftar biasa (6 September 2026,
  // laporan owner: "masukkan aja di 'belum masuk rute' agar ga bolak balik
  // dari rute planner trus ke jadwal penugasan") — dulu SENGAJA dipisah ke
  // panel collapsed non-draggable karena "rute selalu terikat SATU tanggal
  // pasti, job ini wajib dikasih tanggal dulu di Jadwal & Penugasan".
  // Alasan itu SUDAH TIDAK BERLAKU sejak PATCH /routes/:id/jobs menyamakan
  // scheduledDate job ke Route.date otomatis begitu ditempel ke rute (lihat
  // catatan di armada.js) — job tanpa tanggal sekarang AMAN diseret
  // langsung, tanggalnya otomatis terisi dari rute tujuan. JobRow sendiri
  // sudah menangani job.scheduledDate kosong dengan baik (baris tanggal
  // cuma tidak tampil, bukan error/kosong aneh).
  // Filter status Order (6 September 2026, laporan owner: "tambahkan juga
  // filter status order/pipelines... dibagian belum masuk rute aja") —
  // LOKAL ke panel ini (bukan lewat ArmadaRoutes.jsx/server), karena
  // jobs/undatedJobs sudah dimuat penuh (take 500) di klien; menyaring di
  // sini cukup, tidak perlu bolak-balik ke server. Options-nya PERSIS
  // ORDER_STATUS_LABELS yang sama dipakai Jadwal & Penugasan/Orders.jsx/
  // Pipeline.jsx (dikurangi varian SEWA_*, beda lifecycle) — kategori
  // konsisten di seluruh app.
  const [fOrderStatus, setFOrderStatus] = useState("");

  const semuaJob = useMemo(() => {
    const gabungan = [...jobs, ...undatedJobs];
    if (!fOrderStatus) return gabungan;
    return gabungan.filter((j) => orderStatusOf(j) === fOrderStatus);
  }, [jobs, undatedJobs, fOrderStatus]);

  const groups = useMemo(() => {
    const byCity = new Map();
    const tanpaKota = [];
    for (const j of semuaJob) {
      const kota = cityOf(j);
      if (!kota) { tanpaKota.push(j); continue; }
      if (!byCity.has(kota)) byCity.set(kota, []);
      byCity.get(kota).push(j);
    }
    const semuaKota = [...byCity.entries()].map(([kota, list]) => ({ kota, list }));
    // Kota 2+ job ("kandidat 1 rute") duluan, urut TERBANYAK — peluang
    // gabung rute paling besar. Kota 1 job menyusul, urut alfabet (tidak
    // ada dasar prioritas lain untuk kota yang cuma py 1 job).
    semuaKota.sort((a, b) => {
      const aKandidat = a.list.length >= 2, bKandidat = b.list.length >= 2;
      if (aKandidat !== bKandidat) return aKandidat ? -1 : 1;
      if (aKandidat) return b.list.length - a.list.length;
      return a.kota.localeCompare(b.kota, "id");
    });
    return { semuaKota, tanpaKota };
  }, [semuaJob]);

  return (
    <div className="flex h-full flex-col rounded-card border border-border bg-surface">
      <div className="shrink-0 space-y-2 border-b border-line px-3 py-2.5">
        <div>
          <h3 className="text-[12.5px] font-bold text-ink">Belum Masuk Rute</h3>
          <p className="text-[10.5px] text-ink3">{semuaJob.length} job — seret ke rute mana pun (selama belum diterbitkan)</p>
        </div>
        <FilterDropdown
          value={fOrderStatus}
          onChange={setFOrderStatus}
          options={Object.entries(ORDER_STATUS_LABELS)
            .filter(([k]) => !k.startsWith("SEWA_"))
            .map(([k, label]) => ({ value: k, label }))}
          placeholder="Semua status order"
          icon={PackageCheck}
          ariaLabel="Filter status order"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-btn bg-inset" />)}
          </div>
        ) : semuaJob.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Semua job sudah masuk rute"
            description="Atau belum ada job terjadwal pada rentang tanggal ini."
          />
        ) : (
          <div className="space-y-3">
            {/* SETIAP kota dapat section sendiri sekarang (revisi Sep 2026)
                — kota 1 job TIDAK LAGI dilempar ke "Lainnya" tanpa nama.
                Warna label beda: accent (biru) untuk kandidat 1 rute (2+
                job), netral untuk kota yang cuma 1 job — supaya dua makna
                beda ini tetap kebeda kalau dipindai cepat. */}
            {groups.semuaKota.map(({ kota, list }) => {
              const kandidat = list.length >= 2;
              return (
                <div key={kota}>
                  <span className={cn(
                    "mb-1 flex items-center gap-1 px-0.5 text-[10px] font-bold uppercase tracking-wide",
                    kandidat ? "text-accent" : "text-ink3"
                  )}>
                    <MapPinned size={11} /> {kota}{kandidat && " · kandidat 1 rute"}
                  </span>
                  <ul className="space-y-1.5">
                    {list.map((j) => <JobRow key={j.id} j={j} draggingId={draggingId} onDragStart={onDragStart} onDragEnd={onDragEnd} onOpenJob={onOpenJob} />)}
                  </ul>
                </div>
              );
            })}

            {/* Cuma job yang delivery_city-nya BENAR-BENAR kosong sampai
                sini sekarang — label ini sekarang jujur, tidak lagi
                bercampur dengan kota yang sekadar sepi. */}
            {groups.tanpaKota.length > 0 && (
              <div>
                <p className="mb-1 px-0.5 text-[10px] font-bold uppercase tracking-wide text-orange">Belum Ada Kota</p>
                <ul className="space-y-1.5">
                  {groups.tanpaKota.map((j) => <JobRow key={j.id} j={j} draggingId={draggingId} onDragStart={onDragStart} onDragEnd={onDragEnd} onOpenJob={onOpenJob} />)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
