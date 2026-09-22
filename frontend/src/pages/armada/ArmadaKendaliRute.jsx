import React, { useEffect, useMemo, useState } from "react";
import {
  Truck, AlertTriangle, RefreshCw, Route as RouteIcon, User, MapPin, ShieldCheck, WifiOff,
} from "lucide-react";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { FilterDropdown } from "@/components/ui/filter-dropdown.jsx";
import { TableSkeletonRows } from "@/components/ui/table.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import { makeRange, toApiParams, formatRangeText } from "@/lib/dateRange.js";
import { formatJam, formatRelatif } from "@/utils/formatDate.js";
import Avatar from "@/components/Avatar.jsx";
import StatusBadge from "@/features/armada/components/StatusBadge.jsx";
import RouteControlDrawer from "@/features/armada/components/RouteControlDrawer.jsx";
import { ROUTE_STATUS_REAL, effectiveRouteStatus } from "@/features/armada/vehicleStatus.js";
import { useControlTower } from "@/features/armada/hooks/useControlTower.js";
import {
  summarizeRoutes, rankRouteExceptions, filterRoutes, distinctCities, distinctDrivers, distinctVehicles,
  deriveRouteProgress, deriveRouteExceptions, deriveRouteCity,
} from "@/features/armada/controlTowerRules.js";
import { cn } from "@/lib/utils.js";

const RINGKASAN_TILES = [
  { key: "DRAFT", label: "Draft", tone: "neutral" },
  { key: "PUBLISHED", label: "Diterbitkan", tone: "accent" },
  { key: "IN_PROGRESS", label: "Berjalan", tone: "accent" },
  { key: "COMPLETED", label: "Selesai", tone: "green" },
  { key: "BERMASALAH", label: "Bermasalah", tone: "red" },
];

