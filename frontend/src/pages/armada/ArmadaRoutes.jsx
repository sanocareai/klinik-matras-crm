import React, { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import UnroutedJobsPanel from "@/features/armada/components/UnroutedJobsPanel.jsx";
import RouteCard from "@/features/armada/components/RouteCard.jsx";
import RouteMapPlaceholder from "@/features/armada/components/RouteMapPlaceholder.jsx";
import { unitCountOf } from "@/features/armada/jobStatus.js";

// Route Planner — Delivery Tahap 3.
//
// DATA NYATA (endpoint Tahap 3: /armada/routes, /armada/vehicles). Tidak ada
// badge "Contoh" — inilah alasan Vehicle/Route ditambahkan ke skema di awal
// Tahap 3, supaya halaman ini tidak perlu ditulis ulang begitu data sungguhan
// tersedia.
//
// TIGA PANEL sesuai spesifikasi: kiri = job belum masuk rute, tengah = papan
// rute (drag-drop, bukan peta — placeholder profesional dipasang, lihat
// RouteMapPlaceholder.jsx untuk kenapa), kanan = ringkasan tanggal terpilih.
//
// "Optimize Route" (per instruksi eksplisit "untuk versi dummy... jangan
// pakai API Google Maps"): mengurutkan ulang stop berdasarkan timeWindow lalu
// alamat — pengurutan sederhana, BUKAN algoritma VRP. PRD §1.5 melarang
// optimasi rute otomatis sungguhan untuk v1.
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
            <label className="sr-only" htmlFor="rp-tanggal">Tanggal</label>
            <input
              id="rp-tanggal"
              type="date"
              value={tanggal}
              onChange={(e) => setTanggal(e.target.value)}
              className="h-9 rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-accent"
            />
            <Button size="sm" onClick={buatRute}><Plus size={14} /> Buat Rute</Button>
          </>
        }
      />

      {error && <div className="mb-3 rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[240px_minmax(0,1fr)_240px]">
        {/* Kiri */}
        <div className="lg:h-[calc(100vh-220px)]">
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
          <RouteMapPlaceholder stopCount={totalStopSemuaRute} />
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

        {/* Kanan — ringkasan */}
        <aside className="space-y-2 rounded-card border border-border bg-surface p-3 lg:h-[calc(100vh-220px)] lg:overflow-y-auto">
          <h3 className="text-[12.5px] font-bold text-ink">Ringkasan {tanggal}</h3>
          {[
            ["Rute draft", draftCount],
            ["Rute diterbitkan", publishedCount],
            ["Total stop terjadwal", totalStopSemuaRute],
            ["Total unit terjadwal", totalUnitSemuaRute],
            ["Job belum masuk rute", unrouted?.length ?? 0],
          ].map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between border-b border-line py-1.5 last:border-b-0">
              <span className="text-[11.5px] text-ink2">{label}</span>
              <strong className="text-[14px] font-bold tabular-nums text-ink">{value}</strong>
            </div>
          ))}
        </aside>
      </div>
    </PageContainer>
  );
}
