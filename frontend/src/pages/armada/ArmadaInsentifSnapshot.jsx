import React, { useCallback, useEffect, useState } from "react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows } from "@/components/ui/table.jsx";
import { FileCheck, AlertTriangle, Plus } from "lucide-react";
import Avatar from "@/components/Avatar.jsx";
import { formatRupiah } from "@/utils/format.js";

// Snapshot Insentif Driver — Admin UI (24 September 2026). Lihat catatan
// panjang di backend/src/routes/incentiveSnapshot.js dan schema.prisma
// model IncentiveSnapshot untuk alur DRAFT->REVIEWED->APPROVED lengkap.
//
// TERPISAH dari "Estimasi Insentif" di Laporan (ArmadaDeliveryReport.jsx) —
// halaman itu TETAP live/estimasi apa adanya, TIDAK berubah. Halaman ini
// murni untuk PEMBEKUAN angka demi alur persetujuan pembayaran.
const STATUS_LABEL = {
  DRAFT: { label: "Draft", tone: "neutral" },
  REVIEWED: { label: "Direview Finance", tone: "accent" },
  APPROVED: { label: "Disetujui Owner", tone: "green" },
  REJECTED: { label: "Ditolak", tone: "red" },
};

function StatusBadge({ status }) {
  const s = STATUS_LABEL[status] || { label: status, tone: "neutral" };
  return <Badge variant={s.tone}>{s.label}</Badge>;
}

