import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Wrench, Truck, Gauge, Package, Loader2, ArrowRight, Plus, Calendar } from "lucide-react";
import { api } from "../api.js";
import { PageContainer } from "@/components/ui/page.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { WORKSPACE_ART } from "@/features/portal/WorkspaceArt.jsx";
import { cn } from "@/lib/utils.js";

// Landing portal SANSS (PRD §4). Halaman AWAL setelah login.
//
// Role tunggal LANGSUNG lompat ke portalnya, TANPA lewat layar pemilih (PRD
// §4: "Single role → skip the chooser and go straight in"). Ini yang membuat
// perpindahan landing dari /dashboard ke sini AMAN untuk 5 sales existing:
// mereka cuma punya role SALES → cuma satu portal → tetap mendarat langsung
// di /dashboard seperti sebelumnya.
//
// ─── TIRU PENUH FILE DESAIN v4 (1 Agustus 2026, keputusan Gilang) ──────────
// Struktur & visual sekarang mengikuti docs/design-system/
// SANSS-integrated-smart-system-v4.html section `.hub-page` SEPERSIS mungkin:
// welcome line + date chip → `.hub-stage` putih → hero biru dengan ilustrasi
// kasur → `.hub-intro` → grid kartu 12 kolom dengan ilustrasi SVG per divisi.
//
// DUA hal dari mockup yang SENGAJA TIDAK ditiru, keduanya soal kejujuran data:
//  1. Mockup memakai angka hardcode (`24 lead`, `18 work order`, dst). Di sini
//     angka SELALU dari GET /auth/portal-summary. Kartu yang belum punya
//     angka menampilkan "Buka workspace", BUKAN angka contoh — kartu yang
//     memajang angka palsu lebih berbahaya daripada kartu tanpa angka.
//  2. Chip mengambang di hero juga dari data nyata, dan HILANG total kalau
//     datanya tidak ada — bukan placeholder kosong.
//
// Klik kartu tetap LANGSUNG ke halaman kerja divisinya (/dashboard, /bengkel,
// …). Halaman "command center" perantara di mockup (`.division-page`) SENGAJA
// tidak dibangun: 6 modul per divisi di sana sebagian besar fitur yang belum
// ada, dan halaman perantara menambah satu klik untuk sales yang tiap hari
// cuma menuju Inbox.

export const PORTAL_ICONS = {
  growth: Users,
  bengkel: Wrench,
  warehouse: Package,
  armada: Truck,
  kendali: Gauge,
};

// Lebar kartu per posisi, meniru `.division-grid` di mockup (12 kolom:
// 3 kartu span-4 di baris pertama, 2 kartu span-6 di baris kedua).
//
// Daftar portal BERGANTUNG ROLE — user bisa melihat 1..5 kartu, bukan selalu
// 5 seperti di mockup. Hardcode pola 5-kartu saja akan menyisakan kolom
// menggantung untuk user lain (mis. 2 portal → 2 kartu sempit + sepertiga
// baris kosong), jadi tiap jumlah punya pola yang menghabiskan 12 kolom.
const SPAN_BY_COUNT = {
  1: [12],
  2: [6, 6],
  3: [4, 4, 4],
  4: [6, 6, 6, 6],
  5: [4, 4, 4, 6, 6],
};
const SPAN_CLASS = {
  4: "xl:col-span-4",
  6: "xl:col-span-6",
  12: "xl:col-span-12",
};

function spanClassFor(index, total) {
  const pattern = SPAN_BY_COUNT[total];
  const span = pattern ? pattern[index] : 4;
  return SPAN_CLASS[span] || SPAN_CLASS[4];
}

// Latar bergaris halus — dipakai hero, header kartu, dan visual kartu gelap.
function gridBackground(color, size) {
  return {
    backgroundImage: `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`,
    backgroundSize: `${size}px ${size}px`,
  };
}

