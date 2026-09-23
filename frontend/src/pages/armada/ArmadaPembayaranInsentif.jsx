import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows } from "@/components/ui/table.jsx";
import { Wallet, Plus, AlertTriangle } from "lucide-react";
import Avatar from "@/components/Avatar.jsx";
import { formatRupiah, formatTanggalWaktu } from "@/utils/format.js";

// Pembayaran Insentif Driver — Admin/Finance UI (24 September 2026). Lihat
// catatan panjang di backend/src/routes/incentivePayout.js dan
// schema.prisma model IncentivePayout.
//
// TIGA KONSEP TERPISAH, JANGAN PERNAH DICAMPUR di halaman ini:
//   1. Estimasi berjalan (ArmadaDeliveryReport.jsx / PerformaScreen driver-mobile)
//      — LIVE, ikut berubah, bukan tugas Finance mencatat pembayaran.
//   2. Snapshot disahkan (ArmadaInsentifSnapshot.jsx) — angka DIBEKUKAN
//      setelah DRAFT->REVIEWED->APPROVED, TAPI belum tentu sudah dibayar.
//   3. Pembayaran (halaman INI) — jejak uang SUNGGUHAN berpindah tangan,
//      SELALU diturunkan dari ledger IncentivePayout, tidak pernah dari
//      status Snapshot semata. Status APPROVED TIDAK PERNAH ditampilkan
//      sebagai "Sudah Dibayar" di sini — lihat STATUS_LABEL di bawah,
//      "APPROVED" murni berarti "Disahkan", label pembayaran SELALU dari
//      statusPembayaran/status turunan ledger.
const STATUS_PEMBAYARAN_LABEL = {
  UNPAID: { label: "Belum Dibayar", tone: "neutral" },
  PARTIALLY_PAID: { label: "Sebagian Dibayar", tone: "accent" },
  PAID: { label: "Lunas Dibayar", tone: "green" },
};
function StatusPembayaranBadge({ status }) {
  const s = STATUS_PEMBAYARAN_LABEL[status] || { label: status || "—", tone: "neutral" };
  return <Badge variant={s.tone}>{s.label}</Badge>;
}

const METODE_LABEL = { TRANSFER: "Transfer", CASH: "Tunai", OTHER: "Lainnya" };

