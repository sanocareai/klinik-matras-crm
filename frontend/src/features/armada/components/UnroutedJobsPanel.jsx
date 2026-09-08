import React, { useMemo, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Package, MapPinned, PackageCheck, Search, X, Clock, MessageCircle, BedDouble, Route as RouteIcon, ChevronDown } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { FilterDropdown } from "@/components/ui/filter-dropdown.jsx";
import Avatar from "@/components/Avatar.jsx";
import { cn } from "@/lib/utils.js";
import {
  customerOf, orderOf, unitCountOf, cityOf, mapsUrl, conversationIdOf, customerPhoneOf,
  jobAccentBarStyle, hasJobAccentBar, orderStatusOf, orderNumberOf, salesPersonOf,
} from "../jobStatus.js";
import { RentalBadge, ConfirmedTimeBadge, CityBadge, OrderStatusBadge, MapsLinkMissingBadge, SalesBadge } from "./JobBadges.jsx";
import { productSummary } from "@/features/inbox/components/CustomerPanel/orderSummary.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import { ORDER_STATUS_LABELS } from "@/utils/format.js";
import QuickChatModal from "./QuickChatModal.jsx";

// "EST: Di atas 09.00" — SATU SUMBER dengan RouteCard.jsx (duplikasi
// fungsi murni, bukan import silang antar dua komponen kartu yang
// sengaja terpisah) — lihat catatan panjang di RouteCard.jsx untuk kenapa
// data lama butuh dibersihkan dulu ("EST"/"EST:" ganda) sebelum di-prefix.
function estimasiJamSingkat(timeWindow) {
  if (!timeWindow) return null;
  return timeWindow
    .trim()
    .replace(/^est\.?:?\s*/i, "")
    .replace(/^di\s*atas\s*jam\s*/i, "Di atas ");
}

