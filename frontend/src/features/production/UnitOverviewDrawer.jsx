import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, PackageX } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { ProgressBar } from "@/components/ui/progress.jsx";
import { formatRupiah } from "@/utils/format.js";
import { formatTanggal } from "@/utils/formatDate.js";
import { friendlyError, priorityTone } from "@/features/production/experience.js";
import { UnitPhotoThumb } from "@/features/production/UnitPhotoThumb.jsx";
import { DOC_SOURCE_BADGE, DOC_SOURCE_LABEL, DOC_STATUS } from "@/features/production/documentation.js";
import { DiagnosisWizard, diagnosisCtaLabel, hasLocalDraft } from "@/features/production/DiagnosisWizard.jsx";
import { humanizeRequest } from "@/features/production/unitCardModel.js";
import { rolesOf } from "@/lib/roles.js";
import { isOutsideV2 } from "@/features/production/unit360Availability.js";
import UnitOrderFallback from "@/features/production/UnitOrderFallback.jsx";

// P9C — Unit 360: satu drawer kanonis (setara "detail Resi") dibuka dari kartu Status Produksi MAUPUN Rencana
// Produksi — komponen ini TIDAK peduli dari halaman mana ia dipanggil, hanya butuh unitId. Deep-link (?unit=)
// diurus PEMANGGIL (ProductionPlannerV2.jsx/ProductionRencanaWorkspace.jsx), bukan di sini, supaya "kembali ke
// tab asal" bekerja persis sesuai konvensi tab masing-masing halaman.
function currentUserLocal() { try { return JSON.parse(localStorage.getItem("user")); } catch { return null; } }
export const bd = (v, fallback = "Belum dicatat") => (v === null || v === undefined || v === "" ? fallback : v);
export const bdArr = (v) => (Array.isArray(v) && v.length ? v.join(", ") : "Belum dicatat");
export const fmtDT = (d) => (d ? new Date(d).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "Belum dicatat");
const fmtD = (d) => (d ? formatTanggal(d) : "Belum dicatat");

// Field ORDER-scoped (sama untuk semua unit dalam order yang sama, lihat backend productionUnitOverviewService.js)
// ditandai kecil supaya pengguna tidak menyangka itu unik untuk unit ini — jujur, bukan menyembunyikan.
function OrderField({ label, field, format = (v) => bd(v) }) {
  return (
    <div className="min-w-0 rounded-btn bg-inset px-3 py-2">
      <dt className="m-0 flex items-center gap-1 text-ink3">
        {label} {field?.scope === "ORDER" && <span className="rounded-chip bg-accentbg px-1 py-0.5 text-[9px] font-semibold text-accent" title="Data di level Order — sama untuk semua unit dalam order ini">ORDER</span>}
      </dt>
      {/* break-words: teks Sales (request/keluhan) kadang berisi URL/token panjang tanpa spasi
          (mis. link Maps ditempel manual, sama seperti .bubble-link di chat) — tanpa ini, satu
          token panjang bisa mendorong card melebar horizontal di mobile. */}
      <dd className="m-0 break-words font-semibold text-ink">{format(field?.value)}</dd>
    </div>
  );
}
function Field({ label, value }) {
  return <div className="min-w-0 rounded-btn bg-inset px-3 py-2"><dt className="m-0 text-ink3">{label}</dt><dd className="m-0 break-words font-semibold text-ink">{bd(value)}</dd></div>;
}

const TABS = [
  ["ringkasan", "Ringkasan"], ["proses", "Proses"], ["bahan", "Bahan"],
  ["dokumentasi", "Dokumentasi"], ["qc", "QC & Handoff"], ["aktivitas", "Aktivitas"],
];

