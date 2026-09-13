import React, { useEffect, useMemo, useState } from "react";
import { GoogleMap, Marker, Polyline, InfoWindow, OverlayView, useJsApiLoader } from "@react-google-maps/api";
import { Truck, MapPinned, Navigation } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { cn } from "@/lib/utils.js";
import { useTheme } from "@/lib/ThemeProvider.jsx";
import { getRoadRoute } from "@/services/osrm.js";
import { GOOGLE_MAPS_JS_KEY, GOOGLE_MAPS_LIBRARIES, GOOGLE_MAPS_SCRIPT_ID } from "@/lib/googleMaps.js";
import { MAP_STYLE_DARK } from "@/features/armada/googleMapStyle.js";
import { driverIcon, destinationIcon } from "@/features/armada/googleMapIcons.js";
import JobDetailDrawer from "@/features/armada/components/JobDetailDrawer.jsx";
import { JOB_TYPE_REAL } from "@/features/armada/jobStatus.js";
import { useArmadaTracking } from "@/features/armada/hooks/useArmadaTracking.js";

// Live Tracking — D-036 (30 Agustus 2026), DATA NYATA.
//
// SEBELUM INI halaman ini 100% simulasi (trackingMock.js, badge "Contoh") —
// TAPI backend-nya sudah nyata sejak D-034 (GPS ping dari HP driver via
// useDriverTracking.js) dan sudah diperbaiki bug 500-nya (23 Agustus 2026,
// mismatch tipe uuid/text di raw query GET /armada/tracking). Yang palsu
// SELALU cuma halaman ini, bukan datanya — sekarang disambungkan.
//
// Peta pakai Google Maps JavaScript API (DIMIGRASI 8 September 2026 dari
// Leaflet + tile CARTO — CARTO tiba-tiba mewajibkan API key akhir Agustus
// 2026, watermark "API KEY REQUIRED" muncul di production, DAN billing
// Google Cloud sudah aktif hari yang sama — lihat catatan panjang di
// lib/googleMaps.js). Pin driver SELALU akurat (koordinat GPS asli dari HP,
// bukan hasil geocode).
//
// Pin TUJUAN (alamat customer) ikut ditampilkan kalau job-nya sudah punya
// koordinat (destinationLat/Lng dari GET /armada/tracking). Kalau job BELUM
// punya koordinat sama sekali, tidak ada pin dipaksakan — alamat tetap
// tampil sebagai teks di panel kanan, supaya tidak berpura-pura akurat
// padahal datanya tidak ada.
//
// Garis driver->tujuan minta geometri jalan asli ke OSRM (services/osrm.js)
// — fallback senyap ke garis lurus kalau OSRM gagal/timeout (server demo
// publik, bukan SLA production). Badge "±N menit lagi" di pin tujuan dari
// durasi OSRM. TIDAK diganti Google Directions API saat migrasi tile —
// lihat alasan yang sama di RouteMap.jsx (API berbayar ketiga belum tentu
// perlu).
//
// REDESIGN 13 September 2026 (permintaan owner: referensi UI app navigasi/
// tracking — kartu ringkasan MELAYANG di atas peta, peta sebagai elemen
// utama yang besar) — "make sure warnanya sesuai style Klinik Matras Sano",
// JADI bukan replikasi warna referensi (hijau/oranye), cuma pola layoutnya:
// peta lebih tinggi & jadi fokus, pil "N Driver Aktif" melayang di pojok
// kiri-atas peta (shadow-popover, rounded-full — token DS v2 yang sama
// dipakai popover lain), daftar driver di kanan jadi kartu individual
// (shadow-card, TANPA border — aturan "kartu tanpa border" tokens.css)
// menggantikan list hairline polos. Warna rute & pin tujuan sekarang persis
// token Sano (--accent/--red per tema) — sebelumnya #4C8DFF/#dc2626 generik
// yang bukan bagian dari palet manapun di tokens.css.
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

