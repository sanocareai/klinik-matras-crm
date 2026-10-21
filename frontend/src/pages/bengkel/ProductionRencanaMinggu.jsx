import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { useTabs } from "@/lib/TabsContext.jsx";
import { CalendarDays, ChevronLeft, ChevronRight, LayoutGrid, ListChecks, RefreshCw, Undo2 } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { friendlyError } from "@/features/production/experience.js";
import RencanaExportButton from "@/features/production/RencanaExportButton.jsx";
import { jalurUnit } from "@/features/production/workspace/workListModel.js";
import useRencanaMinggu from "@/features/production/rencana/useRencanaMinggu.js";
import { DayPanel, WeekStrip } from "@/features/production/rencana/RencanaKalender.jsx";
import "@/features/production/rencana/rencana.css";
import MenuHalaman from "@/features/production/rencana/MenuHalaman.jsx";
import RencanaAntrean from "@/features/production/rencana/RencanaAntrean.jsx";
import JadwalModal from "@/features/production/rencana/JadwalModal.jsx";
import AktivasiV2Modal from "@/features/production/rencana/AktivasiV2Modal.jsx";
import { bacaUrl, keputusanLepas, labelHari, labelMinggu, labelTanggal, pesanGagalJadwal, shiftKey, slotBawaan, todayWib, tulisUrl } from "@/features/production/rencana/rencanaModel.js";

// RENCANA PRODUKSI — jadwal mingguan yang ringkas. Admin menyusun tanggal/meja/target TANPA mengaktifkan Produksi V2 (Rencana Admin: tidak membuka Run, tahap, QC, penerimaan, pemakaian bahan,
// stok, atau pesan). Rencana Admin dan Pelaksanaan Meja tampil pada kalender yang sama dengan label dan dampak berbeda. Aktivasi V2 = konfirmasi terpisah (menu kartu).
// Keadaan (minggu, hari, tab, pencarian, urutan) ada di URL: tahan refresh dan tombol kembali. Papan V2 lama (PIC, Corner, BOM, reservasi) tetap tersedia di /bengkel/rencana-produksi/papan-v2.

// Layar sempit (< 1024 px): kepala ringkas + menu tambahan. Memakai matchMedia agar hanya SATU kalender yang dirender (tidak ada elemen ganda).
function useSempit() {
  const q = "(max-width: 1023px)"; const [v, setV] = useState(() => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(q).matches : false));
  useEffect(() => { if (!window.matchMedia) return undefined; const m = window.matchMedia(q); const f = () => setV(m.matches); f(); m.addEventListener?.("change", f); return () => m.removeEventListener?.("change", f); }, []);
  return v;
}
const RUTE = "/bengkel/rencana-produksi";
const PAPAN_V2 = "/bengkel/rencana-produksi/papan-v2";
const revisiOf = (it) => it.revisi ?? it.jadwal?.revisi ?? it.revisiJadwal ?? 0;

