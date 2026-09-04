import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup, Tooltip } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Truck, MapPinned, Navigation } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { avatarColor, getInitials } from "@/utils/format.js";
import { useTheme } from "@/lib/ThemeProvider.jsx";
import { getRoadRoute } from "@/services/osrm.js";
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
// Peta pakai Leaflet + tile CARTO (D-075, lihat di bawah) — GRATIS, TANPA
// API key/billing. Google Maps TIDAK dipakai di sini SENGAJA: billing
// project Google Cloud masih REQUEST_DENIED (dites langsung 30 Agustus
// 2026). Pin driver SELALU akurat (koordinat GPS asli dari HP, bukan hasil
// geocode).
//
// FASE 2 (30 Agustus 2026) — pin TUJUAN (alamat customer) sekarang ikut
// ditampilkan kalau job-nya sudah punya koordinat (destinationLat/Lng dari
// GET /armada/tracking) — bisa dari Google ATAU dari fallback gratis
// Nominatim (lihat services/maps.js). Kalau job BELUM punya koordinat sama
// sekali, tidak ada pin dipaksakan — alamat tetap tampil sebagai teks di
// panel kanan, supaya tidak berpura-pura akurat padahal datanya tidak ada.
//
// REDESIGN VISUAL + GARIS JALAN ASLI (D-075, 4 September 2026) — laporan
// owner: peta "masih jauh dari harapan seperti Google Maps", garis lurus
// antar titik, minta lebih simple/minimalist/detail. Sama seperti
// RouteMap.jsx: tile OSM raster → CARTO Positron/Dark Matter (menyatu
// dengan tema Delivery Hub), dan garis driver→tujuan sekarang minta
// geometri jalan asli ke OSRM (services/osrm.js) — fallback senyap ke garis
// lurus kalau OSRM gagal/timeout (server demo publik, bukan SLA
// production). Badge "±N menit lagi" di pin tujuan dari durasi OSRM.
//
// Pengambilan rute OSRM disentralkan di komponen ini (state `jalurByJob`,
// BUKAN dipecah jadi komponen anak per driver) — supaya hasilnya gampang
// ditempel ke marker tujuan yang SUDAH ada (satu marker, Popup+Tooltip
// sekaligus) tanpa perlu marker bayangan kedua di titik yang sama.
const JAKARTA_CENTER = [-6.2088, 106.8456];
const POLL_MS = 15000;

const TILE_LIGHT = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILE_DARK = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

// Warna SATU aksen (D-075) — konsisten dengan aturan "satu accent" Delivery
// Hub (lihat components/ui/card.jsx): garis ini elemen FUNGSIONAL (jalur
// tempuh nyata), bukan hiasan, jadi tetap satu hue biru brand, sama dengan
// --dh-accent di delivery-light.css/delivery-dark.css.
const WARNA_JALUR = "#4C8DFF";

function driverIcon(name) {
  const { bg, text } = avatarColor(name || "?");
  const initials = getInitials(name);
  return L.divIcon({
    className: "",
    html: `<div style="background:${bg};color:${text};width:38px;height:38px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.35)">${initials}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -19],
  });
}

// Pin tujuan — SENGAJA bentuk beda total dari avatar driver (kotak vs
// lingkaran) supaya tidak pernah tertukar sekilas mata di peta yang sama.
const destinationIcon = L.divIcon({
  className: "",
  html: `<div style="width:22px;height:22px;background:#dc2626;border:2px solid white;border-radius:4px 4px 4px 0;transform:rotate(45deg);box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 20],
});

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

export default function ArmadaTracking() {
  const { resolved } = useTheme();
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [openJobId, setOpenJobId] = useState(null);
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
    ? [withPosition[0].lastPosition.lat, withPosition[0].lastPosition.lng]
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
            {/* key berubah SEKALI saat data posisi pertama kali masuk — MEMAKSA
                remount, karena react-leaflet TIDAK reaktif terhadap prop
                `center` yang berubah setelah mount pertama (cuma dibaca
                sekali). Tanpa ini, peta akan diam di titik tengah Jakarta
                (fallback) selamanya walau driver asli sudah kelihatan
                posisinya di GET /armada/tracking. */}
            <MapContainer key={withPosition.length > 0 ? "ada-posisi" : "kosong"} center={center} zoom={12} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
              <TileLayer attribution={TILE_ATTRIBUTION} url={resolved === "dark" ? TILE_DARK : TILE_LIGHT} />
              {withDestination.map((j) => {
                const jalanAsli = jalurByJob[j.jobId];
                const garisLurus = [[j.lastPosition.lat, j.lastPosition.lng], [j.destinationLat, j.destinationLng]];
                return (
                  <Polyline
                    key={`jalur-${j.jobId}`}
                    positions={jalanAsli?.coords || garisLurus}
                    pathOptions={{ color: WARNA_JALUR, weight: 4, opacity: 0.8, lineCap: "round", lineJoin: "round" }}
                  />
                );
              })}
              {withPosition.map((j) => (
                <Marker
                  key={j.jobId}
                  position={[j.lastPosition.lat, j.lastPosition.lng]}
                  icon={driverIcon(j.driverName)}
                  eventHandlers={{ click: () => setSelectedJobId(j.jobId) }}
                >
                  <Popup>
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
                  </Popup>
                </Marker>
              ))}
              {withDestination.map((j) => {
                const estimasiDetik = jalurByJob[j.jobId]?.legDurations?.[0];
                return (
                  <Marker
                    key={`tujuan-${j.jobId}`}
                    position={[j.destinationLat, j.destinationLng]}
                    icon={destinationIcon}
                  >
                    {estimasiDetik != null && (
                      <Tooltip permanent direction="top" offset={[0, -20]} className="dh-route-eta-badge" opacity={1}>
                        {formatMenit(estimasiDetik)}
                      </Tooltip>
                    )}
                    <Popup>
                      <div className="text-xs">
                        <p className="font-semibold">Tujuan — {j.customerName}</p>
                        <p>{j.addressText}</p>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
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
