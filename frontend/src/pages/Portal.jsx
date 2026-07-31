import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Wrench, Truck, Gauge, Loader2 } from "lucide-react";
import { api } from "../api.js";
import { PageContainer, PageHeader } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";

// Landing portal Sano Hub (PRD §4).
//
// ⚠️ PHASE 0 — halaman ini BUKAN halaman default setelah login.
// Rute default tetap /dashboard, persis seperti sebelumnya. Alasannya: portal
// Bengkel/Armada/Kendali masih KOSONG di Phase 0, dan memindahkan 7 orang yang
// sedang bekerja ke layar pemilih berisi tiga kartu mati adalah penurunan
// kualitas, bukan kemajuan.
//
// Halaman ini dijadikan landing default di Phase 1, begitu portalnya berisi.
// Sampai saat itu aksesnya lewat /portal.

const PORTAL_ICONS = {
  growth: Users,
  bengkel: Wrench,
  armada: Truck,
  kendali: Gauge,
};

// Aksen warna per portal — sekadar pembeda visual, bukan makna status.
const PORTAL_ACCENT = {
  growth: "text-blue-600 bg-blue-50",
  bengkel: "text-amber-600 bg-amber-50",
  armada: "text-emerald-600 bg-emerald-50",
  kendali: "text-violet-600 bg-violet-50",
};

// Portal yang belum punya isi di Phase 0. Ditandai eksplisit supaya tidak ada
// yang mengklik lalu mendarat di halaman kosong tanpa penjelasan.
const BELUM_SIAP = new Set(["bengkel", "armada", "kendali"]);

export default function Portal() {
  const navigate = useNavigate();
  const [portals, setPortals] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let batal = false;
    api
      .getMe()
      .then((me) => {
        if (batal) return;
        setPortals(me.portals || []);
      })
      .catch((err) => !batal && setError(err.message));
    return () => {
      batal = true;
    };
  }, []);

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
        subtitle="Pilih area kerja Anda."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {portals.map((portal) => {
          const Icon = PORTAL_ICONS[portal.key] || Users;
          const belumSiap = BELUM_SIAP.has(portal.key);

          return (
            <Card
              key={portal.key}
              role="button"
              tabIndex={belumSiap ? -1 : 0}
              aria-disabled={belumSiap}
              onClick={() => !belumSiap && navigate(portal.path)}
              onKeyDown={(e) => {
                if (belumSiap) return;
                // Kartu yang bisa diklik harus bisa dipakai lewat keyboard juga.
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate(portal.path);
                }
              }}
              className={
                belumSiap
                  ? "cursor-not-allowed p-5 opacity-60"
                  : "cursor-pointer p-5 transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              }
            >
              <div
                className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg ${
                  PORTAL_ACCENT[portal.key] || "bg-slate-100 text-slate-600"
                }`}
              >
                <Icon className="h-5 w-5" />
              </div>

              <div className="mb-1 flex items-center gap-2">
                <h3 className="text-base font-semibold text-ink">{portal.label}</h3>
                {belumSiap && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-ink2">
                    Segera
                  </span>
                )}
              </div>

              <p className="text-sm text-ink2">{portal.description}</p>
            </Card>
          );
        })}
      </div>
    </PageContainer>
  );
}
