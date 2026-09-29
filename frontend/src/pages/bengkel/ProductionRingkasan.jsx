import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { WorkspaceHero } from "@/components/ui/workspace-hero.jsx";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import ActiveComplaintsWidget from "@/features/complaints/ActiveComplaintsWidget.jsx";
import CommandCenterSummary from "@/features/production/CommandCenterSummary.jsx";
import { EXCEPTION_TYPE_REAL, WORKSPACE_HEALTH_REAL } from "@/features/bengkel/unitStatus.js";
import { formatDurasiMenit } from "@/utils/formatDate.js";

// Ringkasan (P8.1, UI & Navigation Consolidation) — halaman baru, landasan
// "OPERASIONAL" workspace Produksi. Memakai endpoint yang SAMA dengan Command
// Center di Papan Produksi V1 lama (Bengkel.jsx, GET /production/command-
// center — tidak ada API baru), tapi TANPA papan target harian V1 (unit per
// tahap, tandai selesai per unit) yang sekarang jadi bagian "Rencana
// Produksi" (V2, /bengkel/production-v2). Bengkel.jsx sendiri TIDAK diubah —
// tetap utuh sebagai fallback ADMIN "Papan Produksi (lama, V1)".
function todayWibISO() {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

function currentRoles() {
  try {
    return JSON.parse(localStorage.getItem("user"))?.roles || [];
  } catch {
    return [];
  }
}

export default function ProductionRingkasan() {
  const date = todayWibISO();
  const [cc, setCc] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const roles = currentRoles();
  const allowed = roles.some((r) => ["ADMIN", "PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD", "WAREHOUSE"].includes(r));

  const load = useCallback(() => {
    setLoading(true); setError("");
    return api.getCommandCenter(date).then(setCc).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [date]);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  if (!allowed) {
    return (
      <PageContainer>
        <div className="py-16 text-center">
          <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-orange" />
          <h2 className="text-lg font-semibold text-ink">Tidak Punya Akses</h2>
          <p className="mt-1 text-sm text-ink2">Halaman ini khusus tim produksi.</p>
        </div>
      </PageContainer>
    );
  }

  const dueDateTracked = (cc?.summary?.unitsWithDueDate || 0) > 0;
  const healthTone = cc?.workspaceHealth?.level === "CRITICAL" ? "critical" : cc?.workspaceHealth?.level === "ATTENTION" ? "warn" : "ok";

  return (
    <PageContainer>
      <PageHeader
        title="Ringkasan"
        subtitle="Kendali produksi harian — target, risiko, hambatan, dan progres bengkel."
        actions={
          <Button variant="ghost" onClick={load} className="h-10" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Muat Ulang
          </Button>
        }
      />
      <PageBody>
        {/* P9B — Command Center V2: KPI + Butuh Perhatian + aktivitas PIC/meja, cohort Production V2 saja. Inert
            (tidak render apa pun) saat readerMode OFF — pusat kendali V1 di bawah tetap berlaku untuk seluruh unit. */}
        <CommandCenterSummary />
        <ActiveComplaintsWidget currentOwner="PRODUCTION" title="Kasus Komplain Perlu Rework" />

        {error && !cc ? (
          <Card className="p-4 text-[12.5px] text-red">{error}</Card>
        ) : loading && !cc ? (
          <Card className="flex items-center justify-center gap-2 p-8 text-ink2">
            <Loader2 className="h-4 w-4 animate-spin" /> <span className="text-sm">Memuat pusat kendali…</span>
          </Card>
        ) : cc ? (
          <>
            <WorkspaceHero
              tone="amber"
              title="Pusat Kendali Produksi"
              subtitle="Target harian, progres tahap pengerjaan, dan unit yang belum masuk papan hari ini."
              health={{ label: WORKSPACE_HEALTH_REAL[cc.workspaceHealth.level]?.label || cc.workspaceHealth.level, tone: healthTone }}
              stats={[
                { label: "Target Hari Ini", value: cc.summary.targetToday, hint: cc.date },
                { label: "Selesai Hari Ini", value: cc.summary.completedToday, hint: `dari ${cc.summary.targetToday} target` },
                { label: "Sedang Dikerjakan", value: cc.summary.inProgress },
                { label: "Terhambat", value: cc.summary.blocked, hint: cc.summary.blocked > 0 ? "perlu tindakan" : "tidak ada" },
                dueDateTracked
                  ? { label: "Berisiko", value: cc.summary.atRisk, hint: "berisiko terlambat" }
                  : { label: "Berisiko", value: "—", hint: "Belum ada target tanggal" },
                dueDateTracked
                  ? { label: "Terlambat", value: cc.summary.overdue, hint: "sudah lewat target" }
                  : { label: "Terlambat", value: "—", hint: "Belum ada target tanggal" },
                {
                  label: "Belum Ditugaskan", value: cc.unassignedActiveUnits.count,
                  hint: cc.unassignedActiveUnits.count > 0 ? "unit aktif tanpa operator" : "semua sudah ditugaskan",
                },
              ]}
            />

            {cc.workspaceHealth.reasons.length > 0 && (
              <Card className="border-l-[3px] border-orange p-4">
                <h3 className="text-[13px] font-bold text-ink">
                  {cc.workspaceHealth.level === "CRITICAL" ? "Perlu Tindakan Segera" : "Perlu Perhatian"}
                </h3>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[12.5px] text-ink2">
                  {cc.workspaceHealth.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </Card>
            )}

            <Card className="overflow-hidden p-0">
              <CardHeader>
                <CardTitle>Perlu Perhatian</CardTitle>
                <CardDescription>Unit blocked, overdue, atau berisiko terlambat — urut prioritas.</CardDescription>
              </CardHeader>
              {cc.exceptions.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="Tidak ada pengecualian produksi" description="Operasional produksi berjalan tanpa blocker, overdue, atau risiko aktif pada filter saat ini." compact />
              ) : (
                <ul className="m-0 list-none divide-y divide-line p-0">
                  {cc.exceptions.map((exc) => (
                    <li key={`${exc.type}-${exc.unitId}`} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[11.5px] font-semibold text-ink">{exc.unitCode}</span>
                          <Badge variant={EXCEPTION_TYPE_REAL[exc.type]?.tone || "neutral"}>{EXCEPTION_TYPE_REAL[exc.type]?.label || exc.type}</Badge>
                        </div>
                        <p className="mt-0.5 truncate text-[12.5px] text-ink2">{exc.reason}</p>
                        {(exc.customerName || exc.orderNumber) && (
                          <p className="truncate text-[11px] text-ink3">{exc.customerName || "—"}{exc.orderNumber ? ` · ${exc.orderNumber}` : ""}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {exc.durationMinutes != null && <span className="text-[11px] text-ink3">{formatDurasiMenit(exc.durationMinutes)}</span>}
                        <Button size="sm" variant="secondary" asChild><Link to={exc.href}>Buka</Link></Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {[
                ["Antrean", cc.flow.queued], ["Dikerjakan", cc.flow.inProgress], ["Dijeda", cc.flow.paused],
                ["Tunggu QC", cc.flow.waitingQc], ["Diulang", cc.flow.rework], ["Selesai Hari Ini", cc.flow.completed],
              ].map(([label, value]) => (
                <Card key={label} className="p-3 text-center">
                  <p className="text-[22px] font-bold leading-none text-ink">{value}</p>
                  <p className="mt-1 text-[11px] text-ink3">{label}</p>
                </Card>
              ))}
            </div>
          </>
        ) : null}
      </PageBody>
    </PageContainer>
  );
}
