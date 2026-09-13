import React, { useEffect, useMemo, useState } from "react";
import { GoogleMap, Marker, Polyline, InfoWindow, OverlayView, useJsApiLoader } from "@react-google-maps/api";
import { Truck, MapPinned, Navigation, ChevronDown, ChevronUp, CheckCircle2, XCircle } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { cn } from "@/lib/utils.js";
import { useTheme } from "@/lib/ThemeProvider.jsx";
import { getRoadRoute } from "@/services/osrm.js";
import { GOOGLE_MAPS_JS_KEY, GOOGLE_MAPS_LIBRARIES, GOOGLE_MAPS_SCRIPT_ID } from "@/lib/googleMaps.js";
import { MAP_STYLE_DARK } from "@/features/armada/googleMapStyle.js";
import { driverIcon, destinationIcon, stopIcon, stopIconDone, stopIconFailed } from "@/features/armada/googleMapIcons.js";
import JobDetailDrawer from "@/features/armada/components/JobDetailDrawer.jsx";
import { JOB_TYPE_REAL } from "@/features/armada/jobStatus.js";
import { useArmadaTracking } from "@/features/armada/hooks/useArmadaTracking.js";

// Live Tracking — D-036 (30 Agustus 2026), DATA NYATA. Redesain kartu
// melayang 13 September 2026 (lihat riwayat git untuk detail itu).
//
// REDESAIN BESAR 14 September 2026 (D-165, permintaan owner: "coba lo
// explore bagusnya seperti apa... mekanisme nya seperti delivery shopee,
// grab, gojek") — SEBELUM ini halaman cuma gambar 1 job EN_ROUTE lepas
// (posisi driver -> 1 tujuan). SEKARANG untuk job yang bagian dari Route,
// SELURUH urutan stop hari itu digambar sekaligus: stop yang SUDAH LEWAT
// (hijau/merah tergantung selesai/gagal), stop yang SEDANG DITUJU (pin
// merah + badge ETA, sama seperti sebelumnya), dan stop yang BELUM
// dimulai (bernomor, redup) — persis pola app pengantaran pada umumnya.
// Jalur dipecah 2 warna: "sudah dilalui" (abu-abu, dari stop terakhir yang
// selesai sampai posisi GPS sekarang) dan "akan dilalui" (accent, dari
// posisi sekarang lewat tujuan aktif sampai stop terakhir).
//
// GET /armada/tracking sekarang mengembalikan array per-KENDARAAN (bukan
// per-job lepas) — lihat komentar panjang di backend armada.js untuk
// bentuk responsnya. turunkanKendaraan() di bawah menyeragamkan 2 bentuk
// ("route" ber-banyak-stop, "loose" 1 titik seperti Kurir Eksternal) jadi
// satu struktur render yang sama, supaya sisa komponen tidak bercabang
// if/else kind di mana-mana.
const JAKARTA_CENTER = { lat: -6.2088, lng: 106.8456 };

function waktuLalu(iso) {
  if (!iso) return null;
  const menit = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (menit < 1) return "baru saja";
  if (menit < 60) return `${menit} menit lalu`;
  return `${Math.floor(menit / 60)} jam lalu`;
}

function formatMenit(detik) {
  const menit = Math.round(detik / 60);
  if (menit < 1) return "<1 mnt lagi";
  if (menit < 60) return `${menit} mnt lagi`;
  const jam = Math.floor(menit / 60);
  const sisaMenit = menit % 60;
  return sisaMenit > 0 ? `${jam} j ${sisaMenit} mnt lagi` : `${jam} jam lagi`;
}

function labelTipe(tipe) {
  return JOB_TYPE_REAL[tipe]?.label || tipe;
}

// Badge waktu tempuh mengambang di atas pin tujuan — OverlayView (bukan
// Marker.label) supaya bisa dipasangi class CSS `.dh-route-eta-badge` yang
// sudah ada, sama tampilan dengan versi Leaflet Tooltip lama.
function EtaBadge({ position, children }) {
  return (
    <OverlayView
      position={position}
      mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
      getPixelPositionOffset={(w, h) => ({ x: -w / 2, y: -h - 26 })}
    >
      <div className="dh-route-eta-badge">{children}</div>
    </OverlayView>
  );
}

