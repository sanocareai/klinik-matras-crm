import React, { useMemo } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPinned } from "lucide-react";

// Peta Route Planner NYATA (31 Agustus 2026) — menggantikan
// RouteMapPlaceholder.jsx. Leaflet + tile OpenStreetMap, GRATIS tanpa API
// key/billing (sama pola dengan ArmadaTracking.jsx) — Google Maps billing
// masih REQUEST_DENIED, lihat catatan Fase 2 di services/maps.js.
//
// Satu warna per rute (siklus 6 warna) supaya beberapa rute driver
// berbeda di tanggal yang sama tidak tertukar sekilas mata. Garis
// penghubung antar stop MURNI VISUAL urutan yang dispatcher pilih — BUKAN
// jalur jalan sungguhan (garis lurus antar titik, sama keterbatasannya
// dengan estimasi jarak di Armada.jsx/RouteCard.jsx).
//
// Stop TANPA koordinat (job yang alamatnya belum berhasil di-geocode sama
// sekali — Google/Nominatim/link Maps semuanya gagal) TIDAK dipaksakan
// tampil sebagai pin — tetap kelihatan di daftar stop RouteCard seperti
// biasa, cuma tidak ikut di peta ini.
const JAKARTA_CENTER = [-6.2088, 106.8456];
const PALET_RUTE = ["#2563eb", "#dc2626", "#16a34a", "#f59e0b", "#7c3aed", "#0891b2"];

function stopIcon(warna, nomor) {
  return L.divIcon({
    className: "",
    html: `<div style="background:${warna};color:white;width:24px;height:24px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.35)">${nomor}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

export default function RouteMap({ routes }) {
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

  const semuaTitik = dataRute.flatMap((r) => r.stops.map((s) => [s.lat, s.lng]));
  const adaTitik = semuaTitik.length > 0;

  if (!adaTitik) {
    return (
      <div className="flex h-[220px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-card border border-dashed border-border bg-inset px-4 text-center">
        <MapPinned size={28} className="text-ink3" strokeWidth={1.5} aria-hidden />
        <p className="text-[12px] font-semibold text-ink2">Peta rute</p>
        <p className="max-w-[260px] text-[10.5px] text-ink3">
          Belum ada stop dengan koordinat pada tanggal ini — isi alamat job dulu (koordinat terisi otomatis).
        </p>
      </div>
    );
  }

  return (
    <div className="h-[220px] shrink-0 overflow-hidden rounded-card border border-border">
      {/* key berubah kalau jumlah titik berubah -> remount, sama alasan
          dengan ArmadaTracking.jsx: react-leaflet cuma baca `center` sekali
          saat mount pertama. */}
      <MapContainer key={semuaTitik.length} center={semuaTitik[0]} zoom={11} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {dataRute.map(({ route, warna, stops }) => (
          <React.Fragment key={route.id}>
            {stops.length > 1 && (
              <Polyline positions={stops.map((s) => [s.lat, s.lng])} pathOptions={{ color: warna, weight: 3, opacity: 0.7 }} />
            )}
            {stops.map((s, i) => (
              <Marker key={s.id} position={[s.lat, s.lng]} icon={stopIcon(warna, i + 1)}>
                <Popup>
                  <div className="text-xs">
                    <p className="font-semibold">{route.code} · stop {i + 1}</p>
                    <p>{s.addressText}</p>
                  </div>
                </Popup>
              </Marker>
            ))}
          </React.Fragment>
        ))}
      </MapContainer>
    </div>
  );
}
