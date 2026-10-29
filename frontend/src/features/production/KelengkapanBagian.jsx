import React, { useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { InfoToggleButton, InfoToggleIsi, useInfoToggle } from "@/components/ui/info-toggle.jsx";
import { Link } from "react-router-dom";
import { KELENGKAPAN_BUKAN, pesanGalatPernyataan, waktuWib } from "@/features/production/orderProduksiModel.js";

// KELENGKAPAN DATA unit (drawer Order Produksi) — klasifikasi yang SAMA dengan daftar/filter/ekspor (server: adopsi.kelengkapan). Membuka bagian ini TIDAK menulis apa pun.
// Satu-satunya tulisan di sini: pernyataan eksplisit "unit ini tanpa bahan baru" (alasan wajib, tercatat atas nama pengguna) — hanya bila unit memang selesai tanpa bahan, bukan tebakan sistem.

function BarisKekurangan({ it }) {
  const info = useInfoToggle();
  return (
    <li className="space-y-1" data-testid="kelengkapan-baris" data-kunci={it.key}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="orange" className="normal-case tracking-normal">{it.label}</Badge>
        <span className="min-w-0 flex-1 text-[13px] text-ink2">{it.alasan[0]?.teks}</span>
        {it.alasan.length > 1 && <InfoToggleButton info={info} label={`Semua alasan ${it.label}`} />}
      </div>
      {it.alasan.length > 1 && (
        <InfoToggleIsi info={info}>
          <ul className="m-0 list-disc space-y-1 pl-4">{it.alasan.map((a) => <li key={a.kode} data-testid="kelengkapan-alasan">{a.teks}</li>)}</ul>
        </InfoToggleIsi>
      )}
    </li>
  );
}

function PernyataanAktif({ p, bisa, unitId, onDone }) {
  const [cabut, setCabut] = useState(false); const [alasan, setAlasan] = useState(""); const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState("");
  async function kirim() {
    if (sibuk) return; setSibuk(true); setGalat("");
    try { await api.cabutTanpaBahan(unitId, alasan); setCabut(false); setAlasan(""); await onDone(); } catch (e) { setGalat(pesanGalatPernyataan(e)); } finally { setSibuk(false); }
  }
  return (
    <div className="space-y-2 rounded-btn bg-greenbg px-3 py-3 text-[13px] text-ink2" data-testid="pernyataan-aktif">
      <p className="m-0 flex flex-wrap items-center gap-1.5 font-medium text-ink"><CheckCircle2 size={15} className="text-green" aria-hidden /> Dinyatakan tanpa bahan baru</p>
      <p className="m-0">“{p.alasan}” — {p.oleh || "Admin"}, {waktuWib(p.at)}</p>
      <p className="m-0 text-[12px] text-ink3">Pernyataan ini hanya menandai bahwa unit memang tidak memakai bahan baru. Tidak membuat stok, Material Issue, atau biaya.</p>
      {bisa && !cabut && <Button variant="neutral" size="sm" className="min-h-[44px]" data-testid="pernyataan-cabut-buka" onClick={() => setCabut(true)}>Cabut pernyataan</Button>}
      {bisa && cabut && (
        <div className="space-y-2" data-testid="pernyataan-cabut-form">
          <label className="block text-[12px] font-medium text-ink3" htmlFor="cabut-alasan">Alasan mencabut (wajib)</label>
          <textarea id="cabut-alasan" rows={2} value={alasan} onChange={(e) => { setAlasan(e.target.value); setGalat(""); }} className="w-full rounded-btn border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" data-testid="pernyataan-cabut-alasan" />
          {galat && <p role="alert" className="m-0 text-[12.5px] text-red" data-testid="pernyataan-galat">{galat}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="neutral" size="sm" className="min-h-[44px]" onClick={() => { setCabut(false); setGalat(""); }} disabled={sibuk}>Batal</Button>
            <Button size="sm" className="min-h-[44px]" data-testid="pernyataan-cabut-ya" onClick={kirim} disabled={sibuk || alasan.trim().length < 5}>{sibuk ? "Menyimpan…" : "Cabut pernyataan"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FormNyatakan({ unitId, unitCode, onDone }) {
  const [buka, setBuka] = useState(false); const [alasan, setAlasan] = useState(""); const [konfirmasi, setKonfirmasi] = useState(false); const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState("");
  const kunciRef = useRef(null); const sigRef = useRef(""); const sig = alasan.trim();
  if (sigRef.current !== sig) { sigRef.current = sig; kunciRef.current = null; } // isian berubah → kunci baru; klik ganda/ulang dengan isian sama memakai kunci sama (idempoten)
  async function kirim() {
    if (sibuk) return; setSibuk(true); setGalat("");
    try {
      kunciRef.current = kunciRef.current || `tanpa-bahan-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
      await api.nyatakanTanpaBahan(unitId, alasan.trim(), kunciRef.current); setBuka(false); setKonfirmasi(false); setAlasan(""); await onDone();
    } catch (e) { setGalat(pesanGalatPernyataan(e)); } finally { setSibuk(false); }
  }
  if (!buka) return <Button variant="secondary" size="sm" className="min-h-[44px]" data-testid="pernyataan-buka" onClick={() => setBuka(true)}>Unit ini memang tanpa bahan baru</Button>;
  return (
    <div className="space-y-2 rounded-btn bg-inset px-3 py-3 text-[13px] text-ink2" data-testid="pernyataan-form">
      <p className="m-0 font-medium text-ink">Nyatakan unit {unitCode} tanpa bahan baru</p>
      <p className="m-0">Gunakan hanya bila pekerjaan unit ini memang tidak memakai bahan baru (mis. hanya servis/perbaikan). Pernyataan tercatat atas nama Anda dan bisa dicabut. Jangan dipakai bila bahannya hanya belum sempat dicatat.</p>
      <label className="block text-[12px] font-medium text-ink3" htmlFor="pernyataan-alasan">Alasan (wajib, minimal 5 huruf)</label>
      <textarea id="pernyataan-alasan" rows={2} value={alasan} onChange={(e) => { setAlasan(e.target.value); setGalat(""); setKonfirmasi(false); }} className="w-full rounded-btn border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" data-testid="pernyataan-alasan" placeholder="Mis. Hanya servis jahitan, tanpa bahan tambahan" />
      {galat && <p role="alert" className="m-0 text-[12.5px] text-red" data-testid="pernyataan-galat">{galat}</p>}
      {konfirmasi && <p className="m-0 rounded-btn bg-surface px-3 py-2 font-medium text-ink" data-testid="pernyataan-konfirmasi">Simpan pernyataan ini atas nama Anda? Unit {unitCode} tidak lagi tampil sebagai “Bahan belum dicatat”.</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="neutral" size="sm" className="min-h-[44px]" onClick={() => { setBuka(false); setKonfirmasi(false); setGalat(""); }} disabled={sibuk}>Batal</Button>
        {!konfirmasi
          ? <Button size="sm" className="min-h-[44px]" data-testid="pernyataan-lanjut" onClick={() => setKonfirmasi(true)} disabled={alasan.trim().length < 5}>Lanjut</Button>
          : <Button size="sm" className="min-h-[44px]" data-testid="pernyataan-simpan" onClick={kirim} disabled={sibuk}>{sibuk ? "Menyimpan…" : "Ya, simpan pernyataan"}</Button>}
      </div>
    </div>
  );
}

export default function KelengkapanBagian({ data, aktif, onDone }) {
  const kel = data?.adopsi?.kelengkapan; const unit = data?.unit;
  const info = useInfoToggle(); const izin = data?.izin ?? {};
  if (!kel || !unit) return null;
  const items = kel.keys.map((k) => kel.items[k]).filter(Boolean);
  const aktifPernyataan = data?.pernyataanTanpaBahan?.aktif ?? null;
  const bisaNyatakan = !!izin.pernyataanTanpaBahan && aktif && kel.items.BAHAN_BELUM_DICATAT;
  // Lengkap dan tanpa pernyataan: tidak ada yang perlu ditampilkan (tanpa bising)
  if (!items.length && !aktifPernyataan) return null;
  const lengkap = !items.length;
  return (
    <section id="sec-kelengkapan" aria-labelledby="sec-kelengkapan-judul" className="scroll-mt-4 border-t border-line pt-5" data-testid="kelengkapan-bagian" data-lengkap={lengkap ? "1" : "0"}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 id="sec-kelengkapan-judul" className="m-0 text-[15px] font-semibold text-ink">Kelengkapan data</h3>
        {lengkap ? <Badge variant="green" className="normal-case tracking-normal">Lengkap menurut aturan saat ini</Badge> : <Badge variant="orange" className="normal-case tracking-normal" data-testid="kelengkapan-ringkas">{kel.ringkas}</Badge>}
        <InfoToggleButton info={info} label="Apa yang dihitung sebagai kekurangan" />
      </div>
      <InfoToggleIsi info={info}>
        <p className="m-0">{KELENGKAPAN_BUKAN}</p>
        <p className="m-0">HPP di sini adalah HPP operasional (harga berlaku Gudang pada waktu pemakaian). Bukan nilai persediaan dan bukan biaya/jurnal Finance.</p>
        <p className="m-0">Daftar ini memakai aturan yang sama dengan penyaring di Order Produksi dan Export Excel.</p>
      </InfoToggleIsi>
      {items.length > 0 && <ul className="m-0 mt-2 list-none space-y-3 p-0" data-testid="kelengkapan-daftar">{items.map((it) => <BarisKekurangan key={it.key} it={it} />)}</ul>}
      {kel.keys.includes("HPP_BELUM_LENGKAP") && (
        <p className="m-0 mt-3 text-[12.5px] text-ink3" data-testid="kelengkapan-hpp-arah">Harga operasional bahan diisi oleh Gudang di <Link to="/warehouse/inventory" className="font-medium text-accent underline">Stok &amp; Lokasi</Link> (Harga Berlaku). Pemakaian lama diberi harga lewat penerapan khusus berpersetujuan — tidak otomatis.</p>
      )}
      {kel.keys.includes("DATA_ORDER_KURANG") && (
        <p className="m-0 mt-3 text-[12.5px] text-ink3" data-testid="kelengkapan-order-arah">Lengkapi di Finance › Penjualan Karyawan. Setelah dilengkapi, status ini hilang otomatis.</p>
      )}
      {aktifPernyataan && <div className="mt-3"><PernyataanAktif p={aktifPernyataan} bisa={!!izin.pernyataanTanpaBahan && aktif} unitId={unit.id} onDone={onDone} /></div>}
      {bisaNyatakan && !aktifPernyataan && <div className="mt-3"><FormNyatakan unitId={unit.id} unitCode={unit.unitCode} onDone={onDone} /></div>}
      {kel.items.BAHAN_BELUM_DICATAT && !izin.pernyataanTanpaBahan && !aktifPernyataan && (
        <p className="m-0 mt-3 text-[12.5px] text-ink3" data-testid="pernyataan-tanpa-izin">Catat bahan lewat “Pemakaian aktual”. Menyatakan unit tanpa bahan baru hanya untuk Admin, Owner, atau Kepala Produksi.</p>
      )}
    </section>
  );
}
