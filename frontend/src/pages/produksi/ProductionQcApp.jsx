import React, { useCallback, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import PreTestQueue from "@/features/production/componentNotes/PreTestQueue.jsx";
import { AkunTab } from "@/features/production/workerApp/Tabs.jsx";
import WorkerAppShell from "@/features/production/workerApp/WorkerAppShell.jsx";
import { QC_NAV_TABS, qcTabOf } from "@/features/production/workerApp/workerAppModel.js";
import { rolesOf } from "@/lib/roles.js";

// Aplikasi PIC QC (Fase 2 Produksi LAYANAN) — antrean pengujian awal (QC sebelum bongkar, uji fondasi awal) sebagai halaman mandiri,
// kerangka yang SAMA dengan Aplikasi Meja/Corner/Dokumentasi. TIDAK bergantung pada menu "Quality Control" desktop (yang disembunyikan).
// Antrean = GET /component-notes/qc-queue (dari kartu Run); formulir = ComponentNoteSheet yang sama (Catatan Komponen, satu sumber).
// Server = otoritas izin (QC_WRITE / PRODUCTION_EXECUTE_ANY); akun tanpa izin melihat penjelasan, bukan tombol yang pasti 403.
function storedUser() { try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; } }

export default function ProductionQcApp({ user: userProp = null, onLogout = null }) {
  const user = userProp || storedUser();
  const roles = rolesOf(user);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const tab = qcTabOf(params.get("t"));
  const [count, setCount] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const onLoaded = useCallback((items) => setCount(items.length), []);
  const badges = useMemo(() => ({ antrean: count || 0 }), [count]);
  const setTab = (t) => setParams((p) => { const n = new URLSearchParams(p); n.set("t", t); return n; }, { replace: true });

  return (
    <WorkerAppShell tabs={QC_NAV_TABS} title="Aplikasi PIC QC" subtitle={tab === "antrean" ? (count == null ? "Memuat…" : `${count} menunggu pengujian awal`) : null} tab={tab} onTab={setTab} badges={badges}
      onRefresh={tab === "antrean" ? () => setReloadKey((k) => k + 1) : null}>
      {tab === "antrean" ? (
        <div data-testid="qc-app-antrean">
          <h1 className="wa-h1 mb-3">Pengujian Awal</h1>
          <PreTestQueue key={reloadKey} standalone onLoaded={onLoaded} />
        </div>
      ) : (
        <AkunTab user={user} roles={roles} lane={null} currentKey="qc" pathname={pathname} onLogout={onLogout} navigate={navigate} />
      )}
    </WorkerAppShell>
  );
}