export default function ProductionRencanaMinggu() {
  // Shell bertab menyimpan lokasi tiap tab sendiri: perubahan query harus lewat replaceActivePath (BUKAN setSearchParams, yang tidak memicu render ulang halaman).
  const [params] = useSearchParams(); const { replaceActivePath, openInActiveTab } = useTabs();
  const today = todayWib();
  const url = useMemo(() => bacaUrl(params.toString(), { today }), [params, today]);
  const { start, hari, tab, q, sort } = url;
  const data = useRencanaMinggu({ start, hari, tab, q, sort });
  const { minggu, dayData, antrean, loading, error, setError, reloadAll } = data;
  const izin = minggu?.izin || antrean?.izin || dayData?.izin || {};
  const [modal, setModal] = useState(null); const [pesan, setPesan] = useState(null); const [undo, setUndo] = useState(null); const [drag, setDrag] = useState(null);
  const sempit = useSempit();
  const [panel, setPanel] = useState("hari"); // layar sempit: antrean | hari
  const pesanTimer = useRef(null);

  const ubahUrl = useCallback((patch) => { replaceActivePath(`${RUTE}${tulisUrl({ ...url, ...patch }, { today })}`); }, [url, replaceActivePath, today]);
  const tampilPesan = useCallback((teks, { undoInfo = null, tone = "ok" } = {}) => {
    clearTimeout(pesanTimer.current); setPesan({ teks, tone }); setUndo(undoInfo);
    pesanTimer.current = setTimeout(() => { setPesan(null); setUndo(null); }, tone === "ok" ? 15000 : 9000);
  }, []);
  useEffect(() => () => clearTimeout(pesanTimer.current), []);

  const bukaPapan = (mode) => openInActiveTab(`${PAPAN_V2}?date=${hari}${mode === "corner" ? "&tampilan=corner" : ""}`, { title: mode === "corner" ? "Corner" : "Papan Meja" });
  const bukaUnit = (it) => openInActiveTab(jalurUnit(it.unitId), { title: "Ruang Kerja Unit" }); // pindah rute agar tombol Kembali browser bekerja
  function onAksi(kind, it) {
    if (kind === "BUKA") return bukaUnit(it);
    if (kind === "JADWALKAN" || kind === "PINDAH" || kind === "RIWAYAT") return setModal({ jenis: "jadwal", item: it });
    if (kind === "KEPUTUSAN") { ubahUrl({ tab: "KEPUTUSAN" }); return undefined; }
    if (kind === "AKTIVASI") return setModal({ jenis: "aktivasi", item: it });
    if (kind === "PAPAN_V2") return openInActiveTab(`${PAPAN_V2}?date=${it.tanggal || hari}`, { title: "Papan Meja" });
    if (kind === "KELUARKAN") return keluarkan(it);
    return undefined;
  }
  async function keluarkan(it) {
    try {
      const r = await api.keluarkanJadwalUnit(it.unitId, { expectedRevision: revisiOf(it) });
      tampilPesan(`${it.unitCode} dikeluarkan dari jadwal.`, { undoInfo: { unitId: it.unitId, eventId: r.eventId, kode: it.unitCode } }); reloadAll();
    } catch (e) { tampilPesan(pesanGagalJadwal(e), { tone: "err" }); reloadAll(); }
  }
  const sesudahSimpan = ({ item, hasil, tanggal, meja, dikeluarkan, diurungkan }) => {
    setModal(null);
    if (dikeluarkan) tampilPesan(`${item.unitCode} dikeluarkan dari jadwal.`, { undoInfo: { unitId: item.unitId, eventId: hasil.eventId } });
    else if (diurungkan) tampilPesan(`Perubahan jadwal ${item.unitCode} diurungkan.`);
    else if (hasil.noChange) tampilPesan("Tidak ada perubahan.");
    else { tampilPesan(`${item.unitCode} dijadwalkan ${labelHari(tanggal)}${meja ? ` · Meja ${meja.replace("TABLE_", "")}` : ""}.`, { undoInfo: { unitId: item.unitId, eventId: hasil.eventId } }); if (tanggal && minggu && tanggal >= minggu.start && tanggal <= minggu.end) ubahUrl({ hari: tanggal }); }
    reloadAll();
  };
  async function urungkan() {
    if (!undo) return; const u = undo;
    try { await api.undoJadwalUnit(u.unitId, { eventId: u.eventId }); tampilPesan("Perubahan diurungkan."); } catch (e) { tampilPesan(pesanGagalJadwal(e), { tone: "err" }); } finally { reloadAll(); }
  }
  async function pindahLangsung(it, tanggal, meja) {
    try {
      const r = await api.jadwalkanUnit(it.unitId, { productionDate: tanggal, stationCode: meja || null, expectedRevision: revisiOf(it), expectedUnit: it.unitCas || undefined });
      tampilPesan(`${it.unitCode} dipindah ke ${labelHari(tanggal)}${meja ? ` · Meja ${meja.replace("TABLE_", "")}` : ""}.`, { undoInfo: { unitId: it.unitId, eventId: r.eventId } });
    } catch (e) { tampilPesan(pesanGagalJadwal(e), { tone: "err" }); } finally { reloadAll(); }
  }
  function lepasKeHari(tanggal) {
    const it = drag; setDrag(null); if (!it) return;
    const k = keputusanLepas({ item: it, targetDate: tanggal, minggu });
    if (k.aksi === "TOLAK") return tampilPesan(k.pesan, { tone: "err" });
    if (k.aksi === "PINDAH") return pindahLangsung(it, k.tanggal, k.meja);
    if (k.aksi === "FORMULIR") return setModal({ jenis: "jadwal", item: it, awal: { date: tanggal, station: "" } });
    return undefined;
  }
  function lepasKeMeja(code) {
    const it = drag; setDrag(null); if (!it) return;
    if (it.sumber === "V2" || it.jadwal?.sumber === "V2") return tampilPesan("Jadwal Pelaksanaan Meja diatur dari Papan Meja, bukan diseret di sini.", { tone: "err" });
    return pindahLangsung(it, hari, code);
  }

  const visibleRunIds = (dayData?.stations || []).flatMap((s) => s.items).map((i) => i.v2?.runId).filter(Boolean);
  const visibleUnitIds = [...(antrean?.items || []).map((i) => i.unitId), ...(dayData?.stations || []).flatMap((s) => s.items).map((i) => i.unitId)];

  return (
    <PageContainer fluid className={sempit ? "!p-3" : ""}>
      {sempit ? (
        <div data-testid="header-mobile">
          <div className="flex items-center justify-between gap-2">
            <h1 className="m-0 text-[18px] font-semibold text-ink">Rencana Produksi</h1>
            <MenuHalaman items={[
              { key: "muat", label: "Muat ulang", onClick: reloadAll },
              { key: "export", label: "Export Excel", onClick: () => document.querySelector("[data-testid=export-excel-open]")?.click() },
              { key: "papan", label: "Papan Meja (harian)", onClick: () => bukaPapan("meja") },
              { key: "corner", label: "Corner", onClick: () => bukaPapan("corner") },
            ]} />
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex items-center rounded-btn border border-line" role="group" aria-label="Pindah minggu">
              <Button variant="ghost" size="sm" className="min-h-[44px] min-w-[44px]" aria-label="Minggu sebelumnya" data-testid="minggu-sebelum" onClick={() => ubahUrl({ start: shiftKey(start, -7), hari: shiftKey(hari, -7) })}><ChevronLeft size={16} aria-hidden /></Button>
              <span className="px-1 text-[13px] font-medium text-ink" data-testid="minggu-label">{labelMinggu(start)}</span>
              <Button variant="ghost" size="sm" className="min-h-[44px] min-w-[44px]" aria-label="Minggu berikutnya" data-testid="minggu-sesudah" onClick={() => ubahUrl({ start: shiftKey(start, 7), hari: shiftKey(hari, 7) })}><ChevronRight size={16} aria-hidden /></Button>
            </div>
            <Button variant="neutral" size="sm" className="min-h-[44px]" data-testid="hari-ini" onClick={() => ubahUrl({ start: shiftKey(today, 0), hari: today })}>Hari ini</Button>
          </div>
          <div hidden><RencanaExportButton date={hari} stations={["TABLE_1", "TABLE_2", "TABLE_3", "TABLE_4"]} visibleRunIds={visibleRunIds} visibleUnitIds={visibleUnitIds} dateLabel={labelTanggal(hari)} /></div>
        </div>
      ) : (
        <PageHeader title="Rencana Produksi" subtitle={`Jadwal mingguan · ${labelMinggu(start)}`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-btn border border-line" role="group" aria-label="Pindah minggu">
                <Button variant="ghost" size="sm" className="min-h-[40px]" aria-label="Minggu sebelumnya" data-testid="minggu-sebelum" onClick={() => ubahUrl({ start: shiftKey(start, -7), hari: shiftKey(hari, -7) })}><ChevronLeft size={16} aria-hidden /></Button>
                <span className="px-2 text-[13px] font-medium text-ink" data-testid="minggu-label">{labelMinggu(start)}</span>
                <Button variant="ghost" size="sm" className="min-h-[40px]" aria-label="Minggu berikutnya" data-testid="minggu-sesudah" onClick={() => ubahUrl({ start: shiftKey(start, 7), hari: shiftKey(hari, 7) })}><ChevronRight size={16} aria-hidden /></Button>
              </div>
              <Button variant="neutral" size="sm" className="min-h-[40px]" data-testid="hari-ini" onClick={() => ubahUrl({ start: shiftKey(today, 0), hari: today })}>Hari ini</Button>
              <Button variant="neutral" size="sm" className="min-h-[40px]" onClick={reloadAll} aria-label="Muat ulang"><RefreshCw size={14} aria-hidden /> Muat ulang</Button>
              <RencanaExportButton date={hari} stations={["TABLE_1", "TABLE_2", "TABLE_3", "TABLE_4"]} visibleRunIds={visibleRunIds} visibleUnitIds={visibleUnitIds} dateLabel={labelTanggal(hari)} />
              <button type="button" className="inline-flex min-h-[40px] items-center rounded-btn px-3 text-[13px] text-accent hover:bg-accentbg" data-testid="link-papan-meja" onClick={() => bukaPapan("meja")}><LayoutGrid size={14} className="mr-1" aria-hidden /> Papan Meja</button>
              <button type="button" className="inline-flex min-h-[40px] items-center rounded-btn px-3 text-[13px] text-accent hover:bg-accentbg" data-testid="link-corner" onClick={() => bukaPapan("corner")}>Corner</button>
            </div>
          } />
      )}
      <PageBody>
        {error && <p role="alert" className="mb-3 rounded-btn bg-redbg px-3 py-2 text-[13px] text-red" data-testid="rencana-galat">{error} <button type="button" className="underline" onClick={() => { setError(""); reloadAll(); }}>Coba lagi</button></p>}
        {minggu && !sempit && <p className="m-0 mb-2 text-[13px] text-ink3" data-testid="ringkas-minggu">Minggu ini (Sen–Sab): <b className="text-ink">{minggu.ringkasan.terencanaKerja}</b> unit terencana dari {minggu.ringkasan.slotKerja} slot{minggu.ringkasan.diLuarHariKerja > 0 ? <span className="text-orange"> · +{minggu.ringkasan.diLuarHariKerja} di hari Minggu (libur, di luar hari kerja rutin)</span> : ""} · {minggu.ringkasan.perhatian ? <span className="text-orange">{minggu.ringkasan.perhatian} perlu perhatian</span> : "tidak ada yang perlu perhatian"}</p>}
        <div className={sempit ? "mt-2" : ""}><WeekStrip ringkas={sempit} minggu={minggu} hari={hari} onPilih={(d) => { ubahUrl({ hari: d }); setPanel("hari"); }} dragAktif={!!drag && !!izin.jadwalkan} onLepas={lepasKeHari} loading={loading.minggu} /></div>
        {sempit && <div className="mt-2"><div className="flex gap-1" role="tablist" aria-label="Tampilan">
          <button type="button" role="tab" aria-selected={panel === "antrean"} data-testid="panel-antrean" onClick={() => setPanel("antrean")} className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-btn text-[13px] font-medium ${panel === "antrean" ? "rc-tab-on bg-accent text-white" : "bg-inset text-ink2"}`}><ListChecks size={14} aria-hidden /> Antrean</button>
          <button type="button" role="tab" aria-selected={panel === "hari"} data-testid="panel-hari" onClick={() => setPanel("hari")} className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-btn text-[13px] font-medium ${panel === "hari" ? "rc-tab-on bg-accent text-white" : "bg-inset text-ink2"}`}><CalendarDays size={14} aria-hidden /> Hari {labelHari(hari)}</button>
        </div></div>}
        <div className="mt-3 grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(360px,440px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(400px,480px)_minmax(0,1fr)]">
          <div className={`${panel === "antrean" ? "block" : "hidden"} min-w-0 lg:block`}>
            <RencanaAntrean antrean={antrean} loading={loading.antrean} tab={tab} onTab={(t) => ubahUrl({ tab: t })} q={q} onQ={(v) => ubahUrl({ q: v })} sort={sort} onSort={(v) => ubahUrl({ sort: v })}
              izin={izin} onAksi={onAksi} onBuka={bukaUnit} onDragStart={setDrag} onDragEnd={() => setDrag(null)} onMuatLagi={data.muatHalamanBerikut} muatLagi={data.muatLagi} />
          </div>
          <div className={`${panel === "hari" ? "block" : "hidden"} min-w-0 lg:block`}>
            <DayPanel dayData={dayData} loading={loading.hari} izin={izin} onAksi={onAksi} onBuka={bukaUnit} draggingItem={drag} onDragStart={setDrag} onDragEnd={() => setDrag(null)} onLepasMeja={lepasKeMeja} />
          </div>
        </div>
      </PageBody>
      {pesan && createPortal(
        <div role="status" aria-live="polite" data-testid="rencana-pesan" className={`fixed bottom-4 left-1/2 z-[9999] flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-card border px-4 py-2.5 text-[13px] shadow-lg ${pesan.tone === "err" ? "border-red/40 bg-redbg text-red" : "border-line bg-surface text-ink"}`}>
          <span>{pesan.teks}</span>
          {undo && <Button size="sm" variant="neutral" className="min-h-[36px]" data-mutates onClick={urungkan} data-testid="undo-jadwal"><Undo2 size={14} className="mr-1" aria-hidden /> Urungkan</Button>}
          <button type="button" className="text-ink3 underline" onClick={() => { setPesan(null); setUndo(null); }} aria-label="Tutup pesan">Tutup</button>
        </div>, document.body)}
      {modal?.jenis === "jadwal" && <JadwalModal item={modal.item} minggu={minggu} awal={modal.awal} onClose={() => setModal(null)} onSaved={sesudahSimpan} onError={() => reloadAll()} />}
      {modal?.jenis === "aktivasi" && <AktivasiV2Modal item={modal.item} awal={modal.item.jadwal?.tanggal ? { date: modal.item.jadwal.tanggal, station: modal.item.jadwal.meja } : slotBawaan(minggu)} onClose={() => setModal(null)} onDone={({ item }) => { setModal(null); tampilPesan(`${item.unitCode} diaktifkan di Pelaksanaan Meja — Run dibuka dan jadwal Meja dibuat.`); reloadAll(); }} />}
    </PageContainer>
  );
}