// Satu entri backend (kind "route" ATAU "loose") -> struktur render SAMA.
// "loose" dipetakan jadi rute ber-1-stop supaya kode di bawah cukup tahu
// SATU bentuk data, tidak perlu tahu asalnya.
function turunkanKendaraan(item) {
  if (item.kind === "loose") {
    return {
      vehicleId: `loose-${item.jobId}`,
      routeCode: null,
      driverName: item.driverName, helperName: null,
      lastPosition: item.lastPosition,
      activeJobId: item.jobId,
      stops: [{
        jobId: item.jobId, sequence: 1, status: item.status || "EN_ROUTE", type: item.type,
        addressText: item.addressText, lat: item.destinationLat, lng: item.destinationLng,
        orderNumber: item.orderNumber, customerName: item.customerName,
      }],
    };
  }
  return {
    vehicleId: `route-${item.routeId}`,
    routeCode: item.routeCode,
    driverName: item.driverName, helperName: item.helperName,
    lastPosition: item.lastPosition,
    activeJobId: item.activeJobId,
    stops: item.stops,
  };
}

export default function ArmadaTracking() {
  const { resolved } = useTheme();
  // Rute & pin tujuan ikut token accent/red Sano per tema (13 Sep 2026) —
  // SVG data-URI (googleMapIcons.js) dan opsi Polyline dievaluasi di luar
  // DOM halaman, jadi tidak bisa baca var(--accent)/var(--red) langsung;
  // nilainya disalin manual dari tokens.css di sini, BUKAN ditebak.
  const warnaAkanDilalui = resolved === "dark" ? "#0A84FF" : "#1457D9";
  const warnaSudahDilalui = resolved === "dark" ? "#48505C" : "#B9C2CE";
  const { isLoaded } = useJsApiLoader({
    id: GOOGLE_MAPS_SCRIPT_ID,
    googleMapsApiKey: GOOGLE_MAPS_JS_KEY,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });
  const { data: items, error: queryError, refetch: load } = useArmadaTracking();
  const error = queryError?.message || "";
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  const [openJobId, setOpenJobId] = useState(null);
  const [activeInfo, setActiveInfo] = useState(null); // "driver-<vehicleId>" | "stop-<jobId>"
  const [expandedVehicleId, setExpandedVehicleId] = useState(null);

  const kendaraan = useMemo(() => (items || []).map(turunkanKendaraan), [items]);

  // Pecah tiap kendaraan jadi before/active/after berdasar `sequence` —
  // ini yang membedakan stop yang SUDAH LEWAT dari yang BELUM, terlepas
  // dari nilai status persisnya (COMPLETED/FAILED keduanya "sudah lewat").
  const kendaraanTerurai = useMemo(() => kendaraan
    .map((k) => {
      const activeStop = k.stops.find((s) => s.jobId === k.activeJobId);
      if (!activeStop || !k.lastPosition) return null;
      const before = k.stops.filter((s) => s.sequence < activeStop.sequence);
      const after = k.stops.filter((s) => s.sequence > activeStop.sequence);
      return { ...k, activeStop, before, after };
    })
    .filter(Boolean), [kendaraan]);

  // Hasil OSRM per kendaraan — { [vehicleId]: { traveled, upcoming } },
  // masing-masing { coords, legDurations } | undefined (belum selesai
  // ATAU gagal, dua-duanya fallback ke garis lurus di render).
  const [jalurByVehicle, setJalurByVehicle] = useState({});

  const sinyalJalur = kendaraanTerurai
    .map((v) => {
      const titik = (s) => (s.lat != null ? `${s.lat.toFixed(5)},${s.lng.toFixed(5)}` : "-");
      return [
        v.vehicleId,
        `${v.lastPosition.lat.toFixed(5)},${v.lastPosition.lng.toFixed(5)}`,
        ...v.before.map(titik), titik(v.activeStop), ...v.after.map(titik),
      ].join(":");
    })
    .join("|");

  useEffect(() => {
    let batal = false;
    for (const v of kendaraanTerurai) {
      const posisiSekarang = [v.lastPosition.lat, v.lastPosition.lng];
      const traveledPts = [
        ...v.before.filter((s) => s.lat != null).map((s) => [s.lat, s.lng]),
        posisiSekarang,
      ];
      const upcomingPts = [
        posisiSekarang,
        ...(v.activeStop.lat != null ? [[v.activeStop.lat, v.activeStop.lng]] : []),
        ...v.after.filter((s) => s.lat != null).map((s) => [s.lat, s.lng]),
      ];
      if (traveledPts.length >= 2) {
        getRoadRoute(traveledPts).then((hasil) => {
          if (!batal && hasil) setJalurByVehicle((prev) => ({ ...prev, [v.vehicleId]: { ...prev[v.vehicleId], traveled: hasil } }));
        });
      }
      if (upcomingPts.length >= 2) {
        getRoadRoute(upcomingPts).then((hasil) => {
          if (!batal && hasil) setJalurByVehicle((prev) => ({ ...prev, [v.vehicleId]: { ...prev[v.vehicleId], upcoming: hasil } }));
        });
      }
    }
    return () => { batal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinyalJalur]);

  // BUG NYATA (14 Sep 2026, laporan owner: "buka live tracking di web jadi
  // glitch") — `center` di-passing SEBAGAI OBJEK BARU tiap render kalau
  // dibuat langsung di sini. @react-google-maps/api WAJIB memanggil ulang
  // `map.setCenter(center)` tiap kali PROP `center` berbeda REFERENSI (lihat
  // useEffect dep [map, center] di source library) — bukan cuma saat nilai
  // lat/lng-nya benar-benar berubah. Redesain D-165 menambah BANYAK elemen
  // interaktif baru (klik tiap stop, tombol expand) + 2x panggilan OSRM per
  // kendaraan (traveled+upcoming) yang tiap resolve men-trigger re-render —
  // tiap re-render itu MEMAKSA peta snap-recenter ke posisi driver, kelihatan
  // sebagai peta "glitch"/melompat-lompat saat halaman dipakai. Sekarang
  // `center` HANYA berganti referensi kalau lat/lng-nya (angka, dibandingkan
  // by value) benar-benar beda — klik marker/expand/poll data yang tidak
  // mengubah posisi TIDAK lagi memicu setCenter ulang.
  const centerLat = kendaraanTerurai.length > 0 ? kendaraanTerurai[0].lastPosition.lat : JAKARTA_CENTER.lat;
  const centerLng = kendaraanTerurai.length > 0 ? kendaraanTerurai[0].lastPosition.lng : JAKARTA_CENTER.lng;
  const center = useMemo(() => ({ lat: centerLat, lng: centerLng }), [centerLat, centerLng]);

  return (
    <PageContainer>
      <PageHeader
        title="Live Tracking"
        subtitle="Rute aktif hari ini, urut per stop — data GPS asli dari aplikasi driver."
      />

      {error && (
        <div className="mb-3 rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">
          Gagal memuat posisi driver: {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden p-0">
          <div className="relative h-[560px] w-full">
            {items != null && (
              <div className="absolute left-3 top-3 z-10 flex items-center gap-2.5 rounded-full bg-surface/95 py-2 pl-2.5 pr-3.5 shadow-popover backdrop-blur-sm">
                <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accentbg">
                  <Truck size={14} className="text-accent" aria-hidden />
                  {kendaraanTerurai.length > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green" />
                    </span>
                  )}
                </span>
                <div className="leading-tight">
                  <p className="text-[13px] font-bold text-ink">{kendaraanTerurai.length} Rute Aktif</p>
                  <p className="text-[10px] text-ink3">Live · update tiap 15 detik</p>
                </div>
              </div>
            )}

            {!GOOGLE_MAPS_JS_KEY ? (
              <div className="flex h-full flex-col items-center justify-center gap-1.5 px-4 text-center">
                <MapPinned size={28} className="text-ink3" strokeWidth={1.5} aria-hidden />
                <p className="text-[12px] font-semibold text-ink2">Peta belum aktif</p>
                <p className="max-w-[260px] text-[10.5px] text-ink3">
                  VITE_GOOGLE_MAPS_JS_KEY belum diisi — lihat docs deploy untuk cara mengaktifkannya.
                </p>
              </div>
            ) : !isLoaded ? (
              <div className="flex h-full items-center justify-center text-[11.5px] text-ink3">Memuat peta…</div>
            ) : (
              <GoogleMap
                mapContainerStyle={{ height: "100%", width: "100%" }}
                center={center}
                zoom={12}
                options={{
                  styles: resolved === "dark" ? MAP_STYLE_DARK : undefined,
                  disableDefaultUI: true,
                  zoomControl: true,
                  clickableIcons: false,
                }}
              >
                {kendaraanTerurai.map((v) => {
                  const jalur = jalurByVehicle[v.vehicleId];
                  const posisiSekarang = { lat: v.lastPosition.lat, lng: v.lastPosition.lng };

                  const traveledLurus = [
                    ...v.before.filter((s) => s.lat != null).map((s) => ({ lat: s.lat, lng: s.lng })),
                    posisiSekarang,
                  ];
                  const traveledPath = jalur?.traveled?.coords
                    ? jalur.traveled.coords.map(([lat, lng]) => ({ lat, lng }))
                    : traveledLurus;

                  const upcomingLurus = [
                    posisiSekarang,
                    ...(v.activeStop.lat != null ? [{ lat: v.activeStop.lat, lng: v.activeStop.lng }] : []),
                    ...v.after.filter((s) => s.lat != null).map((s) => ({ lat: s.lat, lng: s.lng })),
                  ];
                  const upcomingPath = jalur?.upcoming?.coords
                    ? jalur.upcoming.coords.map(([lat, lng]) => ({ lat, lng }))
                    : upcomingLurus;

                  const etaAktifDetik = v.activeStop.lat != null ? jalur?.upcoming?.legDurations?.[0] : null;

                  return (
                    <React.Fragment key={v.vehicleId}>
                      {traveledLurus.length >= 2 && (
                        <Polyline path={traveledPath} options={{ strokeColor: warnaSudahDilalui, strokeWeight: 4, strokeOpacity: 0.7, geodesic: false }} />
                      )}
                      {upcomingLurus.length >= 2 && (
                        <Polyline path={upcomingPath} options={{ strokeColor: warnaAkanDilalui, strokeWeight: 4, strokeOpacity: 0.85, geodesic: false }} />
                      )}

                      {/* Stop yang sudah lewat — hijau (selesai) / merah (gagal) */}
                      {v.before.filter((s) => s.lat != null).map((s) => (
                        <React.Fragment key={`before-${s.jobId}`}>
                          <Marker
                            position={{ lat: s.lat, lng: s.lng }}
                            icon={s.status === "FAILED" ? stopIconFailed(window.google) : stopIconDone(window.google)}
                            onClick={() => setActiveInfo(`stop-${s.jobId}`)}
                          />
                          {activeInfo === `stop-${s.jobId}` && (
                            <InfoWindow position={{ lat: s.lat, lng: s.lng }} onCloseClick={() => setActiveInfo(null)}>
                              <div className="text-xs">
                                <p className="font-semibold">Stop {s.sequence} — {s.customerName}</p>
                                <p>{s.status === "FAILED" ? "Gagal" : "Selesai"} · {labelTipe(s.type)}</p>
                                <button type="button" className="mt-1 font-semibold text-blue-600 underline" onClick={() => setOpenJobId(s.jobId)}>Buka detail job</button>
                              </div>
                            </InfoWindow>
                          )}
                        </React.Fragment>
                      ))}

                      {/* Stop yang belum dimulai — bernomor, redup */}
                      {v.after.filter((s) => s.lat != null).map((s) => (
                        <React.Fragment key={`after-${s.jobId}`}>
                          <Marker
                            position={{ lat: s.lat, lng: s.lng }}
                            icon={stopIcon(window.google, resolved === "dark" ? "#5B6472" : "#9AA5B4", s.sequence)}
                            onClick={() => setActiveInfo(`stop-${s.jobId}`)}
                          />
                          {activeInfo === `stop-${s.jobId}` && (
                            <InfoWindow position={{ lat: s.lat, lng: s.lng }} onCloseClick={() => setActiveInfo(null)}>
                              <div className="text-xs">
                                <p className="font-semibold">Stop {s.sequence} — {s.customerName}</p>
                                <p>Belum dimulai · {labelTipe(s.type)}</p>
                                <button type="button" className="mt-1 font-semibold text-blue-600 underline" onClick={() => setOpenJobId(s.jobId)}>Buka detail job</button>
                              </div>
                            </InfoWindow>
                          )}
                        </React.Fragment>
                      ))}

                      {/* Stop AKTIF — pin merah + badge ETA, sama bahasa visual dgn sebelumnya */}
                      {v.activeStop.lat != null && (
                        <>
                          <Marker
                            position={{ lat: v.activeStop.lat, lng: v.activeStop.lng }}
                            icon={destinationIcon(window.google, resolved)}
                            onClick={() => setActiveInfo(`stop-${v.activeStop.jobId}`)}
                          />
                          {etaAktifDetik != null && <EtaBadge position={{ lat: v.activeStop.lat, lng: v.activeStop.lng }}>{formatMenit(etaAktifDetik)}</EtaBadge>}
                          {activeInfo === `stop-${v.activeStop.jobId}` && (
                            <InfoWindow position={{ lat: v.activeStop.lat, lng: v.activeStop.lng }} onCloseClick={() => setActiveInfo(null)}>
                              <div className="text-xs">
                                <p className="font-semibold">Tujuan — {v.activeStop.customerName}</p>
                                <p>{v.activeStop.addressText}</p>
                              </div>
                            </InfoWindow>
                          )}
                        </>
                      )}

                      {/* Posisi driver */}
                      <Marker
                        position={posisiSekarang}
                        icon={driverIcon(window.google, v.driverName)}
                        onClick={() => { setSelectedVehicleId(v.vehicleId); setActiveInfo(`driver-${v.vehicleId}`); }}
                      />
                      {activeInfo === `driver-${v.vehicleId}` && (
                        <InfoWindow position={posisiSekarang} onCloseClick={() => setActiveInfo(null)}>
                          <div className="text-xs">
                            <p className="font-semibold">{v.driverName}{v.helperName ? ` + ${v.helperName}` : ""}</p>
                            <p>{v.routeCode || "Kurir Eksternal"} · Stop {v.activeStop.sequence} dari {v.stops.length}</p>
                            <button type="button" className="mt-1 font-semibold text-blue-600 underline" onClick={() => setOpenJobId(v.activeStop.jobId)}>Buka detail job</button>
                          </div>
                        </InfoWindow>
                      )}
                    </React.Fragment>
                  );
                })}
              </GoogleMap>
            )}
          </div>
        </Card>

        {/* Daftar kendaraan — 1 kartu per RUTE (bukan lagi per job, 14 Sep
            2026, D-165), progress "stop X dari Y" + tujuan aktif menonjol +
            expand utk lihat seluruh urutan stop. Tinggi disamakan dengan
            peta (h-[560px]). */}
        <div className="flex h-[560px] flex-col gap-2 overflow-y-auto pr-0.5">
          <p className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink3">
            <Truck size={12} aria-hidden /> {kendaraanTerurai.length} Rute Dalam Perjalanan
          </p>
          {items == null ? (
            <Card className="p-4 text-center text-[11.5px] text-ink3">Memuat…</Card>
          ) : kendaraanTerurai.length === 0 ? (
            <Card className="flex flex-col items-center gap-2 py-8 text-center">
              <MapPinned className="h-8 w-8 text-ink3" strokeWidth={1.5} aria-hidden />
              <p className="text-[12px] text-ink3">Belum ada rute dalam perjalanan sekarang.</p>
            </Card>
          ) : (
            kendaraanTerurai.map((v) => {
              const total = v.stops.length;
              const selesai = v.before.filter((s) => s.status === "COMPLETED").length;
              const expanded = expandedVehicleId === v.vehicleId;
              const sedangTiba = v.activeStop.status === "ARRIVED";
              return (
                <div
                  key={v.vehicleId}
                  className={cn("rounded-card bg-surface p-3 shadow-card transition-colors", selectedVehicleId === v.vehicleId && "bg-accentbg")}
                >
                  <button type="button" className="w-full text-left" onClick={() => setSelectedVehicleId(v.vehicleId)}>
                    <div className="flex items-start gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50">
                        <Truck size={14} className="text-blue-ink" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-bold text-ink">
                            {v.driverName}{v.helperName ? ` + ${v.helperName}` : ""}
                          </span>
                          <span className="ml-auto shrink-0 text-[10px] text-ink3">{waktuLalu(v.lastPosition?.recordedAt)}</span>
                        </div>
                        <p className="mt-0.5 text-[10.5px] text-ink3">
                          {v.routeCode || "Kurir Eksternal"} · Stop {v.activeStop.sequence}/{total}
                        </p>
                      </div>
                    </div>

                    {/* Progress bar mini — sama pola dgn Rute Hari Ini di driver-mobile */}
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-inset">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${total ? Math.round((selesai / total) * 100) : 0}%` }} />
                    </div>

                    {/* Tujuan aktif — blok menonjol, sama semangat referensi
                        owner (bottom sheet Grab/Gojek: nama customer, jarak/
                        ETA, aksi). */}
                    <div className="mt-2.5 rounded-btn bg-accentbg p-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-accent">
                        {sedangTiba ? "Tiba Di Lokasi" : "Sedang Menuju"}
                      </p>
                      <p className="mt-0.5 truncate text-[12.5px] font-bold text-ink">{v.activeStop.customerName}</p>
                      <p className="text-[10.5px] text-ink2">
                        {v.activeStop.orderNumber || "—"} · {labelTipe(v.activeStop.type)}
                      </p>
                      {v.activeStop.addressText && (
                        <p className="mt-1 flex items-start gap-1 text-[10.5px] text-ink3">
                          <Navigation size={10} className="mt-[1.5px] shrink-0" aria-hidden />
                          <span className="truncate">{v.activeStop.addressText}</span>
                        </p>
                      )}
                    </div>
                  </button>

                  {total > 1 && (
                    <button
                      type="button"
                      className="mt-2 flex w-full items-center justify-center gap-1 rounded-btn py-1.5 text-[10.5px] font-semibold text-ink3 hover:bg-hovertint"
                      onClick={() => setExpandedVehicleId(expanded ? null : v.vehicleId)}
                    >
                      {expanded ? "Sembunyikan urutan stop" : `Lihat semua ${total} stop`}
                      {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                  )}

                  {expanded && (
                    <div className="mt-1.5 flex flex-col gap-1.5 border-t border-line pt-2">
                      {v.stops.map((s) => {
                        const isActive = s.jobId === v.activeJobId;
                        const sudahLewat = s.sequence < v.activeStop.sequence;
                        return (
                          <button
                            key={s.jobId}
                            type="button"
                            onClick={() => setOpenJobId(s.jobId)}
                            className={cn("flex items-center gap-2 rounded-btn px-2 py-1.5 text-left hover:bg-hovertint", isActive && "bg-accentbg")}
                          >
                            {sudahLewat ? (
                              s.status === "FAILED"
                                ? <XCircle size={14} className="shrink-0 text-red" aria-hidden />
                                : <CheckCircle2 size={14} className="shrink-0 text-green" aria-hidden />
                            ) : (
                              <span className={cn(
                                "flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full text-[8.5px] font-bold",
                                isActive ? "bg-accent text-white" : "bg-inset text-ink3"
                              )}>{s.sequence}</span>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className={cn("truncate text-[11.5px] font-semibold", isActive ? "text-accent" : "text-ink")}>{s.customerName}</p>
                              <p className="truncate text-[10px] text-ink3">{s.orderNumber || "—"} · {labelTipe(s.type)}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <JobDetailDrawer jobId={openJobId} onClose={() => setOpenJobId(null)} onChanged={load} />
    </PageContainer>
  );
}
