import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, Marker, Polyline, InfoWindow, OverlayView, useJsApiLoader } from "@react-google-maps/api";
import { MapPinned } from "lucide-react";
import { useTheme } from "@/lib/ThemeProvider.jsx";
import { getRoadRoute } from "@/services/osrm.js";
import { GOOGLE_MAPS_JS_KEY, GOOGLE_MAPS_LIBRARIES, GOOGLE_MAPS_SCRIPT_ID } from "@/lib/googleMaps.js";
import { MAP_STYLE_DARK } from "../googleMapStyle.js";
import { stopIcon, depotIcon } from "../googleMapIcons.js";

// Peta Route Planner NYATA (31 Agustus 2026) — awalnya Leaflet + tile CARTO
// gratis. DIMIGRASI ke Google Maps JavaScript API sungguhan (8 September
// 2026) — CARTO tiba-tiba mewajibkan API key akhir Agustus 2026 (basemap
// gratis berhenti berfungsi, watermark "API KEY REQUIRED" muncul di
// production), DAN billing Google Cloud sudah aktif hari yang sama (akun
// baru) — dua alasan sekaligus untuk pindah, bukan cuma tambal CARTO.
// Lihat catatan panjang di lib/googleMaps.js untuk detail pemisahan key.
//
// Garis antar stop TETAP minta geometri jalan asli ke OSRM (services/osrm.js,
// server demo publik gratis) — TIDAK diganti Google Directions API. Alasan:
// OSRM sudah cukup baik untuk garis rute (bukan navigasi turn-by-turn) dan
// mengaktifkan Directions API berarti API berbayar KETIGA (setelah
// Geocoding+Distance Matrix) yang belum tentu perlu — kalau nanti garis OSRM
// dirasa kurang akurat, itu keputusan terpisah, bukan ikut migrasi tile ini.
//
// SEMUA RUTE MULAI & BERAKHIR DI KLINIK (D-076, 4 September 2026) — laporan
// owner: "buat semua jalur mulai dan berakhir di lokasi klinik matras".
// DEPOT (koordinat sama dengan backend/src/services/maps.js — SATU sumber
// kebenaran, jangan diketik ulang beda di sini) ditempel sebagai titik
// PERTAMA & TERAKHIR sebelum diminta ke OSRM.
const PALET_RUTE = ["#2563eb", "#dc2626", "#16a34a", "#f59e0b", "#7c3aed", "#0891b2"];

// Lokasi Klinik Matras by SANO CARE — SAMA PERSIS dengan DEPOT di
// backend/src/services/maps.js (lihat komentar D-076/koreksi 6 September
// 2026 di sana untuk sumber koordinatnya). Duplikasi angka ini TIDAK BISA
// dihindari (frontend tidak bisa import langsung dari backend), tapi
// keduanya WAJIB diubah bersamaan kalau lokasi klinik pernah pindah.
const DEPOT = { lat: -6.4036521, lng: 106.7839743, label: "Klinik Matras" };

function formatMenit(detik) {
  const menit = Math.round(detik / 60);
  if (menit < 1) return "<1 mnt";
  if (menit < 60) return `${menit} mnt`;
  const jam = Math.floor(menit / 60);
  const sisaMenit = menit % 60;
  return sisaMenit > 0 ? `${jam} j ${sisaMenit} mnt` : `${jam} jam`;
}

// Badge waktu tempuh mengambang di atas marker stop — OverlayView (bukan
// Marker.label, yang cuma teks polos DI DALAM ikon) supaya bisa dipasangi
// class CSS `.dh-route-eta-badge` yang sudah ada (delivery-light.css/
// delivery-dark.css), sama tampilan dengan versi Leaflet Tooltip lama.
function EtaBadge({ position, children }) {
  return (
    <OverlayView
      position={position}
      mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
      getPixelPositionOffset={(w, h) => ({ x: -w / 2, y: -h - 22 })}
    >
      <div className="dh-route-eta-badge">{children}</div>
    </OverlayView>
  );
}

