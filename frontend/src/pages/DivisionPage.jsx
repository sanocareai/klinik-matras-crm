import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Activity, ListChecks, Loader2 } from "lucide-react";
import { api } from "../api.js";
import { PageContainer } from "@/components/ui/page.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { DIVISION_CONTENT } from "@/features/portal/divisionContent.js";
import { isAdminUser } from "@/lib/roles.js";
import { cn } from "@/lib/utils.js";

// Command center per divisi — port dari `.division-page` di file desain
// SANSS v4 (docs/design-system/SANSS-integrated-smart-system-v4.html).
// Diakses lewat klik kartu di Portal.jsx: /portal/:key.
//
// ⚠️ TIGA PANEL DI MOCKUP (KPI 4-kotak, Recent Activity, Operational Queue)
// SEMUANYA data contoh di file desain — nama pelanggan, ID order, nominal
// Rupiah, SEMUA karangan. Backend cuma py SATU angka nyata per divisi
// (GET /auth/portal-summary, lihat komentarnya). Keputusan Gilang 1 Agustus
// 2026: bangun strukturnya, TAPI isi jujur — bukan tiru angka/baris contoh
// itu. Konsekuensinya:
//   - Hero cuma menonjolkan SATU KPI real (kalau ada), bukan grid 4 kotak.
//     Tidak ada klaim "Operasional sehat"/"Perlu tindakan" — itu penilaian
//     kualitatif yang di mockup tidak berdasar data apa pun, dan mengarang
//     klaim kesehatan sistem lebih berbahaya daripada mengarang angka.
//   - Recent Activity & Operational Queue TETAP py judul section (supaya
//     kerangka halaman kelihatan lengkap seperti mockup) tapi isinya empty
//     state jujur, bukan baris "Nadia P. — Rp18.400.000" yang dikarang.
export default function DivisionPage({ user }) {
  const { key } = useParams();
  const navigate = useNavigate();
  const content = DIVISION_CONTENT[key];
  const isAdmin = isAdminUser(user);

  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(true);

  useEffect(() => {
    let batal = false;
    api.getPortalSummary()
      .then((s) => !batal && setSummary(s))
      .catch(() => {})
      .finally(() => !batal && setLoadingSummary(false));
    return () => { batal = true; };
  }, []);

  if (!content) {
    return (
      <PageContainer>
        <EmptyState title="Workspace tidak ditemukan" description="Kembali ke hub dan pilih workspace yang tersedia." />
      </PageContainer>
    );
  }

  const Icon = content.icon;
  const stat = summary?.[key];
  const visibleModules = content.modules.filter((m) => !m.adminOnly || isAdmin);

  return (
    <PageContainer>
      {/* Breadcrumb — `.breadcrumb` mockup */}
      <div className="mb-2.5 flex items-center gap-2 text-[10px] font-bold text-[#6E7E96]">
        <span>SANSS</span>
        <span>/</span>
        <strong className="text-[#1457D9]">{content.short}</strong>
      </div>

      {/* Header — judul + aksi, `.division-header` mockup */}
      <div className="mb-[18px] flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="grid h-[52px] w-[52px] place-items-center rounded-2xl bg-[#E8F0FF] text-[#1457D9]">
            <Icon className="h-6 w-6" strokeWidth={1.9} />
          </div>
          <div>
            <h1 className="text-[27px] font-bold tracking-[-.04em] text-[#10213D]">{content.title}</h1>
            <p className="mt-[5px] text-[11px] text-[#6E7E96]">{content.subtitle}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate("/portal")}
          className="inline-flex items-center gap-2 rounded-xl border border-[#DEE5EF] bg-white px-3 py-2.5 text-[11px] font-extrabold text-[#536981] transition-colors hover:bg-[#F4F7FF] hover:text-[#1457D9]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.2} /> Back to hub
        </button>
      </div>

      {/* Hero gelap — `.division-hero` mockup, tanpa 4-KPI grid & klaim
          kesehatan sistem (lihat catatan panjang di atas). */}
      <section
        className="relative overflow-hidden rounded-[24px] px-6 py-6 text-white sm:px-[25px] sm:py-[25px]"
        style={{ background: "linear-gradient(135deg, #071A3A, #1457D9)" }}
      >
        <div aria-hidden className="pointer-events-none absolute -right-[85px] -top-[110px] h-[260px] w-[260px] rounded-full border border-white/[0.13]" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-[720px]">
            <h2 className="text-[20px] font-bold tracking-[-.035em] sm:text-[22px]">
              {content.short} command center
            </h2>
            <p className="mt-[7px] text-[11px] leading-[1.6] text-white/[0.65]">
              {content.heroLine}
            </p>
          </div>

          {/* Satu angka nyata, kalau ada. Tidak ada apa pun kalau tidak —
              bukan placeholder kosong yang berpura-pura punya data. */}
          {loadingSummary ? (
            <div className="flex items-center gap-2 text-[11px] text-white/60">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat angka…
            </div>
          ) : stat ? (
            <div className="min-w-[170px] rounded-2xl border border-white/[0.13] bg-white/[0.08] px-4 py-3.5 backdrop-blur">
              <span className="block text-[9px] font-extrabold uppercase tracking-[.08em] text-white/[0.58]">
                {stat.label}
              </span>
              <strong className="mt-1.5 block text-[26px] leading-none tracking-[-.03em]">
                {stat.value}
              </strong>
            </div>
          ) : null}
        </div>
      </section>

      {/* Modul + aktivitas — `.workspace-layout` mockup */}
      <div className="mt-[15px] grid grid-cols-1 gap-[15px] lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,.55fr)]">
        <section className="rounded-[20px] border border-[#DEE5EF] bg-white p-[19px] shadow-[0_10px_30px_rgba(15,40,85,.07)]">
          <div className="mb-[15px]">
            <h3 className="text-[14px] font-bold tracking-[-.02em] text-[#10213D]">Workspace modules</h3>
            <p className="mt-1 text-[9px] text-[#6E7E96]">Akses cepat ke proses utama divisi.</p>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {visibleModules.map((m) => {
              const ModIcon = m.icon;
              const enabled = !!m.path;
              return (
                <button
                  key={m.title}
                  type="button"
                  disabled={!enabled}
                  onClick={() => enabled && navigate(m.path)}
                  className={cn(
                    "flex flex-col rounded-2xl border border-[#DEE5EF] bg-[#FBFCFE] p-[15px] text-left transition-all",
                    enabled
                      ? "hover:-translate-y-0.5 hover:border-[#BCD2FB] hover:bg-[#F4F7FF]"
                      : "cursor-not-allowed opacity-60"
                  )}
                >
                  <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-[#E8F0FF] text-[#1457D9]">
                    <ModIcon className="h-4 w-4" strokeWidth={1.9} />
                  </span>
                  <h4 className="mt-3 text-[12px] font-bold text-[#10213D]">{m.title}</h4>
                  <p className="mt-1 flex-1 text-[9px] leading-relaxed text-[#6E7E96]">{m.description}</p>
                  {!enabled && (
                    <span className="mt-2 inline-flex w-fit items-center rounded-full bg-[#F4F7FF] px-2 py-[3px] text-[8px] font-extrabold uppercase tracking-wide text-[#6E7E96]">
                      Segera hadir
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* Recent activity — struktur mockup, isi EMPTY STATE jujur */}
        <aside className="rounded-[20px] border border-[#DEE5EF] bg-white p-[19px] shadow-[0_10px_30px_rgba(15,40,85,.07)]">
          <div className="mb-1">
            <h3 className="text-[14px] font-bold tracking-[-.02em] text-[#10213D]">Recent activity</h3>
            <p className="mt-1 text-[9px] text-[#6E7E96]">Update terbaru dari tim.</p>
          </div>
          <EmptyState
            icon={Activity}
            title="Belum ada feed real-time"
            description="Aktivitas divisi ini belum tersambung ke data nyata — akan diisi setelah endpoint tersedia."
            className="py-8"
          />
        </aside>
      </div>

      {/* Operational queue — struktur mockup, isi EMPTY STATE jujur */}
      <section className="mt-[15px] rounded-[20px] border border-[#DEE5EF] bg-white p-[19px] shadow-[0_10px_30px_rgba(15,40,85,.07)]">
        <div className="mb-1">
          <h3 className="text-[14px] font-bold tracking-[-.02em] text-[#10213D]">Operational queue</h3>
          <p className="mt-1 text-[9px] text-[#6E7E96]">Antrean kerja real-time untuk divisi ini.</p>
        </div>
        <EmptyState
          icon={ListChecks}
          title="Belum ada data queue real-time"
          description="Buka salah satu modul di atas untuk melihat data operasional yang sudah nyata."
          className="py-8"
        />
      </section>
    </PageContainer>
  );
}
