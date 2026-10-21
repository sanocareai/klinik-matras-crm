import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTabs } from "@/lib/TabsContext.jsx";
import { ClipboardList, LayoutGrid, List, RefreshCw } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Card } from "@/components/ui/card.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { rolesOf } from "@/lib/roles.js";
import { friendlyError, wibDate } from "@/features/production/experience.js";
import MorningPriorityApprovalPanel from "@/features/production/MorningPriorityApprovalPanel.jsx";
import StatusWorkList from "@/features/production/workspace/StatusWorkList.jsx";
import PipelineGrouped from "@/features/production/workspace/PipelineGrouped.jsx";
import { JENIS_STATUS } from "@/features/production/workspace/StatusMarkers.jsx";
import { LIST_PATH, bacaGulir, bacaKeadaan, hapusGulir, jalurUnit, kelompokkanPipeline, simpanGulir, tulisKeadaan } from "@/features/production/workspace/workListModel.js";
import "@/features/production/workspace/workspace.css";

// STATUS PRODUKSI — ruang kerja harian Admin. Tampilan awal = Daftar kerja (satu baris per order, dibuka seperti dropdown card); Pipeline = tampilan pilihan (tahap dikelompokkan);
// klik unit mana pun membuka Ruang Kerja Unit yang SAMA (menggantikan modal panjang). Seluruh keadaan (tampilan, pencarian, filter, urutan, order terbuka, unit & bagian) ada di URL,
// posisi gulir disimpan di sessionStorage → tahan refresh dan tombol kembali. URL tetap /bengkel/production-v2 (deep link lama ?unit=<id> kini membuka Ruang Kerja Unit).

const user = (() => { try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; } })();
const canRoute = rolesOf(user).some((r) => ["ADMIN", "OWNER", "PRODUCTION_LEAD"].includes(r));

function cariPenggulir(mulai) {
  for (let el = mulai; el && el !== document.body; el = el.parentElement) {
    const o = getComputedStyle(el).overflowY;
    if ((o === "auto" || o === "scroll") && el.scrollHeight > el.clientHeight + 1) return el;
  }
  return document.querySelector(".page-body") || document.scrollingElement;
}
const tanda = (k) => tulisKeadaan({ ...k, unit: null, bagian: "ringkasan" }).toString();

function ArtiStatus() {
  const baris = [
    ["order", "Status order di Sales (Pengambilan, Diproses, Siap Kirim, Terkirim). Dikelola Sales/Delivery."],
    ["posisi", "Di mana unit fisik sekarang, menurut dokumen jemput, terima, dan kirim."],
    ["kerja", "Pekerjaan Produksi: dicatat Admin atau dari aplikasi Meja. Mencatat ini tidak mengubah status order."],
    ["meja", "Tahap di aplikasi Meja — hanya ada bila unit sudah dijadwalkan di Rencana Produksi."],
  ];
  return (
    <details className="rounded-card border border-line bg-surface px-4 py-2" data-testid="arti-status">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center text-[13px] font-medium text-ink2 outline-none focus-visible:ring-2 focus-visible:ring-accent/40">Arti empat status (tidak saling menggantikan)</summary>
      <dl className="m-0 grid gap-2 pb-2 pt-1 md:grid-cols-2">
        {baris.map(([j, t]) => <div key={j} className="min-w-0"><dt className="m-0 text-[12.5px] font-semibold text-ink">{JENIS_STATUS[j].label}</dt><dd className="m-0 text-[12.5px] text-ink3">{t}</dd></div>)}
      </dl>
    </details>
  );
}

