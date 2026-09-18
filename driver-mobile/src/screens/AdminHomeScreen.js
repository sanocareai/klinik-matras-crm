// Beranda admin/dispatcher (10 Sep 2026, permintaan owner: "tambahkan
// tampilan untuk login admin, yang menampilkan status driver"). Login
// dengan role ADMIN/DISPATCHER mendarat di sini, bukan Job Saya (lihat
// lib/roles.js#isAdminView, App.js). SEMUA data lewat endpoint yang SUDAH
// dipakai dispatcher web (GET /armada/jobs, /armada/tracking, /armada/
// issues, /armada/routes), nol/minim perubahan backend. Light/dark ikut
// sistem HP (lihat src/theme.js).
//
// ⚠️ TIDAK LAGI baca-saja murni sejak tab "Rute" > "Aktif" (13 Sep 2026,
// D-163) — owner: "gue yakin pasti akan ada case driver lupa update juga
// di apps driver, otomatis harus ada tab baru dong ... yang menampilkan
// rute aktif" utk admin bisa BANTU update status job atas nama driver
// (mekanisme lama: driver lapor lewat WhatsApp). Ini AMAN dari sisi
// backend TANPA perubahan apa pun — `loadOwnedJob()` (armada.js) sudah
// meloloskan siapa pun berbekal permission JOB_WRITE (yang dimiliki
// ADMIN) melewati pengecekan "job ini punya saya", persis pola yang SUDAH
// dipakai dispatcher web di JobDetailDrawer.jsx ("Ubah status manual —
// dispatcher bertindak atas nama driver"). Komponen JobCard yang dipakai
// di sini SAMA PERSIS dengan yang dipakai driver sendiri (JobListScreen) —
// reuse penuh, bukan implementasi kedua.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, RefreshControl, Linking, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import Svg, { Circle } from "react-native-svg";
import { Truck, Route, CheckCircle2, XCircle, Clock, Award, Home, AlertTriangle, Navigation, MapPin, ChevronDown, ChevronUp, WifiOff } from "lucide-react-native";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../hooks/useTheme";
import { useAdminToday } from "../hooks/useAdminToday";
import { useIncentiveSummary } from "../hooks/useIncentiveSummary";
import { useRouteHistory } from "../hooks/useRouteHistory";
import { relatifWaktu, formatRupiah, customerOf, orderNumberOf, kesegaranGps, formatEta } from "../lib/jobHelpers";
import { api } from "../api";
import { MAP_STYLE_DARK } from "../lib/googleMapStyle";
import BottomNavBar from "../components/BottomNavBar";
import GradientCard from "../components/GradientCard";
import JobCard from "../components/JobCard";
import Avatar from "../components/Avatar";
import DriverMapMarker from "../components/DriverMapMarker";

// Nav bawah (12 Sep 2026, fase 2 redesign) — menggantikan tab pill yang
// dulu di atas konten, lihat BottomNavBar.js.
// Tab Live Tracking (13 Sep 2026, permintaan owner: "live tracking bisa
// dilakukan di web/apps"; PETA ASLI ditambah sehari kemudian setelah owner
// kirim key Maps Android baru — web sudah punya papan peta penuh di
// ArmadaTracking.jsx, GET /armada/tracking sudah ikut dipanggil
// `useAdminToday` sejak awal). react-native-maps BUTUH native rebuild
// (bukan OTA) — versionCode dinaikkan di app.json, build baru WAJIB
// diinstal manual sekali oleh owner (bukan auto-update lewat OTA seperti
// biasa; OTA jalan normal lagi SETELAH itu). Rute driver->tujuan digambar
// mengikuti JALAN sungguhan lewat GET /armada/route-path (lihat TrackingMap
// di bawah) — garis lurus cuma dipakai selagi menunggu/kalau gagal.
const TABS = [
  { key: "hari-ini", label: "Hari Ini", icon: Home },
  { key: "driver", label: "Driver", icon: Truck },
  { key: "tracking", label: "Tracking", icon: Navigation },
  { key: "rute", label: "Rute", icon: Route },
  { key: "masalah", label: "Masalah", icon: AlertTriangle },
  { key: "performa", label: "Performa", icon: Award },
];

// Sub-tab "Aktif"/"Riwayat" di dalam tab Rute (13 Sep 2026) — pola SAMA
// dengan PERIODE_PRESET di Performa (chip segmented), TIDAK dijadikan tab
// bottom-nav terpisah supaya bar bawah tidak membengkak jadi 7 item.
const RUTE_SUB = [
  { key: "aktif", label: "Aktif" },
  { key: "riwayat", label: "Riwayat" },
];
const RIWAYAT_PAGE_SIZE = 10;

// Preset rentang tanggal utk tab Performa (12 Sep 2026) — default "Bulan
// Ini" (backend juga default ke ini kalau from/to kosong, lihat
// armada.js#incentive-summary), owner tidak menegaskan kebutuhan custom
// date picker jadi cukup 3 preset umum dulu.
const PERIODE_PRESET = [
  { key: "bulan-ini", label: "Bulan Ini" },
  { key: "minggu-ini", label: "Minggu Ini" },
  { key: "bulan-lalu", label: "Bulan Lalu" },
];

function rentangPeriode(preset) {
  const now = new Date(Date.now() + 7 * 3600_000); // WIB
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const toISO = (d) => d.toISOString().slice(0, 10);
  if (preset === "minggu-ini") {
    const dow = now.getUTCDay() || 7; // Senin=1..Minggu=7
    const senin = new Date(Date.UTC(y, m, now.getUTCDate() - dow + 1));
    return { from: toISO(senin), to: toISO(now) };
  }
  if (preset === "bulan-lalu") {
    const awal = new Date(Date.UTC(y, m - 1, 1));
    const akhir = new Date(Date.UTC(y, m, 0));
    return { from: toISO(awal), to: toISO(akhir) };
  }
  // bulan-ini (default)
  const awal = new Date(Date.UTC(y, m, 1));
  return { from: toISO(awal), to: toISO(now) };
}

// Nama tim rute (13 Sep 2026, audit tab Driver — celah #4) — dipakai di
// header kartu rute (Hari Ini & tab Rute) supaya admin tidak perlu pindah
// ke tab Driver dulu cuma buat tahu siapa yang pegang satu rute.
function namaTimRute(r) {
  return [r.driverName, r.helperName].filter(Boolean).join(" + ") || "Belum ada driver";
}

function ringkasHariIni(jobs) {
  const counts = {};
  for (const j of jobs) counts[j.status] = (counts[j.status] || 0) + 1;
  const sisa = (counts.ASSIGNED || 0) + (counts.SCHEDULED || 0) + (counts.UNSCHEDULED || 0);

  // driverName/helperName (13 Sep 2026, audit tab Driver — celah #4:
  // "Rute Hari Ini" & tab Rute cuma tampil kode rute, admin harus pindah
  // ke tab Driver dulu buat tahu siapa yang pegang). Diambil dari job
  // PERTAMA di rute itu yang punya driver/helper — dalam praktiknya SATU
  // rute selalu 1 driver+helper yang sama di semua job-nya (assignment di
  // level rute), jadi representatif tanpa perlu query/field baru.
  const routeMap = new Map();
  for (const j of jobs) {
    if (!j.route) continue;
    let r = routeMap.get(j.route.id);
    if (!r) { r = { id: j.route.id, code: j.route.code, total: 0, selesai: 0, gagal: 0, driverName: null, driverAvatarUrl: null, helperName: null, helperAvatarUrl: null }; routeMap.set(j.route.id, r); }
    r.total += 1;
    if (j.status === "COMPLETED") r.selesai += 1;
    if (j.status === "FAILED") r.gagal += 1;
    if (!r.driverName && j.driver) { r.driverName = j.driver.name; r.driverAvatarUrl = j.driver.avatarUrl || null; }
    if (!r.helperName && j.helper) { r.helperName = j.helper.name; r.helperAvatarUrl = j.helper.avatarUrl || null; }
  }

  return {
    total: jobs.length,
    selesai: counts.COMPLETED || 0,
    jalan: (counts.EN_ROUTE || 0) + (counts.ARRIVED || 0),
    gagal: counts.FAILED || 0,
    sisa,
    routes: [...routeMap.values()],
  };
}

// Aktivitas Terbaru (13 Sep 2026, permintaan owner: "dashboard admin masih
// belum detail, hanya ada rute hari ini" + referensi app fitness — list
// "Daily Activities" kronologis). Job SELESAI/GAGAL hari ini, terbaru dulu
// — customerOf()/orderNumberOf() dari jobHelpers.js (fallback units[].unit.
// order SAMA seperti dipakai JobCard, bukan logic baru) supaya nama/nomor
// order tetap terisi walau job cuma py order lewat jalur lama itu.
function aktivitasTerbaru(jobs) {
  return jobs
    .filter((j) => j.status === "COMPLETED" || j.status === "FAILED")
    .map((j) => ({
      id: j.id,
      status: j.status,
      customerName: customerOf(j),
      orderNumber: orderNumberOf(j),
      type: j.type,
      driverName: j.driver?.name || null,
      time: j.completedAt || j.updatedAt,
      failureReason: j.failureReason || null,
    }))
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 8);
}

