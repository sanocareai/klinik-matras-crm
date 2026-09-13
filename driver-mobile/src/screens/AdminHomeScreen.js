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
import React, { useMemo, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, RefreshControl, Linking, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import Svg, { Circle } from "react-native-svg";
import { Truck, Route, CheckCircle2, XCircle, Clock, Award, Home, AlertTriangle, Navigation, MapPin, ChevronDown, ChevronUp } from "lucide-react-native";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../hooks/useTheme";
import { useAdminToday } from "../hooks/useAdminToday";
import { useIncentiveSummary } from "../hooks/useIncentiveSummary";
import { useRouteHistory } from "../hooks/useRouteHistory";
import { relatifWaktu, formatRupiah, customerOf, orderNumberOf } from "../lib/jobHelpers";
import { MAP_STYLE_DARK } from "../lib/googleMapStyle";
import BottomNavBar from "../components/BottomNavBar";
import GradientCard from "../components/GradientCard";
import JobCard from "../components/JobCard";

// Nav bawah (12 Sep 2026, fase 2 redesign) — menggantikan tab pill yang
// dulu di atas konten, lihat BottomNavBar.js.
// Tab Live Tracking (13 Sep 2026, permintaan owner: "live tracking bisa
// dilakukan di web/apps"; PETA ASLI ditambah sehari kemudian setelah owner
// kirim key Maps Android baru — web sudah punya papan peta penuh di
// ArmadaTracking.jsx, GET /armada/tracking sudah ikut dipanggil
// `useAdminToday` sejak awal). react-native-maps BUTUH native rebuild
// (bukan OTA) — versionCode dinaikkan di app.json, build baru WAJIB
// diinstal manual sekali oleh owner (bukan auto-update lewat OTA seperti
// biasa; OTA jalan normal lagi SETELAH itu). Rute driver->tujuan di sini
// garis LURUS (bukan road-matched OSRM seperti web) — sengaja, supaya tidak
// menduplikasi seluruh services/osrm.js cuma untuk layar ringkasan "sekilas
// lihat", bukan navigasi turn-by-turn.
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

function ringkasHariIni(jobs) {
  const counts = {};
  for (const j of jobs) counts[j.status] = (counts[j.status] || 0) + 1;
  const sisa = (counts.ASSIGNED || 0) + (counts.SCHEDULED || 0) + (counts.UNSCHEDULED || 0);

  const routeMap = new Map();
  for (const j of jobs) {
    if (!j.route) continue;
    let r = routeMap.get(j.route.id);
    if (!r) { r = { id: j.route.id, code: j.route.code, total: 0, selesai: 0, gagal: 0 }; routeMap.set(j.route.id, r); }
    r.total += 1;
    if (j.status === "COMPLETED") r.selesai += 1;
    if (j.status === "FAILED") r.gagal += 1;
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
    if (!r) { r = { id: j.route.id, code: j.route.code, jobs: [] }; byRoute.set(j.route.id, r); }
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

function ringkasDriver(jobs, tracking) {
  const personMap = new Map();
  function sentuh(person, peran) {
    if (!person) return null;
    let d = personMap.get(person.id);
    if (!d) {
      d = {
        id: person.id, name: person.name, total: 0, selesai: 0, gagal: 0, jalan: 0, sisa: 0, lastSeen: null,
        isOnline: !!person.isOnline, onlineSince: person.onlineSince || null,
        roles: new Set(),
      };
      personMap.set(person.id, d);
    }
    d.roles.add(peran);
    return d;
  }
  for (const j of jobs) {
    for (const d of [sentuh(j.driver, "driver"), sentuh(j.helper, "helper")]) {
      if (!d) continue;
      d.total += 1;
      if (j.status === "COMPLETED") d.selesai += 1;
      else if (j.status === "FAILED") d.gagal += 1;
      else if (j.status === "EN_ROUTE" || j.status === "ARRIVED") d.jalan += 1;
      else d.sisa += 1;
    }
  }
  const jobIdToPersonIds = new Map();
  for (const j of jobs) {
    const ids = [];
    if (j.driver) ids.push(j.driver.id);
    if (j.helper) ids.push(j.helper.id);
    jobIdToPersonIds.set(j.id, ids);
  }
  for (const t of tracking) {
    for (const personId of jobIdToPersonIds.get(t.jobId) || []) {
      const d = personMap.get(personId);
      if (d && t.lastPosition?.recordedAt) d.lastSeen = t.lastPosition.recordedAt;
    }
  }
  return [...personMap.values()].sort((a, b) => b.jalan - a.jalan || b.total - a.total);
}

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
  const performa = useIncentiveSummary(from, to);
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

      {tab === "performa" ? (
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
              riwayat={riwayat}
              riwayatTake={riwayatTake}
              setRiwayatTake={setRiwayatTake}
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

// "Driver" / "Helper" / "Driver & Helper" (13 Sep 2026) — pool orang SAMA
// bisa jadi driver di 1 rute dan helper di rute lain (CLAUDE.md §1), jadi
// label ini dihitung per-hari dari `roles` (Set), bukan field tetap di User.
function labelPeran(roles) {
  const arr = [...roles];
  if (arr.length >= 2) return "Driver & Helper";
  return arr[0] === "helper" ? "Helper" : "Driver";
}

function DriverView({ drivers, theme: t, styles }) {
  if (drivers.length === 0) return <Text style={styles.emptyText}>Belum ada driver bertugas hari ini.</Text>;
  return (
    <View style={{ gap: 10 }}>
      {drivers.map((d) => (
        <View key={d.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
              {/* Titik Online/Offline (12 Sep 2026) — BUKAN "sedang jalan"
                  (badge "Di jalan" di sebelah kanan sudah pakai itu), ini
                  murni toggle manual driver di app-nya. */}
              <View style={[styles.onlineDot, { backgroundColor: d.isOnline ? t.GREEN : t.INK3 }]} />
              <Text style={styles.cardTitle} numberOfLines={1}>{d.name}</Text>
              <View style={styles.roleChip}>
                <Text style={styles.roleChipText}>{labelPeran(d.roles)}</Text>
              </View>
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
      ))}
    </View>
  );
}

// Link Google Maps posisi terakhir driver / rute posisi→tujuan — pola SAMA
// dengan mapsUrl() di jobHelpers.js (JobCard.js "Peta"), duplikasi kecil
// karena bentuk datanya beda (item GET /armada/tracking, bukan Job).
function posisiMapsUrl(t) {
  if (!t.lastPosition) return null;
  return `https://www.google.com/maps?q=${t.lastPosition.lat},${t.lastPosition.lng}`;
}
function ruteMapsUrl(t) {
  if (!t.lastPosition) return null;
  const dest = t.destinationLat && t.destinationLng
    ? `${t.destinationLat},${t.destinationLng}`
    : t.addressText ? encodeURIComponent(t.addressText) : null;
  if (!dest) return null;
  return `https://www.google.com/maps/dir/?api=1&origin=${t.lastPosition.lat},${t.lastPosition.lng}&destination=${dest}`;
}

// Marker driver — lingkaran ACCENT + ikon truck, dibuat dari View biasa
// (bukan Marker.image) supaya warnanya ikut tema langsung. tracksViewChanges
//={false} SENGAJA (bukan lupa) — marker di sini statis sekali render per
// posisi baru (key sudah termasuk lat/lng, lihat pemanggil), true di sini
// cuma memboroskan render setiap frame tanpa manfaat, pola umum
// react-native-maps utk custom marker yang tidak animasi.
function DriverMarkerDot({ t }) {
  return (
    <View style={[dotStyles.wrap, { backgroundColor: t.ACCENT, borderColor: t.SURFACE }]}>
      <Truck size={13} color="#FFFFFF" />
    </View>
  );
}
function DestinationMarkerDot({ t }) {
  return (
    <View style={[dotStyles.wrap, { backgroundColor: t.RED, borderColor: t.SURFACE }]}>
      <MapPin size={13} color="#FFFFFF" />
    </View>
  );
}
const dotStyles = StyleSheet.create({
  wrap: {
    width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center",
    borderWidth: 2,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3, elevation: 4,
  },
});

const JAKARTA_CENTER = { latitude: -6.2088, longitude: 106.8456, latitudeDelta: 0.15, longitudeDelta: 0.15 };

// Peta asli (13 Sep 2026) — SEMUA job EN_ROUTE dengan posisi GPS, auto-fit
// ke batas semua marker tiap kali datanya berubah (poll 30 detik). Rute
// posisi->tujuan garis LURUS (lihat catatan di atas import) — beda dari web
// yang road-matched OSRM.
function TrackingMap({ withPosition, withDestination, t, dark }) {
  const mapRef = useRef(null);

  function fitKeSemuaMarker() {
    const map = mapRef.current;
    if (!map) return;
    const titik = [
      ...withPosition.map((j) => ({ latitude: j.lastPosition.lat, longitude: j.lastPosition.lng })),
      ...withDestination.map((j) => ({ latitude: j.destinationLat, longitude: j.destinationLng })),
    ];
    if (titik.length === 0) return;
    map.fitToCoordinates(titik, { edgePadding: { top: 50, right: 50, bottom: 50, left: 50 }, animated: true });
  }

  return (
    <View style={{ height: 260, borderRadius: 14, overflow: "hidden", marginBottom: 10 }}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        initialRegion={
          withPosition.length > 0
            ? { latitude: withPosition[0].lastPosition.lat, longitude: withPosition[0].lastPosition.lng, latitudeDelta: 0.08, longitudeDelta: 0.08 }
            : JAKARTA_CENTER
        }
        customMapStyle={dark ? MAP_STYLE_DARK : undefined}
        onMapReady={fitKeSemuaMarker}
        onLayout={fitKeSemuaMarker}
      >
        {withDestination.map((j) => (
          <Polyline
            key={`jalur-${j.jobId}`}
            coordinates={[
              { latitude: j.lastPosition.lat, longitude: j.lastPosition.lng },
              { latitude: j.destinationLat, longitude: j.destinationLng },
            ]}
            strokeColor={t.ACCENT}
            strokeWidth={3}
          />
        ))}
        {withPosition.map((j) => (
          <Marker
            key={`driver-${j.jobId}-${j.lastPosition.lat.toFixed(5)}-${j.lastPosition.lng.toFixed(5)}`}
            coordinate={{ latitude: j.lastPosition.lat, longitude: j.lastPosition.lng }}
            title={j.driverName || "Driver"}
            description={j.customerName || undefined}
            tracksViewChanges={false}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <DriverMarkerDot t={t} />
          </Marker>
        ))}
        {withDestination.map((j) => (
          <Marker
            key={`tujuan-${j.jobId}`}
            coordinate={{ latitude: j.destinationLat, longitude: j.destinationLng }}
            title={`Tujuan — ${j.customerName || ""}`}
            description={j.addressText || undefined}
            tracksViewChanges={false}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <DestinationMarkerDot t={t} />
          </Marker>
        ))}
      </MapView>
    </View>
  );
}

// Tab Live Tracking (13 Sep 2026) — posisi GPS TERAKHIR tiap job yang
// sedang EN_ROUTE, data SAMA dengan papan Live Tracking web
// (ArmadaTracking.jsx, GET /armada/tracking), sudah ikut poll 30 detik
// `useAdminToday`. Peta asli di atas (TrackingMap) + kartu detail per
// driver di bawah (tombol buka Google Maps eksternal tetap ada — pelengkap
// utk rute turn-by-turn yang peta di dalam app ini tidak coba tiru).
function TrackingView({ tracking, theme: t, styles }) {
  const dark = t.statusBarStyle === "light"; // konvensi token, lihat theme.js
  const withPosition = useMemo(() => tracking.filter((j) => j.lastPosition), [tracking]);
  const withDestination = useMemo(
    () => withPosition.filter((j) => j.destinationLat != null && j.destinationLng != null),
    [withPosition]
  );

  // Peta SELALU dirender (13 Sep 2026, konfirmasi owner: "betul lets do it"
  // — samakan dengan web yang tetap tampilkan peta kosong center Jakarta
  // walau belum ada driver aktif, bukan langsung lompat ke pesan teks).
  // TrackingMap sendiri sudah toleran array kosong (initialRegion fallback
  // JAKARTA_CENTER, fitKeSemuaMarker no-op kalau titik.length===0).
  return (
    <View style={{ gap: 10 }}>
      <TrackingMap withPosition={withPosition} withDestination={withDestination} t={t} dark={dark} />
      {tracking.length === 0 && (
        <View style={[styles.center, { flex: 0, paddingVertical: 28 }]}>
          <Navigation size={28} color={t.INK3} />
          <Text style={[styles.emptyText, { marginTop: 8 }]}>Tidak ada driver yang sedang dalam perjalanan sekarang.</Text>
        </View>
      )}
      {tracking.map((tr) => {
        const posisiUrl = posisiMapsUrl(tr);
        const ruteUrl = ruteMapsUrl(tr);
        return (
          <View key={tr.jobId} style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Truck size={14} color={t.ACCENT} />
                <Text style={styles.cardTitle}>{tr.driverName || "Driver tidak diketahui"}</Text>
              </View>
              {tr.lastPosition ? (
                <View style={styles.liveBadge}>
                  <Navigation size={11} color={t.ACCENT} />
                  <Text style={styles.liveBadgeText}>Live</Text>
                </View>
              ) : (
                <View style={[styles.liveBadge, { backgroundColor: t.INK3 + "26" }]}>
                  <Text style={[styles.liveBadgeText, { color: t.INK3 }]}>Belum ada sinyal GPS</Text>
                </View>
              )}
            </View>

            <Text style={[styles.cardMeta, { color: t.INK, marginTop: 4 }]}>{tr.customerName || "—"}</Text>
            <Text style={styles.cardMeta}>
              {tr.orderNumber || "—"} · {tr.type === "PICKUP" ? "Pengambilan" : "Pengiriman"}
            </Text>
            {tr.addressText ? (
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4, marginTop: 6 }}>
                <MapPin size={11} color={t.INK3} style={{ marginTop: 1 }} />
                <Text style={[styles.cardMeta, { flex: 1 }]} numberOfLines={2}>{tr.addressText}</Text>
              </View>
            ) : null}

            {tr.lastPosition && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }}>
                <Clock size={11} color={t.INK3} />
                <Text style={styles.lastSeenText}>
                  Posisi terakhir {relatifWaktu(tr.lastPosition.recordedAt)}
                  {tr.lastPosition.accuracy ? ` · akurasi ±${Math.round(tr.lastPosition.accuracy)}m` : ""}
                </Text>
              </View>
            )}

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
                    <Text style={styles.quickBtnText}>Rute ke Tujuan</Text>
                  </Pressable>
                )}
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
function RuteView({ subRute, setSubRute, ruteAktif, riwayat, riwayatTake, setRiwayatTake, onChanged, theme: t, styles }) {
  return (
    <View style={{ gap: 12 }}>
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

      {subRute === "aktif" ? (
        <RuteAktifSubView ruteAktif={ruteAktif} onChanged={onChanged} t={t} styles={styles} />
      ) : (
        <RiwayatRuteSubView riwayat={riwayat} riwayatTake={riwayatTake} setRiwayatTake={setRiwayatTake} t={t} styles={styles} />
      )}
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
            <View style={[styles.rowBetween, { marginBottom: 8 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Route size={14} color={t.ACCENT} />
                <Text style={styles.cardTitle}>{r.code}</Text>
              </View>
              <Text style={styles.cardMeta}>{selesai}/{r.jobs.length} selesai</Text>
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
              <View key={j.id} style={{ backgroundColor: t.TRACK_BG, borderRadius: 10, padding: 8 }}>
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
            ))
          )}
        </View>
      )}
    </Pressable>
  );
}

function RiwayatRuteSubView({ riwayat, riwayatTake, setRiwayatTake, t, styles }) {
  const { data, isLoading, error, isFetching } = riwayat;
  const routes = data?.routes || [];
  const [expandedId, setExpandedId] = useState(null);

  if (isLoading) {
    return <View style={styles.center}><ActivityIndicator color={t.ACCENT} /></View>;
  }
  if (error) {
    return <Text style={styles.errorText}>Gagal memuat riwayat: {error.message}</Text>;
  }
  if (routes.length === 0) {
    return (
      <View style={styles.center}>
        <Route size={28} color={t.INK3} />
        <Text style={[styles.emptyText, { marginTop: 8 }]}>Belum ada rute yang selesai.</Text>
      </View>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      {routes.map((r) => (
        <RiwayatRuteItem
          key={r.id}
          route={r}
          expanded={expandedId === r.id}
          onToggle={() => setExpandedId((cur) => (cur === r.id ? null : r.id))}
          t={t}
          styles={styles}
        />
      ))}
      {/* Heuristik "mungkin masih ada lagi": kalau jumlah baris yang balik
          PERSIS sama dengan take yang diminta, kemungkinan besar dipotong
          limit, bukan memang cuma segitu jumlahnya. */}
      {routes.length >= riwayatTake && (
        <Pressable
          style={styles.secondaryBtn}
          onPress={() => setRiwayatTake((n) => n + RIWAYAT_PAGE_SIZE)}
          disabled={isFetching}
        >
          <Text style={styles.secondaryBtnText}>{isFetching ? "Memuat…" : "Muat Lebih Banyak"}</Text>
        </Pressable>
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
