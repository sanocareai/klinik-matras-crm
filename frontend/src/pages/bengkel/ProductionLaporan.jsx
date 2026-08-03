import React, { useCallback, useEffect, useState } from "react";
import { Gauge, Clock, ShieldCheck, RefreshCw } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import StatCard from "@/components/ui/stat-card.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD,
} from "@/components/ui/table.jsx";
import { hariIniWIB } from "@/utils/formatDate.js";

function defaultFrom() {
  const d = new Date(Date.now() - 30 * 86_400_000);
  return d.toISOString().slice(0, 10);
}

// Laporan Produksi — Production Tahap 6 (terakhir dari 6 fase rebuild
// Bengkel). Throughput, durasi per tahap, tingkat kelulusan QC — SEMUA
// dihitung dari unit_stage_logs/qc_fit_tests yang sama dipakai stage engine.
//
// JUJUR: unit_stage_logs masih 0 baris di production sampai unit pertama
// diadopsi ke engine (lihat unitStatus.js) — laporan ini akan tampil kosong
// untuk sementara, itu bukan bug.
export default function ProductionLaporan() {
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(hariIniWIB());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.getProductionReport({ from, to })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const passRatePct = data?.qc.passRate != null ? Math.round(data.qc.passRate * 100) : null;

  return (
    <PageContainer>
      <PageHeader
        title="Laporan Produksi"
        subtitle="Throughput, durasi per tahap, dan tingkat kelulusan QC."
        actions={
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang
          </Button>
        }
      />

      <PageBody>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="h-9 rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-accent" />
          <span className="text-[12px] text-ink3">s/d</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="h-9 rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-accent" />
        </div>

        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        {data && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Unit Selesai Produksi" icon={Gauge} depth={1}
              value={data.throughput.reduce((n, r) => n + r.count, 0)}
              deltaSuffix="tahap FINISH selesai, periode ini"
            />
            <StatCard
              label="Tingkat Kelulusan QC" icon={ShieldCheck} depth={2}
              value={passRatePct != null ? `${passRatePct}%` : "—"}
              deltaSuffix={`${data.qc.passed}/${data.qc.total} uji lulus`}
            />
            <StatCard
              label="Tahap Terukur" icon={Clock} depth={1}
              value={data.stageDuration.length}
              deltaSuffix="tahap punya data durasi"
            />
          </div>
        )}

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Throughput Harian</CardTitle>
            <CardDescription>Unit yang menyelesaikan tahap FINISH per hari (WIB).</CardDescription>
          </CardHeader>
          {!loading && data?.throughput.length === 0 ? (
            <EmptyState icon={Gauge} title="Belum ada unit selesai" description="Belum ada tahap FINISH yang diselesaikan pada periode ini." />
          ) : (
            <TableWrap>
              <Table>
                <THead><TR><TH>Tanggal</TH><TH>Unit Selesai</TH></TR></THead>
                <TBody>
                  {data?.throughput.map((r) => (
                    <TR key={r.bucket}><TD>{r.bucket}</TD><TD className="text-ink2">{r.count}</TD></TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Durasi per Tahap</CardTitle>
            <CardDescription>Rata-rata waktu pengerjaan (jam) dari log selesai tahap.</CardDescription>
          </CardHeader>
          {!loading && data?.stageDuration.length === 0 ? (
            <EmptyState icon={Clock} title="Belum ada data durasi" description="Belum ada tahap yang diselesaikan lewat alur start/complete pada periode ini." />
          ) : (
            <TableWrap>
              <Table>
                <THead><TR><TH>Tahap</TH><TH>Fase</TH><TH>Rata-rata Durasi</TH><TH>Sampel</TH></TR></THead>
                <TBody>
                  {data?.stageDuration.map((s) => (
                    <TR key={s.stage.id}>
                      <TD className="font-semibold text-ink">{s.stage.labelId}</TD>
                      <TD className="text-ink2">{s.stage.phase}</TD>
                      <TD className="text-ink2">{s.avgHours != null ? `${s.avgHours.toFixed(1)} jam` : "—"}</TD>
                      <TD className="text-ink2">{s.sampleCount}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>

        {data?.qc.byVerdict.length > 0 && (
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Rincian Verdict Uji Berat Badan</CardTitle>
            </CardHeader>
            <TableWrap>
              <Table>
                <THead><TR><TH>Verdict</TH><TH>Jumlah</TH></TR></THead>
                <TBody>
                  {data.qc.byVerdict.map((v) => (
                    <TR key={v.verdict}><TD className="font-semibold text-ink">{v.verdict}</TD><TD className="text-ink2">{v.count}</TD></TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </Card>
        )}
      </PageBody>
    </PageContainer>
  );
}
