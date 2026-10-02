import React, { Fragment, useEffect, useState, useSyncExternalStore } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FlaskConical } from "lucide-react";
import { api } from "@/api.js";
import { useTabVisibility } from "@/lib/TabsContext.jsx";
import { DEMO_LABEL, activateDemo, deactivateDemo, demoVersion, installDemoNetworkGuard, isDemoActive, subscribeDemo } from "./demoGate.js";

// P12A — Mode Demo (ADMIN/OWNER saja). Data sintetis dimuat dari chunk frontend SETELAH server (GET /production-v2/demo/access) menjawab 200.
// Default OFF; tidak tersimpan (tanpa localStorage/sessionStorage; ?demo=1 juga dibuang dari tab tersimpan). Semua aksi ubah data ditolak.
export const DEMO_PAGES = Object.freeze([
  ["Ringkasan", "/bengkel/ringkasan"], ["Status Produksi", "/bengkel/production-v2"], ["Rencana Produksi", "/bengkel/rencana-produksi"], ["Quality Control", "/bengkel/quality-control"],
  ["KPI Produksi", "/bengkel/kpi"], ["Aplikasi Dokumentasi", "/produksi/dokumentasi"], ["Antrean Gudang", "/warehouse/antrean-produksi"],
]);
export const DEMO_UNIT_NOTE = "Dataset demo berisi 12 unit. Pipeline Status Produksi hanya menampilkan 11 unit karena 1 unit (QA-PV2-U11) sudah selesai dan siap kirim — unit itu tampil di Ringkasan, Aplikasi Dokumentasi, dan Antrean Gudang, bukan di kolom pipeline.";
export const DEMO_DISABLED_TIP = "Dinonaktifkan di Mode Demo (hanya-baca, data sintetis)";
export const canUseDemo = (roles = []) => roles.some((r) => r === "ADMIN" || r === "OWNER");
// Tab dalam-app tetap ter-mount saat tersembunyi: hanya halaman pada tab AKTIF yang boleh menyalakan/mematikan demo (state demo bersifat global).
function useIsActiveTab() { try { return useTabVisibility(); } catch { return true; } }
const currentRoles = () => { try { return JSON.parse(localStorage.getItem("user"))?.roles || []; } catch { return []; } };

export function DemoBadge() {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-[300] flex justify-center px-3" role="status" aria-live="polite" data-testid="demo-badge">
      <span className="pointer-events-auto max-w-full rounded-full bg-orange px-4 py-1.5 text-center text-[12.5px] font-bold text-white shadow-lg"><FlaskConical size={13} className="mr-1 inline align-[-2px]" aria-hidden />{DEMO_LABEL}</span>
    </div>
  );
}

function DemoBar({ active, onToggle, denied }) {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pt-3 md:px-8" data-testid="demo-bar">
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card px-3 py-2 text-[12.5px] ${active ? "bg-orangebg text-orange" : "bg-surface text-ink2"}`}>
        <label className="inline-flex min-h-[32px] cursor-pointer items-center gap-2 font-semibold">
          <input type="checkbox" role="switch" className="h-4 w-4 cursor-pointer accent-[var(--accent)]" checked={active} onChange={onToggle} data-testid="demo-toggle" aria-label="Lihat Data Demo" />
          Lihat Data Demo
        </label>
        {active ? (
          <>
            <b data-testid="demo-label">{DEMO_LABEL}</b>
            <span className="text-[11.5px] opacity-90">Data sintetis QA-PV2 · hanya-baca · tidak masuk KPI/export production</span>
            <p className="m-0 basis-full text-[11.5px] opacity-90" data-testid="demo-unit-note">{DEMO_UNIT_NOTE}</p>
            <span className="flex flex-wrap gap-1" aria-label="Halaman demo">
              {DEMO_PAGES.map(([label, to]) => <Link key={to} to={`${to}?demo=1`} className="rounded-chip bg-surface px-2 py-0.5 text-[11.5px] font-semibold text-accent no-underline hover:underline">{label}</Link>)}
            </span>
          </>
        ) : <span className="text-[11.5px] text-ink3">Hanya Admin/Owner · tampilkan contoh 12 unit lengkap (bukan data operasional){denied ? " — akses demo ditolak server" : ""}</span>}
      </div>
    </div>
  );
}

// Pembungkus halaman: toggle + banner + gerbang. `children` di-remount (key) setiap demo diaktifkan/dimatikan supaya memuat ulang datanya.
export function DemoPage({ children }) {
  const [params, setParams] = useSearchParams();
  // State lokal diselaraskan dari ?demo=1 (di sistem tab dalam-app, perubahan HANYA query tidak menggeser lokasi virtual tab).
  const urlWants = params.get("demo") === "1";
  const [wantsLocal, setWantsLocal] = useState(urlWants);
  useEffect(() => { setWantsLocal(urlWants); }, [urlWants]);
  const wants = wantsLocal;
  const eligible = canUseDemo(currentRoles());
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
          await api.getDemoAccess(); // 403 untuk non-ADMIN/OWNER (server menegakkan)
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
      {eligible && <DemoBar active={active} onToggle={toggle} denied={denied} />}
      {status === "checking" ? <p className="m-0 px-8 py-6 text-[13px] text-ink3" data-testid="demo-checking">Menyiapkan data demo…</p> : <Fragment key={`${ver}-${active}`}>{children}</Fragment>}
      {active && <DemoBadge />}
    </>
  );
}
