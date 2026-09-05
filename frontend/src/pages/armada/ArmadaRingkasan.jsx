import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, Clock, CalendarClock, Truck as TruckIcon, CheckCircle2, Wrench,
} from "lucide-react";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableSkeletonRows } from "@/components/ui/table.jsx";
import Avatar from "@/components/Avatar.jsx";
import { api } from "@/api.js";
import { cn } from "@/lib/utils.js";
import { hariIniWIB, hariSejak, toWIB } from "@/utils/formatDate.js";
import { customerOf, orderNumberOf, isJobOverdue, overdueDays } from "@/features/armada/jobStatus.js";
import { VEHICLE_STATUS_REAL } from "@/features/armada/vehicleStatus.js";

// Ringkasan Operasional — "Delivery Command" scoped ke workspace armada saja
// (redesain Sep 2026, docs/ARMADA-REDESIGN-2026.md §6). BUKAN pengganti
// Dashboard (yang tetap fokus jadwal/penugasan harian) dan BUKAN Command
// lintas-divisi PRD §1.4 (itu "Kendali", /kendali, workspace terpisah yang
// jauh lebih besar cakupannya — sengaja tidak disentuh di sini).
//
// SELURUH angka di halaman ini DITURUNKAN dari endpoint yang SUDAH ADA —
// tidak ada endpoint backend baru. Kalau salah satu tile terasa "kurang
// akurat", akar masalahnya ada di endpoint sumbernya (dan sudah didoku-
// mentasikan gotcha-nya di sana), bukan di agregasi halaman ini.

const AMBANG_BACKLOG_HARI = 7; // sama dengan ambang "Perlu Dijadwalkan" Dashboard (D-050)

// Label singkat jenis insiden — salinan kecil dari INCIDENT_TYPES
// (ArmadaPengaturan.jsx), yang tidak diekspor. Cuma 5 entri, dipakai untuk
// tampilan feed di sini saja — tidak sepadan menaikkan jadi shared module
// untuk daftar selabel ini.
const JENIS_INSIDEN = { KECELAKAAN: "Kecelakaan", LECET: "Lecet", MOGOK: "Mogok", TILANG: "Tilang", LAINNYA: "Lainnya" };

function Tile({ icon: Icon, tone, label, value, hint }) {
  const TONE = {
    red:    "bg-redbg text-red",
    orange: "bg-orangebg text-orange",
    accent: "bg-accentbg text-accent",
    green:  "bg-greenbg text-green",
    neutral:"bg-inset text-ink3",
  }[tone] || "bg-inset text-ink3";
  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-border bg-surface p-3.5">
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", TONE)}>
        <Icon size={16} strokeWidth={2} aria-hidden />
      </span>
      <div>
        <strong className="dh-figure block text-[26px] font-extrabold leading-none tracking-tight text-ink">{value}</strong>
        <span className="mt-1 block text-[11px] font-semibold leading-snug text-ink2">{label}</span>
        {hint && <span className="mt-0.5 block text-[10.5px] text-ink3">{hint}</span>}
      </div>
    </div>
  );
}

