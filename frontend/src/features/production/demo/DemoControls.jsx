import React, { Fragment, createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { FlaskConical } from "lucide-react";
import { api } from "@/api.js";
import { useTabVisibility } from "@/lib/TabsContext.jsx";
import { TRAINING_PAGES, canUseTraining, checklistsForRoles, pageAllowedForTraining, pagesForRoles } from "./demoRoles.js";
import { DEMO_LABEL, activateDemo, deactivateDemo, demoVersion, installDemoNetworkGuard, isDemoActive, subscribeDemo } from "./demoGate.js";

// P12A — Mode Demo → P12B.2 "Mode Latihan" (ADMIN, OWNER, Production Lead, Operator/PIC, QC, Gudang, Dokumenter — Sales/Finance/Driver/anonim ditolak).
// Data sintetis dimuat dari chunk frontend SETELAH server (GET /production-v2/demo/access) menjawab 200. Default OFF; tidak tersimpan (tanpa
// localStorage/sessionStorage; ?demo=1 juga dibuang dari tab tersimpan) dan mati saat keluar/logout. Semua aksi ubah data, unggah, dan export ditolak.
// Peran hanya melihat halaman yang sesuai izinnya (demoRoles.js). Checklist = panduan baca-saja.
export const DEMO_PAGES = Object.freeze(TRAINING_PAGES.map((p) => [p.label, p.to]));
export const DEMO_UNIT_NOTE = "Dataset latihan berisi 12 unit. Pipeline Status Produksi hanya menampilkan 11 unit karena 1 unit (QA-PV2-U11) sudah selesai dan siap kirim — unit itu tampil di Ringkasan, Aplikasi Dokumentasi, dan Antrean Gudang, bukan di kolom pipeline.";
export const DEMO_DISABLED_TIP = "Dinonaktifkan di Mode Latihan (hanya-baca, data sintetis)";
export const canUseDemo = canUseTraining;
// Tab dalam-app tetap ter-mount saat tersembunyi: hanya halaman pada tab AKTIF yang boleh menyalakan/mematikan demo (state demo bersifat global).
function useIsActiveTab() { try { return useTabVisibility(); } catch { return true; } }
const currentRoles = () => { try { return JSON.parse(localStorage.getItem("user"))?.roles || []; } catch { return []; } };

export function DemoBadge({ top = false }) {
  // top: aplikasi lantai (bottom navigation di dasar) — lencana di bawah header, bukan menutupi navigasi.
  return (
    <div className={`pointer-events-none fixed inset-x-0 ${top ? "top-[calc(env(safe-area-inset-top)+64px)]" : "bottom-3"} z-[300] flex justify-center px-3`} role="status" aria-live="polite" data-testid="demo-badge">
      <span className="pointer-events-auto max-w-full rounded-full bg-orange px-4 py-1.5 text-center text-[12.5px] font-bold text-white shadow-lg"><FlaskConical size={13} className="mr-1 inline align-[-2px]" aria-hidden />{DEMO_LABEL}</span>
    </div>
  );
}

function TrainingChecklist({ roles }) {
  const lists = checklistsForRoles(roles);
  if (!lists.length) return null;
  return (
    <details open className="basis-full rounded-btn bg-surface/70 px-3 py-2 text-ink2" data-testid="training-checklist">
      <summary className="cursor-pointer text-[12.5px] font-bold text-ink">Panduan latihan (hanya bacaan — bukan perintah)</summary>
      <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {lists.map((c) => (
          <section key={c.key} data-testid={`checklist-${c.key}`}>
            <h4 className="m-0 mb-1 text-[12.5px] font-bold text-ink">{c.title}</h4>
            <ol className="m-0 list-decimal space-y-1 pl-5 text-[12px] leading-snug">{c.items.map((t) => <li key={t}>{t}</li>)}</ol>
          </section>
        ))}
      </div>
    </details>
  );
}

function DemoBar({ active, onToggle, denied, roles }) {
  const pages = pagesForRoles(roles);
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pt-3 md:px-8" data-testid="demo-bar">
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card px-3 py-2 text-[12.5px] ${active ? "bg-orangebg text-orange" : "bg-surface text-ink2"}`}>
        <label className="inline-flex min-h-[32px] cursor-pointer items-center gap-2 font-semibold">
          <input type="checkbox" role="switch" className="h-4 w-4 cursor-pointer accent-[var(--accent)]" checked={active} onChange={onToggle} data-testid="demo-toggle" aria-label="Mode Latihan" />
          Mode Latihan
        </label>
        {active ? (
          <>
            <b data-testid="demo-label">{DEMO_LABEL}</b>
            <span className="text-[11.5px] opacity-90">Data sintetis · hanya-baca · tidak masuk KPI/export production · aksi ubah data dinonaktifkan</span>
            <p className="m-0 basis-full text-[11.5px] opacity-90" data-testid="demo-unit-note">{DEMO_UNIT_NOTE}</p>
            <span className="flex flex-wrap gap-1" aria-label="Halaman demo">
              {pages.map(({ label, to }) => <Link key={to} to={`${to}?demo=1`} className="rounded-chip bg-surface px-2 py-0.5 text-[11.5px] font-semibold text-accent no-underline hover:underline">{label}</Link>)}
            </span>
            <TrainingChecklist roles={roles} />
          </>
        ) : <span className="text-[11.5px] text-ink3">Latihan dengan contoh 12 unit lengkap (data sintetis, bukan data operasional){denied ? " — akses Mode Latihan ditolak server" : ""}</span>}
      </div>
    </div>
  );
}

// Pembungkus halaman: toggle + banner + gerbang. `children` di-remount (key) setiap demo diaktifkan/dimatikan supaya memuat ulang datanya.
// P12C: aplikasi lantai (mobile) memindahkan bar Mode Latihan ke tab Akun (slotBar) — bar tidak lagi menempel di atas header aplikasi. Perilaku demo TIDAK berubah.
const DemoCtx = createContext(null);
export function DemoBarSlot() {
  const c = useContext(DemoCtx);
  if (!c?.eligible) return null;
  return <DemoBar active={c.active} onToggle={c.toggle} denied={c.denied} roles={c.roles} />;
}

export function DemoPage({ children, slotBar = false }) {
  const [params, setParams] = useSearchParams();
  // State lokal diselaraskan dari ?demo=1 (di sistem tab dalam-app, perubahan HANYA query tidak menggeser lokasi virtual tab).
  const urlWants = params.get("demo") === "1";
  const [wantsLocal, setWantsLocal] = useState(urlWants);
  useEffect(() => { setWantsLocal(urlWants); }, [urlWants]);
  const wants = wantsLocal;
  const location = useLocation();
  const roles = currentRoles();
  // Hanya peran latihan DAN hanya halaman yang sesuai izin perannya (halaman lain tetap memakai data nyata, bar tidak tampil).
  const eligible = canUseDemo(roles) && pageAllowedForTraining(roles, location.pathname);
  const ver = useSyncExternalStore(subscribeDemo, demoVersion);
  const visible = useIsActiveTab();
  const [status, setStatus] = useState(wants && eligible && !isDemoActive() ? "checking" : "idle");
  const [denied, setDenied] = useState(false);
  const active = isDemoActive();
  const strip = () => { setWantsLocal(false); setParams((p) => { const n = new URLSearchParams(p); n.delete("demo"); return n; }, { replace: true }); };

  useEffect(() => {
    installDemoNetworkGuard();
    let alive = true;
    if (!visible) return undefined;
    if (wants && !eligible) { strip(); return undefined; } // non-admin: kembali ke data nyata, tanpa memuat dataset
    if (wants && eligible && !isDemoActive()) {
      setStatus("checking");
      (async () => {
        try {
          await api.getDemoAccess(); // 403 untuk peran di luar daftar latihan (server menegakkan)
          const { loadDemoResolver } = await import("./demoLoader.js");
          activateDemo(await loadDemoResolver());
          if (alive) { setStatus("idle"); setDenied(false); }
        } catch { if (alive) { setDenied(true); setStatus("idle"); strip(); } }
      })();
    }
    if (!wants && isDemoActive()) { deactivateDemo(); setStatus("idle"); }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wants, eligible, visible]);

  useEffect(() => () => { if (visible) deactivateDemo(); }, [visible]); // meninggalkan halaman = demo mati (halaman lain tidak boleh memakai dataset)

  useEffect(() => { // tombol bertanda data-mutates dinonaktifkan selama demo (termasuk yang muncul belakangan di modal/laci)
    if (!active) return undefined;
    const apply = () => document.querySelectorAll("[data-mutates]").forEach((el) => {
      if (!el.disabled) { el.disabled = true; el.setAttribute("aria-disabled", "true"); el.title = DEMO_DISABLED_TIP; el.style.opacity = "0.5"; el.style.cursor = "not-allowed"; el.style.pointerEvents = "none"; el.tabIndex = -1; el.dataset.demoDisabled = "1"; }
    });
    apply();
    const mo = new MutationObserver(apply); mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [active, ver]);

  const toggle = () => { const next = !wants; setWantsLocal(next); setParams((p) => { const n = new URLSearchParams(p); if (next) n.set("demo", "1"); else n.delete("demo"); return n; }, { replace: true }); };
  return (
    <>
      {eligible && !slotBar && <DemoBar active={active} onToggle={toggle} denied={denied} roles={roles} />}
      <DemoCtx.Provider value={{ eligible, active, toggle, denied, roles }}>
        {status === "checking" ? <p className="m-0 px-8 py-6 text-[13px] text-ink3" data-testid="demo-checking">Menyiapkan data latihan…</p> : <Fragment key={`${ver}-${active}`}>{children}</Fragment>}
      </DemoCtx.Provider>
      {active && <DemoBadge top={slotBar} />}
    </>
  );
}
