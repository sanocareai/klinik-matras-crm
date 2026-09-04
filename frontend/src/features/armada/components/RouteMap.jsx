import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup, Tooltip } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPinned } from "lucide-react";
import { useTheme } from "@/lib/ThemeProvider.jsx";
import { getRoadRoute } from "@/services/osrm.js";

// Peta Route Planner NYATA (31 Agustus 2026) — menggantikan
// RouteMapPlaceholder.jsx. Leaflet + tile CARTO (D-075, lihat di bawah),
// GRATIS tanpa API key/billing (sama pola dengan ArmadaTracking.jsx) —
// Google Maps billing masih REQUEST_DENIED, lihat catatan Fase 2 di
// services/maps.js.
//
// REDESIGN VISUAL + GARIS JALAN ASLI (D-075, 4 September 2026) — laporan
// owner: peta "masih jauh dari harapan seperti Google Maps", terutama garis
// rute LURUS antar titik, dan minta gaya lebih simple/minimalist/detail
// (referensi: kartu rute restoran/logistik bergaya putih-minimalis dgn
// badge waktu tempuh). Dua perubahan:
// 1. Tile OpenStreetMap raster (ramai warna) → CARTO Positron/Dark Matter
//    (basemaps.cartocdn.com, GRATIS tanpa key) — jalan & bangunan abu-abu
//    minimalis, cocok dengan tema Delivery Hub terang/gelap yang sudah ada.
// 2. Garis antar stop sekarang MINTA geometri jalan asli ke OSRM
//    (services/osrm.js) alih-alih menyambung titik lurus. OSRM server DEMO
//    publik (bukan SLA production) — kalau gagal/timeout, KEMBALI ke garis
//    lurus seperti sebelumnya (fallback senyap, bukan error ke user). Badge
//    "±N menit" di tiap stop (dari legDurations OSRM) meniru bubble waktu
//    tempuh di referensi — HANYA muncul kalau OSRM berhasil, tidak dipaksa
//    dari estimasi kasar.
//
// SEMUA RUTE MULAI & BERAKHIR DI KLINIK (D-076, 4 September 2026) — laporan
// owner: "buat semua jalur mulai dan berakhir di lokasi klinik matras".
// DEPOT (koordinat sama dengan backend/src/services/maps.js — SATU sumber
// kebenaran, jangan diketik ulang beda di sini) ditempel sebagai titik
// PERTAMA & TERAKHIR sebelum diminta ke OSRM, jadi garis rute yang tampil
// benar-benar bulat-balik dari/ke klinik, bukan cuma stop pertama sampai
// terakhir. Marker depot SATU untuk seluruh peta (bukan per-rute — semua
// rute berbagi titik awal yang sama), bentuknya SENGAJA beda dari nomor
// stop (rumah, bukan lingkaran bernomor) supaya jelas ini titik pangkalan,
// bukan stop pelanggan.
const JAKARTA_CENTER = [-6.2088, 106.8456];
const PALET_RUTE = ["#2563eb", "#dc2626", "#16a34a", "#f59e0b", "#7c3aed", "#0891b2"];

// Lokasi Klinik Matras by SANO CARE — SAMA PERSIS dengan DEPOT di
// backend/src/services/maps.js (lihat komentar D-076 di sana untuk sumber
// koordinatnya). Duplikasi angka ini TIDAK BISA dihindari (frontend tidak
// bisa import langsung dari backend), tapi keduanya WAJIB diubah bersamaan
// kalau lokasi klinik pernah pindah.
const DEPOT = { lat: -6.38784855, lng: 106.8177975, label: "Klinik Matras" };

// CARTO basemap gratis tanpa API key — dipilih sesuai tema aktif supaya
// menyatu dengan kaca terang/gelap Delivery Hub (bukan tile OSM warna-warni
// yang kontras keras dengan panel kaca di sekelilingnya).
const TILE_LIGHT = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILE_DARK = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