function todayText() {
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

// ── Ilustrasi kasur di hero ────────────────────────────────────────────────
// Port dari `.mattress` + `.art-orbit` di mockup. Murni dekoratif → seluruh
// blok aria-hidden, dan disembunyikan di bawah lg persis seperti mockup
// (`@media(max-width:860px){.hero-art{display:none}}`) supaya di HP ruang
// terpakai untuk teks, bukan hiasan.
function HeroArt({ chips }) {
  return (
    <div aria-hidden className="relative hidden h-[250px] place-items-center lg:grid">
      <div className="absolute h-[180px] w-[330px] -rotate-[8deg] rounded-full border border-white/[0.18]" />
      <div className="absolute h-[260px] w-[260px] rotate-[14deg] rounded-full border border-white/[0.18]" />

      <div
        className="relative h-[150px] w-[330px] rounded-[32px]"
        style={{
          transform: "perspective(800px) rotateX(58deg) rotateZ(-16deg)",
          background: "linear-gradient(145deg,#fff,#DDE9FF)",
          boxShadow: "0 36px 50px rgba(4,20,52,.32), inset 0 -18px 26px rgba(56,113,222,.18)",
        }}
      >
        <div className="absolute inset-[13px] rounded-[24px] border-2 border-dashed border-[rgba(20,87,217,.22)]" />
        <span className="absolute bottom-[26px] right-[42px] rotate-[2deg] text-[20px] font-black tracking-[.12em] text-[#1457D9]">
          SANO
        </span>
      </div>

      {chips.map((chip, i) => (
        <span
          key={chip.text}
          className={cn(
            "absolute flex items-center gap-2 rounded-[14px] bg-white/[0.93] px-3 py-2.5 text-[10px] font-extrabold text-[#10213D] shadow-[0_16px_35px_rgba(2,15,40,.22)]",
            i === 0 ? "left-[18px] top-[28px]" : "bottom-[30px] right-[3px]"
          )}
        >
          <span
            className={cn(
              "h-[9px] w-[9px] rounded-full",
              chip.tone === "amber" ? "bg-[#C87912]" : "bg-[#0D9A6C]"
            )}
          />
          {chip.text}
        </span>
      ))}
    </div>
  );
}

// ── Hero biru ──────────────────────────────────────────────────────────────
function PortalHero({ summary, onOpenDashboard }) {
  // Chip mengambang — maksimal 2 (posisinya di mockup memang cuma dua titik).
  const chips = [];
  if (summary?.bengkel) chips.push({ tone: "emerald", text: `${summary.bengkel.value} unit dikerjakan` });
  if (summary?.warehouse) chips.push({ tone: "amber", text: `${summary.warehouse.value} item di bawah minimum` });
  if (chips.length === 0 && summary?.armada) chips.push({ tone: "emerald", text: `${summary.armada.value} job hari ini` });
  if (chips.length === 0 && summary?.growth) chips.push({ tone: "emerald", text: `${summary.growth.value} lead dalam proses` });

  return (
    <section
      className="relative isolate min-h-[320px] overflow-hidden rounded-[26px] px-6 py-8 text-white sm:px-10 sm:py-[38px] lg:grid lg:grid-cols-[minmax(0,1.02fr)_minmax(420px,.98fr)] lg:items-center"
      style={{
        background:
          "radial-gradient(circle at 9% 18%, rgba(112,164,255,.48), transparent 31%), radial-gradient(circle at 82% 50%, rgba(68,128,246,.48), transparent 36%), linear-gradient(135deg, #071A3A, #1457D9)",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.09]"
        style={{
          ...gridBackground("rgba(255,255,255,.5)", 42),
          maskImage: "linear-gradient(90deg,#000,transparent 82%)",
          WebkitMaskImage: "linear-gradient(90deg,#000,transparent 82%)",
        }}
      />

      <div>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.17] bg-white/[0.08] px-2.5 py-[7px] text-[10px] font-extrabold uppercase tracking-[.08em]">
          <span className="h-[7px] w-[7px] rounded-full bg-[#65EAB9] shadow-[0_0_0_5px_rgba(101,234,185,.11)]" />
          SANSS Operations Platform
        </span>

        <h2 className="mt-[18px] max-w-[620px] text-[35px] font-bold leading-[1.0] tracking-[-.055em] sm:text-[44px] xl:text-[58px]">
          One integrated system for every SANO operation.
        </h2>

        <p className="mt-3 max-w-[560px] text-[15px] leading-[1.6] text-white/[0.72]">
          Dari lead, produksi, inventory, hingga pengiriman—setiap divisi bekerja dengan data
          dan alur yang terhubung di SANSS.
        </p>

        <div className="mt-[25px] flex flex-col gap-2.5 sm:flex-row">
          <button
            type="button"
            onClick={() => onOpenDashboard()}
            className="rounded-[13px] bg-white px-4 py-3 text-[12px] font-extrabold text-[#0B2454] transition-transform hover:-translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            Open integrated dashboard
          </button>
          <button
            type="button"
            onClick={() => onOpenDashboard("/orders")}
            className="inline-flex items-center justify-center gap-1.5 rounded-[13px] border border-white/20 bg-white/[0.08] px-4 py-3 text-[12px] font-extrabold text-white backdrop-blur transition-transform hover:-translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.4} /> Buat order baru
          </button>
        </div>
      </div>

      <HeroArt chips={chips} />
    </section>
  );
}

// ── Kartu satu workspace ───────────────────────────────────────────────────
function WorkspaceCard({ portal, stat, span, onOpen }) {
  const Icon = PORTAL_ICONS[portal.key] || Users;
  const Art = WORKSPACE_ART[portal.key];

  // Kartu "All Teams" memakai varian visual GELAP di mockup
  // (`.division-card.dashboard-card`) — satu-satunya kartu yang beda, sebagai
  // penanda bahwa ia ringkasan lintas divisi, bukan divisi itu sendiri.
  const dark = portal.key === "kendali";

  return (
    // Mockup memakai <button> untuk kartu ini. DI SINI SENGAJA div+role:
    // isi kartu mengandung <h4> dan <p> (flow content), dan menaruh itu di
    // dalam <button> menghasilkan HTML tidak valid — judul kartu juga hilang
    // dari daftar heading yang dipakai pengguna screen reader untuk melompat
    // antar bagian. Perilaku keyboard-nya disamakan manual di onKeyDown
    // (Enter + Space), jadi tidak ada yang berkurang dibanding <button>.
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(portal)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(portal);
        }
      }}
      className={cn(
        "group flex min-h-[342px] cursor-pointer flex-col overflow-hidden rounded-[24px] border border-[#DEE5EF] bg-white text-left",
        "shadow-[0_10px_30px_rgba(15,40,85,.07)] transition-all duration-200",
        "hover:-translate-y-[5px] hover:border-[#B7CBF4] hover:shadow-[0_20px_48px_rgba(15,40,85,.14)]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F73F2] focus-visible:ring-offset-2",
        span
      )}
    >
      {/* Visual atas — ilustrasi SVG per divisi */}
      <div
        className={cn(
          "relative h-[176px] overflow-hidden border-b",
          dark ? "border-[#0A285F]" : "border-[#E2EAF7]"
        )}
        style={
          dark
            ? { background: "linear-gradient(140deg,#0A285F,#174DBA 54%,#3768E7)" }
            : { background: "linear-gradient(145deg,#F8FAFF 0%,#EDF3FF 48%,#DCE8FF 100%)" }
        }
      >
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            ...gridBackground(dark ? "rgba(255,255,255,.10)" : "rgba(30,86,190,.065)", 28),
            maskImage: "linear-gradient(140deg,#000,transparent 82%)",
            WebkitMaskImage: "linear-gradient(140deg,#000,transparent 82%)",
          }}
        />
        <div
          aria-hidden
          className={cn(
            "absolute -right-[70px] -top-[85px] h-[190px] w-[190px] rounded-full",
            dark ? "bg-white/[0.08]" : "bg-[rgba(71,126,235,.10)]"
          )}
        />

        {Art ? (
          <div className="relative z-[1] h-full w-full [&>svg]:h-full [&>svg]:w-full">
            <Art />
          </div>
        ) : (
          // Divisi baru yang belum punya ilustrasi tetap tampil rapi (ikon
          // besar di tengah), bukan kotak kosong.
          <div className="relative z-[1] grid h-full w-full place-items-center">
            <Icon className={cn("h-12 w-12", dark ? "text-white/80" : "text-[#2F73F2]")} strokeWidth={1.6} />
          </div>
        )}

        <span
          className={cn(
            "absolute right-3.5 top-3.5 z-[3] inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[9px] font-extrabold uppercase tracking-[.06em] backdrop-blur",
            dark
              ? "border border-white/[0.18] bg-white/[0.14] text-white"
              : "border border-white/80 bg-white/[0.82] text-[#0D9A6C] shadow-[0_8px_22px_rgba(16,48,104,.08)]"
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" /> Active
        </span>
      </div>

      {/* Isi kartu */}
      <div className="flex min-h-[165px] flex-1 flex-col bg-white px-5 pb-[18px] pt-[19px]">
        <h4 className="text-[18px] font-bold leading-[1.18] tracking-[-.035em] text-[#10213D]">
          {portal.label}
        </h4>
        <p className="mt-[7px] max-w-[430px] text-[11px] leading-[1.55] text-[#6E7E96]">
          {portal.description}
        </p>

        <div className="mt-auto flex items-end justify-between gap-4 pt-3.5">
          {stat ? (
            <div>
              <strong className="block text-[22px] font-bold leading-none tracking-[-.045em] text-[#10213D]">
                {stat.value}
              </strong>
              <span className="mt-[5px] block text-[8px] font-extrabold uppercase tracking-[.09em] text-[#6E7E96]">
                {stat.label}
              </span>
            </div>
          ) : (
            <span className="text-[11px] text-[#6E7E96]">Buka workspace</span>
          )}

          <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[13px] bg-[#F4F7FF] text-[#1457D9] transition-all group-hover:translate-x-[3px] group-hover:bg-[#E8F0FF]">
            <ArrowRight className="h-[17px] w-[17px]" strokeWidth={2} />
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Portal() {
  const navigate = useNavigate();
  const [portals, setPortals] = useState(null);
  const [me, setMe] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let batal = false;
    api
      .getMyPortals()
      .then((data) => {
        if (batal) return;
        const list = data.portals || [];
        // Role tunggal -> lompat langsung, jangan tampilkan layar pemilih
        // untuk satu-satunya pilihan yang ada (PRD §4).
        if (list.length === 1) {
          navigate(list[0].path, { replace: true });
          return;
        }
        setMe(data);
        setPortals(list);
      })
      .catch((err) => !batal && setError(err.message));
    return () => {
      batal = true;
    };
  }, [navigate]);

  // Angka kartu dimuat TERPISAH dan best-effort: kalau endpoint ini gagal,
  // halaman Portal tetap tampil lengkap (kartu tanpa angka), bukan layar error.
  useEffect(() => {
    if (!portals) return;
    let batal = false;
    api.getPortalSummary().then((s) => !batal && setSummary(s)).catch(() => {});
    return () => { batal = true; };
  }, [portals]);

  if (error) {
    return (
      <PageContainer>
        <EmptyState title="Gagal memuat daftar workspace" description={error} />
      </PageContainer>
    );
  }

  if (!portals) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center gap-2 py-16 text-ink2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Memuat workspace…</span>
        </div>
      </PageContainer>
    );
  }

  if (portals.length === 0) {
    return (
      <PageContainer>
        <EmptyState
          title="Belum ada workspace untuk akun ini"
          description="Akun Anda belum diberi role. Hubungi admin untuk mendapatkan akses."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {/* Baris sambutan + tanggal — `.welcome-line` di mockup */}
      <div className="mb-[18px] flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-.035em] text-[#10213D] sm:text-[24px]">
            Welcome to SANSS{me?.name ? `, ${me.name}` : ""} 👋
          </h1>
          <p className="mt-[5px] text-[12px] text-[#6E7E96]">
            Pilih workspace untuk mulai mengelola operasional.
          </p>
        </div>
        <div className="hidden shrink-0 items-center gap-2 rounded-full border border-[#DEE5EF] bg-white px-3 py-2.5 text-[11px] font-bold text-[#657992] sm:inline-flex">
          <Calendar className="h-[15px] w-[15px]" strokeWidth={1.9} />
          <span>{todayText()}</span>
        </div>
      </div>

      {/* Panggung putih yang membungkus hero + grid — `.hub-stage` */}
      <div className="rounded-[30px] border border-[rgba(222,229,239,.85)] bg-white p-3 shadow-[0_20px_55px_rgba(15,40,85,.10)] sm:p-5">
        <PortalHero
          summary={summary}
          onOpenDashboard={(path) => navigate(path || portals[0].path)}
        />

        <div className="mx-1 mb-[15px] mt-[30px] flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="mb-[5px] text-[20px] font-bold tracking-[-.035em] text-[#10213D]">
              Choose your workspace
            </h3>
            <p className="text-[11px] text-[#6E7E96]">
              Masuk ke divisi untuk membuka modul dan aktivitas operasional terkait.
            </p>
          </div>
          <span className="text-[10px] font-extrabold text-[#1457D9]">
            {portals.length} workspace tersedia
          </span>
        </div>

        <div className="grid grid-cols-1 gap-[15px] md:grid-cols-2 xl:grid-cols-12">
          {portals.map((portal, i) => (
            <WorkspaceCard
              key={portal.key}
              portal={portal}
              stat={summary?.[portal.key]}
              span={spanClassFor(i, portals.length)}
              onOpen={(p) => navigate(p.path)}
            />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