// P12B.5 — unit COHORT V2: perubahan hanya lewat pemilik perintah V2 (tidak ada jalur V1 di drawer ini → tidak ada bypass diagnosis/QC/custody).
// Prioritas & target = rencana (Rencana Produksi); layanan teknis = Diagnosis (tab Proses); hambatan = Menunggu Bahan Baku / Gudang.
function V2Owners({ d }) {
  const t = d.identity.target;
  return (
    <div className="rounded-btn border border-line p-3" data-testid="v2-owners">
      <p className="m-0 mb-2 text-[12.5px] font-bold text-ink">Prioritas, target, dan hambatan</p>
      <dl className="m-0 mb-2 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3">
        <Field label="Prioritas" value={t.priorityLabel || "Normal"} />
        <Field label="Target selesai" value={t.targetCompleteAt ? fmtD(t.targetCompleteAt) : null} />
      </dl>
      <ul className="m-0 list-disc space-y-0.5 pl-5 text-[11.5px] text-ink3">
        <li>Layanan teknis diisi lewat <b>Diagnosis</b> (tab Proses).</li>
        <li>Prioritas dan target diubah di <b>Rencana Produksi</b>.</li>
        <li>Hambatan bahan dicatat lewat <b>Menunggu Bahan Baku</b> dan diselesaikan Gudang.</li>
      </ul>
    </div>
  );
}

function Ringkasan({ d }) {
  return (
    <div className="space-y-3">
      <dl className="m-0 grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-3">
        <Field label="Merk & Ukuran" value={[d.identity.merk, d.identity.ukuran].filter(Boolean).join(" ")} />
        <Field label="Layanan Teknis (Produksi)" value={d.service.set ? d.service.label : "Belum ditetapkan — diisi dari Diagnosis"} />
        <Field label="Meja / Workshop" value={d.identity.station.label} />
        <Field label="PIC Meja" value={d.identity.pic.table} />
        <Field label="PIC Corner" value={d.identity.pic.corner} />
        <Field label="Tanggal Produksi" value={d.identity.target.productionDate ? fmtD(d.identity.target.productionDate) : null} />
        <OrderField label="Kota" field={d.customer.city} />
        <OrderField label="Sales" field={d.customer.salesName} />
        <OrderField label="Berat Badan" field={d.salesContext.weightKg} format={(v) => (v ? `${v} kg` : "Belum dicatat")} />
      </dl>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="neutral">{d.identity.bucketLabel}</Badge>
        {d.identity.target.priority > 0 && <Badge variant={priorityTone(d.identity.target.priority)}>{d.identity.target.priorityLabel}</Badge>}
        {d.identity.target.late && <Badge variant="red">Terlambat</Badge>}
      </div>
      <V2Owners d={d} />
      <OrderField label="Keluhan Customer" field={d.salesContext.complaints} format={bdArr} />
      <OrderField label="Layanan Dipesan (Sales)" field={d.salesContext.salesServices} format={bdArr} />
      <OrderField label="Request Customer" field={d.salesContext.request} format={(v) => bd(humanizeRequest(v))} />
      {d.salesContext.dataGaps?.length > 0 && (
        <ul className="m-0 list-none space-y-1 p-0">
          {d.salesContext.dataGaps.map((g) => <li key={g} className="flex items-center gap-1.5 rounded-btn bg-orangebg px-3 py-2 text-[12px] text-orange"><AlertTriangle size={12} aria-hidden /> {g}</li>)}
        </ul>
      )}
      {d.warnings?.length > 0 && (
        <ul className="m-0 list-none space-y-1 p-0">
          {d.warnings.map((w) => <li key={w.code} className="flex items-center gap-1.5 rounded-btn bg-redbg px-3 py-2 text-[12px] text-red"><AlertTriangle size={12} aria-hidden /> {w.text}</li>)}
        </ul>
      )}
      <div className="rounded-btn border border-line p-3">
        <p className="m-0 mb-2 text-[12.5px] font-bold text-ink">Pickup</p>
        {d.pickup.exists ? (
          <dl className="m-0 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3">
            <Field label="Driver" value={d.pickup.job?.driverName} />
            <Field label="Helper" value={d.pickup.job?.helperName} />
            <Field label="Route" value={d.pickup.job?.routeCode} />
            <Field label="Pickup selesai" value={d.pickup.pickupCompletedAt ? fmtDT(d.pickup.pickupCompletedAt) : null} />
            <Field label="Tiba di workshop" value={d.pickup.arrivedAtWorkshop ? fmtDT(d.pickup.arrivedAtWorkshop) : null} />
            <Field label="Status custody" value={d.pickup.custodyStatusLabel} />
          </dl>
        ) : <p className="m-0 text-[12px] text-ink3">Belum ada catatan custody masuk untuk unit ini.</p>}
        {d.pickup.exists && d.pickup.isSingleUnitJob === false && (
          <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-ink3"><AlertTriangle size={12} aria-hidden /> Job pickup ini membawa lebih dari satu unit — foto pickup tidak diatribusikan otomatis ke unit manapun.</p>
        )}
      </div>
    </div>
  );
}