// BUG NYATA (13 Sep 2026, laporan owner: tab Driver cuma menampilkan Alwan
// + Kurir Eksternal, padahal rute yang sama SELALU dijalankan 2 orang
// [driver+helper] — Agung/Apriansyah yang bertugas sbg HELPER di rute itu
// hilang total). Root cause: fungsi ini SEBELUMNYA cuma memproses
// `j.driver`, `j.helper` tidak pernah disentuh sama sekali — pola yang
// SAMA persis sudah diperbaiki di backend utk Insentif (D-162, armada.js
// GET /incentive-summary sudah hitung asDriver+asHelper terpisah per
// orang) tapi tab ini di app belum ikut. Sekarang SETIAP job menyumbang
// hitungan ke KEDUA orang (driver DAN helper, kalau ada), bukan cuma satu
// — 1 orang bisa muncul sbg driver di 1 job dan helper di job lain (pool
// SAMA, lihat CLAUDE.md §1: "helper bisa jadi driver dan driver bisa jadi
// helper"), makanya `roles` dikumpulkan sbg Set utk badge di UI.
// Rute Aktif (13 Sep 2026, D-163) — kelompokkan job HARI INI (sudah
// dipanggil useAdminToday, nol panggilan API baru) per rute, SISAKAN
// cuma rute yang MASIH punya job belum COMPLETED/FAILED. Job DALAM rute
// aktif tetap ditampilkan SEMUA (bukan cuma yang pending) supaya admin
// lihat konteks penuh rute itu, urut sesuai `sequence` sama seperti Route
// Planner web.
function ruteAktifDariJobs(jobs) {
  const byRoute = new Map();
  for (const j of jobs) {
    if (!j.route) continue;
    let r = byRoute.get(j.route.id);
    // driverName/helperName (13 Sep 2026, audit tab Driver — celah #4) —
    // sama pola dengan ringkasHariIni: ambil dari job pertama di rute ini
    // yang punya driver/helper, representatif karena 1 rute = 1 pasangan
    // driver+helper di semua job-nya.
    if (!r) { r = { id: j.route.id, code: j.route.code, driverName: null, helperName: null, jobs: [] }; byRoute.set(j.route.id, r); }
    if (!r.driverName && j.driver) r.driverName = j.driver.name;
    if (!r.helperName && j.helper) r.helperName = j.helper.name;
    r.jobs.push(j);
  }
  return [...byRoute.values()]
    .filter((r) => r.jobs.some((j) => j.status !== "COMPLETED" && j.status !== "FAILED"))
    .map((r) => ({ ...r, jobs: [...r.jobs].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)) }));
}

// Hitung selesai/gagal/total dari route.jobs (Riwayat Rute, 13 Sep 2026) —
// GET /armada/routes sudah sertakan jobs penuh per rute (routeInclude),
// tidak perlu hitungan terpisah dari backend.
function hitungRute(route) {
  const jobs = route.jobs || [];
  return {
    total: jobs.length,
    selesai: jobs.filter((j) => j.status === "COMPLETED").length,
    gagal: jobs.filter((j) => j.status === "FAILED").length,
  };
}

// DIUBAH 19 September 2026 (laporan owner: "di tab driver contoh hari ini
// agung jalan bersama difa, apakah gabisa mereka 1 grup gitu di card ga
// terpisah?") — SEBELUMNYA satu entri per ORANG, jadi driver+helper yang
// mengerjakan rute yang SAMA (job yang SAMA persis) muncul sbg 2 kartu
// terpisah dengan angka yang nyaris identik (sama-sama menghitung job yang
// sama). Sekarang satu entri per TIM (pasangan driverId+helperId yang
// benar-benar bekerja bersama), pola yang SAMA dengan namaTimRute()/
// ringkasHariIni() di atas — job dihitung SEKALI per tim (bukan dobel utk
// driver+helper), 1 orang tetap BISA muncul di lebih dari 1 kartu kalau dia
// benar-benar berganti pasangan di rute berbeda hari itu (CLAUDE.md §1:
// "helper bisa jadi driver dan driver bisa jadi helper") — itu bukan bug,
// itu memang 2 tim berbeda.
function kunciTim(driver, helper) {
  const ids = [driver?.id, helper?.id].filter(Boolean).sort();
  return ids.length ? ids.join("+") : null;
}

function ringkasDriver(jobs, tracking) {
  const timMap = new Map();
  for (const j of jobs) {
    const key = kunciTim(j.driver, j.helper);
    if (!key) continue; // job belum ada driver/helper sama sekali
    let t = timMap.get(key);
    if (!t) {
      t = {
        key,
        driver: j.driver ? { id: j.driver.id, name: j.driver.name, avatarUrl: j.driver.avatarUrl || null, isOnline: !!j.driver.isOnline } : null,
        helper: j.helper ? { id: j.helper.id, name: j.helper.name, avatarUrl: j.helper.avatarUrl || null, isOnline: !!j.helper.isOnline } : null,
        total: 0, selesai: 0, gagal: 0, jalan: 0, sisa: 0, lastSeen: null,
        jobIds: new Set(),
      };
      timMap.set(key, t);
    }
    // Job SEKALI per tim — beda dari versi lama yang menghitung job yang
    // sama 2x (sekali sbg driver, sekali sbg helper) karena dulu tiap
    // orang py entri sendiri.
    if (t.jobIds.has(j.id)) continue;
    t.jobIds.add(j.id);
    t.total += 1;
    if (j.status === "COMPLETED") t.selesai += 1;
    else if (j.status === "FAILED") t.gagal += 1;
    else if (j.status === "EN_ROUTE" || j.status === "ARRIVED") t.jalan += 1;
    else t.sisa += 1;
  }

  const jobIdToTimKey = new Map();
  for (const j of jobs) {
    const key = kunciTim(j.driver, j.helper);
    if (key) jobIdToTimKey.set(j.id, key);
  }
  // Bentuk GET /armada/tracking BERUBAH (D-165, 14 Sep 2026) dari array
  // datar per-job jadi per-KENDARAAN ("route" py `activeJobId`, "loose" py
  // `jobId`) — di sini cuma butuh 1 jobId aktif per item utk cari lastSeen,
  // jadi cukup baca field yang sesuai `kind`, tanpa turunkanKendaraan penuh.
  for (const item of tracking) {
    const jobId = item.kind === "route" ? item.activeJobId : item.jobId;
    const key = jobIdToTimKey.get(jobId);
    const t = key ? timMap.get(key) : null;
    if (t && item.lastPosition?.recordedAt) t.lastSeen = item.lastPosition.recordedAt;
  }
  return [...timMap.values()].sort((a, b) => b.jalan - a.jalan || b.total - a.total);
}

// Ratakan bentuk backend GET /armada/tracking — "route" (banyak stop) ATAU
// "loose" (Kurir Eksternal, D-161, 1 titik) jadi SATU struktur render, stop
// dipecah jadi done/active/pending berdasar STATUS (D-166, 14 Sep 2026) —
// BUKAN urutan sequence, driver di lapangan tidak selalu ikut urutan rencana.
// Pola SAMA PERSIS dengan turunkanKendaraan() di web (ArmadaTracking.jsx) —
// kalau bentuk backend berubah lagi, keduanya WAJIB diperbarui bersamaan.
// `position` = titik yang digambar (GPS asli, atau Klinik Matras dengan
// source "depot" kalau GPS belum ada); `lastPosition` = GPS asli saja.
const STATUS_TUNTAS = new Set(["COMPLETED", "FAILED", "RESCHEDULED"]);
function turunkanKendaraan(item) {
  const stops = item.kind === "loose"
    ? [{
        jobId: item.jobId, sequence: 1, status: item.status, type: item.type,
        addressText: item.addressText, lat: item.destinationLat, lng: item.destinationLng,
        orderNumber: item.orderNumber, customerName: item.customerName,
      }]
    : item.stops;
  const activeJobId = item.kind === "loose" ? item.jobId : item.activeJobId;
  const active = stops.find((s) => s.jobId === activeJobId) || null;
  const done = stops
    .filter((s) => STATUS_TUNTAS.has(s.status))
    .sort((a, b) => new Date(a.completedAt || 0) - new Date(b.completedAt || 0) || (a.sequence ?? 0) - (b.sequence ?? 0));
  const pending = stops.filter((s) => s !== active && !STATUS_TUNTAS.has(s.status));
  return {
    vehicleId: item.kind === "loose" ? `loose-${item.jobId}` : `route-${item.routeId}`,
    routeCode: item.kind === "loose" ? null : item.routeCode,
    driverName: item.driverName,
    driverAvatarUrl: item.driverAvatarUrl || null,
    helperName: item.kind === "loose" ? null : item.helperName,
    helperAvatarUrl: item.kind === "loose" ? null : (item.helperAvatarUrl || null),
    driverOnline: !!item.driverOnline,
    phase: item.kind === "loose" ? item.status : item.phase,
    lastPosition: item.lastPosition,
    position: item.position,
    depot: item.depot,
    stops, active, done, pending,
  };
}

function labelFase(v) {
  if (v.phase === "EN_ROUTE") return "Sedang Menuju";
  if (v.phase === "ARRIVED") return "Tiba Di Lokasi";
  if (v.phase === "DONE") return "Rute Selesai";
  return v.done.length > 0 ? "Berikutnya" : "Belum Berangkat";
}

const punyaKoordinat = (s) => s.lat != null && s.lng != null;

