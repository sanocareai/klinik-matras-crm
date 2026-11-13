import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, ChevronLeft, RefreshCw } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import SalinKode from "@/features/production/SalinKode.jsx";
import BahanTab from "@/features/production/bahan/BahanTab.jsx";
import RingkasanUnit from "@/features/production/workspace/RingkasanUnit.jsx";
import DokumentasiSection from "@/features/production/workspace/DokumentasiSection.jsx";
import { Unit360Isi } from "@/features/production/UnitOverviewDrawer.jsx";
import { SUMBER } from "@/features/production/bahan/bahanModel.js";
import { waktuWib } from "@/features/production/orderProduksiModel.js";
import { normalBagian, penjelasanTertahan as tertahan, statusUtama, tabProfil } from "@/features/production/workspace/profilModel.js";
import "@/features/production/workspace/profil.css";

// PROFIL UNIT — SATU profil untuk seluruh workspace Produksi (Rencana Produksi, Status Produksi, Order Produksi, Papan Meja, Quality Control).
// Kepala ringkas (nama pelanggan, kode, SATU status utama + keterangan), kontrol segmen Ringkasan · Bahan · Foto · Riwayat (+ Meja & QC untuk unit di alur Meja).
// Pekerjaan (status kerja, target, status order, penerimaan) diubah langsung di Ringkasan — tanpa tab/formulir terpisah. Isi Meja & QC = isi Unit 360 yang sama.

const IK = { strokeWidth: 1.75 };
const aktifUnit = (s) => !["CANCELLED", "DELIVERED"].includes(s);
const PEGAS = { type: "spring", stiffness: 420, damping: 36 };

/** Alasan jujur bila tindakan utama tidak punya tombol di sini. */
export const penjelasanTertahan = (data) => tertahan(data);

/** Dua sumber pemakaian di Riwayat: label dan total TERPISAH (tidak dijumlahkan). */
function RingkasanPemakaian({ data }) {
  const baru = data.pemakaianAktual?.baris ?? []; const kl = data.komponenLama?.total;
  if (!baru.length && !(kl && (kl.pemakaianKembali.jumlahItem + kl.dilepasTidakDipakai.jumlahItem) > 0)) return null;
  return (
    <div className="pf-grup" data-testid="riwayat-dua-sumber">
      <div className="pf-baris" data-testid="riwayat-total-baru"><span className="pf-label">{SUMBER.BARU.label}<small>{SUMBER.BARU.ringkas}</small></span><span className="pf-nilai kuat">{baru.length} catatan · {(data.pemakaianAktual?.total ?? []).length} bahan</span></div>
      <div className="pf-baris" data-testid="riwayat-total-lama"><span className="pf-label">{SUMBER.LAMA.label}<small>{SUMBER.LAMA.ringkas}</small></span><span className="pf-nilai kuat">{kl ? `${kl.pemakaianKembali.jumlahItem} dipakai kembali · ${kl.dilepasTidakDipakai.jumlahItem} dilepas` : "—"}</span></div>
    </div>
  );
}

function RiwayatLini({ daftar }) {
  const [semua, setSemua] = useState(false);
  const tampil = semua ? daftar : daftar.slice(0, 8);
  return (
    <div className="pf-grup">
      <ol className="pf-lini" data-testid="riwayat-daftar">
        {tampil.map((r, i) => <li key={`${r.kind}-${r.at}-${i}`}><span className="pf-lini-teks">{r.label}</span><span className="pf-lini-waktu">{r.actor || "Sistem"} · {waktuWib(r.at)}</span></li>)}
      </ol>
      {daftar.length > 8 && <button type="button" className="pf-baris" onClick={() => setSemua((v) => !v)}><span className="pf-label" style={{ color: "var(--crm-primary)" }}>{semua ? "Tampilkan lebih sedikit" : `Tampilkan semua (${daftar.length})`}</span></button>}
    </div>
  );
}

