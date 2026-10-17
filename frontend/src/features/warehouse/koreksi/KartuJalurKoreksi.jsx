import React, { useEffect, useState } from "react";
import { Loader2, Pencil, Undo2, Route, Lock, CheckCircle2, History } from "lucide-react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { JALUR_TAMPIL, STATUS_KOREKSI, JENIS_KOREKSI } from "./koreksiLogic.js";

const IKON = { edit: Pencil, koreksi: Undo2, alur: Route, blokir: Lock, final: CheckCircle2 };

/**
 * Kartu "Koreksi kesalahan input" pada detail dokumen Gudang. Jalur (EDIT_DRAF | KOREKSI_UI | ALUR_RESMI | DIBLOKIR | FINAL) dan langkah dihitung SERVER (satu sumber);
 * kartu ini hanya menampilkan dan menyediakan tombol aksi yang sesuai — TIDAK ada tombol "Edit" umum untuk semua status.
 * @param aksi  { KOREKSI_PENERIMAAN?: fn, KOREKSI_KEDATANGAN?: fn } — penangan tombol yang didukung layar pemanggil
 * @param versi nilai yang berubah saat dokumen dimuat ulang (mis. status/updatedAt) agar kartu ikut menyegarkan
 * @param ringkas hanya tampil bila RELEVAN (dokumen sudah memengaruhi stok / alur resmi / diblokir) dan tertutup sebagai satu baris; draf (sudah punya aksi di halaman) dan dokumen final tidak menampilkan kartu
 */
export default function KartuJalurKoreksi({ tipe, id, versi, aksi = {}, ringkas = false }) {
  const [data, setData] = useState(null);
  const [terbuka, setTerbuka] = useState(!ringkas);
  const [galat, setGalat] = useState("");
  useEffect(() => {
    if (!id) return undefined;
    let batal = false; setGalat("");
    api.getJalurKoreksi(tipe, id).then((d) => { if (!batal) setData(d); }).catch((e) => { if (!batal) setGalat(e.message); });
    return () => { batal = true; };
  }, [tipe, id, versi]);

  if (galat) return <p className="mt-3 text-[11.5px] text-ink3" data-testid="jalur-galat">Jalur koreksi tidak bisa dimuat: {galat}</p>;
  if (!data) return <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-ink3"><Loader2 size={12} className="animate-spin" /> Memuat jalur koreksi…</p>;
  if (ringkas && (data.jalur === "EDIT_DRAF" || data.jalur === "FINAL")) return null;
  const t = JALUR_TAMPIL[data.jalur] ?? JALUR_TAMPIL.DIBLOKIR; const Ikon = IKON[t.ikon] ?? Route;
  const tombol = (data.tindakan ?? []).filter((x) => typeof aksi[x.kode] === "function");
  return (
    <section className="mb-3 rounded-btn border border-border bg-inset px-3 py-2.5" data-testid="kartu-jalur-koreksi" data-jalur={data.jalur} aria-label="Koreksi kesalahan input">
      <div className="flex flex-wrap items-center gap-2">
        <Ikon size={14} className="text-ink3" />
        <h4 className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">Koreksi kesalahan input</h4>
        <Badge variant={t.warna} data-testid="jalur-label">{t.label}</Badge>
        {ringkas && <button type="button" onClick={() => setTerbuka((v) => !v)} aria-expanded={terbuka} className="ml-auto text-[12px] font-semibold text-accent max-sm:min-h-11" data-testid="jalur-toggle">{terbuka ? "Tutup" : "Perlu memperbaiki? Lihat caranya"}</button>}
      </div>
      {!terbuka ? <p className="mt-1 text-[12px] text-ink2" data-testid="jalur-judul-ringkas">{data.judul}</p> : <>
      <p className="mt-1.5 text-[12.5px] font-semibold text-ink" data-testid="jalur-judul">{data.judul}</p>
      <p className="mt-0.5 text-[11.5px] leading-snug text-ink2" data-testid="jalur-penjelasan">{data.penjelasan}</p>
      {data.langkah?.length > 0 && (
        <ol className="mb-0 mt-1.5 list-decimal space-y-0.5 pl-4 text-[11.5px] leading-snug text-ink2" data-testid="jalur-langkah">
          {data.langkah.map((l, i) => <li key={i}>{l}</li>)}
        </ol>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10.5px] text-ink3" data-testid="jalur-pengaruh">
        <span>Menyentuh:</span>
        <Badge variant={data.pengaruh?.stok ? "orange" : "neutral"}>Stok {data.pengaruh?.stok ? "ya" : "tidak"}</Badge>
        <Badge variant={data.pengaruh?.produksi ? "orange" : "neutral"}>Produksi {data.pengaruh?.produksi ? "ya" : "tidak"}</Badge>
        <Badge variant={data.pengaruh?.finance ? "orange" : "neutral"}>Finance {data.pengaruh?.finance ? "ya" : "tidak"}</Badge>
      </div>
      {tombol.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {tombol.map((x) => <Button key={x.kode} size="sm" variant="secondary" onClick={() => aksi[x.kode]()} data-testid={`aksi-${x.kode}`}><Pencil size={13} /> {x.label}</Button>)}
        </div>
      )}
      {data.riwayatKoreksi?.length > 0 && (
        <div className="mt-2.5 border-t border-line pt-2" data-testid="riwayat-koreksi">
          <h5 className="mb-1 flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide text-ink3"><History size={12} /> Riwayat koreksi (catatan asal tidak diubah)</h5>
          <ul className="m-0 list-none space-y-1 p-0">
            {data.riwayatKoreksi.map((k) => (
              <li key={k.id} className="text-[11.5px] text-ink2" data-testid="riwayat-koreksi-baris">
                <span className="font-semibold text-ink">{k.nomor}</span>{" "}
                <Badge variant={STATUS_KOREKSI[k.status]?.warna ?? "neutral"}>{STATUS_KOREKSI[k.status]?.label ?? k.status}</Badge>{" "}
                <span className="text-ink3">{JENIS_KOREKSI[k.jenis] ?? k.jenis} · {k.pemohon?.name ?? "—"} · {new Date(k.diajukanPada).toLocaleDateString("id-ID")}</span>
                <div className="text-ink3">Alasan: {k.alasan}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
      </>}
    </section>
  );
}
