import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RefreshCw, LayoutGrid, List as ListIcon, CalendarDays } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Card } from "@/components/ui/card.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows,
} from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import { rolesOf } from "@/lib/roles.js";
import Armada from "@/pages/Armada.jsx";
import StatusBadge from "@/features/armada/components/StatusBadge.jsx";
import JobDetailDrawer from "@/features/armada/components/JobDetailDrawer.jsx";
import {
  JOB_STATUS_REAL, JOB_TYPE_REAL, ACTIVE_STATUSES,
  customerOf, orderNumberOf, unitCountOf,
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

const selectClass =
  "h-9 rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none transition-colors focus:border-accent";

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
    return roles.includes("DRIVER") && !roles.some((r) => ["ADMIN", "DISPATCHER"].includes(r));
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
  const [tanggal, setTanggal] = useState("");
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
        date: tanggal || undefined,
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
  }, [debounced, tanggal, fStatus, fDriver, tab]);

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

  // Mode PAPAN: <Armada /> merender PageContainer + PageHeader-NYA SENDIRI.
  // Membungkusnya lagi di PageContainer milik halaman ini akan menghasilkan
  // padding dan max-width GANDA (konten menyempit dua kali). Jadi di mode ini
  // halaman ini hanya menyisipkan pemilih tampilan di atasnya, lalu
  // menyerahkan seluruh sisanya ke Armada apa adanya.
  // Driver: langsung ke layar kerjanya sendiri ("Job Saya" + <DriverJobs />
  // di dalam Armada.jsx), tanpa pemilih tampilan dispatcher.
  if (driverOnly) return <Armada />;

  if (view === "board") {
    return (
      <>
        <div className="mx-auto w-full max-w-[1400px] px-4 pt-4 md:px-8">{toggle}</div>
        <Armada />
        <JobDetailDrawer jobId={openJobId} onClose={() => setOpenJobId(null)} />
      </>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Jadwal &amp; Penugasan"
        subtitle="Seluruh job pengambilan dan pengiriman, beserta driver dan armadanya."
        actions={toggle}
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
            <label className="sr-only" htmlFor="f-tanggal">Tanggal</label>
            <input id="f-tanggal" type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} className={selectClass} />
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Filter status" className={selectClass}>
              <option value="">Semua status</option>
              {Object.entries(JOB_STATUS_REAL).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
            <select value={fDriver} onChange={(e) => setFDriver(e.target.value)} aria-label="Filter driver" className={selectClass}>
              <option value="">Semua driver</option>
              <option value="none">Belum ada driver</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            {(cari || tanggal || fStatus || fDriver) && (
              <Button variant="ghost" size="sm" onClick={() => { setCari(""); setTanggal(""); setFStatus(""); setFDriver(""); }}>
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
                  cari || tanggal || fStatus || fDriver
                    ? "Coba longgarkan filter atau kata kuncinya."
                    : "Job dibuat dari mode Papan — pilih unit yang siap lalu tugaskan driver."
                }
                action={<Button size="sm" onClick={() => gantiView("board")}>Buka Papan</Button>}
              />
            ) : (
              <>
                <TableWrap className="hidden md:block">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Job</TH><TH>Order</TH><TH>Pelanggan</TH><TH>Jenis</TH>
                        <TH>Jadwal</TH><TH>Alamat</TH><TH>Unit</TH>
                        <TH>Driver</TH><TH>Kendaraan</TH><TH>Status</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {loading && <TableSkeletonRows rows={6} cols={10} />}
                      {!loading && jobs?.map((j) => (
                        <TR key={j.id} clickable onClick={() => setOpenJobId(j.id)}>
                          <TD className="font-semibold text-ink">{j.id.slice(0, 8)}</TD>
                          <TD className="text-ink2">{orderNumberOf(j) || "—"}</TD>
                          <TD truncate>{customerOf(j) || "—"}</TD>
                          <TD className="text-ink2">{JOB_TYPE_REAL[j.type]?.label || j.type}</TD>
                          <TD className="whitespace-nowrap">
                            {j.scheduledDate
                              ? new Date(j.scheduledDate).toLocaleDateString("id-ID", { day: "numeric", month: "short" })
                              : <span className="text-orange">Belum</span>}
                          </TD>
                          <TD truncate className="max-w-[180px] text-ink2">{j.addressText || "—"}</TD>
                          <TD numeric>{unitCountOf(j)}</TD>
                          <TD truncate className={cn(!j.driver && "text-orange")}>
                            {j.driver?.name || "Belum ada"}
                          </TD>
                          <TD className="whitespace-nowrap text-ink2">{j.vehicle?.plateNumber || "—"}</TD>
                          <TD><StatusBadge map={JOB_STATUS_REAL} value={j.status} /></TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>

                {/* Mobile: kartu */}
                <ul className="divide-y divide-line md:hidden">
                  {!loading && jobs?.map((j) => (
                    <li key={j.id}>
                      <button
                        type="button"
                        onClick={() => setOpenJobId(j.id)}
                        className="w-full px-4 py-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[12.5px] font-semibold text-ink">{j.id.slice(0, 8)}</span>
                          <span className="text-[11px] text-ink3">{JOB_TYPE_REAL[j.type]?.label}</span>
                          <span className="ml-auto"><StatusBadge map={JOB_STATUS_REAL} value={j.status} /></span>
                        </div>
                        <div className="mt-1 truncate text-[13px] text-ink">{customerOf(j) || "—"}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink2">
                          <span>{j.scheduledDate ? new Date(j.scheduledDate).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) : "Belum dijadwalkan"}</span>
                          <span aria-hidden>·</span>
                          <span className={cn(!j.driver && "font-semibold text-orange")}>{j.driver?.name || "Belum ada driver"}</span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
      </PageBody>

      <JobDetailDrawer jobId={openJobId} onClose={() => setOpenJobId(null)} />
    </PageContainer>
  );
}