// Delivery Control Tower — "Menara Kendali Rute" (22 September 2026,
// permintaan dispatcher: satu layar operasional HARI INI di level RUTE,
// beda dari ArmadaDashboard.jsx yang fokus antrean PENJADWALAN job).
// SATU sumber data: GET /armada/routes lewat useControlTower.js — lihat
// catatan panjang di sana dan di controlTowerRules.js. Halaman ini MURNI
// baca — tindakan sungguhan (assign driver, publish, dst) tetap lewat
// Route Planner, tombol "Buka di Route Planner" di drawer cuma navigasi.
export default function ArmadaKendaliRute() {
  const [range, setRange] = useState(() => makeRange("today"));
  const [status, setStatus] = useState("");
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [city, setCity] = useState("");
  const [onlyProblem, setOnlyProblem] = useState(false);
  const [openRouteId, setOpenRouteId] = useState(null);
  const [now, setNow] = useState(() => new Date());

  const { data: routes, isLoading, isError, error, isFetching, refetch, dataUpdatedAt } = useControlTower(range, toApiParams);

  // Timer lokal hanya memperbarui usia data dan aturan berbasis waktu.
  // Tidak ada request jaringan periodik di sini.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const ringkasan = useMemo(() => summarizeRoutes(routes || [], { now }), [routes, now]);
  const prioritas = useMemo(() => rankRouteExceptions(routes || [], { now }).slice(0, 8), [routes, now]);
  const opsiDriver = useMemo(() => distinctDrivers(routes || []), [routes]);
  const opsiKendaraan = useMemo(() => distinctVehicles(routes || []), [routes]);
  const opsiKota = useMemo(() => distinctCities(routes || []), [routes]);
  const rutesTampil = useMemo(
    () => filterRoutes(routes || [], { status, driverId, vehicleId, city, onlyProblem }, { now }),
    [routes, status, driverId, vehicleId, city, onlyProblem, now]
  );
  const openRoute = useMemo(() => (routes || []).find((r) => r.id === openRouteId) || null, [routes, openRouteId]);

  const adaFilterAktif = status || driverId || vehicleId || city || onlyProblem;
  const driverPulse = useMemo(() => {
    const map = new Map();
    for (const route of routes || []) {
      if (route.driver) map.set(route.driver.id, route.driver);
    }
    const people = [...map.values()];
    return { online: people.filter((p) => p.isOnline).length, offline: people.filter((p) => !p.isOnline).length };
  }, [routes]);
  const staleMinutes = dataUpdatedAt ? Math.floor((now.getTime() - dataUpdatedAt) / 60_000) : 0;
  const isStaleData = staleMinutes >= 5 && !isFetching;

  return (
    <PageContainer>
      <PageHeader
        title="Menara Kendali Rute"
        subtitle={
          isLoading
            ? "Memuat kondisi rute…"
            : `${routes?.length ?? 0} rute pada ${formatRangeText(range)}` +
              (ringkasan.BERMASALAH ? ` — ${ringkasan.BERMASALAH} butuh perhatian` : " — semua rute sehat") + "."
        }
        actionsBelow
        actions={
          <>
            <DateRangePicker value={range} onChange={setRange} />
            <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw size={14} className={cn(isFetching && "animate-spin")} /> Perbarui
            </Button>
          </>
        }
      >
        {/* Stale-data indicator (22 September 2026, permintaan eksplisit
            "stale-data state") — data TERAKHIR berhasil diambil, supaya
            dispatcher yang membiarkan tab ini terbuka lama tahu kapan
            terakhir refresh, bukan diam-diam menganggap selalu real-time
            (halaman ini SENGAJA tidak polling agresif, lihat useControlTower.js). */}
        {dataUpdatedAt && !isLoading && (
          <p className="mt-1 text-[11px] text-ink3">
            Data diambil pukul {formatJam(dataUpdatedAt)} WIB
            {isFetching && " · memperbarui…"}
          </p>
        )}

      </PageHeader>

      <PageBody>
        {/* Ringkasan status — 5 kartu, klik untuk filter cepat */}
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-[86px] animate-pulse rounded-card bg-inset" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {RINGKASAN_TILES.map((t) => {
              const aktif = t.key === "BERMASALAH" ? onlyProblem : status === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    if (t.key === "BERMASALAH") { setOnlyProblem((v) => !v); return; }
                    setStatus((s) => (s === t.key ? "" : t.key));
                  }}
                  className={cn(
                    "rounded-card border p-3.5 text-left transition-colors",
                    aktif ? "border-accent bg-accentbg" : "border-border bg-surface hover:bg-hovertint"
                  )}
                >
                  <p className={cn("text-[24px] font-bold tabular-nums", t.tone === "red" && ringkasan[t.key] > 0 ? "text-red" : "text-ink")}>
                    {ringkasan[t.key] ?? 0}
                  </p>
                  <p className="mt-0.5 text-[12px] font-semibold text-ink2">{t.label}</p>
                </button>
              );
            })}
          </div>
        )}

        {!isLoading && !isError && (
          <Card className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3.5 py-2.5 text-[11.5px] text-ink2">
            <span><strong className="text-green">{driverPulse.online}</strong> driver online</span>
            <span><strong className="text-ink">{driverPulse.offline}</strong> offline</span>
            <span><strong className="text-accent">{ringkasan.IN_PROGRESS}</strong> rute aktif</span>
            <span className="sm:ml-auto">Terakhir mengambil data: <strong className="text-ink">{formatRelatif(dataUpdatedAt)}</strong></span>
          </Card>
        )}

        {isStaleData && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-btn bg-orangebg px-3 py-2 text-[12px] font-semibold text-orange">
            <span>Data belum diperbarui selama {staleMinutes} menit. Kondisi lapangan mungkin sudah berubah.</span>
            <button type="button" onClick={() => refetch()} className="underline">Perbarui sekarang</button>
          </div>
        )}

        {/* Filter bar */}
        <Card className="flex flex-wrap items-center gap-2 p-3">
          <FilterDropdown
            value={status} onChange={setStatus}
            options={Object.entries(ROUTE_STATUS_REAL).filter(([k]) => k !== "CANCELLED").map(([k, v]) => ({ value: k, label: v.label }))}
            placeholder="Semua Status" icon={RouteIcon} ariaLabel="Filter status rute"
          />
          <FilterDropdown
            value={driverId} onChange={setDriverId}
            options={opsiDriver.map((d) => ({ value: d.id, label: d.name }))}
            placeholder="Semua Driver" icon={User} ariaLabel="Filter driver"
          />
          <FilterDropdown
            value={vehicleId} onChange={setVehicleId}
            options={opsiKendaraan.map((v) => ({ value: v.id, label: v.plateNumber }))}
            placeholder="Semua Kendaraan" icon={Truck} ariaLabel="Filter kendaraan"
          />
          <FilterDropdown
            value={city} onChange={setCity}
            options={opsiKota.map((k) => ({ value: k, label: k }))}
            placeholder="Semua Kota" icon={MapPin} ariaLabel="Filter kota"
          />
          {adaFilterAktif && (
            <button
              type="button"
              onClick={() => { setStatus(""); setDriverId(""); setVehicleId(""); setCity(""); setOnlyProblem(false); }}
              className="ml-1 text-[11.5px] font-semibold text-accent hover:underline"
            >
              Bersihkan filter
            </button>
          )}
        </Card>

        {/* Error state — refetch gagal TIDAK menghapus data lama (react-query
            bawaan mempertahankan `data` terakhir), jadi ini HANYA tampil
            kalau gagal di percobaan PERTAMA (belum pernah ada data sama
            sekali) — sama pola dengan driver-mobile JobListScreen.js. */}
        {isError && !routes ? (
          <Card className="p-6">
            <EmptyState
              icon={WifiOff}
              title="Gagal memuat data rute"
              description={error?.message || "Coba lagi dalam beberapa saat."}
              action={<Button size="sm" onClick={() => refetch()}>Coba Lagi</Button>}
            />
          </Card>
        ) : (
          <>
            {isError && routes && (
              <div className="flex items-center justify-between gap-2 rounded-btn bg-orangebg px-3 py-2 text-[12px] font-semibold text-orange">
                <span>Gagal memperbarui data — menampilkan data terakhir yang berhasil dimuat.</span>
                <button type="button" onClick={() => refetch()} className="underline">Coba lagi</button>
              </div>
            )}

            {/* Prioritas exception — dampak operasional tertinggi duluan */}
            <Card className="p-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-ink">
                <AlertTriangle size={14} className="text-red" /> Prioritas Perlu Tindakan
              </h3>
              {isLoading ? <TableSkeletonRows rows={3} cols={1} /> : prioritas.length === 0 ? (
                <div className="flex items-center gap-2 rounded-btn bg-greenbg/40 px-3 py-2.5 text-[12.5px] font-semibold text-green">
                  <ShieldCheck size={15} /> Semua rute sehat — tidak ada yang butuh tindakan segera.
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {prioritas.map((p, i) => (
                    <li key={`${p.route.id}-${p.type}-${i}`}>
                      <button
                        type="button"
                        onClick={() => setOpenRouteId(p.route.id)}
                        className="flex w-full items-start gap-2.5 border-b border-line pb-2.5 text-left last:border-0 last:pb-0 hover:bg-hovertint"
                      >
                        <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", p.severity === "critical" ? "bg-red" : "bg-orange")} />
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                            <span className={cn("text-[9.5px] font-bold uppercase tracking-wide", p.severity === "critical" ? "text-red" : "text-orange")}>
                              {p.severity === "critical" ? "Kritis" : "Perhatian"}
                            </span>
                            · {p.route.code} · {p.label}
                          </p>
                          {p.detail && <p className={cn("text-[11px]", p.severity === "critical" ? "text-red" : "text-ink3")}>{p.detail}</p>}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Daftar rute */}
            {isLoading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[168px] animate-pulse rounded-card bg-inset" />)}
              </div>
            ) : rutesTampil.length === 0 ? (
              <Card className="p-6">
                <EmptyState
                  icon={RouteIcon}
                  title={adaFilterAktif ? "Tidak ada rute yang cocok filter ini" : "Belum ada rute pada rentang ini"}
                  description={adaFilterAktif ? "Coba ubah atau bersihkan filter di atas." : "Buat rute baru lewat Route Planner."}
                />
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {rutesTampil.map((r) => (
                  <RouteCardTile key={r.id} route={r} now={now} onOpen={() => setOpenRouteId(r.id)} />
                ))}
              </div>
            )}
          </>
        )}
      </PageBody>

      <RouteControlDrawer route={openRoute} onClose={() => setOpenRouteId(null)} />
    </PageContainer>
  );
}

function RouteCardTile({ route, now, onOpen }) {
  const progress = deriveRouteProgress(route);
  const exceptions = deriveRouteExceptions(route, { now });
  const kota = deriveRouteCity(route);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-2.5 rounded-card border border-border bg-surface p-3.5 text-left transition-colors hover:border-accent/50 hover:bg-hovertint"
    >
      <div className="flex items-center gap-1.5">
        <span className="truncate text-[13px] font-bold text-ink">{route.code}</span>
        <StatusBadge map={ROUTE_STATUS_REAL} value={effectiveRouteStatus(route)} className="ml-auto shrink-0" />
      </div>

      <div className="flex items-center gap-2">
        {route.driver ? (
          <Avatar name={route.driver.name} size="sm" gradient />
        ) : (
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-orangebg text-orange"><User size={12} /></div>
        )}
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink2">
          {route.driver?.name || "Belum ada driver"}{route.helper?.name ? ` + ${route.helper.name}` : ""}
        </span>
        {route.driver && <span className={cn("shrink-0 text-[10px] font-semibold", route.driver.isOnline ? "text-green" : "text-ink3")}>{route.driver.isOnline ? "Online" : "Offline"}</span>}
      </div>

      {route.driver && (
        <p className="-mt-1 truncate pl-8 text-[10.5px] text-ink3">
          Ambil data: {route.driver.lastAppSyncAt ? formatRelatif(route.driver.lastAppSyncAt) : "belum pernah"}
        </p>
      )}

      <div className="flex items-center gap-1.5 text-[11.5px] text-ink3">
        <Truck size={12} /> {route.vehicle?.plateNumber || "Belum ada kendaraan"}{kota ? ` · ${kota}` : ""}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] text-ink3">
          <span>{progress.done}/{progress.total} stop</span>
          {progress.lastUpdatedAt && <span>{formatJam(progress.lastUpdatedAt)} WIB</span>}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-inset">
          <div className="h-full rounded-full bg-accent" style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : "0%" }} />
        </div>
      </div>

      {exceptions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {exceptions.slice(0, 2).map((e) => (
            <span key={e.type} className={cn(
              "rounded-chip px-1.5 py-0.5 text-[9.5px] font-semibold",
              e.severity === "critical" ? "bg-redbg text-red" : "bg-orangebg text-orange"
            )}>
              {e.label}
            </span>
          ))}
          {exceptions.length > 2 && <span className="text-[9.5px] text-ink3">+{exceptions.length - 2}</span>}
        </div>
      )}
    </button>
  );
}
