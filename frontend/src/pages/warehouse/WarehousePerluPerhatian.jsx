import React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { api } from "@/api.js";
import { useJendelaFokus } from "@/features/warehouse/dokumen/useJendelaFokus.js";
import { waktuTeks } from "@/features/warehouse/dokumen/dokumenLogic.js";
import DokumenFokus from "@/features/warehouse/pusatkerja/DokumenFokus.jsx";
import { useSumberPusatKerja } from "@/features/warehouse/pusatkerja/usePusatKerja.js";
import { LABEL_CAKUPAN, WARNA_CAKUPAN, WARNA_PEMILIK, dalamHalaman, urlItem } from "@/features/warehouse/pusatkerja/urlFokus.js";

// PERLU PERHATIAN = PUSAT MASALAH Gudang (UX Gudang Tahap 4). Setiap baris menjawab: apa masalahnya, apa dampaknya, siapa yang harus bertindak, tindakan resmi apa, dan apa yang terhenti
// (satu bahan / satu dokumen / satu fitur / seluruh proses). Tidak ada blocker global untuk masalah satu bahan atau satu dokumen. Baca-saja: tautan hanya membuka dokumen atau halaman pemilik tindakan.
const PATH = "/warehouse/perlu-perhatian";

export default function WarehousePerluPerhatian() {
  const navigate = useNavigate(); const { jenis, id } = useParams();
  const { data, galat, memuat, muat } = useSumberPusatKerja(() => api.getPerluPerhatianGudang());
  const { bukaUrl, tutup } = useJendelaFokus(PATH);
  const buka = (item) => { const url = urlItem(PATH, item); if (!url) return; if (dalamHalaman(PATH, url)) bukaUrl(url); else navigate(url); };

  return (
    <PageContainer>
      <PageHeader
        title="Perlu Perhatian"
        subtitle="Masalah nyata di Gudang: apa, dampaknya, siapa yang bertindak, tindakan resminya, dan seberapa luas yang terhenti."
        actions={<Button variant="ghost" size="sm" onClick={() => muat()} disabled={memuat} className="max-sm:min-h-11" data-testid="muat-ulang-masalah"><RefreshCw size={14} className={memuat ? "animate-spin" : ""} /> Muat Ulang</Button>}
      />
      <PageBody>
        {galat && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red" data-testid="galat-masalah">{galat}<Button variant="ghost" size="sm" onClick={() => muat()} className="max-sm:min-h-11">Coba lagi</Button></div>}
        {memuat && !data && <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((n) => <div key={n} className="h-24 animate-pulse rounded-btn bg-inset" />)}</div>}
        {data && (
          <>
            <p className="m-0 text-[12px] text-ink3" data-testid="catatan-masalah">{data.catatan} Dihitung {waktuTeks(data.dihitungPada)}.</p>
            {data.masalah.length === 0 && <div className="flex items-center gap-2 rounded-btn bg-greenbg px-3 py-2.5 text-[13px] text-green" data-testid="tidak-ada-masalah"><CheckCircle2 size={15} aria-hidden /> Tidak ada masalah yang perlu perhatian saat ini.</div>}
            <ul className="m-0 list-none space-y-3 p-0">
              {data.masalah.map((m) => (
                <li key={m.kode}>
                  <Card className="space-y-2.5 p-4" data-testid="kartu-masalah" data-kode={m.kode}>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="m-0 text-[14px] font-semibold text-ink">{m.judul}</h2>
                      <Badge variant="neutral" data-testid="jumlah-masalah">{m.jumlah} {m.satuan}</Badge>
                      <Badge variant={WARNA_CAKUPAN[m.cakupan] ?? "neutral"} data-testid="cakupan-masalah" title={data.definisiCakupan?.[m.cakupan]}>Terhenti: {LABEL_CAKUPAN[m.cakupan] ?? m.cakupan}</Badge>
                      <Badge variant={WARNA_PEMILIK[m.pemilik] ?? "neutral"} data-testid="pemilik-masalah">Yang bertindak: {m.pemilikLabel}</Badge>
                    </div>
                    <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-[110px_1fr]">
                      <dt className="font-semibold text-ink3">Apa</dt><dd className="m-0 text-ink" data-testid="apa-masalah">{m.apa}</dd>
                      <dt className="font-semibold text-ink3">Dampak</dt><dd className="m-0 text-ink2" data-testid="dampak-masalah">{m.dampak}</dd>
                      <dt className="font-semibold text-ink3">Cakupan</dt><dd className="m-0 text-ink2">{m.cakupanTeks}</dd>
                      <dt className="font-semibold text-ink3">Tindakan resmi</dt>
                      <dd className="m-0"><ul className="m-0 list-none space-y-1 p-0">{m.tindakan.map((t) => <li key={t.label}><Link to={t.tautan} className="font-semibold text-accent max-sm:inline-flex max-sm:min-h-11 max-sm:items-center" data-testid="tindakan-masalah">{t.label}</Link></li>)}</ul></dd>
                    </dl>
                    {m.contoh.length > 0 && (
                      <div>
                        <p className="m-0 mb-1 text-[11px] font-bold uppercase tracking-wide text-ink3">Contoh ({m.contoh.length} dari {m.jumlah})</p>
                        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                          {m.contoh.map((c) => <li key={`${c.jenis}:${c.id}`}><button type="button" onClick={() => buka(c)} className="rounded-chip bg-inset px-2.5 py-1 text-left text-[12px] text-ink hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent max-sm:min-h-11" data-testid="contoh-masalah">{c.teks}</button></li>)}
                        </ul>
                      </div>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}
      </PageBody>
      <DokumenFokus jenis={jenis} id={id} onTutup={tutup} onBerubah={() => muat(true)} />
    </PageContainer>
  );
}
