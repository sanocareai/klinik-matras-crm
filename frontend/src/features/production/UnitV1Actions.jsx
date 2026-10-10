import React, { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import { formatTanggalJam, formatDurasiMenit } from "@/utils/formatDate.js";
import { SERVICE_LINE_REAL } from "@/features/bengkel/unitStatus.js";
import { DELAY_TITLE, RESUME_ACTION_LABEL, delayReasonOfBlock, priorityOf, resumeInfo } from "@/features/production/productionLabels.js";
import { canResolveBlockerV1, canRouteV1, conflictMessage, detectConflict, draftOf, isDraftDirty, productionPatchOf } from "./unitV1ActionsModel.js";

// P12B.5 — aksi V1 yang SAH untuk unit NON-V2 di drawer Unit 360 (menggantikan halaman Unit lama): Layanan Teknis, Prioritas & Target, Blokir.
// Hanya dirender untuk unit di luar cohort (Unit 360 = 404). Unit cohort V2 TIDAK pernah memakai komponen ini — pemilik perintahnya V2
// (Diagnosis untuk layanan teknis, Rencana Produksi untuk prioritas/target, Menunggu Bahan/Gudang untuk hambatan): tidak ada bypass.
// Setiap tulis: baca ulang → bila ada perubahan orang lain (konflik) berhenti & muat ulang; selain itu tulis, baca ulang, tampilkan hasil.
const SELECT_CLS = "h-9 w-full rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-accent";

function Section({ title, testid, children }) {
  return <section className="rounded-btn border border-line p-3" data-testid={testid}><h3 className="m-0 mb-2 text-[13px] font-bold text-ink">{title}</h3>{children}</section>;
}
const Msg = ({ kind, children, testid }) => (children ? <p role={kind === "error" ? "alert" : "status"} data-testid={testid} className={`m-0 rounded-btn px-3 py-2 text-[12px] ${kind === "error" ? "bg-redbg text-red" : "bg-greenbg text-green"}`}>{children}</p> : null);

export default function UnitV1Actions({ data, roles, onData, onChanged }) {
  const unit = data.unit;
  const canRoute = canRouteV1(roles); const canResolve = canResolveBlockerV1(roles);
  const [draft, setDraft] = useState(() => draftOf(unit));
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState({ section: "", kind: "", text: "" });

  // Draf mengikuti data terbaru dari server (setelah simpan / muat ulang karena konflik).
  useEffect(() => { setDraft(draftOf(data.unit)); }, [data.unit.id, data.unit.priority, data.unit.productionDueAt, data.unit.serviceId]);

  // Dua lapis konflik: (1) pra-cek ramah di klien (langsung memberi tahu bidang apa yang berubah), (2) kunci ATOMIK di server — nilai yang dilihat klien dikirim sebagai
  // expected dan server menulis hanya bila DB masih sama (409 UNIT_CONFLICT bila tidak). Lapis 2 yang menjadi penegak; lapis 1 hanya kenyamanan.
  async function run(section, fields, write, okText) {
    setBusy(section); setMsg({ section: "", kind: "", text: "" });
    try {
      const latest = await api.getUnitTimeline(unit.id);
      const conflict = detectConflict(data, latest, fields);
      if (conflict.length) { onData(latest); setMsg({ section, kind: "error", text: conflictMessage(conflict) }); return; }
      await write();
      onData(await api.getUnitTimeline(unit.id)); onChanged?.();
      setMsg({ section, kind: "ok", text: okText });
    } catch (e) {
      if (e.code === "UNIT_CONFLICT" || e.code === "UNIT_V2_OWNED") { try { onData(await api.getUnitTimeline(unit.id)); } catch { /* biarkan */ } }
      setMsg({ section, kind: "error", text: e.code === "UNIT_CONFLICT" ? `${e.message} Tampilan dimuat ulang.` : (e.message || "Gagal menyimpan") });
    } finally { setBusy(""); }
  }

  // Tanpa pilihan: server menurunkan rute dari item order Sales (pemetaan Admin). Bila tidak cukup, alasan + siapa yang memperbaiki tampil di bawah.
  const saveService = () => run("service", ["service"], () => api.setUnitService(unit.id, null, unit.serviceId ?? null), "Rute pengerjaan ditentukan dari Layanan Sales.");
  const patch = productionPatchOf(draft, unit);
  const saveProduction = () => run("production", ["priority", "due"], () => api.updateUnitProduction(unit.id, { ...patch, expected: { priority: unit.priority || "NORMAL", productionDueAt: unit.productionDueAt || null } }), "Prioritas & target tersimpan.");
  const m = (s) => (msg.section === s ? msg : { kind: "", text: "" });
  const blocker = data.activeBlocker;

  return (
    <div className="space-y-3" data-testid="unit-v1-actions">
      <Section title="Layanan Sales" testid="v1-service">
        <dl className="m-0 grid grid-cols-1 gap-2 text-[12.5px]">
          <div className="min-w-0 rounded-btn bg-inset px-3 py-2" data-testid="v1-sales-services"><dt className="m-0 text-ink3">Layanan Dipesan (Sales) <span className="rounded-chip bg-accentbg px-1 py-0.5 text-[9px] font-semibold text-accent">ORDER · baca-saja</span></dt><dd className="m-0 break-words font-semibold text-ink">{(data.salesServices || []).length ? data.salesServices.join(", ") : "Belum dicatat"}</dd></div>
        </dl>
        {/* Layanan teknis TIDAK ditampilkan dan tidak diubah (data historis dipertahankan). Hanya bila rute pengerjaan BELUM ada, Production Lead boleh menentukannya agar tahap bisa dimulai (aksi manusia, bukan tebakan). */}
        {!unit.service && (canRoute ? (
          <div className="mt-2 space-y-1.5" data-testid="v1-route-needed">
            {data.serviceDerivation?.ok ? (
              <>
                <p className="m-0 text-[12px] text-ink2">Rute pengerjaan belum tersimpan, tetapi dapat ditentukan dari Layanan Sales order ini.</p>
                <Button size="sm" data-testid="v1-service-save" onClick={saveService} disabled={!!busy}>{busy === "service" && <Loader2 size={14} className="animate-spin" />} Tentukan rute dari Layanan Sales</Button>
              </>
            ) : (
              <p data-testid="v1-route-reason" className="m-0 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange">
                {data.serviceDerivation?.message || "Rute pengerjaan belum bisa ditentukan dari Layanan Sales order ini."}
                <span className="mt-0.5 block font-semibold">Yang memperbaiki: {data.serviceDerivation?.fixBy === "SALES" ? "Sales (melengkapi item order)" : "Admin (pemetaan layanan di Pengaturan Produksi)"}.</span>
              </p>
            )}
          </div>
        ) : <p className="m-0 mt-2 text-[11.5px] text-ink3">Rute pengerjaan ditentukan Production Lead.</p>)}
        <Msg kind={m("service").kind} testid="v1-service-msg">{m("service").text}</Msg>
      </Section>

      <Section title="Prioritas & Target Produksi" testid="v1-production">
        {canRoute ? (
          <div className="space-y-2">
            <label className="block text-[11.5px] font-semibold text-ink2">Prioritas
              <select data-testid="v1-priority" className={`${SELECT_CLS} mt-1`} value={["HIGH", "URGENT", "CRITICAL"].includes(draft.priority) ? "HIGH" : "NORMAL"} onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))}>
                <option value="NORMAL">Normal</option><option value="HIGH">Tinggi</option>
              </select>
            </label>
            <div><span className="block text-[11.5px] font-semibold text-ink2">Target Produksi Selesai</span>
              <div data-testid="v1-due" className="mt-1"><DatePicker value={draft.due} onChange={(v) => setDraft((d) => ({ ...d, due: v || "" }))} placeholder="Belum ditetapkan" className="w-full" /></div></div>
            <Button size="sm" className="w-full" data-testid="v1-production-save" onClick={saveProduction} disabled={!!busy || !isDraftDirty(draft, unit)}>{busy === "production" && <Loader2 size={14} className="animate-spin" />} Simpan</Button>
          </div>
        ) : (
          <dl className="m-0 space-y-1 text-[12.5px]"><div className="flex justify-between"><dt className="text-ink3">Prioritas</dt><dd className="m-0 text-ink">{priorityOf({ priority: unit.priority, priorityDisplay: data.priorityDisplay }).label}</dd></div><div className="flex justify-between"><dt className="text-ink3">Target selesai</dt><dd className="m-0 text-ink" data-testid="v1-due-readonly">{draftOf(unit).due || "—"}</dd></div></dl>
        )}
        <Msg kind={m("production").kind} testid="v1-production-msg">{m("production").text}</Msg>
      </Section>

      <Section title={DELAY_TITLE} testid="v1-blocker">
        {!blocker ? <p className="m-0 text-[12.5px] text-ink3">Pekerjaan tidak sedang tertunda.</p> : (
          <div className="space-y-2" data-testid="v1-blocker-active">
            <div className="flex items-center gap-2"><Badge variant="red" data-testid="v1-delay-status">Tertunda — {delayReasonOfBlock(blocker.reason).label.toLowerCase()}</Badge>{blocker.stage?.labelId && <span className="text-[12px] text-ink3">tahap {blocker.stage.labelId}</span>}</div>
            {blocker.note && <p className="m-0 text-[12.5px] text-ink2">{blocker.note}</p>}
            <p className="m-0 text-[11.5px] text-ink3">Ditunda {formatTanggalJam(blocker.openedAt)}{blocker.openedBy?.name ? ` oleh ${blocker.openedBy.name}` : ""} · {formatDurasiMenit(Math.max(0, Math.floor((Date.now() - new Date(blocker.openedAt).getTime()) / 60000)))}</p>
            <p className="m-0 text-[11.5px] text-ink3" data-testid="v1-resume-who">{resumeInfo({ source: "BLOCKER", reason: blocker.reason, canResume: canResolve && blocker.reason !== "MATERIAL_SHORTAGE" }).kind === "BUTTON" ? `Tekan "${RESUME_ACTION_LABEL}" di bagian Pekerjaan setelah kendalanya selesai.` : resumeInfo({ source: "BLOCKER", reason: blocker.reason, canResume: false }).text}</p>
          </div>
        )}
        <Msg kind={m("blocker").kind} testid="v1-blocker-msg">{m("blocker").text}</Msg>
      </Section>
    </div>
  );
}
