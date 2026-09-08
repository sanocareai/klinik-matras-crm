import React, { useState } from "react";
import { GripVertical, X, ArrowUpDown, Send, Ban, Trash2, Loader2, User, Users, Truck, Pencil, Check, Map, Clock, MapPinned, MessageCircle, BedDouble } from "lucide-react";
import { api } from "@/api.js";
import { cn } from "@/lib/utils.js";
import { FilterDropdown } from "@/components/ui/filter-dropdown.jsx";
import Avatar from "@/components/Avatar.jsx";
import StatusBadge from "./StatusBadge.jsx";
import { ROUTE_STATUS_REAL } from "../vehicleStatus.js";
import { customerOf, orderOf, mapsUrl, unitCountOf, jobAccentBarStyle, hasJobAccentBar, conversationIdOf, customerPhoneOf, salesPersonOf } from "../jobStatus.js";
import { RentalBadge, ConfirmedTimeBadge, CityBadge, OrderStatusBadge, MapsLinkMissingBadge, SalesBadge } from "./JobBadges.jsx";
import { productSummary } from "@/features/inbox/components/CustomerPanel/orderSummary.js";
import { formatTanggal } from "@/utils/formatDate.js";
import QuickChatModal from "./QuickChatModal.jsx";

// Pesan konfirmasi default (8 September 2026) — dipakai mengisi kotak
// teks QuickChatModal begitu ikon chat diklik, supaya admin delivery
// tinggal cek/kirim, bukan mengetik dari nol tiap kali. TETAP bisa diubah
// bebas sebelum dikirim, ini cuma titik awal.
function pesanKonfirmasiDefault(job) {
  const nama = customerOf(job) || "Kak";
  const aksi = job?.type === "PICKUP" ? "pengambilan" : "pengiriman";
  return `Halo ${nama}, mohon konfirmasi untuk jadwal ${aksi} kasur hari ini — apakah Anda/perwakilan ada di tempat? Terima kasih 🙏`;
}

