import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { PRIORITIES, friendlyError, stationCapacity } from "@/features/production/experience.js";
import { mejaLabel as stationLabel } from "@/features/production/unitCardModel.js";
import { priorityOf, rankOfView } from "@/features/production/productionLabels.js";
import { cornerBodyOf, needsCornerChoice } from "@/features/production/unitCardModel.js";

// P9 UX Realignment — modal jadwal & konfirmasi kedatangan dipindah dari ProductionPlannerV2.jsx supaya dipakai BERSAMA
// Status Produksi (jalan pintas dari Unit 360) dan Rencana Produksi (fallback tombol Jadwalkan/Pindahkan untuk drag-drop).
// Logika & kontrak API TIDAK diubah sama sekali dibanding sebelum dipindah.

// P9A — pemilih lokasi Receiving/WIP untuk "Unit Tiba di Workshop". Tidak ada
// default terpilih (server juga menolak locationId kosong) — pengguna WAJIB
// memilih sendiri, sesuai kontrak "jangan pernah menebak lokasi".
export function ArrivalModal({ target, onClose, onDone }) {
  const [locations, setLocations] = useState(null);
  const [locationId, setLocationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api.getProductionV2ReceivingLocations().then((r) => { if (alive) setLocations(r.locations || []); }).catch((e) => { if (alive) setError(friendlyError(e)); });
    return () => { alive = false; };
  }, []);
  async function submit() {
    if (!locationId) { setError("Pilih lokasi penyimpanan dulu."); return; }
    setBusy(true); setError("");
    try {
      await api.confirmProductionV2UnitArrival(target.unit.id, { locationId });
      onDone(`${target.unit.unitCode} tercatat tiba di workshop.`);
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  }
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={`Unit Tiba di Workshop — ${target.unit.unitCode}`}
      description="Konfirmasi kedatangan fisik unit ke lokasi Receiving/WIP. Tahap produksi baru bisa dimulai setelah ini."
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="neutral" onClick={onClose} disabled={busy}>Batal</Button>
          <Button data-mutates onClick={submit} disabled={busy || !locationId}>{busy ? "Menyimpan…" : "Konfirmasi Tiba"}</Button>
        </div>
      }>
      <div className="space-y-3 px-6 pb-2">
        <label className="text-[12.5px] text-ink3">Lokasi penyimpanan (Receiving/WIP)
          <select className="mt-1 w-full rounded-btn border border-line bg-transparent px-3 py-2 text-[13.5px] text-ink" value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={!locations}>
            <option value="">{locations ? "— pilih lokasi —" : "Memuat…"}</option>
            {(locations || []).map((l) => <option key={l.id} value={l.id}>{l.code}{l.zone ? ` (${l.zone})` : ""}</option>)}
          </select>
        </label>
        {locations && locations.length === 0 && <p className="rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange">Belum ada lokasi Receiving/WIP aktif. Minta Gudang mengaktifkan satu lokasi dulu.</p>}
        {error && <p role="alert" className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{error}</p>}
      </div>
    </Modal>
  );
}

const STALE_CODES = ["PLAN_STATION_FULL", "PLAN_REVISION_CONFLICT", "STATION_ORDER_STALE"];
// Alasan jadwal ulang bila target sudah lewat — kode HARUS sama dengan RESCHEDULE_REASONS di server (productionBoard.js).
export const RESCHEDULE_REASON_OPTIONS = [
  ["CUSTOMER_REQUEST", "Permintaan pelanggan"], ["WAITING_MATERIAL", "Menunggu bahan"], ["WAITING_ARRIVAL", "Unit belum tiba di workshop"],
  ["CAPACITY", "Kapasitas meja atau PIC"], ["PRIORITY_CHANGE", "Perubahan prioritas"], ["QC_REWORK", "Rework atau hasil QC"], ["OTHER", "Lainnya (jelaskan di catatan)"],
];
const RESCHEDULE_NOTE_MIN = 5;
const KIND_LABEL = { SCHEDULED: "Dijadwalkan", RESCHEDULED: "Dijadwalkan ulang", UNSCHEDULED: "Dikeluarkan dari papan", TARGET_CHANGED: "Target diubah" };

