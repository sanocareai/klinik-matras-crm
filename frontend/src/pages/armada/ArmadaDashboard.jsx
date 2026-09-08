import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Plus, AlertTriangle, Truck as TruckIcon, Package, CalendarClock, Search, UserPlus, ChevronDown,
  Navigation, CheckCircle2, Users, History, ChevronRight, X, ShieldCheck, Activity,
} from "lucide-react";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Card } from "@/components/ui/card.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import { makeRange, toApiParams, formatRangeText } from "@/lib/dateRange.js";
import {
  TableSkeletonRows,
} from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import { cn } from "@/lib/utils.js";
import Avatar from "@/components/Avatar.jsx";
import DashboardSnapshot from "@/features/armada/components/DashboardSnapshot.jsx";
import StatusBadge from "@/features/armada/components/StatusBadge.jsx";
import { productSummary } from "@/features/inbox/components/CustomerPanel/orderSummary.js";
import { toWIB, formatRelatif } from "@/utils/formatDate.js";
import {
  JOB_STATUS_REAL, JOB_TYPE_REAL, ACTIVE_STATUSES, customerOf, orderNumberOf, orderOf, cityOf,
  confirmedDateOf, isJobOverdue, overdueDays, salesLocationUrl,
} from "@/features/armada/jobStatus.js";
import { VEHICLE_STATUS_REAL } from "@/features/armada/vehicleStatus.js";
import { useArmadaDashboardBoard } from "@/features/armada/hooks/useArmadaDashboardBoard.js";
import { useArmadaTracking } from "@/features/armada/hooks/useArmadaTracking.js";

const TAMPIL_AWAL = 8;

// Sudah menunggu berapa lama sejak job ini lahir (auto-buat begitu sales
// input order, lihat armadaAutoJob.js) — dipakai untuk urutan prioritas
// visual, bukan cuma angka dekoratif: makin lama menunggu, makin
// mendesak ditugaskan.
function hariMenunggu(createdAt) {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
}

