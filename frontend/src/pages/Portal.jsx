import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Wrench, Truck, Gauge, Loader2 } from "lucide-react";
import { api } from "../api.js";
import { PageContainer, PageHeader } from "@/components/ui/page.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { cn } from "@/lib/utils.js";

// Landing portal Sano Hub (PRD §4). Halaman AWAL setelah login mulai Phase 1
// (Gilang, 31 Juli 2026: "di tampilan awal website gue ingin ada main menu
// untuk masing-masing divisi") — Bengkel sekarang punya isi nyata (Papan
// Produksi Harian), jadi kartu "Segera"-nya sudah tidak jujur lagi.
//
// Role tunggal LANGSUNG lompat ke portalnya, TANPA lewat layar pemilih (PRD
// §4: "Single role → skip the chooser and go straight in"). Ini yang membuat
// perpindahan landing dari /dashboard ke sini AMAN untuk 5 sales existing:
// mereka cuma punya role SALES → cuma satu portal (Growth) → tetap mendarat
// langsung di /dashboard seperti sebelumnya, tidak ada yang berubah dari sisi
// mereka. Yang melihat layar pemilih hanya user dengan LEBIH dari satu portal
// (mis. admin, atau siapa pun yang nanti pegang dua role).
//
// Redesign (1 Agustus 2026, Gilang): kartu jadi ubin app-launcher — ikon
// besar bertinta warna divisi, label di bawah, terpusat — referensi visual
// yang diberikan (Redhub-style: grid ikon berwarna, bukan kartu deskripsi
// panjang). Warna per divisi di sini adalah SATU-SATUNYA sumber kebenaran
// aksen — Layout.jsx (sidebar) memakai peta yang SAMA (DIVISION_ACCENT)
// supaya "masuk ke satu divisi = seluruh tampilan kerja ikut berubah warna"
// terasa sebagai satu sistem, bukan dua tempat yang bisa saling drift.

export const PORTAL_ICONS = {
  growth: Users,
  bengkel: Wrench,
  armada: Truck,
  kendali: Gauge,
};

// Aksen warna per portal — dipakai di sini (ubin) DAN Layout.jsx (badge
// divisi + sidebar). Satu tempat, dua pemakai — lihat catatan di atas.
export const PORTAL_ACCENT = {
  growth:  { icon: "text-blue-600 bg-blue-50", ring: "group-hover:ring-blue-200", glow: "group-hover:shadow-blue-100" },
  bengkel: { icon: "text-amber-600 bg-amber-50", ring: "group-hover:ring-amber-200", glow: "group-hover:shadow-amber-100" },
  armada:  { icon: "text-emerald-600 bg-emerald-50", ring: "group-hover:ring-emerald-200", glow: "group-hover:shadow-emerald-100" },
  kendali: { icon: "text-violet-600 bg-violet-50", ring: "group-hover:ring-violet-200", glow: "group-hover:shadow-violet-100" },
};

// Portal yang belum punya isi. Ditandai eksplisit supaya tidak ada yang
// mengklik lalu mendarat di halaman kosong tanpa penjelasan. Semua 4 portal
// (growth/bengkel/armada/kendali) sekarang punya isi nyata — set ini sengaja
// dibiarkan ada (bukan dihapus) supaya pola penandaan "belum siap" tetap
// tersedia kalau ada portal baru ditambahkan nanti.
const BELUM_SIAP = new Set([]);

function PortalTile({ portal, belumSiap, onOpen }) {
  const Icon = PORTAL_ICONS[portal.key] || Users;
  const accent = PORTAL_ACCENT[portal.key] || { icon: "bg-slate-100 text-slate-600", ring: "", glow: "" };

  return (
    <div
      role="button"
      tabIndex={belumSiap ? -1 : 0}
      aria-disabled={belumSiap}
      onClick={() => !belumSiap && onOpen(portal)}
      onKeyDown={(e) => {
        if (belumSiap) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(portal);
        }
      }}
      className={cn(
        "group flex flex-col items-center gap-3 rounded-2xl bg-surface p-6 text-center shadow-card transition-all duration-150",
        "ring-1 ring-transparent",
        belumSiap
          ? "cursor-not-allowed opacity-50"
          : cn("cursor-pointer hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40", accent.ring, accent.glow)
      )}
    >
      <div className={cn("flex h-16 w-16 items-center justify-center rounded-2xl transition-transform duration-150", accent.icon, !belumSiap && "group-hover:scale-105")}>
        <Icon className="h-7 w-7" strokeWidth={1.75} />
      </div>

      <div>
        <div className="flex items-center justify-center gap-1.5">
          <h3 className="text-[14px] font-semibold text-ink">{portal.label}</h3>
          {belumSiap && (
            <span className="rounded bg-inset px-1.5 py-0.5 text-[10px] font-medium text-ink2">Segera</span>
          )}
        </div>
        <p className="mt-1 text-[12px] leading-snug text-ink2">{portal.description}</p>
      </div>
    </div>
  );
}

export default function Portal() {
  const navigate = useNavigate();
  const [portals, setPortals] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let batal = false;
    api
      .getMyPortals()
      .then((me) => {
        if (batal) return;
        const list = me.portals || [];
        // Role tunggal -> lompat langsung, jangan tampilkan layar pemilih
        // untuk satu-satunya pilihan yang ada (PRD §4).
        if (list.length === 1) {
          navigate(list[0].path, { replace: true });
          return;
        }
        setPortals(list);
      })
      .catch((err) => !batal && setError(err.message));
    return () => {
      batal = true;
    };
  }, [navigate]);

  if (error) {
    return (
      <PageContainer>
        <EmptyState
          title="Gagal memuat daftar portal"
          description={error}
        />
      </PageContainer>
    );
  }

  if (!portals) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center gap-2 py-16 text-ink2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Memuat portal…</span>
        </div>
      </PageContainer>
    );
  }

  if (portals.length === 0) {
    return (
      <PageContainer>
        <EmptyState
          title="Belum ada portal untuk akun ini"
          description="Akun Anda belum diberi role. Hubungi admin untuk mendapatkan akses."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Sano Hub"
        subtitle="Pilih area kerja Anda — setiap divisi punya menu & tampilan kerja sendiri."
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {portals.map((portal) => (
          <PortalTile
            key={portal.key}
            portal={portal}
            belumSiap={BELUM_SIAP.has(portal.key)}
            onOpen={(p) => navigate(p.path)}
          />
        ))}
      </div>
    </PageContainer>
  );
}
