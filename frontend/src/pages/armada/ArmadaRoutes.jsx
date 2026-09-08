import React, { useState } from "react";
import { Plus, X, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import { makeRange, toApiParams, todayWIB } from "@/lib/dateRange.js";
import UnroutedJobsPanel from "@/features/armada/components/UnroutedJobsPanel.jsx";
import RouteCard from "@/features/armada/components/RouteCard.jsx";
import RouteMap from "@/features/armada/components/RouteMap.jsx";
import JobDetailDrawer from "@/features/armada/components/JobDetailDrawer.jsx";
import { useArmadaRoutesBoard } from "@/features/armada/hooks/useArmadaRoutesBoard.js";

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
  // Pilih tanggal saat "Buat Rute" (revisi Sep 2026, membalik D-067 di atas
  // — laporan owner: dispatcher tetap perlu bisa MEMILIH tanggal rute baru,
  // bukan cuma menerima turunan diam-diam dari filter tampilan). SENGAJA
  // TIDAK mengembalikan kontrol tanggal KEDUA yang selalu terlihat di
  // header (itu keluhan asli D-067) — DatePicker di sini cuma muncul
  // SEMENTARA, tepat saat tombol "Buat Rute" diklik, lalu hilang lagi
  // setelah rute jadi/dibatalkan. `null` = tidak sedang membuat rute.
  const [tanggalBaru, setTanggalBaru] = useState(null);
  const [membuatRute, setMembuatRute] = useState(false);
  // Klik 1x kartu job (redesain Sep 2026 — laporan owner: sistemnya cuma
  // drag-and-drop, minta klik satu kali buka detail order langsung dari
  // sini). REUSE JobDetailDrawer.jsx apa adanya — komponen yang sama sudah
  // dipakai Jadwal & Penugasan (ArmadaJobs.jsx), sudah mendukung ubah
  // status, ubah alamat, dan link Google Maps; tidak ada drawer baru yang
  // dibangun di sini. `null` = tertutup.
  const [openJobId, setOpenJobId] = useState(null);
  const [draggingJobId, setDraggingJobId] = useState(null);

  // Data (6 fetch paralel: rute, job belum-masuk-rute, job belum
  // bertanggal, driver, kendaraan, helper) lewat TanStack Query (8
  // September 2026, laporan owner: "optimalkan agar lebih smooth, fast,
  // enteng" — lihat catatan panjang di useArmadaRoutesBoard.js). Filter
  // client-side (buang COMPLETED/FAILED, pisahkan undated) TETAP PERSIS
  // logic lama, cuma pindah rumah ke dalam hook — komentar panjang D-062/
  // D-063/D-069 soal ALASAN tiap baris filter ada di sana, tidak diulang
  // di sini. `board` fallback objek kosong supaya destructuring di bawah
  // aman sebelum fetch pertama selesai (react-query `data` awalnya
  // `undefined`, beda dari `useState(null)` versi lama — efeknya SAMA,
  // field individual tetap `undefined` sampai data datang).
  const { data: board, error: queryError, refetch: load } = useArmadaRoutesBoard(range, toApiParams);
  const { routes, unrouted, undated, drivers = [], vehicles = [], helpers = [] } = board || {};
  const error = queryError?.message || "";

  // Buka jalur pilih-tanggal (bukan langsung buat) — default ke
  // tanggalRuteBaru (turunan filter) supaya kasus paling umum (dispatcher
  // sedang melihat satu tanggal spesifik) tetap tinggal klik "Buat", tapi
  // sekarang BISA diubah dulu sebelum konfirmasi.
  function mulaiBuatRute() {
    setTanggalBaru(tanggalRuteBaru);
  }

  async function konfirmasiBuatRute() {
    if (!tanggalBaru) return;
    setMembuatRute(true);
    try {
      await api.createRoute({ date: tanggalBaru });
      setTanggalBaru(null);
      await load();
    } catch (e) {
      alert("Gagal membuat rute: " + e.message);
    } finally {
      setMembuatRute(false);
    }
  }

  // Susun ulang anggota SATU rute lalu kirim daftar LENGKAP hasil akhirnya —
  // pola yang sama dengan PATCH /route/reorder yang sudah ada di Papan.
  // `reason` (redesain Sep 2026) — cuma terisi kalau RouteCard SEDANG dalam
  // sesi edit darurat rute PUBLISHED (lihat editingReason di sana);
  // undefined untuk rute DRAFT biasa, backend PATCH /routes/:id/jobs
  // mengabaikannya kalau tidak PUBLISHED.
  async function terapkanUrutan(route, jobIdsBaru, reason) {
    await api.setRouteJobs(route.id, jobIdsBaru, reason);
    await load();
  }

  async function tambahKeRute(route, jobId, index, reason) {
    const idsSaatIni = (route.jobs || []).slice().sort((a, b) => (a.sequence || 0) - (b.sequence || 0)).map((j) => j.id);
    const idsBaru = [...idsSaatIni];
    idsBaru.splice(index, 0, jobId);
    await terapkanUrutan(route, idsBaru, reason);
  }

  // Bulk add (D-058) DIHAPUS (D-068, 4 September 2026) — laporan owner:
  // drag-and-drop saja sudah cukup, jalur checkbox+dropdown+tombol
  // "Tambahkan" cuma nambah langkah untuk hal yang bisa langsung diseret.
  // Setiap job sekarang HANYA draggable ke RouteCard mana pun yang masih
  // DRAFT (guard `isDraft` di RouteCard.jsx sendiri) — lihat
  // UnroutedJobsPanel.jsx untuk detailnya.

  async function urutkanUlang(route, jobId, indexBaru, reason) {
    const idsSaatIni = (route.jobs || []).slice().sort((a, b) => (a.sequence || 0) - (b.sequence || 0)).map((j) => j.id);
    const tanpaJobIni = idsSaatIni.filter((id) => id !== jobId);
    tanpaJobIni.splice(indexBaru, 0, jobId);
    await terapkanUrutan(route, tanpaJobIni, reason);
  }

  async function keluarkanDariRute(route, jobId, reason) {
    const idsBaru = (route.jobs || []).filter((j) => j.id !== jobId).sort((a, b) => (a.sequence || 0) - (b.sequence || 0)).map((j) => j.id);
    await terapkanUrutan(route, idsBaru, reason);
  }

  async function ubahPenugasan(route, patch, reason) {
    await api.updateRoute(route.id, reason ? { ...patch, reason } : patch);
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

  // totalStopSemuaRute/totalUnitSemuaRute/draftCount/publishedCount DIHAPUS
  // (8 September 2026, laporan owner: "delete ringkasan di route planner")
  // — SEBELUMNYA cuma dipakai kartu "Ringkasan" yang sekarang juga dihapus
  // (lihat kolom kiri di bawah), supaya panel "Belum Masuk Rute" dapat
  // ruang vertikal lebih (kartunya sendiri sekarang lebih tinggi sejak
  // redesain 8 September, "gabisa buat lebih panjang kebawah").

  const loading = routes == null;

  return (
    // style={{maxWidth}} INLINE, BUKAN class Tailwind max-w-[1800px] —
    // ditemukan lewat laporan owner sendiri (screenshot monitor ultrawide
    // 3434px: konten tetap mepet penuh ke kanan-kiri, TIDAK ke-tengah sama
    // sekali walau class sudah dipasang). Dicek byte-exact ke CSS hasil
    // build: class arbitrary `max-w-[1800px]` TIDAK ter-compile — dan
    // ternyata `max-w-[1400px]` DEFAULT PageContainer sendiri (components/
    // ui/page.jsx) JUGA tidak pernah ter-compile, dari AWAL, di SEMUA
    // halaman lain yang memakai PageContainer, bukan cuma di sini. Ini
    // temuan baru, pola yang SAMA dengan bug "utility warna kustom kadang
    // tidak ter-generate" di CLAUDE.md §3 — cuma sekarang terbukti juga
    // kejadian di utility UKURAN (max-w-[Npx]), bukan cuma warna. `style`
    // inline SELALU menang atas class apa pun (compile atau tidak), jadi
    // ini perbaikan yang pasti bekerja, bukan tebakan class lain yang
    // belum tentu nasibnya beda. PageContainer men-spread `...props` ke
    // div-nya sendiri, jadi `style` di sini diteruskan apa adanya.
    <PageContainer style={{ maxWidth: "1800px" }}>
      <PageHeader
        title="Route Planner"
        subtitle="Kelompokkan job ke dalam rute, atur urutan stop, dan tetapkan driver."
        actions={
          <>
            {/* Rentang TAMPILAN (lihat catatan panjang di state `range` di
                atas) — default "Semua", bisa di-custom ke satu
                hari/rentang tertentu lewat picker yang sama dengan
                Dashboard/Laporan.
                `maxDate` (8 September 2026, laporan owner: "date picker di
                rute planner gabisa klik tanggal kedepan") — DateRangePicker
                SEBELUMNYA selalu mengunci ke hari ini (masuk akal untuk
                Laporan, TIDAK masuk akal di sini: dispatcher justru perlu
                menjadwalkan rute UNTUK minggu/bulan depan). +2 tahun
                praktis "tanpa batas" untuk kebutuhan penjadwalan nyata,
                tanpa perlu ubah CalendarMonth jadi terima "tanpa batas
                sama sekali". */}
            <DateRangePicker value={range} onChange={setRange} maxDate={todayWIB().add(2, "year").format("YYYY-MM-DD")} />
            {/* "Buat Rute" sekarang 2 langkah (revisi Sep 2026, lihat catatan
                panjang di state tanggalBaru) — klik pertama membuka
                DatePicker (default tanggalRuteBaru, BISA diubah), klik
                "Buat" mengonfirmasi. TIDAK ada kontrol tanggal kedua yang
                SELALU terlihat — cuma muncul sesaat saat memang sedang
                membuat rute, jadi tidak mengulang keluhan D-067 ("dua
                kontrol tanggal berdampingan terlihat dobel"). */}
            {tanggalBaru != null ? (
              <>
                <DatePicker value={tanggalBaru} onChange={setTanggalBaru} placeholder="Pilih tanggal" />
                <Button size="sm" onClick={konfirmasiBuatRute} disabled={membuatRute || !tanggalBaru}>
                  {membuatRute ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Buat
                </Button>
                <button
                  type="button"
                  onClick={() => setTanggalBaru(null)}
                  disabled={membuatRute}
                  aria-label="Batalkan buat rute"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink3 transition-colors hover:bg-hovertint disabled:opacity-40"
                >
                  <X size={14} />
                </button>
              </>
            ) : (
              <Button size="sm" onClick={mulaiBuatRute}><Plus size={14} /> Buat Rute</Button>
            )}
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
      {/* 300px (revisi Sep 2026, dari 240px) — laporan owner: panel "Belum
          Masuk Rute" terasa sempit, badge tipe/kota/tanggal di tiap kartu
          job sering membungkus tidak rapi di lebar sekian. */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[300px_minmax(0,1fr)]">
        {/* Kiri — Ringkasan (kecil) + Belum Masuk Rute, ditumpuk dalam SATU
            kolom yang tingginya dikunci (xl:h-[calc(100vh-Npx)]);
            Ringkasan `shrink-0` (tinggi tetap secukupnya), panel job
            `flex-1 min-h-0` mengambil SISA tinggi supaya scroll internalnya
            (sudah ada di UnroutedJobsPanel) tetap berfungsi seperti semula.
            Offset DIKURANGI LAGI 170px -> 120px (8 September 2026, laporan
            owner: "gabisa buat lebih panjang kebawah" — kartu job di panel
            ini sekarang lebih tinggi [redesain 8 Sep, 8 baris info per
            kartu] daripada waktu 170px dipatok, jadi kartu yang kelihatan
            tanpa scroll berkurang walau tinggi PANEL-nya sama. 120px masih
            aman (PageHeader+DateRangePicker+padding di atas grid ini
            nyatanya tidak sampai segitu), panel jadi lebih tinggi lagi. */}
        <div className="flex flex-col gap-3 xl:h-[calc(100vh-120px)]">
          {/* Kartu "Ringkasan" DIHAPUS (8 September 2026, laporan owner:
              "delete ringkasan di route planner") — 5 baris angka
              (draft/diterbitkan/stop/unit/belum masuk rute) yang
              sebelumnya duduk di atas panel ini. Panel "Belum Masuk Rute"
              sekarang langsung mengisi SELURUH tinggi kolom kiri
              (`min-h-0 flex-1` di bawah TIDAK BERUBAH — dulu berbagi
              ruang dengan kartu Ringkasan yang `shrink-0`, sekarang tidak
              ada lagi yang direbut). */}
          <div className="min-h-0 flex-1">
            <UnroutedJobsPanel
              jobs={unrouted || []}
              undatedJobs={undated || []}
              loading={loading}
              draggingId={draggingJobId}
              onDragStart={(j) => setDraggingJobId(j.id)}
              onDragEnd={() => setDraggingJobId(null)}
              onOpenJob={setOpenJobId}
              // Tombol "Masukkan ke Rute" (8 September 2026, laporan owner —
              // lihat catatan panjang di TombolMasukkanKeRute,
              // UnroutedJobsPanel.jsx) — pelengkap drag-and-drop untuk rute
              // yang panjang ke bawah, reuse tambahKeRute() yang SAMA dengan
              // onDrop RouteCard, masuk di urutan PALING BAWAH rute tujuan.
              routes={routes || []}
              onAssignToRoute={(job, route) => tambahKeRute(route, job.id, (route.jobs || []).length)}
            />
          </div>
        </div>

        {/* Tengah — papan rute */}
        <div className="min-w-0">
          {/* Riwayat filter peta: DRAFT saja (6 Sep) -> semua selain
              CANCELLED (8 Sep, "aktifnya Google Maps API memudahkan
              semua") -> SEKARANG selain CANCELLED & COMPLETED (8 Sep,
              laporan owner lanjutan: "rute yang statusnya sudah selesai
              gaperlu muncul lagi, fokus ke rute yang masih aktif") —
              dicatat supaya tidak bolak-balik tanpa alasan kalau ada
              laporan lagi nanti. Rute COMPLETED sudah tuntas dikerjakan,
              garis jalurnya di peta cuma menambah keramaian visual tanpa
              informasi baru yang perlu dipantau dispatcher HARI INI — beda
              dari DRAFT/PUBLISHED yang masih perlu direncanakan/dipantau
              aktif. Kartu rute di bawah TETAP menampilkan semua status apa
              adanya, filter ini cuma soal apa yang IKUT DIGAMBAR di peta atas. */}
          <RouteMap routes={(routes || []).filter((r) => !["CANCELLED", "COMPLETED"].includes(r.status))} />
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
              // Maks 2 kolom (8 September 2026, laporan owner: "buat jadi 2
              // card aja deh" — turun dari 3, yang sebelumnya sudah turun
              // dari 4 di revisi Sep 2026 dengan alasan sama: kartu makin
              // banyak isi [badge tipe/Sewa/Tanpa link Maps, catatan rute,
              // tombol Buat Peta, DAN sejak D-08Sep stop di dalamnya sendiri
              // jadi grid 2 kolom, lihat RouteCard.jsx] jadi butuh lebar
              // lebih, bukan lebih sempit. lg:grid-cols-2 berlaku untuk
              // SEMUA layar ≥1024px (breakpoint Tailwind min-width, tidak
              // naik lagi di xl/2xl kalau tidak ada override di atasnya).
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[1, 2].map((i) => <div key={i} className="h-64 animate-pulse rounded-card bg-inset" />)}
              </div>
            ) : routes.length === 0 ? (
              <EmptyState
                title="Belum ada rute pada rentang ini"
                description="Buat rute lalu seret job dari panel kiri ke dalamnya."
                action={<Button size="sm" onClick={mulaiBuatRute}><Plus size={14} /> Buat Rute</Button>}
              />
            ) : (
              // Maks 2 kolom — lihat catatan panjang di skeleton loading di atas.
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    onOpenJob={setOpenJobId}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <JobDetailDrawer jobId={openJobId} onClose={() => setOpenJobId(null)} onChanged={load} />
    </PageContainer>
  );
}
