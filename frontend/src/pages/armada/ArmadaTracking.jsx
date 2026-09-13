import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, Marker, Polyline, InfoWindow, OverlayView, useJsApiLoader } from "@react-google-maps/api";
import { Truck, MapPinned, Navigation, ChevronDown, ChevronUp, CheckCircle2, XCircle, Home, WifiOff } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { cn } from "@/lib/utils.js";
import { useTheme } from "@/lib/ThemeProvider.jsx";
import { getRoadRoute } from "@/services/osrm.js";
import { GOOGLE_MAPS_JS_KEY, GOOGLE_MAPS_LIBRARIES, GOOGLE_MAPS_SCRIPT_ID } from "@/lib/googleMaps.js";
import { MAP_STYLE_DARK } from "@/features/armada/googleMapStyle.js";
import { driverIcon, destinationIcon, stopIcon, stopIconDone, stopIconFailed, depotIcon } from "@/features/armada/googleMapIcons.js";
import JobDetailDrawer from "@/features/armada/components/JobDetailDrawer.jsx";
import { JOB_TYPE_REAL } from "@/features/armada/jobStatus.js";
import { useArmadaTracking } from "@/features/armada/hooks/useArmadaTracking.js";

// Live Tracking — D-036 (30 Agustus 2026), DATA NYATA.
//
// D-165 (14 September 2026, owner: "mekanisme nya seperti delivery shopee,
// grab, gojek") — per rute, SELURUH urutan stop digambar: tuntas (centang
// hijau / silang merah), tujuan sekarang (pin merah + ETA), berikutnya
// (bernomor). Jalur 2 warna: sudah dilalui (abu) vs akan dilalui (accent).
//
// D-166 (14 September 2026, owner: "rute ini sudah diterbitkan, tapi kenapa
// di live tracking 0 rute aktif? ... ketika gps belum aktif atau driver
// belum menyalakan tombol online pakai aja icon driver yang masih di klinik
// matras") — rute TERBIT hari ini ikut tampil walau belum ada yang mulai.
// Backend kirim `phase` + `position` (GPS asli, atau Klinik Matras dengan
// source "depot"), lihat komentar panjang di backend armada.js GET /tracking.
// Stop dikelompokkan dari STATUS (tuntas/aktif/menunggu), BUKAN dari urutan
// sequence — driver di lapangan tidak selalu ikut urutan rencana.
const JAKARTA_CENTER = { lat: -6.2088, lng: 106.8456 };
const STATUS_TUNTAS = new Set(["COMPLETED", "FAILED", "RESCHEDULED"]);

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

// Label status yang dibaca admin — 1 kalimat, sama semangat dengan kartu
// status di app Grab/Gojek ("Driver sedang menuju lokasi", dst).
function labelFase(v) {
  if (v.phase === "EN_ROUTE") return "Sedang Menuju";
  if (v.phase === "ARRIVED") return "Tiba Di Lokasi";
  if (v.phase === "DONE") return "Rute Selesai";
  return v.done.length > 0 ? "Berikutnya" : "Belum Berangkat";
}

// Badge waktu tempuh mengambang di atas pin tujuan — OverlayView (bukan
// Marker.label) supaya bisa dipasangi class CSS `.dh-route-eta-badge`.
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

// Satu entri backend ("route" / "loose") -> SATU bentuk render. Stop
// dipecah jadi done / active / pending berdasar status.
function turunkanKendaraan(item) {
  const stops = item.kind === "loose"
    ? [{
        jobId: item.jobId, sequence: 1, status: item.status, type: item.type,
        addressText: item.addressText, lat: item.destinationLat, lng: item.destinationLng,
        orderNumber: item.orderNumber, customerName: item.customerName,
      }]
    : item.stops;
  const activeJobId = item.kind === "loose" ? item.jobId : item.activeJobId;
  const active = stops.find((s) => s.jobId === activeJobId) || null;
  const done = stops
    .filter((s) => STATUS_TUNTAS.has(s.status))
    .sort((a, b) => new Date(a.completedAt || 0) - new Date(b.completedAt || 0) || (a.sequence ?? 0) - (b.sequence ?? 0));
  const pending = stops.filter((s) => s !== active && !STATUS_TUNTAS.has(s.status));
  return {
    vehicleId: item.kind === "loose" ? `loose-${item.jobId}` : `route-${item.routeId}`,
    routeCode: item.kind === "loose" ? null : item.routeCode,
    driverName: item.driverName,
    helperName: item.kind === "loose" ? null : item.helperName,
    driverOnline: !!item.driverOnline,
    phase: item.kind === "loose" ? item.status : item.phase,
    lastPosition: item.lastPosition,
    position: item.position,
    depot: item.depot,
    stops, active, done, pending,
  };
}

