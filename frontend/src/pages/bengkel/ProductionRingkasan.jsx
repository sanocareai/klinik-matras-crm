import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock, Hourglass, Loader2, PackageX, PlayCircle, RefreshCw, ShieldCheck, Target, Timer } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import ActiveComplaintsWidget from "@/features/complaints/ActiveComplaintsWidget.jsx";
import { formatTanggal } from "@/utils/formatDate.js";
import { summaryFromV1, summaryFromV2 } from "@/features/production/ringkasanModel.js";

// Ringkasan (P9 UX Realignment) — SATU dashboard produksi. Sebelumnya halaman ini menumpuk DUA dashboard (Ringkasan
// Produksi V2 + "Pusat Kendali Produksi" V1) dengan KPI ganda dan angka yang saling bertentangan (mis. Target 12 vs 0).
// Sekarang satu baris KPI, satu strip pipeline, satu daftar Butuh Perhatian, satu tabel aktivitas PIC. Sumber data: Command
// Center V2 (sama dengan Status Produksi/Rencana Produksi — tidak ada hitungan paralel). Hanya bila Production V2 belum aktif
// (readerMode OFF) halaman memakai Command Center V1 lewat adaptor yang menghasilkan bentuk ringkasan yang SAMA.
function todayWibISO() { return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); }
function currentRoles() { try { return JSON.parse(localStorage.getItem("user"))?.roles || []; } catch { return []; } }

const TILE_ICON = { target: Target, done: CheckCircle2, active: PlayCircle, queue: Hourglass, late: Timer, material: PackageX, qc: ClipboardCheck };
const TONE_CLS = { neutral: "bg-accentbg text-accent", red: "bg-redbg text-red", orange: "bg-orangebg text-orange", green: "bg-greenbg text-green" };

