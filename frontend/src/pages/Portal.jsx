import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Wrench, Truck, Gauge, Package, Loader2, ArrowRight, Plus } from "lucide-react";
import { api } from "../api.js";
import { PageContainer } from "@/components/ui/page.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { cn } from "@/lib/utils.js";

// Landing portal SANSS (PRD §4). Halaman AWAL setelah login.
//
// Role tunggal LANGSUNG lompat ke portalnya, TANPA lewat layar pemilih (PRD
// §4: "Single role → skip the chooser and go straight in"). Ini yang membuat
// perpindahan landing dari /dashboard ke sini AMAN untuk 5 sales existing:
// mereka cuma punya role SALES → cuma satu portal → tetap mendarat langsung
// di /dashboard seperti sebelumnya.
//
// REDESIGN SANSS (1 Agustus 2026, Gilang — referensi mockup enterprise
// portal): hero biru gelap + grid kartu workspace. Angka di kartu diambil
// dari GET /auth/portal-summary — ANGKA NYATA, bukan contoh. Mockup aslinya
// memakai angka hardcode; itu sengaja TIDAK ditiru karena kartu yang
// menampilkan angka palsu lebih berbahaya daripada kartu tanpa angka.

export const PORTAL_ICONS = {
  growth: Users,
  bengkel: Wrench,
  warehouse: Package,
  armada: Truck,
  kendali: Gauge,
};

// Aksen per workspace — SATU SUMBER dengan Layout.jsx (sidebar). Warna di
// sini menentukan gradient header kartu; Layout memakai peta yang sama untuk
// aksen sidebar supaya "masuk ke satu workspace = seluruh tampilan ikut
// berubah warna" terasa satu sistem, bukan dua tempat yang bisa drift.
export const PORTAL_ACCENT = {
  growth:    { from: "from-blue-500",    to: "to-blue-700",    tint: "bg-blue-50",    text: "text-blue-700",    ring: "group-hover:ring-blue-300/60" },
  bengkel:   { from: "from-amber-500",   to: "to-amber-700",   tint: "bg-amber-50",   text: "text-amber-700",   ring: "group-hover:ring-amber-300/60" },
  warehouse: { from: "from-sky-500",     to: "to-sky-700",     tint: "bg-sky-50",     text: "text-sky-700",     ring: "group-hover:ring-sky-300/60" },
  armada:    { from: "from-emerald-500", to: "to-emerald-700", tint: "bg-emerald-50", text: "text-emerald-700", ring: "group-hover:ring-emerald-300/60" },
  kendali:   { from: "from-violet-500",  to: "to-violet-700",  tint: "bg-violet-50",  text: "text-violet-700",  ring: "group-hover:ring-violet-300/60" },
};

const FALLBACK_ACCENT = PORTAL_ACCENT.growth;

