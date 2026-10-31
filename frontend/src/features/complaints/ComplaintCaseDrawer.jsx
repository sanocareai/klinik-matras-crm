import React, { useEffect, useState, useCallback, useMemo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Loader2, Save, Truck, Package, ClipboardCheck, MessageSquare, CheckCircle2, ChevronDown, MoreHorizontal, Clock, Lock, Ban, ArrowRight } from "lucide-react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu.jsx";
import { ActivityTimeline } from "@/components/ui/activity-timeline.jsx";
import { cn } from "@/lib/utils.js";
import { formatRupiah } from "@/utils/format.js";
import { formatTanggal, formatTanggalJam, hariSejak } from "@/utils/formatDate.js";
import {
  CATEGORY_LABEL, SEVERITY_LABEL, SEVERITY_TONE, WARRANTY_LABEL, OWNER_LABEL, STATUS_LABEL, formatComplaintActivitySentence,
} from "./complaintLabels.js";
import {
  KEADAAN, TAHAP, tahapDari, aksiUtama, aksiLain, pilihanCara, bisaAksi, pesanIzin, kasusTutup, PRIORITAS_BAHAN, TERTAHAN,
  REDELIVERY_GATE_STATUSES,
} from "./complaintFlow.js";
import ComplaintStepper from "./ComplaintStepper.jsx";

const JOB_TYPE_LABEL = { PICKUP: "Pengambilan/pemeriksaan unit", DELIVERY: "Pengiriman ke pelanggan" };
const JOB_STATUS_LABEL = {
  UNSCHEDULED: "Belum dijadwalkan", SCHEDULED: "Dijadwalkan", ASSIGNED: "Sudah ada petugas",
  EN_ROUTE: "Dalam perjalanan", ARRIVED: "Tiba", COMPLETED: "Selesai", FAILED: "Gagal", RESCHEDULED: "Dijadwalkan ulang",
};
const INPUT = "w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-ink3 focus:border-accent";

// Pengguna aktif hanya untuk PETUNJUK izin di tombol (cermin peran backend, dikunci tes). Penegak sebenarnya tetap server (403). Tanpa data pengguna → tombol tidak dikunci.
function penggunaAktif() { try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; } }

function Lipat({ judul, ringkas, terbuka, onToggle, children, testid }) {
  return (
    <section className="rounded-xl bg-inset/60" data-testid={testid}>
      <button type="button" onClick={onToggle} aria-expanded={terbuka} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-semibold text-ink">{judul}</span>
          {!terbuka && ringkas && <span className="mt-0.5 block truncate text-[11.5px] text-ink3">{ringkas}</span>}
        </span>
        <ChevronDown size={15} className={cn("shrink-0 text-ink3 transition-transform", terbuka && "rotate-180")} aria-hidden="true" />
      </button>
      {terbuka && <div className="space-y-2.5 px-3 pb-3">{children}</div>}
    </section>
  );
}

function Baris({ label, children }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-ink3">{label}</p>
      <div className="mt-0.5 whitespace-pre-wrap text-[13px] text-ink">{children}</div>
    </div>
  );
}