// Riwayat jadwal & target kartu ini (append-only dari server): siapa, kapan, dari-ke mana, dan alasannya bila Lewat Target.
function ScheduleHistory({ planId }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let alive = true;
    api.getProductionV2PlanScheduleHistory(planId).then((r) => { if (alive) setRows(r.events || []); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [planId]);
  if (!rows || rows.length === 0) return null;
  const when = (iso) => new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
  return (
    <details data-testid="schedule-history" className="sm:col-span-2 rounded-btn border border-line px-3 py-2">
      <summary className="cursor-pointer text-[12.5px] font-semibold text-ink2">Riwayat jadwal & target ({rows.length})</summary>
      <ul className="m-0 mt-1.5 list-none space-y-1.5 p-0">
        {rows.slice(0, 8).map((e) => (
          <li key={e.id} className="text-[12px] text-ink2">
            <span className="font-semibold text-ink">{KIND_LABEL[e.kind] || e.kind}</span>
            {e.from.date || e.to.date ? <> · {e.from.date ? `${e.from.date}${e.from.stationLabel ? ` ${e.from.stationLabel}` : ""}` : "—"} → {e.to.date ? `${e.to.date}${e.to.stationLabel ? ` ${e.to.stationLabel}` : ""}` : "—"}</> : null}
            {e.from.targetDate !== e.to.targetDate && (e.from.targetDate || e.to.targetDate) ? <> · target {e.from.targetDate || "tanggal papan"} → {e.to.targetDate || "tanggal papan"}</> : null}
            <span className="text-ink3"> · {e.actorName || "—"} · {when(e.at)}</span>
            {e.missedTarget && <span className="ml-1 rounded-chip bg-redbg px-1.5 py-0.5 text-[11px] font-semibold text-red">Lewat Target</span>}
            {e.reasonLabel && <span className="block text-ink3">Alasan: {e.reasonLabel}{e.note ? ` — ${e.note}` : ""}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

// Alasan + tindakan bila workshop/PIC kosong (dari GET /production-v2/planning/refs): TIDAK pernah kosong tanpa penjelasan. Akun produksi yang belum jadi PIC bisa didaftarkan
// (izin PRODUCTION_OPERATOR_WRITE) — aksi eksplisit pengguna, bukan otomatis.
function RefsProblems({ refs, workCenterId, onRegistered, setError }) {
  const [busyId, setBusyId] = useState("");
  const problems = (refs.problems || []).filter((p) => p.severity !== "info" || refs.operators.length < 2);
  if (!problems.length && !(refs.candidates || []).length) return null;
  async function register(c) {
    setBusyId(c.userId); setError("");
    try { await api.createProductionOperator({ userId: c.userId, primaryWorkCenterId: workCenterId || undefined }); await onRegistered?.(); }
    catch (e) { setError(friendlyError(e)); } finally { setBusyId(""); }
  }
  return (
    <div data-testid="refs-problems" className="space-y-2 sm:col-span-2">
      {problems.map((p) => (
        <div key={p.code} data-testid={`refs-problem-${p.code}`} role="note" className={`rounded-btn px-3 py-2 text-[12.5px] ${p.severity === "info" ? "bg-inset text-ink2" : "bg-orangebg text-orange"}`}>
          <p className="m-0">{p.message}</p>
          {p.link && <Link to={p.link} className="mt-1 inline-block font-semibold underline" data-testid={`refs-link-${p.code}`}>{p.linkLabel || "Buka pengaturan"}</Link>}
        </div>
      ))}
      {(refs.candidates || []).length > 0 && (
        <div data-testid="refs-candidates" className="rounded-btn border border-line px-3 py-2">
          <p className="m-0 text-[12px] font-semibold text-ink2">Akun produksi aktif yang belum terdaftar sebagai PIC</p>
          <ul className="m-0 mt-1 list-none space-y-1 p-0">
            {refs.candidates.map((c) => (
              <li key={c.userId} className="flex items-center justify-between gap-2 text-[12.5px] text-ink">
                <span className="min-w-0 truncate">{c.name}</span>
                {refs.canRegisterOperator
                  ? <Button size="sm" variant="neutral" data-mutates data-testid="register-pic" disabled={!!busyId} onClick={() => register(c)}>{busyId === c.userId ? "Mendaftarkan…" : "Daftarkan sebagai PIC"}</Button>
                  : <span className="text-[11.5px] text-ink3">minta Admin/Kepala Produksi</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ScheduleModal({ target, board, date, refs, onClose, onDone, onRefsChanged = null, onStale = null }) {
  const plan = target.plan;
  const [form, setForm] = useState(() => ({
    productionDate: target.presetDate || plan?.productionDate || date,
    stationCode: target.presetStation || plan?.stationCode || board.stations.find((s) => !stationCapacity(s).full)?.code || board.config.stations[0],
    priority: Math.min(plan?.priority ?? target.suggestedPriority ?? 0, 1), // pilihan pengguna hanya Normal/Tinggi (nilai lama Mendesak tampil Tinggi)
    workCenterId: plan?.workCenter?.id || refs.defaultWorkCenterId || refs.workCenters[0]?.id || "",
    // "" = ikuti PIC bawaan Meja (server memilihnya di dalam transaksi). Terisi hanya bila petugas memilih PIC khusus untuk order ini.
    operatorId: "",
    cornerOperatorId: plan?.cornerOperator?.id || "",
  }));
  // PIC bawaan Meja yang sedang dipilih (hanya diketahui untuk tanggal papan yang dimuat).
  const stationDefault = (code) => (form_dateIsBoard() ? board.stations.find((s) => s.code === code)?.defaultPic || null : null);
  const form_dateIsBoard = () => form.productionDate === date; // eslint-disable-line no-use-before-define
  // Target produksi: bawaan = tanggal papan. Target khusus per kartu adalah pengecualian.
  const [customTarget, setCustomTarget] = useState(!!plan?.targetIsException);
  const [targetDate, setTargetDate] = useState(plan?.targetDate || "");
  const [reasonCode, setReasonCode] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  // Jalur Pengerjaan Pesanan (onboarding): keputusan Corner dikirim BERSAMA jadwal (atomik di server) — tanpa pilihan bawaan, supaya benar-benar dipilih manusia.
  const askCorner = needsCornerChoice(target);
  const [cornerChoice, setCornerChoice] = useState("");
  const [cornerReason, setCornerReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const unitCode = target.unit?.unitCode;
  const dateMoves = !!plan?.productionDate && form.productionDate !== plan.productionDate;
  const missed = !!plan?.targetMissed;
  const needsReason = missed && dateMoves;
  const picDefault = stationDefault(form.stationCode);
  const field = "mt-1 w-full rounded-btn border border-line bg-transparent px-3 py-2 text-[13.5px] text-ink";

  async function submit(unschedule = false) {
    if (!unschedule && !form.workCenterId) { setError("Pilih workshop."); return; }
    if (!unschedule && !form.operatorId && !picDefault?.active && !plan?.operator?.id) { setError("Pilih PIC meja, atau tetapkan PIC di header Meja lebih dulu."); return; }
    if (!unschedule && customTarget && !targetDate) { setError("Isi tanggal target khusus, atau matikan target khusus."); return; }
    if (!unschedule && customTarget && targetDate < form.productionDate) { setError("Target tidak boleh lebih awal dari tanggal produksi."); return; }
    if (!unschedule && needsReason && (!reasonCode || reasonNote.trim().length < RESCHEDULE_NOTE_MIN)) { setError(`Target sudah lewat: pilih alasan dan tulis catatan (minimal ${RESCHEDULE_NOTE_MIN} karakter).`); return; }
    const corner = askCorner && !unschedule ? cornerBodyOf(cornerChoice, cornerReason) : { body: {} };
    if (corner.error) { setError(corner.error); return; }
    setBusy(true); setError("");
    const { operatorId, ...rest } = form;
    const body = unschedule
      ? { productionDate: null, stationCode: null, priority: form.priority }
      : {
        ...rest, priority: Number(form.priority), cornerOperatorId: form.cornerOperatorId || undefined, ...corner.body,
        ...(operatorId ? { operatorId } : {}), // kosong = server memakai PIC bawaan Meja (tidak ada tebakan di browser)
        ...(customTarget ? { targetDate } : plan?.targetIsException ? { targetDate: null } : {}),
        ...(needsReason ? { rescheduleReason: reasonCode, rescheduleNote: reasonNote.trim() } : {}),
      };
    try {
      let result;
      if (plan) result = await api.scheduleProductionV2Plan(plan.id, { ...body, expectedRevision: plan.revision });
      else result = await api.planProductionV2Unit(target.onboardUnitId ? { unitId: target.onboardUnitId, ...body } : { runId: target.runId, ...body }); // onboarding: Run dibuka di transaksi yang sama
      // Argumen ke-2 (P12A.3): info penempatan agar pemanggil bisa menetapkan POSISI AWAL menurut prioritas (bukan auto-reorder).
      onDone(unschedule ? `${unitCode} dikeluarkan dari papan.` : `${unitCode} dijadwalkan ke ${form.stationCode.replace("TABLE_", "Meja ")}${result?.onboarded ? (result.origin === "WORKSHOP_BORN" ? " — Pekerjaan produksi dibuka (unit dibuat di workshop)" : " — Pekerjaan produksi dibuka (unit belum tiba di workshop; konfirmasi \"Unit Tiba\" tetap diperlukan)") : ""}.`,
        unschedule ? null : { planId: plan?.id ?? result?.planId ?? result?.id ?? null, stationCode: form.stationCode, productionDate: form.productionDate, priority: Math.max(Number(form.priority), rankOfView(target) >= 3 ? 3 : 0) }); // peringkat urutan: Komplain tetap di atas
    } catch (e) {
      setError(friendlyError(e));
      // Papan basi (Meja sudah penuh / revisi berubah / isi Meja berubah): muat ulang papan di belakang formulir supaya pilihan Meja ikut diperbarui.
      if (STALE_CODES.includes(e?.code)) onStale?.();
    } finally { setBusy(false); }
  }

  // Setelah papan dimuat ulang: bila Meja terpilih kini penuh (bukan Meja rencana ini sendiri), pindah ke Meja pertama yang masih lega.
  useEffect(() => {
    const cur = board.stations.find((s) => s.code === form.stationCode);
    if (cur && stationCapacity(cur).full && cur.code !== plan?.stationCode) { const alt = board.stations.find((s) => !stationCapacity(s).full); if (alt) set({ stationCode: alt.code }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  const refsLoading = refs.loaded === false;
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={plan ? `Jadwal ${unitCode}` : `Rencanakan ${unitCode}`} description={target.onboardUnitId ? "Tanggal produksi, Meja, PIC, dan prioritas. Menyimpan akan membuka pekerjaan produksi unit ini (belum tiba) lalu menjadwalkannya — satu langkah." : "Tanggal produksi, meja bongkar, dan PIC. Kapasitas meja dijaga server."}
      footer={
        <div className="flex w-full flex-wrap justify-end gap-2">
          {plan?.stationCode && <Button variant="neutral" data-mutates disabled={busy} onClick={() => submit(true)}>Keluarkan dari papan</Button>}
          <Button variant="neutral" onClick={onClose} disabled={busy}>Batal</Button>
          <Button data-mutates onClick={() => submit(false)} disabled={busy}>{busy ? "Menyimpan…" : "Simpan Jadwal"}</Button>
        </div>
      }>
      <div className="grid gap-3 px-6 pb-2 sm:grid-cols-2">
        <label className="text-[12.5px] text-ink3">Tanggal produksi<input type="date" className={field} value={form.productionDate} onChange={(e) => set({ productionDate: e.target.value })} /></label>
        <label className="text-[12.5px] text-ink3">Meja bongkar
          <select className={field} value={form.stationCode} onChange={(e) => set({ stationCode: e.target.value })}>
            {board.stations.map((s) => { const c = stationCapacity(s); return <option key={s.code} value={s.code} disabled={c.full && s.code !== plan?.stationCode}>{s.label} ({c.label}{c.full ? " — penuh" : ""})</option>; })}
          </select>
        </label>
        <label className="text-[12.5px] text-ink3">Prioritas
          <select className={field} value={form.priority} onChange={(e) => set({ priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
          {priorityOf(target).key === "COMPLAINT" && <span data-testid="complaint-note" className="mt-1 block text-[12px] font-semibold text-red">Komplain — otomatis dari kasus {priorityOf(target).complaintCases.map((c) => c.caseNumber).join(", ") || "resmi"}; urutan meja manual tetap berlaku.</span>}
        </label>
        <label className="text-[12.5px] text-ink3">Workshop
          <select className={field} value={form.workCenterId} onChange={(e) => set({ workCenterId: e.target.value })}>
            <option value="">— pilih —</option>{refs.workCenters.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label className="text-[12.5px] text-ink3">PIC meja (bongkar & restorasi)
          <select data-testid="schedule-pic" className={field} value={form.operatorId} onChange={(e) => set({ operatorId: e.target.value })}>
            <option value="">{picDefault?.active ? `Ikuti PIC ${stationLabel(form.stationCode)}: ${picDefault.name} (bawaan)` : plan?.operator?.name ? `Tetap: ${plan.operator.name}` : "— pilih —"}</option>
            {refs.operators.map((o) => <option key={o.id} value={o.id}>{o.name || o.user?.name || o.employeeCode}</option>)}
          </select>
          {form.operatorId && picDefault?.active && form.operatorId !== picDefault.operatorId && <span data-testid="pic-override" className="mt-1 block text-[11.5px] text-orange">Berbeda dari PIC bawaan meja — hanya untuk order ini.</span>}
        </label>
        <label className="text-[12.5px] text-ink3">PIC Corner (jahit) — opsional
          <select className={field} value={form.cornerOperatorId} onChange={(e) => set({ cornerOperatorId: e.target.value })}>
            <option value="">Sama dengan PIC meja</option>{refs.operators.map((o) => <option key={o.id} value={o.id}>{o.name || o.user?.name || o.employeeCode}</option>)}
          </select>
        </label>
        <div data-testid="schedule-target" className="space-y-1.5 rounded-btn border border-line px-3 py-2 sm:col-span-2">
          <p className="m-0 text-[12.5px] font-semibold text-ink2">Target produksi</p>
          <p className="m-0 text-[12.5px] text-ink2">{customTarget ? "Target khusus untuk order ini." : `Mengikuti tanggal papan (${form.productionDate || "—"}).`}</p>
          <label className="flex items-center gap-2 text-[12.5px] text-ink">
            <input type="checkbox" data-testid="schedule-target-custom" checked={customTarget} onChange={(e) => { setCustomTarget(e.target.checked); if (e.target.checked && !targetDate) setTargetDate(form.productionDate); }} />
            Target berbeda dari tanggal papan (pengecualian untuk order ini saja)
          </label>
          {customTarget && <input type="date" data-testid="schedule-target-date" aria-label="Tanggal target khusus" min={form.productionDate} className={field} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />}
        </div>
        {missed && (
          <div data-testid="schedule-missed" role="note" className="space-y-2 rounded-btn bg-redbg px-3 py-2 sm:col-span-2">
            <p className="m-0 text-[12.5px] font-semibold text-red">Lewat Target — target {plan.targetEffective} sudah lewat.</p>
            {needsReason ? (
              <>
                <label className="block text-[12.5px] text-ink">Alasan jadwal ulang (wajib)
                  <select data-testid="reschedule-reason" className={field} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                    <option value="">— pilih alasan —</option>{RESCHEDULE_REASON_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className="block text-[12.5px] text-ink">Catatan (wajib, minimal {RESCHEDULE_NOTE_MIN} karakter)
                  <textarea data-testid="reschedule-note" rows={2} maxLength={300} className={field} value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} />
                </label>
                <p className="m-0 text-[11.5px] text-ink3">Target lama, nama Anda, dan waktu tersimpan di riwayat. Target order lain tidak berubah.</p>
              </>
            ) : <p className="m-0 text-[12px] text-ink2">Pilih tanggal produksi baru untuk menjadwalkan ulang; alasan akan diminta.</p>}
          </div>
        )}
        {plan?.id && <ScheduleHistory planId={plan.id} />}
        {askCorner && (
          <fieldset data-testid="schedule-corner" className="m-0 space-y-1.5 border-0 p-0 sm:col-span-2">
            <legend className="text-[12.5px] font-semibold text-ink2">Corner diperlukan? (kain/jahit)</legend>
            <div role="radiogroup" aria-label="Corner diperlukan" className="flex gap-4 text-[13px] text-ink">
              <label className="flex items-center gap-1.5"><input type="radio" name="schedule-corner" checked={cornerChoice === "YES"} onChange={() => setCornerChoice("YES")} data-testid="schedule-corner-yes" /> Ya, diperlukan</label>
              <label className="flex items-center gap-1.5"><input type="radio" name="schedule-corner" checked={cornerChoice === "NO"} onChange={() => setCornerChoice("NO")} data-testid="schedule-corner-no" /> Tidak diperlukan</label>
            </div>
            {cornerChoice === "NO" && <input aria-label="Alasan Corner tidak diperlukan" data-testid="schedule-corner-reason" className={field} placeholder="Alasan — mis. tidak ada pekerjaan kain/jahit" value={cornerReason} onChange={(e) => setCornerReason(e.target.value)} />}
            <p className="m-0 text-[11.5px] text-ink3">Keputusan ini tersimpan bersama jadwal dan terkunci setelah pekerjaan melewati gerbang penentuannya; sebelum itu dapat diubah di Unit 360.</p>
            {target.build?.product?.problem && <p role="note" data-testid="schedule-product-unclear" className="m-0 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange"><b>Jenis produk perlu dikonfirmasi.</b> {target.build.product.problem}. Jadwal tetap bisa disimpan; racikan dan pengujian khusus kasur menunggu Sales memperbaiki jenis produk pada order.</p>}
          </fieldset>
        )}
        {refsLoading && <p data-testid="refs-loading" className="sm:col-span-2 text-[12.5px] text-ink3">Memuat daftar workshop dan PIC…</p>}
        {!refsLoading && refs.problems ? <RefsProblems refs={refs} workCenterId={form.workCenterId} onRegistered={onRefsChanged} setError={setError} />
          : (refs.operators.length === 0 && <p className="sm:col-span-2 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange">Belum ada operator aktif. Tambahkan di Pengaturan Produksi → Operator.</p>)}
        {error && <p role="alert" className="sm:col-span-2 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{error}</p>}
      </div>
    </Modal>
  );
}