export default function UnitWorkspace({ unitId, bagian: bagianMasuk, onBagian, onKembali, onChanged, labelKembali = "Daftar kerja", aksiHalaman = null, fokusKelengkapan = false }) {
  const [data, setData] = useState(null); const [ruang, setRuang] = useState(null); const [error, setError] = useState(null); const [memuat, setMemuat] = useState(false);
  const [pesan, setPesan] = useState(""); const reqRef = useRef(0); const judulRef = useRef(null);
  const bagian = normalBagian(bagianMasuk);

  const muat = useCallback(async () => {
    const id = ++reqRef.current; setMemuat(true); setError(null);
    try {
      const [d, r] = await Promise.all([api.getUnitAdopsi(unitId), api.getUnitRuangKerja(unitId)]);
      if (id === reqRef.current) { setData(d); setRuang(r); }
    } catch (e) { if (id === reqRef.current) setError(e); } finally { if (id === reqRef.current) setMemuat(false); }
  }, [unitId]);
  useEffect(() => { setData(null); setRuang(null); setPesan(""); muat(); }, [unitId, muat]);
  useEffect(() => { if (data && judulRef.current) judulRef.current.focus?.({ preventScroll: true }); }, [!!data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!pesan) return undefined; const t = setTimeout(() => setPesan(""), 4500); return () => clearTimeout(t); }, [pesan]);

  const sesudahUbah = useCallback(async () => { await muat(); onChanged?.(); }, [muat, onChanged]);

  const u = data?.unit; const ad = data?.adopsi; const izin = data?.izin || {}; const aktif = !!u && aktifUnit(u.status);
  const tabs = useMemo(() => tabProfil(ruang, bagian), [ruang, bagian]);
  const adaMeja = tabs.some((t) => t.key === "meja");
  const st = ad ? statusUtama(ad, ruang) : null;
  const nama = u?.order?.customer?.name || ruang?.order?.pelanggan?.name;

  // navigasi tab dengan panah (WAI-ARIA tabs)
  const onKeyTab = (e) => {
    const i = tabs.findIndex((b) => b.key === bagian); let n = null;
    if (e.key === "ArrowRight") n = (i + 1) % tabs.length; else if (e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length; else if (e.key === "Home") n = 0; else if (e.key === "End") n = tabs.length - 1;
    if (n != null) { e.preventDefault(); onBagian(tabs[n].key); requestAnimationFrame(() => document.getElementById(`tab-${tabs[n].key}`)?.focus()); }
  };

  return (
    <div className="pf" data-testid="ruang-kerja-unit">
      <header className="pf-kepala" data-testid="ruang-header">
        {onKembali && <div className="pf-kepala-alat"><button type="button" className="pf-kembali" onClick={onKembali} data-testid="kembali-daftar"><ChevronLeft {...IK} size={20} aria-hidden />{labelKembali}</button></div>}
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
          <h1 ref={judulRef} tabIndex={-1} className="pf-judul" data-testid="ruang-judul">{u ? (nama || u.unitCode) : "Memuat unit…"}</h1>
          {u && (
            <p className="pf-sub">
              <span className="pf-kode inline-flex items-center gap-1" data-testid="ruang-kode">{u.unitCode}<SalinKode teks={u.unitCode} /></span>
              {u.order?.orderNumber && <span>{u.order.orderNumber}</span>}
              {(ruang?.order?.layanan || []).length > 0 && <span>{ruang.order.layanan.join(" + ")}</span>}
            </p>
          )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {aksiHalaman && <button type="button" className="pf-pil-btn" data-mutates onClick={aksiHalaman.onClick} data-testid="aksi-halaman">{aksiHalaman.label}</button>}
            <button type="button" className="pf-ikon-btn" onClick={muat} disabled={memuat} aria-label="Muat ulang profil unit"><RefreshCw {...IK} size={15} className={memuat ? "animate-spin motion-reduce:animate-none" : ""} aria-hidden /></button>
          </div>
        </div>
        {st?.utama && (
          <div className="pf-status-baris" data-testid="status-ringkas">
            <span className={`pf-status n-${st.utama.nada || "neutral"}`} data-testid="status-utama" data-jenis={st.utama.jenis}>{st.utama.teks}</span>
            {st.keterangan.length > 0 && <span className="pf-ket">{st.keterangan.map((k) => <span key={k}>{k}</span>)}</span>}
          </div>
        )}
        <div role="tablist" aria-label="Bagian profil unit" className="pf-segmen" onKeyDown={onKeyTab} data-testid="ruang-tab">
          {tabs.map((b) => (
            <button key={b.key} id={`tab-${b.key}`} type="button" role="tab" aria-selected={bagian === b.key} aria-controls={`panel-${b.key}`} tabIndex={bagian === b.key ? 0 : -1} data-testid={`tab-${b.key}`} onClick={() => onBagian(b.key)} className="pf-segmen-btn">
              {bagian === b.key && <motion.span layoutId={`pf-tab-pil-${unitId}`} className="pf-segmen-pil" transition={PEGAS} />}
              {b.label}
            </button>
          ))}
        </div>
      </header>

      <AnimatePresence>
        {pesan && <motion.p key="pesan" role="status" className="pf-pesan ok" data-testid="profil-pesan" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}><CheckCircle2 {...IK} size={16} className="mt-0.5 shrink-0" aria-hidden />{pesan}</motion.p>}
      </AnimatePresence>
      {error && (
        <div role="alert" data-testid="ruang-galat" className="rounded-btn bg-redbg px-3 py-3 text-[13px] text-red">
          <p className="m-0 font-medium">{error.pesan || (error.status === 404 ? "Unit tidak ditemukan atau sudah dihapus." : error.message || "Profil unit gagal dimuat.")}</p>
          <Button variant="secondary" size="sm" className="mt-2 min-h-[44px]" onClick={muat}>Coba lagi</Button>
        </div>
      )}
      {!data && !error && <div className="space-y-3" aria-label="Memuat unit" data-testid="ruang-memuat"><div className="h-24 animate-pulse rounded-card bg-inset motion-reduce:animate-none" /><div className="h-48 animate-pulse rounded-card bg-inset motion-reduce:animate-none" /></div>}

      {data && ruang && (
        // Ganti tab = isi baru langsung dipasang lalu memudar masuk (tanpa menunggu animasi keluar — tidak macet di tab latar/HP hemat daya).
          <motion.div key={bagian} id={`panel-${bagian}`} role="tabpanel" aria-labelledby={`tab-${bagian}`} tabIndex={0} className="pf-isi outline-none" data-testid={`panel-${bagian}`}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }}>
            {bagian === "ringkasan" && <RingkasanUnit data={data} ruang={ruang} aktif={aktif} onDone={sesudahUbah} onBagian={onBagian} onPesan={setPesan} adaMeja={adaMeja} fokusKelengkapan={fokusKelengkapan} />}
            {bagian === "bahan" && <BahanTab unitId={unitId} data={data} izin={izin} aktif={aktif} onDone={sesudahUbah} onReload={muat} />}
            {bagian === "dokumentasi" && <DokumentasiSection unitId={unitId} ruang={ruang} unit={u} onDone={sesudahUbah} onKeBagian={onBagian} />}
            {bagian === "riwayat" && <div className="flex flex-col gap-4"><RingkasanPemakaian data={data} />{data.riwayat?.length ? <RiwayatLini daftar={data.riwayat} /> : <p className="pf-kecil px-2">Belum ada riwayat untuk unit ini.</p>}</div>}
            {bagian === "meja" && <div className="pf-grup"><Unit360Isi unitId={unitId} tertanam onChanged={sesudahUbah} /></div>}
          </motion.div>
      )}
    </div>
  );
}