const punyaKoordinat = (s) => s.lat != null && s.lng != null;

export default function ArmadaTracking() {
  const { resolved } = useTheme();
  // Warna disalin manual dari tokens.css — SVG data-URI & opsi Polyline
  // dievaluasi di luar DOM halaman, tidak bisa baca var(--accent).
  const warnaAkanDilalui = resolved === "dark" ? "#0A84FF" : "#1457D9";
  const warnaSudahDilalui = resolved === "dark" ? "#48505C" : "#B9C2CE";
  const warnaMenunggu = resolved === "dark" ? "#5B6472" : "#9AA5B4";
  const { isLoaded } = useJsApiLoader({
    id: GOOGLE_MAPS_SCRIPT_ID,
    googleMapsApiKey: GOOGLE_MAPS_JS_KEY,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });
  const { data: items, error: queryError, refetch: load } = useArmadaTracking();
  const error = queryError?.message || "";
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  const [openJobId, setOpenJobId] = useState(null);
  const [activeInfo, setActiveInfo] = useState(null); // "driver-<vehicleId>" | "stop-<jobId>" | "depot"
  const [expandedVehicleId, setExpandedVehicleId] = useState(null);
  const mapRef = useRef(null);

  const kendaraan = useMemo(() => (items || []).map(turunkanKendaraan).filter((v) => v.position), [items]);
  const depot = kendaraan[0]?.depot || null;

  // Driver yang "di Klinik Matras" (belum ada GPS) digeser sedikit melingkar
  // dari titik depot — SELALU, walau cuma 1 driver, supaya avatar driver
  // tidak menutupi ikon Klinik Matras (terlihat di tes visual 14 Sep 2026),
  // dan kalau lebih dari 1 driver, tiap avatar tetap bisa diklik. Posisi GPS
  // asli TIDAK pernah digeser.
  const posisiDigambar = useMemo(() => {
    const m = new Map();
    const diDepot = kendaraan.filter((v) => v.position.source === "depot");
    diDepot.forEach((v, i) => {
      const sudut = Math.PI / 4 + (2 * Math.PI * i) / Math.max(diDepot.length, 1);
      const r = 0.0035;
      m.set(v.vehicleId, { lat: v.position.lat + r * Math.sin(sudut), lng: v.position.lng + r * Math.cos(sudut) });
    });
    for (const v of kendaraan) {
      if (v.position.source !== "depot") m.set(v.vehicleId, { lat: v.position.lat, lng: v.position.lng });
    }
    return m;
  }, [kendaraan]);

  // Hasil OSRM per kendaraan — { [vehicleId]: { traveled, upcoming } }.
  const [jalurByVehicle, setJalurByVehicle] = useState({});
  const titikStr = (p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  const sinyalJalur = kendaraan
    .map((v) => [
      v.vehicleId, titikStr(v.position),
      ...v.done.filter(punyaKoordinat).map(titikStr),
      v.active && punyaKoordinat(v.active) ? titikStr(v.active) : "-",
      ...v.pending.filter(punyaKoordinat).map(titikStr),
    ].join(":"))
    .join("|");

  useEffect(() => {
    let batal = false;
    for (const v of kendaraan) {
      const posisi = [v.position.lat, v.position.lng];
      // Jalur "sudah dilalui" cuma masuk akal kalau posisi GPS asli — kalau
      // driver masih "di Klinik Matras" (belum ada GPS), tidak ada yang bisa
      // diklaim sudah dilalui.
      const traveledPts = v.position.source === "gps"
        ? [...v.done.filter(punyaKoordinat).map((s) => [s.lat, s.lng]), posisi]
        : [];
      const upcomingPts = [
        posisi,
        ...(v.active && punyaKoordinat(v.active) ? [[v.active.lat, v.active.lng]] : []),
        ...v.pending.filter(punyaKoordinat).map((s) => [s.lat, s.lng]),
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

  // Auto-fit ke SEMUA titik (depot + semua stop + driver) — BUKAN `center`
  // yang ikut berubah tiap render (itu penyebab glitch "peta melompat",
  // lihat riwayat git). Fit ulang hanya kalau KUMPULAN stop/rute berubah,
  // BUKAN tiap GPS driver bergeser — supaya peta tidak merebut kontrol dari
  // admin yang sedang geser/zoom manual.
  const sinyalFit = kendaraan
    .map((v) => [v.vehicleId, v.position.source, ...v.stops.filter(punyaKoordinat).map(titikStr)].join(":"))
    .join("|");
  const fitKeSemua = useCallback(() => {
    const map = mapRef.current;
    if (!map || !window.google || kendaraan.length === 0) return;
    const bounds = new window.google.maps.LatLngBounds();
    for (const v of kendaraan) {
      bounds.extend(posisiDigambar.get(v.vehicleId));
      for (const s of v.stops) if (punyaKoordinat(s)) bounds.extend({ lat: s.lat, lng: s.lng });
    }
    if (depot) bounds.extend({ lat: depot.lat, lng: depot.lng });
    // Padding atas lebih besar: pil "N Rute Hari Ini" melayang di kiri-atas
    // peta dan menutupi stop di pojok itu (terlihat di tes visual).
    map.fitBounds(bounds, { top: 96, left: 48, right: 48, bottom: 48 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinyalFit]);
  useEffect(() => { fitKeSemua(); }, [fitKeSemua]);

  const jumlahJalan = kendaraan.filter((v) => v.phase === "EN_ROUTE" || v.phase === "ARRIVED").length;

  return (
    <PageContainer>
      <PageHeader
        title="Live Tracking"
        subtitle="Rute yang terbit hari ini, urut per stop — posisi dari GPS aplikasi driver."
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
                  {jumlahJalan > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green" />
                    </span>
                  )}
                </span>
                <div className="leading-tight">
                  <p className="text-[13px] font-bold text-ink">{kendaraan.length} Rute Hari Ini</p>
                  <p className="text-[10px] text-ink3">{jumlahJalan} sedang jalan · update tiap 15 detik</p>
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
                center={JAKARTA_CENTER}
                zoom={11}
                onLoad={(map) => { mapRef.current = map; fitKeSemua(); }}
                onUnmount={() => { mapRef.current = null; }}
                options={{
                  styles: resolved === "dark" ? MAP_STYLE_DARK : undefined,
                  disableDefaultUI: true,
                  zoomControl: true,
                  clickableIcons: false,
                }}
              >
                {depot && (
                  <>
                    <Marker position={{ lat: depot.lat, lng: depot.lng }} icon={depotIcon(window.google)} zIndex={1} onClick={() => setActiveInfo("depot")} />
                    {activeInfo === "depot" && (
                      <InfoWindow position={{ lat: depot.lat, lng: depot.lng }} onCloseClick={() => setActiveInfo(null)}>
                        <div className="text-xs"><p className="font-semibold">{depot.label}</p><p>Titik berangkat semua rute</p></div>
                      </InfoWindow>
                    )}
                  </>
                )}

                {kendaraan.map((v) => {
                  const jalur = jalurByVehicle[v.vehicleId];
                  const posisi = posisiDigambar.get(v.vehicleId);
                  const keObj = ([lat, lng]) => ({ lat, lng });

                  const traveledLurus = v.position.source === "gps"
                    ? [...v.done.filter(punyaKoordinat).map((s) => ({ lat: s.lat, lng: s.lng })), posisi]
                    : [];
                  const traveledPath = jalur?.traveled?.coords ? jalur.traveled.coords.map(keObj) : traveledLurus;

                  const upcomingLurus = [
                    posisi,
                    ...(v.active && punyaKoordinat(v.active) ? [{ lat: v.active.lat, lng: v.active.lng }] : []),
                    ...v.pending.filter(punyaKoordinat).map((s) => ({ lat: s.lat, lng: s.lng })),
                  ];
                  const upcomingPath = jalur?.upcoming?.coords ? jalur.upcoming.coords.map(keObj) : upcomingLurus;

                  // ETA cuma saat benar-benar sedang menuju (EN_ROUTE + GPS asli)
                  // — dari Klinik Matras sebelum berangkat, angka itu bukan
                  // "kapan tiba", jangan disajikan seolah perkiraan tiba.
                  const etaDetik = v.phase === "EN_ROUTE" && v.position.source === "gps" && v.active && punyaKoordinat(v.active)
                    ? jalur?.upcoming?.legDurations?.[0]
                    : null;
                  const jalan = v.phase === "EN_ROUTE" || v.phase === "ARRIVED";

                  return (
                    <React.Fragment key={v.vehicleId}>
                      {traveledLurus.length >= 2 && (
                        <Polyline path={traveledPath} options={{ strokeColor: warnaSudahDilalui, strokeWeight: 4, strokeOpacity: 0.7 }} />
                      )}
                      {upcomingLurus.length >= 2 && (
                        <Polyline
                          path={upcomingPath}
                          options={jalan
                            ? { strokeColor: warnaAkanDilalui, strokeWeight: 4, strokeOpacity: 0.85 }
                            // Belum berangkat = RENCANA, bukan perjalanan — garis
                            // putus-putus supaya tidak dikira driver sudah jalan.
                            : { strokeOpacity: 0, icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.8, strokeColor: warnaAkanDilalui, scale: 3 }, offset: "0", repeat: "14px" }] }}
                        />
                      )}

                      {[...v.done, ...v.pending, ...(v.active ? [v.active] : [])].filter(punyaKoordinat).map((s) => {
                        const isActive = s === v.active;
                        const tuntas = STATUS_TUNTAS.has(s.status);
                        const icon = isActive
                          ? destinationIcon(window.google, resolved)
                          : tuntas
                            ? (s.status === "COMPLETED" ? stopIconDone(window.google) : stopIconFailed(window.google))
                            : stopIcon(window.google, warnaMenunggu, s.sequence);
                        const ket = isActive
                          ? labelFase(v)
                          : s.status === "COMPLETED" ? "Selesai" : s.status === "FAILED" ? "Gagal" : s.status === "RESCHEDULED" ? "Dijadwal ulang" : "Belum dimulai";
                        return (
                          <React.Fragment key={s.jobId}>
                            <Marker position={{ lat: s.lat, lng: s.lng }} icon={icon} zIndex={isActive ? 3 : 2} onClick={() => setActiveInfo(`stop-${s.jobId}`)} />
                            {activeInfo === `stop-${s.jobId}` && (
                              <InfoWindow position={{ lat: s.lat, lng: s.lng }} onCloseClick={() => setActiveInfo(null)}>
                                <div className="text-xs">
                                  <p className="font-semibold">Stop {s.sequence} — {s.customerName}</p>
                                  <p>{ket} · {labelTipe(s.type)}</p>
                                  {s.addressText && <p className="max-w-[220px]">{s.addressText}</p>}
                                  <button type="button" className="mt-1 font-semibold text-blue-600 underline" onClick={() => setOpenJobId(s.jobId)}>Buka detail job</button>
                                </div>
                              </InfoWindow>
                            )}
                          </React.Fragment>
                        );
                      })}

                      {etaDetik != null && <EtaBadge position={{ lat: v.active.lat, lng: v.active.lng }}>{formatMenit(etaDetik)}</EtaBadge>}

                      <Marker
                        position={posisi}
                        icon={driverIcon(window.google, v.driverName)}
                        zIndex={4}
                        onClick={() => { setSelectedVehicleId(v.vehicleId); setActiveInfo(`driver-${v.vehicleId}`); }}
                      />
                      {activeInfo === `driver-${v.vehicleId}` && (
                        <InfoWindow position={posisi} onCloseClick={() => setActiveInfo(null)}>
                          <div className="text-xs">
                            <p className="font-semibold">{v.driverName || "Belum ada driver"}{v.helperName ? ` + ${v.helperName}` : ""}</p>
                            <p>{v.routeCode || "Kurir Eksternal"} · {labelFase(v)}{v.active ? ` stop ${v.active.sequence}` : ""}</p>
                            <p>{v.position.source === "gps" ? `GPS ${waktuLalu(v.lastPosition?.recordedAt)}` : "GPS belum aktif — ditampilkan di Klinik Matras"}</p>
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

        {/* Daftar rute — 1 kartu per rute: status sekarang, progress, tujuan
            aktif menonjol, expand untuk seluruh urutan stop. */}
        <div className="flex h-[560px] flex-col gap-2 overflow-y-auto pr-0.5">
          <p className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink3">
            <Truck size={12} aria-hidden /> {kendaraan.length} Rute Hari Ini
          </p>
          {items == null ? (
            <Card className="p-4 text-center text-[11.5px] text-ink3">Memuat…</Card>
          ) : kendaraan.length === 0 ? (
            <Card className="flex flex-col items-center gap-2 py-8 text-center">
              <MapPinned className="h-8 w-8 text-ink3" strokeWidth={1.5} aria-hidden />
              <p className="px-4 text-[12px] text-ink3">Belum ada rute yang diterbitkan untuk hari ini.</p>
            </Card>
          ) : (
            kendaraan.map((v) => {
              const total = v.stops.length;
              const selesai = v.done.length;
              const expanded = expandedVehicleId === v.vehicleId;
              const diDepot = v.position.source === "depot";
              return (
                <div
                  key={v.vehicleId}
                  className={cn("rounded-card bg-surface p-3 shadow-card transition-colors", selectedVehicleId === v.vehicleId && "bg-accentbg")}
                >
                  <button type="button" className="w-full text-left" onClick={() => setSelectedVehicleId(v.vehicleId)}>
                    <div className="flex items-start gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accentbg">
                        <Truck size={14} className="text-accent" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-bold text-ink">
                            {v.driverName || "Belum ada driver"}{v.helperName ? ` + ${v.helperName}` : ""}
                          </span>
                          <span className={cn("ml-auto h-2 w-2 shrink-0 rounded-full", v.driverOnline ? "bg-green" : "bg-ink3")} title={v.driverOnline ? "Driver online" : "Driver offline"} />
                        </div>
                        <p className="mt-0.5 text-[10.5px] text-ink3">
                          {v.routeCode || "Kurir Eksternal"} · {selesai}/{total} stop tuntas
                        </p>
                      </div>
                    </div>

                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-inset">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${total ? Math.round((selesai / total) * 100) : 0}%` }} />
                    </div>

                    <div className="mt-2.5 rounded-btn bg-accentbg p-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-accent">{labelFase(v)}</p>
                      {v.active ? (
                        <>
                          <p className="mt-0.5 truncate text-[12.5px] font-bold text-ink">Stop {v.active.sequence} · {v.active.customerName}</p>
                          <p className="text-[10.5px] text-ink2">{v.active.orderNumber || "—"} · {labelTipe(v.active.type)}</p>
                          {v.active.addressText && (
                            <p className="mt-1 flex items-start gap-1 text-[10.5px] text-ink3">
                              <Navigation size={10} className="mt-[1.5px] shrink-0" aria-hidden />
                              <span className="line-clamp-2">{v.active.addressText}</span>
                            </p>
                          )}
                          {!punyaKoordinat(v.active) && (
                            <p className="mt-1 text-[10px] text-orange">Alamat ini belum punya titik peta — tidak digambar di peta.</p>
                          )}
                        </>
                      ) : (
                        <p className="mt-0.5 text-[12px] text-ink2">Semua stop di rute ini sudah tuntas.</p>
                      )}
                    </div>

                    <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-ink3">
                      {diDepot ? (
                        <>
                          <WifiOff size={11} aria-hidden />
                          GPS belum aktif · ditampilkan di <Home size={11} className="inline" aria-hidden /> Klinik Matras
                        </>
                      ) : (
                        <>
                          <Navigation size={11} aria-hidden />
                          GPS {waktuLalu(v.lastPosition?.recordedAt)}
                          {v.lastPosition?.accuracy ? ` · ±${Math.round(v.lastPosition.accuracy)}m` : ""}
                        </>
                      )}
                    </p>
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
                        const isActive = s === v.active;
                        return (
                          <button
                            key={s.jobId}
                            type="button"
                            onClick={() => setOpenJobId(s.jobId)}
                            className={cn("flex items-center gap-2 rounded-btn px-2 py-1.5 text-left hover:bg-hovertint", isActive && "bg-accentbg")}
                          >
                            {s.status === "COMPLETED" ? (
                              <CheckCircle2 size={14} className="shrink-0 text-green" aria-hidden />
                            ) : s.status === "FAILED" || s.status === "RESCHEDULED" ? (
                              <XCircle size={14} className="shrink-0 text-red" aria-hidden />
                            ) : (
                              <span className={cn(
                                "flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full text-[8.5px] font-bold",
                                isActive ? "bg-accent text-white" : "bg-inset text-ink3"
                              )}>{s.sequence}</span>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className={cn("truncate text-[11.5px] font-semibold", isActive ? "text-accent" : "text-ink")}>{s.customerName}</p>
                              <p className="truncate text-[10px] text-ink3">
                                {s.orderNumber || "—"} · {labelTipe(s.type)}{!punyaKoordinat(s) ? " · tanpa titik peta" : ""}
                              </p>
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
