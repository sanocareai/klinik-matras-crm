import React, { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import UnroutedJobsPanel from "@/features/armada/components/UnroutedJobsPanel.jsx";
import RouteCard from "@/features/armada/components/RouteCard.jsx";
import RouteMap from "@/features/armada/components/RouteMap.jsx";
import { unitCountOf } from "@/features/armada/jobStatus.js";

// Route Planner — Delivery Tahap 3.
//
// DATA NYATA (endpoint Tahap 3: /armada/routes, /armada/vehicles). Tidak ada
// badge "Contoh" — inilah alasan Vehicle/Route ditambahkan ke skema di awal
// Tahap 3, supaya halaman ini tidak perlu ditulis ulang begitu data sungguhan
// tersedia.
//
// TIGA PANEL sesuai spesifikasi: kiri = job belum masuk rute, tengah = papan
// rute (drag-drop) + peta nyata di atasnya (RouteMap.jsx, Leaflet/OSM —
// menggantikan RouteMapPlaceholder.jsx 31 Agustus 2026), kanan = ringkasan
// tanggal terpilih.
//
// "Urutkan" TETAP bukan VRP sungguhan (PRD §1.5 melarang optimasi rute
// otomatis penuh untuk v1) — cuma nearest-neighbor sederhana kalau semua
// stop punya koordinat (Fase 2, lihat urutkanOtomatis di bawah), turun ke
// sort timeWindow+alamat kalau belum semua ter-geocode.
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function ArmadaRoutes() {
  const [tanggal, setTanggal] = useState(todayISO());
  const [routes, setRoutes] = useState(null);
  const [unrouted, setUnrouted] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [error, setError] = useState("");
  const [draggingJobId, setDraggingJobId] = useState(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const [routesRes, jobsRes, driversRes, vehiclesRes] = await Promise.all([
        api.getRoutes({ date: tanggal }),
        // Panel kiri: job pada tanggal ini yang belum masuk rute mana pun DAN
        // belum selesai/gagal — job yang sudah COMPLETED tidak relevan
        // direncanakan ulang.
        api.getArmadaJobs({ date: tanggal, routeId: "none" }),
        api.getDrivers(),
        api.getVehicles(),
      ]);
      setRoutes(routesRes.routes);
      setUnrouted(jobsRes.jobs.filter((j) => !["COMPLETED", "FAILED"].includes(j.status)));
      setDrivers(driversRes);
      setVehicles(vehiclesRes.vehicles);
    } catch (e) {
      setError(e.message);
    }
  }, [tanggal]);

  useEffect(() => { load(); }, [load]);

  async function buatRute() {
    try {
      await api.createRoute({ date: tanggal });
      load();
    } catch (e) {
      alert("Gagal membuat rute: " + e.message);
    }
  }

  // Susun ulang anggota SATU rute lalu kirim daftar LENGKAP hasil akhirnya —
  // pola yang sama dengan PATCH /route/reorder yang sudah ada di Papan.
  async function terapkanUrutan(route, jobIdsBaru) {
    await api.setRouteJobs(route.id, jobIdsBaru);
    await load();
  }

  async function tambahKeRute(route, jobId, index) {
    const idsSaatIni = (route.jobs || []).slice().sort((a, b) => (a.sequence || 0) - (b.sequence || 0)).map((j) => j.id);
    const idsBaru = [...idsSaatIni];
    idsBaru.splice(index, 0, jobId);
    await terapkanUrutan(route, idsBaru);
  }

  async function urutkanUlang(route, jobId, indexBaru) {
    const idsSaatIni = (route.jobs || []).slice().sort((a, b) => (a.sequence || 0) - (b.sequence || 0)).map((j) => j.id);
    const tanpaJobIni = idsSaatIni.filter((id) => id !== jobId);
    tanpaJobIni.splice(indexBaru, 0, jobId);
    await terapkanUrutan(route, tanpaJobIni);
  }

  async function keluarkanDariRute(route, jobId) {
    const idsBaru = (route.jobs || []).filter((j) => j.id !== jobId).sort((a, b) => (a.sequence || 0) - (b.sequence || 0)).map((j) => j.id);
    await terapkanUrutan(route, idsBaru);
  }

  async function ubahPenugasan(route, patch) {
    await api.updateRoute(route.id, patch);
    await load();
  }

  async function terbitkan(route) {
    try {
      await api.publishRoute(route.id);
      await load();
    } catch (e) {
      alert("Gagal menerbitkan rute: " + e.message);
    }
  }

  async function batalkan(route) {
    if (!confirm(`Batalkan rute ${route.code}? Job di dalamnya tetap tercatat pernah direncanakan di sini.`)) return;
    await api.cancelRoute(route.id);
    await load();
  }

  // Jarak garis lurus (haversine, km) — cukup untuk MEMBANDINGKAN urutan,
  // bukan angka jarak jalan sungguhan (Google Maps belum aktif, lihat
  // services/maps.js Fase 2). Salinan sengaja di frontend, bukan panggil
  // API — dipakai murni untuk membandingkan beberapa kandidat "stop mana
  // yang paling dekat" sebelum kirim urutan akhir ke server.
  function jarakKm(a, b) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // Optimasi sederhana (SENGAJA bukan VRP sungguhan, PRD §1.5 melarang
  // optimasi algoritmik penuh untuk v1) — Fase 2 (30 Agustus 2026): kalau
  // SEMUA stop di rute ini sudah punya koordinat (geocode Google ATAU
  // fallback Nominatim, keduanya mengisi job.lat/lng yang sama), urutkan
  // pakai nearest-neighbor sederhana: mulai dari stop berjam paling awal,
  // lalu selalu lompat ke stop TERDEKAT berikutnya yang belum dikunjungi.
  // Kalau ADA SATU SAJA stop tanpa koordinat, turun ke cara lama (jam lalu
  // alamat) — mencampur "urut jarak" dengan "urut alamat" di rute yang sama
  // akan menghasilkan urutan yang tidak bisa dijelaskan ke driver.
  async function urutkanOtomatis(route) {
    const jobs = route.jobs || [];
    const semuaAdaKoordinat = jobs.length > 0 && jobs.every((j) => j.lat != null && j.lng != null);

    let terurut;
    if (semuaAdaKoordinat) {
      const sisa = [...jobs].sort((a, b) => (a.timeWindow || "").localeCompare(b.timeWindow || ""));
      const hasil = [sisa.shift()];
      while (sisa.length > 0) {
        const terakhir = hasil[hasil.length - 1];
        let idxTerdekat = 0, jarakTerdekat = Infinity;
        sisa.forEach((j, i) => {
          const d = jarakKm(terakhir, j);
          if (d < jarakTerdekat) { jarakTerdekat = d; idxTerdekat = i; }
        });
        hasil.push(sisa.splice(idxTerdekat, 1)[0]);
      }
      terurut = hasil.map((j) => j.id);
    } else {
      terurut = jobs
        .slice()
        .sort((a, b) => (a.timeWindow || "").localeCompare(b.timeWindow || "") || (a.addressText || "").localeCompare(b.addressText || ""))
        .map((j) => j.id);
    }
    await terapkanUrutan(route, terurut);
  }

  const totalStopSemuaRute = (routes || []).reduce((s, r) => s + (r.jobs?.length || 0), 0);
  const totalUnitSemuaRute = (routes || []).reduce((s, r) => s + (r.jobs || []).reduce((s2, j) => s2 + unitCountOf(j), 0), 0);
  const draftCount = (routes || []).filter((r) => r.status === "DRAFT").length;
  const publishedCount = (routes || []).filter((r) => r.status === "PUBLISHED").length;

  const loading = routes === null;

  return (
    <PageContainer className="max-w-none">
      <PageHeader
        title="Route Planner"
        subtitle="Kelompokkan job ke dalam rute, atur urutan stop, dan tetapkan driver."
        actions={
          <>
            <DatePicker value={tanggal} onChange={setTanggal} placeholder="Pilih tanggal" />
            <Button size="sm" onClick={buatRute}><Plus size={14} /> Buat Rute</Button>
          </>
        }
      />

      {error && <div className="mb-3 rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

      {/* `xl:` (1280px), BUKAN `lg:` (1024px) — D-056, 4 September 2026.
          Laporan owner: 3 panel (240px + tengah + 240px) tampil sejajar
          sempit di potrait/tablet. Akar masalahnya: `lg:1024px` PERSIS
          lebar iPad portrait (semua model, termasuk iPad Pro) — breakpoint
          klasik yang gampang terlewat karena 1024 "terasa" seperti lebar
          desktop, padahal itu tablet portrait paling umum. Dengan 3 kolom
          fixed 240px di kedua sisi, sisa ruang tengah untuk peta+kartu rute
          jadi SANGAT sempit tepat di lebar itu — persis gejala yang
          dilaporkan. Naik ke `xl` memastikan HANYA layar benar-benar lebar
          (laptop/desktop) yang dapat 3 kolom sejajar; tablet potrait &
          ponsel manapun jatuh ke grid-cols-1 (tumpuk vertikal, kiri->tengah
          ->kanan), yang lebih nyaman dibaca di layar sempit. */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[240px_minmax(0,1fr)_240px]">
        {/* Kiri */}
        <div className="xl:h-[calc(100vh-220px)]">
          <UnroutedJobsPanel
            jobs={unrouted || []}
            loading={loading}
            draggingId={draggingJobId}
            onDragStart={(j) => setDraggingJobId(j.id)}
            onDragEnd={() => setDraggingJobId(null)}
          />
        </div>

        {/* Tengah — papan rute */}
        <div className="min-w-0">
          <RouteMap routes={routes} />
          <div className="mt-3">
            {loading ? (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {[1, 2].map((i) => <div key={i} className="h-64 w-[300px] shrink-0 animate-pulse rounded-card bg-inset" />)}
              </div>
            ) : routes.length === 0 ? (
              <EmptyState
                title="Belum ada rute pada tanggal ini"
                description="Buat rute lalu seret job dari panel kiri ke dalamnya."
                action={<Button size="sm" onClick={buatRute}><Plus size={14} /> Buat Rute</Button>}
              />
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {routes.map((r) => (
                  <RouteCard
                    key={r.id}
                    route={r}
                    drivers={drivers}
                    vehicles={vehicles}
                    draggingJobId={draggingJobId}
                    onDrop={tambahKeRute}
                    onReorder={urutkanUlang}
                    onRemoveJob={keluarkanDariRute}
                    onAssign={ubahPenugasan}
                    onPublish={terbitkan}
                    onCancel={batalkan}
                    onOptimize={urutkanOtomatis}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Kanan — ringkasan. Angka dibesarkan + `dh-figure` (D-055, 4
            September 2026) supaya konsisten dengan bahasa KPI Dashboard
            (DeliveryKpiRow) — sebelumnya baris label/angka rata, tidak ada
            hierarki visual sama sekali antara panel ini dan Dashboard yang
            sudah dirapikan lebih dulu. `dh-figure` sendiri no-op di light
            mode (lihat catatan di styles/delivery-dark.css), jadi aman
            dipakai di sini tanpa efek di luar pilot dark Delivery. */}
        <aside className="space-y-3 rounded-card border border-border bg-surface p-3 xl:h-[calc(100vh-220px)] xl:overflow-y-auto">
          <h3 className="text-[12.5px] font-bold text-ink">Ringkasan {tanggal}</h3>
          {[
            ["Rute draft", draftCount],
            ["Rute diterbitkan", publishedCount],
            ["Total stop terjadwal", totalStopSemuaRute],
            ["Total unit terjadwal", totalUnitSemuaRute],
            ["Job belum masuk rute", unrouted?.length ?? 0],
          ].map(([label, value]) => (
            <div key={label} className="border-b border-line pb-2 last:border-b-0">
              <div className="dh-figure text-[22px] font-extrabold leading-none tracking-tight text-ink">{value}</div>
              <div className="mt-1 text-[11px] text-ink3">{label}</div>
            </div>
          ))}
        </aside>
      </div>
    </PageContainer>
  );
}
