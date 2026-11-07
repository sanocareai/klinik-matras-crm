import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Wrench, Truck, Gauge, Package, Loader2, ArrowRight, Plus, Calendar, Handshake, Landmark } from "lucide-react";
import { api } from "../api.js";
import { PageContainer } from "@/components/ui/page.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { KartuWidget } from "@/components/apple/Apple.jsx";
import { rolesOf } from "@/lib/roles.js";
import { landingPathFor, readLastWorkerMode } from "@/lib/landing.js";

function readStoredUser() { try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; } }

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
// ── UPDATE (1 Agustus 2026, revisi kedua) — DIBALIK LAGI 30 Agustus 2026 ──
// Sempat begini: klik kartu berhenti dulu di command center (/portal/:key,
// DivisionPage.jsx) sebelum ke halaman kerja, meniru struktur `.division-page`
// mockup atas permintaan eksplisit Gilang. SEKARANG DIBALIK LAGI ke perilaku
// sebelum itu — klik kartu LANGSUNG ke halaman kerja (`p.path`), command
// center dilewati. Alasan (juga dari Gilang): satu klik tambahan tanpa nilai
// tambah begitu satu-satunya bagian command center yang tidak punya padanan
// di Dashboard (Recent Activity) sudah dipindah ke sana beneran berisi data
// nyata — lihat RecentActivityCard.jsx & Dashboard.jsx. DivisionPage.jsx
// TIDAK dihapus (kalau suatu saat perlu dikembalikan), cuma sudah tidak ada
// jalan normal ke sana dari UI manapun.
//
// Yang TETAP tidak berubah sejak awal: role tunggal (5 sales) TIDAK PERNAH
// melihat command center ATAU Portal ini sama sekali — auto-skip di bawah
// menuju portals[0].path terjadi sebelum baris render mana pun di file ini.
// Portal (dan dulu command center) cuma kelihatan oleh user >1 portal
// (praktiknya: admin/owner).

export const PORTAL_ICONS = {
  growth: Users,
  bengkel: Wrench,
  warehouse: Package,
  armada: Truck,
  kendali: Gauge,
  finance: Landmark,
  b2b: Handshake,
};


// ── REDESAIN APPLE (Gelombang 1, Nov 2026) ─────────────────────────────────────────────────────────────────────────────
// Main Hub disederhanakan: sambutan satu baris + dua tombol capsule + kartu widget berwarna per workspace (ubin ikon, angka nyata dari /auth/portal-summary, satu tombol Buka).
// Deskripsi panjang tiap workspace dipindah ke ikon info "i" (klik/ketuk/keyboard). Hero ilustrasi, chip mengambang, dan paragraf pengantar dihapus.
// TIDAK berubah: daftar portal & izin (GET /auth/me/portals), auto-skip portal tunggal, tujuan klik (portal.path), angka kartu (hanya dari server; tanpa angka = "Buka workspace").
const NADA_PORTAL = { growth: "biru", armada: "langit", bengkel: "jingga", warehouse: "ungu", kendali: "indigo", finance: "hijau", b2b: "pink" };

function todayText() {
  return new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
}

function KartuPortal({ portal, stat, onOpen }) {
  const Icon = PORTAL_ICONS[portal.key] || Users;
  return (
    <KartuWidget nada={NADA_PORTAL[portal.key] || "biru"} Glif={Icon} judul={portal.label} info={portal.description} infoLabel={`Tentang ${portal.label}`} onBuka={() => onOpen(portal)} testid={`portal-${portal.key}`}>
      <div className="mt-1">
        {stat ? (<><div className="ap-w-angka" data-testid={`portal-angka-${portal.key}`}>{stat.value}</div><p className="ap-w-label">{stat.label}</p></>) : <p className="ap-w-label">Buka workspace</p>}
      </div>
      <span className="ap-w-aksi">Buka <ArrowRight size={15} strokeWidth={2} aria-hidden="true" /></span>
    </KartuWidget>
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
        // PIC Meja (peran lantai saja) mendarat di Aplikasi Meja; peran lain ke portalnya (lihat lib/landing.js).
        if (list.length === 1) {
          const to = landingPathFor({ roles: rolesOf(data.roles ? data : readStoredUser()), portals: list, lastMode: readLastWorkerMode() });
          navigate(to || list[0].path, { replace: true });
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

  const awal = (me?.name || "").trim().split(/\s+/)[0];
  return (
    <PageContainer fluid className="gud-halaman">
      <header className="ap-kepala">
        <div>
          <h1>{awal ? `Halo, ${awal}` : "Selamat datang di SANSS"}</h1>
          <p>Pilih workspace untuk mulai bekerja.</p>
        </div>
        <div className="ap-kepala-aksi">
          <span className="ap-pil" data-testid="portal-tanggal"><Calendar size={15} strokeWidth={1.9} aria-hidden="true" /> {todayText()}</span>
          <button type="button" className="ap-tombol ap-tombol-utama" onClick={() => navigate(portals[0].path)} data-testid="portal-dashboard">Dashboard terintegrasi</button>
          <button type="button" className="ap-tombol ap-tombol-tint" onClick={() => navigate("/orders")} data-testid="portal-order"><Plus size={15} strokeWidth={2.2} aria-hidden="true" /> Buat order</button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="portal-kartu">
        {portals.map((portal) => (
          // Klik kartu langsung ke halaman kerja workspace (portal.path) — keputusan 30 Agustus 2026 tidak berubah.
          <KartuPortal key={portal.key} portal={portal} stat={summary?.[portal.key]} onOpen={(p) => navigate(p.path)} />
        ))}
      </div>
    </PageContainer>
  );
}
