import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GitBranch, RefreshCw, Loader2, Copy } from "lucide-react";
import { api } from "@/api.js";
import { rolesOf } from "@/lib/roles.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows,
} from "@/components/ui/table.jsx";
import { SCOPE_REVISION_STATUS_REAL, SCOPE_REVISION_VIA_REAL } from "@/features/bengkel/unitStatus.js";

function currentUser() {
  try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; }
}

const TABS = [
  { key: "PENDING",  label: "Menunggu" },
  { key: "APPROVED", label: "Disetujui" },
  { key: "PARTIAL",  label: "Setuju Sebagian" },
  { key: "REJECTED", label: "Ditolak" },
  { key: "",         label: "Semua" },
];

// Revisi Lingkup — Production Tahap 4. DATA NYATA.
//
// DUA SISI, SATU HALAMAN: PRODUCTION_LEAD/QC_LEAD mengajukan dari halaman
// Detail Unit (bukan di sini); SALES/ADMIN memutuskan DI SINI. Pemisahan
// ini disengaja (D-008) — satu orang tidak boleh mengarang delta harga
// sekaligus menyetujuinya sendiri.
export default function ProductionScopeRevisions() {
  const navigate = useNavigate();
  const myRoles = rolesOf(currentUser());
  const canDecide = myRoles.some((r) => ["SALES", "ADMIN"].includes(r));

  const [tab, setTab] = useState("PENDING");
  const [revisions, setRevisions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selected, setSelected] = useState(null);
  const [summary, setSummary] = useState(null);
  const [decStatus, setDecStatus] = useState("APPROVED");
  const [decVia, setDecVia] = useState("WHATSAPP");
  const [decNote, setDecNote] = useState("");
  const [decFinalDelta, setDecFinalDelta] = useState("");
  const [decEvidence, setDecEvidence] = useState(null);
  const [decBusy, setDecBusy] = useState(false);
  const [decError, setDecError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.getScopeRevisions({ status: tab || undefined })
      .then(setRevisions)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  function openRow(r) {
    setSelected(r);
    setSummary(null);
    setDecStatus("APPROVED"); setDecVia("WHATSAPP"); setDecNote("");
    setDecFinalDelta(""); setDecEvidence(null); setDecError("");
    api.getScopeRevisionSummary(r.id).then(setSummary).catch(() => {});
  }

  async function salinRingkasan() {
    if (!summary) return;
    const text = [
      `Order ${summary.orderNumber} — ${summary.unitCode}`,
      `Kasur: ${summary.kasur}`,
      `Temuan: ${summary.temuan}`,
      summary.layananSebelum && summary.layananSesudah
        ? `Layanan: ${summary.layananSebelum} → ${summary.layananSesudah}` : null,
      `Selisih harga: Rp${summary.selisihHarga.toLocaleString("id-ID")}`,
      `Total sebelumnya: Rp${summary.totalSekarang.toLocaleString("id-ID")}`,
      `Total setelah revisi: Rp${summary.totalSetelahRevisi.toLocaleString("id-ID")}`,
    ].filter(Boolean).join("\n");
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard tidak tersedia */ }
  }

  async function kirimKeputusan() {
    if (!selected) return;
    setDecBusy(true); setDecError("");
    try {
      const fd = new FormData();
      fd.append("status", decStatus);
      if (decVia) fd.append("decidedVia", decVia);
      if (decNote.trim()) fd.append("decisionNote", decNote.trim());
      if (decStatus === "PARTIAL" && decFinalDelta !== "") fd.append("finalDeltaAmount", decFinalDelta);
      if (decEvidence) fd.append("evidence", decEvidence);
      await api.decideScopeRevision(selected.id, fd);
      setSelected(null);
      load();
    } catch (e) { setDecError(e.message); } finally { setDecBusy(false); }
  }

  const kosong = !loading && revisions && revisions.length === 0;

  return (
    <PageContainer>
      <PageHeader
        title="Revisi Lingkup"
        subtitle="Temuan bongkar yang mengubah harga/layanan, menunggu jawaban customer."
        actions={
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang
          </Button>
        }
      />

      <PageBody>
        <div role="tablist" aria-label="Saring status revisi" className="flex flex-wrap gap-1 border-b border-line pb-2">
          {TABS.map((t) => (
            <button
              key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={`rounded-chip px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${tab === t.key ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint hover:text-ink2"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        <Card className="overflow-hidden">
          {kosong ? (
            <EmptyState
              icon={GitBranch}
              title="Tidak ada revisi lingkup"
              description="Belum ada temuan bongkar yang diajukan untuk status ini."
            />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Unit</TH><TH>Order</TH><TH>Temuan</TH>
                    <TH>Layanan</TH><TH>Selisih</TH><TH>Status</TH><TH>Diajukan Oleh</TH>
                  </TR>
                </THead>
                <TBody>
                  {loading && <TableSkeletonRows rows={6} cols={7} />}
                  {!loading && revisions?.map((r) => (
                    <TR key={r.id} clickable onClick={() => openRow(r)}>
                      <TD className="font-semibold text-ink">{r.unit?.unitCode || "—"}</TD>
                      <TD className="text-ink2">{r.order?.orderNumber || "—"}</TD>
                      <TD truncate className="text-ink2">{r.reason}</TD>
                      <TD truncate className="text-ink2">
                        {r.fromService?.labelId || "—"}{r.toService && ` → ${r.toService.labelId}`}
                      </TD>
                      <TD className="text-ink2">Rp{r.deltaAmount.toLocaleString("id-ID")}</TD>
                      <TD>
                        <Badge variant={SCOPE_REVISION_STATUS_REAL[r.status]?.tone || "neutral"}>
                          {SCOPE_REVISION_STATUS_REAL[r.status]?.label || r.status}
                        </Badge>
                      </TD>
                      <TD className="text-ink2">{r.createdBy?.name || "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>
      </PageBody>

      <Modal
        open={!!selected} onOpenChange={(o) => !o && setSelected(null)}
        title={selected ? `${selected.unit?.unitCode} — ${selected.order?.orderNumber}` : ""}
      >
        {selected && (
          <div className="space-y-3 text-[12.5px]">
            <div>
              <p className="font-semibold text-ink">Temuan</p>
              <p className="text-ink2">{selected.reason}</p>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink2">
                Selisih Rp{selected.deltaAmount.toLocaleString("id-ID")}
                {selected.toService && ` · Ke ${selected.toService.labelId}`}
              </span>
              <Badge variant={SCOPE_REVISION_STATUS_REAL[selected.status]?.tone || "neutral"}>
                {SCOPE_REVISION_STATUS_REAL[selected.status]?.label || selected.status}
              </Badge>
            </div>

            {selected.photoUrls?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selected.photoUrls.map((u) => <img key={u} src={u} alt="" className="h-14 w-14 rounded object-cover" />)}
              </div>
            )}

            {summary && (
              <div className="rounded-btn border border-line bg-surface p-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-[11.5px] font-semibold text-ink2">Ringkasan untuk Customer</p>
                  <Button variant="ghost" size="sm" onClick={salinRingkasan}><Copy size={13} /> Salin</Button>
                </div>
                <p className="mt-1 text-[11.5px] text-ink3">
                  Total sebelumnya Rp{summary.totalSekarang.toLocaleString("id-ID")} → setelah revisi
                  Rp{summary.totalSetelahRevisi.toLocaleString("id-ID")}. Salin lalu kirim manual ke
                  WhatsApp customer — tidak ada pengiriman otomatis.
                </p>
              </div>
            )}

            {selected.status !== "PENDING" ? (
              <p className="text-ink3">
                Sudah diputuskan: <strong>{SCOPE_REVISION_STATUS_REAL[selected.status]?.label}</strong>
                {selected.decidedBy && ` oleh ${selected.decidedBy.name}`}
                {selected.decisionNote && ` — "${selected.decisionNote}"`}
              </p>
            ) : !canDecide ? (
              <p className="text-ink3">Menunggu keputusan dari Sales/Admin.</p>
            ) : (
              <div className="space-y-2 border-t border-line pt-3">
                {decError && <div className="rounded-btn bg-redbg px-2.5 py-2 text-[11.5px] text-red">{decError}</div>}
                <select value={decStatus} onChange={(e) => setDecStatus(e.target.value)}
                  className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
                  <option value="APPROVED">Setujui</option>
                  <option value="PARTIAL">Setuju Sebagian</option>
                  <option value="REJECTED">Tolak</option>
                </select>
                {decStatus === "PARTIAL" && (
                  <input type="number" value={decFinalDelta} onChange={(e) => setDecFinalDelta(e.target.value)}
                    placeholder="Selisih harga final (Rupiah)"
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent" />
                )}
                <select value={decVia} onChange={(e) => setDecVia(e.target.value)}
                  className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
                  {Object.entries(SCOPE_REVISION_VIA_REAL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-[12px] font-medium text-ink2 hover:border-accent hover:text-accent">
                  {decEvidence ? decEvidence.name : "Bukti (screenshot WA, opsional)"}
                  <input type="file" accept="image/*" hidden onChange={(e) => setDecEvidence(e.target.files?.[0] || null)} />
                </label>
                <textarea value={decNote} onChange={(e) => setDecNote(e.target.value)} rows={2}
                  placeholder="Catatan keputusan (opsional)"
                  className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent" />
                <Button className="w-full" onClick={kirimKeputusan} disabled={decBusy}>
                  {decBusy && <Loader2 size={14} className="animate-spin" />} Rekam Keputusan
                </Button>
              </div>
            )}

            <button
              type="button" onClick={() => navigate(`/bengkel/units/${selected.unitId}`)}
              className="text-[11.5px] font-semibold text-accent hover:underline"
            >
              Buka Detail Unit →
            </button>
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}
