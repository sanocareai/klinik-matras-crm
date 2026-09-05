import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RefreshCw, LayoutGrid, List as ListIcon, CalendarDays, User, Navigation } from "lucide-react";
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
import { JobMetaRow } from "@/features/armada/components/JobBadges.jsx";
import { makeRange, toApiParams, formatRangeText } from "@/lib/dateRange.js";
import {
  JOB_STATUS_REAL, JOB_TYPE_REAL, ACTIVE_STATUSES,
  customerOf, orderNumberOf, unitCountOf, jobLabelOf, mapsUrl,
  isJobOverdue, overdueDays,
} from "@/features/armada/jobStatus.js";

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
  const [fDriver, setFDriver] = useState("");

  const [jobs, setJobs] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openJobId, setOpenJobId] = useState(null);

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

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Tab tipe & status dikirim ke SERVER, bukan disaring di browser —
      // daftar job bisa tumbuh besar dan menyaring 500 baris di klien
      // hanya memindahkan biayanya ke perangkat dispatcher.
      const params = {
        q: debounced || undefined,
        // toApiParams(range) -> {} untuk preset "Semua" (from/to null), atau
        // {from,to} — backend GET /armada/jobs sudah dukung keduanya (lihat
        // catatan D-081 di atas). from===to (satu hari terpilih) otomatis
        // jadi filter satu hari juga di backend (gte & lte tanggal yang sama).
        ...toApiParams(range),
        status: fStatus || undefined,
        driverId: fDriver || undefined,
      };
      if (tab === "PICKUP" || tab === "DELIVERY") params.type = tab;
      if (tab === "COMPLETED") params.status = "COMPLETED";

      const res = await api.getArmadaJobs(params);
      let list = res.jobs || [];
      // "Aktif" adalah gabungan beberapa status — backend menerima satu
      // status per permintaan, jadi bagian ini disaring di klien.
      if (tab === "active") list = list.filter((j) => ACTIVE_STATUSES.includes(j.status));
      setJobs(list);
    } catch (e) {
      setError(e.message);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [debounced, range, fStatus, fDriver, tab]);

  // Jangan panggil endpoint dispatcher untuk driver — hasilnya pasti 403 dan
  // cuma mengotori konsol (lihat catatan isDriverOnlyUser di atas).
  useEffect(() => { if (!driverOnly) load(); }, [load, driverOnly]);

  function gantiView(v) {
    setView(v);
    localStorage.setItem("armada-jobs-view", v);
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
            {/* `range.preset` dibandingkan ke "all_time" (D-083) — bukan
                membandingkan from/to mentah, supaya tombol Reset tetap
                akurat walau user memilih "Semua" via preset ATAU lewat
                kalender manual yang kebetulan menghasilkan from/to kosong
                juga (preset beda: "all_time" vs "custom"). */}
            {(cari || range.preset !== "all_time" || fStatus || fDriver) && (
              <Button variant="ghost" size="sm" onClick={() => { setCari(""); setRange(makeRange("all_time")); setFStatus(""); setFDriver(""); }}>
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
                  cari || range.preset !== "all_time" || fStatus || fDriver
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
              // ulang jadi 1 kartu per job, bukan 10 kolom sejajar:
              // job/order di baris meta (mono), jenis+unit jadi chip di
              // sebelah nama, jadwal+driver+kendaraan di baris meta,
              // alamat di baris sendiri (kalau ada), sales+estimasi lewat
              // JobMetaRow yang sudah ada, status di kanan.
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
                        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                      >
                        <Avatar name={nama} size="sm" gradient className="mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-[13px] font-semibold text-ink">{nama}</span>
                            <span className="shrink-0 rounded-chip bg-inset px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-ink3">
                              {JOB_TYPE_REAL[j.type]?.label || j.type}
                            </span>
                            {unitCount > 1 && (
                              <span className="shrink-0 rounded-chip bg-inset px-1.5 py-0.5 text-[9.5px] font-semibold text-ink3">
                                {unitCount} unit
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-ink3">
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
                            {j.vehicle?.plateNumber && (
                              <>
                                <span aria-hidden>·</span>
                                <span>{j.vehicle.plateNumber}</span>
                              </>
                            )}
                          </div>
                          {j.addressText && (
                            <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-ink3">
                              {mapsUrl(j) && (
                                <a
                                  href={mapsUrl(j)} target="_blank" rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  title="Buka di Google Maps"
                                  className="shrink-0 text-accent hover:text-accent/80"
                                >
                                  <Navigation size={11} />
                                </a>
                              )}
                              <span className="truncate">{j.addressText}</span>
                            </div>
                          )}
                          <JobMetaRow job={j} className="mt-1.5" />
                          {overdue && (
                            <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-red">
                              <CalendarDays size={11} /> Terlambat {overdueDays(j)} hari dari jadwal
                            </p>
                          )}
                        </div>
                        <div className="ml-2 shrink-0">
                          <StatusBadge map={JOB_STATUS_REAL} value={j.status} />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
      </PageBody>

        <JobDetailDrawer jobId={openJobId} onClose={() => setOpenJobId(null)} onChanged={load} />
      </PageContainer>
    </>
  );
}