// "EST: Di atas 09.00" (8 September 2026, redesain kartu stop — laporan
// owner: "tambah estimasi jam mungkin bisa disingkat"). Job.timeWindow
// SEHARUSNYA salah satu dari 5 preset tetap ("Di atas jam 09.00" dst,
// lihat ESTIMASI_JAM_PRESET di jobStatus.js) sejak preset ini ada (6
// September 2026) — TAPI field-nya String bebas di database, jadi data
// LEBIH LAMA dari sebelum preset ini dibuat bisa berisi apa saja (BUG
// NYATA ditemukan lewat data production: satu job menyimpan literal "EST
// Diatas jam 13.00 (40)" — kalau di-prefix "EST:" begitu saja hasilnya
// dobel "EST: EST Diatas..."). Dua langkah dibersihkan SEBELUM prefix
// "EST:" ditambahkan sendiri: buang "EST"/"EST:" yang mungkin SUDAH ada
// di data lama, lalu rapikan "Di atas jam"/"Diatas jam" (spasi longgar,
// data lama kadang tanpa spasi) jadi "Di atas " yang konsisten. Sisa teks
// lain (mis. "(40)" di contoh nyata di atas) DIBIARKAN apa adanya — tidak
// tahu pasti maksudnya, lebih jujur ditampilkan daripada ditebak dibuang.
function estimasiJamSingkat(timeWindow) {
  if (!timeWindow) return null;
  return timeWindow
    .trim()
    .replace(/^est\.?:?\s*/i, "")
    .replace(/^di\s*atas\s*jam\s*/i, "Di atas ");
}

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
  onDrop, onReorder, onRemoveJob, onAssign, onPublish, onCancel, onDelete, onOptimize, onOpenJob,
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
  // Catatan Rute (redesain Sep 2026, docs/ARMADA-REDESIGN-2026.md §10) —
  // pola SAMA dengan address di JobCard.jsx (Armada.jsx): local state,
  // simpan saat blur, TIDAK resync ulang dari prop route.notes tiap render
  // (kesederhanaan yang sudah diterima di JobCard, cukup untuk field yang
  // jarang diketik ulang dari 2 tempat berbeda bersamaan).
  const [notesDraft, setNotesDraft] = useState(route.notes || "");
  const [mapsBusy, setMapsBusy] = useState(false);
  // Link Maps manual (6 September 2026) — laporan owner: link auto-generate
  // "berantakan" di WA, tapi link PENDEK ASLI (maps.app.goo.gl) cuma bisa
  // dibuat lewat tombol "Copy Link" di UI Google Maps sendiri, TIDAK ADA API
  // publik untuk itu (dikonfirmasi ke owner). Owner memilih generate manual
  // tiap kali — field ini tempat tempelnya, sama pola dengan notesDraft di
  // atas. Kosong = tetap pakai link auto-generate seperti sebelumnya (lihat
  // formatRouteWaMessage di armada.js).
  const [manualMapsUrlDraft, setManualMapsUrlDraft] = useState(route.manualMapsUrl || "");
  const [resendBusy, setResendBusy] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  // Tes Draft (8 September 2026) — lihat catatan panjang di tesDraft() di
  // bawah. State sengaja TERPISAH dari resendBusy/resendSent (dua aksi
  // beda makna, jangan dicampur biar tombolnya tidak salah label "Terkirim"
  // untuk aksi yang lain).
  const [testBusy, setTestBusy] = useState(false);
  const [testSent, setTestSent] = useState(false);
  // Job yang QuickChatModal SEDANG dibuka untuknya (8 September 2026,
  // permintaan owner: chat WA cepat tanpa pindah ke Inbox) — null = modal
  // tertutup. Disimpan sebagai objek job (bukan cuma id) supaya modal
  // punya conversationId/nama/nomor tanpa fetch ulang.
  const [chatJob, setChatJob] = useState(null);

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
    // Contoh alasan di prompt (6 September 2026) — SEBELUM ini teksnya
    // generik, dispatcher tidak langsung sadar tombol INI yang dipakai
    // untuk kasus ganti PIC darurat (kecelakaan di tengah rute, dialihkan
    // ke driver lain/kurir pihak ketiga seperti Lalamove) — padahal
    // mekanismenya sudah pas untuk itu (lihat guard status TUNTAS di
    // armada.js, stop yang sudah terkirim tidak ikut tertimpa).
    // Pesan diperjelas (8 September 2026 — laporan owner: broadcast
    // otomatis nyala berkali-kali di tengah proses edit sebelum selesai)
    // — SEKARANG mengedit TIDAK LAGI otomatis mengirim apa pun ke Natasha
    // di tiap perubahan (lihat catatan panjang di armada.js#PATCH
    // /routes/:id). Dispatcher perlu tahu itu dari awal, bukan menebak
    // kenapa Natasha tidak dapat kabar setelah selesai edit.
    const alasan = window.prompt(
      "Rute ini sudah diterbitkan (driver sudah lihat). Tulis alasan singkat kenapa perlu diedit sekarang (mis. kecelakaan - ganti driver, tambah/kurang stop).\n\nCatatan: mengedit TIDAK otomatis mengirim update ke Natasha — setelah selesai, klik \"Kirim Ulang\" secara manual."
    );
    if (!alasan?.trim()) return; // batal kalau kosong/Cancel
    setEditingReason(alasan.trim());
  }

  // Kirim ulang broadcast (6 September 2026, laporan owner: "gimana cara
  // gue share broadcast ulang" — jalur SATU-SATUNYA sebelum ini cuma lewat
  // Edit darurat, yang mewajibkan alasan DAN tercatat sebagai riwayat edit
  // walau sebenarnya tidak ada yang berubah). Endpoint ini TIDAK mengedit
  // apa pun, murni kirim ulang pesan yang sama ke Natasha.
  //
  // KOREKSI 6 September 2026 (laporan owner LANGSUNG setelah tombol ini
  // dipakai: "ngirimnya banyak banget" — tanpa konfirmasi/tanda "berhasil",
  // klik berulang [ragu apa sudah kekirim] tiap kali jadi kiriman BARU,
  // bukan diblokir — `disabled={resendBusy}` cuma mencegah klik SAAT
  // request sedang berjalan, tidak mencegah klik ulang SETELAH request
  // sebelumnya selesai). Sekarang: (1) confirm() dulu — setiap klik jadi
  // aksi sadar, bukan bisa "kepencet" berkali-kali tanpa sengaja; (2)
  // tanda "✓ Terkirim" tampil beberapa detik di tombolnya sendiri supaya
  // jelas SUDAH terkirim, tidak perlu klik lagi untuk mastiin.
  async function kirimUlang() {
    if (!window.confirm(`Kirim ulang broadcast rute ${route.code} ke Natasha?`)) return;
    setResendBusy(true);
    setResendSent(false);
    try {
      await api.resendRouteBroadcast(route.id);
      setResendSent(true);
      setTimeout(() => setResendSent(false), 3000);
    } catch (e) {
      alert("Gagal kirim ulang broadcast: " + e.message);
    } finally {
      setResendBusy(false);
    }
  }

  // Tes Draft (8 September 2026, permintaan owner: "buatkan tombol test
  // draft... agar mudah testing dan kirim broadcast draft ke natasha,
  // sebelum finalkan ini"). Berbeda dari kirimUlang() di atas: itu KHUSUS
  // rute PUBLISHED (kirim ULANG pesan resmi yang sudah pernah terkirim).
  // Ini sebaliknya — justru untuk rute DRAFT (belum diterbitkan sama
  // sekali), supaya dispatcher/owner bisa lihat persis bentuk pesan yang
  // akan Natasha terima SEBELUM menekan "Terbitkan" sungguhan. Backend
  // menempel label "🧪 TES DRAFT" di depan pesan (armada.js#POST
  // /routes/:id/test-broadcast) supaya Natasha tidak salah kira ini rute
  // yang harus dijalankan — TIDAK mengubah status rute maupun job apa pun.
  async function tesDraft() {
    if (!window.confirm(`Kirim TES broadcast rute ${route.code} ke Natasha? (berlabel "🧪 TES DRAFT", tidak mengubah status rute)`)) return;
    setTestBusy(true);
    setTestSent(false);
    try {
      await api.testRouteBroadcast(route.id);
      setTestSent(true);
      setTimeout(() => setTestSent(false), 3000);
    } catch (e) {
      alert("Gagal kirim tes broadcast: " + e.message);
    } finally {
      setTestBusy(false);
    }
  }

  function simpanCatatan() {
    if (notesDraft === (route.notes || "")) return; // tidak berubah, tidak perlu panggil API
    jalankan(() => onAssign(route, { notes: notesDraft }, editingReason));
  }

  function simpanManualMapsUrl() {
    if (manualMapsUrlDraft === (route.manualMapsUrl || "")) return;
    jalankan(() => onAssign(route, { manualMapsUrl: manualMapsUrlDraft }, editingReason));
  }

  // "Buat Peta" (redesain Sep 2026) — MENGGANTIKAN langkah manual dispatcher
  // menyusun rute di Google Maps sendiri. Backend membangun ulang URL yang
  // SAMA yang otomatis dikirim ke Natasha saat publish ATAU "Kirim Ulang"
  // (satu sumber kebenaran, GET /armada/routes/:id/maps-link) — tombol ini
  // untuk preview/share manual di luar momen itu. BUKAN lagi "saat edit" —
  // sejak 8 September 2026 mengedit rute PUBLISHED tidak otomatis mengirim
  // apa pun lagi, lihat catatan panjang di armada.js#PATCH /routes/:id.
  //
  // KEBIJAKAN LINK-ONLY (8 September 2026, keputusan owner) — stop yang
  // order-nya TIDAK punya link Maps DIKECUALIKAN dari URL peta (bukan lagi
  // diisi tebakan dari teks alamat, lihat catatan panjang di
  // services/maps.js#geocodeAddress/buildRouteMapsUrl). `excludedCount`
  // dari backend memberi tahu berapa yang dikecualikan — sengaja diberi
  // tahu jelas SIAPA yang perlu dicari manual, bukan cuma "kurang presisi".
  async function bukaPeta() {
    setMapsBusy(true);
    try {
      const { url, excludedCount } = await api.getRouteMapsLink(route.id);
      if (!url) {
        alert("Belum bisa membuat peta — tidak ada stop dengan link Maps di rute ini. Minta admin delivery follow up ke sales untuk link Maps tiap order.");
        return;
      }
      if (excludedCount > 0) {
        alert(`${excludedCount} stop TIDAK ikut masuk peta karena order-nya belum punya link Maps — cari lokasinya manual (lihat badge "Tanpa link Maps" di kartu stop). Sisanya tetap dibuka.`);
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      alert("Gagal membuat link peta: " + e.message);
    } finally {
      setMapsBusy(false);
    }
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
    <>
    {/* w-full (D-060, 4 September 2026) — SEBELUMNYA w-[300px] shrink-0,
        dibuat untuk baris flex yang digulir horizontal (ArmadaRoutes.jsx
        lama). Sekarang parent-nya grid yang membungkus ke baris baru, jadi
        kartu ini harus mengisi lebar KOLOM grid (ditentukan grid-cols di
        ArmadaRoutes.jsx), bukan memaksa lebar sendiri 300px yang bisa
        meleset dari lebar kolom sesungguhnya. */}
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
          {/* "Buat Peta" (redesain Sep 2026) — MENGGANTIKAN dispatcher
              menyusun rute di Google Maps satu-per-satu manual. Tampil untuk
              rute apa pun yang sudah punya stop (bukan cuma Draft/Published)
              — dispatcher bisa preview/share ulang kapan saja. */}
          {jobs.length > 0 && (
            <button
              type="button"
              onClick={bukaPeta}
              disabled={mapsBusy}
              title="Buka rute ini di Google Maps (urutan stop sesuai sequence)"
              className="flex shrink-0 items-center gap-1 rounded-chip bg-accentbg px-2 py-1 text-[10.5px] font-semibold text-accent transition-colors hover:opacity-80 disabled:opacity-40"
            >
              {mapsBusy ? <Loader2 size={11} className="animate-spin" /> : <Map size={11} />} Buat Peta
            </button>
          )}
          {/* Tes Draft (8 September 2026) — lihat catatan panjang di
              tesDraft() di atas. Warna orange/warning (BEDA dari "Buat
              Peta" biru) supaya sekilas kelihatan ini aksi "hati-hati/
              belum final", bukan aksi rutin biasa. Tampil untuk rute apa
              pun yang sudah punya stop, sama syarat dengan "Buat Peta" —
              paling berguna justru saat masih DRAFT, tapi tidak diblokir
              untuk status lain (verifikasi ulang PUBLISHED pun boleh). */}
          {jobs.length > 0 && (
            <button
              type="button"
              onClick={tesDraft}
              disabled={testBusy}
              title='Kirim TES broadcast (berlabel "🧪 TES DRAFT") ke Natasha — cek format pesan sebelum menerbitkan rute sungguhan, TIDAK mengubah status rute.'
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-chip px-2 py-1 text-[10.5px] font-semibold transition-colors disabled:opacity-40",
                testSent ? "bg-greenbg text-green" : "bg-orangebg text-orange hover:opacity-80"
              )}
            >
              {testBusy ? (
                <Loader2 size={11} className="animate-spin" />
              ) : testSent ? (
                <Check size={11} />
              ) : (
                <Send size={11} />
              )}
              {testSent ? "Terkirim" : "Tes Draft"}
            </button>
          )}
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
            {/* Kirim Ulang (6 September 2026) — HANYA PUBLISHED, sama cakupan
                dengan Edit darurat di sebelahnya. TIDAK mengedit apa pun,
                cuma kirim ulang pesan yang sama ke Natasha (lihat kirimUlang
                di atas) — dipakai kalau driver/Natasha bilang belum lihat,
                mau dikirim ulang pagi hari, dst. */}
            {canEmergencyEdit && (
              <button
                type="button"
                onClick={kirimUlang}
                disabled={resendBusy}
                title="Kirim ulang ringkasan rute + link Maps ke Natasha, tanpa mengedit apa pun."
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-chip px-1.5 py-1 text-[10.5px] font-semibold transition-colors disabled:opacity-40",
                  resendSent ? "text-green" : "text-ink3 hover:bg-hovertint hover:text-accent"
                )}
              >
                {resendBusy ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : resendSent ? (
                  <Check size={11} />
                ) : (
                  <Send size={11} />
                )}
                {resendSent ? "Terkirim" : "Kirim Ulang"}
              </button>
            )}
            {/* Edit darurat (redesain Sep 2026) — HANYA untuk PUBLISHED.
                IN_PROGRESS/COMPLETED/CANCELLED tetap terkunci total (lihat
                canEmergencyEdit) — rute yang sedang/sudah dijalankan atau
                dibatalkan bukan kasus "rencana berubah mendadak". */}
            {canEmergencyEdit && (
              <button
                type="button"
                onClick={mulaiEditDarurat}
                title="Rute sudah diterbitkan — tetap bisa ganti driver/helper/kendaraan (mis. kecelakaan, dialihkan ke kurir lain), wajib isi alasan (tercatat). Stop yang sudah terkirim TIDAK ikut berubah."
                className="flex shrink-0 items-center gap-1 rounded-chip px-1.5 py-1 text-[10.5px] font-semibold text-ink3 transition-colors hover:bg-hovertint hover:text-accent"
              >
                <Pencil size={11} /> Edit
              </button>
            )}
          </div>
        )}

        {/* Catatan Rute (redesain Sep 2026) — Route.notes, field yang SUDAH
            ADA di schema/PATCH /routes/:id tapi sebelum ini tidak punya
            input UI sama sekali. Ikut dikirim ke grup driver di bawah judul
            "Detail Catatan" (lihat formatRouteWaMessage di armada.js) —
            tempat freeform untuk kasus yang tidak bisa dimodelkan
            terstruktur, mis. "WILSON Pagi > EMON-helper, balik ganti driver
            AGUNG-helper". */}
        {isEditable ? (
          <textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={simpanCatatan}
            placeholder="Catatan rute (opsional) — ikut terkirim ke grup driver, mis. pergantian driver di tengah jalan"
            rows={2}
            className="w-full resize-none rounded-lg border border-border px-2 py-1.5 text-[11px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
          />
        ) : route.notes ? (
          <p className="whitespace-pre-line rounded-lg bg-inset px-2 py-1.5 text-[11px] text-ink2">{route.notes}</p>
        ) : null}

        {/* Link Maps manual (6 September 2026) — laporan owner: link Maps
            auto-generate "berantakan" di broadcast WA, tapi link PENDEK ASLI
            (maps.app.goo.gl) TIDAK BISA dibuat lewat API — cuma lewat tombol
            "Copy Link" di UI Google Maps sendiri. Alur: klik "Buat Peta" di
            atas -> susun/cek rute di Google Maps -> klik "Copy Link" di sana
            -> tempel hasilnya di sini. Kalau diisi, MENGGANTIKAN link
            auto-generate di broadcast WA (formatRouteWaMessage) — kosong =
            tetap pakai auto-generate seperti sebelumnya. */}
        {isEditable ? (
          <input
            type="text"
            value={manualMapsUrlDraft}
            onChange={(e) => setManualMapsUrlDraft(e.target.value)}
            onBlur={simpanManualMapsUrl}
            placeholder="Link Maps (opsional) — tempel hasil 'Copy Link' dari Google Maps"
            className="w-full rounded-lg border border-border px-2 py-1.5 text-[11px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
          />
        ) : route.manualMapsUrl ? (
          <a
            href={route.manualMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-[11px] text-accent hover:underline"
          >
            🔗 {route.manualMapsUrl}
          </a>
        ) : null}

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
          (kartu, popover).
          Grid 2 kolom (8 September 2026, laporan owner: "buat jadi rute
          1,2 [1 baris] 3,4 [1 baris]") — MENGGANTIKAN tumpukan vertikal
          1 kolom (space-y-1.5) yang bikin kartu rute banyak-stop jadi
          sangat panjang ke bawah. Drag & drop TIDAK berubah sama sekali —
          tiap stop tetap draggable/droppable sendiri-sendiri lewat
          onDragOver/onDrop per item (handleDropAtIndex), cuma susunan
          visualnya yang berubah dari 1 kolom jadi 2 kolom. */}
      <div
        onDragOver={(e) => { if (isEditable) { e.preventDefault(); setDragOverIdx(jobs.length); } }}
        onDrop={handleDropOnCard}
        className={cn(
          "min-h-[80px] flex-1 p-2 transition-colors duration-150",
          dragOverIdx !== null && isEditable && "bg-accentbg/40"
        )}
      >
        {jobs.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11px] text-ink3">
            {isEditable ? "Seret job ke sini" : "Tidak ada stop"}
          </p>
        ) : (
        // items-start (8 September 2026, laporan owner: "masih ada space
        // kosong seperti ini") — CSS grid SECARA DEFAULT meregangkan tiap
        // item mengisi tinggi PENUH barisnya (align-items: stretch), jadi
        // kartu yang isinya lebih sedikit (mis. belum ada produk/tanggal
        // pasti) ikut ditarik setinggi kartu tetangganya yang isinya lebih
        // banyak — itu ruang kosong di bawah yang dilaporkan. items-start
        // membiarkan tiap kartu setinggi konten aslinya sendiri.
        <div className="grid grid-cols-2 items-start gap-1.5">
          {jobs
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
                // Klik 1x buka JobDetailDrawer (redesain Sep 2026 — laporan
                // owner: "sistemnya cuma drag-and-drop", minta bisa lihat/ubah
                // status+alamat+link maps tanpa pindah ke Jadwal & Penugasan).
                // AMAN berdampingan dengan `draggable` di atas — browser
                // membedakan gestur drag (dragstart) dari klik biasa secara
                // native, tidak perlu guard tambahan.
                onClick={() => onOpenJob?.(j.id)}
                // Glow aksen kiri per tipe (6 September 2026, laporan owner:
                // "status pengiriman kita udah rencanakan agar kasih glow
                // hijau tapi ini masih belum di rute planner" — skema ini
                // SUDAH diterapkan di Jadwal & Penugasan sejak revisi Sep
                // 2026 [owner minta versi TENANG, bukan gradasi PENUH, lihat
                // jobStatus.js#jobAccentBarStyle], tapi Route Planner
                // sebelumnya TERLEWAT, masih pakai jobTypeCardStyle/
                // rentalCardAccentStyle lama [gradasi penuh]. Disamakan di
                // sini supaya identifikasi visual konsisten di SELURUH
                // Delivery Hub, bukan cuma satu halaman.
                style={jobAccentBarStyle(j)}
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
                  // dh-bar-left (glow aksen kiri, BUKAN gradasi penuh lagi —
                  // lihat catatan di atas) — Sewa=oranye, Pengiriman=hijau,
                  // Pengambilan=biru (DIBALIK 8 September 2026, lihat catatan
                  // panjang di jobStatus.js#jobAccentBarStyle: warna sekarang
                  // murni dari job.type per kartu, bukan status order yang
                  // dibagi beberapa job — SEBELUMNYA Pengambilan tanpa warna,
                  // sekarang selalu ada glow di SETIAP kartu).
                  // Redesain kartu stop (8 September 2026, permintaan owner
                  // — susunan info + ikon maps + produk/ukuran, lihat
                  // catatan per-baris di bawah) — kontainer jadi kolom
                  // vertikal (flex-col), BUKAN lagi 1 baris avatar+teks
                  // seperti sebelumnya, supaya semua info yang diminta
                  // (kota+status, EST jam, nama, produk, alamat, tanggal
                  // pasti, sales) tersusun rapi turun ke bawah, bukan
                  // berdesakan di satu baris sempit (kartu ini sekarang
                  // cuma separuh lebar kolom rute, grid 2 kolom).
                  // D-140 (redesign kartu job, dilanjutkan dari mockup audit
                  // "Route Planner Card Audit" yang disetujui owner) —
                  // GANTI dari "leading-none + gap-0.5 rata semua baris" jadi
                  // 3 KELOMPOK visual (status / identitas / jadwal), masing-
                  // masing rapat DI DALAM dirinya (gap-0.5/gap-1), tapi
                  // berjarak lebih longgar (gap-2) ANTAR kelompok — akar
                  // masalah versi lama BUKAN jaraknya kurang rapat (sudah
                  // 2px), tapi SEMUA 7-8 baris dapat jarak yang SAMA PERSIS
                  // tanpa peduli mana yang sebetulnya satu kesatuan makna,
                  // jadi terbaca sebagai satu blok teks tunggal, bukan info
                  // yang terstruktur.
                  // KOREKSI (laporan owner: teks "Kasur Spring" kepotong di
                  // bawah, "g"-nya hilang — plus line-spacing kerasa terlalu
                  // dempet) — `leading-none` (line-height:1) TERNYATA lebih
                  // pendek dari tinggi kotak glyph font sistem (SF Pro/Segoe
                  // UI) sendiri; descender huruf g/y/p/j jadi kepotong begitu
                  // ketemu `overflow:hidden` dari class `truncate` di span
                  // produk/alamat. Diganti `leading-tight` (1.25) — masih
                  // rapat (bukan balik ke leading-normal 1.5 yang bikin kartu
                  // ini boros tinggi lagi), tapi cukup ruang untuk descender
                  // tidak terpotong DAN antar-baris tidak lagi kerasa dempet.
                  "dh-stop-card relative flex select-none flex-col gap-2 rounded-btn border border-border bg-inset px-2.5 py-2 leading-tight transition-all duration-150",
                  hasJobAccentBar(j) && "dh-bar-left",
                  isEditable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                  dragOverIdx === idx && "ring-2 ring-accent",
                  // Item yang sedang digeser memudar + sedikit mengecil —
                  // penanda visual yang SEBELUMNYA tidak ada sama sekali di
                  // sini (beda dari UnroutedJobsPanel yang sudah punya ini),
                  // sekarang bahasa gerak drag konsisten di kedua tempat.
                  draggingStopId === j.id && "scale-[0.97] opacity-40"
                )}
              >
                {/* Kelompok 1 — STATUS: nomor urut jadi chip bulat (D-140,
                    laporan owner: nomor urut "kalah tonjol", padahal di
                    kartu rute urutan stop adalah info yang paling sering
                    dipindai duluan) + drag handle, badge kota/status kirim/
                    Sewa, aksi ikon chat+Maps+hapus. */}
                <div className="flex items-center gap-1.5">
                  {isEditable && <GripVertical size={13} className="shrink-0 text-ink3" aria-hidden />}
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accentbg text-[10.5px] font-extrabold text-accent">
                    {idx + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                    <CityBadge job={j} />
                    {/* OrderStatusBadge = "status kirim" (Pengambilan/
                        Diproses/Siap Kirim/Pengiriman/Terkirim). JobTypeBadge
                        SENGAJA TIDAK dipasang di sini (regresi 6 September
                        2026 — sempat ditambahkan lagi lewat commit "badge
                        Pengiriman jadi hijau eksplisit", TAPI itu menciptakan
                        ULANG persis masalah yang SUDAH diputuskan owner
                        sebelumnya di commit b87b36d8: "kita hanya butuh 1
                        status" — 2 badge teks tampil berdampingan dengan kata
                        yang SAMA dan membingungkan. Sinyal tipe job tetap ada
                        lewat warna glow aksen kiri kartu — jobAccentBarStyle/
                        hasJobAccentBar di style={} atas. OrderStatusBadge
                        SATU-SATUNYA badge status teks di kartu ini. */}
                    <OrderStatusBadge job={j} />
                    <RentalBadge job={j} />
                  </div>
                  <div className="relative flex shrink-0 items-center gap-0.5">
                    {/* D-140 — "Tanpa link Maps" TIDAK lagi baris pil
                        sendiri (laporan owner: makan tempat di hampir
                        setiap kartu, link Maps memang jarang terisi).
                        `variant="dot"` menempel di pojok kanan-atas grup
                        ikon aksi ini (position:relative di sini) — kondisi
                        & tooltip SAMA PERSIS, cuma bentuknya beda (lihat
                        JobBadges.jsx). Dipasang di grup ikon, bukan di
                        ikon Maps langsung — supaya tetap kelihatan bahkan
                        untuk kasus jarang mapsUrl(j) kosong total. */}
                    <MapsLinkMissingBadge job={j} variant="dot" />
                    {/* Ikon chat WA cepat (8 September 2026, permintaan
                        owner: "admin sales butuh konfirmasi kembali sebelum
                        rute berjalan untuk memastikan customer ada di
                        tempat, jadi gaperlu pergi ke sales crm dulu, trus
                        buka inbox") — buka QuickChatModal.jsx, BUKAN
                        navigasi ke Inbox. null kalau customer belum pernah
                        punya percakapan individual sama sekali (jarang),
                        sama pola dengan ikon Maps di atas: sembunyikan
                        daripada tampil rusak/disabled. */}
                    {conversationIdOf(j) && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setChatJob(j); }}
                        title="Chat cepat dengan pelanggan"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink3 transition-colors hover:bg-greenbg hover:text-green"
                      >
                        <MessageCircle size={16} />
                      </button>
                    )}
                    {/* Ikon link Maps (8 September 2026, permintaan owner:
                        "tambah icon maps sebagai link google maps") —
                        mapsUrl() SATU sumber kebenaran yang sama dipakai
                        DriverJobs.jsx (prioritas link sales > koordinat >
                        pencarian teks, lihat jobStatus.js). stopPropagation
                        supaya klik ikon TIDAK ikut membuka JobDetailDrawer
                        (onClick kartu di bawah). null kalau tidak ada apa
                        pun untuk dituju. */}
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
                    {isEditable && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); jalankan(() => onRemoveJob(route, j.id, editingReason)); }}
                        aria-label={`Keluarkan job dari ${route.code}`}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink3 transition-colors hover:bg-redbg hover:text-red"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Kelompok 2 — IDENTITAS STOP: avatar+nama, jenis produk
                    (sekarang "chip" kecil berbingkai, bukan teks polos yang
                    nyaris sebobot dengan alamat — laporan owner: "produk vs
                    alamat" nyaris tidak dibedakan), lalu alamat dengan ikon
                    pin kecil. Satu kelompok rapat (gap-1), terpisah jelas
                    dari status di atas & jadwal di bawah lewat gap-2 di
                    kontainer luar. */}
                <div className="flex items-start gap-2">
                  <Avatar name={customerOf(j) || "?"} size="sm" gradient className="mt-px h-7 w-7 shrink-0 text-[10px]" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-[13.5px] font-bold text-ink">{customerOf(j) || "Tanpa nama"}</span>
                    {/* Produk & ukuran (8 September 2026, GANTI dari label
                        layanan generik — permintaan owner: "layanan yang
                        dipilih diganti jadi detail produk ukuran, bisa
                        ambil dari inputan order sales, di tab order ada
                        ukuran"). productSummary() SATU sumber kebenaran
                        yang SAMA dipakai Dashboard (lini produk + jenis +
                        ukuran dari parseOrderNotes, lihat orderSummary.js)
                        — bukan implementasi kedua yang bisa diam-diam
                        beda. */}
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

                {/* Kelompok 3 — JADWAL: estimasi jam, tanggal PASTI
                    pengambilan & pengiriman, dan sales person pemegang
                    order — digabung SATU baris meta (dulu 3 baris pil
                    terpisah), dipisah garis tipis dari kelompok identitas
                    di atas. ConfirmedTimeBadge SUDAH menampilkan KEDUANYA
                    kalau ada (bukan cuma yang cocok dengan tipe job ini) —
                    sama prinsip dengan JobDetailDrawer, lihat catatan
                    panjang di JobBadges.jsx#ConfirmedTimeBadge. */}
                {(estimasiJamSingkat(j.timeWindow) || orderOf(j)?.pickupConfirmedDate || orderOf(j)?.deliveryConfirmedDate || salesPersonOf(j)) && (
                  <div className="flex flex-wrap items-center gap-1 border-t border-border pt-1.5">
                    {estimasiJamSingkat(j.timeWindow) && (
                      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-orangebg px-2 py-0.5 text-[10.5px] font-semibold text-orange">
                        <Clock size={11} className="shrink-0" /> EST: {estimasiJamSingkat(j.timeWindow)}
                      </span>
                    )}
                    <ConfirmedTimeBadge job={j} className="flex-wrap" />
                    <SalesBadge job={j} className="w-fit" />
                  </div>
                )}
              </div>
            ))}
        </div>
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

    {chatJob && (
      <QuickChatModal
        conversationId={conversationIdOf(chatJob)}
        customerName={customerOf(chatJob)}
        customerPhone={customerPhoneOf(chatJob)}
        defaultMessage={pesanKonfirmasiDefault(chatJob)}
        onClose={() => setChatJob(null)}
      />
    )}
    </>
  );
}
