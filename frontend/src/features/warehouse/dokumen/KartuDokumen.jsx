import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Info } from "lucide-react";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import AksiDokumen from "@/features/warehouse/aksi/AksiDokumen.jsx";
import AlurPenerimaan from "@/features/warehouse/penerimaan/AlurPenerimaan.jsx";

// KOMPONEN BERSAMA halaman detail dokumen Gudang (pola sederhana UX Tahap 2): memuat dokumen, kartu status (identitas + alur + dampak stok), kartu aksi (aksi dari server), dan kerangka halaman.
// MI/ST memakai komponen sendiri yang lebih kaya; Restok, Barang Rusak, Retur, Penyesuaian, dan Opname memakai ini.
const BADGE = { neutral: "neutral", accent: "accent", orange: "orange", green: "green", red: "red" };

/** Memuat dokumen + status sibuk + penghitung versi (untuk menutup panel aksi setelah dokumen berubah). */
export function useDokumen(ambil, id) {
  const [r, setR] = useState(null); const [galat, setGalat] = useState(""); const [memuat, setMemuat] = useState(true); const [sibuk, setSibuk] = useState(false); const [versi, setVersi] = useState(0);
  const muat = useCallback(async () => {
    setMemuat(true); setGalat("");
    try { const d = await ambil(id); setR(d); return d; } catch (e) { setGalat(e.message || "Gagal memuat dokumen"); return null; } finally { setMemuat(false); setVersi((v) => v + 1); }
  }, [ambil, id]);
  useEffect(() => { muat(); }, [muat]);
  return { r, galat, memuat, sibuk, setSibuk, versi, muat };
}

/** Kerangka halaman: judul, tautan kembali, keadaan memuat/galat. `children` dirender hanya bila dokumen ada. */
export function HalamanDokumen({ judul, subjudul, kembali, r, memuat, galat, onMuat, nama = "dokumen", children }) {
  if (memuat && !r) return <PageContainer><PageBody><p className="flex items-center gap-1.5 py-8 text-[13px] text-ink3"><Loader2 size={14} className="animate-spin" /> Memuat {nama}…</p></PageBody></PageContainer>;
  if (galat && !r) return <PageContainer><PageBody><p role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{galat}</p><Link to={kembali.to} className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent"><ArrowLeft size={13} /> Kembali ke {kembali.label}</Link></PageBody></PageContainer>;
  if (!r) return null;
  return (
    <PageContainer>
      <PageHeader title={judul} subtitle={<span data-testid="identitas-ringkas">{subjudul}</span>}
        actions={<Link to={kembali.to} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent max-sm:min-h-11"><ArrowLeft size={13} /> {kembali.label}</Link>} />
      <PageBody>
        {children}
        {galat && <p role="alert" className="text-[12px] text-red">{galat}</p>}
        <Button variant="ghost" size="sm" onClick={onMuat} disabled={memuat} className="self-start max-sm:min-h-11" data-testid="muat-ulang">{memuat ? <Loader2 size={14} className="animate-spin" /> : null} Muat ulang</Button>
      </PageBody>
    </PageContainer>
  );
}

/** Kartu status: lencana, identitas (daftar label–isi), alur, dan penjelasan dampak ke stok. identitas: [{ label, isi, testid?, lebar? }] */
export function KartuStatusDokumen({ tampilan: t, identitas = [], alurLabel, catatan, tambahan }) {
  return (
    <Card className="space-y-3 p-4" data-testid="kartu-identitas">
      <div className="flex flex-wrap items-center gap-2"><Badge variant={BADGE[t.warna] ?? "neutral"} data-testid="status-dokumen" data-kode={t.kode}>{t.label}</Badge>{tambahan}</div>
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-4">
        {identitas.map((x) => <div key={x.label} className={x.lebar ? "col-span-2" : undefined}><dt className="text-ink3">{x.label}</dt><dd className="m-0 font-medium text-ink" data-testid={x.testid}>{x.isi ?? "—"}</dd></div>)}
      </dl>
      <AlurPenerimaan tampilan={t} label={alurLabel} testid="alur-dokumen" className="pt-2" />
      <p className={`m-0 flex items-start gap-1.5 rounded-btn px-3 py-2 text-[12.5px] leading-snug ${t.pengaruhStok === "SUDAH" ? "bg-greenbg text-green" : "bg-inset text-ink2"}`} data-testid="penjelasan-status"><Info size={14} className="mt-0.5 shrink-0" aria-hidden /><span>{t.penjelasan}</span></p>
      {catatan && <p className="m-0 text-[12px] text-ink2" data-testid="catatan-dokumen">{catatan}</p>}
    </Card>
  );
}

/** Kartu "Yang bisa dilakukan sekarang": aksi dari server; akun hanya-lihat mendapat penjelasan, bukan tombol. */
export function KartuAksiDokumen({ tampilan: t, izin, spec, onJalankan, sibuk, versi, aksi = t.aksi, kaki, namaDokumen = "dokumen ini" }) {
  return (
    <Card className="space-y-2 p-4" data-testid="kartu-aksi">
      <h3 className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">Yang bisa dilakukan sekarang</h3>
      {aksi.length === 0 && <p className="m-0 text-[12.5px] text-ink3" data-testid="tanpa-aksi">{izin?.tulis === false && !izin?.bisaSetujui ? `Akun Anda hanya dapat melihat ${namaDokumen} (tidak punya izin mengubahnya).` : <>Tidak ada aksi untuk {namaDokumen} sekarang. {t.penjelasan}</>}</p>}
      <AksiDokumen aksi={aksi} spec={spec} onJalankan={onJalankan} sibuk={sibuk} ikutiVersi={versi} />
      {kaki && <p className="m-0 text-[11.5px] leading-snug text-ink3">{kaki}</p>}
    </Card>
  );
}
