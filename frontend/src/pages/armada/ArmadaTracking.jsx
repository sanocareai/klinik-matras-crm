import React, { useCallback, useEffect, useMemo, useState } from "react";
import { GoogleMap, Marker, Polyline, InfoWindow, OverlayView, useJsApiLoader } from "@react-google-maps/api";
import { Truck, MapPinned, Navigation } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { useTheme } from "@/lib/ThemeProvider.jsx";
import { getRoadRoute } from "@/services/osrm.js";
import { GOOGLE_MAPS_JS_KEY, GOOGLE_MAPS_LIBRARIES, GOOGLE_MAPS_SCRIPT_ID } from "@/lib/googleMaps.js";
import { MAP_STYLE_DARK } from "@/features/armada/googleMapStyle.js";
import { driverIcon, destinationIcon } from "@/features/armada/googleMapIcons.js";
import JobDetailDrawer from "@/features/armada/components/JobDetailDrawer.jsx";
import { JOB_TYPE_REAL } from "@/features/armada/jobStatus.js";

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
const JAKARTA_CENTER = { lat: -6.2088, lng: 106.8456 };
const POLL_MS = 15000;
const WARNA_JALUR = "#4C8DFF";

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
  const { isLoaded } = useJsApiLoader({
    id: GOOGLE_MAPS_SCRIPT_ID,
    googleMapsApiKey: GOOGLE_MAPS_JS_KEY,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [openJobId, setOpenJobId] = useState(null);
  const [activeInfo, setActiveInfo] = useState(null); // jobId marker YANG SEDANG buka InfoWindow
  // Hasil OSRM per job — { [jobId]: { coords, legDurations } | undefined }.
  // `undefined` (belum ada key) = belum selesai diminta ATAU gagal; kedua
  // kasus itu fallback ke garis lurus di render, TIDAK dibedakan di sini.
  const [jalurByJob, setJalurByJob] = useState({});

  const load = useCallback(() => {
    api.getArmadaTracking().then(setItems).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

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

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="overflow-hidden p-0">
          <div className="h-[460px] w-full">
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
                      options={{ strokeColor: WARNA_JALUR, strokeWeight: 4, strokeOpacity: 0.8 }}
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
                        icon={destinationIcon(window.google)}
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

        <div className="rounded-card border border-border bg-surface">
          <div className="border-b border-line px-3 py-2.5">
            <h3 className="flex items-center gap-1.5 text-[12.5px] font-bold text-ink">
              <Truck size={13} aria-hidden /> {withPosition.length} Driver Dalam Perjalanan
            </h3>
          </div>
          {items === null ? (
            <div className="px-3 py-6 text-center text-[11.5px] text-ink3">Memuat…</div>
          ) : withPosition.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <MapPinned className="mx-auto mb-2 h-8 w-8 text-ink3" strokeWidth={1.5} />
              <p className="text-[12px] text-ink3">Belum ada driver dalam perjalanan sekarang.</p>
            </div>
          ) : (
            <ul className="max-h-[400px] divide-y divide-line overflow-y-auto">
              {withPosition.map((j) => (
                <li key={j.jobId}>
                  <button
                    type="button"
                    onClick={() => { setSelectedJobId(j.jobId); setOpenJobId(j.jobId); }}
                    className={cn(
                      "w-full px-3 py-2.5 text-left transition-colors hover:bg-hovertint",
                      selectedJobId === j.jobId && "bg-accentbg"
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[12.5px] font-semibold text-ink">{j.driverName}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-ink3">
                        {waktuLalu(j.lastPosition?.recordedAt)}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-ink2">
                      {j.customerName} · {JOB_TYPE_REAL[j.type]?.label || j.type}
                    </div>
                    {j.addressText && (
                      <div className="mt-0.5 flex items-start gap-1 text-[10.5px] text-ink3">
                        <Navigation size={10} className="mt-[1.5px] shrink-0" />
                        <span className="truncate">{j.addressText}</span>
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <JobDetailDrawer jobId={openJobId} onClose={() => setOpenJobId(null)} onChanged={load} />
    </PageContainer>
  );
}