export default function AdminHomeScreen() {
  const { user, logout } = useAuth();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { data, isLoading, error, refetch, isRefetching } = useAdminToday();
  const [tab, setTab] = useState("hari-ini");
  const [periode, setPeriode] = useState("bulan-ini");
  const [subRute, setSubRute] = useState("aktif");
  const [riwayatTake, setRiwayatTake] = useState(RIWAYAT_PAGE_SIZE);

  const jobs = data?.jobs || [];
  const issues = data?.issues || [];
  const tracking = data?.tracking || [];

  const ringkasan = useMemo(() => ringkasHariIni(jobs), [jobs]);
  const aktivitas = useMemo(() => aktivitasTerbaru(jobs), [jobs]);
  const drivers = useMemo(() => ringkasDriver(jobs, tracking), [jobs, tracking]);
  const ruteAktif = useMemo(() => ruteAktifDariJobs(jobs), [jobs]);

  const { from, to } = useMemo(() => rentangPeriode(periode), [periode]);
  const performa = useIncentiveSummary(from, to, tab === "performa");
  const riwayat = useRouteHistory(riwayatTake, tab === "rute" && subRute === "riwayat");

  return (
    <SafeAreaView style={styles.root}>
      {/* Hero card gradasi (12 Sep 2026, fase 3 redesign — referensi
          Gojek/DelTrack) — sapaan + ringkasan singkat hari ini, tampil
          konstan di SEMUA tab (bukan cuma tab Hari Ini) supaya admin
          selalu lihat sekilas progress tanpa pindah tab. */}
      <GradientCard colors={theme.GRADIENT} style={styles.hero}>
        <View style={styles.heroTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroGreeting}>Halo, {user?.name || "Admin"}</Text>
            <Text style={styles.heroSubtitle}>Ringkasan delivery hari ini</Text>
          </View>
          <Pressable onPress={logout} style={styles.heroLogoutBtn}>
            <Text style={styles.heroLogoutText}>Keluar</Text>
          </Pressable>
        </View>

        {!isLoading && !error && (
          <View style={styles.heroStatsRow}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{ringkasan.total}</Text>
              <Text style={styles.heroStatLabel}>Total Job</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{ringkasan.selesai}</Text>
              <Text style={styles.heroStatLabel}>Selesai</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{ringkasan.jalan}</Text>
              <Text style={styles.heroStatLabel}>Jalan</Text>
            </View>
          </View>
        )}
      </GradientCard>

      {tab === "rute" && subRute === "riwayat" ? (
        // FlashList terpisah dari ScrollView bersama di bawah (13 Sep 2026,
        // audit performa) — VirtualizedList (FlashList) TIDAK BOLEH
        // disarangkan di dalam ScrollView orientasi sama (peringatan RN
        // resmi, dan virtualisasinya JADI PERCUMA kalau tetap dipaksa —
        // seluruh isi tetap dirender sekaligus oleh ScrollView induk).
        // Riwayat Rute dipilih utk virtualisasi (bukan Driver/Masalah/Rute
        // Aktif) karena SATU-SATUNYA list di app ini yang datanya BENAR
        // tumbuh tanpa batas alami seiring waktu (riwayat rute selesai
        // terus bertambah tiap hari), beda dari Driver/Masalah yang
        // dibatasi jumlah armada (8 orang, CLAUDE.md §1) — daftar pendek
        // itu TIDAK butuh virtualisasi, cuma nambah kompleksitas struktur
        // tanpa manfaat nyata.
        <RiwayatRuteView
          subRute={subRute}
          setSubRute={setSubRute}
          riwayat={riwayat}
          riwayatTake={riwayatTake}
          setRiwayatTake={setRiwayatTake}
          theme={theme}
          styles={styles}
        />
      ) : tab === "performa" ? (
        <PerformaView
          performa={performa}
          periode={periode}
          setPeriode={setPeriode}
          theme={theme}
          styles={styles}
        />
      ) : isLoading ? (
        <View style={styles.center}><ActivityIndicator color={theme.ACCENT} /></View>
      ) : error ? (
        <View style={styles.center}><Text style={styles.errorText}>Gagal memuat: {error.message}</Text></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.ACCENT} />}
        >
          {tab === "hari-ini" && <HariIniView ringkasan={ringkasan} aktivitas={aktivitas} theme={theme} styles={styles} />}
          {tab === "driver" && <DriverView drivers={drivers} theme={theme} styles={styles} />}
          {tab === "tracking" && <TrackingView tracking={tracking} theme={theme} styles={styles} />}
          {tab === "rute" && (
            <RuteView
              subRute={subRute}
              setSubRute={setSubRute}
              ruteAktif={ruteAktif}
              onChanged={refetch}
              theme={theme}
              styles={styles}
            />
          )}
          {tab === "masalah" && <MasalahView issues={issues} theme={theme} styles={styles} />}
        </ScrollView>
      )}

      <BottomNavBar
        items={TABS}
        active={tab}
        onChange={setTab}
        theme={theme}
        badge={{ masalah: issues.length }}
      />
    </SafeAreaView>
  );
}

// Ring status job hari ini (13 Sep 2026, permintaan owner: "dashboard
// admin masih belum detail" + referensi app fintech Nexora — ring donut
// jadi ringkasan utama, gantikan 5 kartu angka datar). SVG murni
// (react-native-svg SUDAH ter-compile di binary sejak awal, dipakai
// lucide-react-native utk tiap ikon) — aman lewat OTA, TIDAK butuh native
// rebuild. Pola arc: tiap segmen Circle FULL (r sama), dibedakan lewat
// strokeDasharray (panjang segmen vs sisa lingkaran) + strokeDashoffset
// (titik mulai, negatif = geser searah jarum jam) + rotation=-90 supaya
// segmen pertama mulai dari jam 12, bukan jam 3 (default SVG).
function StatusRing({ segments, total, t, size = 132, strokeWidth = 18 }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;
  const denom = total || 1;
  let kumulatif = 0;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((seg) => {
      const segLen = (seg.value / denom) * circumference;
      const offset = -(kumulatif / denom) * circumference;
      kumulatif += seg.value;
      return { ...seg, segLen, offset };
    });
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={radius} stroke={t.TRACK_BG} strokeWidth={strokeWidth} fill="none" />
        {arcs.map((seg) => (
          <Circle
            key={seg.key}
            cx={cx} cy={cy} r={radius}
            stroke={seg.color} strokeWidth={strokeWidth} fill="none"
            strokeDasharray={`${seg.segLen} ${circumference - seg.segLen}`}
            strokeDashoffset={seg.offset}
            strokeLinecap="butt"
            rotation={-90}
            origin={`${cx}, ${cy}`}
          />
        ))}
      </Svg>
      <View style={StyleSheet.absoluteFillObject}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 24, fontWeight: "800", color: t.INK }}>{total}</Text>
          <Text style={{ fontSize: 10, fontWeight: "600", color: t.INK3 }}>Total Job</Text>
        </View>
      </View>
    </View>
  );
}

function LegendRow({ color, label, value, styles }) {
  return (
    <View style={styles.legendRow}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
        <View style={[styles.legendDot, { backgroundColor: color }]} />
        <Text style={styles.legendLabel}>{label}</Text>
      </View>
      <Text style={styles.legendValue}>{value}</Text>
    </View>
  );
}

function AktivitasRow({ item, t, styles }) {
  const gagal = item.status === "FAILED";
  const Icon = gagal ? XCircle : CheckCircle2;
  const warna = gagal ? t.RED : t.GREEN;
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <View style={[styles.activityIconWrap, { backgroundColor: warna + "1F" }]}>
        <Icon size={15} color={warna} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.customerName || "Tanpa nama"}</Text>
          <Text style={styles.cardMeta}>{relatifWaktu(item.time)}</Text>
        </View>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {item.orderNumber || "—"} · {item.type === "PICKUP" ? "Pengambilan" : "Pengiriman"}
          {item.driverName ? ` · ${item.driverName}` : ""}
        </Text>
        {gagal && item.failureReason ? (
          <Text style={[styles.cardMeta, { color: t.RED, marginTop: 2 }]} numberOfLines={2}>{item.failureReason}</Text>
        ) : null}
      </View>
    </View>
  );
}

