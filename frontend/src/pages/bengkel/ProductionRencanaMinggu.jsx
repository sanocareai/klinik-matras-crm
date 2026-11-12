import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { useTabs } from "@/lib/TabsContext.jsx";
import { motion } from "framer-motion";
import { CalendarDays, ChevronLeft, ChevronRight, LayoutGrid, ListChecks, Loader2, RefreshCw, Scissors, Undo2 } from "lucide-react";
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
import KonfirmasiCepat from "@/features/production/rencana/KonfirmasiCepat.jsx";
import useSeretPointer from "@/features/production/rencana/useSeretPointer.js";
import SalinanSeret from "@/features/production/rencana/SalinanSeret.jsx";
import PanelUnit from "@/features/production/rencana/PanelUnit.jsx";
import RencanaCornerView from "@/features/production/RencanaCornerView.jsx";
import { bacaUrl, keputusanLepas, keputusanLepasMeja, labelHari, labelMinggu, labelTanggal, mejaTeks, pesanGagalJadwal, pickupBelumDitutup, shiftKey, slotBawaan, teksHasilTiba, todayWib, tulisUrl } from "@/features/production/rencana/rencanaModel.js";

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
  const { start, hari, tab, q, sort, tampilan } = url;
  const data = useRencanaMinggu({ start, hari, tab, q, sort });
  const { minggu, dayData, antrean, loading, error, setError, reloadAll } = data;
  const izin = minggu?.izin || antrean?.izin || dayData?.izin || {};
  const [modal, setModal] = useState(null); const [pesan, setPesan] = useState(null); const [undo, setUndo] = useState(null);
  const [panelUnit, setPanelUnit] = useState(null); // { unitId, bagian } — ruang kerja unit sebagai panel di halaman ini (tanpa pindah tab)
  const [pendingIds, setPendingIds] = useState(() => new Set()); const [seleksi, setSeleksi] = useState(() => new Map()); const [picker, setPicker] = useState(null);
  const [konfirmasi, setKonfirmasi] = useState(null); // { jenis: "tiba" | "diproses", items, anchor }
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

  const bukaPapan = () => openInActiveTab(`${PAPAN_V2}?date=${hari}`, { title: "Papan Meja" }); // papan lanjutan (BOM, reservasi, urutan manual)
  const keTampilan = (v) => ubahUrl({ tampilan: v }); // Meja | Corner — tetap di tab ini
  // Daftar PIC (profil operator aktif) — hanya untuk pemegang izin penetapan; dipakai pemilih PIC Meja dan penetapan PIC Corner.
  const [operators, setOperators] = useState(null); const [cornerTick, setCornerTick] = useState(0);
  const muatUlang = () => { reloadAll(); setCornerTick((n) => n + 1); };
  useEffect(() => { if (!izin.pic) return undefined; let hidup = true; api.getPlanningRefs().then((r) => { if (hidup) setOperators(r.operators || []); }).catch(() => { if (hidup) setOperators(null); }); return () => { hidup = false; }; }, [izin.pic]);
  async function setPicMeja(code, operatorId) {
    tampilPesan(`Menyimpan PIC ${mejaTeks(code)}…`, { tone: "busy" });
    try { const r = await api.setProductionV2StationPic(code, { productionDate: hari, operatorId }); tampilPesan(r.operatorName ? `PIC ${mejaTeks(code)} ${labelHari(hari)}: ${r.operatorName}.` : `PIC ${mejaTeks(code)} ${labelHari(hari)} dihapus.`); }
    catch (e) { tampilPesan(friendlyError(e), { tone: "err" }); } finally { reloadAll(); }
  }
  const bukaUnit = (it) => setPanelUnit({ unitId: it.unitId, bagian: "ringkasan" }); // panel di halaman ini; "Buka di tab sendiri" tetap tersedia di kepala panel
  const bukaUnitTab = (unitId, bagian) => openInActiveTab(jalurUnit(unitId, bagian), { title: "Ruang Kerja Unit" });
  const aktif = (it) => (seleksi.has(it.unitId) && seleksi.size > 1 ? [...seleksi.values()] : [it]); // kartu yang tercentang ikut bila ada beberapa
  function onAksi(kind, it, el) {
    if (kind === "BUKA") return bukaUnit(it);
    if (kind === "PILIH_MEJA") return setPicker({ items: aktif(it), anchor: el || null });
    if (kind === "ATUR" || kind === "RIWAYAT" || kind === "JADWALKAN" || kind === "PINDAH") return setModal({ jenis: "jadwal", item: it });
    if (kind === "KEPUTUSAN") { ubahUrl({ tab: "KEPUTUSAN" }); return undefined; }
    if (kind === "AKTIVASI") return setModal({ jenis: "aktivasi", item: it });
    if (kind === "PAPAN_V2") return openInActiveTab(`${PAPAN_V2}?date=${it.tanggal || hari}`, { title: "Papan Meja" });
    if (kind === "KELUARKAN") return keluarkan(it);
    if (kind === "TERIMA") return setKonfirmasi({ jenis: "tiba", items: aktif(it).filter((x) => !x.diterima), anchor: el || null });
    if (kind === "DIPROSES") return setKonfirmasi({ jenis: "diproses", items: [it], anchor: el || null });
    return undefined;
  }
  // TANDAI TIBA: penerimaan workshop resmi (pelaku, waktu, lokasi bawaan). Pickup yang belum ditutup driver ikut ditutup server — Produksi tidak menunggu Armada.
  async function tandaiTiba(items) {
    const ids = items.map((i) => i.unitId); setKonfirmasi(null);
    tandaiPending(ids, true); tampilPesan(items.length === 1 ? `Mencatat ${items[0].unitCode} tiba…` : `Mencatat ${items.length} unit tiba…`, { tone: "busy" });
    const hasil = [];
    for (const it of items) { // berurutan: tiap unit punya kunci baris sendiri di server; satu gagal tidak membatalkan yang lain
      try { const r = await api.catatPenerimaanWorkshop(it.unitId, { fisikDiterima: true, tutupPickup: true }); hasil.push({ ok: true, unitCode: it.unitCode, pickupDitutup: !!r.pickup?.ditutup }); }
      catch (e) { hasil.push({ ok: false, unitCode: it.unitCode, pesan: friendlyError(e) }); }
    }
    tampilPesan(teksHasilTiba(hasil), { tone: hasil.some((h) => !h.ok) ? "err" : "ok" });
    setSeleksi((m) => { const n = new Map(m); for (const id of ids) n.delete(id); return n; });
    tandaiPending(ids, false); reloadAll();
  }
  async function ubahDiproses(it) {
    setKonfirmasi(null); tandaiPending([it.unitId], true); tampilPesan(`Mengubah order ${it.orderNumber || it.unitCode} ke Diproses…`, { tone: "busy" });
    try { await api.updateOrder(it.orderId, { status: "PROCESSING", statusOverrideNote: "Unit sudah diterima di workshop — diubah dari Rencana Produksi." }); tampilPesan(`Order ${it.orderNumber || it.unitCode} kini Diproses — unit siap dijadwalkan.`); }
    catch (e) { tampilPesan(friendlyError(e), { tone: "err" }); } finally { tandaiPending([it.unitId], false); reloadAll(); }
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
  // Seret-lepas (mouse + sentuh): sasaran dibaca dari data-drop ("hari:<tanggal>" / "meja:<kode>") — satu jalur simpan yang sama dengan Pilih meja.
  const seretan = useSeretPointer({ onLepas: (t, items) => (t.jenis === "hari" ? lepasKeHari(t.nilai, items) : pilihTujuan(items, hari, t.nilai)) });
  const onSeretMulai = (e, el, it) => seretan.mulai(e, el, aktif(it));
  const seretIds = new Set((seretan.seret?.items || []).map((i) => i.unitId));
  const dragAktif = !!seretan.seret && !!izin.jadwalkan;
  function lepasKeHari(tanggal, items) {
    if (!items?.length) return undefined;
    if (items.length > 1) { const k = keputusanLepasMeja({ items, date: tanggal, meja: null, minggu }); if (k.aksi === "TOLAK") return tampilPesan(k.pesan, { tone: "err" }); if (k.aksi === "SIMPAN") return simpan(k.items, k.tanggal, null); return undefined; }
    const it = items[0]; const k = keputusanLepas({ item: it, targetDate: tanggal, minggu });
    if (k.aksi === "TOLAK") return tampilPesan(k.pesan, { tone: "err" });
    if (k.aksi === "PINDAH") return simpan([it], k.tanggal, k.meja);
    return undefined;
  }
  function pilihTujuan(items, date, meja, selesai) {
    selesai?.(); if (!items?.length) return undefined;
    const k = keputusanLepasMeja({ items, date, meja: meja === "AUTO" ? null : meja, minggu });
    if (k.aksi === "TOLAK") return tampilPesan(k.pesan, { tone: "err" });
    if (k.aksi === "SIMPAN") return simpan(k.items, k.tanggal, meja === "AUTO" ? "AUTO" : k.meja);
    return undefined;
  }
  const toggle = (it) => setSeleksi((m) => { const n = new Map(m); if (n.has(it.unitId)) n.delete(it.unitId); else n.set(it.unitId, it); return n; });
  const pilihSemuaOrder = (it) => setSeleksi((m) => { const n = new Map(m); n.set(it.unitId, it); for (const u of it.saudaraSiap || []) n.set(u.unitId, { unitId: u.unitId, unitCode: u.unitCode, revisiJadwal: u.revisiJadwal, unitCas: u.unitCas, diterima: u.diterima, jadwal: null }); return n; });

  const belumTibaDipilih = [...seleksi.values()].filter((x) => !x.diterima);
  const kTiba = konfirmasi?.jenis === "tiba" ? konfirmasi.items : [];
  const kTutupPickup = kTiba.filter(pickupBelumDitutup).length;
  const visibleRunIds =(dayData?.stations || []).flatMap((s) => s.items).map((i) => i.v2?.runId).filter(Boolean);
  const visibleUnitIds = [...(antrean?.items || []).map((i) => i.unitId), ...(dayData?.stations || []).flatMap((s) => s.items).map((i) => i.unitId)];

  return (
    <PageContainer fluid className={`prod-halaman${sempit ? " !p-3" : ""}`}>
      {sempit ? (
        <div data-testid="header-mobile">
          <div className="flex items-center justify-between gap-2">
            <h1 className="m-0 text-[18px] font-semibold text-ink">Rencana Produksi</h1>
            <MenuHalaman items={[
              { key: "muat", label: "Muat ulang", onClick: muatUlang },
              { key: "export", label: "Export Excel", onClick: () => document.querySelector("[data-testid=export-excel-open]")?.click() },
              { key: "papan", label: "Papan Meja (harian)", onClick: () => bukaPapan() },
              { key: "corner", label: tampilan === "corner" ? "Kembali ke Meja" : "Corner", onClick: () => keTampilan(tampilan === "corner" ? "meja" : "corner") },
            ]} />
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="prod-rc-nav" role="group" aria-label="Pindah minggu">
              <Button variant="ghost" size="sm" className="min-h-[44px] min-w-[44px]" aria-label="Minggu sebelumnya" data-testid="minggu-sebelum" onClick={() => ubahUrl({ start: shiftKey(start, -7), hari: shiftKey(hari, -7) })}><ChevronLeft size={16} aria-hidden /></Button>
              <span className="px-1" data-testid="minggu-label">{labelMinggu(start)}</span>
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
              <div className="prod-rc-nav" role="group" aria-label="Pindah minggu">
                <Button variant="ghost" size="sm" className="min-h-[44px] min-w-[44px]" aria-label="Minggu sebelumnya" data-testid="minggu-sebelum" onClick={() => ubahUrl({ start: shiftKey(start, -7), hari: shiftKey(hari, -7) })}><ChevronLeft size={16} aria-hidden /></Button>
                <span className="px-2" data-testid="minggu-label">{labelMinggu(start)}</span>
                <Button variant="ghost" size="sm" className="min-h-[44px] min-w-[44px]" aria-label="Minggu berikutnya" data-testid="minggu-sesudah" onClick={() => ubahUrl({ start: shiftKey(start, 7), hari: shiftKey(hari, 7) })}><ChevronRight size={16} aria-hidden /></Button>
              </div>
              <Button variant="neutral" size="sm" className="min-h-[40px]" data-testid="hari-ini" onClick={() => ubahUrl({ start: shiftKey(today, 0), hari: today })}>Hari ini</Button>
              <Button variant="neutral" size="sm" className="min-h-[40px]" onClick={muatUlang} aria-label="Muat ulang"><RefreshCw size={14} aria-hidden /> Muat ulang</Button>
              <RencanaExportButton date={hari} stations={["TABLE_1", "TABLE_2", "TABLE_3", "TABLE_4"]} visibleRunIds={visibleRunIds} visibleUnitIds={visibleUnitIds} dateLabel={labelTanggal(hari)} />
              <button type="button" className="prod-tombol netral" data-testid="link-papan-meja" onClick={() => bukaPapan()}><LayoutGrid size={14} className="mr-1" aria-hidden /> Papan Meja</button>

            </div>
          } />
      )}
      <PageBody className="prod-stack">
        {error && <p role="alert" className="mb-3 rounded-btn bg-redbg px-3 py-2 text-[13px] text-red" data-testid="rencana-galat">{error} <button type="button" className="underline" onClick={() => { setError(""); reloadAll(); }}>Coba lagi</button></p>}
        <div className="rc-segmen" role="tablist" aria-label="Tampilan Rencana" data-testid="tampilan-segmen">
          {[["meja", "Meja", LayoutGrid], ["corner", "Corner", Scissors]].map(([k, l, Ik]) => (
            <button key={k} type="button" role="tab" aria-selected={tampilan === k} data-testid={k === "corner" ? "link-corner" : "link-meja"} onClick={() => keTampilan(k)} className={tampilan === k ? "aktif" : ""}>
              {tampilan === k && <motion.span layoutId="rc-segmen-latar" className="rc-segmen-latar" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <span className="relative inline-flex items-center gap-1.5"><Ik size={14} strokeWidth={1.75} aria-hidden /> {l}</span>
            </button>
          ))}
        </div>
        {tampilan === "corner" ? (
          <div className="mt-3" data-testid="rencana-corner">
            <RencanaCornerView operators={operators || []} canAssign={!!izin.pic && !!operators} onOpen={(unitId) => setPanelUnit({ unitId, bagian: "ringkasan" })} onNotice={(m) => tampilPesan(m)} reloadKey={cornerTick} onChanged={reloadAll} />
          </div>
        ) : (<>
        {minggu && !sempit && <p className="m-0 mb-2 text-[13px] text-ink3" data-testid="ringkas-minggu">Minggu ini (Sen–Sab): <b className="text-ink">{minggu.ringkasan.terencanaKerja}</b> unit terencana dari {minggu.ringkasan.slotKerja} slot{minggu.ringkasan.diLuarHariKerja > 0 ? <span className="text-orange"> · +{minggu.ringkasan.diLuarHariKerja} di hari Minggu (libur, di luar hari kerja rutin)</span> : ""} · {minggu.ringkasan.perhatian ? <span className="text-orange">{minggu.ringkasan.perhatian} perlu perhatian</span> : "tidak ada yang perlu perhatian"}</p>}
        <div className={sempit ? "mt-2" : ""}><WeekStrip ringkas={sempit} minggu={minggu} hari={hari} onPilih={(d) => { ubahUrl({ hari: d }); setPanel("hari"); }} dragAktif={dragAktif} sasaran={seretan.sasaran} loading={loading.minggu} /></div>
        <p className="m-0 mt-2 text-[12.5px] text-ink3" data-testid="petunjuk-tanggal">Jadwal disimpan untuk <b className="text-ink">{labelTanggal(hari)}{hari === today ? " (hari ini)" : ""}</b>. {izin.jadwalkan ? "Seret unit ke Meja 1–4, atau tekan Pilih meja." : "Anda hanya dapat melihat jadwal."}</p>
        {sempit && <div className="mt-2"><div className="flex gap-1" role="tablist" aria-label="Tampilan">
          <button type="button" role="tab" aria-selected={panel === "antrean"} data-testid="panel-antrean" onClick={() => setPanel("antrean")} className={`prod-pil flex-1 justify-center${panel === "antrean" ? " aktif rc-tab-on" : ""}`}><ListChecks size={14} aria-hidden /> Antrean</button>
          <button type="button" role="tab" aria-selected={panel === "hari"} data-testid="panel-hari" onClick={() => setPanel("hari")} className={`prod-pil flex-1 justify-center${panel === "hari" ? " aktif rc-tab-on" : ""}`}><CalendarDays size={14} aria-hidden /> Hari {labelHari(hari)}</button>
        </div></div>}
        <div className="prod-rc-papan">
          <div className={`${panel === "antrean" ? "block" : "hidden"} min-w-0 lg:block`}>
            {seleksi.size > 0 && izin.jadwalkan && (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-card border border-accent/50 bg-accentbg px-3 py-2" data-testid="seleksi-bar" role="region" aria-label="Unit dipilih">
                <span className="text-[13px] font-medium text-ink" data-testid="seleksi-jumlah">{seleksi.size} unit dipilih</span>
                <Button size="sm" className="rc-cta min-h-[40px]" data-testid="seleksi-pilih-meja" onClick={(e) => setPicker({ items: [...seleksi.values()], anchor: e.currentTarget })}>Pilih meja</Button>
                {izin.terima && belumTibaDipilih.length > 0 && <Button size="sm" variant="secondary" className="min-h-[40px]" data-testid="seleksi-tandai-tiba" onClick={(e) => setKonfirmasi({ jenis: "tiba", items: belumTibaDipilih, anchor: e.currentTarget })}>Tandai tiba ({belumTibaDipilih.length})</Button>}
                <Button size="sm" variant="neutral" className="min-h-[40px]" data-testid="seleksi-kosongkan" onClick={() => setSeleksi(new Map())}>Kosongkan pilihan</Button>
              </div>
            )}
            <RencanaAntrean antrean={antrean} loading={loading.antrean} tab={tab} onTab={(t) => ubahUrl({ tab: t })} q={q} onQ={(v) => ubahUrl({ q: v })} sort={sort} onSort={(v) => ubahUrl({ sort: v })}
              izin={izin} onAksi={onAksi} onBuka={bukaUnit} onSeretMulai={onSeretMulai} seretIds={seretIds} onMuatLagi={data.muatHalamanBerikut} muatLagi={data.muatLagi}
              seleksi={new Set(seleksi.keys())} onToggle={toggle} onPilihSemuaOrder={pilihSemuaOrder} pendingIds={pendingIds} />
          </div>
          <div className={`${panel === "hari" ? "block" : "hidden"} min-w-0 lg:block`}>
            <DayPanel dayData={dayData} loading={loading.hari} izin={izin} onAksi={onAksi} onBuka={bukaUnit} dragAktif={dragAktif} sasaran={seretan.sasaran} onSeretMulai={onSeretMulai} seretIds={seretIds} pendingIds={pendingIds} menyimpan={pendingIds.size > 0} operators={operators} onSetPic={setPicMeja} />
          </div>
        </div>
        </>)}
      </PageBody>
      <SalinanSeret seret={seretan.seret} salinanRef={seretan.salinanRef} sasaran={seretan.sasaran} />
      <PanelUnit buka={panelUnit} onBagian={(b) => setPanelUnit((p) => (p ? { ...p, bagian: b } : p))} onClose={() => setPanelUnit(null)} onChanged={reloadAll} onBukaTab={(id, b) => { setPanelUnit(null); bukaUnitTab(id, b); }} />
      {pesan && createPortal(
        <div role="status" aria-live="polite" data-testid="rencana-pesan" data-tone={pesan.tone} className={`prod-rc-toast ${pesan.tone === "err" ? "galat" : pesan.tone === "busy" ? "sibuk" : "ok"}`}>
          {pesan.tone === "busy" && <Loader2 size={14} className="animate-spin" aria-hidden />}
          <span>{pesan.teks}</span>
          {undo && <Button size="sm" variant="neutral" className="min-h-[44px]" data-mutates onClick={urungkan} data-testid="undo-jadwal"><Undo2 size={14} className="mr-1" aria-hidden /> Urungkan</Button>}
          {pesan.tone !== "busy" && <button type="button" className="prod-rc-toast-tutup" onClick={() => { setPesan(null); setUndo(null); }} aria-label="Tutup pesan">Tutup</button>}
        </div>, document.body)}
      {picker && <PilihMeja anchor={picker.anchor} items={picker.items} minggu={minggu} hari={hari} onClose={() => setPicker(null)}
        onAtur={picker.items.length === 1 ? () => { const it = picker.items[0]; setPicker(null); setModal({ jenis: "jadwal", item: it }); } : null}
        onPilih={({ date, meja }) => { const it = picker.items; setPicker(null); pilihTujuan(it, date, meja); }} />}
      {konfirmasi?.jenis === "tiba" && kTiba.length > 0 && <KonfirmasiCepat anchor={konfirmasi.anchor} testid="konfirmasi-tiba" onClose={() => setKonfirmasi(null)} onYa={() => tandaiTiba(kTiba)}
        judul={kTiba.length === 1 ? `${kTiba[0].unitCode} sudah tiba di workshop?` : `${kTiba.length} unit sudah tiba di workshop?`}
        isi={`Dicatat atas nama Anda di lokasi workshop bawaan.${kTutupPickup ? ` Pickup driver ${kTutupPickup === kTiba.length ? "" : `untuk ${kTutupPickup} unit `}ikut ditutup otomatis.` : ""}`}
        labelYa="Sudah tiba" />}
      {konfirmasi?.jenis === "diproses" && <KonfirmasiCepat anchor={konfirmasi.anchor} testid="konfirmasi-diproses" onClose={() => setKonfirmasi(null)} onYa={() => ubahDiproses(konfirmasi.items[0])}
        judul={`Ubah order ${konfirmasi.items[0].orderNumber || ""} ke Diproses?`} isi="Unit sudah di workshop. Sales dan Delivery melihat status yang sama; unit bisa langsung dijadwalkan." labelYa="Ubah ke Diproses" />}
      {modal?.jenis === "jadwal" &&<JadwalModal item={modal.item} minggu={minggu} awal={modal.awal} onClose={() => setModal(null)} onSaved={sesudahSimpan} onError={() => reloadAll()} />}
      {modal?.jenis === "aktivasi" && <AktivasiV2Modal item={modal.item} awal={modal.item.jadwal?.tanggal ? { date: modal.item.jadwal.tanggal, station: modal.item.jadwal.meja } : slotBawaan(minggu)} onClose={() => setModal(null)} onDone={({ item }) => { setModal(null); tampilPesan(`${item.unitCode} diaktifkan di Pelaksanaan Meja — Run dibuka dan jadwal Meja dibuat.`); reloadAll(); }} />}
    </PageContainer>
  );
}