function CatatPembayaranModal({ line, snapshotId, onOpenChange, onRecorded }) {
  const [method, setMethod] = useState("TRANSFER");
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (line) { setMethod("TRANSFER"); setPaidAt(new Date().toISOString().slice(0, 10)); setAmount(String(line.sisa)); setReferenceNumber(""); setProofUrl(""); setNote(""); setError(""); } }, [line]);

  if (!line) return null;

  const simpan = () => {
    const nominal = Number(amount);
    if (!Number.isInteger(nominal) || nominal <= 0) { setError("Nominal wajib bilangan bulat lebih dari 0"); return; }
    if (nominal > line.sisa) { setError(`Nominal melebihi sisa (${formatRupiah(line.sisa)})`); return; }
    setBusy(true); setError("");
    api.createIncentivePayout({
      snapshotLineId: line.id, amount: nominal, method, paidAt: new Date(paidAt).toISOString(),
      referenceNumber: referenceNumber.trim() || undefined, proofUrl: proofUrl.trim() || undefined, note: note.trim() || undefined,
    })
      .then(() => { onRecorded(); onOpenChange(false); })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <Modal
      open={!!line} onOpenChange={onOpenChange}
      title={`Catat Pembayaran — ${line.userName}`}
      description={`Sisa yang belum dibayar: ${formatRupiah(line.sisa)} dari ${formatRupiah(line.totalRupiah)} disahkan`}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Batal</Button><Button variant="primary" onClick={simpan} disabled={busy}>{busy ? "Menyimpan…" : "Simpan Pembayaran"}</Button></>}
    >
      <div className="space-y-3">
        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}
        <Field label="Metode Pembayaran" required>
          <select
            className="h-9 w-full rounded-lg bg-surface px-2.5 text-sm text-ink outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40"
            value={method} onChange={(e) => setMethod(e.target.value)}
          >
            {Object.entries(METODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Tanggal Bayar" required><Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></Field>
        <Field label="Nominal (Rupiah)" required hint={`Maksimal ${formatRupiah(line.sisa)} (sisa)`}>
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} min={1} max={line.sisa} />
        </Field>
        <Field label="Nomor Referensi" hint="Nomor transfer/kuitansi (opsional)"><Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} /></Field>
        <Field label="Bukti Pembayaran" hint="Tautan/URL bukti transfer atau tanda terima (opsional)"><Input value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} placeholder="https://…" /></Field>
        <Field label="Catatan" hint="Opsional"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function RiwayatModal({ line, onOpenChange, canVoid, onChanged }) {
  const [payouts, setPayouts] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const muat = useCallback(() => {
    if (!line) return;
    api.getIncentivePayouts(line.id).then((r) => setPayouts(r.payouts)).catch((e) => setError(e.message));
  }, [line]);
  useEffect(() => { muat(); }, [muat]);

  if (!line) return null;

  const batalkan = (payout) => {
    const alasan = window.prompt("Alasan pembatalan pembayaran ini:");
    if (!alasan?.trim()) return;
    setBusy(true); setError("");
    api.voidIncentivePayout(payout.id, alasan.trim())
      .then(() => { muat(); onChanged?.(); })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <Modal open={!!line} onOpenChange={onOpenChange} title={`Riwayat Pembayaran — ${line.userName}`} className="w-[520px]">
      <div className="space-y-2">
        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}
        {!payouts ? <TableSkeletonRows rows={3} cols={2} /> : payouts.length === 0 ? (
          <p className="py-4 text-center text-[12.5px] text-ink3">Belum ada pembayaran tercatat.</p>
        ) : payouts.map((p) => (
          <div key={p.id} className={`rounded-btn border border-line p-2.5 ${p.voidedAt ? "opacity-60" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-ink">{formatRupiah(p.amount)}</span>
              <Badge variant={p.voidedAt ? "red" : "green"}>{p.voidedAt ? "Dibatalkan" : METODE_LABEL[p.method] || p.method}</Badge>
            </div>
            <p className="mt-1 text-[11.5px] text-ink2">Dibayar {formatTanggalWaktu(p.paidAt)} · dicatat oleh {p.recordedBy?.name || "—"}</p>
            {p.referenceNumber && <p className="text-[11px] text-ink3">Ref: {p.referenceNumber}</p>}
            {p.note && <p className="text-[11px] text-ink3">Catatan: {p.note}</p>}
            {p.voidedAt ? (
              <p className="mt-1 text-[11px] text-red">Dibatalkan oleh {p.voidedBy?.name || "—"} — {p.voidReason}</p>
            ) : canVoid ? (
              <Button size="sm" variant="ghost" className="mt-1.5 text-red" disabled={busy} onClick={() => batalkan(p)}>Batalkan pembayaran ini</Button>
            ) : null}
          </div>
        ))}
      </div>
    </Modal>
  );
}

export default function ArmadaPembayaranInsentif() {
  const [snapshots, setSnapshots] = useState(null);
  const [error, setError] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterOrang, setFilterOrang] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [bayarLine, setBayarLine] = useState(null);
  const [riwayatLine, setRiwayatLine] = useState(null);
  const [capabilities, setCapabilities] = useState({});

  const load = useCallback(() => {
    api.getIncentivePayoutQueue()
      .then((r) => setSnapshots(r.snapshots))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.getMyPortals().then((me) => setCapabilities(me.capabilities || {})).catch(() => {}); }, []);

  const snapshotsTersaring = useMemo(() => {
    if (!snapshots) return null;
    return snapshots
      .filter((s) => !filterStatus || s.status === filterStatus)
      .filter((s) => !filterOrang || s.lines.some((l) => l.userName.toLowerCase().includes(filterOrang.toLowerCase())));
  }, [snapshots, filterStatus, filterOrang]);

  return (
    <PageContainer>
      <PageHeader
        title="Pembayaran Insentif"
        subtitle="Mencatat pembayaran SUNGGUHAN atas Snapshot yang sudah disahkan (APPROVED) — bukan status disahkan itu sendiri."
      />
      <PageBody>
        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        {/* Pemisah konsep eksplisit (spec: "Pisahkan jelas") */}
        <div className="flex items-start gap-2 rounded-btn bg-accentbg px-3 py-2.5 text-[12px] text-accent">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>Snapshot berstatus <strong>Disahkan Owner (APPROVED)</strong> berarti angkanya SAH — belum tentu sudah dibayar. Status pembayaran di halaman ini SELALU dihitung dari pembayaran yang benar-benar tercatat, bukan dari status Snapshot.</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            className="h-9 rounded-lg bg-surface px-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">Semua status pembayaran</option>
            {Object.entries(STATUS_PEMBAYARAN_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <Input placeholder="Cari nama driver/helper…" value={filterOrang} onChange={(e) => setFilterOrang(e.target.value)} className="w-56" />
        </div>

        {!snapshotsTersaring ? (
          <Card className="p-4"><TableSkeletonRows rows={4} cols={5} /></Card>
        ) : snapshotsTersaring.length === 0 ? (
          <EmptyState icon={Wallet} title="Tidak ada kewajiban pembayaran" description="Snapshot yang belum disahkan, sudah lunas semua, atau Rp0 tidak muncul di sini." />
        ) : (
          <div className="space-y-3">
            {snapshotsTersaring.map((s) => (
              <Card key={s.id} className="overflow-hidden p-0">
                <button
                  type="button" onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                  className="flex w-full items-center justify-between gap-3 border-b border-line px-4 py-3 text-left"
                >
                  <div>
                    <p className="font-semibold text-ink">{s.periodFrom} s/d {s.periodTo}</p>
                    <p className="text-[11.5px] text-ink2">Disahkan {formatRupiah(s.totalRupiah)} · Dibayar {formatRupiah(s.totalDibayar)} · Sisa {formatRupiah(s.totalSisa)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-inset">
                      <div className="h-full bg-green" style={{ width: `${Math.round(s.progress * 100)}%` }} />
                    </div>
                    <StatusPembayaranBadge status={s.status} />
                  </div>
                </button>
                {expandedId === s.id && (
                  <TableWrap>
                    <Table>
                      <THead><TR><TH>Nama</TH><TH>Tarif</TH><TH numeric>Nilai Disahkan</TH><TH numeric>Dibayar</TH><TH numeric>Sisa</TH><TH>Status</TH><TH>Aksi</TH></TR></THead>
                      <TBody>
                        {s.lines.map((l) => (
                          <TR key={l.id}>
                            <TD className="font-semibold text-ink">
                              <span className="flex items-center gap-2"><Avatar name={l.userName} size="sm" gradient className="h-7 w-7 shrink-0 text-[10px]" />{l.userName}</span>
                            </TD>
                            <TD className="text-ink2">{formatRupiah(l.ratePerAlamat)}/alamat</TD>
                            <TD numeric className="font-semibold text-ink">{formatRupiah(l.totalRupiah)}</TD>
                            <TD numeric className="text-green">{formatRupiah(l.dibayar)}</TD>
                            <TD numeric className="font-semibold text-accent">{formatRupiah(l.sisa)}</TD>
                            <TD><StatusPembayaranBadge status={l.status} /></TD>
                            <TD>
                              <div className="flex gap-1.5">
                                {l.sisa > 0 && capabilities.incentivePayoutCreate && (
                                  <Button size="sm" variant="secondary" onClick={() => setBayarLine(l)}><Plus size={12} /> Catat Pembayaran</Button>
                                )}
                                <Button size="sm" variant="ghost" onClick={() => setRiwayatLine(l)}>Riwayat</Button>
                              </div>
                            </TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </TableWrap>
                )}
              </Card>
            ))}
          </div>
        )}
      </PageBody>

      <CatatPembayaranModal line={bayarLine} onOpenChange={(o) => !o && setBayarLine(null)} onRecorded={load} />
      <RiwayatModal line={riwayatLine} onOpenChange={(o) => !o && setRiwayatLine(null)} canVoid={!!capabilities.incentivePayoutVoid} onChanged={load} />
    </PageContainer>
  );
}