// Drawer TUNGGAL lintas divisi (Sales/Delivery/Produksi/Warehouse/QC). Tampilan dibuat 4 tahap + SATU aksi utama; status rinci, aturan transisi, izin lintas divisi, audit, dan gerbang
// konfirmasi pelanggan tetap di backend — tombol hanya memanggil endpoint yang SUDAH ada (lihat complaintFlow.js + tes).
export default function ComplaintCaseDrawer({ open, caseId, onClose, onChanged }) {
  const [kase, setKase] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const user = useMemo(penggunaAktif, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const [rootCause, setRootCause] = useState("");
  const [resolution, setResolution] = useState("");
  const [resolutionCost, setResolutionCost] = useState("");
  const [panel, setPanel] = useState(null); // null | "cara" | "bahan" | "qc" | "tindakLanjut" | "batal" | "selesai" | "waiveRedelivery"
  const [alasan, setAlasan] = useState("");
  const [tindakLanjut, setTindakLanjut] = useState("");
  const [bukaPenyebab, setBukaPenyebab] = useState(null); // null = ikut tahap
  const [bukaLinimasa, setBukaLinimasa] = useState(false);
  const [bukaDetail, setBukaDetail] = useState(false); // mode baca kasus tutup: tampilkan objek tertaut + linimasa

  const [materials, setMaterials] = useState([]);
  const [matId, setMatId] = useState("");
  const [matQty, setMatQty] = useState("1");
  const [matPriority, setMatPriority] = useState("NORMAL");
  const [qcTests, setQcTests] = useState([]);
  const [qcId, setQcId] = useState("");

  const [waiveReason, setWaiveReason] = useState("");

  const load = useCallback(() => {
    if (!caseId) return;
    setLoading(true); setError("");
    Promise.all([api.getComplaintCase(caseId), api.getActivity("complaint", caseId)])
      .then(([c, act]) => {
        setKase(c); setActivity(act.events || []);
        setRootCause(c.rootCause || ""); setResolution(c.resolution || ""); setResolutionCost(c.resolutionCost != null ? String(c.resolutionCost) : "");
        setPanel(null); setAlasan(""); setWaiveReason("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [caseId]);

  useEffect(() => {
    if (open) load();
    else { setKase(null); setActivity([]); setError(""); setPanel(null); setAlasan(""); setWaiveReason(""); setTindakLanjut(""); setBukaPenyebab(null); setBukaLinimasa(false); setBukaDetail(false); setMatId(""); setQcId(""); }
  }, [open, load]);

  const berubah = () => { load(); onChanged?.(); };
  const jalankan = async (fn) => { setBusy(true); setError(""); try { await fn(); berubah(); } catch (e) { setError(e.message); } finally { setBusy(false); } };

  const tutup = kasusTutup(kase);
  const tahap = kase ? tahapDari(kase.status) : null;
  const utama = useMemo(() => aksiUtama(kase), [kase]);
  const lain = useMemo(() => aksiLain(kase), [kase]);
  const cara = useMemo(() => pilihanCara(kase), [kase]);
  const kotor = kase && (rootCause !== (kase.rootCause || "") || resolution !== (kase.resolution || "") || resolutionCost !== (kase.resolutionCost != null ? String(kase.resolutionCost) : ""));
  const lewatTarget = kase && !tutup && kase.targetCompletionAt && hariSejak(kase.targetCompletionAt) > 0;
  const izinOk = (izin) => !user || bisaAksi(user, izin);

  const simpanField = () => jalankan(() => api.updateComplaintCase(caseId, { rootCause: rootCause.trim() || null, resolution: resolution.trim() || null, resolutionCost: resolutionCost === "" ? null : Number(resolutionCost) }));
  const keStatus = (ke, note) => jalankan(() => api.transitionComplaintStatus(caseId, { status: ke, note: note?.trim() || undefined }));
  const buatTugas = (jobType) => jalankan(() => api.createComplaintDeliveryTask(caseId, { jobType }));

  async function bukaBahan() {
    setPanel("bahan");
    if (materials.length === 0) { try { const list = await api.getMaterials({ active: "true" }); setMaterials(Array.isArray(list) ? list : []); } catch { /* daftar kosong — bukan penghalang */ } }
  }
  async function bukaQc() {
    setPanel("qc");
    if (kase?.unit?.id && qcTests.length === 0) { try { const t = await api.getUnitTimeline(kase.unit.id); setQcTests(t.qcFitTests || []); } catch { /* daftar kosong */ } }
  }
  function kirimBahan() {
    if (!matId) { setError("Pilih bahan terlebih dahulu"); return; }
    const qty = Number(matQty); if (!Number.isFinite(qty) || qty <= 0) { setError("Jumlah tidak valid"); return; }
    jalankan(() => api.createComplaintMaterialRequirement(caseId, { priority: matPriority, lines: [{ materialId: matId, requestedQty: qty }] }));
  }
  function kirimQc() { if (!qcId) { setError("Pilih hasil QC terlebih dahulu"); return; } jalankan(() => api.linkComplaintQc(caseId, qcId)); }
  function kirimTindakLanjut() { if (!tindakLanjut.trim()) { setError("Catatan tindak lanjut wajib diisi"); return; } jalankan(async () => { await api.logComplaintFollowUp(caseId, tindakLanjut.trim()); setTindakLanjut(""); }); }
  function kirimBatal() { if (!alasan.trim()) { setError("Alasan pembatalan wajib diisi"); return; } keStatus("DIBATALKAN", alasan); }

  function pilihAksi(a) {
    setError("");
    if (a.jenis === "status") return keStatus(a.ke);
    if (a.jenis === "tugasKirim") return buatTugas(a.jobType);
    if (a.jenis === "konfirmasi") return setPanel("selesai");
    if (a.jenis === "pilihCara") return setPanel("cara");
    if (a.jenis === "mintaBahan") return bukaBahan();
    if (a.jenis === "tautkanQc") return bukaQc();
    if (a.jenis === "tindakLanjut") return setPanel("tindakLanjut");
    if (a.jenis === "batal") return setPanel("batal");
    if (a.jenis === "waiveRedelivery") return setPanel("waiveRedelivery");
    return undefined;
  }

  const penyebabTerbuka = bukaPenyebab ?? (tahap != null && tahap <= 2);
  const tertahan = kase && TERTAHAN.includes(kase.status);
  const adaTertaut = kase && (kase.jobs?.length > 0 || kase.materialIssues?.length > 0 || kase.unitRevisions?.length > 0);
  const biayaTeks = kase?.resolutionCost != null ? formatRupiah(kase.resolutionCost) : "Belum diisi";

  const Tertaut = () => (
    <div className="space-y-1.5" data-testid="objek-tertaut">
      {kase.jobs?.map((j) => (
        <p key={j.id} className="flex items-start gap-1.5 text-[12px] text-ink2"><Truck size={13} className="mt-0.5 shrink-0 text-ink3" aria-hidden="true" />{JOB_TYPE_LABEL[j.type] || j.type} — {JOB_STATUS_LABEL[j.status] || j.status}{j.scheduledDate ? ` (${formatTanggal(j.scheduledDate)})` : ""}</p>
      ))}
      {kase.materialIssues?.map((m) => (
        <p key={m.id} className="flex items-start gap-1.5 text-[12px] text-ink2"><Package size={13} className="mt-0.5 shrink-0 text-ink3" aria-hidden="true" />Permintaan bahan {m.issueNumber} — {m.status}</p>
      ))}
      {kase.unitRevisions?.map((r) => (
        <p key={r.id} className="flex items-start gap-1.5 text-[12px] text-ink2"><ClipboardCheck size={13} className="mt-0.5 shrink-0 text-ink3" aria-hidden="true" />Revisi unit ({r.trigger}) — {r.status}</p>
      ))}
    </div>
  );

  // Gerbang redelivery (31 Okt 2026, insiden Sony RES-27082026-183) — cermin
  // FRONTEND dari assertRedeliveryCompleted di backend/services/complaintCase.js:
  // job DELIVERY tertaut kasus ini yang BELUM COMPLETED dengan bukti foto, ATAU
  // kasus belum pernah punya job DELIVERY sama sekali. HANYA untuk ditampilkan
  // (backend yang MENEGAKKAN) — supaya staf tahu KENAPA sebelum mencoba, bukan
  // cuma baca pesan error sesudahnya. REDELIVERY_GATE_STATUSES dari
  // complaintFlow.js (SATU sumber, dipakai juga oleh aksiLain() untuk
  // menu "Selesaikan tanpa pengiriman ulang").
  const deliveryJobs = kase ? (kase.jobs || []).filter((j) => j.type === "DELIVERY") : [];
  const outstandingRedeliveryJobs = kase && !kase.redeliveryWaivedAt
    ? deliveryJobs.filter((j) => !(j.status === "COMPLETED" && (j.proofPhotoUrls?.length || 0) > 0))
    : [];
  const neverHadRedeliveryJob = !!(kase && !kase.redeliveryWaivedAt && deliveryJobs.length === 0
    && REDELIVERY_GATE_STATUSES.includes(kase.status));
  const redeliveryLocked = outstandingRedeliveryJobs.length > 0 || neverHadRedeliveryJob;

  function kirimWaiveRedelivery() {
    if (!waiveReason.trim()) { setError("Alasan wajib diisi"); return; }
    jalankan(async () => { await api.waiveComplaintRedelivery(caseId, waiveReason.trim()); setPanel(null); setWaiveReason(""); });
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content aria-label="Kasus Komplain" className="fixed right-0 top-0 z-[201] flex h-full w-full flex-col bg-surface shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[520px]">
          <Dialog.Description className="sr-only">Detail kasus komplain: keluhan, tahap penanganan, langkah berikutnya, dan riwayat.</Dialog.Description>
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
            <Dialog.Title className="font-mono text-[14px] font-bold text-ink">{kase ? kase.caseNumber : "Kasus Komplain"}</Dialog.Title>
            {kase && <Badge variant={SEVERITY_TONE[kase.severity]}>{SEVERITY_LABEL[kase.severity] || kase.severity}</Badge>}
            <Dialog.Close aria-label="Tutup" className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-ink3 hover:bg-hovertint hover:text-ink"><X size={16} /></Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-4">
            {loading && !kase && <p className="text-[12px] text-ink3">Memuat…</p>}
            {error && <p role="alert" className="rounded-btn bg-redbg px-2.5 py-2 text-[12.5px] text-red">{error}</p>}

            {kase && (
              <>
                {/* 1. Di mana posisi kasus ini */}
                {tutup ? (
                  kase.status === "SELESAI" ? (
                    <div className="rounded-xl bg-greenbg px-3 py-2.5" data-testid="banner-selesai">
                      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-green"><CheckCircle2 size={15} aria-hidden="true" /> Kasus selesai</p>
                      <p className="mt-0.5 text-[12px] text-ink2">Dikonfirmasi pelanggan {kase.customerConfirmedAt ? formatTanggalJam(kase.customerConfirmedAt) : ""}{kase.customerConfirmedBy?.name ? ` · dicatat ${kase.customerConfirmedBy.name}` : ""}</p>
                    </div>
                  ) : (
                    <div className="rounded-xl bg-redbg px-3 py-2.5" data-testid="banner-batal">
                      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-red"><Ban size={15} aria-hidden="true" /> Kasus dibatalkan</p>
                      {kase.cancelReason && <p className="mt-0.5 text-[12px] text-ink2">Alasan: {kase.cancelReason}</p>}
                    </div>
                  )
                ) : (
                  <div>
                    <ComplaintStepper tahap={tahap} tertahan={tertahan} />
                    <p className="mt-2 text-center text-[12px] text-ink2" data-testid="keadaan">
                      <span className="font-semibold text-ink">{KEADAAN[kase.status]}</span>
                      <span className="text-ink3"> · status rinci: {STATUS_LABEL[kase.status] || kase.status}</span>
                    </p>
                  </div>
                )}

                {/* 2. Keluhan & siapa yang memegang */}
                <div className="rounded-xl border border-line p-3" data-testid="kartu-keluhan">
                  <p className="text-[11px] font-semibold text-ink3">Keluhan pelanggan</p>
                  <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{kase.description}</p>
                  <p className="mt-2 text-[12px] text-ink2">{kase.order?.customer?.name} · {kase.order?.orderNumber}{kase.unit ? ` · Unit ${kase.unit.unitCode}` : ""}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge variant="neutral">{CATEGORY_LABEL[kase.category] || kase.category}</Badge>
                    <Badge variant="neutral">{WARRANTY_LABEL[kase.warrantyStatus] || kase.warrantyStatus}</Badge>
                  </div>
                  {!tutup && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5 text-[12px]">
                      <span className="text-ink2" data-testid="pic">Dipegang oleh <span className="font-semibold text-ink">{OWNER_LABEL[kase.currentOwner] || kase.currentOwner}</span></span>
                      {kase.targetCompletionAt && (
                        <span className={cn("flex items-center gap-1", lewatTarget ? "font-semibold text-red" : "text-ink3")}><Clock size={12} aria-hidden="true" />{lewatTarget ? `Lewat target ${hariSejak(kase.targetCompletionAt)} hari` : `Target ${formatTanggal(kase.targetCompletionAt)}`}</span>
                      )}
                    </div>
                  )}
                </div>

                {/* 2b. Gerbang redelivery (31 Okt 2026, insiden Sony RES-27082026-183) — tampil sebelum langkah berikutnya supaya staf tahu KENAPA sebelum mencoba, bukan cuma baca pesan error sesudahnya. Backend yang menegakkan (assertRedeliveryCompleted); ini cuma cermin. */}
                {redeliveryLocked && (
                  <div className="rounded-xl bg-orangebg px-3 py-2.5" data-testid="banner-gerbang-redelivery">
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold text-orange"><Lock size={14} aria-hidden="true" /> Belum bisa konfirmasi/selesaikan kasus</p>
                    {outstandingRedeliveryJobs.length > 0 ? (
                      <>
                        <p className="mt-1 text-[12px] text-ink2">Job pengiriman ulang berikut belum tuntas dengan bukti foto:</p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-ink2">
                          {outstandingRedeliveryJobs.map((j) => (
                            <li key={j.id}>{JOB_STATUS_LABEL[j.status] || j.status}{j.status === "COMPLETED" ? " (tanpa bukti foto)" : ""}</li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p className="mt-1 text-[12px] text-ink2">Kasus ini belum pernah punya job pengiriman ulang — buat tugas kirim ulang kalau memang perlu, atau pilih "Selesaikan tanpa pengiriman ulang" lewat menu Tindakan lainnya.</p>
                    )}
                  </div>
                )}
                {kase.redeliveryWaivedAt && (
                  <p className="rounded-xl bg-inset/60 px-3 py-2.5 text-[12px] text-ink2" data-testid="catatan-waive-redelivery">
                    Diselesaikan tanpa pengiriman ulang {formatTanggalJam(kase.redeliveryWaivedAt)}
                    {kase.redeliveryWaivedBy?.name ? ` oleh ${kase.redeliveryWaivedBy.name}` : ""} — {kase.redeliveryWaivedReason}
                  </p>
                )}

                {/* 3. SATU langkah berikutnya */}
                {!tutup && utama && (
                  <div className="rounded-xl bg-accentbg/60 p-3" data-testid="langkah-berikutnya">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink3">Langkah berikutnya</p>
                    <p className="mt-1 text-[14px] font-semibold text-ink" data-testid="aksi-utama-label">{utama.label}</p>
                    <p className="mt-0.5 text-[12px] text-ink2">{utama.bantuan}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button type="button" data-testid="aksi-utama" disabled={busy || !izinOk(utama.izin)} onClick={() => pilihAksi(utama)}
                        className="flex min-h-11 items-center gap-1.5 rounded-btn bg-accent px-4 py-2 text-[13px] font-bold text-white hover:bg-accenthov disabled:opacity-50 sm:min-h-9">
                        {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <ArrowRight size={14} aria-hidden="true" />}{utama.jenis === "pilihCara" ? "Pilih cara menangani" : utama.jenis === "konfirmasi" ? "Selesaikan kasus" : utama.label}
                      </button>
                      <Menu trigger={<button type="button" data-testid="tindakan-lainnya" disabled={busy} className="flex min-h-11 items-center gap-1.5 rounded-btn px-3 py-2 text-[13px] font-semibold text-ink2 hover:bg-hovertint sm:min-h-9"><MoreHorizontal size={15} aria-hidden="true" /> Tindakan lainnya</button>}>
                        {lain.map((a, i) => (
                          <React.Fragment key={`${a.jenis}-${a.ke || a.jobType || i}`}>
                            {a.jenis === "batal" && <MenuSeparator />}
                            <MenuItem destructive={a.bahaya} disabled={!izinOk(a.izin)} hint={!izinOk(a.izin) ? pesanIzin(a.izin) : undefined} onSelect={() => pilihAksi(a)}>{a.label}</MenuItem>
                          </React.Fragment>
                        ))}
                      </Menu>
                    </div>
                    {!izinOk(utama.izin) && <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-orange" role="note"><Lock size={12} className="mt-0.5 shrink-0" aria-hidden="true" />{pesanIzin(utama.izin)}</p>}

                    {/* panel inline: hanya satu terbuka */}
                    {panel === "cara" && (
                      <div className="mt-3 space-y-2 rounded-xl bg-surface p-2.5" data-testid="panel-cara">
                        <p className="text-[12px] font-semibold text-ink">Bagaimana solusinya dikerjakan?</p>
                        {!resolution.trim() && <p className="text-[11.5px] text-orange">Solusi yang disepakati belum diisi — sebaiknya isi dulu di bagian "Penyebab &amp; solusi" agar tim lain paham.</p>}
                        {cara.map((c) => (
                          <button key={c.kunci} type="button" disabled={busy || !izinOk(c.izin)} onClick={() => pilihAksi(c)} data-testid={`cara-${c.kunci}`}
                            className="flex w-full min-h-11 flex-col items-start rounded-btn bg-inset px-3 py-2 text-left hover:bg-hovertint disabled:opacity-50">
                            <span className="text-[13px] font-semibold text-ink">{c.label}</span>
                            <span className="text-[11.5px] text-ink3">{izinOk(c.izin) ? c.bantuan : pesanIzin(c.izin)}</span>
                          </button>
                        ))}
                        <button type="button" onClick={() => setPanel(null)} className="text-[12px] font-semibold text-ink3 hover:text-ink">Tutup</button>
                      </div>
                    )}
                    {panel === "selesai" && (
                      <div className="mt-3 space-y-2 rounded-xl bg-surface p-2.5" data-testid="panel-selesai">
                        <p className="text-[12.5px] font-semibold text-ink">Pastikan pelanggan sudah menyatakan puas.</p>
                        <p className="text-[11.5px] text-ink3">Setelah diselesaikan, kasus pindah ke Riwayat dan tidak bisa dibuka kembali.</p>
                        <div className="flex gap-2">
                          <button type="button" disabled={busy} onClick={() => jalankan(() => api.confirmComplaintCustomer(caseId))} data-testid="konfirmasi-selesai" className="flex min-h-11 items-center gap-1.5 rounded-btn bg-green px-3 py-2 text-[12.5px] font-bold text-white disabled:opacity-50 sm:min-h-9"><CheckCircle2 size={14} aria-hidden="true" /> Ya, selesaikan kasus</button>
                          <button type="button" onClick={() => setPanel(null)} className="rounded-btn px-3 py-2 text-[12.5px] font-semibold text-ink3 hover:bg-hovertint">Belum</button>
                        </div>
                      </div>
                    )}
                    {panel === "bahan" && (
                      <div className="mt-3 space-y-2 rounded-xl bg-surface p-2.5" data-testid="panel-bahan">
                        <p className="text-[12px] font-semibold text-ink">Minta bahan ke Warehouse</p>
                        <p className="text-[11.5px] text-ink3">Kasus akan ditahan di "menunggu bahan" sampai bahan siap.</p>
                        {!izinOk("MINTA_BAHAN") && <p className="text-[11.5px] text-orange">{pesanIzin("MINTA_BAHAN")}</p>}
                        <select value={matId} onChange={(e) => setMatId(e.target.value)} aria-label="Bahan" className={INPUT}>
                          <option value="">Pilih bahan…</option>
                          {materials.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
                        </select>
                        <div className="flex gap-2">
                          <input type="number" min="0" value={matQty} onChange={(e) => setMatQty(e.target.value)} aria-label="Jumlah" placeholder="Jumlah" className={cn(INPUT, "w-24")} />
                          <select value={matPriority} onChange={(e) => setMatPriority(e.target.value)} aria-label="Seberapa mendesak" className={cn(INPUT, "flex-1")}>
                            {Object.entries(PRIORITAS_BAHAN).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        </div>
                        <div className="flex gap-2">
                          <button type="button" disabled={busy || !izinOk("MINTA_BAHAN")} onClick={kirimBahan} className="min-h-11 rounded-btn bg-accent px-3 py-2 text-[12.5px] font-bold text-white disabled:opacity-50 sm:min-h-9">Minta bahan</button>
                          <button type="button" onClick={() => setPanel(null)} className="rounded-btn px-3 py-2 text-[12.5px] font-semibold text-ink3 hover:bg-hovertint">Batal</button>
                        </div>
                      </div>
                    )}
                    {panel === "qc" && (
                      <div className="mt-3 space-y-2 rounded-xl bg-surface p-2.5" data-testid="panel-qc">
                        <p className="text-[12px] font-semibold text-ink">Kaitkan hasil QC ke kasus ini</p>
                        {!izinOk("TAUTKAN_QC") && <p className="text-[11.5px] text-orange">{pesanIzin("TAUTKAN_QC")}</p>}
                        <select value={qcId} onChange={(e) => setQcId(e.target.value)} aria-label="Hasil QC" className={INPUT}>
                          <option value="">Pilih hasil QC…</option>
                          {qcTests.map((q) => <option key={q.id} value={q.id}>{q.stage?.labelId || "QC"} — {q.verdict} ({formatTanggal(q.createdAt)})</option>)}
                        </select>
                        <div className="flex gap-2">
                          <button type="button" disabled={busy || !izinOk("TAUTKAN_QC")} onClick={kirimQc} className="min-h-11 rounded-btn bg-accent px-3 py-2 text-[12.5px] font-bold text-white disabled:opacity-50 sm:min-h-9">Kaitkan</button>
                          <button type="button" onClick={() => setPanel(null)} className="rounded-btn px-3 py-2 text-[12.5px] font-semibold text-ink3 hover:bg-hovertint">Batal</button>
                        </div>
                      </div>
                    )}
                    {panel === "tindakLanjut" && (
                      <div className="mt-3 space-y-2 rounded-xl bg-surface p-2.5" data-testid="panel-tindak-lanjut">
                        <p className="text-[12px] font-semibold text-ink">Catat tindak lanjut ke pelanggan</p>
                        {!izinOk("KONFIRMASI") && <p className="text-[11.5px] text-orange">{pesanIzin("KONFIRMASI")}</p>}
                        <textarea value={tindakLanjut} onChange={(e) => setTindakLanjut(e.target.value)} rows={2} placeholder="Apa yang sudah disampaikan ke pelanggan?" aria-label="Catatan tindak lanjut" className={INPUT} />
                        <div className="flex gap-2">
                          <button type="button" disabled={busy || !izinOk("KONFIRMASI")} onClick={kirimTindakLanjut} className="flex min-h-11 items-center gap-1.5 rounded-btn bg-accent px-3 py-2 text-[12.5px] font-bold text-white disabled:opacity-50 sm:min-h-9"><MessageSquare size={13} aria-hidden="true" /> Simpan catatan</button>
                          <button type="button" onClick={() => setPanel(null)} className="rounded-btn px-3 py-2 text-[12.5px] font-semibold text-ink3 hover:bg-hovertint">Batal</button>
                        </div>
                      </div>
                    )}
                    {panel === "batal" && (
                      <div className="mt-3 space-y-2 rounded-xl bg-surface p-2.5" data-testid="panel-batal">
                        <p className="text-[12.5px] font-semibold text-red">Batalkan kasus ini?</p>
                        <textarea value={alasan} onChange={(e) => setAlasan(e.target.value)} rows={2} placeholder="Alasan pembatalan (wajib)" aria-label="Alasan pembatalan" className={INPUT} />
                        <div className="flex gap-2">
                          <button type="button" disabled={busy} onClick={kirimBatal} className="min-h-11 rounded-btn bg-red px-3 py-2 text-[12.5px] font-bold text-white disabled:opacity-50 sm:min-h-9">Ya, batalkan</button>
                          <button type="button" onClick={() => setPanel(null)} className="rounded-btn px-3 py-2 text-[12.5px] font-semibold text-ink3 hover:bg-hovertint">Tidak jadi</button>
                        </div>
                      </div>
                    )}
                    {panel === "waiveRedelivery" && (
                      <div className="mt-3 space-y-2 rounded-xl bg-surface p-2.5" data-testid="panel-waive-redelivery">
                        <p className="text-[12.5px] font-semibold text-ink">Selesaikan tanpa pengiriman ulang?</p>
                        <p className="text-[11.5px] text-ink3">Pakai ini kalau kasus memang tidak akan dikirim ulang secara fisik (mis. customer pilih refund) — bukan cara memintas job yang belum selesai.</p>
                        <textarea value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} rows={2} placeholder="Kenapa diselesaikan tanpa pengiriman ulang (wajib) — mis. customer pilih refund" aria-label="Alasan menyelesaikan tanpa pengiriman ulang" className={INPUT} />
                        <div className="flex gap-2">
                          <button type="button" disabled={busy} onClick={kirimWaiveRedelivery} className="min-h-11 rounded-btn bg-accent px-3 py-2 text-[12.5px] font-bold text-white disabled:opacity-50 sm:min-h-9">Simpan</button>
                          <button type="button" onClick={() => { setPanel(null); setWaiveReason(""); }} className="rounded-btn px-3 py-2 text-[12.5px] font-semibold text-ink3 hover:bg-hovertint">Batal</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 4. Rincian — kasus terbuka: bisa diedit; kasus tutup: mode baca ringkas */}
                {!tutup ? (
                  <Lipat judul="Penyebab & solusi" testid="bagian-penyebab" terbuka={penyebabTerbuka} onToggle={() => setBukaPenyebab(!penyebabTerbuka)}
                    ringkas={kase.resolution || kase.rootCause || "Belum diisi"}>
                    <div>
                      <label htmlFor="kmp-penyebab" className="mb-1 block text-[11.5px] font-semibold text-ink2">Penyebab masalah</label>
                      <textarea id="kmp-penyebab" value={rootCause} onChange={(e) => setRootCause(e.target.value)} rows={2} placeholder="Kenapa masalah ini terjadi? (diisi saat memeriksa)" className={INPUT} />
                    </div>
                    <div>
                      <label htmlFor="kmp-solusi" className="mb-1 block text-[11.5px] font-semibold text-ink2">Solusi yang disepakati</label>
                      <textarea id="kmp-solusi" value={resolution} onChange={(e) => setResolution(e.target.value)} rows={2} placeholder="Apa yang akan dilakukan untuk pelanggan?" className={INPUT} />
                    </div>
                    <div>
                      <label htmlFor="kmp-biaya" className="mb-1 block text-[11.5px] font-semibold text-ink2">Perkiraan biaya penanganan (Rp)</label>
                      <input id="kmp-biaya" type="number" min="0" value={resolutionCost} onChange={(e) => setResolutionCost(e.target.value)} placeholder="0" className={INPUT} />
                      <p className="mt-1 text-[11px] leading-snug text-ink3" data-testid="catatan-biaya">Ini perkiraan tim untuk kasus ini, bukan pengeluaran sebenarnya. Pengeluaran aktual dicatat Finance secara terpisah.</p>
                    </div>
                    {kotor && (
                      <button type="button" onClick={simpanField} disabled={busy} data-testid="simpan-rincian" className="flex min-h-11 items-center gap-1.5 rounded-btn bg-accent px-3 py-2 text-[12.5px] font-bold text-white disabled:opacity-50 sm:min-h-9"><Save size={13} aria-hidden="true" /> Simpan perubahan</button>
                    )}
                  </Lipat>
                ) : (
                  <div className="space-y-2.5 rounded-xl border border-line p-3" data-testid="mode-baca">
                    <Baris label="Penyebab masalah">{kase.rootCause || <span className="text-ink3">Tidak dicatat</span>}</Baris>
                    <Baris label="Solusi yang disepakati">{kase.resolution || <span className="text-ink3">Tidak dicatat</span>}</Baris>
                    <Baris label="Perkiraan biaya penanganan">{biayaTeks}<span className="block text-[11px] text-ink3">Perkiraan tim, bukan pengeluaran aktual Finance.</span></Baris>
                  </div>
                )}

                {tutup ? (
                  <>
                    <button type="button" onClick={() => setBukaDetail(!bukaDetail)} aria-expanded={bukaDetail} data-testid="lihat-detail" className="flex w-full items-center justify-center gap-1.5 rounded-btn bg-inset px-3 py-2.5 text-[12.5px] font-semibold text-ink2 hover:bg-hovertint">
                      {bukaDetail ? "Sembunyikan detail" : "Lihat detail & linimasa"} <ChevronDown size={14} className={cn("transition-transform", bukaDetail && "rotate-180")} aria-hidden="true" />
                    </button>
                    {bukaDetail && (
                      <div className="space-y-3" data-testid="detail-tutup">
                        {adaTertaut && <div className="rounded-xl bg-inset/60 p-3"><p className="mb-1.5 text-[12px] font-semibold text-ink">Yang sudah dijalankan</p><Tertaut /></div>}
                        <div className="rounded-xl bg-inset/60 py-1"><p className="px-4 pt-2 text-[12px] font-semibold text-ink">Linimasa</p><ActivityTimeline events={activity} formatSentence={formatComplaintActivitySentence} /></div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {adaTertaut && <section className="rounded-xl bg-inset/60 p-3" data-testid="bagian-tertaut"><p className="mb-1.5 text-[12.5px] font-semibold text-ink">Yang sudah dijalankan</p><Tertaut /></section>}
                    <Lipat judul={`Linimasa (${activity.length})`} testid="bagian-linimasa" terbuka={bukaLinimasa} onToggle={() => setBukaLinimasa(!bukaLinimasa)} ringkas="Riwayat perubahan dan aktivitas kasus">
                      <div className="-mx-3"><ActivityTimeline events={activity} formatSentence={formatComplaintActivitySentence} /></div>
                    </Lipat>
                  </>
                )}
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