// Titik jalur SATU rute, dengan DEPOT disisipkan bukan cuma di depan/
// belakang (D-076) TAPI JUGA di tengah untuk tiap stop ber-flag
// `returnToDepotBefore` (D-164, 13 September 2026 — permintaan owner:
// "sering juga 1 rute misal dari alamat 1,2, ke 3 nya balik dulu ke klinik
// matras"). `posisiStopDiTitik[i]` = indeks titik stop ke-i di dalam array
// `titik` (BUKAN sama dengan `i` lagi begitu ada penyisipan depot) — dipakai
// utk cocokkan legDurations OSRM (1 leg per pasangan titik berurutan) ke
// stop yang benar, supaya badge ETA kumulatif tetap akurat walau rutenya
// sudah tidak lurus stop-ke-stop.
function titikRuteDenganDepot(stops) {
  const titik = [{ lat: DEPOT.lat, lng: DEPOT.lng }];
  const posisiStopDiTitik = [];
  for (const s of stops) {
    if (s.returnToDepotBefore) titik.push({ lat: DEPOT.lat, lng: DEPOT.lng });
    titik.push({ lat: s.lat, lng: s.lng });
    posisiStopDiTitik.push(titik.length - 1);
  }
  titik.push({ lat: DEPOT.lat, lng: DEPOT.lng });
  return { titik, posisiStopDiTitik };
}

