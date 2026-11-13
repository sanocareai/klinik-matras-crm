import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Wrench, Truck, Gauge, Package, Loader2, ArrowRight, Plus, Calendar, Handshake, Landmark, ListChecks } from "lucide-react";
import { api } from "../api.js";
import { PageContainer } from "@/components/ui/page.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { KartuWidget } from "@/components/apple/Apple.jsx";
import { rolesOf } from "@/lib/roles.js";
import { landingPathFor, readLastWorkerMode } from "@/lib/landing.js";
import { HasilMeetingCard, PantauanLeaderCard, TugasSayaCard, useOwnSummary } from "@/features/portal/MainHubWidgets.jsx";

function readStoredUser() { try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; } }

// Landing portal SANSS (PRD §4). Halaman AWAL setelah login.
//
// Role tunggal LANGSUNG lompat ke portalnya, TANPA lewat layar pemilih (PRD
// §4: "Single role → skip the chooser and go straight in"). Portal (dan
// widget Main Hub di bawah) hanya kelihatan oleh user >1 portal (lihat
// komentar di hubPortalEntry/portalsWithHub, backend SANSS, untuk kartu
// "hub" — ini juga yang membuat leader HUB_MEMBER satu-portal-operasional
// TETAP mendarat di sini, bukan auto-skip: `portalsWithHub` menambahkan
// kartu "hub" begitu mereka punya HUB_ACCESS, jadi daftarnya berisi DUA
// entri, bukan satu).
//
// ── REDESAIN APPLE (Gelombang 1, Nov 2026) ─────────────────────────────────
// Sambutan satu baris + dua tombol capsule + kartu widget berwarna per
// workspace; deskripsi panjang di ikon info "i". TIDAK berubah: daftar portal
// & izin (GET /auth/me/portals), auto-skip portal tunggal, tujuan klik
// (portal.path), angka kartu hanya dari server.
//
// Kartu "hub" (Task & Meeting, D-200) punya `path` URL ABSOLUT ke HUB
// GET /sso/start (same-domain: `{origin}/workspace/sso/start`). Itu bukan
// rute SPA ini, jadi `navigate()` React Router tidak akan pernah sampai ke
// server HUB di balik proxy yang sama — `openPortal` di bawah memakai
// navigasi PENUH untuk path berawalan http(s), dan `navigate` untuk lainnya.
export const PORTAL_ICONS = {
  growth: Users,
  bengkel: Wrench,
  warehouse: Package,
  armada: Truck,
  kendali: Gauge,
  finance: Landmark,
  b2b: Handshake,
  hub: ListChecks,
};

// BUG NYATA ditemukan lewat screenshot QA sungguhan (bukan tebakan dari
// baca kode): sanss-apple.css hanya mendefinisikan TUJUH gradien kartu
// widget (.ap-w-biru/langit/ungu/jingga/hijau/pink/indigo) — "teal" (nilai
// awal untuk "hub") TIDAK ADA aturan CSS-nya sama sekali, jadi kartu "Task
// & Meeting" render tanpa gradien warna (pudar, beda sendiri dari kartu
// lain). Diperbaiki dengan memakai SALAH SATU dari tujuh nada yang memang
// sudah ada (indigo) — bukan menambah aturan CSS baru ke fondasi yang
// sengaja disalin apa adanya dari "live".
const NADA_PORTAL = { growth: "biru", armada: "langit", bengkel: "jingga", warehouse: "ungu", kendali: "indigo", finance: "hijau", b2b: "pink", hub: "indigo" };

/** D-200 tahap 4 — kartu "Task & Meeting" (portal.key === "hub") punya `path`
 *  berupa URL ABSOLUT ke HUB (same-domain: `{origin SANSS}/workspace/sso/start`
 *  — lihat docs/HUB-SSO.md), bukan rute SPA relatif seperti portal lain:
 *  masuk WAJIB dimulai dari HUB GET /sso/start, dan itu bukan rute yang
 *  dikenal React Router di SPA ini — perlu navigasi PENUH (browser
 *  sungguhan), bukan client-side, terlepas dari sama-origin atau tidak.
 *  Portal lain (path relatif, "/dashboard" dst.) tidak terpengaruh sama
 *  sekali oleh fungsi ini. */
function openPortal(path, navigate) {
  if (/^https?:\/\//.test(path)) {
    window.location.assign(path);
    return;
  }
  navigate(path);
}

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
  // Main Hub — satu panggilan dipakai bersama oleh "Tugas Saya" dan "Hasil
  // Meeting" di bawah. Dipanggil tanpa syarat (aturan Hooks) — untuk user
  // role-tunggal yang langsung di-redirect di bawah, komponen ini unmount
  // sebelum/segera setelah panggilannya selesai; tidak berakibat apa pun
  // selain satu GET yang hasilnya dibuang.
  const own = useOwnSummary();

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
          openPortal(to || list[0].path, (p) => navigate(p, { replace: true }));
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

  // Dasar tautan "lihat detail" di kartu Tugas Saya/Hasil Meeting/Pantauan
  // Leader di bawah. Kartu "hub" (Task & Meeting) hanya muncul di `portals`
  // untuk pengguna yang punya HUB_ACCESS — SAMA syarat yang dipakai GET
  // /hub/summary/me, jadi kalau "Tugas Saya" berhasil memuat data, kartu ini
  // sudah pasti ada (tidak perlu penanganan "tidak ketemu" di jalur yang
  // sebenarnya tidak mungkin terjadi).
  const hubPath = portals.find((p) => p.key === "hub")?.path ?? null;
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
          <button type="button" className="ap-tombol ap-tombol-utama" onClick={() => openPortal(portals[0].path, navigate)} data-testid="portal-dashboard">Dashboard terintegrasi</button>
          <button type="button" className="ap-tombol ap-tombol-tint" onClick={() => navigate("/orders")} data-testid="portal-order"><Plus size={15} strokeWidth={2.2} aria-hidden="true" /> Buat order</button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="portal-kartu">
        {portals.map((portal) => (
          // Klik kartu langsung ke halaman kerja workspace (portal.path) —
          // lewat openPortal, yang membawa browser dengan navigasi PENUH
          // untuk kartu "hub" (lihat catatan panjang di atas file ini).
          <KartuPortal key={portal.key} portal={portal} stat={summary?.[portal.key]} onOpen={(p) => openPortal(p.path, navigate)} />
        ))}
      </div>

      {/* Main Hub — Tugas Saya / Pantauan Leader / Hasil Meeting. Setiap
          kartu menyembunyikan dirinya kalau pengguna memang tidak punya
          akses (403) — konsisten dengan kartu "Task & Meeting" di grid di
          atas, yang juga begitu. */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TugasSayaCard hubPath={hubPath} own={own} />
        <HasilMeetingCard hubPath={hubPath} own={own} />
        <PantauanLeaderCard hubPath={hubPath} />
      </div>
    </PageContainer>
  );
}
