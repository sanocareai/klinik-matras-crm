import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, ShieldAlert, Wallet } from "lucide-react";
import { api } from "@/api.js";
import { Card } from "@/components/ui/card.jsx";
import { todayWIB } from "@/lib/dateRange.js";
import { periodeTab } from "../periodeLaporan.js";
import { buatCsvAkuisisi, namaBerkasCsv, teksCutoff, sumberBerbiaya } from "../akuisisiLogic.js";
import { kueriIklan } from "../iklanCampaignLogic.js";
import { berurutan, pesanGalat } from "../marketingData.js";
import BannerPeriode from "./BannerPeriode.jsx";
import KelolaBiayaIklan from "./KelolaBiayaIklan.jsx";
import RingkasanMarketing from "./marketing/RingkasanMarketing.jsx";
import DetailSumberMarketing from "./marketing/DetailSumberMarketing.jsx";

// ═══ MARKETING (ADMIN) ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Satu tab pengganti Traffic + Akuisisi + Iklan. Periode = filter global Laporan (SATU state, juga di URL). Sumber data (semua baca-saja, service existing):
//   /atribusi/iklan/sumber → kartu + tabel semua sumber + detail sumber   |   /atribusi/iklan → Meta campaign → ad set → ad   |   /analytics/traffic (dimuat Laporan) → tren + pola jam/respons + label sumber
// Pembacaan laporan atribusi dijalankan BERURUTAN (penjaga server: satu perhitungan sekaligus). Tidak ada perhitungan paralel di klien.
export default function MarketingTab({ range, onUbahRentang, url, onUbah, traffic, memuatTraffic, sourceDetail, rangeParams, versiRefresh = 0, onData = null }) {
  const hariIni = useMemo(() => todayWIB().format("YYYY-MM-DD"), []);
  const periode = useMemo(() => periodeTab(range, hariIni), [range, hariIni]);
  const [lap, setLap] = useState(null);
  const [memuat, setMemuat] = useState(false);
  const [galat, setGalat] = useState(null);       // { pesan, ditolak }
  const [iklan, setIklan] = useState(null);
  const [iklanGalat, setIklanGalat] = useState(null);
  const [versi, setVersi] = useState(0);
  const [kelola, setKelola] = useState(false);
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
  // Tombol Refresh milik halaman Laporan (kanan atas) juga menyegarkan laporan atribusi Marketing — satu tombol, bukan dua.
  useEffect(() => { if (versiRefresh > 0) segarkan(); }, [versiRefresh, segarkan]);
  const terpilih = url.sumber ? (lap?.sumber || []).find((x) => x.id === url.sumber) : null;
  const pilihSumber = (id) => onUbah({ sumber: id, level: "campaign", campaign: null, adset: null }, { ganti: false });
  const kembali = () => onUbah({ sumber: null, level: "campaign", campaign: null, adset: null }, { ganti: false });
  function ekspor() {
    const csv = buatCsvAkuisisi(lap, { urut: url.urut }); if (!csv) return;
    const u = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = u; a.download = namaBerkasCsv(lap); document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u);
  }

  return (
    <div className="crm-lap-tab" data-testid="marketing-tab">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-[220px] flex-1">
          <BannerPeriode periode={periode} hariIni={hariIni} onUbahRentang={onUbahRentang} cutoff={teksCutoff(lap)} ringkas={!!terpilih} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setKelola(true)} data-testid="kelola-biaya"><Wallet size={14} /> Kelola biaya iklan</button>
        </div>
      </div>

      {galat?.ditolak && <Card className="flex items-start gap-3 !p-4" role="alert" data-testid="akses-ditolak"><ShieldAlert size={18} className="mt-0.5 shrink-0 text-red" /><div><p className="text-[14px] font-semibold text-ink">Akses ditolak</p><p className="t-secondary text-[12.5px]">Laporan Marketing hanya untuk ADMIN. Hubungi admin bila Anda memerlukan akses.</p></div></Card>}
      {galat && !galat.ditolak && <Card className="!p-4" role="alert" data-testid="galat-marketing"><p className="flex flex-wrap items-center gap-2 text-sm text-red"><AlertTriangle size={16} /> {galat.pesan} <button type="button" className="btn btn-ghost btn-sm" onClick={segarkan}>Coba lagi</button></p></Card>}
      {periode.ok && !lap && memuat && <Card className="!p-4"><p className="flex items-center gap-2 text-sm text-ink3" data-testid="memuat-marketing"><Loader2 size={16} className="animate-spin" /> Memuat laporan Marketing…</p></Card>}

      {lap && url.sumber && !terpilih && (
        <Card className="flex flex-col gap-2 !p-4" data-testid="sumber-tidak-dikenal"><p className="text-[13px] text-ink2">Sumber “{url.sumber}” tidak dikenal pada laporan ini.</p><button type="button" className="btn btn-ghost btn-sm self-start" onClick={kembali}>Kembali ke semua sumber</button></Card>
      )}
      {lap && terpilih && (
        <DetailSumberMarketing s={terpilih} lap={lap} periode={periode} range={range} url={url} onUbah={onUbah} onKembali={kembali} traffic={traffic} sourceDetail={sourceDetail} rangeParams={rangeParams} cacheMeta={cacheMeta} versi={versi} />
      )}
      {lap && !url.sumber && (
        <RingkasanMarketing lap={lap} iklan={iklan} iklanGalat={iklanGalat} traffic={traffic} memuatTraffic={memuatTraffic} periode={periode} rangeParams={rangeParams} url={url} onUbah={onUbah} onBuka={pilihSumber} onEkspor={ekspor} />
      )}

      {kelola && <KelolaBiayaIklan open onOpenChange={(o) => { if (!o) setKelola(false); }} periode={periode} hariIni={hariIni} sumberAwal={terpilih && sumberBerbiaya(terpilih) ? terpilih.id : "TIKTOK"} onTersimpan={segarkan} />}
    </div>
  );
}
