import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { useTabs } from "@/lib/TabsContext.jsx";
import { CalendarDays, ChevronLeft, ChevronRight, LayoutGrid, ListChecks, Loader2, RefreshCw, Undo2 } from "lucide-react";
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
import PilihMeja from "@/features/production/rencana/PilihMeja.jsx";
import { bacaUrl, keputusanLepas, keputusanLepasMeja, labelHari, labelMinggu, labelTanggal, mejaTeks, pesanGagalJadwal, shiftKey, slotBawaan, todayWib, tulisUrl } from "@/features/production/rencana/rencanaModel.js";

// RENCANA PRODUKSI — jadwal mingguan yang ringkas. Hari yang dipilih (bawaan: hari ini) = tanggal jadwal. Unit ditarik dari antrean LANGSUNG ke Meja 1–4 (atau "Pilih meja" untuk HP/keyboard) dan tersimpan sebagai
// jadwal Admin resmi TANPA modal tanggal/target/PIC/rencana bahan. Rencana Admin tidak membuka Run, tahap, QC, penerimaan, pemakaian bahan, stok, atau pesan; tidak menyatakan pekerjaan dilakukan.
// Rencana Admin dan Pelaksanaan Meja tampil pada kalender yang sama dengan label dan dampak berbeda. Aktivasi V2 = konfirmasi terpisah (menu kartu). Tiap simpan: indikator "Menyimpan…", hasil, dan Urungkan.
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
  const [pendingIds, setPendingIds] = useState(() => new Set()); const [seleksi, setSeleksi] = useState(() => new Map()); const [picker, setPicker] = useState(null);
  const sempit = useSempit();
  const [panel, setPanel] = useState("hari"); // layar sempit: antrean | hari
  const pesanTimer = useRef(null);

  const ubahUrl = useCallback((patch) => { replaceActivePath(`${RUTE}${tulisUrl({ ...url, ...patch }, { today })}`); }, [url, replaceActivePath, today]);
  const tampilPesan = useCallback((teks, { undoInfo = null, tone = "ok" } = {}) => {
    clearTimeout(pesanTimer.current); setPesan({ teks, tone }); setUndo(undoInfo);
    if (tone === "busy") return; // "Menyimpan…" diganti hasilnya; tidak hilang sendiri
    pesanTimer.current = setTimeout(() => { setPesan(null); setUndo(null); }, tone === "ok" ? 15000 : 9000);
  }, []);
  useEffect(() => () => clearTimeout(pesanTimer.current), []);
  const tandaiPending = (ids, on) => setPendingIds((p) => { const n = new Set(p); for (const id of ids) (on ? n.add(id) : n.delete(id)); return n; });

  const bukaPapan = (mode) => openInActiveTab(`${PAPAN_V2}?date=${hari}${mode === "corner" ? "&tampilan=corner" : ""}`, { title: mode === "corner" ? "Corner" : "Papan Meja" });
  const bukaUnit = (it) => openInActiveTab(jalurUnit(it.unitId), { title: "Ruang Kerja Unit" }); // pindah rute agar tombol Kembali browser bekerja
  const aktif = (it) => (seleksi.has(it.unitId) && seleksi.size > 1 ? [...seleksi.values()] : [it]); // kartu yang tercentang ikut bila ada beberapa
  function onAksi(kind, it, el) {
    if (kind === "BUKA") return bukaUnit(it);
    if (kind === "PILIH_MEJA") return setPicker({ items: aktif(it), anchor: el || null });
    if (kind === "ATUR" || kind === "RIWAYAT" || kind === "JADWALKAN" || kind === "PINDAH") return setModal({ jenis: "jadwal", item: it });
    if (kind === "KEPUTUSAN") { ubahUrl({ tab: "KEPUTUSAN" }); return undefined; }
    if (kind === "AKTIVASI") return setModal({ jenis: "aktivasi", item: it });
    if (kind === "PAPAN_V2") return openInActiveTab(`${PAPAN_V2}?date=${it.tanggal || hari}`, { title: "Papan Meja" });
    if (kind === "KELUARKAN") return keluarkan(it);
    return undefined;
  }
  async function keluarkan(it) {
    tandaiPending([it.unitId], true); tampilPesan(`Mengeluarkan ${it.unitCode} dari jadwal…`, { tone: "busy" });
    try {
      const r = await api.keluarkanJadwalUnit(it.unitId, { expectedRevision: revisiOf(it) });
      tampilPesan(`${it.unitCode} dikeluarkan dari jadwal.`, { undoInfo: { items: [{ unitId: it.unitId, eventId: r.eventId }] } });
    } catch (e) { tampilPesan(pesanGagalJadwal(e), { tone: "err" }); } finally { tandaiPending([it.unitId], false); reloadAll(); }
  }
  const sesudahSimpan = ({ item, hasil, tanggal, meja, dikeluarkan, diurungkan }) => {
    setModal(null);
    if (dikeluarkan) tampilPesan(`${item.unitCode} dikeluarkan dari jadwal.`, { undoInfo: { items: [{ unitId: item.unitId, eventId: hasil.eventId }] } });
    else if (diurungkan) tampilPesan(`Perubahan jadwal ${item.unitCode} diurungkan.`);
    else if (hasil.noChange) tampilPesan("Tidak ada perubahan.");
    else { tampilPesan(`${item.unitCode} dijadwalkan ${labelHari(tanggal)}${meja ? ` · ${mejaTeks(meja)}` : ""}.`, { undoInfo: { items: [{ unitId: item.unitId, eventId: hasil.eventId }] } }); if (tanggal && minggu && tanggal >= minggu.start && tanggal <= minggu.end) ubahUrl({ hari: tanggal }); }
    reloadAll();
  };
  // SATU jalur simpan untuk seret-lepas, "Pilih meja", dan penempatan beberapa unit: layanan jadwal yang sama dengan modal. Beberapa unit = satu permintaan, semua atau tidak sama sekali.
  async function simpan(items, tanggal, meja) {
    const ids = items.map((i) => i.unitId); const tujuan = `${labelHari(tanggal)}${meja && meja !== "AUTO" ? ` · ${mejaTeks(meja)}` : ""}`;
    tandaiPending(ids, true); tampilPesan(items.length === 1 ? `Menyimpan ${items[0].unitCode}…` : `Menyimpan ${items.length} unit…`, { tone: "busy" });
    try {
      if (items.length === 1) {
        const it = items[0];
        const r = await api.jadwalkanUnit(it.unitId, { productionDate: tanggal, stationCode: meja || null, expectedRevision: revisiOf(it), expectedUnit: it.unitCas || undefined });
        if (r.noChange) tampilPesan("Tidak ada perubahan."); else tampilPesan(`${it.unitCode} dijadwalkan ${tujuan}.`, { undoInfo: { items: [{ unitId: it.unitId, eventId: r.eventId }] } });
      } else {
        const r = await api.jadwalkanBatch({ productionDate: tanggal, stationCode: meja || null, units: items.map((i) => ({ unitId: i.unitId, expectedRevision: revisiOf(i), expectedUnit: i.unitCas || undefined })) });
        const berubah = r.hasil.filter((h) => h.eventId);
        tampilPesan(`${items.length} unit dijadwalkan ${labelHari(tanggal)} · ${mejaTeks(r.stationCode)}.`, berubah.length ? { undoInfo: { items: berubah.map((h) => ({ unitId: h.unitId, eventId: h.eventId })) } } : {});
      }
      setSeleksi((m) => { const n = new Map(m); for (const id of ids) n.delete(id); return n; });
      if (minggu && tanggal >= minggu.start && tanggal <= minggu.end && tanggal !== hari) ubahUrl({ hari: tanggal });
    } catch (e) {
      tampilPesan(pesanGagalJadwal(e), { tone: "err" });
    } finally { tandaiPending(ids, false); reloadAll(); }
  }
  async function urungkan() {
    if (!undo) return; const u = undo; tampilPesan("Mengurungkan…", { tone: "busy" });
    try {
      if (u.items.length === 1) await api.undoJadwalUnit(u.items[0].unitId, { eventId: u.items[0].eventId }); else await api.undoJadwalBatch({ items: u.items });
      tampilPesan("Perubahan diurungkan.");
    } catch (e) { tampilPesan(pesanGagalJadwal(e), { tone: "err" }); } finally { reloadAll(); }
  }
  const mulaiSeret = (it) => setDrag({ items: aktif(it) });
  function lepasKeHari(tanggal) {
    const g = drag; setDrag(null); if (!g) return;
    if (g.items.length > 1) { const k = keputusanLepasMeja({ items: g.items, date: tanggal, meja: null, minggu }); if (k.aksi === "TOLAK") return tampilPesan(k.pesan, { tone: "err" }); if (k.aksi === "SIMPAN") return simpan(k.items, k.tanggal, null); return undefined; }
    const it = g.items[0]; const k = keputusanLepas({ item: it, targetDate: tanggal, minggu });
    if (k.aksi === "TOLAK") return tampilPesan(k.pesan, { tone: "err" });
    if (k.aksi === "PINDAH") return simpan([it], k.tanggal, k.meja);
    return undefined;
  }
  function lepasKeMeja(code) { return pilihTujuan(drag?.items, hari, code, () => setDrag(null)); }
  function pilihTujuan(items, date, meja, selesai) {
    selesai?.(); if (!items?.length) return undefined;
    const k = keputusanLepasMeja({ items, date, meja: meja === "AUTO" ? null : meja, minggu });
    if (k.aksi === "TOLAK") return tampilPesan(k.pesan, { tone: "err" });
    if (k.aksi === "SIMPAN") return simpan(k.items, k.tanggal, meja === "AUTO" ? "AUTO" : k.meja);
    return undefined;
  }
  const toggle = (it) => setSeleksi((m) => { const n = new Map(m); if (n.has(it.unitId)) n.delete(it.unitId); else n.set(it.unitId, it); return n; });
  const pilihSemuaOrder = (it) => setSeleksi((m) => { const n = new Map(m); n.set(it.unitId, it); for (const u of it.saudaraSiap || []) n.set(u.unitId, { unitId: u.unitId, unitCode: u.unitCode, revisiJadwal: u.revisiJadwal, unitCas: u.unitCas, diterima: u.diterima, jadwal: null }); return n; });

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
        <p className="m-0 mt-2 text-[12.5px] text-ink3" data-testid="petunjuk-tanggal">Jadwal disimpan untuk <b className="text-ink">{labelTanggal(hari)}{hari === today ? " (hari ini)" : ""}</b>. {izin.jadwalkan ? "Seret unit ke Meja 1–4, atau tekan Pilih meja." : "Anda hanya dapat melihat jadwal."}</p>
        {sempit && <div className="mt-2"><div className="flex gap-1" role="tablist" aria-label="Tampilan">
          <button type="button" role="tab" aria-selected={panel === "antrean"} data-testid="panel-antrean" onClick={() => setPanel("antrean")} className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-btn text-[13px] font-medium ${panel === "antrean" ? "rc-tab-on bg-accent text-white" : "bg-inset text-ink2"}`}><ListChecks size={14} aria-hidden /> Antrean</button>
          <button type="button" role="tab" aria-selected={panel === "hari"} data-testid="panel-hari" onClick={() => setPanel("hari")} className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-btn text-[13px] font-medium ${panel === "hari" ? "rc-tab-on bg-accent text-white" : "bg-inset text-ink2"}`}><CalendarDays size={14} aria-hidden /> Hari {labelHari(hari)}</button>
        </div></div>}
        <div className="mt-3 grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(360px,440px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(400px,480px)_minmax(0,1fr)]">
          <div className={`${panel === "antrean" ? "block" : "hidden"} min-w-0 lg:block`}>
            {seleksi.size > 0 && izin.jadwalkan && (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-card border border-accent/50 bg-accentbg px-3 py-2" data-testid="seleksi-bar" role="region" aria-label="Unit dipilih">
                <span className="text-[13px] font-medium text-ink" data-testid="seleksi-jumlah">{seleksi.size} unit dipilih</span>
                <Button size="sm" className="rc-cta min-h-[40px]" data-testid="seleksi-pilih-meja" onClick={(e) => setPicker({ items: [...seleksi.values()], anchor: e.currentTarget })}>Pilih meja</Button>
                <Button size="sm" variant="neutral" className="min-h-[40px]" data-testid="seleksi-kosongkan" onClick={() => setSeleksi(new Map())}>Kosongkan pilihan</Button>
              </div>
            )}
            <RencanaAntrean antrean={antrean} loading={loading.antrean} tab={tab} onTab={(t) => ubahUrl({ tab: t })} q={q} onQ={(v) => ubahUrl({ q: v })} sort={sort} onSort={(v) => ubahUrl({ sort: v })}
              izin={izin} onAksi={onAksi} onBuka={bukaUnit} onDragStart={mulaiSeret} onDragEnd={() => setDrag(null)} onMuatLagi={data.muatHalamanBerikut} muatLagi={data.muatLagi}
              seleksi={new Set(seleksi.keys())} onToggle={toggle} onPilihSemuaOrder={pilihSemuaOrder} pendingIds={pendingIds} />
          </div>
          <div className={`${panel === "hari" ? "block" : "hidden"} min-w-0 lg:block`}>
            <DayPanel dayData={dayData} loading={loading.hari} izin={izin} onAksi={onAksi} onBuka={bukaUnit} draggingItem={drag} onDragStart={mulaiSeret} onDragEnd={() => setDrag(null)} onLepasMeja={lepasKeMeja} pendingIds={pendingIds} menyimpan={pendingIds.size > 0} />
          </div>
        </div>
      </PageBody>
      {pesan && createPortal(
        <div role="status" aria-live="polite" data-testid="rencana-pesan" data-tone={pesan.tone} className={`fixed bottom-4 left-1/2 z-[9999] flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-card border px-4 py-2.5 text-[13px] shadow-lg ${pesan.tone === "err" ? "border-red/40 bg-redbg text-red" : "border-line bg-surface text-ink"}`}>
          {pesan.tone === "busy" && <Loader2 size={14} className="animate-spin" aria-hidden />}
          <span>{pesan.teks}</span>
          {undo && <Button size="sm" variant="neutral" className="min-h-[36px]" data-mutates onClick={urungkan} data-testid="undo-jadwal"><Undo2 size={14} className="mr-1" aria-hidden /> Urungkan</Button>}
          {pesan.tone !== "busy" && <button type="button" className="text-ink3 underline" onClick={() => { setPesan(null); setUndo(null); }} aria-label="Tutup pesan">Tutup</button>}
        </div>, document.body)}
      {picker && <PilihMeja anchor={picker.anchor} items={picker.items} minggu={minggu} hari={hari} onClose={() => setPicker(null)}
        onAtur={picker.items.length === 1 ? () => { const it = picker.items[0]; setPicker(null); setModal({ jenis: "jadwal", item: it }); } : null}
        onPilih={({ date, meja }) => { const it = picker.items; setPicker(null); pilihTujuan(it, date, meja); }} />}
      {modal?.jenis === "jadwal" && <JadwalModal item={modal.item} minggu={minggu} awal={modal.awal} onClose={() => setModal(null)} onSaved={sesudahSimpan} onError={() => reloadAll()} />}
      {modal?.jenis === "aktivasi" && <AktivasiV2Modal item={modal.item} awal={modal.item.jadwal?.tanggal ? { date: modal.item.jadwal.tanggal, station: modal.item.jadwal.meja } : slotBawaan(minggu)} onClose={() => setModal(null)} onDone={({ item }) => { setModal(null); tampilPesan(`${item.unitCode} diaktifkan di Pelaksanaan Meja — Run dibuka dan jadwal Meja dibuat.`); reloadAll(); }} />}
    </PageContainer>
  );
}
