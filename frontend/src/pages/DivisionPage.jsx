import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Activity, ListChecks, Loader2 } from "lucide-react";
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

  // KPI hero. Growth punya tiga angka (endpoint mengembalikan `growthKpi`);
  // divisi lain baru punya satu angka nyata masing-masing, dan itu ditampilkan
  // apa adanya — kartu kosong berisi tanda hubung lebih buruk daripada tidak
  // ada kartu. Entri bernilai null DIBUANG, bukan dirender sebagai "0":
  // "belum bisa dihitung" dan "nol" adalah dua hal berbeda.
  const g = summary?.growthKpi;
  const kpis = (
    key === "growth" && g
      ? [
          { value: g.leadDiproses, label: "Lead sedang diproses" },
          { value: g.perluFollowUp, label: "Perlu follow-up (>1 jam)" },
          { value: g.belumDibaca, label: "Pesan belum dibaca" },
        ]
      : stat
      ? [{ value: stat.value, label: stat.label }]
      : []
  ).filter((k) => k.value !== null && k.value !== undefined);

  return (
    <PageContainer>
      {/* Breadcrumb DI DALAM halaman SUDAH DIHAPUS (refactor navigasi
          2 Agustus 2026). Mockup v4 memang punya remah "SANSS / Sales CRM" di
          badan halaman, tapi aplikasi ini juga punya breadcrumb di topbar —
          jadi nama workspace muncul dua kali berturut-turut hanya berjarak
          beberapa piksel, plus sekali lagi di H1 di bawahnya. Yang bertahan
          adalah yang di topbar (posisinya tetap di semua halaman, dan remah
          "Main Hub"-nya bisa diklik). */}

      {/* Header — judul halaman. Tombol "Back to hub" DIHAPUS pada refactor
          navigasi 2 Agustus 2026: jalan ke Main Hub sudah ada tiga (logo
          sidebar, item Main Hub di workspace switcher, remah breadcrumb), dan
          tombol keempat di dalam area konten cuma menambah kebisingan tanpa
          menambah kemampuan. */}
      <div className="mb-[18px] flex items-center gap-3.5">
        <div className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-2xl bg-[#E8F0FF] text-[#1457D9]">
          <Icon className="h-6 w-6" strokeWidth={1.9} />
        </div>
        <div className="min-w-0">
          <h1 className="text-[27px] font-bold tracking-[-.04em] text-[#10213D]">{content.title}</h1>
          <p className="mt-[5px] text-[11px] text-[#6E7E96]">{content.subtitle}</p>
        </div>
      </div>

      {/* Hero — RINGKASAN KPI, bukan pengulangan nama workspace.
          Sebelum refactor 2 Agustus 2026 nama workspace muncul TIGA kali di
          satu layar: breadcrumb, judul H1, dan judul hero ("Sales CRM command
          center"). Judul hero itu yang dihapus — dua yang lain punya fungsi
          berbeda (orientasi vs judul halaman), yang ketiga cuma gema.

          ⚠️ ANGKANYA NYATA, dari GET /auth/portal-summary. Label di bawah
          sengaja menggambarkan PERSIS apa yang dihitung backend (mis. "belum
          dibaca", bukan "belum dibalas" — yang dihitung unreadCount) supaya
          tidak ada kartu yang menjanjikan lebih dari datanya. */}
      <section
        className="relative overflow-hidden rounded-[24px] px-6 py-6 text-white sm:px-[25px] sm:py-[25px]"
        style={{ background: "linear-gradient(135deg, #071A3A, #1457D9)" }}
      >
        <div aria-hidden className="pointer-events-none absolute -right-[85px] -top-[110px] h-[260px] w-[260px] rounded-full border border-white/[0.13]" />
        <div className="relative">
          <p className="max-w-[720px] text-[12px] leading-[1.6] text-white/[0.72]">
            {content.heroLine}
          </p>

          {loadingSummary ? (
            <div className="mt-5 flex items-center gap-2 text-[11px] text-white/60">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat angka…
            </div>
          ) : kpis.length > 0 ? (
            <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {kpis.map((k) => (
                <div
                  key={k.label}
                  className="rounded-2xl border border-white/[0.13] bg-white/[0.08] px-4 py-3.5 backdrop-blur"
                >
                  <strong className="block text-[26px] leading-none tracking-[-.03em]">{k.value}</strong>
                  <span className="mt-2 block text-[9px] font-extrabold uppercase tracking-[.08em] text-white/[0.58]">
                    {k.label}
                  </span>
                </div>
              ))}
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
