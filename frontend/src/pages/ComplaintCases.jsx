import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Clock, Loader2, ArrowRight } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Card } from "@/components/ui/card.jsx";
import { FilterDropdown } from "@/components/ui/filter-dropdown.jsx";
import { SearchInput } from "@/components/ui/search-input.jsx";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.jsx";
import { cn } from "@/lib/utils.js";
import { formatTanggal, formatTanggalPendek, hariSejak } from "@/utils/formatDate.js";
import ComplaintCaseDrawer from "@/features/complaints/ComplaintCaseDrawer.jsx";
import { StepperMini } from "@/features/complaints/ComplaintStepper.jsx";
import { CATEGORY_LABEL, SEVERITY_LABEL, SEVERITY_TONE, OWNER_LABEL } from "@/features/complaints/complaintLabels.js";
import { TAHAP, aksiUtama, ringkasTahap, hitungTahap, statusUntukTahap, labelJumlah, ringkasanKeluhan, kasusTutup } from "@/features/complaints/complaintFlow.js";

// Papan Kasus Komplain lintas divisi. Redesign Okt 2026: tim langsung paham keluhan, PIC, progres (4 tahap), dan langkah berikutnya; Aktif dan Riwayat dipisah; daftar tidak lagi
// dipotong diam-diam pada 300 kasus — halaman 30 kasus + "Muat lagi" dengan jumlah hasil yang jelas (total dari server). Status rinci, transisi, izin, dan audit tetap di backend.
const UKURAN_HALAMAN = 30;
const OWNER_OPTIONS = Object.keys(OWNER_LABEL).map((o) => ({ value: o, label: OWNER_LABEL[o] }));
const HASIL_OPTIONS = [{ value: "SELESAI", label: "Selesai" }, { value: "DIBATALKAN", label: "Dibatalkan" }];

function useTertunda(nilai, ms = 350) {
  const [v, setV] = useState(nilai);
  useEffect(() => { const t = setTimeout(() => setV(nilai), ms); return () => clearTimeout(t); }, [nilai, ms]);
  return v;
}

function CaseCard({ c, onOpen }) {
  const tutup = kasusTutup(c);
  const t = ringkasTahap(c);
  const utama = tutup ? null : aksiUtama(c);
  const telat = !tutup && c.targetCompletionAt ? hariSejak(c.targetCompletionAt) : null;
  const lewat = telat != null && Number.isFinite(telat) && telat > 0;
  return (
    <Card className="cursor-pointer p-4 transition-colors hover:bg-hovertint" onClick={onOpen} data-testid="kartu-komplain">
      <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} className="sr-only">Buka kasus {c.caseNumber}</button>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-[12.5px] font-semibold text-ink">{c.caseNumber}</span>
            <span className="text-[12px] text-ink3">{CATEGORY_LABEL[c.category] || c.category}</span>
          </div>
          <p className="mt-1 truncate text-[14px] font-semibold text-ink">
            {c.order?.customer?.name || "—"}
            <span className="font-normal text-ink3"> · {c.order?.orderNumber}</span>
            {c.unit && <span className="font-normal text-ink3"> · {c.unit.unitCode}</span>}
          </p>
        </div>
        {!tutup ? <Badge variant={SEVERITY_TONE[c.severity]} className="shrink-0">{SEVERITY_LABEL[c.severity] || c.severity}</Badge>
          : <Badge variant={c.status === "SELESAI" ? "green" : "neutral"} className="shrink-0">{t.label}</Badge>}
      </div>

      {c.description && <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink2">{ringkasanKeluhan(c, 160)}</p>}

      {tutup ? (
        <div className="mt-3 space-y-1 border-t border-line pt-2.5 text-[12px] text-ink3">
          {c.resolution && <p className="line-clamp-1"><span className="font-medium text-ink2">Solusi:</span> {c.resolution}</p>}
          <p>{c.status === "SELESAI" && c.customerConfirmedAt ? `Selesai ${formatTanggal(c.customerConfirmedAt)}` : `Dibuka ${formatTanggal(c.createdAt)}`}</p>
        </div>
      ) : (
        <div className="mt-3 space-y-2 border-t border-line pt-2.5">
          <StepperMini tahap={t.no} tertahan={t.tertahan} />
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12px]">
            <span className="text-ink2">Dipegang <span className="font-semibold text-ink">{OWNER_LABEL[c.currentOwner] || c.currentOwner}</span>{t.tertahan && <span className="ml-1.5 text-orange">· {t.keadaan}</span>}</span>
            {c.targetCompletionAt && (
              <span className={cn("flex items-center gap-1", lewat ? "font-semibold text-red" : "text-ink3")}><Clock size={12} aria-hidden="true" />{lewat ? `Lewat target ${telat} hari` : `Target ${formatTanggalPendek(c.targetCompletionAt)}`}</span>
            )}
          </div>
          {utama && <p className="flex items-start gap-1.5 text-[12px] text-ink2" data-testid="berikutnya"><ArrowRight size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" /><span><span className="text-ink3">Berikutnya:</span> <span className="font-medium text-ink">{utama.label}</span></span></p>}
        </div>
      )}
    </Card>
  );
}

