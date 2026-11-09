import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { api } from "@/api.js";
import { Card } from "@/components/ui/card.jsx";
import { todayWIB } from "@/lib/dateRange.js";
import { periodeTab, TAMPIL_SUMBER_LINK } from "../periodeLaporan.js";
import { buatCsvAkuisisi, namaBerkasCsv, teksCutoff, sumberBerbiaya } from "../akuisisiLogic.js";
import { kueriIklan } from "../iklanCampaignLogic.js";
import { berurutan, pesanGalat } from "../marketingData.js";
import BannerPeriode from "./BannerPeriode.jsx";
import KelolaBiayaIklan from "./KelolaBiayaIklan.jsx";
import RingkasanMarketing from "./marketing/RingkasanMarketing.jsx";
import DetailSumberMarketing from "./marketing/DetailSumberMarketing.jsx";
import RincianKreatif from "./marketing/RincianKreatif.jsx";
import PanelChat from "./marketing/PanelChat.jsx";
import { unduhEksporMarketing } from "./marketing/eksporMarketing.js";
// Gaya Apple khusus tab Marketing (10 Nov 2026): semua aturan di bawah .mk-ap / :root[data-mk-ap] — halaman lain tidak berubah.
import "@/styles/sanss-mk-apple.css";

// ═══ MARKETING (ADMIN) ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Satu tab pengganti Traffic + Akuisisi + Iklan. Periode = filter global Laporan (SATU state, juga di URL). Sumber data (semua baca-saja, service existing):
//   /atribusi/iklan/sumber → kartu + tabel semua sumber + detail sumber   |   /atribusi/iklan → Meta campaign → ad set → ad   |   /analytics/traffic (dimuat Laporan) → tren + pola jam/respons + label sumber
// Pembacaan laporan atribusi dijalankan BERURUTAN (penjaga server: satu perhitungan sekaligus). Tidak ada perhitungan paralel di klien.
export default function MarketingTab({ range, onUbahRentang, url, onUbah, traffic, memuatTraffic, sourceDetail, rangeParams, versiRefresh = 0, onData = null, onAksi = null }) {
  const hariIni = useMemo(() => todayWIB().format("YYYY-MM-DD"), []);
  const periode = useMemo(() => periodeTab(range, hariIni), [range, hariIni]);
  const [lap, setLap] = useState(null);
  const [memuat, setMemuat] = useState(false);
  const [galat, setGalat] = useState(null);       // { pesan, ditolak }
  const [iklan, setIklan] = useState(null);
  const [iklanGalat, setIklanGalat] = useState(null);
  const [versi, setVersi] = useState(0);
  const [kelola, setKelola] = useState(false);
  const [chat, setChat] = useState(null);        // { judul, sub, query } untuk panel daftar chat
  const [mengunduh, setMengunduh] = useState(false);
  const [galatUnduh, setGalatUnduh] = useState(null);
  const cacheMeta = useRef(new Map());
  const tokenLap = useRef(0);          // permintaan terbaru menang; hasil permintaan lama dibuang
  const kunciLap = useRef(null);        // periode/filter milik `lap` yang sedang tampil

  const muat = useCallback(async () => {
    const token = ++tokenLap.current; const basi = () => token !== tokenLap.current;
    if (!periode.ok) { kunciLap.current = null; setLap(null); setGalat(null); setMemuat(false); return; }
    const kunci = `${periode.dari}|${periode.sampai}`;   // banding hanya menambah selisih pada periode yang sama: angka lama tetap sah selama dimuat ulang
    if (kunciLap.current !== kunci) { kunciLap.current = null; setLap(null); }   // angka periode lama tidak boleh tampil di bawah banner periode baru
    setMemuat(true); setGalat(null);
    try {
      const r = await berurutan(() => api.getAtribusiSumber({ dari: periode.dari, sampai: periode.sampai, ...(url.banding ? { pembanding: "1" } : {}) }), { batal: basi });
      if (basi()) return;
      kunciLap.current = kunci; setLap(r);
    } catch (e) {
      if (basi() || e?.dibatalkan) return;
      kunciLap.current = null; setLap(null); setGalat({ pesan: pesanGalat(e, "Gagal memuat laporan Marketing."), ditolak: e?.status === 403 || e?.status === 401 });
    } finally { if (!basi()) setMemuat(false); }
  }, [periode.ok, periode.dari, periode.sampai, url.banding]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { muat(); }, [muat, versi]);
  useEffect(() => () => { tokenLap.current += 1; }, []);

  // Laporan Meta tingkat campaign: bahan butir kualitas data (UNKNOWN/UNMAPPED/spend Meta) dan cache untuk detail Meta. Dimuat SETELAH laporan sumber (berurutan).
  const q = useMemo(() => kueriIklan({ range, level: "campaign" }), [range]);
  const kunci = JSON.stringify(q);
  useEffect(() => {
    let batal = false;
    if (!lap || !periode.ok) { setIklan(null); setIklanGalat(null); return undefined; }
    const ada = cacheMeta.current.get(kunci);
    if (ada) { setIklan(ada); setIklanGalat(null); return undefined; }
    setIklan(null); setIklanGalat(null);
    berurutan(() => api.getAtribusiIklan(q), { batal: () => batal }).then((r) => { cacheMeta.current.set(kunci, r); if (!batal) setIklan(r); }).catch((e) => { if (!batal && !e?.dibatalkan) setIklanGalat(pesanGalat(e, "gagal dimuat")); });
    return () => { batal = true; };
  }, [lap, periode.ok, kunci, q]);

  // Data yang sedang tampil dibagikan ke tombol Export Laporan (XLSX) supaya berkas = layar (periode, urutan, cutoff sama); null saat belum ada.
  useEffect(() => { onData?.(lap ? { lap, iklan, urut: url.urut, rank: url.rank } : null); }, [lap, iklan, url.urut, url.rank, onData]);
  useEffect(() => () => onData?.(null), [onData]);
  const segarkan = useCallback(() => { cacheMeta.current.clear(); setVersi((v) => v + 1); }, []);
  // Penanda gaya untuk dialog/panel yang dirender di luar halaman (portal): hanya selama tab Marketing tampil.
  useEffect(() => { const el = document.documentElement; el.setAttribute("data-mk-ap", "1"); return () => el.removeAttribute("data-mk-ap"); }, []);
  // Tombol Refresh milik halaman Laporan (kanan atas) juga menyegarkan laporan atribusi Marketing — satu tombol, bukan dua.
  useEffect(() => { if (versiRefresh > 0) segarkan(); }, [versiRefresh, segarkan]);
  const terpilih = url.sumber ? (lap?.sumber || []).find((x) => x.id === url.sumber) : null;
  const pilihSumber = (id) => onUbah({ sumber: id, level: "campaign", campaign: null, adset: null }, { ganti: false });
  const kembali = () => onUbah({ sumber: null, level: "campaign", campaign: null, adset: null }, { ganti: false });
  const subTab = [{ id: null, label: "Ringkasan" }, { id: TAMPIL_SUMBER_LINK, label: "Sumber & Link" }];
  function ekspor() {
    const csv = buatCsvAkuisisi(lap, { urut: url.urut }); if (!csv) return;
    const u = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = u; a.download = namaBerkasCsv(lap); document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u);
  }

  async function unduhExcel() {
    setMengunduh(true); setGalatUnduh(null);
    try { await unduhEksporMarketing({ dari: periode.dari, sampai: periode.sampai }); }
    catch (e) { setGalatUnduh(pesanGalat(e, "Gagal membuat berkas Excel.")); }
    finally { setMengunduh(false); }
  }
  // Aksi Marketing ditampilkan di header halaman (satu tempat): Kelola biaya iklan + menu Ekspor. Format dan cakupan ekspor tidak berubah:
  //   Excel daftar chat (server, data-testid lama ekspor-excel-marketing) · CSV performa sumber (ekspor-sumber) · XLSX laporan (tombol Export milik halaman Laporan).
  const aksiRef = useRef({});
  aksiRef.current = { kelola: () => setKelola(true), unduhExcel, eksporCsv: ekspor };
  useEffect(() => {
    onAksi?.({ kelola: () => aksiRef.current.kelola(), unduhExcel: () => aksiRef.current.unduhExcel(), eksporCsv: () => aksiRef.current.eksporCsv(), mengunduh, siapExcel: periode.ok, siapCsv: !!lap });
  }, [onAksi, mengunduh, periode.ok, lap]);
  useEffect(() => () => onAksi?.(null), [onAksi]);

  return (
    <div className="crm-lap-tab mk-ap" data-testid="marketing-tab">
      <BannerPeriode periode={periode} hariIni={hariIni} onUbahRentang={onUbahRentang} cutoff={teksCutoff(lap)} ringkas={!!terpilih} tanpaHariBerjalan={!terpilih && url.tampil !== TAMPIL_SUMBER_LINK} />

      {mengunduh && <p className="mk-redup flex items-center gap-2" role="status" data-testid="menyiapkan-excel"><Loader2 size={14} className="animate-spin" /> Menyiapkan berkas Excel…</p>}
      {galatUnduh && <Card className="!p-4" role="alert"><p className="flex items-center gap-2 text-sm text-red"><AlertTriangle size={16} /> {galatUnduh}</p></Card>}
      {galat?.ditolak && <Card className="flex items-start gap-3 !p-4" role="alert" data-testid="akses-ditolak"><ShieldAlert size={18} className="mt-0.5 shrink-0 text-red" /><div><p className="text-[14px] font-semibold text-ink">Akses ditolak</p><p className="t-secondary text-[12.5px]">Laporan Marketing hanya untuk ADMIN. Hubungi admin bila Anda memerlukan akses.</p></div></Card>}
      {galat && !galat.ditolak && <Card className="!p-4" role="alert" data-testid="galat-marketing"><p className="flex flex-wrap items-center gap-2 text-sm text-red"><AlertTriangle size={16} /> {galat.pesan} <button type="button" className="btn btn-ghost btn-sm" onClick={segarkan}>Coba lagi</button></p></Card>}
      {periode.ok && !lap && memuat && <Card className="!p-4"><p className="flex items-center gap-2 text-sm text-ink3" data-testid="memuat-marketing"><Loader2 size={16} className="animate-spin" /> Memuat laporan Marketing…</p></Card>}

      {lap && url.sumber && !terpilih && (
        <Card className="flex flex-col gap-2 !p-4" data-testid="sumber-tidak-dikenal"><p className="text-[13px] text-ink2">Sumber “{url.sumber}” tidak dikenal pada laporan ini.</p><button type="button" className="btn btn-ghost btn-sm self-start" onClick={kembali}>Kembali ke semua sumber</button></Card>
      )}
      {lap && terpilih && (
        <DetailSumberMarketing s={terpilih} lap={lap} periode={periode} range={range} url={url} onUbah={onUbah} onKembali={kembali} traffic={traffic} sourceDetail={sourceDetail} rangeParams={rangeParams} cacheMeta={cacheMeta} versi={versi} onLihatChat={setChat} />
      )}
      {!url.sumber && (
        <div role="tablist" aria-label="Tampilan Marketing" className="mk-seg mk-seg--subtab" data-testid="subtab-marketing">
          {subTab.map((t) => (
            <button key={t.label} type="button" role="tab" aria-selected={(url.tampil ?? null) === t.id} onClick={() => onUbah({ tampil: t.id }, { ganti: false })}>{t.label}</button>
          ))}
        </div>
      )}
      {!url.sumber && url.tampil === TAMPIL_SUMBER_LINK && (
        memuatTraffic || !sourceDetail
          ? <Card className="!p-4"><p className="flex items-center gap-2 text-sm text-ink3" data-testid="memuat-sumber-link"><Loader2 size={16} className="animate-spin" /> Memuat rincian sumber…</p></Card>
          : (sourceDetail.data || []).length === 0
            ? <Card className="!p-4"><p className="text-sm text-ink3" data-testid="sumber-link-kosong">Belum ada lead pada periode ini.</p></Card>
            : <RincianKreatif traffic={traffic} sourceDetail={sourceDetail} rangeParams={rangeParams} hanyaRincian />
      )}
      {lap && !url.sumber && url.tampil !== TAMPIL_SUMBER_LINK && (
        <RingkasanMarketing lap={lap} iklan={iklan} iklanGalat={iklanGalat} traffic={traffic} memuatTraffic={memuatTraffic} periode={periode} hariIni={hariIni} onUbahRentang={onUbahRentang} rangeParams={rangeParams} url={url} onUbah={onUbah} onBuka={pilihSumber} onLihatChat={setChat} />
      )}

      {chat && <PanelChat pilihan={chat} periode={periode} onTutup={() => setChat(null)} />}
      {kelola && <KelolaBiayaIklan open onOpenChange={(o) => { if (!o) setKelola(false); }} periode={periode} hariIni={hariIni} sumberAwal={terpilih && sumberBerbiaya(terpilih) ? terpilih.id : "TIKTOK"} onTersimpan={segarkan} />}
    </div>
  );
}