// P9D — hasil Diagnosis Produksi (layanan pesanan vs teknis, kesimpulan, bahan manual perlu dipetakan, foto,
// siapa+kapan). "Isi Diagnosis" hanya muncul saat tahap 5 CURRENT/WAITING (op.stageCode diagnosis) — di luar
// itu, wizard tidak relevan (belum sampai atau sudah lewat tahapnya).
function DiagnosisPanel({ d, onOpenWizard }) {
  const step5 = d.production.steps.find((s) => s.no === 5);
  const canDiagnose = step5 && (step5.status === "CURRENT" || step5.status === "WAITING");
  const diag = d.diagnosis?.current;
  return (
    <div className="space-y-3 rounded-btn border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-[13px] font-bold text-ink">Diagnosis Produksi</p>
        {canDiagnose && <Button size="sm" variant="secondary" className="min-h-[44px]" data-testid="open-diagnosis" data-mutates onClick={onOpenWizard}>{diagnosisCtaLabel({ status: diag?.status, hasDraft: hasLocalDraft(d.production.runId) })}</Button>}
      </div>
      {!diag && <p className="m-0 text-[12.5px] text-ink3">Belum ada diagnosis tercatat untuk unit ini.</p>}
      {diag && (
        <div className="space-y-2 text-[12.5px]">
          <span data-testid="diagnosis-status" data-diagnosis-status={diag.status} className="inline-block"><Badge variant={diag.status === "RECORDED" ? "green" : "neutral"}>{diag.status === "RECORDED" ? "Sudah dikirim" : "Draft"}</Badge></span>
          <dl className="m-0 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="min-w-0 rounded-btn bg-inset px-3 py-2"><dt className="m-0 text-ink3">Layanan teknis</dt><dd className="m-0 break-words font-semibold text-ink">{bd(diag.recommendedServiceLabel)}</dd></div>
            <div className="min-w-0 rounded-btn bg-inset px-3 py-2"><dt className="m-0 text-ink3">Dikirim</dt><dd className="m-0 font-semibold text-ink">{fmtDT(diag.recordedAt)}</dd></div>
          </dl>
          {diag.findings?.serviceNote && <div className="min-w-0 rounded-btn bg-inset px-3 py-2"><dt className="m-0 text-ink3">Kesimpulan diagnosis</dt><dd className="m-0 break-words font-semibold text-ink">{diag.findings.serviceNote}</dd></div>}
          {diag.manualMaterials?.some((m) => m.status === "NEEDS_MAPPING") && (
            <p className="flex items-center gap-1.5 rounded-btn bg-orangebg px-3 py-2 text-red"><AlertTriangle size={12} aria-hidden />
              {diag.manualMaterials.filter((m) => m.status === "NEEDS_MAPPING").length} bahan manual belum dipetakan Production Lead ke katalog.
            </p>
          )}
          {diag.photoUrls?.length > 0 && <MediaGrid items={diag.photoUrls.map((url, i) => ({ stepLabel: `Diagnosis ${i + 1}`, url, kind: "image" }))} empty="" />}
        </div>
      )}
    </div>
  );
}