export default function ArmadaTracking() {
  const { resolved } = useTheme();
  // Rute & pin tujuan ikut token accent/red Sano per tema (13 Sep 2026) —
  // SVG data-URI (googleMapIcons.js) dan opsi Polyline dievaluasi di luar
  // DOM halaman, jadi tidak bisa baca var(--accent)/var(--red) langsung;
  // nilainya disalin manual dari tokens.css di sini, BUKAN ditebak.
  const warnaJalur = resolved === "dark" ? "#0A84FF" : "#1457D9";
  const { isLoaded } = useJsApiLoader({
    id: GOOGLE_MAPS_SCRIPT_ID,
    googleMapsApiKey: GOOGLE_MAPS_JS_KEY,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });
  // Data + polling 15 detik sekarang lewat TanStack Query (8 September
  // 2026, lihat useArmadaTracking.js) — MENGGANTIKAN state+setInterval
  // manual yang sebelumnya di sini. `items` tetap `undefined` sesaat di
  // load pertama (bukan `null`) — kode di bawah sudah toleran keduanya
  // lewat `items || []` pada withPosition/withDestination.
  // BUG NYATA (9 September 2026, laporan owner: Live Tracking crash total,
  // "Terjadi kesalahan saat memuat halaman ini") — migrasi react-query
  // sesi ini mengganti `load` manual dengan hook ini, TAPI `refetch` tidak
  // pernah didestrukturisasi di sini padahal `<JobDetailDrawer onChanged=
  // {load}>` di bawah masih memakai nama itu — `load` jadi identifier yang
  // TIDAK PERNAH dideklarasikan sama sekali (ReferenceError, bukan cuma
  // prop undefined), meledak di SETIAP render halaman ini tanpa syarat,
  // terlepas dari status Maps. Pola alias `refetch: load` di sini SAMA
  // dengan ArmadaDashboard.jsx/ArmadaRoutes.jsx/ArmadaJobs.jsx yang migrasi
  // sama tapi tidak lupa menyertakannya.
  const { data: items, error: queryError, refetch: load } = useArmadaTracking();
  const error = queryError?.message || "";
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [openJobId, setOpenJobId] = useState(null);
  const [activeInfo, setActiveInfo] = useState(null); // jobId marker YANG SEDANG buka InfoWindow
  // Hasil OSRM per job — { [jobId]: { coords, legDurations } | undefined }.
  // `undefined` (belum ada key) = belum selesai diminta ATAU gagal; kedua
  // kasus itu fallback ke garis lurus di render, TIDAK dibedakan di sini.
  const [jalurByJob, setJalurByJob] = useState({});

  const withPosition = useMemo(() => (items || []).filter((j) => j.lastPosition), [items]);
  const withDestination = useMemo(
    () => withPosition.filter((j) => j.destinationLat != null && j.destinationLng != null),
    [withPosition]
  );

  // Sinyal perubahan posisi yang RINGKAS (dibulatkan 5 desimal ~1m, sama
  // dengan cache di services/osrm.js) — dipakai sebagai dependency effect
  // supaya tidak minta ulang OSRM tiap poll 15 detik kalau driver belum
  // benar-benar bergerak jauh (posisi GPS yang dibulatkan tetap sama).
  const sinyalJalur = withDestination
    .map((j) => `${j.jobId}:${j.lastPosition.lat.toFixed(5)},${j.lastPosition.lng.toFixed(5)}:${j.destinationLat.toFixed(5)},${j.destinationLng.toFixed(5)}`)
    .join("|");

  useEffect(() => {
    let batal = false;
    for (const j of withDestination) {
      getRoadRoute([[j.lastPosition.lat, j.lastPosition.lng], [j.destinationLat, j.destinationLng]]).then((hasil) => {
        if (!batal && hasil) setJalurByJob((prev) => ({ ...prev, [j.jobId]: hasil }));
      });
    }
    return () => { batal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinyalJalur]);

  const center = withPosition.length > 0
    ? { lat: withPosition[0].lastPosition.lat, lng: withPosition[0].lastPosition.lng }
    : JAKARTA_CENTER;

  return (
    <PageContainer>
      <PageHeader
        title="Live Tracking"
        subtitle="Posisi driver yang sedang dalam perjalanan — data GPS asli dari aplikasi driver."
      />

      {error && (
        <div className="mb-3 rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">
          Gagal memuat posisi driver: {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden p-0">
          <div className="relative h-[560px] w-full">
            {/* Pil "N Driver Aktif" melayang di atas peta (13 Sep 2026,
                referensi owner: app navigasi/tracking selalu punya ringkasan
                mengambang, bukan header terpisah di luar peta). shadow-popover
                + bg-surface/95 — token DS v2 yang sama dipakai popover lain,
                BUKAN warna baru. Dot hijau berdenyut = penanda "live", sama
                bahasa visual dengan status Online driver di tempat lain. */}
            {items != null && (
              <div className="absolute left-3 top-3 z-10 flex items-center gap-2.5 rounded-full bg-surface/95 py-2 pl-2.5 pr-3.5 shadow-popover backdrop-blur-sm">
                <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accentbg">
                  <Truck size={14} className="text-accent" aria-hidden />
                  {withPosition.length > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green" />
                    </span>
                  )}
                </span>
                <div className="leading-tight">
                  <p className="text-[13px] font-bold text-ink">{withPosition.length} Driver Aktif</p>
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
                {withDestination.map((j) => {
                  const jalanAsli = jalurByJob[j.jobId];
                  const garisLurus = [
                    { lat: j.lastPosition.lat, lng: j.lastPosition.lng },
                    { lat: j.destinationLat, lng: j.destinationLng },
                  ];
                  const posisiGaris = jalanAsli?.coords
                    ? jalanAsli.coords.map(([lat, lng]) => ({ lat, lng }))
                    : garisLurus;
                  return (
                    <Polyline
                      key={`jalur-${j.jobId}`}
                      path={posisiGaris}
                      options={{ strokeColor: warnaJalur, strokeWeight: 4, strokeOpacity: 0.8 }}
                    />
                  );
                })}
                {withPosition.map((j) => {
                  const posisi = { lat: j.lastPosition.lat, lng: j.lastPosition.lng };
                  return (
                    <React.Fragment key={j.jobId}>
                      <Marker
                        position={posisi}
                        icon={driverIcon(window.google, j.driverName)}
                        onClick={() => { setSelectedJobId(j.jobId); setActiveInfo(`driver-${j.jobId}`); }}
                      />
                      {activeInfo === `driver-${j.jobId}` && (
                        <InfoWindow position={posisi} onCloseClick={() => setActiveInfo(null)}>
                          <div className="text-xs">
                            <p className="font-semibold">{j.driverName}</p>
                            <p>{j.customerName} · {JOB_TYPE_REAL[j.type]?.label || j.type}</p>
                            <button
                              type="button"
                              className="mt-1 font-semibold text-blue-600 underline"
                              onClick={() => setOpenJobId(j.jobId)}
                            >
                              Buka detail job
                            </button>
                          </div>
                        </InfoWindow>
                      )}
                    </React.Fragment>
                  );
                })}
                {withDestination.map((j) => {
                  const estimasiDetik = jalurByJob[j.jobId]?.legDurations?.[0];
                  const posisi = { lat: j.destinationLat, lng: j.destinationLng };
                  return (
                    <React.Fragment key={`tujuan-${j.jobId}`}>
                      <Marker
                        position={posisi}
                        icon={destinationIcon(window.google, resolved)}
                        onClick={() => setActiveInfo(`tujuan-${j.jobId}`)}
                      />
                      {estimasiDetik != null && <EtaBadge position={posisi}>{formatMenit(estimasiDetik)}</EtaBadge>}
                      {activeInfo === `tujuan-${j.jobId}` && (
                        <InfoWindow position={posisi} onCloseClick={() => setActiveInfo(null)}>
                          <div className="text-xs">
                            <p className="font-semibold">Tujuan — {j.customerName}</p>
                            <p>{j.addressText}</p>
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

        {/* Daftar driver — kartu individual (shadow-card, TANPA border) 13
            Sep 2026, ganti dari list hairline datar. Tinggi disamakan dengan
            peta (h-[560px]) supaya kedua kolom rata, konsisten dengan
            referensi owner (map + panel ringkasan sejajar tinggi). */}
        <div className="flex h-[560px] flex-col gap-2 overflow-y-auto pr-0.5">
          <p className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink3">
            <Truck size={12} aria-hidden /> {withPosition.length} Driver Dalam Perjalanan
          </p>
          {items == null ? (
            <Card className="p-4 text-center text-[11.5px] text-ink3">Memuat…</Card>
          ) : withPosition.length === 0 ? (
            <Card className="flex flex-col items-center gap-2 py-8 text-center">
              <MapPinned className="h-8 w-8 text-ink3" strokeWidth={1.5} aria-hidden />
              <p className="text-[12px] text-ink3">Belum ada driver dalam perjalanan sekarang.</p>
            </Card>
          ) : (
            withPosition.map((j) => (
              <button
                key={j.jobId}
                type="button"
                onClick={() => { setSelectedJobId(j.jobId); setOpenJobId(j.jobId); }}
                className={cn(
                  "rounded-card bg-surface p-3 text-left shadow-card transition-colors",
                  selectedJobId === j.jobId && "bg-accentbg"
                )}
              >
                <div className="flex items-start gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50">
                    <Truck size={14} className="text-blue-ink" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-bold text-ink">{j.driverName}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-ink3">
                        {waktuLalu(j.lastPosition?.recordedAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11.5px] text-ink2">
                      {j.customerName} · {JOB_TYPE_REAL[j.type]?.label || j.type}
                    </p>
                    {j.addressText && (
                      <p className="mt-1 flex items-start gap-1 text-[10.5px] text-ink3">
                        <Navigation size={10} className="mt-[1.5px] shrink-0" aria-hidden />
                        <span className="truncate">{j.addressText}</span>
                      </p>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <JobDetailDrawer jobId={openJobId} onClose={() => setOpenJobId(null)} onChanged={load} />
    </PageContainer>
  );
}