// SATU rute (garis + marker stop-nya, + marker depot TAMBAHAN di titik
// balik-tengah kalau ada). Minta geometri jalan asli ke OSRM begitu daftar
// stop-nya berubah; sementara menunggu/gagal, tampil garis lurus dulu
// (TIDAK pernah kosong sama sekali) supaya dispatcher tetap lihat urutan
// rute.
function RouteLine({ route, warna, stops, google, activeStop, onStopClick, onStopClose }) {
  const [jalanAsli, setJalanAsli] = useState(null); // { coords, legDurations } | null

  const { titik, posisiStopDiTitik } = useMemo(() => titikRuteDenganDepot(stops), [stops]);

  useEffect(() => {
    setJalanAsli(null);
    if (stops.length === 0) return;
    let batal = false;
    getRoadRoute(titik.map((t) => [t.lat, t.lng])).then((hasil) => {
      if (!batal && hasil) setJalanAsli(hasil);
    });
    return () => { batal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops.map((s) => `${s.id}:${s.lat}:${s.lng}:${s.returnToDepotBefore ? 1 : 0}`).join(",")]);

  const posisiGaris = jalanAsli?.coords
    ? jalanAsli.coords.map(([lat, lng]) => ({ lat, lng }))
    : titik;

  // Depot tengah (13 September 2026) — marker TAMBAHAN persis di titik
  // balik, dipisah dari marker depot utama (start/akhir) di RouteMap agar
  // key-nya unik & tidak bentrok kalau lebih dari 1 rute punya detour.
  const depotTengah = stops.filter((s) => s.returnToDepotBefore);

  return (
    <>
      <Polyline path={posisiGaris} options={{ strokeColor: warna, strokeWeight: 4, strokeOpacity: 0.75, geodesic: false }} />
      {depotTengah.map((s) => (
        <Marker key={`depot-tengah-${s.id}`} position={{ lat: DEPOT.lat, lng: DEPOT.lng }} icon={depotIcon(google)} title="Kembali ke Klinik Matras" />
      ))}
      {stops.map((s, i) => {
        const menitKumulatif = jalanAsli?.legDurations
          ? jalanAsli.legDurations.slice(0, posisiStopDiTitik[i]).reduce((a, b) => a + b, 0)
          : null;
        const posisi = { lat: s.lat, lng: s.lng };
        return (
          <React.Fragment key={s.id}>
            <Marker position={posisi} icon={stopIcon(google, warna, i + 1)} onClick={() => onStopClick(s.id)} />
            {menitKumulatif != null && <EtaBadge position={posisi}>{formatMenit(menitKumulatif)}</EtaBadge>}
            {activeStop === s.id && (
              <InfoWindow position={posisi} onCloseClick={onStopClose}>
                <div className="text-xs">
                  <p className="font-semibold">{route.code} · stop {i + 1}</p>
                  <p>{s.addressText}</p>
                  {s.returnToDepotBefore && <p className="mt-1 font-semibold text-orange">↩ Kembali ke Klinik Matras dulu sebelum stop ini</p>}
                </div>
              </InfoWindow>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

export default function RouteMap({ routes }) {
  const { resolved } = useTheme();
  const { isLoaded } = useJsApiLoader({
    id: GOOGLE_MAPS_SCRIPT_ID,
    googleMapsApiKey: GOOGLE_MAPS_JS_KEY,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });
  const mapRef = useRef(null);
  const [activeStop, setActiveStop] = useState(null);

  const dataRute = useMemo(() => {
    return (routes || []).map((route, i) => {
      const warna = PALET_RUTE[i % PALET_RUTE.length];
      const stops = (route.jobs || [])
        .filter((j) => j.lat != null && j.lng != null)
        .slice()
        .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
      return { route, warna, stops };
    });
  }, [routes]);

  const semuaTitik = dataRute.flatMap((r) => r.stops.map((s) => ({ lat: s.lat, lng: s.lng })));
  const adaTitik = semuaTitik.length > 0;

  // Sinyal ringkas perubahan titik (dipakai dependency, bukan array
  // reference-nya sendiri yang berubah tiap render) — fitBounds MEMANGGIL
  // peta langsung, tidak lewat prop React biasa.
  const sinyalTitik = semuaTitik.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("|");

  useEffect(() => {
    if (!mapRef.current || !window.google || semuaTitik.length === 0) return;
    const bounds = new window.google.maps.LatLngBounds();
    bounds.extend(DEPOT);
    for (const p of semuaTitik) bounds.extend(p);
    mapRef.current.fitBounds(bounds, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinyalTitik, isLoaded]);

  const onLoad = useCallback((map) => { mapRef.current = map; }, []);
  const onUnmount = useCallback(() => { mapRef.current = null; }, []);

  // Tinggi 220px -> 480px (8 September 2026, laporan owner: "jalur maps
  // kecil banget") — masuk akal sejak peta ini masih Leaflet+CARTO polos
  // (lebih dekorasi daripada alat baca rute), tapi sekarang ini Google Maps
  // sungguhan dengan fitBounds otomatis ke SELURUH rute — 220px terlalu
  // pendek untuk benar-benar membaca jalur di kota sebesar Jabodetabek.
  if (!adaTitik) {
    return (
      <div className="flex h-[480px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-card border border-dashed border-border bg-inset px-4 text-center">
        <MapPinned size={28} className="text-ink3" strokeWidth={1.5} aria-hidden />
        <p className="text-[12px] font-semibold text-ink2">Peta rute</p>
        <p className="max-w-[260px] text-[10.5px] text-ink3">
          Belum ada rute dengan koordinat untuk dipratinjau — buat rute atau tambah stop dulu (koordinat terisi otomatis dari link Maps/alamat job).
        </p>
      </div>
    );
  }

  if (!GOOGLE_MAPS_JS_KEY) {
    return (
      <div className="flex h-[480px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-card border border-dashed border-border bg-inset px-4 text-center">
        <MapPinned size={28} className="text-ink3" strokeWidth={1.5} aria-hidden />
        <p className="text-[12px] font-semibold text-ink2">Peta belum aktif</p>
        <p className="max-w-[260px] text-[10.5px] text-ink3">
          VITE_GOOGLE_MAPS_JS_KEY belum diisi — lihat docs deploy untuk cara mengaktifkannya.
        </p>
      </div>
    );
  }

  if (!isLoaded) {
    return <div className="flex h-[480px] shrink-0 items-center justify-center rounded-card border border-border bg-inset text-[11.5px] text-ink3">Memuat peta…</div>;
  }

  return (
    <div className="h-[480px] shrink-0 overflow-hidden rounded-card border border-border">
      <GoogleMap
        mapContainerStyle={{ height: "100%", width: "100%" }}
        center={DEPOT}
        zoom={11}
        onLoad={onLoad}
        onUnmount={onUnmount}
        options={{
          styles: resolved === "dark" ? MAP_STYLE_DARK : undefined,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
        }}
      >
        {dataRute.map(({ route, warna, stops }) => (
          <RouteLine
            key={route.id}
            route={route}
            warna={warna}
            stops={stops}
            google={window.google}
            activeStop={activeStop}
            onStopClick={setActiveStop}
            onStopClose={() => setActiveStop(null)}
          />
        ))}
        <Marker position={DEPOT} icon={depotIcon(window.google)} title={DEPOT.label} />
      </GoogleMap>
    </div>
  );
}