// `scope` (hub Komplain & Revisi Produksi): "aktif" | "riwayat" → satu daftar saja. Kosong (halaman /komplain lintas divisi) → tab Aktif | Riwayat.
export default function ComplaintCases({ scope = "" } = {}) {
  const [tab, setTab] = useState(scope || "aktif");
  useEffect(() => { if (scope) setTab(scope); }, [scope]);
  const [tahap, setTahap] = useState(null); // 1..4 (hanya Aktif)
  const [hasil, setHasil] = useState(""); // SELESAI | DIBATALKAN (hanya Riwayat)
  const [owner, setOwner] = useState("");
  const [q, setQ] = useState(""); const qTunda = useTertunda(q.trim());
  const [cases, setCases] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [memuatLagi, setMemuatLagi] = useState(false);
  const [error, setError] = useState("");
  const [ringkasan, setRingkasan] = useState(null);
  const [openId, setOpenId] = useState(null);
  const nomor = useRef(0); // penjaga balapan: hanya permintaan terbaru yang dipakai

  const statusFilter = tab === "aktif" ? (tahap ? statusUntukTahap(tahap).join(",") : undefined) : (hasil || undefined);
  const param = useCallback((offset, limit) => ({ scope: tab, statuses: statusFilter, currentOwner: owner || undefined, q: qTunda || undefined, limit, offset }), [tab, statusFilter, owner, qTunda]);

  const muat = useCallback((jaga = false) => {
    const no = ++nomor.current; setLoading(true); setError("");
    const limit = jaga ? Math.max(UKURAN_HALAMAN, Math.min(300, cases.length)) : UKURAN_HALAMAN;
    api.getComplaintCases(param(0, limit))
      .then((d) => { if (no !== nomor.current) return; setCases(d.cases || []); setTotal(d.total ?? (d.cases || []).length); setHasMore(!!d.hasMore); })
      .catch((e) => { if (no === nomor.current) setError(e.message); })
      .finally(() => { if (no === nomor.current) setLoading(false); });
  }, [param, cases.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const muatRingkasan = useCallback(() => {
    api.getComplaintSummary({ currentOwner: owner || undefined }).then(setRingkasan).catch(() => setRingkasan(null));
  }, [owner]);

  // Filter berubah → mulai dari halaman pertama.
  useEffect(() => { muat(false); }, [tab, statusFilter, owner, qTunda]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { muatRingkasan(); }, [muatRingkasan]);

  const lagi = () => {
    const no = ++nomor.current; setMemuatLagi(true); setError("");
    api.getComplaintCases(param(cases.length, UKURAN_HALAMAN))
      .then((d) => { if (no !== nomor.current) return; setCases((lama) => { const ada = new Set(lama.map((x) => x.id)); return [...lama, ...(d.cases || []).filter((x) => !ada.has(x.id))]; }); setTotal(d.total ?? total); setHasMore(!!d.hasMore); })
      .catch((e) => { if (no === nomor.current) setError(e.message); })
      .finally(() => { if (no === nomor.current) setMemuatLagi(false); });
  };
  const setelahBerubah = () => { muat(true); muatRingkasan(); };
  const gantiTab = (t) => { setTab(t); setTahap(null); setHasil(""); };
  const adaFilter = !!(tahap || hasil || owner || qTunda);
  const bersihkan = () => { setTahap(null); setHasil(""); setOwner(""); setQ(""); };

  const perTahap = useMemo(() => hitungTahap(ringkasan?.perStatus), [ringkasan]);
  const judul = scope === "riwayat" ? "Riwayat Komplain" : scope === "aktif" ? "Kasus Komplain Aktif" : "Kasus Komplain";

  return (
    <PageContainer>
      <PageHeader title={judul} subtitle="Komplain pelanggan lintas divisi: Sales, Produksi, QC, Warehouse, dan Delivery." />
      <PageBody>
        {!scope && (
          <Tabs value={tab} onValueChange={gantiTab}>
            <TabsList aria-label="Aktif atau Riwayat">
              <TabsTrigger value="aktif" data-testid="tab-aktif">Aktif{ringkasan ? ` (${ringkasan.aktif})` : ""}</TabsTrigger>
              <TabsTrigger value="riwayat" data-testid="tab-riwayat">Riwayat{ringkasan ? ` (${ringkasan.riwayat})` : ""}</TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {tab === "aktif" && (
          <div className="space-y-2.5" data-testid="ringkasan-tahap">
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              {TAHAP.map((t) => (
                <button key={t.no} type="button" onClick={() => setTahap(tahap === t.no ? null : t.no)} aria-pressed={tahap === t.no} data-testid={`filter-tahap-${t.no}`}
                  className={cn("rounded-xl p-3 text-left transition-colors", tahap === t.no ? "bg-accentbg ring-2 ring-accent/40" : "bg-surface hover:bg-hovertint")}>
                  <p className="text-[20px] font-bold leading-none text-ink">{ringkasan ? perTahap[t.no] : "–"}</p>
                  <p className="mt-1.5 text-[12px] font-semibold text-ink">{t.no}. {t.label}</p>
                  <p className="mt-0.5 hidden text-[11px] leading-snug text-ink3 sm:block">{t.tanya}</p>
                </button>
              ))}
            </div>
            {ringkasan && (ringkasan.lewatTarget > 0 || ringkasan.prioritas > 0) && (
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink2" data-testid="peringatan">
                {ringkasan.lewatTarget > 0 && <span className="flex items-center gap-1 font-medium text-red"><Clock size={12} aria-hidden="true" /> {ringkasan.lewatTarget} kasus lewat target</span>}
                {ringkasan.prioritas > 0 && <span className="flex items-center gap-1 font-medium text-orange"><AlertTriangle size={12} aria-hidden="true" /> {ringkasan.prioritas} kasus prioritas tinggi/kritis</span>}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")} placeholder="Cari nomor, pelanggan, keluhan" className="w-full sm:w-80" aria-label="Cari komplain" />
          <FilterDropdown value={owner} onChange={setOwner} options={OWNER_OPTIONS} placeholder="Semua divisi pemegang" ariaLabel="Filter divisi pemegang" />
          {tab === "riwayat" && <FilterDropdown value={hasil} onChange={setHasil} options={HASIL_OPTIONS} placeholder="Semua hasil" ariaLabel="Filter hasil" />}
          {adaFilter && <button type="button" onClick={bersihkan} className="text-[12.5px] font-semibold text-accent hover:underline" data-testid="bersihkan-filter">Bersihkan filter</button>}
        </div>

        {error && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">
            <span>{error}</span><button type="button" onClick={() => muat(false)} className="font-semibold underline">Coba lagi</button>
          </div>
        )}

        {!error && (
          <p className="text-[12.5px] text-ink3" aria-live="polite" data-testid="jumlah-hasil">
            {loading && cases.length === 0 ? "Memuat…" : labelJumlah({ tampil: cases.length, total })}{adaFilter && !loading ? " (sesuai filter)" : ""}
          </p>
        )}

        {!loading && !error && cases.length === 0 && (
          <EmptyState icon={AlertTriangle}
            title={adaFilter ? "Tidak ada kasus yang cocok" : tab === "riwayat" ? "Belum ada riwayat komplain" : "Tidak ada komplain aktif"}
            description={adaFilter ? "Coba ubah atau bersihkan filter pencarian." : tab === "riwayat" ? "Kasus yang selesai atau dibatalkan akan tampil di sini." : "Kasus baru dibuka Sales dari Detail Order (tombol '+ Buka Kasus')."} />
        )}

        {cases.length > 0 && (
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2" data-testid="daftar-komplain">
            {cases.map((c) => <CaseCard key={c.id} c={c} onOpen={() => setOpenId(c.id)} />)}
          </div>
        )}

        {hasMore && (
          <div className="flex flex-col items-center gap-1.5 pb-4 pt-1">
            <button type="button" onClick={lagi} disabled={memuatLagi} data-testid="muat-lagi"
              className="flex min-h-11 items-center gap-2 rounded-btn bg-accentbg px-5 py-2 text-[13px] font-semibold text-accent hover:bg-accent/20 disabled:opacity-60">
              {memuatLagi && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}Muat lagi ({Math.max(0, total - cases.length).toLocaleString("id-ID")} kasus tersisa)
            </button>
          </div>
        )}
      </PageBody>

      <ComplaintCaseDrawer open={!!openId} caseId={openId} onClose={() => setOpenId(null)} onChanged={setelahBerubah} />
    </PageContainer>
  );
}
