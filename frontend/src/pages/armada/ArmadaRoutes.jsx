import React, { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import { makeRange, toApiParams, formatRangeText } from "@/lib/dateRange.js";
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
  // Rentang tampilan (D-063, 4 September 2026) — SEBELUMNYA satu tanggal
  // terkunci (DatePicker biasa), laporan owner: "tampilan awal rute planner
  // buat semua tanggal, baru kalo mau di-customize tanggal bisa, buat
  // skemanya seperti tanggal CRM" (DateRangePicker yang sama dipakai
  // Dashboard/Laporan/Orders.jsx — lib/dateRange.js, SATU sumber kebenaran
  // skema tanggal lintas app, bukan komponen tanggal baru). Default
  // "all_time" ("Semua") — toApiParams() mengembalikan {} untuk preset ini,
  // yang berarti TANPA filter tanggal ke backend, persis "tampilkan semua".
  //
  // Tanggal rute baru (D-067, 4 September 2026 — koreksi dari D-063) — laporan
  // owner: dua kontrol tanggal berdampingan di header ("Semua waktu" DAN
  // "4 Sep 2026") terlihat dobel/membingungkan, padahal cuma satu yang
  // dipakai orang tiap hari. DatePicker terpisah untuk "tanggal rute baru"
  // DIHAPUS — bukan berarti konsepnya salah (route memang selalu menempel ke
  // SATU tanggal pasti), cuma tidak perlu kontrol sendiri yang selalu
  // terlihat untuk kasus yang jarang: kalau `range` sedang menampilkan
  // SATU hari spesifik, itulah yang dipakai untuk rute baru (paling masuk
  // akal — dispatcher yang sedang melihat tanggal tertentu paling mungkin
  // mau bikin rute untuk tanggal itu); selain itu (rentang/"Semua waktu")
  // default ke HARI INI, kasus paling umum dispatcher buka halaman ini.
  const [range, setRange] = useState(() => makeRange("all_time"));
  const tanggalRuteBaru = (range.from && range.from === range.to) ? range.from : todayISO();
  const [routes, setRoutes] = useState(null);
  const [unrouted, setUnrouted] = useState(null);
  // Backlog TANPA tanggal sama sekali (D-062, 4 September 2026 — laporan
  // owner: "di Jadwal & Penugasan banyak order yang belum dijadwalkan dan
  // belum masuk rute", tapi panel "Belum Masuk Rute" selalu kosong). Beda
  // dari `unrouted` — ini TIDAK terikat `tanggal` yang lagi dibuka sama
  // sekali (query date=none), jadi tidak ikut berubah tiap ganti tanggal;
  // dimuat sekali di `load()` yang sama supaya tetap 1 titik pemuatan data.
  const [undated, setUndated] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  // helpers (D-077, 4 September 2026) — Route sekarang punya helperId
  // sendiri (dulu cuma driver+kendaraan di sini, helper wajib diisi
  // manual per-job di Penjadwalan). Lihat komentar panjang di
  // schema.prisma (Route.helperId) untuk alasan penyatuan skema ini.
  const [helpers, setHelpers] = useState([]);
  const [error, setError] = useState("");
  const [draggingJobId, setDraggingJobId] = useState(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const rangeParams = toApiParams(range); // {} untuk "Semua" — tanpa filter tanggal
      const [routesRes, jobsRes, undatedRes, driversRes, vehiclesRes, helpersRes] = await Promise.all([
        api.getRoutes(rangeParams),
        // Panel kiri (D-066, koreksi dari D-063; `date: "any"` ditambah
        // D-069, 4 September 2026) — SENGAJA LEPAS TOTAL dari `range`, bukan
        // cuma default "Semua" yang kebetulan tidak memfilter. Laporan owner:
        // pilih rentang tanggal 4 Sep di atas membuat panel ini kosong
        // padahal ada job tanggal 2 Sep yang justru MAU dimasukkan ke rute
        // tanggal 4 — dispatcher perlu bisa mencampur job dari hari mana pun
        // ke rute hari apa pun.
        //
        // ⚠️ BUG NYATA (D-069) yang diperbaiki: `date: "any"` DITAMBAHKAN —
        // sebelumnya TIDAK ADA parameter tanggal sama sekali di sini, yang
        // berarti backend mengembalikan job TANPA tanggal (backlog lama,
        // termasuk job COMPLETED lawas) SEKALIGUS job BERTANGGAL, dua-duanya
        // ikut memperebutkan jatah `take` yang sama. Diverifikasi langsung ke
        // production: 512 job routeId=null TANPA tanggal vs cuma 11 job
        // routeId=null BERTANGGAL — dengan urutan `scheduledDate desc`,
        // hampir semua job bertanggal (10 dari 11) kepotong dari hasil,
        // padahal `take` sudah 500. Menaikkan `take` lagi cuma menunda
        // gejalanya (jumlah job tanpa tanggal terus bertambah seiring
        // waktu) — perbaikan sesungguhnya di level query (lihat
        // routes/armada.js): `date=any` memfilter scheduledDate BUKAN null
        // di DATABASE, jadi job tanpa tanggal tidak lagi ikut bersaing sama
        // sekali, bukan cuma diberi jatah lebih besar.
        api.getArmadaJobs({ routeId: "none", date: "any", take: 500 }),
        // Backlog tanpa tanggal — TIDAK bisa langsung diseret ke rute (rute
        // sudah pasti-tanggal, job tanpa tanggal butuh diisi dulu di Jadwal
        // & Penugasan), jadi ini murni pengingat/daftar, bukan drag source.
        api.getArmadaJobs({ date: "none", routeId: "none" }),
        api.getDrivers(),
        api.getVehicles(),
        api.getHelpers(),
      ]);
      setRoutes(routesRes.routes);
      // KOREKSI (hari yang sama, D-063) — saat range="Semua" (all_time),
      // rangeParams jadi {} (tanpa filter tanggal SAMA SEKALI ke backend),
      // yang berarti GET /armada/jobs tanpa `date`/`from`/`to` mengembalikan
      // job BERTANGGAL *dan* job TANPA TANGGAL sekaligus — dua-duanya lolos
      // filter status di bawah, jadi job undated ikut nyasar ke daftar
      // draggable ini (dobel dengan banner "belum ada tanggal" di
      // UnroutedJobsPanel). Job tanpa scheduledDate WAJIB dikeluarkan dari
      // sini — itu memang bukan drag source (keputusan: job harus dikasih
      // tanggal dulu sebelum bisa masuk rute), backlog-nya sudah ditangani
      // terpisah lewat `undated` di bawah.
      setUnrouted(jobsRes.jobs.filter((j) => j.scheduledDate != null && !["COMPLETED", "FAILED"].includes(j.status)));
      setUndated(undatedRes.jobs.filter((j) => !["COMPLETED", "FAILED"].includes(j.status)));
      setDrivers(driversRes);
      setVehicles(vehiclesRes.vehicles);
      setHelpers(helpersRes || []);
    } catch (e) {
      setError(e.message);
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  async function buatRute() {
    try {
      await api.createRoute({ date: tanggalRuteBaru });
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

  // Bulk add (D-058) DIHAPUS (D-068, 4 September 2026) — laporan owner:
  // drag-and-drop saja sudah cukup, jalur checkbox+dropdown+tombol
  // "Tambahkan" cuma nambah langkah untuk hal yang bisa langsung diseret.
  // Setiap job sekarang HANYA draggable ke RouteCard mana pun yang masih
  // DRAFT (guard `isDraft` di RouteCard.jsx sendiri) — lihat
  // UnroutedJobsPanel.jsx untuk detailnya.

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

  // Hapus permanen (D-059, 4 September 2026) — laporan owner: rute draft
  // salah pilih/coba-coba selama ini cuma bisa "Batalkan" (tetap tersimpan
  // selamanya sebagai riwayat) — tidak ada cara membuangnya benar-benar.
  // HANYA untuk DRAFT (ditegakkan juga di backend) — job di dalamnya
  // otomatis balik ke "Belum Masuk Rute", TIDAK ikut terhapus.
  async function hapusRute(route) {
    if (!confirm(`Hapus rute ${route.code} secara PERMANEN? ${route.jobs?.length ? `${route.jobs.length} job di dalamnya akan kembali ke "Belum Masuk Rute", tidak ikut terhapus.` : "Tindakan ini tidak bisa dibatalkan."}`)) return;
    try {
      await api.deleteRoute(route.id);
      await load();
    } catch (e) {
      alert("Gagal menghapus rute: " + e.message);
    }
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
            {/* Rentang TAMPILAN (lihat catatan panjang di state `range` di
                atas) — default "Semua", bisa di-custom ke satu
                hari/rentang tertentu lewat picker yang sama dengan
                Dashboard/Laporan. */}
            <DateRangePicker value={range} onChange={setRange} />
            {/* Tombol "Buat Rute" memakai `tanggalRuteBaru` (turunan dari
                `range`, lihat catatan di state-nya) — TANPA kontrol tanggal
                kedua yang selalu terlihat (D-067, dihapus karena dobel
                dengan picker di atas). */}
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
      {/* 2 kolom (D-057, 4 September 2026) — SEBELUMNYA 3 kolom (kiri 240px
          + tengah + kanan 240px "Ringkasan"). Laporan owner setelah melihat
          "Ringkasan" jadi kartu KPI besar (D-055): terlalu makan tempat
          untuk info yang sebenarnya cukup ringkas, dan lebih masuk akal
          bergabung dengan panel "Belum Masuk Rute" (satu-satunya panel di
          kolom kiri) daripada berdiri sendiri sebagai kolom ke-3. Sengaja
          TIDAK dipindah ke Dashboard — metrik di sini (rute draft/
          diterbitkan, stop, unit) mengukur KELENGKAPAN PERENCANAAN RUTE pada
          tanggal yang sedang dibuka, beda dari KPI Dashboard yang mengukur
          status JOB (bukan rute) lintas hari ini; menaruhnya di Dashboard
          justru mencampur dua ukuran yang berbeda. */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[240px_minmax(0,1fr)]">
        {/* Kiri — Ringkasan (kecil) + Belum Masuk Rute, ditumpuk dalam SATU
            kolom yang tingginya dikunci (xl:h-[calc(100vh-220px)]);
            Ringkasan `shrink-0` (tinggi tetap secukupnya), panel job
            `flex-1 min-h-0` mengambil SISA tinggi supaya scroll internalnya
            (sudah ada di UnroutedJobsPanel) tetap berfungsi seperti semula. */}
        <div className="flex flex-col gap-3 xl:h-[calc(100vh-220px)]">
          {/* Ringkasan — dikecilkan drastis (D-057): baris label+angka
              SATU BARIS (bukan kartu KPI terpisah per angka seperti D-055),
              supaya total tingginya ~seperlima dari sebelumnya dan pantas
              duduk di atas panel job tanpa mendominasi kolom sempit 240px. */}
          <div className="shrink-0 space-y-1 rounded-card border border-border bg-surface p-2.5">
            <h3 className="text-[11px] font-bold text-ink">Ringkasan {formatRangeText(range)}</h3>
            {[
              ["Rute draft", draftCount],
              ["Rute diterbitkan", publishedCount],
              ["Total stop terjadwal", totalStopSemuaRute],
              ["Total unit terjadwal", totalUnitSemuaRute],
              // (semua tanggal) — beda dari 3 baris di atasnya: baris ini
              // TIDAK ikut `range` (lihat catatan panjang di load(), D-066),
              // jadi labelnya ditegaskan supaya tidak terbaca seolah ikut
              // rentang yang sedang dibuka.
              ["Job belum masuk rute (semua tanggal)", unrouted?.length ?? 0],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate text-ink3">{label}</span>
                <strong className="shrink-0 tabular-nums text-ink">{value}</strong>
              </div>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            <UnroutedJobsPanel
              jobs={unrouted || []}
              undatedJobs={undated || []}
              loading={loading}
              draggingId={draggingJobId}
              onDragStart={(j) => setDraggingJobId(j.id)}
              onDragEnd={() => setDraggingJobId(null)}
            />
          </div>
        </div>

        {/* Tengah — papan rute */}
        <div className="min-w-0">
          <RouteMap routes={routes} />
          <div className="mt-3">
            {/* Grid turun ke bawah (D-060, 4 September 2026) — SEBELUMNYA
                flex + overflow-x-auto (kartu berjejer ke samping, digulir
                horizontal). Laporan owner: "kalau banyak rute" mode itu
                bikin sebagian kartu ketutup/harus digeser terus — pola
                "Papan" (Jadwal & Penugasan, Armada.jsx) sudah lebih dulu
                pakai grid yang membungkus ke baris baru begitu penuh, dan
                itu yang diminta ditiru di sini juga. RouteCard.jsx ikut
                diubah (w-full menggantikan w-[300px] shrink-0, lihat
                catatan di sana) supaya lebarnya mengikuti kolom grid, bukan
                lebar tetap yang cuma masuk akal dalam baris horizontal. */}
            {loading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {[1, 2].map((i) => <div key={i} className="h-64 animate-pulse rounded-card bg-inset" />)}
              </div>
            ) : routes.length === 0 ? (
              <EmptyState
                title="Belum ada rute pada rentang ini"
                description="Buat rute lalu seret job dari panel kiri ke dalamnya."
                action={<Button size="sm" onClick={buatRute}><Plus size={14} /> Buat Rute</Button>}
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {routes.map((r) => (
                  <RouteCard
                    key={r.id}
                    route={r}
                    drivers={drivers}
                    vehicles={vehicles}
                    helpers={helpers}
                    draggingJobId={draggingJobId}
                    onDrop={tambahKeRute}
                    onReorder={urutkanUlang}
                    onRemoveJob={keluarkanDariRute}
                    onAssign={ubahPenugasan}
                    onPublish={terbitkan}
                    onCancel={batalkan}
                    onDelete={hapusRute}
                    onOptimize={urutkanOtomatis}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