export default function ArmadaRingkasan() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const today = hariIniWIB();
        const [jobsAllRes, unscheduledRes, jobsTodayRes, completedRes, issuesRes, incidents, reportSummary, drivers] = await Promise.all([
          // Take 300, urut scheduledDate desc (default backend) — cukup untuk
          // volume produksi saat ini, lihat catatan limitasi di isJobOverdue
          // section di bawah kalau volume job aktif jauh melebihi ini.
          api.getArmadaJobs({ take: 300 }),
          api.getArmadaJobs({ status: "UNSCHEDULED", take: 200 }),
          api.getArmadaJobs({ date: today, take: 200 }),
          api.getArmadaJobs({ status: "COMPLETED", take: 300 }),
          api.getIssues("OPEN"),
          api.getVehicleIncidents({}),
          api.getDeliveryReportSummary({}),
          api.getDrivers(),
        ]);
        if (cancelled) return;
        setData({
          jobsAll: jobsAllRes.jobs || [],
          unscheduled: unscheduledRes.jobs || [],
          jobsToday: jobsTodayRes.jobs || [],
          completed: completedRes.jobs || [],
          openIssues: issuesRes.jobs || [],
          incidents: incidents || [],
          reportSummary: reportSummary || null,
          drivers: drivers || [],
        });
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const overdueJobs = useMemo(() => {
    if (!data) return [];
    return data.jobsAll.filter(isJobOverdue).sort((a, b) => overdueDays(b) - overdueDays(a));
  }, [data]);

  const backlogTua = useMemo(() => {
    if (!data) return [];
    return data.unscheduled.filter((j) => hariSejak(j.createdAt) >= AMBANG_BACKLOG_HARI);
  }, [data]);

  // Ketepatan waktu 30 hari terakhir — HANYA level HARI (scheduledDate vs
  // completedAt dibandingkan sebagai tanggal kalender WIB, bukan jam), sama
  // disiplin dengan isJobOverdue: timeWindow teks bebas tidak bisa dijadikan
  // patokan presisi jam. Job tanpa scheduledDate (backlog lama) dikeluarkan
  // dari pembagi — job yang tidak pernah dijanjikan ke tanggal tertentu tidak
  // bisa dinilai "tepat waktu" atau tidak.
  const ketepatan = useMemo(() => {
    if (!data) return null;
    const relevan = data.completed.filter((j) => j.scheduledDate && j.completedAt);
    if (relevan.length === 0) return null;
    const tepat = relevan.filter((j) => toWIB(j.completedAt).startOf("day").valueOf() <= toWIB(j.scheduledDate).startOf("day").valueOf()).length;
    return { tepat, total: relevan.length, persen: Math.round((tepat / relevan.length) * 100) };
  }, [data]);

  const bebanDriver = useMemo(() => {
    if (!data) return [];
    const byDriver = new Map();
    for (const j of data.jobsToday) {
      if (!j.driverId) continue;
      const key = j.driverId;
      const nama = j.driver?.name || data.drivers.find((d) => d.id === key)?.name || "Driver";
      if (!byDriver.has(key)) byDriver.set(key, { driverId: key, nama, jobs: [] });
      byDriver.get(key).jobs.push(j);
    }
    return [...byDriver.values()].sort((a, b) => b.jobs.length - a.jobs.length);
  }, [data]);

  const tanpaDriverHariIni = useMemo(() => (data ? data.jobsToday.filter((j) => !j.driverId).length : 0), [data]);

  const fleetCounts = useMemo(() => {
    const rows = data?.reportSummary?.byVehicleStatus || [];
    const out = {};
    for (const r of rows) out[r.status] = r.count;
    return out;
  }, [data]);

  const perluPerhatian = useMemo(() => {
    if (!data) return [];
    const dariOverdue = overdueJobs.slice(0, 5).map((j) => ({
      key: `overdue-${j.id}`,
      tone: "red",
      title: `${customerOf(j) || "Tanpa nama"} · ${orderNumberOf(j) || "—"}`,
      detail: `Terlambat ${overdueDays(j)} hari dari jadwal`,
      onClick: () => navigate(`/armada/jobs?job=${j.id}`),
    }));
    const dariIssues = data.openIssues.slice(0, 5).map((j) => ({
      key: `issue-${j.id}`,
      tone: "red",
      title: `${customerOf(j) || "Tanpa nama"} · ${orderNumberOf(j) || "—"}`,
      detail: j.failureReason ? `Gagal: ${j.failureReason}` : "Job gagal, belum dijadwalkan ulang",
      onClick: () => navigate("/armada/issues"),
    }));
    const dariInsiden = data.incidents.slice(0, 3).map((inc) => ({
      key: `incident-${inc.id}`,
      tone: "orange",
      title: `${inc.vehicle?.plateNumber || "Kendaraan"} · ${JENIS_INSIDEN[inc.type] || inc.type}`,
      detail: `${inc.severity === "BERAT" ? "Berat" : inc.severity === "SEDANG" ? "Sedang" : "Ringan"} · ${new Date(inc.date).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}`,
      onClick: () => navigate("/armada/pengaturan?tab=armada"),
    }));
    return [...dariOverdue, ...dariIssues, ...dariInsiden];
  }, [data, overdueJobs, navigate]);

  return (
    <PageContainer>
      <PageHeader
        title="Ringkasan Operasional"
        subtitle="Semua yang butuh perhatian dispatcher sekarang — job terlambat, beban driver, status armada, dan ketepatan waktu."
      />
      <PageBody>
        {error && (
          <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">Gagal memuat ringkasan: {error}</div>
        )}

        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[110px] animate-pulse rounded-card bg-inset" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile icon={Clock} tone={overdueJobs.length > 0 ? "red" : "green"} label="Job Terlambat" value={overdueJobs.length} hint="lewat tanggal terjadwal" />
            <Tile icon={CalendarClock} tone={backlogTua.length > 0 ? "orange" : "green"} label="Backlog Lama" value={backlogTua.length} hint={`belum dijadwalkan ≥${AMBANG_BACKLOG_HARI} hari`} />
            <Tile icon={AlertTriangle} tone={data?.openIssues.length > 0 ? "red" : "green"} label="Kendala Terbuka" value={data?.openIssues.length || 0} hint="job gagal, belum reschedule" />
            <Tile
              icon={CheckCircle2}
              tone={ketepatan == null ? "neutral" : ketepatan.persen >= 90 ? "green" : ketepatan.persen >= 75 ? "orange" : "red"}
              label="Ketepatan Waktu"
              value={ketepatan == null ? "—" : `${ketepatan.persen}%`}
              hint={ketepatan == null ? "belum ada job selesai" : `${ketepatan.tepat} dari ${ketepatan.total} job selesai`}
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)]">
          <Card className="overflow-hidden">
            <div className="border-b border-line px-4 py-3">
              <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-ink"><AlertTriangle size={14} className="text-red" /> Perlu Perhatian Sekarang</h3>
            </div>
            {loading ? (
              <div className="p-4"><TableSkeletonRows rows={4} cols={1} /></div>
            ) : perluPerhatian.length === 0 ? (
              <div className="p-6"><EmptyState icon={CheckCircle2} title="Tidak ada yang butuh perhatian saat ini" description="Semua job berjalan sesuai jadwal, tidak ada kendala terbuka." /></div>
            ) : (
              <ul className="divide-y divide-line">
                {perluPerhatian.map((item) => (
                  <li key={item.key}>
                    <button
                      type="button"
                      onClick={item.onClick}
                      className="flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-hovertint"
                    >
                      <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", item.tone === "red" ? "bg-red" : "bg-orange")} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-semibold text-ink">{item.title}</p>
                        <p className={cn("text-[11px]", item.tone === "red" ? "text-red" : "text-orange")}>{item.detail}</p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="flex flex-col gap-4">
            <Card className="overflow-hidden">
              <div className="border-b border-line px-4 py-3">
                <h3 className="text-[13px] font-bold text-ink">Beban Kerja Driver — Hari Ini</h3>
              </div>
              {loading ? (
                <div className="p-4"><TableSkeletonRows rows={3} cols={1} /></div>
              ) : bebanDriver.length === 0 && tanpaDriverHariIni === 0 ? (
                <p className="p-4 text-[12px] text-ink3">Belum ada job terjadwal hari ini.</p>
              ) : (
                <div className="divide-y divide-line">
                  {bebanDriver.map((d) => (
                    <div key={d.driverId} className="flex items-center gap-2.5 px-4 py-2.5">
                      <Avatar name={d.nama} size="sm" gradient />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{d.nama}</span>
                      <span className="shrink-0 rounded-chip bg-inset px-2 py-0.5 text-[11px] font-bold text-ink2">{d.jobs.length} job</span>
                    </div>
                  ))}
                  {tanpaDriverHariIni > 0 && (
                    <button
                      type="button"
                      onClick={() => navigate("/armada/jobs?driverId=none")}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-hovertint"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orangebg text-orange"><TruckIcon size={13} /></span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-orange">Belum ada driver</span>
                      <span className="shrink-0 rounded-chip bg-orangebg px-2 py-0.5 text-[11px] font-bold text-orange">{tanpaDriverHariIni} job</span>
                    </button>
                  )}
                </div>
              )}
            </Card>

            <Card className="p-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-ink"><Wrench size={14} /> Status Armada</h3>
              {loading ? <TableSkeletonRows rows={2} cols={4} /> : (
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(VEHICLE_STATUS_REAL).map(([key, def]) => (
                    <div key={key} className="rounded-2xl bg-inset/60 p-3 text-center">
                      <p className="text-[20px] font-bold text-ink">{fleetCounts[key] || 0}</p>
                      <p className="text-[11px] text-ink3">{def.label}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </PageBody>
    </PageContainer>
  );
}