// Jarak garis lurus (haversine, km) — POLA SAMA dengan
// backend/src/services/maps.js#haversineMeters, dipakai di sini untuk
// perkiraan sisa jarak driver EN_ROUTE ke titik tujuan (Active Operations,
// lihat catatan panjang di bawah). BUKAN jarak jalan sungguhan — makanya
// SELALU dilabeli "≈" di UI, tidak pernah ditampilkan sebagai angka pasti.
function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// Dropdown "Tugaskan" — 1 tombol ringkas per baris, chip driver baru
// muncul saat diklik (Radix DropdownMenu, sudah dipakai di tempat lain
// di app ini — bukan library baru). Mengganti 4 chip yang SELALU
// tampil di tiap baris (temuan user 31 Agustus 2026: 50 order x 5 chip
// = ratusan tombol kelihatan sekaligus, "numpuk").
//
// Helper opsional (D-037, 31 Agustus 2026 — laporan owner: dropdown ini
// cuma bisa pilih 1 orang). Klik nama driver LANGSUNG menugaskan (jalur
// cepat, tanpa helper — mayoritas job memang tidak butuh helper), TAPI
// tiap driver juga punya submenu (>) untuk sekalian pilih helper kalau
// perlu, supaya tetap bisa selesai tanpa buka JobDetailDrawer.
function TugaskanDropdown({ drivers, helpers, busy, onPick }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={busy}
          // data-[state=open] (D-050) — saat dropdown-nya terbuka tombol jadi
          // BIRU SOLID, bukan tetap ghost. Di daftar 8+ baris yang tombolnya
          // identik semua, tanpa ini tidak ada penanda visual baris mana yang
          // sedang dibuka: menu melayang di dekat kursor sementara semua
          // tombol tetap terlihat sama, dan salah-baris jadi mudah terjadi.
          className="btn-tugaskan group flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-inset px-3 text-[11.5px] font-semibold text-ink2 transition-colors hover:border-accent hover:bg-accentbg hover:text-accent disabled:opacity-50 data-[state=open]:border-accent data-[state=open]:bg-accent data-[state=open]:text-white"
          onClick={(e) => e.stopPropagation()}
        >
          <UserPlus size={12} /> Tugaskan
          {/* Ikut berputar 180° saat dropdown terbuka (D-050 lanjutan) —
              detail kecil di mockup: panah yang membalik jadi penanda kedua
              (selain warna tombol) bahwa menu ini SEDANG terbuka, bukan
              cuma dekorasi statis. `data-[state]` ada di TOMBOL (Radix
              menaruhnya di trigger asChild ini), bukan di ikon sendiri —
              makanya lewat `group-data-[state=open]:`, bukan
              `data-[state=open]:` langsung di ikon (yang tidak akan pernah
              cocok karena ikon ini bukan pemilik atribut itu). */}
          <ChevronDown size={11} className="text-ink3 transition-transform group-data-[state=open]:rotate-180 group-data-[state=open]:text-white/80" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end" sideOffset={6} onClick={(e) => e.stopPropagation()}
          className="z-50 min-w-[170px] rounded-btn border border-border bg-surface p-1.5 shadow-popover"
        >
          <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink3">
            Driver
          </p>
          {drivers.map((d) => (
            <DropdownMenu.Sub key={d.id}>
              <DropdownMenu.SubTrigger
                onClick={() => onPick(d.id)}
                className="flex cursor-pointer items-center gap-2 rounded-btn px-2 py-1.5 text-[12.5px] text-ink outline-none data-[highlighted]:bg-accentbg data-[state=open]:bg-accentbg"
              >
                <Avatar name={d.name} size="sm" gradient className="h-6 w-6 text-[10px]" />
                <span className="flex-1">{d.name}</span>
                <ChevronDown size={11} className="-rotate-90 text-ink3" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  sideOffset={4} onClick={(e) => e.stopPropagation()}
                  className="z-50 min-w-[170px] rounded-btn border border-border bg-surface p-1.5 shadow-popover"
                >
                  <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink3">
                    + Helper (opsional)
                  </p>
                  {helpers.map((h) => (
                    <DropdownMenu.Item
                      key={h.id}
                      onSelect={() => onPick(d.id, h.id)}
                      className="flex cursor-pointer items-center gap-2 rounded-btn px-2 py-1.5 text-[12.5px] text-ink outline-none data-[highlighted]:bg-hovertint"
                    >
                      <Avatar name={h.name} size="sm" gradient className="h-6 w-6 text-[10px]" />
                      {h.name}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// Baris pencarian kecil dipakai berulang di halaman ini (Perlu Dijadwalkan,
// Jadwal Hari Ini) — pola yang sama persis dengan UnroutedJobsPanel.jsx
// (Route Planner, 6 September 2026), disatukan di sini supaya tidak ditulis
// ulang 2x dengan kemungkinan drift kecil.
function KotakCari({ value, onChange, placeholder }) {
  return (
    <div className="relative ml-auto min-w-[180px] max-w-[240px] flex-1">
      <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-full border border-border bg-inset pl-8 pr-7 text-[12px] text-ink outline-none focus:border-accent"
      />
      {value && (
        <button
          type="button" onClick={() => onChange("")} aria-label="Hapus pencarian"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-ink3 hover:text-ink"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

// Dashboard Delivery & Fulfillment — "Control Tower" (7 September 2026,
// redesain penuh atas brief owner).
//
// MENGGANTIKAN versi KPI-dan-daftar (22 Agustus–6 September 2026, D-035
// dst). Filosofi lama tetap dipegang — DATA NYATA saja, tidak ada widget
// yang ditampilkan tanpa sumber nyata di belakangnya (lihat catatan
// "Aktivitas Terbaru SENGAJA DIHAPUS" versi lama) — tapi susunannya
// dirombak supaya halaman ini menjawab "apa yang sedang terjadi + apa yang
// butuh tindakan SEKARANG" dalam sekali pandang, bukan cuma laporan angka.
//
// Bagian yang SENGAJA TIDAK dibangun di redesain ini (brief sendiri minta
// jangan pura-pura ada kalau memang belum ada):
//   · Kartu rekomendasi "AI Next Dispatch Decision" — tidak ada AI/mesin
//     rekomendasi di backend, brief eksplisit bilang "hide the card" kalau
//     belum diimplementasi.
//   · ETA menit presisi — diganti estimasi JARAK (haversine) + kapan ping
//     GPS terakhir, dilabeli "≈", lihat haversineKm() di atas.
//   · Badge "Live"/WebSocket real-time — infrastrukturnya belum ada di
//     halaman ini (Socket.IO baru dipakai Inbox), tidak dikarang di sini.
//   · CTA "Hubungi Customer" kontekstual di antrean — draft awal brief
//     minta tombol WA/Inbox langsung dari baris antrean, tapi itu perlu
//     join Customer→Conversation yang belum ada di endpoint job manapun.
//     Dipangkas jadi tag informasi "Belum dikonfirmasi" saja (lihat
//     render baris Perlu Dijadwalkan) — CTA tetap TugaskanDropdown seperti
//     sebelumnya, sesuai jalur fallback yang memang direncanakan.
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Job yang SUDAH terjadwal (driver+tanggal, siap dirutekan) — dipakai untuk
// sinyal "belum ada link Maps" di Needs Attention (7 September 2026,
// investigasi "Buat Peta" di Route Planner "mental kemana-mana"). SENGAJA
// LEBIH SEMPIT dari ACTIVE_STATUSES (yang juga mencakup UNSCHEDULED) —
// job yang belum sempat dijadwalkan memang wajar belum punya link Maps,
// itu sudah tercakup kartu "Perlu Dijadwalkan" di atas. Yang benar-benar
// mendesak adalah job yang SUDAH mau dirutekan tapi koordinatnya masih
// hasil tebakan geocoding.
const ROUTING_IMMINENT_STATUSES = ["SCHEDULED", "ASSIGNED", "EN_ROUTE", "ARRIVED"];

// Dokumen yang kadaluarsa/mau habis (≤30 hari) — sinyal paling mendesak buat
// dispatcher, karena kendaraan dengan dokumen habis TIDAK BOLEH dioperasikan.
function dokumenBermasalah(vehicles) {
  const out = [];
  for (const v of vehicles) {
    for (const [label, tgl] of [
      ["STNK", v.stnkExpiry], ["Pajak", v.taxExpiry], ["KIR", v.kirExpiry], ["Asuransi", v.insuranceExpiry],
    ]) {
      if (!tgl) continue;
      const sisaHari = Math.floor((new Date(tgl) - new Date()) / 86400000);
      if (sisaHari <= 30) out.push({ vehicle: v, label, sisaHari, lewat: sisaHari < 0 });
    }
  }
  return out.sort((a, b) => a.sisaHari - b.sisaHari);
}

// Chip jam kunjungan dari Job.timeWindow ("Di atas jam 09.00" dst, lihat
// ESTIMASI_JAM_PRESET di jobStatus.js) — dipendekkan jadi "09.00" saja
// untuk agenda "Jadwal Hari Ini", teks aslinya sudah cukup terwakili
// karena SEMUA preset yang ada memang bermakna "di atas jam X".
function jamChip(timeWindow) {
  const m = /(\d{1,2}[.:]\d{2})/.exec(timeWindow || "");
  return m ? m[1] : null;
}

export default function ArmadaDashboard() {
  const navigate = useNavigate();
  // Date range picker (D-082/083, 5 September 2026 — lalu diubah lagi 7
  // September 2026 sebagai bagian redesain Control Tower).
  //
  // DEFAULT SEKARANG "Hari ini" (preset "today" di lib/dateRange.js), BUKAN
  // lagi "Semua" — keputusan sadar brief owner: dashboard operasional harus
  // langsung menjawab kondisi HARI INI begitu dibuka, "Semua" cuma masuk
  // akal untuk laporan historis (halaman Laporan tetap default "Semua",
  // TIDAK berubah). Preset "Semua" TETAP tersedia di picker, cuma bukan
  // default lagi — DateRangePicker.jsx sudah lama menampilkannya sebagai
  // salah satu SIMPLE_PRESETS satu-klik, tidak perlu perubahan di sana.
  //
  // scheduledDate saat quick-assign (tugaskanCepat di bawah) SENGAJA
  // TIDAK ikut mengambang bareng `range` — itu selalu HARI INI pasti
  // (todayISO() langsung, bukan diturunkan dari filter tampilan), sesuai
  // maksud aslinya di komentar tugaskanCepat: "job punya jadwal HARI INI".
  const [range, setRange] = useState(() => makeRange("today"));
  const [assigningId, setAssigningId] = useState(null);
  const [cariPerlu, setCariPerlu] = useState("");
  const [tampilSemua, setTampilSemua] = useState(false);
  const [cariJadwal, setCariJadwal] = useState("");

  // Data utama lewat TanStack Query (8 September 2026, laporan owner:
  // "optimalkan agar lebih smooth, fast, enteng" — lihat catatan panjang
  // di useArmadaDashboardBoard.js). `loading` dari `isLoading` bawaan,
  // BUKAN lagi flag manual — react-query yang tahu persis kapan fetch
  // pertama sedang berjalan.
  const { data: dashBoard, isLoading: loading, refetch: load } = useArmadaDashboardBoard(range, toApiParams);
  const { jobs, vehicles = [], unscheduled, drivers = [], helpers = [] } = dashBoard || {};

  // Posisi GPS terakhir tiap job EN_ROUTE (Active Operations di bawah) —
  // query TERPISAH dari data utama, sengaja (7 September 2026, brief
  // owner poin "loading/error state per widget": "a tracking-fetch failure
  // must not blank out the rest of the page") — reuse hook YANG SAMA
  // dipakai Live Tracking (useArmadaTracking.js), satu sumber data,
  // dua tempat pakai. `tracking` tetap `undefined` sesaat di awal (dulu
  // `null`) — sudah ditoleransi lewat `tracking || []` di pemakaiannya.
  const { data: tracking, error: trackingErr } = useArmadaTracking();
  const trackingError = Boolean(trackingErr);

  // Assign 1-tap langsung dari panel "Perlu Dijadwalkan" (D-036) — dispatcher
  // tidak perlu buka drawer sama sekali untuk kasus paling umum: ketuk
  // avatar driver, job langsung ASSIGNED (kalau kendaraan cuma 1, backend/
  // JobDetailDrawer auto-isi begitu drawer dibuka; di sini cukup driver+
  // tanggal hari ini supaya job punya jadwal, bukan cuma driver kosongan).
  //
  // BUG YANG DIPERBAIKI (ditemukan saat verifikasi visual 30 Agustus 2026):
  // ChipPilih juga punya opsi "kosong" (lepas driver, onPick(null)) — kalau
  // itu ikut menjadwalkan (scheduledDate diisi), job jadi SCHEDULED TANPA
  // driver dan hilang dari panel ini tanpa benar-benar tertugaskan. Guard
  // di bawah memastikan tanggal cuma diisi kalau memang ada driver dipilih.
  async function tugaskanCepat(jobId, driverId, helperId) {
    if (!driverId) return;
    setAssigningId(jobId);
    try {
      const patch = { driverId, scheduledDate: todayISO() };
      if (helperId) patch.helperId = helperId;
      await api.updateArmadaJob(jobId, patch);
      await load();
    } catch (e) {
      alert("Gagal menugaskan: " + e.message);
    } finally {
      setAssigningId(null);
    }
  }

  // ─── Turunan dasar dari `jobs` (rentang aktif, default Hari Ini) ─────────
  const pickupCount = useMemo(() => (jobs || []).filter((j) => j.type === "PICKUP").length, [jobs]);
  const deliveryCount = useMemo(() => (jobs || []).filter((j) => j.type === "DELIVERY").length, [jobs]);
  const completedCount = useMemo(() => (jobs || []).filter((j) => j.status === "COMPLETED").length, [jobs]);
  const driversActiveCount = useMemo(
    () => new Set((jobs || []).filter((j) => j.driverId).map((j) => j.driverId)).size,
    [jobs]
  );

  const dokIssues = useMemo(() => dokumenBermasalah(vehicles.filter((v) => v.active)), [vehicles]);
  // Job yang tanggal terjadwalnya SUDAH LEWAT tapi belum selesai — beda dari
  // panel "Perlu Dijadwalkan" (job yang BELUM PERNAH dapat tanggal sama
  // sekali). Lihat isJobOverdue() di jobStatus.js untuk definisi lengkap.
  const overdueJobs = useMemo(() => (jobs || []).filter(isJobOverdue).sort((a, b) => overdueDays(b) - overdueDays(a)), [jobs]);
  // Sudah terjadwal (tanggal ADA) tapi belum ada driver — sinyal risiko
  // BARU (redesain Control Tower): job ini janjinya sudah dibuat ("job
  // hari ini") tapi belum tentu benar-benar berangkat, beda dari overdueJobs
  // (janji yang sudah TERBUKTI terlewat) dan beda dari `unscheduled` (belum
  // punya tanggal SAMA SEKALI).
  const noDriverScheduled = useMemo(
    () => (jobs || []).filter((j) => j.scheduledDate && !j.driverId && ACTIVE_STATUSES.includes(j.status)),
    [jobs]
  );
  // Job SIAP DIRUTEKAN tapi order-nya belum punya link Google Maps —
  // koordinatnya bergantung pada tebakan geocoding alamat teks, yang untuk
  // alamat Indonesia detail sering meleset (akar "Buat Peta mental
  // kemana-mana", lihat catatan panjang di backend routes/armada.js
  // #ensureJobsGeocoded). Lihat komentar ROUTING_IMMINENT_STATUSES di atas
  // untuk kenapa scope-nya lebih sempit dari ACTIVE_STATUSES.
  const noMapsLinkJobs = useMemo(
    () => (jobs || []).filter((j) => ROUTING_IMMINENT_STATUSES.includes(j.status) && !salesLocationUrl(j)),
    [jobs]
  );
  const fleetByStatus = useMemo(() => {
    const out = {};
    for (const v of vehicles) if (v.active) out[v.status] = (out[v.status] || 0) + 1;
    return out;
  }, [vehicles]);

  // Terlama menunggu duluan (job auto-buat urut createdAt) + saring
  // pencarian, lalu batasi tampilan awal. Tiebreaker KEDUA (7 September
  // 2026, redesain Control Tower): kalau dua job sama-sama lahir hari yang
  // sama, yang BELUM dikonfirmasi tanggalnya ke customer (confirmedDateOf
  // null) naik duluan — bukan skor tersembunyi, cuma pemisah untuk kasus
  // seri yang sebelumnya diam-diam jatuh ke urutan API.
  const perluDijadwalkanUrut = useMemo(() => {
    const list = (unscheduled || []).slice().sort((a, b) => {
      const diff = new Date(a.createdAt) - new Date(b.createdAt);
      if (diff !== 0) return diff;
      return (confirmedDateOf(a) ? 1 : 0) - (confirmedDateOf(b) ? 1 : 0);
    });
    const q = cariPerlu.trim().toLowerCase();
    if (!q) return list;
    return list.filter((j) => `${orderNumberOf(j)} ${customerOf(j)}`.toLowerCase().includes(q));
  }, [unscheduled, cariPerlu]);
  const perluDijadwalkanTampil = tampilSemua ? perluDijadwalkanUrut : perluDijadwalkanUrut.slice(0, TAMPIL_AWAL);

  // ─── Needs Attention — gabungan 3 sinyal nyata, diberi label tingkat ────
  // keparahan TEKS (bukan warna saja — brief eksplisit minta aksesibilitas:
  // "Critical/Warning", bukan cuma titik merah/oranye tanpa keterangan).
  // Kritis DULUAN (job terlambat + dokumen yang SUDAH kadaluarsa), baru
  // Perhatian (dokumen mau habis + job terjadwal tanpa driver).
  const needsAttention = useMemo(() => {
    const items = [];
    for (const j of overdueJobs) {
      items.push({
        severity: "critical", key: `overdue-${j.id}`,
        title: `${customerOf(j) || "Tanpa nama"} · ${orderNumberOf(j) || "—"}`,
        detail: `Terlambat ${overdueDays(j)} hari dari jadwal`,
        onClick: () => navigate(`/armada/jobs?job=${j.id}`),
      });
    }
    for (const d of dokIssues) {
      items.push({
        severity: d.lewat ? "critical" : "warning", key: `dok-${d.vehicle.id}-${d.label}`,
        title: `${d.vehicle.plateNumber} · ${d.label}`,
        detail: d.lewat ? `Kadaluarsa ${Math.abs(d.sisaHari)} hari lalu` : `${d.sisaHari} hari lagi`,
        onClick: () => navigate("/armada/pengaturan?tab=armada"),
      });
    }
    for (const j of noDriverScheduled) {
      items.push({
        severity: "warning", key: `nodriver-${j.id}`,
        title: `${customerOf(j) || "Tanpa nama"} · ${orderNumberOf(j) || "—"}`,
        detail: "Sudah terjadwal, belum ada driver",
        onClick: () => navigate(`/armada/jobs?job=${j.id}`),
      });
    }
    for (const j of noMapsLinkJobs) {
      items.push({
        severity: "warning", key: `nomapslink-${j.id}`,
        title: `${customerOf(j) || "Tanpa nama"} · ${orderNumberOf(j) || "—"}`,
        detail: "Belum ada link Maps dari customer — koordinasi ke sales",
        onClick: () => navigate(`/armada/jobs?job=${j.id}`),
      });
    }
    const rank = { critical: 0, warning: 1 };
    return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
  }, [overdueJobs, dokIssues, noDriverScheduled, noMapsLinkJobs, navigate]);

  // ─── Active Operations — job yang SEDANG berlangsung sekarang ───────────
  // (EN_ROUTE/ARRIVED), dari `jobs` yang sama (rentang aktif, default Hari
  // Ini) — SENGAJA tidak fetch terpisah tanpa filter tanggal, konsisten
  // dengan aturan halaman ini yang sudah ada (D-082/083: semua widget di
  // sini ikut `range` yang dipilih di header, bukan diam-diam "selalu
  // sekarang" untuk satu kartu saja).
  const activeOps = useMemo(
    () => (jobs || []).filter((j) => j.status === "EN_ROUTE" || j.status === "ARRIVED"),
    [jobs]
  );
  const trackingByJob = useMemo(() => new Map((tracking || []).map((t) => [t.jobId, t])), [tracking]);

  function estimasiJarak(job) {
    if (job.status === "ARRIVED") return { label: "Tiba di lokasi", tone: "text-green" };
    const t = trackingByJob.get(job.id);
    if (!t?.lastPosition) return { label: "Menuju lokasi · GPS belum tersedia", tone: "text-ink3" };
    if (job.lat == null || job.lng == null) return { label: "Menuju lokasi", tone: "text-ink3" };
    const km = haversineKm({ lat: job.lat, lng: job.lng }, { lat: t.lastPosition.lat, lng: t.lastPosition.lng });
    return { label: `≈${km.toFixed(1)} km lagi · update ${formatRelatif(t.lastPosition.recordedAt)}`, tone: "text-ink2" };
  }

  // ─── Jadwal Hari Ini — agenda terurut jam kunjungan (bukan tabel rata) ──
  // Job dengan Job.timeWindow yang bisa dibaca jamnya tampil DULUAN sesuai
  // urutan jam; yang belum diisi jatuh ke BAWAH (bukan dipaksa urutan
  // tebakan) — pola disiplin yang sama dengan isJobOverdue soal timeWindow
  // teks bebas di jobStatus.js.
  const jadwalUrut = useMemo(() => {
    const parseJam = (job) => {
      const m = jamChip(job.timeWindow);
      if (!m) return Infinity;
      const [h, mnt] = m.split(/[.:]/).map(Number);
      return h * 60 + (mnt || 0);
    };
    const list = (jobs || []).slice().sort((a, b) => parseJam(a) - parseJam(b) || (customerOf(a) || "").localeCompare(customerOf(b) || ""));
    const q = cariJadwal.trim().toLowerCase();
    if (!q) return list;
    return list.filter((j) => `${orderNumberOf(j)} ${customerOf(j)} ${cityOf(j) || ""}`.toLowerCase().includes(q));
  }, [jobs, cariJadwal]);

  // ─── Kapasitas Driver — hitungan NYATA per driver, TANPA denominator
  // karangan (brief sempat minta "3/8 · 60%" tapi tidak ada field kapasitas
  // maksimal driver di skema manapun — menampilkannya berarti mengarang
  // angka, jadi sengaja cuma hitungan job hari ini per driver).
  const bebanDriver = useMemo(() => {
    const byDriver = new Map();
    for (const j of jobs || []) {
      if (!j.driverId) continue;
      const key = j.driverId;
      const cur = byDriver.get(key) || { driver: j.driver, count: 0 };
      cur.count += 1;
      byDriver.set(key, cur);
    }
    return Array.from(byDriver.values()).sort((a, b) => b.count - a.count);
  }, [jobs]);

  // ─── Operational Health — turunan Job.scheduledDate vs Job.completedAt,
  // BUKAN chart "Job per Status" lama. "Tepat Waktu" dihitung HANYA dari
  // job yang benar-benar sudah COMPLETED dan punya kedua tanggal itu —
  // job yang belum selesai/belum ada tanggal tidak ikut dihitung (bukan
  // dianggap "tepat waktu" secara default).
  const kesehatanOperasi = useMemo(() => {
    const selesai = (jobs || []).filter((j) => j.status === "COMPLETED" && j.completedAt && j.scheduledDate);
    let tepatWaktu = 0;
    for (const j of selesai) {
      const selisih = toWIB(j.completedAt).startOf("day").diff(toWIB(j.scheduledDate).startOf("day"), "day");
      if (selisih <= 0) tepatWaktu += 1;
    }
    const persenTepatWaktu = selesai.length ? Math.round((tepatWaktu / selesai.length) * 100) : null;
    return {
      persenTepatWaktu, dasarPersen: selesai.length,
      atRisk: noDriverScheduled.length,
      breached: overdueJobs.length,
      failed: (jobs || []).filter((j) => j.status === "FAILED").length,
    };
  }, [jobs, noDriverScheduled, overdueJobs]);

  // ─── Recent Activity — turunan dari field TIMESTAMP yang SUDAH ADA di
  // Job (completedAt/updatedAt), BUKAN tabel activity-log baru (memang
  // belum ada, lihat catatan lama di file ini soal "Aktivitas Terbaru
  // SENGAJA DIHAPUS"). Tiap job cuma menyumbang SATU baris — kondisi
  // TERKINI-nya, bukan riwayat lengkap semua perubahan (sistem ini tidak
  // menyimpan histori event per job) — supaya tidak menyiratkan lebih
  // detail dari yang sebenarnya tersedia.
  const aktivitasTerbaru = useMemo(() => {
    const rows = [];
    for (const j of jobs || []) {
      const nama = customerOf(j) || "Tanpa nama";
      if (j.status === "COMPLETED" && j.completedAt) {
        rows.push({ key: j.id, at: j.completedAt, text: `${nama} — Selesai`, jobId: j.id });
      } else if (j.status === "FAILED") {
        rows.push({ key: j.id, at: j.updatedAt, text: `${nama} — Gagal`, jobId: j.id });
      } else if (j.driverId) {
        rows.push({ key: j.id, at: j.updatedAt, text: `${nama} — Driver ditugaskan: ${j.driver?.name || "—"}`, jobId: j.id });
      } else if (confirmedDateOf(j)) {
        rows.push({ key: j.id, at: j.updatedAt, text: `${nama} — Tanggal dikonfirmasi`, jobId: j.id });
      }
    }
    return rows.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 10);
  }, [jobs]);

  return (
    <PageContainer>
      <PageHeader
        title="Delivery &amp; Fulfillment"
        // Subjudul menyebut ANGKA antrean + SLA (redesain Control Tower) —
        // kalimat generik "kelola jadwal, penugasan…" sama isinya tiap hari
        // dan berhenti dibaca setelah hari pertama; yang berubah tiap pagi
        // adalah berapa order menumpuk DAN berapa yang sudah terlambat.
        subtitle={
          loading
            ? "Memuat kondisi operasional…"
            : `Kelola jadwal, penugasan, rute, dan penyelesaian job pengiriman — ${unscheduled?.length ?? 0} job menunggu dijadwalkan` +
              (overdueJobs.length ? `, ${overdueJobs.length} job terlambat dari jadwal` : "") + "."
        }
        actionsBelow
        actions={
          <>
            <DateRangePicker value={range} onChange={setRange} />
            <Button size="sm" variant="ghost" onClick={() => navigate("/armada/pengaturan?tab=armada&action=tambah")}>
              <TruckIcon size={14} /> Tambah Kendaraan
            </Button>
            <Button size="sm" onClick={() => navigate("/armada/jobs")}>
              <Plus size={14} /> Buat Job
            </Button>
          </>
        }
      />

      <PageBody>
        {/* 1. Today's Operational Snapshot — 1 kartu utama (antrean belum
            terjadwal) + 4 kartu pendamping, MENGGANTIKAN grid 6-kartu rata
            DeliveryKpiRow khusus di halaman ini. */}
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="col-span-2 h-[120px] animate-pulse rounded-card bg-inset sm:col-span-3 lg:col-span-2" />
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[120px] animate-pulse rounded-card bg-inset" />)}
          </div>
        ) : (
          <DashboardSnapshot
            primary={{
              label: "Perlu Dijadwalkan", value: unscheduled?.length ?? 0,
              sub: "Order menunggu driver & tanggal", icon: CalendarClock,
              onClick: () => navigate("/armada/jobs?status=UNSCHEDULED"),
            }}
            secondary={[
              {
                key: "jobs", label: "Job — " + formatRangeText(range), value: jobs?.length ?? 0,
                sub: `${pickupCount} Pengambilan · ${deliveryCount} Pengiriman`, tone: "accent", icon: Package,
                onClick: () => navigate("/armada/jobs"),
              },
              {
                key: "drivers", label: "Driver Aktif", value: driversActiveCount,
                sub: `dari ${drivers.length} driver terdaftar`, tone: "accent", icon: Users,
              },
              {
                key: "sla", label: "Terlambat (SLA)", value: overdueJobs.length,
                sub: overdueJobs.length ? "job lewat dari jadwal" : "Tidak ada keterlambatan",
                tone: overdueJobs.length ? "red" : "green", icon: AlertTriangle,
              },
              {
                key: "selesai", label: "Selesai", value: completedCount,
                sub: `dari ${jobs?.length ?? 0} job — ${formatRangeText(range)}`, tone: "green", icon: CheckCircle2,
                onClick: () => navigate("/armada/jobs?status=COMPLETED"),
              },
            ]}
          />
        )}

        {/* 2. Needs Attention — DIPROMOSIKAN ke atas antrean (brief owner:
            ini yang paling butuh dilihat duluan), gabungan job terlambat +
            dokumen kendaraan + job terjadwal tanpa driver. Lihat
            needsAttention useMemo di atas untuk aturan gabungnya. */}
        <Card className="p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-ink">
            <AlertTriangle size={14} className="text-orange" /> Needs Attention
          </h3>
          {loading ? <TableSkeletonRows rows={3} cols={1} /> : needsAttention.length === 0 ? (
            <div className="flex items-center gap-2 rounded-btn bg-greenbg/40 px-3 py-2.5 text-[12.5px] font-semibold text-green">
              <ShieldCheck size={15} /> Operations Healthy — tidak ada job terlambat, dokumen kadaluarsa, atau job tanpa driver.
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {needsAttention.slice(0, 8).map((n) => (
                <button
                  key={n.key}
                  type="button"
                  onClick={n.onClick}
                  className="flex items-start gap-2 border-b border-line pb-2.5 text-left last:border-0 last:pb-0 hover:bg-hovertint"
                >
                  <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", n.severity === "critical" ? "bg-red" : "bg-orange")} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-[12.5px] font-semibold text-ink">
                      <span className={cn("text-[9.5px] font-bold uppercase tracking-wide", n.severity === "critical" ? "text-red" : "text-orange")}>
                        {n.severity === "critical" ? "Kritis" : "Perhatian"}
                      </span>
                      · {n.title}
                    </p>
                    <p className={cn("text-[11px]", n.severity === "critical" ? "text-red" : "text-ink3")}>{n.detail}</p>
                  </div>
                </button>
              ))}
              {needsAttention.length > 8 && (
                <p className="text-[11px] text-ink3">+{needsAttention.length - 8} isu lainnya.</p>
              )}
            </div>
          )}
        </Card>

        {/* 3. Unscheduled Queue ("Perlu Dijadwalkan") — antrean kerja
            dispatcher yang sesungguhnya, sekarang dengan baris produk+ukuran
            (D-036 lanjutan, 7 September 2026) dan tag "Belum dikonfirmasi"
            netral (BUKAN warna alarm — lihat catatan panjang di useMemo
            perluDijadwalkanUrut soal kenapa ini tidak dijadikan pemicu
            accent-bar: hampir semua baris di sini memang belum dikonfirmasi
            justru KARENA belum dijadwalkan, jadi menyalakan warna di situ
            akan mengulang persis kegagalan ambang 3-hari yang sudah pernah
            terjadi — 100% baris menyala, kehilangan makna prioritas). */}
        <Card className="overflow-hidden border-2 border-accent/30">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
              <CalendarClock size={14} className="text-accent" /> Perlu Dijadwalkan
            </h3>
            {!loading && unscheduled && (
              <span className="rounded-full bg-accentbg px-2.5 py-0.5 text-[12px] font-bold text-accent">
                {unscheduled.length}
              </span>
            )}
            {!loading && unscheduled?.length > TAMPIL_AWAL && (
              <KotakCari value={cariPerlu} onChange={setCariPerlu} placeholder="Cari pelanggan/order…" />
            )}
          </div>

          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-btn bg-inset" />)}
            </div>
          ) : !unscheduled || unscheduled.length === 0 ? (
            <div className="p-4 text-[12.5px] text-ink3">
              Tidak ada order menunggu penjadwalan — semua sudah punya driver/tanggal.
            </div>
          ) : perluDijadwalkanUrut.length === 0 ? (
            <div className="p-4 text-center text-[12.5px] text-ink3">Tidak ada yang cocok "{cariPerlu}".</div>
          ) : (
            <>
              <ul className="divide-y divide-line">
                {perluDijadwalkanTampil.map((j) => {
                  const hari = hariMenunggu(j.createdAt);
                  const nama = customerOf(j) || "Tanpa nama";
                  const order = orderOf(j);
                  const produk = order ? productSummary(order) : null;
                  return (
                    <li
                      key={j.id}
                      onClick={() => navigate(`/armada/jobs?job=${j.id}`)}
                      style={hari >= 7 ? { "--dh-bar": "var(--orange)" } : undefined}
                      className={cn(
                        "relative flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-hovertint",
                        hari >= 7 && "dh-bar-left"
                      )}
                    >
                      <Avatar name={nama} size="sm" gradient />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[12.5px] font-semibold text-ink">{nama}</span>
                          <span className="shrink-0 rounded-chip bg-inset px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-ink3">
                            {JOB_TYPE_REAL[j.type]?.label || j.type}
                          </span>
                          {!confirmedDateOf(j) && (
                            <span className="shrink-0 rounded-chip bg-inset px-1.5 py-0.5 text-[9.5px] text-ink3">
                              Belum dikonfirmasi
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink3">
                          <span className="font-mono">{orderNumberOf(j) || "—"}</span>
                          <span aria-hidden>·</span>
                          <span className={hari >= 7 ? "font-semibold text-orange" : ""}>
                            {hari === 0 ? "Baru masuk hari ini" : `Menunggu ${hari} hari`}
                          </span>
                        </div>
                        {produk && <div className="mt-0.5 truncate text-[11px] text-ink3">{produk}</div>}
                      </div>
                      <TugaskanDropdown
                        drivers={drivers}
                        helpers={helpers}
                        busy={assigningId === j.id}
                        onPick={(driverId, helperId) => tugaskanCepat(j.id, driverId, helperId)}
                      />
                    </li>
                  );
                })}
              </ul>
              {perluDijadwalkanUrut.length > TAMPIL_AWAL && (
                <button
                  type="button"
                  onClick={() => setTampilSemua((v) => !v)}
                  className="flex w-full items-center justify-center gap-1 border-t border-line py-2.5 text-[12px] font-semibold text-accent hover:bg-hovertint"
                >
                  {tampilSemua ? "Tampilkan lebih sedikit" : `Tampilkan ${perluDijadwalkanUrut.length - TAMPIL_AWAL} lainnya`}
                </button>
              )}
            </>
          )}
        </Card>

        {/* 4. Active Operations — job yang SEDANG jalan sekarang (EN_ROUTE/
            ARRIVED). Jarak/GPS best-effort, lihat estimasiJarak() di atas
            dan catatan trackingError di bawah untuk kegagalan yang tidak
            boleh mem-blank-kan seluruh kartu. */}
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
              <Navigation size={14} className="text-accent" /> Active Operations
            </h3>
          </div>
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-btn bg-inset" />)}
            </div>
          ) : activeOps.length === 0 ? (
            <div className="p-4 text-[12.5px] text-ink3">Tidak ada pengambilan/pengiriman yang sedang berjalan saat ini.</div>
          ) : (
            <ul className="divide-y divide-line">
              {activeOps.map((j) => {
                const nama = customerOf(j) || "Tanpa nama";
                const jarak = estimasiJarak(j);
                return (
                  <li key={j.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/armada/jobs?job=${j.id}`)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hovertint"
                    >
                      <Avatar name={nama} size="sm" gradient />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-[13px] font-semibold text-ink">{nama}</span>
                          <span className="shrink-0 rounded-chip bg-inset px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-ink3">
                            {JOB_TYPE_REAL[j.type]?.label || j.type}
                          </span>
                          <StatusBadge map={JOB_STATUS_REAL} value={j.status} />
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-ink3">
                          <span>{j.driver?.name || "Belum ada driver"}</span>
                          {j.vehicle?.plateNumber && <><span aria-hidden>·</span><span>{j.vehicle.plateNumber}</span></>}
                        </div>
                        <p className={cn("mt-0.5 text-[11px]", jarak.tone)}>{jarak.label}</p>
                      </div>
                      <ChevronRight size={14} className="shrink-0 text-ink3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {trackingError && (
            <p className="border-t border-line px-4 py-2 text-[10.5px] text-ink3">
              Estimasi jarak sedang tidak tersedia — status job di atas tetap akurat.
            </p>
          )}
        </Card>

        {/* 5. Jadwal Hari Ini — agenda terurut jam kunjungan, MENGGANTIKAN
            kartu tabel "Job — {range}" lama (isinya sekarang dipecah jadi
            agenda ini + Recent Activity di bawah, supaya tidak dobel). */}
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <h3 className="text-[13px] font-bold text-ink">Jadwal — {formatRangeText(range)}</h3>
            {!loading && jadwalUrut.length > TAMPIL_AWAL && (
              <KotakCari value={cariJadwal} onChange={setCariJadwal} placeholder="Cari pelanggan/order/kota…" />
            )}
          </div>
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-btn bg-inset" />)}
            </div>
          ) : jobs.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Belum ada job pada rentang ini"
              description="Buat job baru atau ubah rentang tanggal pada filter di atas."
              action={<Button size="sm" onClick={() => navigate("/armada/jobs")}><Plus size={14} /> Buat Job</Button>}
            />
          ) : jadwalUrut.length === 0 ? (
            <div className="p-4 text-center text-[12.5px] text-ink3">Tidak ada yang cocok "{cariJadwal}".</div>
          ) : (
            <ul className="divide-y divide-line">
              {jadwalUrut.map((j) => {
                const cust = customerOf(j);
                const jam = jamChip(j.timeWindow);
                return (
                  <li key={j.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/armada/jobs?job=${j.id}`)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hovertint"
                    >
                      <span className={cn(
                        "flex h-9 w-14 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold tabular-nums",
                        jam ? "bg-accentbg text-accent" : "bg-inset text-ink3"
                      )}>
                        {jam || "—"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-[13px] font-semibold text-ink">{cust || "—"}</span>
                          <span className="shrink-0 rounded-chip bg-inset px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-ink3">
                            {JOB_TYPE_REAL[j.type]?.label || j.type}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-ink3">
                          <span className="font-mono">{orderNumberOf(j) || "—"}</span>
                          {cityOf(j) && <><span aria-hidden>·</span><span>{cityOf(j)}</span></>}
                          <span aria-hidden>·</span>
                          <span className={cn(!j.driver && "font-semibold text-orange")}>
                            {j.driver?.name || "Belum ada driver"}
                          </span>
                        </div>
                      </div>
                      <StatusBadge map={JOB_STATUS_REAL} value={j.status} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* 6. Kapasitas — Driver (hitungan job nyata per orang, TANPA
            denominator karangan) & Kendaraan (restyle "Ketersediaan
            Armada" lama, data SAMA — fleetByStatus). */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <h3 className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-ink">
              <Users size={14} /> Kapasitas Driver
            </h3>
            {loading ? <TableSkeletonRows rows={3} cols={1} /> : bebanDriver.length === 0 ? (
              <p className="text-[12px] text-ink3">Belum ada driver yang ditugaskan pada rentang ini.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {bebanDriver.map(({ driver, count }) => (
                  <li key={driver?.id || driver?.name} className="flex items-center gap-2.5">
                    <Avatar name={driver?.name || "?"} size="sm" gradient />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{driver?.name || "—"}</span>
                    <span className="shrink-0 rounded-full bg-inset px-2 py-0.5 text-[11px] font-bold text-ink2">{count} job</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-ink">
              <TruckIcon size={14} /> Kapasitas Kendaraan
            </h3>
            {loading ? <TableSkeletonRows rows={2} cols={4} /> : vehicles.filter((v) => v.active).length === 0 ? (
              <EmptyState icon={TruckIcon} title="Belum ada kendaraan aktif" description="Tambahkan lewat Driver & Armada." />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Object.entries(VEHICLE_STATUS_REAL).map(([key, def]) => (
                  <div key={key} className="rounded-2xl bg-inset/60 p-3 text-center">
                    <p className="text-[20px] font-bold text-ink">{fleetByStatus[key] || 0}</p>
                    <p className="text-[11px] text-ink3">{def.label}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* 7. Operational Health (menggantikan "Job per Status") + Recent
            Activity (menggantikan "Job — Semua Waktu") — dua-duanya
            turunan langsung dari `jobs`, tidak ada tabel/data baru. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(300px,1fr)_minmax(0,1.6fr)]">
          <Card className="p-4">
            <h3 className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-ink">
              <Activity size={14} /> Operational Health
            </h3>
            {loading ? <TableSkeletonRows rows={4} cols={1} /> : (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <span className="text-[12px] text-ink2">Tepat Waktu</span>
                  <span className="text-[13px] font-bold text-ink">
                    {kesehatanOperasi.persenTepatWaktu === null ? "—" : `${kesehatanOperasi.persenTepatWaktu}%`}
                    {kesehatanOperasi.dasarPersen > 0 && (
                      <span className="ml-1 text-[10.5px] font-normal text-ink3">({kesehatanOperasi.dasarPersen} selesai)</span>
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <span className="text-[12px] text-ink2">At Risk (belum ada driver)</span>
                  <span className={cn("text-[13px] font-bold", kesehatanOperasi.atRisk ? "text-orange" : "text-ink")}>{kesehatanOperasi.atRisk}</span>
                </div>
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <span className="text-[12px] text-ink2">Breached (terlambat)</span>
                  <span className={cn("text-[13px] font-bold", kesehatanOperasi.breached ? "text-red" : "text-ink")}>{kesehatanOperasi.breached}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-ink2">Gagal</span>
                  <span className={cn("text-[13px] font-bold", kesehatanOperasi.failed ? "text-red" : "text-ink")}>{kesehatanOperasi.failed}</span>
                </div>
              </div>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-line px-4 py-3">
              <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
                <History size={14} /> Recent Activity
              </h3>
            </div>
            {loading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 animate-pulse rounded-btn bg-inset" />)}
              </div>
            ) : aktivitasTerbaru.length === 0 ? (
              <p className="p-4 text-[12px] text-ink3">Belum ada aktivitas pada rentang ini.</p>
            ) : (
              <>
                <ul className="divide-y divide-line">
                  {aktivitasTerbaru.map((a) => (
                    <li key={a.key}>
                      <button
                        type="button"
                        onClick={() => navigate(`/armada/jobs?job=${a.jobId}`)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hovertint"
                      >
                        <span className="min-w-0 truncate text-[12.5px] text-ink">{a.text}</span>
                        <span className="shrink-0 text-[10.5px] text-ink3">{formatRelatif(a.at)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => navigate("/armada/jobs")}
                  className="flex w-full items-center justify-center gap-1 border-t border-line py-2.5 text-[12px] font-semibold text-accent hover:bg-hovertint"
                >
                  Lihat Semua Aktivitas
                </button>
              </>
            )}
          </Card>
        </div>
      </PageBody>
    </PageContainer>
  );
}