function Proses({ d, onOpenDiagnosis }) {
  if (!d.production.runId) return <p className="text-[12.5px] text-ink3">Unit belum masuk proses produksi (belum ada Production Run).</p>;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1"><ProgressBar value={d.production.progress.total ? (d.production.progress.done / d.production.progress.total) * 100 : 0} /></div>
        <span className="shrink-0 text-[11px] text-ink3 tabular-nums">{d.production.progress.done} dari {d.production.progress.total} tahap</span>
      </div>
      <ol className="m-0 grid list-none grid-cols-1 gap-1 p-0 sm:grid-cols-2">
        {d.production.steps.map((s) => (
          <li key={s.no} className={`flex min-h-[44px] items-center gap-2 rounded-btn px-3 py-2 text-[12.5px] ${s.status === "DONE" ? "bg-greenbg text-green" : s.status === "CURRENT" ? "bg-accentbg font-semibold text-accent" : s.status === "WAITING" ? "bg-orangebg text-orange" : s.status === "NA" ? "text-ink3 line-through" : "bg-inset text-ink3"}`}>
            {s.status === "DONE" ? <CheckCircle2 size={14} aria-hidden /> : <span className="w-4 shrink-0 text-center tabular-nums">{s.no}</span>}
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            {s.actor && <span className="shrink-0 text-[10px] text-ink3">{s.actor}</span>}
          </li>
        ))}
      </ol>
      {d.production.activeOp && (
        <div className="rounded-btn border border-line p-3 text-[12.5px]">
          <p className="m-0 text-ink3">Sedang berjalan</p>
          <p className="m-0 font-semibold text-ink">{d.production.activeOp.stageLabel} — {d.production.activeOp.status}</p>
        </div>
      )}
      <DiagnosisPanel d={d} onOpenWizard={onOpenDiagnosis} />
    </div>
  );
}

// P9D — bahan manual/noncatalog dari Diagnosis ("Bahan belum terdaftar"). "Petakan" hanya berlaku (server
// menolak 403 kalau tidak berwenang — UI tidak menebak peran pengguna, cukup tampilkan aksi dan biarkan server
// yang memutuskan, pola sama dengan tombol tulis lainnya di Unit 360).
function ManualMaterialRow({ m, onMapped }) {
  const [mapping, setMapping] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return undefined; }
    const t = setTimeout(() => { api.searchProductionV2Materials(q).then((r) => setResults(r.items || [])).catch(() => setResults([])); }, 300);
    return () => clearTimeout(t);
  }, [query]);
  async function map(materialId) {
    setBusy(true); setError("");
    try { await api.mapProductionV2DiagnosisManualMaterial(m.id, { materialId, qty: m.qty }); setMapping(false); onMapped(); }
    catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  }
  if (m.status === "MAPPED") {
    return <li className="rounded-btn bg-greenbg px-3 py-2 text-[12px] text-green">{m.description} ({m.qty} {m.estimatedUnit || ""}) → dipetakan ke {m.mappedMaterialCode} — {m.mappedMaterialName}</li>;
  }
  return (
    <li className="space-y-2 rounded-btn bg-orangebg px-3 py-2 text-[12px] text-orange">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 break-words">{m.description} ({m.qty} {m.estimatedUnit || ""}) — {m.reason}</span>
        {!mapping && <button type="button" data-mutates onClick={() => setMapping(true)} className="min-h-[44px] shrink-0 rounded-btn bg-surface px-2 text-[11.5px] font-semibold text-ink2">Petakan</button>}
      </div>
      {mapping && (
        <div className="space-y-1.5">
          <input className="block w-full min-h-[44px] rounded-btn border border-line bg-surface px-2 text-[13px] text-ink" placeholder="Cari material katalog…" value={query} onChange={(e) => setQuery(e.target.value)} disabled={busy} />
          {results.length > 0 && (
            <ul className="m-0 list-none space-y-1 p-0">
              {results.map((r) => <li key={r.id}><button type="button" disabled={busy} onClick={() => map(r.id)} className="flex min-h-[44px] w-full items-center rounded-btn bg-surface px-2 text-left text-[12.5px] text-ink">{r.code} — {r.name}</button></li>)}
            </ul>
          )}
          {error && <p className="m-0 text-red">{error}</p>}
        </div>
      )}
    </li>
  );
}

