import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RefreshCw, LayoutGrid, List as ListIcon, CalendarDays, User, Navigation, Lock, PackageCheck, MessageCircle, MapPinned, Clock, BedDouble, CalendarCheck2, ArrowUpDown } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageBody } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Card } from "@/components/ui/card.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { FilterDropdown } from "@/components/ui/filter-dropdown.jsx";
import Avatar from "@/components/Avatar.jsx";
import { cn } from "@/lib/utils.js";
import { rolesOf } from "@/lib/roles.js";
import Armada from "@/pages/Armada.jsx";
import StatusBadge from "@/features/armada/components/StatusBadge.jsx";
import DeliveryPageHero from "@/features/armada/components/DeliveryPageHero.jsx";
import JobDetailDrawer from "@/features/armada/components/JobDetailDrawer.jsx";
import QuickChatModal from "@/features/armada/components/QuickChatModal.jsx";
import ExternalCourierBadge from "@/features/armada/components/ExternalCourierBadge.jsx";
import { useArmadaJobs } from "@/features/armada/hooks/useArmadaJobs.js";
import {
  RentalBadge, ConfirmedTimeBadge, CityBadge, OrderStatusBadge, MapsLinkMissingBadge, SalesBadge, RevisionBadge, ComplaintBadge,
} from "@/features/armada/components/JobBadges.jsx";
import { productSummary } from "@/features/inbox/components/CustomerPanel/orderSummary.js";
import { makeRange, toApiParams, formatRangeText } from "@/lib/dateRange.js";
import { ORDER_STATUS_LABELS } from "@/utils/format.js";
import {
  JOB_STATUS_REAL, JOB_TYPE_REAL,
  customerOf, orderNumberOf, unitCountOf, jobLabelOf, mapsUrl, orderOf, conversationIdOf, customerPhoneOf, salesPersonOf,
  isJobOverdue, overdueDays, jobAccentBarStyle, hasJobAccentBar,
} from "@/features/armada/jobStatus.js";

// "EST: Di atas 09.00" — SATU SUMBER dengan RouteCard.jsx/UnroutedJobsPanel.jsx
// (duplikasi fungsi murni, bukan import silang antar kartu yang sengaja
// terpisah — pola yang sudah dipegang project ini, lihat catatan di file itu).
function estimasiJamSingkat(timeWindow) {
  if (!timeWindow) return null;
  return timeWindow
    .trim()
    .replace(/^est\.?:?\s*/i, "")
    .replace(/^di\s*atas\s*jam\s*/i, "Di atas ");
}

// Pesan konfirmasi default — SATU SUMBER dengan RouteCard.jsx/UnroutedJobsPanel.jsx.
function pesanKonfirmasiDefault(job) {
  const nama = customerOf(job) || "Kak";
  const aksi = job?.type === "PICKUP" ? "pengambilan" : "pengiriman";
  return `Halo ${nama}, mohon konfirmasi untuk jadwal ${aksi} kasur hari ini — apakah Anda/perwakilan ada di tempat? Terima kasih 🙏`;
}

// Jadwal & Penugasan — Delivery Tahap 2.
//
// ⚠️ DATA NYATA, bukan contoh. Halaman ini memakai GET /armada/jobs (endpoint
// baru, berfilter) — bukan data dummy seperti dashboard. Karena itu TIDAK ADA
// badge "Contoh" di sini, dan tidak boleh ditambahkan: penandanya justru yang
// membedakan halaman ini dari dashboard.
//
// DUA MODE TAMPILAN:
//   Daftar (default) — tabel berfilter, yang diminta spesifikasi
//   Papan            — <Armada /> APA ADANYA, papan per-driver yang sudah
//                      dipakai tim hari ini untuk menjadwalkan & menugaskan
//
// Papan sengaja DIPERTAHANKAN, bukan diganti: di sanalah dispatcher membuat
// job, menugaskan driver, dan mengurutkan rute — semuanya sudah berfungsi
// dengan backend nyata. Menggantinya dengan tabel baru berarti membuang alur
// kerja yang sudah jalan demi tampilan. Tabel MENAMBAH cara melihat, bukan
// mengganti cara bekerja.
//
// KONSISTENSI PAPAN/DAFTAR (D-080, 5 September 2026) — laporan owner: "buat
// mode papan dan list sama-sama seperti ini konsisten [screenshot Papan],
// cuman tinggal ubah tanggal agar selaras dengan yang lain". Sebelum ini
// mode Daftar me-render PageHeader-nya SENDIRI ("Jadwal & Penugasan", tanpa
// hero) — beda TOTAL dari Papan ("Delivery & Fulfillment" + hero "Delivery
// command center"), padahal keduanya SATU workspace yang sama. Sekarang
// keduanya memakai <DeliveryPageHero> yang SAMA PERSIS (lihat komponen itu
// untuk detail) — cuma isi `stats`-nya beda (Papan dari board per tipe,
// Daftar dari daftar job hasil filter yang sedang tampil).
//
// DATE RANGE PICKER (D-081, 5 September 2026) — laporan owner: "tanggal
// buat seperti route planner". `tanggal` (satu hari, default hari ini)
// diganti `range` (DateRange, lib/dateRange.js) — SATU skema tanggal yang
// sama dengan Dashboard/Laporan/Orders.jsx/Route Planner. BEDA dari Papan
// (Armada.jsx): GET /armada/jobs yang dipakai Daftar SUDAH DUKUNG `from`/
// `to` (bukan cuma `date` tunggal), jadi Daftar bisa langsung memakai
// rentang APA ADANYA (toApiParams(range)) tanpa perlu jatuh ke satu hari
// seperti Papan (yang backend board-nya memang cuma dukung satu tanggal).
//
// Tampilan Kalender (spesifikasi) BELUM ada — butuh komponen kalender bulanan
// yang menempatkan job per tanggal; dijadwalkan bersama Route Planner Tahap 3,
// karena keduanya berbagi soal "job pada tanggal berapa".

