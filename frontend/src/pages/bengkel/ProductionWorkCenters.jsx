import React, { useCallback, useEffect, useState } from "react";
import { Factory, Loader2, Plus } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows } from "@/components/ui/table.jsx";
import { rolesOf } from "@/lib/roles.js";

function currentUser() {
  try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; }
}

// Work Centers — Production Core Slice 4L. Halaman KONFIGURASI area kerja
// produksi (Spring/Foam/Jahit/QC, dst) — BUKAN Capacity Planning (tidak ada
// utilisasi/kapasitas di sini, sengaja, lihat ticket Slice 4). Jumlah
// stageCount/operatorCount/currentUnitCount SEMUA turunan nyata dari
// backend (bounded query, lihat routes/production.js#/work-centers), TIDAK
// ADA angka karangan.
export default function ProductionWorkCenters() {
  const myRoles = rolesOf(currentUser());
  const canManage = myRoles.some((r) => ["ADMIN", "PRODUCTION_LEAD"].includes(r));

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [detailId, setDetailId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState("");

  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState("");

  const load = useCallback(() => {
    setLoading(true); setError("");
    api.getWorkCenters().then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  function bukaDetail(id) {
    setDetailId(id); setDetail(null); setDetailError("");
    api.getWorkCenter(id).then(setDetail).catch((e) => setDetailError(e.message));
  }

  async function toggleAktif(wc) {
    try {
      await api.updateWorkCenter(wc.id, { active: !wc.active });
      load();
    } catch (e) { setError(e.message); }
  }

  async function simpanBaru() {
    if (!code.trim() || !name.trim()) return;
    setSaveBusy(true); setSaveError("");
    try {
      await api.createWorkCenter({ code: code.trim().toUpperCase(), name: name.trim(), description: description.trim() || undefined });
      setAdding(false); setCode(""); setName(""); setDescription("");
      load();
    } catch (e) { setSaveError(e.message); } finally { setSaveBusy(false); }
  }

  const rows = data?.workCenters || [];
  const kosong = !loading && rows.length === 0;

  return (
    <PageContainer>
      <PageHeader
        title="Work Centers"
        subtitle="Area kerja produksi — konfigurasi, bukan perencanaan kapasitas."
        actions={canManage && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus size={14} /> Work Center
          </Button>
        )}
      />

      <PageBody>
        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        <Card className="overflow-hidden">
          {kosong ? (
            <EmptyState icon={Factory} title="Belum ada Work Center" description="Tambahkan area kerja produksi pertama." />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Work Center</TH><TH>Status</TH><TH>Tahap Rute</TH><TH>Operator Aktif</TH><TH>Unit Sekarang</TH>{canManage && <TH>—</TH>}
                  </TR>
                </THead>
                <TBody>
                  {loading && <TableSkeletonRows rows={5} cols={canManage ? 6 : 5} />}
                  {!loading && rows.map((w) => (
                    <TR key={w.id} clickable onClick={() => bukaDetail(w.id)}>
                      <TD className="font-semibold text-ink">
                        {w.name}
                        <span className="ml-1.5 font-mono text-[10.5px] text-ink3">{w.code}</span>
                      </TD>
                      <TD>
                        <Badge variant={w.active ? "green" : "neutral"}>{w.active ? "Active" : "Nonaktif"}</Badge>
                      </TD>
                      <TD className="text-ink2">{w.stageCount} tahap</TD>
                      <TD className="text-ink2">{w.operatorCount} operator</TD>
                      <TD className="text-ink2">{w.currentUnitCount} unit</TD>
                      {canManage && (
                        <TD onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="ghost" onClick={() => toggleAktif(w)}>
                            {w.active ? "Nonaktifkan" : "Aktifkan"}
                          </Button>
                        </TD>
                      )}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>
      </PageBody>

      {/* Detail ringan (Slice 4L) — TANPA chart kapasitas apa pun. */}
      <Modal open={!!detailId} onOpenChange={(v) => !v && setDetailId(null)} title={detail?.workCenter.name} description={detail?.workCenter.code}>
        {detailError && <div className="mb-3 rounded-btn bg-redbg px-2.5 py-2 text-[11.5px] text-red">{detailError}</div>}
        {!detail && !detailError ? (
          <p className="flex items-center gap-1.5 text-[12.5px] text-ink3"><Loader2 size={14} className="animate-spin" /> Memuat…</p>
        ) : detail && (
          <div className="space-y-3 text-[12.5px]">
            {detail.workCenter.description && <p className="text-ink2">{detail.workCenter.description}</p>}
            <div>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink3">Tahap Rute</h4>
              {detail.stages.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {detail.stages.map((s) => <Badge key={s.id} variant="accent">{s.labelId}</Badge>)}
                </div>
              ) : <p className="text-ink3">Belum ada tahap yang menjadikan ini default.</p>}
            </div>
            <div>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink3">Operator Aktif</h4>
              {detail.operators.length > 0 ? (
                <ul className="space-y-0.5">
                  {detail.operators.map((o) => <li key={o.id} className="text-ink">{o.user.name}</li>)}
                </ul>
              ) : <p className="text-ink3">Belum ada operator dengan Work Center utama ini.</p>}
            </div>
          </div>
        )}
      </Modal>

      {/* Tambah Work Center (Slice 4L) — form ringkas, TANPA
          standardDailyMinutes (fondasi Capacity Planning masa depan, biarkan
          null sampai benar-benar dikonfigurasi — Slice 4T). */}
      <Modal open={adding} onOpenChange={setAdding} title="Work Center Baru">
        <div className="space-y-2">
          {saveError && <div className="rounded-btn bg-redbg px-2.5 py-2 text-[11.5px] text-red">{saveError}</div>}
          <label className="block text-[11.5px] font-semibold text-ink2">Kode *</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="mis. SPRING"
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent" />
          <label className="block text-[11.5px] font-semibold text-ink2">Nama *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Spring"
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent" />
          <label className="block text-[11.5px] font-semibold text-ink2">Deskripsi</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent" />
          <Button className="w-full" onClick={simpanBaru} disabled={saveBusy || !code.trim() || !name.trim()}>
            {saveBusy && <Loader2 size={14} className="animate-spin" />} Simpan
          </Button>
        </div>
      </Modal>
    </PageContainer>
  );
}