// Pesan konfirmasi default — SATU SUMBER dengan RouteCard.jsx (duplikasi
// fungsi murni yang sama alasannya dengan estimasiJamSingkat di atas).
function pesanKonfirmasiDefault(job) {
  const nama = customerOf(job) || "Kak";
  const aksi = job?.type === "PICKUP" ? "pengambilan" : "pengiriman";
  return `Halo ${nama}, mohon konfirmasi untuk jadwal ${aksi} kasur hari ini — apakah Anda/perwakilan ada di tempat? Terima kasih 🙏`;
}

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
// Tombol "Masukkan ke Rute" (8 September 2026, laporan owner: "ketika drag
// order yang belum masuk rute bisa sambil scroll agar lebih murah, atau
// mungkin tambah skema tombol di belum masuk rute" — rute yang isinya
// banyak/panjang ke bawah bikin drag-and-drop susah [target drop di luar
// layar, harus scroll sambil menyeret]). Bulk-add checkbox+dropdown SEMPAT
// dihapus total (D-068, 4 September 2026) karena saat itu drag-and-drop
// dinilai cukup — laporan BARU ini bukan flip-flop tanpa alasan, ini kasus
// KONKRET drag gagal (rute panjang) yang tidak ada sebelumnya. BEDA dari
// D-058 lama: BUKAN bulk (centang banyak job), cuma SATU job per klik,
// tetap pelengkap drag (bukan pengganti) — drag tetap cara utama untuk
// reorder DI DALAM rute.
//
// Reuse tambahKeRute() yang SAMA dipakai onDrop RouteCard (ArmadaRoutes.jsx)
// — job baru masuk di URUTAN PALING BAWAH rute, dispatcher tinggal drag
// singkat DI DALAM rute (jarak pendek, tidak perlu scroll panjang) kalau
// mau reorder — bagian yang justru mudah tetap drag, bagian yang susah
// (masuk rute dari panel jauh di kiri) sekarang bisa klik.
function TombolMasukkanKeRute({ draftRoutes, onAssign }) {
  if (draftRoutes.length === 0) {
    return (
      <span
        title="Belum ada rute berstatus Draft pada rentang ini"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink3/40"
      >
        <RouteIcon size={15} />
      </span>
    );
  }
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title="Masukkan ke rute"
          className="group flex h-7 shrink-0 items-center gap-0.5 rounded-lg px-1 text-ink3 transition-colors hover:bg-accentbg hover:text-accent data-[state=open]:bg-accent data-[state=open]:text-white"
        >
          <RouteIcon size={15} className="shrink-0" />
          <ChevronDown size={11} className="shrink-0 transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end" sideOffset={6}
          className="z-50 max-h-64 min-w-[190px] overflow-y-auto rounded-btn border border-border bg-surface p-1.5 shadow-popover"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink3">
            Masukkan ke Rute (Draft)
          </p>
          {draftRoutes.map((r) => (
            <DropdownMenu.Item
              key={r.id}
              onSelect={() => onAssign(r)}
              className="flex cursor-pointer items-center gap-2 rounded-btn px-2 py-1.5 text-[12.5px] text-ink outline-none data-[highlighted]:bg-accentbg data-[highlighted]:text-accent"
            >
              <span className="flex-1 truncate font-semibold">{r.code}</span>
              <span className="shrink-0 text-[10.5px] text-ink3">{(r.jobs || []).length} stop</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function JobRow({ j, draggingId, onDragStart, onDragEnd, onOpenJob, draftRoutes, onAssignToRoute }) {
  // Chat WA cepat (8 September 2026) — state LOKAL per baris (bukan
  // diangkat ke UnroutedJobsPanel) karena JobRow SUDAH jadi unit
  // representasi 1 job sendiri (beda dari RouteCard.jsx yang menampung
  // BANYAK stop dalam 1 komponen, jadi state chat di sana memang perlu
  // ada di level kartu rute). Pola sama, level beda.
  const [chatOpen, setChatOpen] = useState(false);
  return (
    <li
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/job-id", j.id); onDragStart(j); }}
      onDragEnd={onDragEnd}
      // Klik 1x buka JobDetailDrawer — sama persis dengan RouteCard.jsx,
      // lihat catatan panjang di sana. Aman berdampingan dengan `draggable`.
      onClick={() => onOpenJob?.(j.id)}
      // Glow aksen kiri per tipe (6 September 2026, laporan owner: "status
      // pengiriman kita udah rencanakan agar kasih glow hijau tapi ini
      // masih belum di rute planner" — skema ini SUDAH diterapkan di
      // Jadwal & Penugasan, Route Planner sebelumnya TERLEWAT, masih pakai
      // jobTypeCardStyle/rentalCardAccentStyle lama [gradasi penuh].
      // Disamakan supaya identifikasi visual konsisten di SELURUH Delivery
      // Hub. Lihat jobStatus.js#jobAccentBarStyle.
      style={jobAccentBarStyle(j)}
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
        // Redesain (8 September 2026, laporan owner: "make sure semua
        // dapat tampilan card order yang sama" — panel ini sebelumnya
        // TERLEWAT saat RouteCard.jsx dirombak, masih pakai layout lama
        // tanpa ikon chat/Maps & tanpa produk+ukuran). Susunan/konten SAMA
        // PERSIS dengan stop card RouteCard.jsx sekarang — flex-col,
        // bukan lagi 1 baris avatar+teks.
        // `leading-none` + `gap-0.5` (8 September 2026, laporan owner:
        // "jarak antara ukuran dan alamat masih terlalu jauh" — DIPERKETAT
        // LAGI dari percobaan pertama `leading-tight`/`gap-1`, masih
        // terasa longgar) — line-height DIWARISKAN dari body/App (longgar,
        // dibuat untuk paragraf biasa), sementara `text-[Npx]` di
        // D-140 (redesign kartu job, dari mockup audit "Route Planner Card
        // Audit" yang disetujui owner) — `gap-0.5` rata utk SEMUA baris
        // diganti `gap-2`: kartu ini sekarang disusun 3 KELOMPOK visual
        // (status / identitas / jadwal) yang masing-masing rapat DI DALAM
        // dirinya sendiri, sama seperti RouteCard.jsx — dua kartu tetap
        // konsisten satu sama lain.
        // KOREKSI — `leading-none` (line-height:1) diganti `leading-tight`
        // (1.25), SAMA alasan dengan RouteCard.jsx: line-height 1 lebih
        // pendek dari kotak glyph font sistem sendiri, descender g/y/p/j
        // kepotong begitu ketemu `overflow:hidden` dari `truncate`. Baca
        // catatan lengkap di RouteCard.jsx.
        "dh-job-card relative flex cursor-grab select-none flex-col gap-2 rounded-btn border border-border bg-surface px-2.5 py-2 leading-tight transition-all duration-150 active:cursor-grabbing",
        hasJobAccentBar(j) && "dh-bar-left",
        draggingId === j.id && "scale-[0.97] opacity-40"
      )}
    >
      {/* Kelompok 1 — STATUS: badge kota/status kirim/Sewa (kiri), aksi
          ikon chat+Maps (kanan). CityBadge di sini TERASA redundan dengan
          header section kota di panel ini sendiri, TAPI kartu yang sama
          (JobRow) juga dipakai secara visual sebagai acuan drag — begitu
          di-drag ke RouteCard, konteks section-nya hilang. Tetap sengaja
          ditampilkan. */}
      <div className="flex items-center gap-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <CityBadge job={j} />
          {/* JobTypeBadge SENGAJA TIDAK dipasang — lihat catatan lengkap di
              RouteCard.jsx (regresi "1 status badge per kartu" yang sudah
              diputuskan owner sebelumnya, sempat dobel lagi tanpa sengaja).
              Sinyal tipe job tetap ada lewat glow aksen kiri (hijau =
              Pengiriman). OrderStatusBadge SATU-SATUNYA badge status teks. */}
          <OrderStatusBadge job={j} />
          <RentalBadge job={j} />
        </div>
        <div className="relative flex shrink-0 items-center gap-0.5">
          {/* D-140 — "Tanpa link Maps" TIDAK lagi baris pil sendiri (lihat
              catatan panjang di RouteCard.jsx). `variant="dot"` menempel
              di pojok grup ikon ini, kondisi & tooltip SAMA PERSIS. */}
          <MapsLinkMissingBadge job={j} variant="dot" />
          <TombolMasukkanKeRute draftRoutes={draftRoutes} onAssign={(r) => onAssignToRoute?.(j, r)} />
          {conversationIdOf(j) && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setChatOpen(true); }}
              title="Chat cepat dengan pelanggan"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink3 transition-colors hover:bg-greenbg hover:text-green"
            >
              <MessageCircle size={16} />
            </button>
          )}
          {mapsUrl(j) && (
            <a
              href={mapsUrl(j)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Buka lokasi di Google Maps"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink3 transition-colors hover:bg-accentbg hover:text-accent"
            >
              <MapPinned size={16} />
            </a>
          )}
        </div>
      </div>

      {/* Kelompok 2 — IDENTITAS STOP: avatar+nama, jenis produk (chip kecil
          berbingkai — GANTI dari teks polos yang nyaris sebobot dengan
          alamat, lihat catatan panjang di RouteCard.jsx), lalu alamat
          dengan ikon pin kecil. Satu kelompok rapat (gap-1). */}
      <div className="flex items-start gap-2">
        <Avatar name={customerOf(j) || "?"} size="sm" gradient className="mt-px h-7 w-7 shrink-0 text-[10px]" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-[13.5px] font-bold text-ink">{customerOf(j) || "Tanpa nama"}</span>
          {orderOf(j) && productSummary(orderOf(j)) && (
            <span className="inline-flex w-fit max-w-full items-center gap-1 truncate rounded-md border border-line bg-surface px-1.5 py-px text-[11px] font-semibold text-ink2">
              <BedDouble size={11} className="shrink-0 text-ink3" />
              <span className="truncate">{productSummary(orderOf(j))}</span>
            </span>
          )}
          <span className="flex items-start gap-1 text-[12px] text-ink2">
            <MapPinned size={12} className="mt-px shrink-0 text-ink3" />
            <span className="min-w-0 flex-1 truncate">{j.addressText || "Alamat belum diisi"}</span>
          </span>
        </div>
      </div>

      {/* Kelompok 3 — JADWAL: tanggal terjadwal + jumlah unit (D-063, 4
          September 2026 — KHUSUS panel ini, stop di dalam rute RouteCard
          sudah pasti tanggalnya = tanggal rute, job di panel ini bisa dari
          HARI BERBEDA-BEDA), estimasi jam, tanggal PASTI ambil/kirim, dan
          sales person — digabung SATU baris meta, dipisah garis tipis dari
          kelompok identitas di atas. */}
      {(j.scheduledDate || unitCountOf(j) || estimasiJamSingkat(j.timeWindow) || orderOf(j)?.pickupConfirmedDate || orderOf(j)?.deliveryConfirmedDate || salesPersonOf(j)) && (
        <div className="flex flex-wrap items-center gap-1 border-t border-border pt-1.5">
          {(j.scheduledDate || unitCountOf(j)) && (
            <span className="inline-flex w-fit items-center gap-1 text-[10.5px] text-ink3">
              {j.scheduledDate && (
                <>
                  <span className="font-semibold text-ink2">{formatTanggalPendek(j.scheduledDate)}</span>
                  <span aria-hidden>·</span>
                </>
              )}
              <span>{unitCountOf(j)} unit</span>
            </span>
          )}
          {estimasiJamSingkat(j.timeWindow) && (
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-orangebg px-2 py-0.5 text-[10.5px] font-semibold text-orange">
              <Clock size={11} className="shrink-0" /> EST: {estimasiJamSingkat(j.timeWindow)}
            </span>
          )}
          <ConfirmedTimeBadge job={j} className="flex-wrap" />
          <SalesBadge job={j} className="w-fit" />
        </div>
      )}

      {chatOpen && (
        <QuickChatModal
          conversationId={conversationIdOf(j)}
          customerName={customerOf(j)}
          customerPhone={customerPhoneOf(j)}
          defaultMessage={pesanKonfirmasiDefault(j)}
          onClose={() => setChatOpen(false)}
        />
      )}
    </li>
  );
}