const TABS = [
  { key: "all",       label: "Semua" },
  { key: "PICKUP",    label: "Pengambilan" },
  { key: "DELIVERY",  label: "Pengiriman" },
  { key: "active",    label: "Aktif" },
  { key: "COMPLETED", label: "Selesai" },
];

// Sort tanggal PASTI (9 September 2026) — lihat catatan panjang di
// ArmadaOrders.jsx SORT_OPTIONS & routes/armada.js GET /jobs.
const SORT_OPTIONS = [
  { value: "pickupConfirmedDate", label: "Tanggal Ambil Pasti (terdekat)" },
  { value: "deliveryConfirmedDate", label: "Tanggal Kirim Pasti (terdekat)" },
];

// Driver TIDAK punya JOB_READ (cuma JOB_OWN_READ — lihat
// backend/src/constants/permissions.js), jadi seluruh tampilan "Daftar" di
// bawah — GET /armada/jobs + GET /armada/drivers — dijawab 403 untuk mereka.
//
// BUG NYATA (21 Agustus 2026, ketahuan saat uji kesiapan divisi dengan akun
// driver sungguhan): driver yang membuka /armada/jobs mendarat di tampilan
// DISPATCHER yang gagal memuat, bukan daftar job miliknya sendiri. Halaman
// driver-nya sebenarnya SUDAH ADA dan berfungsi (Armada.jsx punya cabang
// isDriverOnly yang merender "Job Saya" + <DriverJobs />), tapi tidak pernah
// tercapai karena default `view` = "list" milik dispatcher.
//
// Karena itu driver-only diserahkan LANGSUNG ke <Armada />, tanpa pemilih
// tampilan (Daftar/Papan tidak berarti apa-apa untuk driver — dia cuma punya
// satu tampilan) dan tanpa memanggil endpoint yang memang bukan haknya.
function isDriverOnlyUser() {
  try {
    const roles = rolesOf(JSON.parse(localStorage.getItem("user") || "null"));
    // HELPER (D-037) diperlakukan sama dengan DRIVER di sini. LEADER_DRIVER
    // (D-042) diperlakukan sama dengan ADMIN/DISPATCHER — punya JOB_READ
    // penuh, berhak tampilan "Daftar" dispatcher lengkap.
    return roles.some((r) => ["DRIVER", "HELPER"].includes(r)) && !roles.some((r) => ["ADMIN", "DISPATCHER", "LEADER_DRIVER"].includes(r));
  } catch {
    return false;
  }
}