// ── Hero biru ──────────────────────────────────────────────────────────────
// Panel gradient gelap dengan grid halus + "pill" statistik mengambang,
// meniru struktur mockup. Pill hanya muncul kalau angkanya ADA (workspace
// yang boleh dibuka user ini) — tidak pernah menampilkan placeholder kosong.
function PortalHero({ userName, summary, onOpenDashboard }) {
  const pills = [];
  if (summary?.bengkel) pills.push({ tone: "emerald", text: `${summary.bengkel.value} unit dikerjakan` });
  if (summary?.warehouse) pills.push({ tone: "amber", text: `${summary.warehouse.value} item di bawah minimum` });
  if (pills.length === 0 && summary?.armada) pills.push({ tone: "emerald", text: `${summary.armada.value} job hari ini` });

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0B2A6F] via-[#123C9E] to-[#1D4ED8] px-6 py-8 text-white sm:px-10 sm:py-12">
      {/* Grid halus — murni dekoratif, aria-hidden supaya tidak dibaca screen reader */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)",
          backgroundSize: "46px 46px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-3xl"
      />

      <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            SANSS Operations Platform
          </span>

          <h1 className="mt-5 text-[30px] font-bold leading-[1.12] tracking-tight sm:text-[42px]">
            One integrated system<br className="hidden sm:block" /> for every SANO operation.
          </h1>

          <p className="mt-4 text-[14px] leading-relaxed text-white/75 sm:text-[15px]">
            {userName ? `Halo, ${userName} — ` : ""}
            dari lead, produksi, inventory, hingga pengiriman: setiap divisi bekerja dengan
            data dan alur yang terhubung di SANSS.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => onOpenDashboard()}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-5 text-[14px] font-semibold text-[#123C9E] transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              Open integrated dashboard
            </button>
            <button
              type="button"
              onClick={() => onOpenDashboard("/orders")}
              className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-white/15 px-5 text-[14px] font-semibold text-white backdrop-blur transition-colors hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <Plus className="h-4 w-4" /> Buat order baru
            </button>
          </div>
        </div>

        {pills.length > 0 && (
          <div className="flex flex-col items-start gap-3 lg:items-end">
            {pills.map((p) => (
              <span
                key={p.text}
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[12px] font-semibold text-slate-700 shadow-lg"
              >
                <span className={cn("h-2 w-2 rounded-full", p.tone === "amber" ? "bg-amber-500" : "bg-emerald-500")} />
                {p.text}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Kartu satu workspace ───────────────────────────────────────────────────
function WorkspaceCard({ portal, stat, onOpen }) {
  const Icon = PORTAL_ICONS[portal.key] || Users;
  const accent = PORTAL_ACCENT[portal.key] || FALLBACK_ACCENT;

  return (
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
        "group flex cursor-pointer flex-col overflow-hidden rounded-2xl bg-surface shadow-card ring-1 ring-black/[0.04] transition-all duration-150",
        "hover:-translate-y-1 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        accent.ring
      )}
    >
      {/* Header bergradient — pengganti ilustrasi di mockup. Sengaja BUKAN
          file gambar: menambah 5 ilustrasi berarti 5 aset baru yang harus
          di-maintain, sementara gradient+ikon sudah memberi pembeda visual
          per workspace dengan biaya nol. */}
      <div className={cn("relative h-28 bg-gradient-to-br", accent.from, accent.to)}>
        <div
          aria-hidden
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.7) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div aria-hidden className="absolute -bottom-8 -right-6 h-28 w-28 rounded-full bg-white/15" />
        <div className="absolute left-5 top-5 flex h-11 w-11 items-center justify-center rounded-xl bg-white/95 shadow-sm">
          <Icon className={cn("h-5 w-5", accent.text)} strokeWidth={2} />
        </div>
        <span className="absolute right-4 top-5 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active
        </span>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-[16px] font-semibold leading-snug text-ink">{portal.label}</h3>
        <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-ink2">{portal.description}</p>

        <div className="mt-5 flex items-end justify-between border-t border-border pt-4">
          {stat ? (
            <div>
              <div className="text-[26px] font-bold leading-none text-ink">{stat.value}</div>
              <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink3">{stat.label}</div>
            </div>
          ) : (
            <span className="text-[12px] text-ink3">Buka workspace</span>
          )}
          <span
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-full transition-colors",
              accent.tint, accent.text
            )}
          >
            <ArrowRight className="h-4 w-4" />
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
      <PortalHero
        userName={me?.name}
        summary={summary}
        onOpenDashboard={(path) => navigate(path || portals[0].path)}
      />

      <div className="mt-8 flex items-end justify-between">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-ink">Choose your workspace</h2>
          <p className="mt-1 text-[13px] text-ink2">
            Masuk ke divisi untuk membuka modul dan aktivitas operasional terkait.
          </p>
        </div>
        <span className="hidden shrink-0 text-[12px] font-medium text-accent sm:block">
          {portals.length} workspace tersedia
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {portals.map((portal) => (
          <WorkspaceCard
            key={portal.key}
            portal={portal}
            stat={summary?.[portal.key]}
            onOpen={(p) => navigate(p.path)}
          />
        ))}
      </div>
    </PageContainer>
  );
}