export default function ProductionStatusPage() {
  // Shell bertab menyimpan lokasi tiap tab sendiri (tab.path): perubahan query harus lewat replaceActivePath, BUKAN setSearchParams (tidak memicu render ulang halaman).
  const [sp] = useSearchParams(); const { replaceActivePath, openInActiveTab } = useTabs();
  const keadaan = useMemo(() => bacaKeadaan(sp), [sp]);
  const ubah = useCallback((patch) => {
    const berikut = tulisKeadaan({ ...bacaKeadaan(sp), ...patch, unit: null }).toString();
    replaceActivePath(`${LIST_PATH}${berikut ? `?${berikut}` : ""}`);
  }, [sp, replaceActivePath]);
  // Tautan lama ?unit=<id> membuka Ruang Kerja Unit.
  useEffect(() => { const lama = sp.get("unit"); if (lama) replaceActivePath(jalurUnit(lama, sp.get("bagian") || "ringkasan")); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [notice, setNotice] = useState(""); const [error, setError] = useState("");
  const penggulirRef = useRef(null); const wadahRef = useRef(null); const sudahPulih = useRef(false);

  // ── pemulihan gulir ──
  const pulihkan = useCallback(() => {
    if (sudahPulih.current) return; const g = bacaGulir(); if (!g || g.tanda !== tanda(keadaan)) { sudahPulih.current = true; return; }
    sudahPulih.current = true; const el = penggulirRef.current ?? cariPenggulir(wadahRef.current);
    requestAnimationFrame(() => requestAnimationFrame(() => { if (el) el.scrollTop = g.y; }));
  }, [keadaan]);
  useEffect(() => { penggulirRef.current = cariPenggulir(wadahRef.current); });
  useEffect(() => { // simpan gulir saat daftar tampil (tahan refresh)
    const el = penggulirRef.current ?? cariPenggulir(wadahRef.current); if (!el) return undefined;
    let t = null; const onScroll = () => { clearTimeout(t); t = setTimeout(() => simpanGulir({ y: el.scrollTop, tanda: tanda(keadaan) }), 150); };
    el.addEventListener("scroll", onScroll, { passive: true }); return () => { clearTimeout(t); el.removeEventListener("scroll", onScroll); };
  }, [keadaan.tampilan, keadaan.scope, keadaan.q, keadaan.filter, keadaan.sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const bukaUnit = useCallback((unitId, bagian = "ringkasan") => {
    const el = penggulirRef.current ?? cariPenggulir(wadahRef.current); if (el) simpanGulir({ y: el.scrollTop, tanda: tanda(keadaan) });
    openInActiveTab(jalurUnit(unitId, bagian), { title: "Ruang Kerja Unit" }); // pindah rute (bukan sekadar query) agar tombol Kembali browser bekerja
  }, [keadaan, openInActiveTab]);
  const gantiTampilan = (t) => { hapusGulir(); sudahPulih.current = true; ubah({ tampilan: t, buka: null }); };

  // ── pipeline ──
  const [cc, setCc] = useState(null); const [belumMeja, setBelumMeja] = useState({ items: [], total: 0 }); const [pipeMemuat, setPipeMemuat] = useState(false);
  const [arrivalBusy, setArrivalBusy] = useState(false);
  const muatPipeline = useCallback(async () => {
    setPipeMemuat(true); setError("");
    try {
      const [c, w] = await Promise.all([api.getProductionV2CommandCenter().catch(() => null), api.getProductionWorkList({ scope: "aktif", sort: "PERHATIAN", pageSize: 100 })]);
      setCc(c);
      const items = [];
      for (const o of w.orders) for (const u of o.units) if (u.status !== "DELIVERED" && u.status !== "CANCELLED" && !u.alurMeja) items.push({ ...u, pelanggan: o.pelanggan.nama || "Tanpa nama", orderNumber: o.orderNumber });
      setBelumMeja({ items: items.slice(0, 40), total: items.length });
    } catch (e) { setError(friendlyError(e)); } finally { setPipeMemuat(false); }
  }, []);
  useEffect(() => { if (keadaan.tampilan === "pipeline" && !keadaan.unit) muatPipeline(); }, [keadaan.tampilan, keadaan.unit, muatPipeline]);
  const kelompok = useMemo(() => kelompokkanPipeline(cc?.columns || [], belumMeja.items), [cc, belumMeja]);
  const terimaUnit = async (item) => {
    if (arrivalBusy) return; setArrivalBusy(true); setError("");
    try { await api.confirmProductionV2UnitArrival(item.unit.id, {}); setNotice(`${item.unit.unitCode} tercatat tiba di workshop.`); await muatPipeline(); }
    catch (e) { setError(e.code === "WORKSHOP_DEFAULT_LOCATION_NOT_CONFIGURED" || e.code === "WORKSHOP_DEFAULT_LOCATION_INVALID" ? e.message : friendlyError(e)); } finally { setArrivalBusy(false); }
  };
  useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(t); }, [notice]);

  return (
    <PageContainer fluid>
      <div ref={wadahRef}>
        <PageHeader title="Status Produksi" subtitle="Apa yang perlu ditindak hari ini, di mana unitnya, dan siapa yang mengerjakan. Buka satu order untuk tindakan cepat; buka unit untuk ruang kerjanya."
          actions={
            <div role="tablist" aria-label="Tampilan" className="flex rounded-btn bg-inset p-0.5">
              {[["daftar", "Daftar kerja", List], ["pipeline", "Pipeline", LayoutGrid]].map(([k, l, Icon]) => (
                <button key={k} type="button" role="tab" aria-selected={keadaan.tampilan === k} data-testid={`tampilan-${k}`} onClick={() => gantiTampilan(k)}
                  className={`flex min-h-[44px] items-center gap-1.5 rounded-btn px-3.5 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${keadaan.tampilan === k ? "bg-surface text-accent shadow-sm" : "text-ink3"}`}><Icon size={14} aria-hidden /> {l}</button>
              ))}
            </div>
          } />
        <PageBody>
          {notice && <div role="status" className="rounded-btn bg-greenbg px-3 py-2.5 text-[12.5px] text-green">{notice}</div>}
          {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}
          {canRoute && <MorningPriorityApprovalPanel />}
          <ArtiStatus />
          {keadaan.tampilan === "daftar" ? (
            <StatusWorkList keadaan={keadaan} onUbah={ubah} onBukaUnit={bukaUnit} onMuat={pulihkan} />
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-ink3">
                <span data-testid="pipeline-total"><b className="text-ink">{kelompok.jumlah}</b> unit di jalur</span>
                <Button type="button" variant="neutral" size="sm" className="ml-auto min-h-[44px]" onClick={muatPipeline} disabled={pipeMemuat}><RefreshCw size={14} className={pipeMemuat ? "animate-spin motion-reduce:animate-none" : ""} aria-hidden /> Muat ulang</Button>
              </div>
              {pipeMemuat && !cc && !belumMeja.total ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((n) => <Card key={n} className="h-60 animate-pulse bg-inset motion-reduce:animate-none" />)}</div>
                : <PipelineGrouped kelompok={kelompok} today={wibDate(0)} tomorrow={wibDate(1)} onBuka={(id) => bukaUnit(id)} onTerima={terimaUnit} belumMejaTotal={belumMeja.total} onKeDaftar={() => gantiTampilan("daftar")} />}
              {cc?.readerMode === "OFF" && kelompok.jumlah === 0 && <Card className="p-0"><EmptyState icon={ClipboardList} title="Alur Meja belum aktif" description="Unit tetap bisa dikerjakan lewat Daftar kerja." /></Card>}
            </div>
          )}
        </PageBody>
      </div>
    </PageContainer>
  );
}