export default function ArmadaJobs() {
  const driverOnly = isDriverOnlyUser();
  const [searchParams, setSearchParams] = useSearchParams();

  const [view, setView] = useState(() => localStorage.getItem("armada-jobs-view") || "list");
  const [tab, setTab] = useState("all");
  const [cari, setCari] = useState("");
  const [debounced, setDebounced] = useState("");
  // Default "Semua" (D-083, 5 September 2026 — laporan owner: "default
  // tanggal pilih semua hari dulu") — preset DateRange, bukan string
  // tanggal tunggal. SAMA pola dengan Route Planner (ArmadaRoutes.jsx)
  // yang juga default "Semua": dispatcher paling sering perlu lihat SEMUA
  // job aktif dulu (lintas tanggal), baru persempit ke hari/rentang
  // tertentu kalau memang perlu — bukan sebaliknya. Tombol "Reset" di
  // bawah mengembalikannya ke preset ini.
  const [range, setRange] = useState(() => makeRange("all_time"));
  const [fStatus, setFStatus] = useState("");
  // Filter status ORDER (6 September 2026, laporan owner: "filter disini
  // ganti aja sesuai dengan order/pipeline") — TERPISAH dari fStatus di
  // atas (status JOB/armada). Dropdown BARU, bukan menggantikan fStatus —
  // dispatcher tetap perlu cari "job belum ada driver" dst lewat fStatus,
  // yang ini menjawab pertanyaan beda: "order mana yang sudah Siap Kirim".
  const [fOrderStatus, setFOrderStatus] = useState("");
  const [fDriver, setFDriver] = useState("");
  // Filter+sort tanggal PASTI (9 September 2026, laporan owner: "tambahkan
  // sebuah filter yang sudah punya tanggal pengambilan dan pengiriman
  // pasti" + "tambah fitur sort") — lihat catatan panjang di
  // routes/armada.js GET /jobs & ArmadaOrders.jsx SORT_OPTIONS.
  const [fHasConfirmedDate, setFHasConfirmedDate] = useState(false);
  const [sortBy, setSortBy] = useState("");

  const [drivers, setDrivers] = useState([]);
  const [openJobId, setOpenJobId] = useState(null);
  // Laporan Kurir Eksternal (D-161, 13 September 2026) — kirim ringkasan
  // job hari ini yang drivernya Kurir Eksternal ke Natasha, satu tombol,
  // padanan "Terbitkan Rute" utk job Lalamove (yang memang tidak pernah
  // masuk Route Planner, lihat catatan di routes/armada.js).
  const [courierReportBusy, setCourierReportBusy] = useState(false);
  const [courierReportMsg, setCourierReportMsg] = useState("");
  // Chat WA cepat (8 September 2026, disamakan dengan RouteCard.jsx —
  // lihat catatan panjang di komentar kartu job di bawah) — job yang
  // QuickChatModal sedang dibuka untuknya, null = tertutup.
  const [chatJob, setChatJob] = useState(null);

  // Deep-link ?job= — dipakai kartu KPI & daftar issue di dashboard, dan
  // notifikasi Delivery nanti. Param dibuang setelah dipakai supaya refresh
  // manual tidak membuka drawer yang sama lagi.
  useEffect(() => {
    const id = searchParams.get("job");
    if (!id) return;
    setOpenJobId(id);
    setSearchParams((prev) => { prev.delete("job"); return prev; }, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(cari.trim()), 300);
    return () => clearTimeout(t);
  }, [cari]);

  // Daftar driver cuma dipakai filter dispatcher — GET /armada/drivers butuh
  // JOB_WRITE, jadi untuk driver ini pasti 403 (lihat isDriverOnlyUser).
  useEffect(() => {
    if (driverOnly) return;
    api.getDrivers().then(setDrivers).catch(() => {});
  }, [driverOnly]);

  // Data lewat TanStack Query (8 September 2026, laporan owner: "optimalkan
  // agar lebih smooth, fast, enteng" — lihat catatan panjang di
  // useArmadaJobs.js). `enabled: !driverOnly` MENGGANTIKAN guard manual
  // "jangan panggil endpoint dispatcher untuk driver" — react-query tidak
  // fetch sama sekali kalau `enabled` false, sama efeknya, satu baris lebih
  // sedikit.
  const {
    data: jobs, isLoading: loading, error: queryError, refetch: load,
  } = useArmadaJobs({ enabled: !driverOnly, debounced, range, fStatus, fOrderStatus, fDriver, tab, toApiParams, fHasConfirmedDate, sortBy });
  const error = queryError?.message || "";

  function gantiView(v) {
    setView(v);
    localStorage.setItem("armada-jobs-view", v);
  }

  // BUG DIPERBAIKI (13 September 2026, laporan owner — screenshot "Tidak
  // ada job kurir eksternal untuk tanggal ini" walau kartunya jelas ada) —
  // sebelumnya SELALU query "hari ini" versi jam server, padahal tombolnya
  // duduk di kartu job yang scheduledDate-nya bisa BEDA hari (mis. job
  // besok yang sudah dijadwalkan hari ini). Sekarang WAJIB dikirim tanggal
  // job yang kartunya diklik — laporan mencakup tanggal itu, bukan tebakan
  // "hari ini" yang bisa salah.
  async function kirimLaporanKurirEksternal(scheduledDate) {
    setCourierReportBusy(true);
    setCourierReportMsg("");
    try {
      // j.scheduledDate dari API adalah ISO PENUH ("2026-09-13T00:00:00.000Z")
      // — backend toDateOnly() menempelkan "T00:00:00.000Z" LAGI di
      // belakang string yang dikirim (lihat catatan di routes/armada.js),
      // jadi WAJIB dipotong ke "YYYY-MM-DD" saja di sini dulu, bukan
      // dikirim mentah.
      const tanggalSaja = scheduledDate ? String(scheduledDate).slice(0, 10) : undefined;
      const { jobCount } = await api.notifyExternalCourierNatasha(tanggalSaja);
      setCourierReportMsg(`Terkirim ke Natasha (${jobCount} job).`);
    } catch (e) {
      setCourierReportMsg(e.message);
    } finally {
      setCourierReportBusy(false);
    }
  }

  const kosong = !loading && jobs && jobs.length === 0;

  const toggle = (
    <div className="flex items-center gap-1.5">
      <div className="flex rounded-btn border border-border p-0.5" role="group" aria-label="Mode tampilan">
        <button
          type="button"
          onClick={() => gantiView("list")}
          aria-pressed={view === "list"}
          className={cn("flex items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 text-[12px] font-semibold transition-colors",
            view === "list" ? "bg-accentbg text-accent" : "text-ink3 hover:text-ink2")}
        >
          <ListIcon size={13} /> Daftar
        </button>
        <button
          type="button"
          onClick={() => gantiView("board")}
          aria-pressed={view === "board"}
          className={cn("flex items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 text-[12px] font-semibold transition-colors",
            view === "board" ? "bg-accentbg text-accent" : "text-ink3 hover:text-ink2")}
        >
          <LayoutGrid size={13} /> Papan
        </button>
      </div>
      {view === "list" && (
        <Button variant="ghost" size="sm" onClick={load} disabled={loading} aria-label="Muat ulang">
          <RefreshCw size={14} className={loading ? "animate-spin" : undefined} />
        </Button>
      )}
    </div>
  );

  // Mode PAPAN: <Armada /> merender PageContainer + header-NYA SENDIRI
  // (DeliveryPageHero, sama komponen dengan yang dipakai mode Daftar di
  // bawah — lihat D-080). Membungkusnya lagi di PageContainer milik halaman
  // ini akan menghasilkan padding dan max-width GANDA (konten menyempit dua
  // kali). Jadi di mode ini halaman ini hanya menyisipkan pemilih tampilan
  // di atasnya, lalu menyerahkan seluruh sisanya ke Armada apa adanya.
  // Driver: langsung ke layar kerjanya sendiri ("Job Saya" + <DriverJobs />
  // di dalam Armada.jsx), tanpa pemilih tampilan dispatcher.
  if (driverOnly) return <Armada />;

  if (view === "board") {
    return (
      <>
        {/* `justify-end` (D-053, 4 September 2026) — laporan owner: tombol
            ganti mode "pindah dari kiri ke kanan" waktu ditoggle. Sebabnya:
            di mode Daftar toggle ini duduk sebagai `actions` PageHeader (rata
            KANAN, sejajar judul — lihat PageHeader di bawah), tapi di sini ia
            dulu dirender polos tanpa pengaturan posisi apa pun, jadi jatuh ke
            rata KIRI bawaan block-level. Disamakan rata kanan di sini supaya
            posisi X toggle konsisten lintas mode — Y-nya tetap beda (di atas
            header Armada.jsx sendiri, bukan sejajar judulnya) karena Papan
            memakai header terpisah (lihat catatan komponen di atas), tapi
            perpindahan kiri-kanan yang paling mengganggu sudah hilang. */}
        <div className="mx-auto flex w-full max-w-[1400px] justify-end px-4 pt-4 md:px-8">{toggle}</div>
        <Armada />
        <JobDetailDrawer jobId={openJobId} onClose={() => setOpenJobId(null)} onChanged={load} />
      </>
    );
  }

  // Stats hero mode Daftar (D-080) — angka NYATA dari `jobs` hasil filter
  // yang SEDANG tampil (bukan sumber yang sama dengan board Papan — lihat
  // catatan panjang di DeliveryPageHero.jsx soal ini SENGAJA beda sumber,
  // cuma sama bentuk). `jobsAktif` mengecualikan riwayat (COMPLETED/FAILED)
  // supaya "belum ada driver" tidak ikut menghitung job lama yang memang
  // tidak akan pernah dapat driver lagi (riwayat backfill, lihat catatan
  // `historis` di render kartu di bawah).
  const jobsAktif = (jobs || []).filter((j) => !["COMPLETED", "FAILED"].includes(j.status));
  const tanpaDriver = jobsAktif.filter((j) => !j.driverId).length;
  const terlambat = jobsAktif.filter(isJobOverdue).length;
  const labelJenis = tab === "PICKUP" ? "Job pengambilan" : tab === "DELIVERY" ? "Job pengiriman" : "Job ditampilkan";

  return (
    <>
      {/* Sama posisi (X & Y) dengan toggle di mode Papan — lihat komentar
          D-053 di atas untuk kenapa ini penting, sekarang ditegakkan di
          KEDUA mode, bukan cuma salah satu. */}
      <div className="mx-auto flex w-full max-w-[1400px] justify-end px-4 pt-4 md:px-8">{toggle}</div>
      <PageContainer>
        <DeliveryPageHero
          range={range}
          onRangeChange={setRange}
          onCreateJob={() => gantiView("board")}
          health={jobs && (
            terlambat > 0
              ? { label: `${terlambat} job terlambat dari jadwal`, tone: "warn" }
              : tanpaDriver > 0
                ? { label: `${tanpaDriver} job belum ada driver`, tone: "warn" }
                : { label: "Semua job sudah ada driver", tone: "ok" }
          )}
          stats={jobs ? [
            { label: labelJenis, value: jobs.length, hint: formatRangeText(range) },
            { label: "Sudah ada driver", value: jobs.filter((j) => j.driverId).length, hint: `dari ${jobs.length} job` },
            { label: "Selesai", value: jobs.filter((j) => j.status === "COMPLETED").length, hint: "sesuai filter" },
            { label: "Belum ada driver", value: tanpaDriver, hint: "job aktif" },
            // Kotak ke-5 (redesain Sep 2026) — grid WorkspaceHero (4 kolom di
            // desktop) menampung ini di baris baru, bukan menggeser 4 kotak
            // lama. Sengaja TIDAK menggantikan salah satu kotak di atas:
            // "terlambat" (janji tanggal terlewat) dan "belum ada driver"
            // (belum sempat ditugaskan) adalah dua masalah berbeda, dispatcher
            // perlu lihat dua-duanya sekaligus.
            { label: "Terlambat", value: terlambat, hint: "lewat tanggal terjadwal" },
          ] : []}
        />

      <PageBody>
          {/* Tab */}
          <div role="tablist" aria-label="Saring jenis job" className="flex flex-wrap gap-1 border-b border-line pb-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn("rounded-chip px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                  tab === t.key ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint hover:text-ink2")}
              >
                {t.label}
              </button>
            ))}
            {jobs && (
              <span className="ml-auto self-center text-[11.5px] text-ink3">{jobs.length} job</span>
            )}
          </div>

          {/* Filter — HANYA field yang benar-benar ada di database.
              Area/SLA/Prioritas sengaja tidak ditampilkan: filter yang selalu
              mengembalikan kosong terbaca sebagai sistem rusak. */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder="Cari pelanggan, nomor order, alamat…"
              aria-label="Cari job"
              className="h-9 min-w-[200px] flex-1 rounded-btn border border-border bg-surface px-3 text-[12.5px] text-ink outline-none transition-colors placeholder:text-ink3 focus:border-accent"
            />
            {/* DatePicker tanggal DIHAPUS dari sini (D-080) — sudah dipindah
                ke DeliveryPageHero di atas (satu kontrol tanggal per
                halaman, bukan dua yang mengatur state yang sama). */}
            <FilterDropdown
              value={fStatus}
              onChange={setFStatus}
              options={Object.entries(JOB_STATUS_REAL).map(([k, s]) => ({ value: k, label: s.label }))}
              placeholder="Semua status"
              icon={ListIcon}
              ariaLabel="Filter status"
            />
            {/* Filter status ORDER (6 September 2026, laporan owner: "filter
                disini ganti aja sesuai dengan order/pipeline") — dropdown
                BARU, terpisah dari "Semua status" di atas (itu status job/
                armada). Options-nya PERSIS ORDER_STATUS_LABELS yang sama
                dipakai Orders.jsx/Pipeline.jsx, supaya kategorinya konsisten
                di seluruh app, bukan daftar karangan sendiri untuk halaman
                ini. Backend: GET /armada/jobs?orderStatus=X (armada.js). */}
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
            <FilterDropdown
              value={fDriver}
              onChange={setFDriver}
              options={[
                { value: "none", label: "Belum ada driver" },
                ...drivers.map((d) => ({ value: d.id, label: d.name })),
              ]}
              placeholder="Semua driver"
              icon={User}
              ariaLabel="Filter driver"
            />
            {/* Filter+sort tanggal PASTI (9 September 2026) — lihat catatan
                panjang di SORT_OPTIONS di atas. */}
            <button
              type="button"
              onClick={() => setFHasConfirmedDate((v) => !v)}
              aria-pressed={fHasConfirmedDate}
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-btn border px-3 text-[12.5px] font-semibold transition-colors",
                fHasConfirmedDate ? "border-accent bg-accentbg text-accent" : "border-border text-ink2 hover:bg-hovertint"
              )}
            >
              <CalendarCheck2 size={14} /> Ada Tanggal Pasti
            </button>
            <FilterDropdown
              value={sortBy}
              onChange={setSortBy}
              options={SORT_OPTIONS}
              placeholder="Urutan default"
              icon={ArrowUpDown}
              ariaLabel="Urutkan berdasarkan"
            />
            {/* `range.preset` dibandingkan ke "all_time" (D-083) — bukan
                membandingkan from/to mentah, supaya tombol Reset tetap
                akurat walau user memilih "Semua" via preset ATAU lewat
                kalender manual yang kebetulan menghasilkan from/to kosong
                juga (preset beda: "all_time" vs "custom"). */}
            {(cari || range.preset !== "all_time" || fStatus || fOrderStatus || fDriver || fHasConfirmedDate || sortBy) && (
              <Button
                variant="ghost" size="sm"
                onClick={() => {
                  setCari(""); setRange(makeRange("all_time")); setFStatus(""); setFOrderStatus(""); setFDriver("");
                  setFHasConfirmedDate(false); setSortBy("");
                }}
              >
                Reset
              </Button>
            )}
          </div>

          {error && (
            <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">
              Gagal memuat job: {error}
            </div>
          )}

          <Card className="overflow-hidden">
            {kosong ? (
              <EmptyState
                icon={CalendarDays}
                title="Belum ada job yang cocok"
                description={
                  cari || range.preset !== "all_time" || fStatus || fOrderStatus || fDriver
                    ? "Coba longgarkan filter atau kata kuncinya."
                    : "Job dibuat dari mode Papan — pilih unit yang siap lalu tugaskan driver."
                }
                action={<Button size="sm" onClick={() => gantiView("board")}>Buka Papan</Button>}
              />
            ) : (
              // Daftar kartu avatar-forward (D-052, 4 September 2026) —
              // MENGGANTIKAN tabel 10-kolom sebelumnya. Laporan owner:
              // halaman ini masih "tampilan lama" dibanding Dashboard yang
              // sudah dirapikan (D-050/D-051). Satu markup dipakai untuk
              // SEMUA lebar layar sekarang (sebelumnya ada tabel desktop +
              // kartu mobile terpisah yang harus dirawat berdua-dua, gampang
              // diam-diam beda) — pola & badge-nya sama persis dengan panel
              // "Perlu Dijadwalkan" di Dashboard, supaya dua halaman yang
              // sama-sama berisi daftar job terasa satu bahasa visual.
              //
              // TIDAK ADA info yang hilang dari tabel lama — cuma disusun
              // ulang jadi 1 kartu per job, bukan 10 kolom sejajar.
              //
              // DISAMAKAN dengan kartu stop Route Planner (8 September 2026,
              // laporan owner: "gue ingin isi card order di jadwal &
              // penugasan mirip dengan yang ada di route planner") — 3
              // kelompok visual yang SAMA (RouteCard.jsx/UnroutedJobsPanel.jsx
              // D-140): status+ikon aksi di atas, avatar+nama+chip produk
              // (productSummary, BUKAN ServiceLabel generik lagi)+alamat di
              // tengah, EST jam+tanggal pasti+sales di bawah. Chat WA cepat
              // & link Maps SEKARANG juga ada di sini (sebelumnya cuma di
              // Route Planner) — dispatcher yang kerja dari halaman ini
              // tidak perlu pindah ke Route Planner cuma untuk itu.
              //
              // TETAP BEDA satu hal, SENGAJA: baris meta order/tanggal/
              // driver/kendaraan (font mono) — RouteCard tidak butuh ini
              // (jobnya sudah pasti 1 tanggal/1 rute), daftar INI lintas
              // tanggal & driver, jadi info itu tetap relevan di sini.
              <ul className="divide-y divide-line">
                {loading && Array.from({ length: 6 }).map((_, i) => (
                  <li key={i} className="px-4 py-3">
                    <div className="h-14 animate-pulse rounded-btn bg-inset" />
                  </li>
                ))}
                {!loading && jobs?.map((j) => {
                  // Job RIWAYAT (selesai/gagal sebelum sistem Armada dipakai,
                  // lihat catatan backfill di JobDetailDrawer) TIDAK PUNYA
                  // driver/tanggal — itu WAJAR untuk data lama, bukan sesuatu
                  // yang masih perlu ditindak. Warna oranye "Belum" cuma
                  // untuk job yang SUNGGUH menunggu tindakan (laporan owner
                  // 31 Agustus 2026: ratusan baris riwayat terlihat seperti
                  // backlog pending padahal sudah lama tuntas).
                  const historis = ["COMPLETED", "FAILED"].includes(j.status);
                  const nama = customerOf(j) || "Tanpa nama";
                  const unitCount = unitCountOf(j);
                  // SLA — job yang tanggal terjadwalnya SUDAH LEWAT tapi belum
                  // selesai (redesain Sep 2026). Beda dari "Belum dijadwalkan"
                  // (oranye, di atas) — ini job yang SUDAH dijanjikan ke
                  // tanggal tertentu tapi janjinya terlewat. Lihat catatan
                  // lengkap di jobStatus.js#isJobOverdue.
                  const overdue = isJobOverdue(j);
                  return (
                    <li key={j.id}>
                      <button
                        type="button"
                        onClick={() => setOpenJobId(j.id)}
                        // Glow aksen kiri per tipe (revisi Sep 2026 — owner
                        // minta versi TENANG, bukan gradasi penuh, untuk
                        // daftar padat ini). Sewa=oranye, Pengiriman=hijau,
                        // Pengambilan=biru (DIBALIK 8 September 2026 — warna
                        // sekarang murni dari job.type, bukan status order;
                        // lihat catatan panjang di jobStatus.js#jobAccentBarStyle).
                        style={jobAccentBarStyle(j)}
                        className={cn(
                          "relative flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
                          hasJobAccentBar(j) && "dh-bar-left"
                        )}
                      >
                        {/* Kelompok 1 — STATUS: badge kota/status/sewa/
                            route-lock/unit (kiri), aksi ikon chat+Maps
                            (tengah-kanan), label tipe+status job (paling
                            kanan) — sama susunan dengan RouteCard.jsx,
                            cuma ditambah label tipe+status job yang TIDAK
                            ada di sana (lihat catatan di atas kenapa). */}
                        <div className="flex items-start gap-1.5">
                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                            <CityBadge job={j} />
                            <OrderStatusBadge job={j} />
                            <RentalBadge job={j} />
                            <RevisionBadge job={j} />
                            <ComplaintBadge job={j} />
                            {/* Sudah masuk Route (D-077, 6 September 2026) —
                                dulu tabel ini nol indikasi soal ini, jadi
                                dispatcher baru tahu drivernya "terkunci" ke
                                Route Planner SETELAH klik baris & coba ganti
                                driver (gagal dengan error backend). Badge ini
                                memberi tahu LEBIH DULU, sebelum klik. */}
                            {j.route && (
                              <span
                                title={`Driver/helper/kendaraan job ini diatur di Route Planner (${j.route.code}), bukan di sini`}
                                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-inset px-2 py-0.5 text-[10.5px] font-semibold text-ink2"
                              >
                                <Lock size={10} className="shrink-0" /> {j.route.code}
                              </span>
                            )}
                            {unitCount > 1 && (
                              <span className="shrink-0 rounded-chip bg-inset px-1.5 py-0.5 text-[9.5px] font-semibold text-ink3">
                                {unitCount} unit
                              </span>
                            )}
                          </div>
                          <div className="relative flex shrink-0 items-center gap-0.5">
                            <MapsLinkMissingBadge job={j} variant="dot" />
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
                            {mapsUrl(j) && (
                              <a
                                href={mapsUrl(j)} target="_blank" rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                title="Buka lokasi di Google Maps"
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink3 transition-colors hover:bg-accentbg hover:text-accent"
                              >
                                <MapPinned size={16} />
                              </a>
                            )}
                          </div>
                          {/* Label tipe job DI ATAS badge status (8 September
                              2026, laporan owner — contoh nyata Lim Fie Boen/
                              RES-30082026-206: baris cuma nampilin "SELESAI"
                              polos, dibaca seolah seluruh order sudah beres,
                              padahal itu status JOB PENGAMBILAN doang — order-
                              nya sendiri masih "Diproses", job Pengiriman
                              belum ada. TIDAK dihapus walau RouteCard.jsx
                              sengaja tidak punya ini — beda konteks, daftar
                              ini nunjukin status JOB [PICKUP/DELIVERY lepas-
                              lepas], RouteCard cuma nunjukin status ORDER. */}
                          <div className="shrink-0 text-right">
                            <div className="mb-0.5 text-[10px] font-semibold text-ink3">
                              {JOB_TYPE_REAL[j.type]?.label}
                            </div>
                            <StatusBadge map={JOB_STATUS_REAL} value={j.status} />
                          </div>
                        </div>

                        {/* Kelompok 2 — IDENTITAS: avatar+nama, chip produk
                            (productSummary — SAMA sumber dengan RouteCard,
                            GANTI ServiceLabel generik), alamat + ikon pin. */}
                        <div className="flex items-start gap-2">
                          <Avatar name={nama} size="sm" gradient className="mt-px h-7 w-7 shrink-0 text-[10px]" />
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="truncate text-[13.5px] font-bold text-ink">{nama}</span>
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

                        {/* Baris meta order/tanggal/driver/kendaraan — TETAP
                            ADA, TIDAK ada padanannya di RouteCard (lihat
                            catatan di atas kenapa daftar ini beda). */}
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-ink3">
                          <span className="font-mono">{orderNumberOf(j) || jobLabelOf(j)}</span>
                          <span aria-hidden>·</span>
                          <span className={cn(!j.scheduledDate && !historis && "font-semibold text-orange")}>
                            {j.scheduledDate
                              ? new Date(j.scheduledDate).toLocaleDateString("id-ID", { day: "numeric", month: "short" })
                              : historis ? "—" : "Belum dijadwalkan"}
                          </span>
                          <span aria-hidden>·</span>
                          <span className={cn(!j.driver && !historis && "font-semibold text-orange")}>
                            {j.driver?.name || (historis ? "—" : "Belum ada driver")}
                          </span>
                          <ExternalCourierBadge person={j.driver} />
                          {j.vehicle?.plateNumber && (
                            <>
                              <span aria-hidden>·</span>
                              <span>{j.vehicle.plateNumber}</span>
                            </>
                          )}
                        </div>

                        {/* Laporan Kurir Eksternal (D-161, 13 September 2026,
                            laporan owner: "tombol itu muncul khusus untuk
                            order yang dikirim dengan kurir eksternal") —
                            SENGAJA nempel di kartu job yang drivernya Kurir
                            Eksternal, BUKAN tombol umum di toolbar (itu
                            sebelumnya bikin bingung — tombolnya seolah relevan
                            utk semua job, padahal cuma berarti kalau ada job
                            Lalamove). Aksinya TETAP sama: kirim SATU laporan
                            berisi SEMUA job Kurir Eksternal hari ini (bukan
                            cuma job ini), lihat kirimLaporanKurirEksternal. */}
                        {j.driver?.isExternalCourier && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); kirimLaporanKurirEksternal(j.scheduledDate); }}
                            disabled={courierReportBusy}
                            title="Kirim ringkasan SEMUA job Kurir Eksternal hari ini ke Natasha"
                            className="flex w-fit items-center gap-1.5 rounded-full bg-accentbg px-2.5 py-1 text-[11px] font-semibold text-accent transition-opacity hover:opacity-80 disabled:opacity-50"
                          >
                            <MessageCircle size={12} />
                            {courierReportBusy ? "Mengirim…" : "Kirim Laporan Kurir Eksternal ke Natasha"}
                          </button>
                        )}
                        {courierReportMsg && j.driver?.isExternalCourier && (
                          <p className="text-[10.5px] text-ink3">{courierReportMsg}</p>
                        )}

                        {/* Kelompok 3 — JADWAL: EST jam, tanggal PASTI ambil/
                            kirim, sales — SAMA persis dengan RouteCard.jsx. */}
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

                        {overdue && (
                          <p className="flex items-center gap-1 text-[11px] font-semibold text-red">
                            <CalendarDays size={11} /> Terlambat {overdueDays(j)} hari dari jadwal
                          </p>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
      </PageBody>

        <JobDetailDrawer jobId={openJobId} onClose={() => setOpenJobId(null)} onChanged={load} />
        {chatJob && (
          <QuickChatModal
            conversationId={conversationIdOf(chatJob)}
            customerName={customerOf(chatJob)}
            customerPhone={customerPhoneOf(chatJob)}
            defaultMessage={pesanKonfirmasiDefault(chatJob)}
            onClose={() => setChatJob(null)}
          />
        )}
      </PageContainer>
    </>
  );
}