const BULAN_LABEL = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function CreateSnapshotModal({ open, onOpenChange, onCreated }) {
  const now = new Date(Date.now() + 7 * 3600_000);
  const [mode, setMode] = useState("monthly");
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const body = mode === "monthly" ? { mode, year: Number(year), month: Number(month) } : { mode, from, to };

  const lihatPreview = useCallback(() => {
    if (mode === "custom" && (!from || !to)) { setError("Isi tanggal awal dan akhir dulu."); return; }
    setLoading(true); setError(""); setPreview(null);
    api.previewIncentiveSnapshot(body)
      .then(setPreview)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, year, month, from, to]);

  const buatSnapshot = () => {
    setCreating(true); setError("");
    api.createIncentiveSnapshot(body)
      .then((s) => { onCreated(s); onOpenChange(false); setPreview(null); })
      .catch((e) => setError(e.message))
      .finally(() => setCreating(false));
  };

  useEffect(() => { if (!open) { setPreview(null); setError(""); } }, [open]);

  return (
    <Modal
      open={open} onOpenChange={onOpenChange}
      title="Buat Snapshot Insentif"
      description="Pembekuan angka untuk alur persetujuan — bukan pembayaran langsung."
      className="w-[560px]"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button variant="secondary" onClick={lihatPreview} disabled={loading}>{loading ? "Menghitung…" : "Lihat Preview"}</Button>
          <Button variant="primary" onClick={buatSnapshot} disabled={!preview || creating}>{creating ? "Membuat…" : "Buat Snapshot"}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => { setMode(v); setPreview(null); }}>
          <TabsList>
            <TabsTrigger value="monthly">Bulanan</TabsTrigger>
            <TabsTrigger value="custom">Custom Range</TabsTrigger>
          </TabsList>
        </Tabs>

        {mode === "monthly" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bulan">
              <select
                className="h-9 w-full rounded-lg bg-surface px-2.5 text-sm text-ink outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40"
                value={month} onChange={(e) => { setMonth(e.target.value); setPreview(null); }}
              >
                {BULAN_LABEL.map((b, i) => <option key={i + 1} value={i + 1}>{b}</option>)}
              </select>
            </Field>
            <Field label="Tahun">
              <Input type="number" value={year} onChange={(e) => { setYear(e.target.value); setPreview(null); }} />
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Dari tanggal (WIB)"><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreview(null); }} /></Field>
            <Field label="Sampai tanggal (WIB)"><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreview(null); }} /></Field>
          </div>
        )}

        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        {preview && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-btn bg-inset/40 px-3 py-2.5">
              <span className="text-[12.5px] text-ink2">{preview.periodFrom} s/d {preview.periodTo}</span>
              <span className="text-[13px] font-bold text-ink">{preview.totalAlamat} alamat · {formatRupiah(preview.totalRupiah)}</span>
            </div>

            {preview.peringatan.overlapKalender.length > 0 && (
              <div className="flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2.5 text-[12px] text-orange">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>Periode ini beririsan dengan {preview.peringatan.overlapKalender.length} snapshot lain. {preview.peringatan.klaimBentrok > 0 ? `${preview.peringatan.klaimBentrok} alamat sudah diklaim — akan DITOLAK saat dibuat kalau tidak diselesaikan dulu.` : "Belum ada alamat yang benar-benar bentrok."}</span>
              </div>
            )}
            {preview.peringatan.kandidatBelumTerverifikasi && (
              <div className="flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2.5 text-[12px] text-orange">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>Ada kandidat historis UnitRevision yang belum terverifikasi Ops di periode ini — lihat catatan per baris di bawah.</span>
              </div>
            )}

            <div className="max-h-[240px] space-y-1.5 overflow-y-auto">
              {preview.orang.length === 0 ? (
                <p className="py-3 text-center text-[12px] text-ink3">Tidak ada alamat selesai di periode ini.</p>
              ) : preview.orang.map((o) => (
                <div key={o.id} className="flex items-center justify-between rounded-btn border border-line px-3 py-2">
                  <span className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
                    <Avatar name={o.name} size="sm" gradient className="h-6 w-6 shrink-0 text-[9px]" />
                    {o.name}
                    {o.detail.some((d) => d.kandidatBelumTerverifikasi) && <AlertTriangle size={12} className="text-orange" />}
                  </span>
                  <span className="text-[12.5px] font-semibold text-ink">{o.totalAlamat} alamat · {formatRupiah(o.totalInsentif)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function DetailSnapshotModal({ id, onOpenChange, onChanged, capabilities }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const muat = useCallback(() => {
    if (!id) return;
    api.getIncentiveSnapshot(id).then(setData).catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => { muat(); }, [muat]);

  const aksi = (fn) => {
    setBusy(true); setError("");
    fn().then((s) => { setData((prev) => ({ ...prev, ...s })); onChanged?.(); })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  if (!id) return null;

  return (
    <Modal
      open={!!id} onOpenChange={onOpenChange}
      title={data ? `Snapshot ${data.periodFrom} s/d ${data.periodTo}` : "Memuat…"}
      description={data ? <StatusBadge status={data.status} /> : ""}
      className="w-[680px]"
      footer={data && (
        <>
          {["DRAFT", "REVIEWED"].includes(data.status) && (capabilities.incentiveSnapshotReview || capabilities.incentiveSnapshotApprove) && (
            <Button
              variant="danger" disabled={busy}
              onClick={() => { const alasan = window.prompt("Alasan penolakan:"); if (alasan?.trim()) aksi(() => api.rejectIncentiveSnapshot(data.id, alasan.trim())); }}
            >
              Tolak
            </Button>
          )}
          {data.status === "DRAFT" && capabilities.incentiveSnapshotReview && (
            <Button variant="secondary" disabled={busy} onClick={() => aksi(() => api.reviewIncentiveSnapshot(data.id))}>Tandai Direview</Button>
          )}
          {data.status === "REVIEWED" && capabilities.incentiveSnapshotApprove && (
            <Button variant="primary" disabled={busy} onClick={() => aksi(() => api.approveIncentiveSnapshot(data.id))}>Setujui</Button>
          )}
          {data.status === "APPROVED" && capabilities.incentiveSnapshotCreate && (
            <Button
              variant="secondary" disabled={busy}
              onClick={() => { const alasan = window.prompt("Alasan koreksi (adjustment):"); if (alasan?.trim()) aksi(() => api.adjustIncentiveSnapshot(data.id, { mode: "custom", from: data.periodFrom, to: data.periodTo, reason: alasan.trim() })); }}
            >
              Buat Adjustment
            </Button>
          )}
        </>
      )}
    >
      {error && <div className="mb-3 rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}
      {!data ? <TableSkeletonRows rows={3} cols={3} /> : (
        <div className="space-y-4">
          {data.status === "REJECTED" && data.rejectionReason && (
            <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">Ditolak: {data.rejectionReason}</div>
          )}
          {data.adjustsSnapshot && (
            <div className="rounded-btn bg-inset/40 px-3 py-2.5 text-[12px] text-ink2">Koreksi atas snapshot {data.adjustsSnapshot.periodFrom} s/d {data.adjustsSnapshot.periodTo} ({data.adjustsSnapshot.status}).</div>
          )}
          {data.adjustments?.length > 0 && (
            <div className="rounded-btn bg-inset/40 px-3 py-2.5 text-[12px] text-ink2">Dikoreksi oleh {data.adjustments.length} snapshot adjustment.</div>
          )}

          {/* Selisih estimasi live vs snapshot */}
          {data.liveComparison?.berubah && (
            <div className="flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2.5 text-[12px] text-orange">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>Data sudah berubah sejak snapshot ini dibuat — estimasi LIVE sekarang {data.liveComparison.totalAlamat} alamat · {formatRupiah(data.liveComparison.totalRupiah)} (snapshot dibekukan: {data.totalAlamat} alamat · {formatRupiah(data.totalRupiah)}).</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <div className="rounded-btn bg-inset/40 px-3 py-2">
              <p className="text-ink3">Dibuat</p>
              <p className="font-medium text-ink">{data.computedBy?.name || "—"}</p>
            </div>
            <div className="rounded-btn bg-inset/40 px-3 py-2">
              <p className="text-ink3">Direview</p>
              <p className="font-medium text-ink">{data.reviewedBy?.name || "—"}</p>
            </div>
            <div className="rounded-btn bg-inset/40 px-3 py-2">
              <p className="text-ink3">Disetujui</p>
              <p className="font-medium text-ink">{data.approvedBy?.name || "—"}</p>
            </div>
            <div className="rounded-btn bg-inset/40 px-3 py-2">
              <p className="text-ink3">Versi rumus</p>
              <p className="font-mono font-medium text-ink">{data.formulaVersion}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            {data.lines.map((l) => (
              <details key={l.id} className="rounded-btn border border-line">
                <summary className="flex cursor-pointer items-center justify-between px-3 py-2">
                  <span className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
                    <Avatar name={l.userName} size="sm" gradient className="h-6 w-6 shrink-0 text-[9px]" />
                    {l.userName}
                    <Badge variant={l.hasSim ? "green" : "neutral"}>{l.hasSim ? "SIM" : "Tanpa SIM"}</Badge>
                  </span>
                  <span className="text-[12.5px] font-semibold text-ink">{l.totalAlamat} alamat · {formatRupiah(l.totalRupiah)}</span>
                </summary>
                <div className="space-y-1 border-t border-line px-3 py-2">
                  {l.details.map((d) => (
                    <div key={d.id} className="flex items-center justify-between text-[11.5px]">
                      <span className="text-ink2">{d.tanggalWIB} · order {d.orderId.slice(0, 8)}… {d.asDriver && "· driver"} {d.asHelper && "· helper"}</span>
                      {d.kandidatBelumTerverifikasi ? (
                        <span className="flex items-center gap-1 text-orange" title={d.kandidatBelumTerverifikasi.join("; ")}>
                          <AlertTriangle size={11} /> Menunggu konfirmasi Ops
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function ArmadaInsentifSnapshot() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [capabilities, setCapabilities] = useState({});

  const load = useCallback(() => {
    api.listIncentiveSnapshots(statusFilter ? { status: statusFilter } : {})
      .then((r) => setList(r.snapshots))
      .catch((e) => setError(e.message));
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.getMyPortals().then((me) => setCapabilities(me.capabilities || {})).catch(() => {}); }, []);

  return (
    <PageContainer>
      <PageHeader
        title="Snapshot Insentif Driver"
        subtitle="Pembekuan angka insentif untuk alur persetujuan Finance & Owner — terpisah dari Estimasi Insentif live di Laporan."
        actions={capabilities.incentiveSnapshotCreate && (
          <Button variant="primary" onClick={() => setCreateOpen(true)}><Plus size={14} /> Buat Snapshot</Button>
        )}
      />
      <PageBody>
        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList>
            <TabsTrigger value="">Semua</TabsTrigger>
            <TabsTrigger value="DRAFT">Draft</TabsTrigger>
            <TabsTrigger value="REVIEWED">Direview</TabsTrigger>
            <TabsTrigger value="APPROVED">Disetujui</TabsTrigger>
            <TabsTrigger value="REJECTED">Ditolak</TabsTrigger>
          </TabsList>
        </Tabs>

        <Card className="overflow-hidden p-0">
          {!list ? <div className="p-4"><TableSkeletonRows rows={4} cols={6} /></div> : list.length === 0 ? (
            <EmptyState icon={FileCheck} title="Belum ada Snapshot" description="Buat snapshot bulanan atau custom range untuk memulai alur persetujuan." />
          ) : (
            <TableWrap>
              <Table>
                <THead><TR><TH>Periode</TH><TH>Status</TH><TH numeric>Total Alamat</TH><TH numeric>Total Rupiah</TH><TH>Dibuat</TH><TH>Disetujui</TH></TR></THead>
                <TBody>
                  {list.map((s) => (
                    <TR key={s.id} clickable onClick={() => setDetailId(s.id)}>
                      <TD className="font-semibold text-ink">{s.periodFrom} s/d {s.periodTo}</TD>
                      <TD><StatusBadge status={s.status} /></TD>
                      <TD numeric className="text-ink2">{s.totalAlamat}</TD>
                      <TD numeric className="font-semibold text-accent">{formatRupiah(s.totalRupiah)}</TD>
                      <TD className="text-ink2">{s.computedBy?.name || "—"}</TD>
                      <TD className="text-ink2">{s.approvedBy?.name || "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>
      </PageBody>

      <CreateSnapshotModal open={createOpen} onOpenChange={setCreateOpen} onCreated={() => load()} />
      <DetailSnapshotModal id={detailId} onOpenChange={(o) => !o && setDetailId(null)} onChanged={load} capabilities={capabilities} />
    </PageContainer>
  );
}
