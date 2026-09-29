import React, { useEffect, useState } from "react";
import { Layers, ListTree } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";

// Layanan & Tahapan (P8.1, UI & Navigation Consolidation) — halaman BARU,
// read-only. Memakai DUA endpoint yang SUDAH ADA sejak Production Tahap 2 /
// Core Slice 4G (GET /master-data/service-catalog, GET /master-data/routing-
// stages — dipakai juga di picker skill Operators & dropdown "tetapkan
// layanan" Detail Unit), TIDAK ada API baru. Sengaja read-only: mengubah
// katalog layanan/tahap adalah perubahan skema produksi (di luar lingkup
// "UI & Navigation Consolidation" — lihat batasan "jangan ubah state
// machine/API/migration" di deskripsi tugas ini).
const PHASE_LABEL = { INTAKE: "Intake", MODULE: "Modul", HANDOFF: "Handoff" };

export default function ProductionServiceStages() {
  const [services, setServices] = useState(null);
  const [stages, setStages] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.getServiceCatalog(), api.getRoutingStages()])
      .then(([s, t]) => { setServices(s.services || []); setStages(t.stages || []); })
      .catch((e) => setError(e.message));
  }, []);

  const byPhase = (stages || []).reduce((acc, s) => {
    (acc[s.phase] = acc[s.phase] || []).push(s);
    return acc;
  }, {});

  return (
    <PageContainer>
      <PageHeader title="Layanan & Tahapan" subtitle="Katalog layanan dan tahap produksi aktif — referensi baca saja." />
      <PageBody>
        {error && <Card className="p-4 text-[12.5px] text-red">{error}</Card>}

        <Card className="overflow-hidden p-0">
          <CardHeader>
            <CardTitle>Layanan</CardTitle>
            <CardDescription>Jenis layanan yang bisa ditetapkan ke unit setelah diagnosa.</CardDescription>
          </CardHeader>
          {services === null ? (
            <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((n) => <div key={n} className="h-14 animate-pulse rounded-btn bg-inset" />)}</div>
          ) : services.length === 0 ? (
            <EmptyState icon={Layers} title="Belum ada layanan aktif" compact />
          ) : (
            <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {services.map((s) => (
                <div key={s.id} className="rounded-btn border border-line p-3">
                  <p className="text-[13px] font-semibold text-ink">{s.labelId}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink3">
                    <span className="font-mono">{s.code}</span>
                    {s.serviceLine && <Badge variant="neutral">{s.serviceLine}</Badge>}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="overflow-hidden p-0">
          <CardHeader>
            <CardTitle>Tahap Produksi</CardTitle>
            <CardDescription>Urutan tahap yang dihitung server (stage engine) — dikelompokkan per fase.</CardDescription>
          </CardHeader>
          {stages === null ? (
            <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((n) => <div key={n} className="h-14 animate-pulse rounded-btn bg-inset" />)}</div>
          ) : stages.length === 0 ? (
            <EmptyState icon={ListTree} title="Belum ada tahap aktif" compact />
          ) : (
            <div className="space-y-4 p-4">
              {Object.entries(byPhase).map(([phase, items]) => (
                <div key={phase}>
                  <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink3">{PHASE_LABEL[phase] || phase}</p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((s) => (
                      <div key={s.id} className="rounded-btn border border-line p-3">
                        <p className="text-[13px] font-semibold text-ink">{s.labelId}</p>
                        <p className="mt-0.5 font-mono text-[11.5px] text-ink3">{s.code}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </PageBody>
    </PageContainer>
  );
}