function HariIniView({ ringkasan, aktivitas, theme: t, styles }) {
  return (
    <View style={{ gap: 12 }}>
      <View style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 16 }]}>
        <StatusRing
          total={ringkasan.total}
          t={t}
          segments={[
            { key: "selesai", value: ringkasan.selesai, color: t.GREEN },
            { key: "jalan", value: ringkasan.jalan, color: t.ACCENT },
            { key: "gagal", value: ringkasan.gagal, color: t.RED },
            { key: "sisa", value: ringkasan.sisa, color: t.INK3 },
          ]}
        />
        <View style={{ flex: 1, gap: 9 }}>
          <LegendRow color={t.GREEN} label="Selesai" value={ringkasan.selesai} styles={styles} />
          <LegendRow color={t.ACCENT} label="Jalan" value={ringkasan.jalan} styles={styles} />
          <LegendRow color={t.RED} label="Gagal" value={ringkasan.gagal} styles={styles} />
          <LegendRow color={t.INK3} label="Sisa" value={ringkasan.sisa} styles={styles} />
        </View>
      </View>

      <Text style={styles.sectionTitle}>Rute Hari Ini ({ringkasan.routes.length})</Text>
      {ringkasan.routes.length === 0 ? (
        <Text style={styles.emptyText}>Belum ada rute untuk hari ini.</Text>
      ) : (
        ringkasan.routes.map((r) => (
          <View key={r.id} style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Route size={14} color={t.ACCENT} />
                <Text style={styles.cardTitle}>{r.code}</Text>
              </View>
              <Text style={styles.cardMeta}>{r.selesai}/{r.total} selesai{r.gagal > 0 ? ` · ${r.gagal} gagal` : ""}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
              {r.driverName && <Avatar name={r.driverName} avatarUrl={r.driverAvatarUrl} size={20} />}
              {r.helperName && <Avatar name={r.helperName} avatarUrl={r.helperAvatarUrl} size={20} />}
              <Text style={styles.cardMeta}>{namaTimRute(r)}</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${r.total ? Math.round((r.selesai / r.total) * 100) : 0}%` }]} />
            </View>
          </View>
        ))
      )}

      {/* Aktivitas Terbaru (13 Sep 2026) — job SELESAI/GAGAL hari ini,
          terbaru dulu, referensi "Daily Activities" app fitness: dispatcher
          lihat pulsa lapangan tanpa pindah ke tab Masalah/Driver. */}
      <Text style={styles.sectionTitle}>Aktivitas Terbaru</Text>
      {aktivitas.length === 0 ? (
        <Text style={styles.emptyText}>Belum ada job selesai/gagal hari ini.</Text>
      ) : (
        <View style={styles.card}>
          {aktivitas.map((item, i) => (
            <View key={item.id}>
              {i > 0 && <View style={{ height: 1, backgroundColor: t.BORDER, marginVertical: 10 }} />}
              <AktivitasRow item={item} t={t} styles={styles} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function DriverView({ drivers: tim, theme: t, styles }) {
  if (tim.length === 0) return <Text style={styles.emptyText}>Belum ada driver bertugas hari ini.</Text>;
  return (
    <View style={{ gap: 10 }}>
      {tim.map((d) => {
        const namaTim = [d.driver?.name, d.helper?.name].filter(Boolean).join(" + ") || "Tanpa nama";
        // Online = toggle SALAH SATU anggota tim menyala (bukan cuma driver
        // — helper juga bisa nyalakan togglenya sendiri di app masing-
        // masing). Sama semangat dgn driverOnline di turunkanKendaraan().
        const online = !!(d.driver?.isOnline || d.helper?.isOnline);
        return (
          <View key={d.key} style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
                <View style={{ flexDirection: "row" }}>
                  {d.driver && <Avatar name={d.driver.name} avatarUrl={d.driver.avatarUrl} size={28} />}
                  {d.helper && (
                    <View style={{ marginLeft: d.driver ? -8 : 0, borderRadius: 14, borderWidth: 2, borderColor: t.SURFACE }}>
                      <Avatar name={d.helper.name} avatarUrl={d.helper.avatarUrl} size={28} />
                    </View>
                  )}
                </View>
                {/* Titik Online/Offline (12 Sep 2026) — BUKAN "sedang jalan"
                    (badge "Di jalan" di sebelah kanan sudah pakai itu), ini
                    murni toggle manual tiap orang di app-nya. */}
                <View style={[styles.onlineDot, { backgroundColor: online ? t.GREEN : t.INK3 }]} />
                <Text style={styles.cardTitle} numberOfLines={1}>{namaTim}</Text>
                {/* Chip peran cuma perlu kalau SOLO (tanpa pasangan) —
                    kalau berdua, "A + B" sudah cukup jelas siapa driver
                    (nama pertama) & siapa helper (nama kedua), sama
                    konvensi dengan namaTimRute() di HariIniView. */}
                {!(d.driver && d.helper) && (
                  <View style={styles.roleChip}>
                    <Text style={styles.roleChipText}>{d.driver ? "Driver" : "Helper"}</Text>
                  </View>
                )}
              </View>
              {d.jalan > 0 ? (
                <View style={styles.liveBadge}>
                  <Truck size={11} color={t.ACCENT} />
                  <Text style={styles.liveBadgeText}>Di jalan</Text>
                </View>
              ) : (
                <Text style={styles.cardMeta}>Tidak sedang jalan</Text>
              )}
            </View>
            <View style={styles.driverStatsRow}>
              <Text style={styles.driverStat}><Text style={{ color: t.GREEN }}>{d.selesai}</Text> selesai</Text>
              <Text style={styles.driverStat}><Text style={{ color: t.ACCENT }}>{d.jalan}</Text> jalan</Text>
              <Text style={styles.driverStat}><Text style={{ color: d.gagal > 0 ? t.RED : t.INK2 }}>{d.gagal}</Text> gagal</Text>
              <Text style={styles.driverStat}><Text style={{ color: t.INK2 }}>{d.sisa}</Text> sisa</Text>
            </View>
            {d.lastSeen && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }}>
                <Clock size={11} color={t.INK3} />
                <Text style={styles.lastSeenText}>Posisi terakhir {relatifWaktu(d.lastSeen)}</Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

// Marker stop/depot — View biasa (bukan Marker.image) supaya warnanya ikut
// tema langsung. tracksViewChanges={false} SENGAJA (bukan lupa) — marker di
// sini statis sekali render per posisi baru (key sudah termasuk jobId/
// vehicleId, bukan lat/lng, lihat pemanggil), true di sini cuma memboroskan
// render setiap frame tanpa manfaat, pola umum react-native-maps utk custom
// marker yang tidak animasi. Marker DRIVER beda urusan (foto = async), lihat
// components/DriverMapMarker.js.
function DestinationMarkerDot({ t }) {
  return (
    <View style={[dotStyles.wrap, { backgroundColor: t.RED, borderColor: t.SURFACE }]}>
      <MapPin size={13} color="#FFFFFF" />
    </View>
  );
}
// 3 marker stop baru (14 Sep 2026, D-165) — sama semangat dgn
// stopIconDone/stopIconFailed/stopIcon di googleMapIcons.js web, versi View
// biasa (bukan SVG data-URI, react-native-maps custom marker = children
// biasa) supaya warnanya ikut tema tanpa perlu hex manual per tema.
function StopDoneMarkerDot({ t }) {
  return (
    <View style={[dotStyles.wrap, dotStyles.wrapKecil, { backgroundColor: t.GREEN, borderColor: t.SURFACE }]}>
      <CheckCircle2 size={12} color="#FFFFFF" />
    </View>
  );
}
function StopFailedMarkerDot({ t }) {
  return (
    <View style={[dotStyles.wrap, dotStyles.wrapKecil, { backgroundColor: t.RED, borderColor: t.SURFACE }]}>
      <XCircle size={12} color="#FFFFFF" />
    </View>
  );
}
function StopNumberMarkerDot({ t, nomor }) {
  return (
    <View style={[dotStyles.wrap, dotStyles.wrapKecil, { backgroundColor: t.INK3, borderColor: t.SURFACE }]}>
      <Text style={{ fontSize: 10, fontWeight: "800", color: "#FFFFFF" }}>{nomor}</Text>
    </View>
  );
}
const dotStyles = StyleSheet.create({
  wrap: {
    width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center",
    borderWidth: 2,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3, elevation: 4,
  },
  wrapKecil: { width: 22, height: 22, borderRadius: 11 },
});

const JAKARTA_CENTER = { latitude: -6.2088, longitude: 106.8456, latitudeDelta: 0.15, longitudeDelta: 0.15 };

// Klinik Matras (depot) — kotak gelap + ikon rumah, sama bahasa visual dgn
// depotIcon() web (googleMapIcons.js). Titik berangkat semua rute.
function DepotMarkerDot() {
  return (
    <View style={[dotStyles.wrap, { borderRadius: 8, backgroundColor: "#1D1D1F", borderColor: "#FFFFFF" }]}>
      <Home size={13} color="#FFFFFF" />
    </View>
  );
}

// Peta Live Tracking — D-165 + D-166 (14 September 2026, owner: "mekanisme
// nya seperti delivery shopee, grab, gojek" + "rute ini sudah diterbitkan,
// tapi kenapa di live tracking 0 rute aktif? ... ketika gps belum aktif
// atau driver belum menyalakan tombol online pakai aja icon driver yang
// masih di klinik matras"). Per rute terbit hari ini: stop tuntas (hijau/
// merah), tujuan sekarang (pin merah), stop menunggu (bernomor), depot
// Klinik Matras, dan driver di posisi GPS asli ATAU di Klinik Matras kalau
// GPS belum ada. Jalur rencana (driver belum jalan) digambar PUTUS-PUTUS
// supaya tidak dikira driver sudah berangkat.
//
// Garis mengikuti JALAN sungguhan (19 September 2026, laporan owner: "maps
// nya kayak ga mengikuti pattern jalan... masih ga sesuai dengan google
// maps") — dari GET /armada/route-path, yang di belakangnya Google
// Directions: SUMBER YANG SAMA dengan Google Maps di HP driver, jadi garis
// di sini benar-benar cocok dengan yang dia lihat. Percobaan sebelumnya
// (18 Sep) memakai OSRM demo publik langsung dari HP — road-matched, tapi
// datanya OpenStreetMap jadi belokannya masih sering beda dari Google.
// Garis LURUS tetap dirender duluan sebagai fallback instan sampai hasilnya
// datang ATAU kalau semua sumber gagal.
function TrackingMap({ kendaraan, t, dark, jalurByVehicle, setJalurByVehicle }) {
  const mapRef = useRef(null);
  const [siap, setSiap] = useState(false);
  // `siap` HARUS reset ke false setiap `dark` berganti — MapView di-remount
  // lewat `key` (fix "maps ga ikut light mode"), instance native BARU belum
  // tentu siap dipanggil fitToCoordinates. Pola "adjusting state saat prop
  // berubah" (sama dengan prevJobId di JobCard.js).
  const [prevDark, setPrevDark] = useState(dark);
  if (dark !== prevDark) {
    setPrevDark(dark);
    setSiap(false);
  }

  const depot = kendaraan[0]?.depot || null;

  // Driver di Klinik Matras (tanpa GPS) digeser sedikit dari titik depot —
  // supaya tidak menutupi ikon depot & tidak saling tumpuk. GPS asli TIDAK
  // pernah digeser. Sama dengan web.
  const posisiDigambar = useMemo(() => {
    const m = new Map();
    const diDepot = kendaraan.filter((v) => v.position.source === "depot");
    diDepot.forEach((v, i) => {
      const sudut = Math.PI / 4 + (2 * Math.PI * i) / Math.max(diDepot.length, 1);
      m.set(v.vehicleId, { latitude: v.position.lat + 0.0035 * Math.sin(sudut), longitude: v.position.lng + 0.0035 * Math.cos(sudut) });
    });
    for (const v of kendaraan) {
      if (v.position.source !== "depot") m.set(v.vehicleId, { latitude: v.position.lat, longitude: v.position.lng });
    }
    return m;
  }, [kendaraan]);

  // `jalurByVehicle` datang dari TrackingView (state diangkat ke sana — ETA
  // di kartu memakai `legs` dari permintaan yang SAMA). Isinya per
  // kendaraan: { traveled, upcoming }, masing-masing { coords, legs }.
  // Sumbernya GET /armada/route-path (Google Directions lewat backend,
  // lihat catatan di services/maps.js#routePath) — GANTI dari OSRM demo
  // publik yang dulu dipanggil langsung dari HP, yang jalurnya sering tidak
  // cocok dengan Google Maps yang dilihat driver.
  //
  // vehicleId -> true begitu foto marker-nya selesai dimuat; sebelum itu
  // marker harus terus di-track supaya snapshot-nya ikut fotonya.
  const [markerSiap, setMarkerSiap] = useState({});
  const titikStr = (p) => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`;
  const sinyalJalur = kendaraan
    .map((v) => {
      const posisi = posisiDigambar.get(v.vehicleId);
      const keKoord = (s) => ({ latitude: s.lat, longitude: s.lng });
      return [
        v.vehicleId, posisi ? titikStr(posisi) : "-",
        ...v.done.filter(punyaKoordinat).map((s) => titikStr(keKoord(s))),
        v.active && punyaKoordinat(v.active) ? titikStr(keKoord(v.active)) : "-",
        ...v.pending.filter(punyaKoordinat).map((s) => titikStr(keKoord(s))),
      ].join(":");
    })
    .join("|");
  useEffect(() => {
    let batal = false;
    for (const v of kendaraan) {
      const posisi = posisiDigambar.get(v.vehicleId);
      if (!posisi) continue;
      const keLatLng = (s) => [s.lat, s.lng];
      const traveledPts = v.position.source === "gps"
        ? [...v.done.filter(punyaKoordinat).map(keLatLng), [posisi.latitude, posisi.longitude]]
        : [];
      const upcomingPts = [
        [posisi.latitude, posisi.longitude],
        ...(v.active && punyaKoordinat(v.active) ? [keLatLng(v.active)] : []),
        ...v.pending.filter(punyaKoordinat).map(keLatLng),
      ];
      // Diam-diam gagal (catch kosong) — jalur cuma hiasan di atas data
      // yang sudah benar; kalau Google/LocationIQ tidak terjangkau, peta
      // TETAP berguna dengan garis lurus, tidak perlu mengganggu admin.
      if (traveledPts.length >= 2) {
        api.getRoutePath(traveledPts)
          .then((hasil) => {
            if (!batal && hasil?.coords) setJalurByVehicle((prev) => ({ ...prev, [v.vehicleId]: { ...prev[v.vehicleId], traveled: hasil } }));
          })
          .catch(() => {});
      }
      if (upcomingPts.length >= 2) {
        api.getRoutePath(upcomingPts)
          .then((hasil) => {
            if (!batal && hasil?.coords) setJalurByVehicle((prev) => ({ ...prev, [v.vehicleId]: { ...prev[v.vehicleId], upcoming: hasil } }));
          })
          .catch(() => {});
      }
    }
    return () => { batal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinyalJalur]);

  // Fit ulang HANYA kalau kumpulan rute/stop berubah — BUKAN tiap GPS driver
  // bergeser (poll 30 detik), supaya peta tidak "melompat" merebut kontrol
  // dari admin yang sedang geser/zoom (audit performa 13 Sep 2026).
  const sinyalFit = kendaraan
    .map((v) => [v.vehicleId, v.position.source, ...v.stops.filter(punyaKoordinat).map((s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`)].join(":"))
    .join("|");
  useEffect(() => {
    if (!siap || !mapRef.current || kendaraan.length === 0) return;
    const titik = [];
    if (depot) titik.push({ latitude: depot.lat, longitude: depot.lng });
    for (const v of kendaraan) {
      titik.push(posisiDigambar.get(v.vehicleId));
      for (const s of v.stops) if (punyaKoordinat(s)) titik.push({ latitude: s.lat, longitude: s.lng });
    }
    mapRef.current.fitToCoordinates(titik, { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siap, sinyalFit, dark]);

  return (
    <View style={{ height: 300, borderRadius: 14, overflow: "hidden", marginBottom: 10 }}>
      <MapView
        // key berisi `dark` (14 Sep 2026, "maps ga ikut light mode") —
        // react-native-maps Android tidak menerapkan ULANG customMapStyle
        // setelah instance dibuat; key yang berubah memaksa MapView baru.
        key={dark ? "dark" : "light"}
        ref={mapRef}
        style={{ flex: 1 }}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        initialRegion={JAKARTA_CENTER}
        customMapStyle={dark ? MAP_STYLE_DARK : undefined}
        onMapReady={() => setSiap(true)}
      >
        {depot && (
          <Marker
            key="depot"
            coordinate={{ latitude: depot.lat, longitude: depot.lng }}
            title={depot.label || "Klinik Matras"}
            description="Titik berangkat semua rute"
            tracksViewChanges={false}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <DepotMarkerDot />
          </Marker>
        )}

        {kendaraan.map((v) => {
          const posisi = posisiDigambar.get(v.vehicleId);
          const jalan = v.phase === "EN_ROUTE" || v.phase === "ARRIVED";
          const keKoord = (s) => ({ latitude: s.lat, longitude: s.lng });
          // Jalur "sudah dilalui" cuma kalau GPS asli — dari Klinik Matras
          // tanpa GPS tidak ada yang bisa diklaim sudah dilalui.
          const traveled = v.position.source === "gps" ? [...v.done.filter(punyaKoordinat).map(keKoord), posisi] : [];
          const upcoming = [
            posisi,
            ...(v.active && punyaKoordinat(v.active) ? [keKoord(v.active)] : []),
            ...v.pending.filter(punyaKoordinat).map(keKoord),
          ];
          // Road-matched OSRM kalau sudah datang, fallback garis lurus di
          // atas selagi menunggu/kalau gagal (lihat catatan panjang di atas).
          const jalur = jalurByVehicle[v.vehicleId];
          const traveledRoad = jalur?.traveled?.coords?.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
          const upcomingRoad = jalur?.upcoming?.coords?.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
          const traveledGambar = traveledRoad?.length >= 2 ? traveledRoad : traveled;
          const upcomingGambar = upcomingRoad?.length >= 2 ? upcomingRoad : upcoming;
          return (
            <React.Fragment key={v.vehicleId}>
              {traveledGambar.length >= 2 && <Polyline coordinates={traveledGambar} strokeColor={t.INK3} strokeWidth={3} />}
              {upcomingGambar.length >= 2 && (
                <Polyline
                  coordinates={upcomingGambar}
                  strokeColor={t.ACCENT}
                  strokeWidth={3}
                  lineDashPattern={jalan ? undefined : [8, 8]}
                />
              )}

              {/* key = HANYA jobId/vehicleId, bukan lat/lng — GPS jitter tidak
                  boleh memicu remount marker (audit performa 13 Sep 2026). */}
              {v.stops.filter(punyaKoordinat).map((s) => {
                const isActive = s === v.active;
                const tuntas = STATUS_TUNTAS.has(s.status);
                return (
                  <Marker
                    key={`stop-${s.jobId}`}
                    coordinate={keKoord(s)}
                    title={`Stop ${s.sequence} — ${s.customerName || ""}`}
                    description={isActive
                      ? `${labelFase(v)} · ${s.addressText || ""}`
                      : s.status === "COMPLETED" ? "Selesai" : tuntas ? "Gagal / dijadwal ulang" : "Belum dimulai"}
                    tracksViewChanges={false}
                    anchor={{ x: 0.5, y: 0.5 }}
                    zIndex={isActive ? 3 : 2}
                  >
                    {isActive
                      ? <DestinationMarkerDot t={t} />
                      : tuntas
                        ? (s.status === "COMPLETED" ? <StopDoneMarkerDot t={t} /> : <StopFailedMarkerDot t={t} />)
                        : <StopNumberMarkerDot t={t} nomor={s.sequence} />}
                  </Marker>
                );
              })}

              <Marker
                key={`driver-${v.vehicleId}`}
                coordinate={posisi}
                title={[v.driverName, v.helperName].filter(Boolean).join(" + ") || "Belum ada driver"}
                description={v.position.source === "gps"
                  ? `${v.routeCode || "Kurir Eksternal"} · ${labelFase(v)} · ${kesegaranGps(v.lastPosition?.recordedAt).label}`
                  : "GPS belum aktif — ditampilkan di Klinik Matras"}
                // Foto itu async — snapshot marker HARUS menunggu sampai
                // fotonya termuat, lalu berhenti (lihat DriverMapMarker.js).
                tracksViewChanges={!markerSiap[v.vehicleId]}
                anchor={{ x: 0.5, y: 0.5 }}
                zIndex={4}
              >
                <DriverMapMarker
                  borderColor={t.SURFACE}
                  orang={[
                    { name: v.driverName, avatarUrl: v.driverAvatarUrl },
                    { name: v.helperName, avatarUrl: v.helperAvatarUrl },
                  ]}
                  onSiap={() => setMarkerSiap((prev) => (prev[v.vehicleId] ? prev : { ...prev, [v.vehicleId]: true }))}
                />
              </Marker>
            </React.Fragment>
          );
        })}
      </MapView>
    </View>
  );
}

// Tab Live Tracking — D-165 + D-166 (14 Sep 2026). Data SAMA dengan papan
// Live Tracking web (GET /armada/tracking), ikut poll 30 detik useAdminToday.
// Peta di atas + SATU kartu per rute terbit hari ini: status sekarang
// ("Belum Berangkat" / "Sedang Menuju" / "Tiba Di Lokasi" / "Berikutnya" /
// "Rute Selesai"), progress stop tuntas, tujuan aktif menonjol, status GPS
// jujur ("GPS belum aktif" kalau belum ada), expand utk seluruh urutan stop.
function TrackingView({ tracking, theme: t, styles }) {
  const dark = t.statusBarStyle === "light"; // konvensi token, lihat theme.js
  const kendaraan = useMemo(
    () => (tracking || []).map(turunkanKendaraan).filter((v) => v.position),
    [tracking]
  );
  const [expandedVehicleId, setExpandedVehicleId] = useState(null);
  // State jalur DIANGKAT ke sini (19 September 2026) — yang mengambilnya
  // tetap TrackingMap (dia yang punya posisi titik gambar), tapi kartu di
  // bawah peta juga butuh `legs`-nya untuk ETA "berapa lama lagi sampai
  // stop berikutnya", jadi satu permintaan dipakai dua tempat.
  const [jalurByVehicle, setJalurByVehicle] = useState({});

  // Peta SELALU dirender (13 Sep 2026, konfirmasi owner) — walau belum ada
  // rute, sama dengan web.
  return (
    <View style={{ gap: 10 }}>
      <TrackingMap
        kendaraan={kendaraan}
        t={t}
        dark={dark}
        jalurByVehicle={jalurByVehicle}
        setJalurByVehicle={setJalurByVehicle}
      />
      {kendaraan.length === 0 && (
        <View style={[styles.center, { flex: 0, paddingVertical: 28 }]}>
          <Navigation size={28} color={t.INK3} />
          <Text style={[styles.emptyText, { marginTop: 8 }]}>Belum ada rute yang diterbitkan untuk hari ini.</Text>
        </View>
      )}
      {kendaraan.map((v) => {
        const total = v.stops.length;
        const selesai = v.done.length;
        const expanded = expandedVehicleId === v.vehicleId;
        const gps = v.position.source === "gps";
        const asal = gps ? `${v.position.lat},${v.position.lng}` : v.depot ? `${v.depot.lat},${v.depot.lng}` : null;
        const tujuan = v.active
          ? punyaKoordinat(v.active)
            ? `${v.active.lat},${v.active.lng}`
            : v.active.addressText ? encodeURIComponent(v.active.addressText) : null
          : null;
        const posisiUrl = gps ? `https://www.google.com/maps?q=${v.position.lat},${v.position.lng}` : null;
        const ruteUrl = asal && tujuan ? `https://www.google.com/maps/dir/?api=1&origin=${asal}&destination=${tujuan}` : null;
        // GPS belum pernah ada sama sekali (driver di Klinik Matras) beda
        // dari GPS basi — yang pertama bukan "terhenti", memang belum mulai.
        const segar = gps ? kesegaranGps(v.lastPosition?.recordedAt) : { key: "none", label: "GPS belum aktif", color: "INK3", live: false };
        // Leg PERTAMA jalur "upcoming" = posisi driver -> stop aktif, jadi
        // ETA ke tujuan sekarang. Cuma ditampilkan kalau GPS masih segar —
        // ETA dihitung dari posisi terakhir, dan posisi basi bikin ETA-nya
        // ikut bohong (lebih buruk dari tidak menampilkan apa-apa).
        const etaDetik = segar.live ? jalurByVehicle[v.vehicleId]?.upcoming?.legs?.[0]?.durationSeconds : null;
        const eta = formatEta(etaDetik);
        return (
          <View key={v.vehicleId} style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
                {/* Foto driver + helper (18 September 2026, permintaan owner)
                    — 2 avatar kalau rute punya keduanya, sama pola dgn kartu
                    "Rute Hari Ini" di HariIniView. */}
                <View style={{ flexDirection: "row" }}>
                  {v.driverName && <Avatar name={v.driverName} avatarUrl={v.driverAvatarUrl} size={26} />}
                  {v.helperName && (
                    <View style={{ marginLeft: -8, borderRadius: 13, borderWidth: 2, borderColor: t.SURFACE }}>
                      <Avatar name={v.helperName} avatarUrl={v.helperAvatarUrl} size={26} />
                    </View>
                  )}
                </View>
                <View style={[styles.onlineDot, { backgroundColor: v.driverOnline ? t.GREEN : t.INK3 }]} />
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {v.driverName || "Belum ada driver"}{v.helperName ? ` + ${v.helperName}` : ""}
                </Text>
              </View>
              {/* Badge kesegaran GPS (19 September 2026) — SEBELUMNYA selalu
                  "Live" asal pernah ada ping, walau ping terakhir 26 menit
                  lalu (laporan owner). Sekarang jujur: Live / Tertunda /
                  Terhenti, lihat kesegaranGps() di jobHelpers.js. */}
              <View style={[styles.liveBadge, { backgroundColor: t[segar.color] + "26" }]}>
                {segar.live
                  ? <Navigation size={11} color={t[segar.color]} />
                  : <WifiOff size={11} color={t[segar.color]} />}
                <Text style={[styles.liveBadgeText, { color: t[segar.color] }]}>{segar.label}</Text>
              </View>
            </View>
            <Text style={[styles.cardMeta, { marginTop: 2 }]}>
              {v.routeCode || "Kurir Eksternal"} · {selesai}/{total} stop tuntas
            </Text>

            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${total ? Math.round((selesai / total) * 100) : 0}%` }]} />
            </View>

            {/* Status sekarang + tujuan aktif — sama semangat kartu status
                app Grab/Gojek (referensi owner). */}
            <View style={{ backgroundColor: t.TRACK_BG, borderRadius: 10, padding: 8, marginTop: 8 }}>
              <View style={styles.rowBetween}>
                <Text style={{ fontSize: 10, fontWeight: "800", letterSpacing: 0.3, textTransform: "uppercase", color: t.ACCENT }}>
                  {labelFase(v)}
                </Text>
                {/* ETA Google (memperhitungkan macet saat ini) — lihat
                    departure_time=now di services/maps.js#routePathGoogle. */}
                {eta && (
                  <View style={styles.etaBadge}>
                    <Clock size={10} color={t.ACCENT} />
                    <Text style={styles.etaBadgeText}>± {eta} lagi</Text>
                  </View>
                )}
              </View>
              {v.active ? (
                <>
                  <Text style={[styles.cardMeta, { color: t.INK, fontWeight: "700", marginTop: 2 }]} numberOfLines={1}>
                    Stop {v.active.sequence} · {v.active.customerName || "—"}
                  </Text>
                  <Text style={styles.cardMeta}>
                    {v.active.orderNumber || "—"} · {v.active.type === "PICKUP" ? "Pengambilan" : "Pengiriman"}
                  </Text>
                  {v.active.addressText ? (
                    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4, marginTop: 4 }}>
                      <MapPin size={11} color={t.INK3} style={{ marginTop: 1 }} />
                      <Text style={[styles.cardMeta, { flex: 1 }]} numberOfLines={2}>{v.active.addressText}</Text>
                    </View>
                  ) : null}
                  {!punyaKoordinat(v.active) && (
                    <Text style={[styles.cardMeta, { color: t.ORANGE, marginTop: 2 }]}>Alamat ini belum punya titik peta.</Text>
                  )}
                </>
              ) : (
                <Text style={[styles.cardMeta, { marginTop: 2 }]}>Semua stop di rute ini sudah tuntas.</Text>
              )}
            </View>

            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4, marginTop: 6 }}>
              {gps ? <Clock size={11} color={t.INK3} style={{ marginTop: 1 }} /> : <Home size={11} color={t.INK3} style={{ marginTop: 1 }} />}
              <Text style={[styles.lastSeenText, { flex: 1 }]}>
                {gps
                  ? `Posisi terakhir ${relatifWaktu(v.lastPosition?.recordedAt)}${v.lastPosition?.accuracy ? ` · akurasi ±${Math.round(v.lastPosition.accuracy)}m` : ""}`
                  : "Ditampilkan di Klinik Matras sampai driver mulai jalan"}
              </Text>
            </View>

            {/* Penjelasan kenapa posisinya basi (19 September 2026, diperluas
                setelah laporan owner: "itu maksudnya tertunda apa ya? tapi
                di sistem mereka online ada icon hijau nya menyala") — dua
                sinyal BEDA yang gampang disangka sama: titik hijau kecil di
                atas cuma toggle manual "siap kerja" driver (AuthContext#
                setOnline, TIDAK menyentuh GPS sama sekali); badge & pesan
                ini soal PING GPS yang benar-benar masuk ke server. Driver
                bisa Online tapi GPS-nya basi — paling sering karena app
                driver BARU pasang versi background-tracking (izin lokasi
                "Izinkan sepanjang waktu" belum disetujui) atau HP-nya
                (umum di Xiaomi/Oppo/Vivo) membatasi app di background
                walau sudah minta foreground service. Disebut eksplisit di
                sini supaya admin tahu APA yang perlu dicek ke driver,
                bukan cuma "kenapa titiknya diam". */}
            {segar.key === "tertunda" || segar.key === "terhenti" ? (
              <View style={[styles.gpsWarn, { backgroundColor: t[segar.color] + "18" }]}>
                <Text style={[styles.gpsWarnText, { color: t[segar.color] }]}>
                  {segar.key === "terhenti"
                    ? "Status \"Online\" driver TIDAK BERARTI GPS-nya aktif — ini soal beda: sudah lama tidak ada ping GPS masuk. Titik di peta BUKAN posisi sekarang. Kemungkinan izin lokasi \"Izinkan sepanjang waktu\" belum diaktifkan di HP driver, app tertutup total, atau HP-nya membatasi aplikasi di background (umum di Xiaomi/Oppo/Vivo) — cek ke driver."
                    : "Ping GPS agak tertinggal dari status Online-nya — titik di peta mungkin sudah bergeser. Kalau berlanjut, minta driver cek izin lokasi \"Izinkan sepanjang waktu\" & nonaktifkan pembatasan baterai untuk app ini."}
                </Text>
              </View>
            ) : null}

            {(posisiUrl || ruteUrl) && (
              <View style={styles.quickActions}>
                {posisiUrl && (
                  <Pressable style={styles.quickBtn} onPress={() => Linking.openURL(posisiUrl)}>
                    <MapPin size={13} color={t.ACCENT} />
                    <Text style={styles.quickBtnText}>Lihat Posisi</Text>
                  </Pressable>
                )}
                {ruteUrl && (
                  <Pressable style={styles.quickBtn} onPress={() => Linking.openURL(ruteUrl)}>
                    <Navigation size={13} color={t.ACCENT} />
                    <Text style={styles.quickBtnText}>{gps ? "Rute ke Tujuan" : "Rute dari Klinik"}</Text>
                  </Pressable>
                )}
              </View>
            )}

            {total > 1 && (
              <Pressable
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8, marginTop: 2 }}
                onPress={() => setExpandedVehicleId(expanded ? null : v.vehicleId)}
              >
                <Text style={{ fontSize: 11, fontWeight: "700", color: t.INK3 }}>
                  {expanded ? "Sembunyikan urutan stop" : `Lihat semua ${total} stop`}
                </Text>
                {expanded ? <ChevronUp size={12} color={t.INK3} /> : <ChevronDown size={12} color={t.INK3} />}
              </Pressable>
            )}

            {expanded && (
              <View style={{ marginTop: 2, gap: 8, borderTopWidth: 1, borderTopColor: t.BORDER, paddingTop: 8 }}>
                {v.stops.map((s) => {
                  const isActive = s === v.active;
                  return (
                    <View key={s.jobId} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      {s.status === "COMPLETED" ? (
                        <CheckCircle2 size={14} color={t.GREEN} />
                      ) : STATUS_TUNTAS.has(s.status) ? (
                        <XCircle size={14} color={t.RED} />
                      ) : (
                        <View style={{
                          width: 14, height: 14, borderRadius: 7, alignItems: "center", justifyContent: "center",
                          backgroundColor: isActive ? t.ACCENT : t.TRACK_BG,
                        }}>
                          <Text style={{ fontSize: 8, fontWeight: "800", color: isActive ? "#FFFFFF" : t.INK3 }}>{s.sequence}</Text>
                        </View>
                      )}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.cardMeta, { color: isActive ? t.ACCENT : t.INK, fontWeight: "600" }]} numberOfLines={1}>
                          {s.customerName || "—"}{!punyaKoordinat(s) ? "  · tanpa titik peta" : ""}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

// Tab "Rute" (13 Sep 2026, D-163) — 2 sub-tab:
// - Aktif: rute yang masih punya job berjalan HARI INI, admin bisa BANTU
//   update status (JobCard, komponen SAMA dengan driver, lihat catatan
//   header file) — jawab langsung permintaan owner "bantu update jalur
//   yang sedang dijalani ... driver lupa update juga di apps driver".
// - Riwayat: rute yang SUDAH selesai (status COMPLETED), read-only, tap
//   utk buka detail stop-nya — jawab "history rute yang selesai beserta
//   datanya ... tanpa harus buka web".
// Chip "Aktif"/"Riwayat" — diekstrak jadi komponen sendiri (13 Sep 2026,
// audit performa) supaya bisa dipakai DUA tempat: di dalam RuteView
// (ScrollView bersama, sub-tab Aktif) DAN sebagai header RiwayatRuteView
// (FlashList sendiri, sub-tab Riwayat) — dua kontainer scroll BERBEDA
// (lihat catatan di RiwayatRuteView), tapi kontrolnya harus konsisten.
function RuteSubTabs({ subRute, setSubRute, styles }) {
  return (
    <View style={styles.periodeRow}>
      {RUTE_SUB.map((s) => (
        <Pressable
          key={s.key}
          style={[styles.periodeChip, subRute === s.key && styles.periodeChipActive]}
          onPress={() => setSubRute(s.key)}
        >
          <Text style={[styles.periodeChipText, subRute === s.key && styles.periodeChipTextActive]}>{s.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// RuteView SEKARANG cuma menangani sub-tab "Aktif" (13 Sep 2026, audit
// performa) — "Riwayat" dipindah jadi cabang render TERPISAH di
// AdminHomeScreen (RiwayatRuteView, FlashList sendiri). Alasan: FlashList
// TIDAK BOLEH disarangkan di dalam ScrollView orientasi sama (peringatan
// resmi RN) yang membungkus komponen ini — kalau dipaksa, virtualisasinya
// jadi percuma total (ScrollView induk tetap me-render semua item
// sekaligus). RuteAktifSubView TIDAK ikut divirtualisasi — datanya
// dibatasi jumlah armada (8 orang, CLAUDE.md §1), bukan tumbuh tanpa batas
// seperti riwayat.
function RuteView({ subRute, setSubRute, ruteAktif, onChanged, theme: t, styles }) {
  return (
    <View style={{ gap: 12 }}>
      <RuteSubTabs subRute={subRute} setSubRute={setSubRute} styles={styles} />
      <RuteAktifSubView ruteAktif={ruteAktif} onChanged={onChanged} t={t} styles={styles} />
    </View>
  );
}

function RuteAktifSubView({ ruteAktif, onChanged, t, styles }) {
  if (ruteAktif.length === 0) {
    return (
      <View style={styles.center}>
        <Route size={28} color={t.INK3} />
        <Text style={[styles.emptyText, { marginTop: 8 }]}>Tidak ada rute aktif hari ini.</Text>
      </View>
    );
  }
  return (
    <View style={{ gap: 16 }}>
      {ruteAktif.map((r) => {
        const selesai = r.jobs.filter((j) => j.status === "COMPLETED").length;
        return (
          <View key={r.id}>
            <View style={styles.rowBetween}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Route size={14} color={t.ACCENT} />
                <Text style={styles.cardTitle}>{r.code}</Text>
              </View>
              <Text style={styles.cardMeta}>{selesai}/{r.jobs.length} selesai</Text>
            </View>
            <View style={{ marginBottom: 8 }}>
              <Text style={styles.cardMeta}>{namaTimRute(r)}</Text>
            </View>
            {r.jobs.map((j) => (
              <JobCard key={j.id} job={j} onChanged={onChanged} />
            ))}
          </View>
        );
      })}
    </View>
  );
}

function statusRuteLabel(status) {
  switch (status) {
    case "COMPLETED": return "Selesai";
    case "FAILED": return "Gagal";
    case "EN_ROUTE": return "Menuju Lokasi";
    case "ARRIVED": return "Tiba di Lokasi";
    default: return "Belum Jalan";
  }
}

function RiwayatRuteItem({ route, expanded, onToggle, t, styles }) {
  const { total, selesai, gagal } = hitungRute(route);
  const tanggal = route.date
    ? new Date(route.date).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })
    : "—";
  return (
    <Pressable style={styles.card} onPress={onToggle}>
      <View style={styles.rowBetween}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Route size={14} color={t.ACCENT} />
          <Text style={styles.cardTitle}>{route.code}</Text>
        </View>
        {expanded ? <ChevronUp size={16} color={t.INK3} /> : <ChevronDown size={16} color={t.INK3} />}
      </View>
      <Text style={[styles.cardMeta, { marginTop: 4 }]}>
        {tanggal} · {route.driver?.name || "Tanpa driver"}{route.helper?.name ? ` & ${route.helper.name}` : ""}
      </Text>
      <Text style={styles.cardMeta}>
        {selesai}/{total} selesai{gagal > 0 ? ` · ${gagal} gagal` : ""}
      </Text>

      {expanded && (
        <View style={{ marginTop: 10, gap: 8, borderTopWidth: 1, borderTopColor: t.BORDER, paddingTop: 10 }}>
          {(route.jobs || []).length === 0 ? (
            <Text style={styles.cardMeta}>Tidak ada stop di rute ini.</Text>
          ) : (
            [...route.jobs].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)).map((j) => (
              <View key={j.id}>
                {/* returnToDepotBefore (D-164, 13 Sep 2026) — sama pola
                    dengan RouteCard.jsx web: pita di ATAS stop yang
                    ditandai, bukan entri terpisah di daftar. */}
                {j.returnToDepotBefore && (
                  <Text style={[styles.cardMeta, { color: t.ORANGE, fontWeight: "700", marginBottom: 3 }]}>
                    🏠 Kembali ke Klinik Matras dulu
                  </Text>
                )}
              <View style={{ backgroundColor: t.TRACK_BG, borderRadius: 10, padding: 8 }}>
                <View style={styles.rowBetween}>
                  <Text style={[styles.cardMeta, { fontWeight: "700", color: t.INK }]} numberOfLines={1}>
                    {customerOf(j) || "Tanpa nama"}
                  </Text>
                  <Text style={[styles.cardMeta, { color: j.status === "FAILED" ? t.RED : t.GREEN }]}>
                    {statusRuteLabel(j.status)}
                  </Text>
                </View>
                <Text style={styles.cardMeta}>
                  {orderNumberOf(j) || "—"} · {j.type === "PICKUP" ? "Pengambilan" : "Pengiriman"}
                </Text>
                {j.addressText ? <Text style={styles.cardMeta} numberOfLines={2}>{j.addressText}</Text> : null}
                {j.status === "FAILED" && j.failureReason ? (
                  <Text style={[styles.cardMeta, { color: t.RED, marginTop: 2 }]} numberOfLines={2}>{j.failureReason}</Text>
                ) : null}
              </View>
              </View>
            ))
          )}
        </View>
      )}
    </Pressable>
  );
}

// FlashList SUNGGUHAN (13 Sep 2026, audit performa — GANTI dari
// RiwayatRuteSubView yang ScrollView+.map() polos). Riwayat Rute adalah
// SATU-SATUNYA list di app ini yang datanya tumbuh tanpa batas alami
// seiring waktu (rute selesai terus bertambah tiap hari, "Muat Lebih
// Banyak" bisa dipencet berkali-kali sampai take mencapai ratusan) — jadi
// satu-satunya yang benar-benar butuh virtualisasi, bukan sekadar ikut-
// ikutan. Dirender sebagai SIBLING hero/BottomNavBar di AdminHomeScreen
// (bukan child ScrollView bersama) — pola SAMA PERSIS dengan FlashList di
// JobListScreen.js (isLoading/error/empty di-cek DULU sebelum FlashList
// dipasang, bukan lewat ListEmptyComponent, supaya centering styles.center
// konsisten dengan pola yang sudah terbukti jalan di sana).
function RiwayatRuteView({ subRute, setSubRute, riwayat, riwayatTake, setRiwayatTake, theme: t, styles }) {
  const { data, isLoading, error, isFetching } = riwayat;
  const routes = data?.routes || [];
  const [expandedId, setExpandedId] = useState(null);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <RuteSubTabs subRute={subRute} setSubRute={setSubRute} styles={styles} />
      </View>
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={t.ACCENT} /></View>
      ) : error ? (
        <View style={styles.center}><Text style={styles.errorText}>Gagal memuat riwayat: {error.message}</Text></View>
      ) : routes.length === 0 ? (
        <View style={styles.center}>
          <Route size={28} color={t.INK3} />
          <Text style={[styles.emptyText, { marginTop: 8 }]}>Belum ada rute yang selesai.</Text>
        </View>
      ) : (
        <FlashList
          data={routes}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => (
            <RiwayatRuteItem
              route={item}
              expanded={expandedId === item.id}
              onToggle={() => setExpandedId((cur) => (cur === item.id ? null : item.id))}
              t={t}
              styles={styles}
            />
          )}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          // Heuristik "mungkin masih ada lagi": kalau jumlah baris yang
          // balik PERSIS sama dengan take yang diminta, kemungkinan besar
          // dipotong limit, bukan memang cuma segitu jumlahnya.
          ListFooterComponent={
            routes.length >= riwayatTake ? (
              <Pressable
                style={styles.secondaryBtn}
                onPress={() => setRiwayatTake((n) => n + RIWAYAT_PAGE_SIZE)}
                disabled={isFetching}
              >
                <Text style={styles.secondaryBtnText}>{isFetching ? "Memuat…" : "Muat Lebih Banyak"}</Text>
              </Pressable>
            ) : null
          }
          contentContainerStyle={styles.body}
        />
      )}
    </View>
  );
}

function MasalahView({ issues, theme: t, styles }) {
  if (issues.length === 0) {
    return (
      <View style={styles.center}>
        <CheckCircle2 size={28} color={t.GREEN} />
        <Text style={[styles.emptyText, { marginTop: 8 }]}>Tidak ada masalah terbuka.</Text>
      </View>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      {issues.map((j) => (
        <View key={j.id} style={[styles.card, { borderColor: t.RED + "4D", borderWidth: 1 }]}>
          <View style={styles.rowBetween}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <XCircle size={14} color={t.RED} />
              <Text style={styles.cardTitle}>{j.order?.customer?.name || "Tanpa nama"}</Text>
            </View>
            <Text style={styles.cardMeta}>{relatifWaktu(j.updatedAt)}</Text>
          </View>
          <Text style={styles.issueReason}>{j.failureReason || j.rescheduleReason || "Tidak ada alasan tercatat"}</Text>
          <Text style={styles.cardMeta}>
            {j.order?.orderNumber || "—"} · {j.driver?.name || "Belum ada driver"} · {j.type === "PICKUP" ? "Pengambilan" : "Pengiriman"}
          </Text>
        </View>
      ))}
    </View>
  );
}

// Tab Performa (13 Sep 2026, D-162 — GANTI dari versi "per jalur" 12 Sep,
// cara Klinik Matras SUNGGUHAN menghitung insentif adalah per ALAMAT
// selesai, bukan per Rute: "1 pelanggan, lokasi sama, tanggal sama, ambil
// dan kirim hingga finish = dihitung 1, tapi kalau pelanggan yang sama
// order lagi di lain hari/minggu/bulan tetap dihitung lagi". Tarif beda
// tergantung SIM (Rp7.000/alamat kalau punya, Rp3.000 kalau tidak) — dari
// data yang sama, GET /armada/incentive-summary. Query terpisah dari
// useAdminToday (rentang tanggalnya beda, bukan "hari ini") — lihat
// useIncentiveSummary.js.
function PerformaView({ performa, periode, setPeriode, theme: t, styles }) {
  const { data, isLoading, error, refetch, isRefetching } = performa;
  const orang = data?.orang || [];
  // Detail alamat/resi (13 Sep 2026, laporan owner: "ketika diklik bisa
  // kasih detail alamat/resi order mana aja dari masing-masing driver?")
  // — tap kartu utk buka/tutup daftarnya inline, data-nya SUDAH ikut
  // respons (field `detail` per orang), tidak perlu panggilan API kedua.
  const [expandedId, setExpandedId] = useState(null);
  return (
    <ScrollView
      contentContainerStyle={styles.body}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.ACCENT} />}
    >
      <View style={styles.periodeRow}>
        {PERIODE_PRESET.map((p) => (
          <Pressable
            key={p.key}
            style={[styles.periodeChip, periode === p.key && styles.periodeChipActive]}
            onPress={() => setPeriode(p.key)}
          >
            <Text style={[styles.periodeChipText, periode === p.key && styles.periodeChipTextActive]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={t.ACCENT} /></View>
      ) : error ? (
        <View style={styles.center}><Text style={styles.errorText}>Gagal memuat: {error.message}</Text></View>
      ) : orang.length === 0 ? (
        <Text style={styles.emptyText}>Belum ada alamat selesai di periode ini.</Text>
      ) : (
        <View style={{ gap: 10 }}>
          {orang.map((o, i) => {
            const expanded = expandedId === o.id;
            return (
              <Pressable key={o.id} style={styles.card} onPress={() => setExpandedId(expanded ? null : o.id)}>
                <View style={styles.rowBetween}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Avatar name={o.name} avatarUrl={o.avatarUrl} size={26} />
                    <Award size={14} color={i === 0 ? t.ORANGE : t.INK3} />
                    <Text style={styles.cardTitle}>{o.name}</Text>
                    <View style={[styles.simBadge, { backgroundColor: o.hasSim ? t.GREEN + "26" : t.INK3 + "26" }]}>
                      <Text style={[styles.simBadgeText, { color: o.hasSim ? t.GREEN : t.INK3 }]}>
                        {o.hasSim ? "SIM" : "Tanpa SIM"}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.kpiValue, { fontSize: 16 }]}>{o.totalAlamat} <Text style={styles.cardMeta}>alamat</Text></Text>
                </View>
                <View style={styles.driverStatsRow}>
                  <Text style={styles.driverStat}>Sebagai driver: <Text style={{ color: t.ACCENT }}>{o.asDriver}</Text></Text>
                  <Text style={styles.driverStat}>Sebagai helper: <Text style={{ color: t.ACCENT }}>{o.asHelper}</Text></Text>
                </View>
                <Text style={[styles.driverStat, { marginTop: 4, fontWeight: "700", color: t.ACCENT }]}>
                  {formatRupiah(o.totalInsentif)} <Text style={{ color: t.INK3, fontWeight: "600" }}>({formatRupiah(o.ratePerAlamat)}/alamat)</Text>
                </Text>

                {expanded && (
                  <View style={{ marginTop: 10, gap: 6, borderTopWidth: 1, borderTopColor: t.BORDER, paddingTop: 8 }}>
                    {(o.detail || []).length === 0 ? (
                      <Text style={styles.cardMeta}>Tidak ada data.</Text>
                    ) : (
                      o.detail.map((d) => (
                        <View key={`${d.orderId}-${d.date}`} style={{ backgroundColor: t.TRACK_BG, borderRadius: 10, padding: 8 }}>
                          <View style={styles.rowBetween}>
                            <Text style={[styles.cardMeta, { fontWeight: "700", color: t.INK }]}>{d.orderNumber}</Text>
                            <Text style={styles.cardMeta}>{new Date(d.date).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}</Text>
                          </View>
                          <Text style={[styles.cardMeta, { color: t.INK, marginTop: 2 }]}>{d.customerName}</Text>
                          <Text style={styles.cardMeta} numberOfLines={2}>{d.addressText}</Text>
                        </View>
                      ))
                    )}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.NAVY },
    hero: {
      marginHorizontal: 16, marginTop: 8, marginBottom: 14,
      shadowColor: t.ACCENT, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 16, elevation: 6,
    },
    heroTopRow: { flexDirection: "row", alignItems: "flex-start" },
    heroGreeting: { fontSize: 19, fontWeight: "800", color: "#FFFFFF" },
    heroSubtitle: { fontSize: 12, color: "rgba(255,255,255,0.8)", marginTop: 2 },
    heroLogoutBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.35)" },
    heroLogoutText: { color: "#FFFFFF", fontWeight: "700", fontSize: 12 },
    heroStatsRow: {
      flexDirection: "row", marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.18)",
    },
    heroStat: { flex: 1, alignItems: "center" },
    heroStatValue: { color: "#FFFFFF", fontSize: 18, fontWeight: "800" },
    heroStatLabel: { color: "rgba(255,255,255,0.78)", fontSize: 10.5, marginTop: 2, fontWeight: "600" },
    center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingTop: 40, paddingBottom: 80 },
    errorText: { color: t.RED, fontSize: 13, textAlign: "center" },
    emptyText: { color: t.INK2, fontSize: 13, textAlign: "center" },
    // paddingBottom 96 (bukan 24) — ruang buat BottomNavBar melayang
    // (fase 2 redesign, lihat BottomNavBar.js) supaya card terakhir tidak
    // ketutupan bar.
    body: { paddingHorizontal: 16, paddingBottom: 96 },
    kpiValue: { color: t.INK, fontSize: 20, fontWeight: "800" },
    // Ring status + legend (13 Sep 2026) — gantikan kpiGrid/kpi/kpiLabel
    // lama (5 kartu angka datar). legendRow pakai justify space-between
    // supaya dot+label nempel kiri, angka rapat kanan (rata kolom, sama
    // pola dengan driverStatsRow).
    legendRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    legendDot: { width: 9, height: 9, borderRadius: 5 },
    legendLabel: { color: t.INK2, fontSize: 12.5, fontWeight: "600" },
    legendValue: { color: t.INK, fontSize: 13.5, fontWeight: "800" },
    activityIconWrap: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
    sectionTitle: { color: t.INK, fontSize: 14, fontWeight: "700", marginTop: 4 },
    card: {
      backgroundColor: t.SURFACE, borderRadius: 14, padding: 12,
      shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2,
    },
    rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    cardTitle: { color: t.INK, fontSize: 13.5, fontWeight: "700" },
    cardMeta: { color: t.INK2, fontSize: 11, marginTop: 1 },
    progressTrack: { height: 5, borderRadius: 3, backgroundColor: t.TRACK_BG, marginTop: 8, overflow: "hidden" },
    progressFill: { height: 5, borderRadius: 3, backgroundColor: t.ACCENT },
    liveBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: t.ACCENT_BG, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100 },
    liveBadgeText: { color: t.ACCENT, fontSize: 10.5, fontWeight: "700" },
    etaBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: t.ACCENT_BG, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 100 },
    etaBadgeText: { color: t.ACCENT, fontSize: 10, fontWeight: "800" },
    gpsWarn: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, marginTop: 6 },
    gpsWarnText: { fontSize: 10.5, lineHeight: 15, fontWeight: "600" },
    driverStatsRow: { flexDirection: "row", gap: 14, marginTop: 8 },
    driverStat: { color: t.INK2, fontSize: 11.5, fontWeight: "600" },
    lastSeenText: { color: t.INK3, fontSize: 10.5 },
    issueReason: { color: t.ORANGE, fontSize: 12, fontWeight: "600", marginTop: 6 },
    onlineDot: { width: 8, height: 8, borderRadius: 4 },
    roleChip: { backgroundColor: t.ACCENT_BG, borderRadius: 100, paddingHorizontal: 7, paddingVertical: 2 },
    roleChipText: { color: t.ACCENT, fontSize: 9.5, fontWeight: "700" },
    periodeRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
    periodeChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 100, borderWidth: 1, borderColor: t.BORDER },
    periodeChipActive: { backgroundColor: t.ACCENT_BG, borderColor: t.ACCENT },
    periodeChipText: { color: t.INK2, fontSize: 12, fontWeight: "600" },
    periodeChipTextActive: { color: t.ACCENT },
    simBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 100 },
    simBadgeText: { fontSize: 9, fontWeight: "700" },
    // Sama dengan quickActions/quickBtn di JobCard.js (duplikasi kecil,
    // file style terpisah) — dipakai tombol "Lihat Posisi"/"Rute ke
    // Tujuan" di tab Live Tracking.
    quickActions: { flexDirection: "row", gap: 8, marginTop: 10 },
    quickBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: t.ACCENT_BG, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
    quickBtnText: { color: t.ACCENT, fontSize: 11.5, fontWeight: "600" },
    // Tombol "Muat Lebih Banyak" (Riwayat Rute, 13 Sep 2026) — sama pola
    // secondaryBtn di JobCard.js (border tipis, bukan isi), file style
    // terpisah jadi duplikasi kecil, bukan reuse lintas komponen.
    secondaryBtn: { borderWidth: 1, borderColor: t.BORDER, borderRadius: 12, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
    secondaryBtnText: { color: t.INK2, fontWeight: "600", fontSize: 13.5 },
  });
}
