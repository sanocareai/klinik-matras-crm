import React, { useCallback, useEffect, useState } from "react";
import { UserCog, Loader2, Plus, X } from "lucide-react";
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

// Operators — Production Core Slice 4M. Administrasi RINGAN profil operator
// produksi (siapa yang bisa ditugaskan ke tahap, skill apa, Work Center
// utamanya) — BUKAN HR management, TIDAK menampilkan data payroll/pribadi
// (lihat ProductionOperator di schema.prisma: hanya userId/active/
// primaryWorkCenterId/employeeCode).
export default function ProductionOperators() {
  const myRoles = rolesOf(currentUser());
  const canManage = myRoles.some((r) => ["ADMIN", "PRODUCTION_LEAD"].includes(r));

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [workCenters, setWorkCenters] = useState([]);
  const [stages, setStages] = useState([]);
  const [users, setUsers] = useState([]);

  const [adding, setAdding] = useState(false);
  const [newUserId, setNewUserId] = useState("");
  const [newWorkCenterId, setNewWorkCenterId] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [skillEditorId, setSkillEditorId] = useState(null);
  const [skillDraft, setSkillDraft] = useState([]);
  const [skillNewStageId, setSkillNewStageId] = useState("");
  const [skillNewLevel, setSkillNewLevel] = useState(3);
  const [skillBusy, setSkillBusy] = useState(false);
  const [skillError, setSkillError] = useState("");

  const load = useCallback(() => {
    setLoading(true); setError("");
    api.getProductionOperators().then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.getWorkCenters().then((d) => setWorkCenters(d.workCenters)).catch(() => {});
    api.getRoutingStages().then((d) => setStages(d.stages)).catch(() => {});
    if (canManage) api.getUsers().then(setUsers).catch(() => {});
  }, [canManage]);

  async function toggleAktif(op) {
    try {
      await api.updateProductionOperator(op.id, { active: !op.active });
      load();
    } catch (e) { setError(e.message); }
  }

  async function ubahWorkCenter(op, workCenterId) {
    try {
      await api.updateProductionOperator(op.id, { primaryWorkCenterId: workCenterId || null });
      load();
    } catch (e) { setError(e.message); }
  }

  async function tambahOperator() {
    if (!newUserId) return;
    setSaveBusy(true); setSaveError("");
    try {
      await api.createProductionOperator({ userId: newUserId, primaryWorkCenterId: newWorkCenterId || undefined });
      setAdding(false); setNewUserId(""); setNewWorkCenterId("");
      load();
    } catch (e) { setSaveError(e.message); } finally { setSaveBusy(false); }
  }

  function bukaSkillEditor(op) {
    setSkillEditorId(op.id);
    setSkillDraft(op.skills.map((s) => ({ stageId: s.stage.id, stageLabel: s.stage.labelId, level: s.level })));
    setSkillError("");
  }

  function tambahSkillDraft() {
    if (!skillNewStageId || skillDraft.some((s) => s.stageId === skillNewStageId)) return;
    const stage = stages.find((s) => s.id === skillNewStageId);
    setSkillDraft((prev) => [...prev, { stageId: skillNewStageId, stageLabel: stage?.labelId || "—", level: Number(skillNewLevel) }]);
    setSkillNewStageId("");
  }

  async function simpanSkills() {
    setSkillBusy(true); setSkillError("");
    try {
      await api.setOperatorSkills(skillEditorId, skillDraft.map((s) => ({ stageId: s.stageId, level: s.level })));
      setSkillEditorId(null);
      load();
    } catch (e) { setSkillError(e.message); } finally { setSkillBusy(false); }
  }

  const operators = data?.operators || [];
  const kosong = !loading && operators.length === 0;

  return (
    <PageContainer>
      <PageHeader
        title="Operators"
        subtitle="Profil operator produksi — siapa bisa ditugaskan ke tahap apa."
        actions={canManage && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus size={14} /> Operator
          </Button>
        )}
      />

      <PageBody>
        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        <Card className="overflow-hidden">
          {kosong ? (
            <EmptyState icon={UserCog} title="Belum ada operator produksi" description="Tambahkan profil operator pertama dari daftar pengguna." />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Operator</TH><TH>Status</TH><TH>Work Center Utama</TH><TH>Skill</TH><TH>Penugasan Sekarang</TH>{canManage && <TH>—</TH>}
                  </TR>
                </THead>
                <TBody>
                  {loading && <TableSkeletonRows rows={5} cols={canManage ? 6 : 5} />}
                  {!loading && operators.map((o) => (
                    <TR key={o.id}>
                      <TD className="font-semibold text-ink">{o.user.name}</TD>
                      <TD><Badge variant={o.active ? "green" : "neutral"}>{o.active ? "Active" : "Nonaktif"}</Badge></TD>
                      <TD>
                        {canManage ? (
                          <select
                            value={o.primaryWorkCenterId || ""} onChange={(e) => ubahWorkCenter(o, e.target.value)}
                            className="h-8 rounded-btn border border-border bg-surface px-2 text-[12px] text-ink outline-none focus:border-accent"
                          >
                            <option value="">— Belum ditetapkan —</option>
                            {workCenters.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                          </select>
                        ) : (o.primaryWorkCenter?.name || <span className="text-ink3">—</span>)}
                      </TD>
                      <TD>
                        {o.skills.length > 0 ? (
                          <span className="text-ink2">{o.skills.length} skill</span>
                        ) : <span className="text-ink3">Belum ada data</span>}
                        {canManage && (
                          <button type="button" onClick={() => bukaSkillEditor(o)} className="ml-1.5 text-[11px] font-semibold text-accent hover:underline">
                            Edit
                          </button>
                        )}
                      </TD>
                      <TD truncate className="text-ink2">
                        {o.currentAssignment
                          ? `${o.currentAssignment.unitCode} — ${o.currentAssignment.stageLabel}`
                          : <span className="text-ink3">Tidak ada</span>}
                      </TD>
                      {canManage && (
                        <TD>
                          <Button size="sm" variant="ghost" onClick={() => toggleAktif(o)}>
                            {o.active ? "Nonaktifkan" : "Aktifkan"}
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

      {/* Tambah Operator (Slice 4F) — pilih User yang SUDAH ada, TIDAK
          membuat identitas paralel (lihat catatan arsitektur schema.prisma
          model ProductionOperator). */}
      <Modal open={adding} onOpenChange={setAdding} title="Operator Baru">
        <div className="space-y-2">
          {saveError && <div className="rounded-btn bg-redbg px-2.5 py-2 text-[11.5px] text-red">{saveError}</div>}
          <label className="block text-[11.5px] font-semibold text-ink2">Pengguna *</label>
          <select value={newUserId} onChange={(e) => setNewUserId(e.target.value)}
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
            <option value="">Pilih pengguna…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <label className="block text-[11.5px] font-semibold text-ink2">Work Center Utama</label>
          <select value={newWorkCenterId} onChange={(e) => setNewWorkCenterId(e.target.value)}
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
            <option value="">— Belum ditetapkan —</option>
            {workCenters.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <Button className="w-full" onClick={tambahOperator} disabled={saveBusy || !newUserId}>
            {saveBusy && <Loader2 size={14} className="animate-spin" />} Simpan
          </Button>
        </div>
      </Modal>

      {/* Edit Skill (Slice 4G) — "ganti semua" (PUT), bukan tambah satu-satu
          per request ke server; draft di klien dulu, satu Simpan mengirim
          seluruh daftar. */}
      <Modal open={!!skillEditorId} onOpenChange={(v) => !v && setSkillEditorId(null)} title="Skill Operator" description="Level 1 (pemula) sampai 5 (mahir).">
        <div className="space-y-3">
          {skillError && <div className="rounded-btn bg-redbg px-2.5 py-2 text-[11.5px] text-red">{skillError}</div>}
          {skillDraft.length > 0 ? (
            <ul className="space-y-1.5">
              {skillDraft.map((s) => (
                <li key={s.stageId} className="flex items-center justify-between gap-2 rounded-btn border border-border px-2.5 py-1.5 text-[12.5px]">
                  <span className="text-ink">{s.stageLabel}</span>
                  <div className="flex items-center gap-2">
                    <select
                      value={s.level}
                      onChange={(e) => setSkillDraft((prev) => prev.map((x) => x.stageId === s.stageId ? { ...x, level: Number(e.target.value) } : x))}
                      className="h-7 rounded-btn border border-border bg-surface px-1.5 text-[11.5px] text-ink outline-none focus:border-accent"
                    >
                      {[1, 2, 3, 4, 5].map((lvl) => <option key={lvl} value={lvl}>{lvl}</option>)}
                    </select>
                    <button type="button" onClick={() => setSkillDraft((prev) => prev.filter((x) => x.stageId !== s.stageId))} className="text-ink3 hover:text-red">
                      <X size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-ink3">Belum ada skill tercatat.</p>
          )}

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-[11px] font-semibold text-ink2">Tambah tahap</label>
              <select value={skillNewStageId} onChange={(e) => setSkillNewStageId(e.target.value)}
                className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent">
                <option value="">Pilih tahap…</option>
                {stages.filter((s) => !skillDraft.some((d) => d.stageId === s.id)).map((s) => (
                  <option key={s.id} value={s.id}>{s.labelId}</option>
                ))}
              </select>
            </div>
            <select value={skillNewLevel} onChange={(e) => setSkillNewLevel(e.target.value)}
              className="h-9 rounded-btn border border-border bg-surface px-2 text-[12px] text-ink outline-none focus:border-accent">
              {[1, 2, 3, 4, 5].map((lvl) => <option key={lvl} value={lvl}>{lvl}</option>)}
            </select>
            <Button size="sm" variant="secondary" onClick={tambahSkillDraft} disabled={!skillNewStageId}>Tambah</Button>
          </div>

          <Button className="w-full" onClick={simpanSkills} disabled={skillBusy}>
            {skillBusy && <Loader2 size={14} className="animate-spin" />} Simpan Skill
          </Button>
        </div>
      </Modal>
    </PageContainer>
  );
}