function Tile({ tile }) {
  const Icon = TILE_ICON[tile.key] || Clock;
  const body = (
    <Card data-testid="kpi-tile" data-kpi={tile.key} className="flex h-full min-h-[84px] items-center gap-3 p-3.5 transition-colors hover:bg-hovertint">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-btn ${TONE_CLS[tile.tone] || TONE_CLS.neutral}`}><Icon size={19} aria-hidden /></span>
      <div className="min-w-0">
        <p className="m-0 text-[22px] font-bold leading-none text-ink tabular-nums">{tile.value}{tile.of != null && <span className="text-[13px] font-semibold text-ink3">/{tile.of}</span>}</p>
        <p className="m-0 mt-1 text-[11.5px] leading-tight text-ink3">{tile.label}</p>
      </div>
    </Card>
  );
  return tile.to ? <Link to={tile.to} className="block min-w-0 no-underline">{body}</Link> : body;
}

export default function ProductionRingkasan() {
  const date = todayWibISO();
  const [v2, setV2] = useState(null);
  const [v1, setV1] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const roles = currentRoles();
  const allowed = roles.some((r) => ["ADMIN", "OWNER", "PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD", "WAREHOUSE"].includes(r));

  const load = useCallback(() => {
    setLoading(true); setError("");
    return api.getProductionV2CommandCenter()
      .then(async (c) => { setV2(c); setV1(c.readerMode === "OFF" ? await api.getCommandCenter(date).catch(() => null) : null); })
      .catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [date]);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const summary = useMemo(() => {
    if (!v2) return null;
    if (v2.readerMode !== "OFF") return summaryFromV2(v2);
    return v1 ? summaryFromV1(v1) : null;
  }, [v2, v1]);

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

  return (
    <PageContainer>
      <PageHeader title="Ringkasan" subtitle={`Kendali produksi harian · ${formatTanggal(date)}`}
        actions={<Button variant="ghost" onClick={load} className="h-10" disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Muat Ulang</Button>} />
      <PageBody>
        {error && !summary ? (
          <Card className="p-4 text-[12.5px] text-red">{error}</Card>
        ) : loading && !summary ? (
          <Card className="flex items-center justify-center gap-2 p-8 text-ink2"><Loader2 className="h-4 w-4 animate-spin" /> <span className="text-sm">Memuat ringkasan produksi…</span></Card>
        ) : summary ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7" data-testid="kpi-row">
              {summary.tiles.map((t) => <Tile key={t.key} tile={t} />)}
            </div>

            {summary.pipeline.length > 0 && (
              <Card className="p-4" data-testid="pipeline-strip">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="m-0 text-[13.5px] font-bold text-ink">Posisi unit di jalur produksi</h2>
                  <Link to="/bengkel/production-v2" className="text-[12.5px] font-semibold text-accent underline">Buka Status Produksi →</Link>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-9">
                  {summary.pipeline.map((s) => (
                    <Link key={s.key} to="/bengkel/production-v2" className="min-w-0 rounded-btn bg-inset p-2.5 text-center no-underline hover:bg-hovertint">
                      <p className={`m-0 text-[18px] font-bold tabular-nums ${s.count ? "text-ink" : "text-ink3"}`}>{s.count}</p>
                      <p className="m-0 truncate text-[11px] text-ink3" title={s.label}>{s.label}</p>
                    </Link>
                  ))}
                </div>
              </Card>
            )}

            <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <Card className="min-w-0 overflow-hidden p-0" data-testid="attention-card">
                <div className="flex items-center gap-2 border-b border-line px-4 py-3"><AlertTriangle size={16} className="text-orange" aria-hidden /><h2 className="m-0 text-[13.5px] font-bold text-ink">Butuh Perhatian</h2>
                  <span className="ml-auto text-[11.5px] text-ink3">{summary.attention.length} hal</span></div>
                {summary.attention.length === 0 ? (
                  <div className="flex items-center gap-2 px-4 py-6 text-[12.5px] text-green"><ShieldCheck size={18} aria-hidden /> Tidak ada yang butuh perhatian saat ini — operasional produksi berjalan normal.</div>
                ) : (
                  <ul className="m-0 list-none divide-y divide-line p-0">
                    {summary.attention.slice(0, 8).map((a, i) => (
                      <li key={`${a.code}-${a.unitCode}-${i}`} className="flex items-start gap-2.5 px-4 py-3">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.severity === "critical" ? "bg-red" : "bg-orange"}`} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant={a.severity === "critical" ? "red" : "orange"}>{a.severity === "critical" ? "Kritis" : "Perhatian"}</Badge>
                            {a.orderNumber && <span className="text-[11px] text-ink3">{a.orderNumber}</span>}
                          </div>
                          <p className="m-0 mt-0.5 break-words text-[12.5px] text-ink2">{a.text}</p>
                        </div>
                        {a.to && <Button size="sm" variant="secondary" className="min-h-[40px] shrink-0" asChild><Link to={a.to}>Buka</Link></Button>}
                      </li>
                    ))}
                  </ul>
                )}
                {summary.attention.length > 8 && <p className="m-0 border-t border-line px-4 py-2 text-[11.5px] text-ink3">+{summary.attention.length - 8} hal lainnya — lihat Status Produksi.</p>}
              </Card>

              <Card className="min-w-0 overflow-hidden p-0" data-testid="pic-card">
                <div className="border-b border-line px-4 py-3"><h2 className="m-0 text-[13.5px] font-bold text-ink">Aktivitas PIC &amp; Meja Hari Ini</h2></div>
                {summary.pic.length === 0 ? (
                  <p className="m-0 px-4 py-5 text-[12.5px] text-ink3">Belum ada PIC dengan unit aktif hari ini.</p>
                ) : (
                  <ul className="m-0 list-none divide-y divide-line p-0">
                    {summary.pic.map((p) => (
                      <li key={p.name} className="flex items-center gap-3 px-4 py-2.5 text-[12.5px]">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white">{p.name.slice(0, 1).toUpperCase()}</span>
                        <div className="min-w-0 flex-1"><p className="m-0 truncate font-semibold text-ink">{p.name}</p><p className="m-0 text-[11.5px] text-ink3">{p.stationLabel || "—"}</p></div>
                        <span className="shrink-0 text-right tabular-nums text-ink2"><b>{p.active}</b> aktif<br /><span className="text-[11.5px] text-ink3">{p.completedToday} selesai</span></span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </>
        ) : null}

        <ActiveComplaintsWidget currentOwner="PRODUCTION" title="Kasus Komplain Perlu Rework" />
      </PageBody>
    </PageContainer>
  );
}