export default function UnroutedJobsPanel({
  jobs, undatedJobs = [], loading, draggingId, onDragStart, onDragEnd, onOpenJob,
  // routes/onAssignToRoute (8 September 2026) — lihat catatan panjang di
  // TombolMasukkanKeRute di atas. `routes` datang APA ADANYA dari
  // ArmadaRoutes.jsx (semua status), disaring ke DRAFT DI SINI — sama
  // syarat dengan `isDraft` RouteCard.jsx (rute yang sudah diterbitkan/
  // dibatalkan tidak menerima job baru).
  routes = [], onAssignToRoute,
}) {
  const draftRoutes = useMemo(() => routes.filter((r) => r.status === "DRAFT"), [routes]);
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
  // Pencarian (6 September 2026, laporan owner: "tambahkan fitur search")
  // — LOKAL ke panel ini, pola SAMA dengan Pipeline.jsx (board Kanban):
  // jobs/undatedJobs sudah dimuat penuh di klien, tidak perlu ke server.
  // Cocokkan ke nama customer, nomor order, DAN alamat — 3 hal yang paling
  // sering jadi acuan dispatcher mencari satu job spesifik di antara
  // banyak kartu (nama kalau sudah kenal customer-nya, nomor order kalau
  // pegang catatan sales, alamat kalau menyusun rute per area).
  const [cari, setCari] = useState("");

  const semuaJob = useMemo(() => {
    let hasil = [...jobs, ...undatedJobs];
    if (fOrderStatus) hasil = hasil.filter((j) => orderStatusOf(j) === fOrderStatus);
    if (cari.trim()) {
      const q = cari.trim().toLowerCase();
      hasil = hasil.filter((j) =>
        (customerOf(j) || "").toLowerCase().includes(q) ||
        (orderNumberOf(j) || "").toLowerCase().includes(q) ||
        (j.addressText || "").toLowerCase().includes(q)
      );
    }
    return hasil;
  }, [jobs, undatedJobs, fOrderStatus, cari]);

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
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
          <input
            type="search"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="Cari nama, no. order, alamat…"
            aria-label="Cari job belum masuk rute"
            className="h-8 w-full rounded-lg border border-border bg-surface pl-7 pr-7 text-[12px] text-ink placeholder:text-ink3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          />
          {cari && (
            <button
              type="button" onClick={() => setCari("")} aria-label="Hapus pencarian"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink3 hover:text-ink"
            >
              <X size={12} />
            </button>
          )}
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
          // Pesan dibedakan (6 September 2026) — "semua sudah masuk rute"
          // menyesatkan kalau sebenarnya ADA job tapi tersaring habis oleh
          // pencarian/filter yang sedang aktif.
          (cari.trim() || fOrderStatus) ? (
            <EmptyState
              icon={Search}
              title="Tidak ada yang cocok"
              description="Coba kata kunci lain atau hapus filter status order."
            />
          ) : (
            <EmptyState
              icon={Package}
              title="Semua job sudah masuk rute"
              description="Atau belum ada job terjadwal pada rentang tanggal ini."
            />
          )
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
                    {list.map((j) => <JobRow key={j.id} j={j} draggingId={draggingId} onDragStart={onDragStart} onDragEnd={onDragEnd} onOpenJob={onOpenJob} draftRoutes={draftRoutes} onAssignToRoute={onAssignToRoute} />)}
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
                  {groups.tanpaKota.map((j) => <JobRow key={j.id} j={j} draggingId={draggingId} onDragStart={onDragStart} onDragEnd={onDragEnd} onOpenJob={onOpenJob} draftRoutes={draftRoutes} onAssignToRoute={onAssignToRoute} />)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