function Bahan({ d, onDiagnosisRefresh }) {
  const manualMaterials = d.diagnosis?.current?.manualMaterials || [];
  if (!d.materials.lines.length && !manualMaterials.length) {
    return <p className="text-[12.5px] text-ink3">{d.production.runId ? "Belum ada Planned BOM untuk unit ini." : "Unit belum masuk proses produksi."}</p>;
  }
  return (
    <div className="space-y-3">
      {d.materials.shortageOpen && (
        <p className="flex items-center gap-1.5 break-words rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red"><PackageX size={13} aria-hidden className="shrink-0" /> Menunggu bahan baku dari Gudang{d.materials.shortageNote ? `: ${d.materials.shortageNote}` : ""}</p>
      )}
      {d.materials.lines.length > 0 && (
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-[12px]" data-testid="material-table">
          <thead className="text-ink3"><tr>{["Bahan", "Rencana", "Diserahkan", "Terpakai", "Sisa", "Waste", "Status"].map((h) => <th key={h} className="px-2 py-1.5 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {d.materials.lines.map((l) => (
              <tr key={l.materialId} className="border-t border-line">
                <td className="px-2 py-1.5">{l.code} — {l.name}{l.supplemental && <Badge variant="orange" className="ml-1">Rework</Badge>}</td>
                <td className="px-2 py-1.5 tabular-nums">{l.plannedQty} {l.uom}</td>
                <td className="px-2 py-1.5 tabular-nums" data-col="diserahkan">{l.issuedQty} {l.uom}</td>
                <td className="px-2 py-1.5 tabular-nums" data-col="terpakai">{l.usedQty ?? 0} {l.uom}</td>
                <td className="px-2 py-1.5 tabular-nums" data-col="sisa">{l.leftoverQty ?? 0} {l.uom}</td>
                <td className="px-2 py-1.5 tabular-nums" data-col="waste">{l.wasteQty ?? 0} {l.uom}</td>
                <td className="px-2 py-1.5">
                  {l.status.replaceAll("_", " ")}
                  {l.returnStatus === "PENDING" && <Badge variant="orange" className="ml-1" data-testid="return-status">Retur menunggu Gudang</Badge>}
                  {l.returnStatus === "RECEIVED" && <Badge variant="green" className="ml-1" data-testid="return-status">Retur diterima Gudang{l.returnedQty ? ` (${l.returnedQty} ${l.uom})` : ""}</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {manualMaterials.length > 0 && (
        <div className="space-y-1.5">
          <p className="m-0 text-[12.5px] font-bold text-ink">Bahan belum terdaftar (dari Diagnosis)</p>
          <ul className="m-0 list-none space-y-1.5 p-0">
            {manualMaterials.map((m) => <ManualMaterialRow key={m.id} m={m} onMapped={onDiagnosisRefresh} />)}
          </ul>
        </div>
      )}
    </div>
  );
}

function MediaGrid({ items, empty }) {
  if (!items.length) return <p className="text-[12px] text-ink3">{empty}</p>;
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {items.map((m, i) => (
        <a key={`${m.stepNo}-${i}`} href={m.url} target="_blank" rel="noreferrer" className="relative block aspect-square overflow-hidden rounded-btn bg-inset" title={[m.stepLabel, m.caption].filter(Boolean).join(" — ")} data-testid="evidence-item" data-documentation={m.documentation ? "true" : undefined}>
          {m.kind === "video" ? <video src={m.url} className="h-full w-full object-cover" muted /> : <img src={m.url} alt={m.caption || m.stepLabel} className="h-full w-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />}
          {m.source && <span className="absolute bottom-1 left-1"><Badge variant={DOC_SOURCE_BADGE[m.source] || "neutral"}>{DOC_SOURCE_LABEL[m.source] || m.source}</Badge></span>}
        </a>
      ))}
    </div>
  );
}

// P10B — ringkasan matriks dokumentasi kanonis (sama dengan Aplikasi Dokumentasi & Laporan) + tautan buka aplikasi.
function MatriksDokumentasi({ matrix }) {
  if (!matrix) return null;
  return (
    <div className="space-y-2 rounded-card border border-line p-3" data-testid="doc-matrix">
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-[12.5px] font-bold text-ink">Matriks dokumentasi · {matrix.totals.satisfied}/{matrix.totals.required} foto</p>
        <a href="/produksi/dokumentasi" className="text-[12px] font-semibold text-accent underline">Buka Aplikasi Dokumentasi</a>
      </div>
      <ul className="m-0 grid list-none gap-1 p-0 sm:grid-cols-2">
        {matrix.categories.map((c) => (
          <li key={c.key} className="flex items-center justify-between gap-2 rounded-btn bg-inset px-2.5 py-1.5 text-[12px]" data-category={c.key} data-status={c.status}>
            <span className="min-w-0 truncate text-ink2">{c.label}</span>
            <span className="flex shrink-0 items-center gap-1.5"><span className="tabular-nums text-ink3">{c.count}/{c.min}</span><Badge variant={(DOC_STATUS[c.status] || DOC_STATUS.MENUNGGU).variant}>{(DOC_STATUS[c.status] || DOC_STATUS.MENUNGGU).label}</Badge></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Dokumentasi({ d }) {
  return (
    <div className="space-y-4">
      <MatriksDokumentasi matrix={d.documentation} />
      <div><p className="mb-1.5 text-[12.5px] font-bold text-ink">Before</p><MediaGrid items={d.evidence.before} empty="Belum ada dokumentasi before." /></div>
      <div><p className="mb-1.5 text-[12.5px] font-bold text-ink">Proses</p><MediaGrid items={d.evidence.process} empty="Belum ada dokumentasi proses." /></div>
      <div><p className="mb-1.5 text-[12.5px] font-bold text-ink">After</p><MediaGrid items={d.evidence.after} empty="Belum ada dokumentasi after." /></div>
    </div>
  );
}

function QcHandoff({ d }) {
  return (
    <div className="space-y-3">
      {d.qc.length === 0 ? <p className="text-[12.5px] text-ink3">Belum ada inspeksi QC.</p> : d.qc.map((q) => (
        <div key={q.version} className="rounded-btn border border-line p-3">
          <div className="flex items-center justify-between">
            <p className="m-0 text-[12.5px] font-bold text-ink">Versi {q.version} — {q.resultLabel}</p>
            <span className="text-[11px] text-ink3">{fmtDT(q.inspectedAt)}</span>
          </div>
          <p className="m-0 text-[12px] text-ink3">Pemeriksa: {bd(q.inspectorName)}</p>
          {q.overrideReason && <p className="m-0 break-words text-[12px] text-orange">Alasan waive: {q.overrideReason}</p>}
          {q.items.length > 0 && (
            <ul className="m-0 mt-2 list-none space-y-1 p-0 text-[11.5px]">
              {q.items.map((it) => <li key={it.itemCode} className="flex justify-between gap-2"><span className="shrink-0">{it.label}</span><span className="min-w-0 break-words text-right text-ink3">{it.result}{it.note ? ` — ${it.note}` : ""}</span></li>)}
            </ul>
          )}
          {q.items.some((it) => it.photoUrls.length) && <div className="mt-2"><MediaGrid items={q.items.flatMap((it) => it.photoUrls.map((url) => ({ stepLabel: it.label, url, kind: "image" })))} empty="" /></div>}
        </div>
      ))}
      <div className="rounded-btn border border-line p-3">
        <p className="m-0 mb-2 text-[12.5px] font-bold text-ink">Handoff & Kesiapan Kirim</p>
        <dl className="m-0 grid grid-cols-2 gap-2 text-[12px]">
          <Field label="Status Unit" value={d.deliveryReadiness.unitStatus} />
          <Field label="Siap Kirim" value={d.deliveryReadiness.readyForDelivery ? "Ya" : "Belum"} />
          {d.deliveryReadiness.finishedGoodsHandoff && <>
            <Field label="Status Serah Gudang" value={d.deliveryReadiness.finishedGoodsHandoff.status} />
            <Field label="Diserahkan" value={d.deliveryReadiness.finishedGoodsHandoff.offeredAt ? fmtDT(d.deliveryReadiness.finishedGoodsHandoff.offeredAt) : null} />
          </>}
        </dl>
      </div>
    </div>
  );
}

function Aktivitas({ d }) {
  if (!d.activity.length) return <p className="text-[12.5px] text-ink3">Belum ada aktivitas tercatat.</p>;
  return (
    <ol className="m-0 list-none space-y-2 p-0">
      {d.activity.map((a, i) => (
        <li key={i} className="flex gap-3 border-l-2 border-line pl-3 text-[12px]">
          <div className="min-w-0 flex-1">
            <p className="m-0 break-words text-ink">{a.label}</p>
            <p className="m-0 text-[11px] text-ink3">{fmtDT(a.at)}{a.actor ? ` · ${a.actor}` : ""}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// Konstanta modul (identitas stabil) — selector uji yang stabil untuk dialog Unit 360.
const UNIT_DIALOG_PROPS = { "data-testid": "unit-overview-dialog" };

// P12B.4 — unit di LUAR cohort Production V2 (Unit 360 = 404; cohort tidak diperluas) tetap terbuka di drawer yang SAMA: data order/unit asli (baca-saja,
// GET /units/:id/timeline) + penjelasan jujur bagian V2 yang belum tersedia (UnitOrderFallback). Tidak ada halaman/tab Unit terpisah.
export function UnitOverviewDrawer({ unitId, onClose, onManage, manageLabel = "Kelola", onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [legacy, setLegacy] = useState({ data: null, error: "", loading: false });
  const [tab, setTab] = useState("ringkasan");
  const [showDiagnosis, setShowDiagnosis] = useState(false);

  const reload = useCallback(() => {
    if (!unitId) return;
    api.getUnitOverview(unitId).then(setData).catch((e) => setError(friendlyError(e)));
  }, [unitId]);

  useEffect(() => {
    if (!unitId) return undefined;
    let alive = true;
    setData(null); setError(""); setUnavailable(false); setLegacy({ data: null, error: "", loading: false }); setTab("ringkasan"); setShowDiagnosis(false);
    api.getUnitOverview(unitId).then((res) => { if (alive) setData(res); }).catch((e) => {
      if (!alive) return;
      if (!isOutsideV2(e)) { setError(friendlyError(e)); return; }
      setUnavailable(true); setLegacy({ data: null, error: "", loading: true });
      api.getUnitTimeline(unitId)
        .then((t) => { if (alive) setLegacy({ data: t, error: "", loading: false }); })
        .catch((e2) => { if (alive) setLegacy({ data: null, error: friendlyError(e2), loading: false }); });
    });
    return () => { alive = false; };
  }, [unitId]);

  // P9D — submit diagnosis (BOM+layanan) lalu tutup tahap 5 lewat jalur SAMA dengan Aplikasi Meja
  // (recordProductionV2Step). Kalau penutupan tahap gagal, diagnosis TETAP tersimpan — muat ulang saja.
  async function handleDiagnosisSubmitted(result) {
    setShowDiagnosis(false);
    try {
      await api.recordProductionV2Step(data.production.runId, 5, {
        expectedRevision: data.production.revision, workCenterId: data.planning?.workCenter?.id,
        payload: { diagnosis: result.serviceLabel ? `Layanan teknis: ${result.serviceLabel}` : "Diagnosis dikirim", inputMethod: "TEXT" }, media: [],
      }, `p9d-unit360-close-${data.production.runId}-${Date.now()}`);
    } catch { /* diagnosis sudah tersimpan; operator/Lead bisa menutup tahap dari Aplikasi Meja */ }
    reload();
  }

  return (
    <Modal open={!!unitId} onOpenChange={(v) => !v && onClose()} contentProps={UNIT_DIALOG_PROPS}
      title={data ? `${data.identity.unitCode}${data.identity.orderNumber ? ` · ${data.identity.orderNumber}` : ""}` : unavailable ? (legacy.data?.unit?.unitCode ? `${legacy.data.unit.unitCode}${legacy.data.unit.order?.orderNumber ? ` · ${legacy.data.unit.order.orderNumber}` : ""}` : "Detail unit") : "Unit 360"}
      description={data ? (data.customer.name?.value || "Pelanggan belum dicatat") : unavailable ? (legacy.data?.unit?.order?.customer?.name || undefined) : undefined}
      className="flex w-[900px] flex-col max-sm:!h-full max-sm:!max-h-full max-sm:!w-full max-sm:!max-w-full max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-none max-sm:!top-0 max-sm:!left-0">
      <div className="flex min-h-0 flex-1 flex-col px-6 pb-4">
        {error && <p role="alert" className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{error}</p>}
        {unavailable && <div data-testid="unit-overview-fallback"><UnitOrderFallback data={legacy.data} error={legacy.error} loading={legacy.loading} roles={rolesOf(currentUserLocal())} onData={(t) => setLegacy({ data: t, error: "", loading: false })} onChanged={onChanged} /></div>}
        {!data && !error && !unavailable && <div data-testid="unit-overview-loading" className="space-y-2"><div className="h-6 w-2/3 animate-pulse rounded bg-inset" /><div className="h-24 animate-pulse rounded bg-inset" /></div>}
        {data && (
          <div data-testid="unit-overview-ready" className="flex min-h-0 flex-1 flex-col">
            <div className="mb-3 flex shrink-0 items-center gap-3">
              <UnitPhotoThumb photoUrl={data.identity.photoUrl} size={56} />
              <div className="min-w-0 flex-1">
                {data.permissions.canSeeValue && data.orderValue != null && <p className="m-0 text-[13px] font-semibold text-ink2">{formatRupiah(data.orderValue)}</p>}
              </div>
              {onManage && <Button size="sm" variant="secondary" data-mutates className="min-h-[44px] shrink-0" onClick={onManage}>{manageLabel}</Button>}
            </div>
            <div role="tablist" aria-label="Bagian Unit 360" className="mb-3 flex shrink-0 gap-1 overflow-x-auto border-b border-line">
              {TABS.map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={`min-h-[44px] shrink-0 whitespace-nowrap border-b-2 px-3 text-[12.5px] font-semibold ${tab === k ? "border-accent text-accent" : "border-transparent text-ink3"}`}>
                  {l}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-2">
              {tab === "ringkasan" && <Ringkasan d={data} />}
              {tab === "proses" && <Proses d={data} onOpenDiagnosis={() => setShowDiagnosis(true)} />}
              {tab === "bahan" && <Bahan d={data} onDiagnosisRefresh={reload} />}
              {tab === "dokumentasi" && <Dokumentasi d={data} />}
              {tab === "qc" && <QcHandoff d={data} />}
              {tab === "aktivitas" && <Aktivitas d={data} />}
            </div>
          </div>
        )}
      </div>
      {showDiagnosis && data && (
        <DiagnosisWizard
          card={{
            runId: data.production.runId, unitCode: data.identity.unitCode, workCenterId: data.planning?.workCenter?.id,
            customer: {
              category: data.salesContext.category?.value ?? null, weightKg: data.salesContext.weightKg?.value ?? null, salesServices: data.salesContext.salesServices?.value ?? [],
              complaints: data.salesContext.complaints?.value ?? [], request: data.salesContext.request?.value ?? null,
            },
            priorServiceLabel: data.service?.set ? data.service.label : null,
            diagnosisRevision: data.diagnosis?.current?.revision ?? 0, current: data.diagnosis?.current ?? null,
          }}
          onClose={() => setShowDiagnosis(false)}
          onSubmitted={handleDiagnosisSubmitted}
        />
      )}
    </Modal>
  );
}
