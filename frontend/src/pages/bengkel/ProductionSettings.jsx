import React, { useState } from "react";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import TabbedHub from "@/components/TabbedHub.jsx";
import ThemeToggle from "@/components/ThemeToggle.jsx";
import TargetPanel from "@/features/production/TargetPanel.jsx";
import { rolesOf } from "@/lib/roles.js";
import { canOpenSettings, canWriteTarget, settingsTabsFor } from "@/lib/productionSettings.js";
import { resetSidebarPreferences } from "@/lib/sidebarSections.js";
import ProductionWorkCenters from "./ProductionWorkCenters.jsx";
import ProductionOperators from "./ProductionOperators.jsx";
import ProductionServiceStages from "./ProductionServiceStages.jsx";

// Pengaturan Produksi (P12B.2) — SATU halaman untuk Area Kerja, Operator & PIC, Layanan & Tahapan, Target Produksi, dan Tampilan.
// Halaman/komponen yang SUDAH ADA dipakai ulang (endpoint sama). Visibilitas tab = lib/productionSettings.js (cermin izin backend, bukan izin baru).
function readUser() { try { return JSON.parse(localStorage.getItem("user")); } catch { return null; } }

function TargetTab({ roles }) {
  return (
    <PageContainer>
      <PageHeader title="Target Produksi" subtitle="Target harian unit yang tersimpan historis — berlaku mulai tanggal yang dipilih." />
      <PageBody>
        <TargetPanel canWrite={canWriteTarget(roles)} />
        {!canWriteTarget(roles) && <p className="m-0 text-[12px] text-ink3">Hanya Admin/Owner yang dapat mengubah target; Anda dapat melihat riwayatnya.</p>}
      </PageBody>
    </PageContainer>
  );
}

function AppearanceTab() {
  const [done, setDone] = useState(false);
  return (
    <PageContainer>
      <PageHeader title="Tampilan" subtitle="Preferensi tampilan di perangkat ini — tidak memengaruhi akses menu." />
      <PageBody>
        <Card className="space-y-3 p-4" data-testid="appearance-panel">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="m-0 text-[13.5px] font-semibold text-ink">Tema</p><p className="m-0 text-[12px] text-ink3">Terang atau gelap untuk perangkat ini.</p></div>
            <ThemeToggle />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <div><p className="m-0 text-[13.5px] font-semibold text-ink">Atur ulang sidebar</p><p className="m-0 text-[12px] text-ink3">Kembalikan bagian sidebar (mis. Mode Kerja) dan urutan menu tersimpan ke bawaan.</p></div>
            <Button variant="ghost" size="sm" onClick={() => { resetSidebarPreferences("bengkel"); setDone(true); }} data-testid="reset-sidebar">Atur ulang</Button>
          </div>
          {done && <p role="status" className="m-0 text-[12.5px] text-green">Selesai — berlaku saat halaman dimuat ulang.</p>}
        </Card>
      </PageBody>
    </PageContainer>
  );
}

export default function ProductionSettings() {
  const roles = rolesOf(readUser());
  if (!canOpenSettings(roles)) {
    return (
      <PageContainer>
        <PageHeader title="Pengaturan Produksi" subtitle="Anda tidak memiliki akses ke halaman ini." />
        <PageBody><Card className="p-4 text-[13px] text-ink2" role="alert" data-testid="settings-forbidden">Pengaturan Produksi hanya untuk Admin, Owner, dan Production Lead.</Card></PageBody>
      </PageContainer>
    );
  }
  const allowed = new Set(settingsTabsFor(roles).map((t) => t.key));
  const defs = {
    "area-kerja": () => <ProductionWorkCenters />,
    operator: () => <ProductionOperators />,
    layanan: () => <ProductionServiceStages />,
    target: () => <TargetTab roles={roles} />,
    tampilan: () => <AppearanceTab />,
  };
  const tabs = settingsTabsFor(roles).map((t) => ({ key: t.key, label: t.label, hidden: !allowed.has(t.key), render: defs[t.key] }));
  return <TabbedHub tabs={tabs} defaultTab="area-kerja" label="Pengaturan Produksi" />;
}