function stopIcon(warna, nomor) {
  return L.divIcon({
    className: "",
    html: `<div style="background:${warna};color:white;width:24px;height:24px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.35)">${nomor}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

// Marker depot — kotak dengan sudut membulat + ikon rumah sederhana (bukan
// lingkaran bernomor seperti stop) supaya sekilas mata langsung beda dari
// stop pelanggan. Warna netral gelap (bukan salah satu warna PALET_RUTE) —
// depot itu MILIK BERSAMA semua rute, tidak boleh terlihat "punya" satu
// rute tertentu.
const depotIcon = L.divIcon({
  className: "",
  html: `<div style="background:#1D1D1F;color:white;width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,.4)"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg></div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 28],
  popupAnchor: [0, -26],
});

function formatMenit(detik) {
  const menit = Math.round(detik / 60);
  if (menit < 1) return "<1 mnt";
  if (menit < 60) return `${menit} mnt`;
  const jam = Math.floor(menit / 60);
  const sisaMenit = menit % 60;
  return sisaMenit > 0 ? `${jam} j ${sisaMenit} mnt` : `${jam} jam`;
}

// SATU rute (garis + marker stop-nya) — komponen level-atas sendiri (D-074:
// jangan didefinisikan di dalam body RouteMap, supaya identitasnya stabil
// lintas render). Minta geometri jalan asli ke OSRM begitu daftar stop-nya
// berubah; sementara menunggu/gagal, tampil garis lurus dulu (TIDAK pernah
// kosong sama sekali) supaya dispatcher tetap lihat urutan rute. Titik yang
// diminta ke OSRM SELALU [DEPOT, ...stops, DEPOT] (D-076) — garis & badge
// waktu tempuh jadi bulat-balik dari/ke klinik, bukan cuma antar stop.
function RouteLine({ route, warna, stops }) {
  const [jalanAsli, setJalanAsli] = useState(null); // { coords, legDurations } | null

  useEffect(() => {
    setJalanAsli(null);
    if (stops.length === 0) return;
    let batal = false;
    const titik = [[DEPOT.lat, DEPOT.lng], ...stops.map((s) => [s.lat, s.lng]), [DEPOT.lat, DEPOT.lng]];
    getRoadRoute(titik).then((hasil) => {
      if (!batal && hasil) setJalanAsli(hasil);
    });
    return () => { batal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops.map((s) => `${s.id}:${s.lat}:${s.lng}`).join(",")]);

  const garisLurus = [[DEPOT.lat, DEPOT.lng], ...stops.map((s) => [s.lat, s.lng]), [DEPOT.lat, DEPOT.lng]];
  const posisiGaris = jalanAsli?.coords || garisLurus;

  return (
    <>
      <Polyline positions={posisiGaris} pathOptions={{ color: warna, weight: 4, opacity: 0.75, lineCap: "round", lineJoin: "round" }} />
      {stops.map((s, i) => {
        // Waktu tempuh KUMULATIF dari KLINIK sampai stop ini — legDurations[0]
        // = klinik→stop pertama (karena titik yang diminta ke OSRM diawali
        // DEPOT), jadi stop PERTAMA pun sekarang dapat badge (sebelum D-076
        // cuma stop ke-2 dst yang punya badge, dihitung dari stop pertama).
        const menitKumulatif = jalanAsli?.legDurations
          ? jalanAsli.legDurations.slice(0, i + 1).reduce((a, b) => a + b, 0)
          : null;
        return (
          <Marker key={s.id} position={[s.lat, s.lng]} icon={stopIcon(warna, i + 1)}>
            {menitKumulatif != null && (
              <Tooltip permanent direction="top" offset={[0, -14]} className="dh-route-eta-badge" opacity={1}>
                {formatMenit(menitKumulatif)}
              </Tooltip>
            )}
            <Popup>
              <div className="text-xs">
                <p className="font-semibold">{route.code} · stop {i + 1}</p>
                <p>{s.addressText}</p>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

export default function RouteMap({ routes }) {
  const { resolved } = useTheme();

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
        <TileLayer attribution={TILE_ATTRIBUTION} url={resolved === "dark" ? TILE_DARK : TILE_LIGHT} />
        {dataRute.map(({ route, warna, stops }) => (
          <RouteLine key={route.id} route={route} warna={warna} stops={stops} />
        ))}
        <Marker position={[DEPOT.lat, DEPOT.lng]} icon={depotIcon}>
          <Popup>
            <div className="text-xs">
              <p className="font-semibold">{DEPOT.label}</p>
              <p>Titik awal &amp; akhir semua rute</p>
            </div>
          </Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}
