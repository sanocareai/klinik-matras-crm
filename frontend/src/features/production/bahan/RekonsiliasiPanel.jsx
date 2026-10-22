import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { formatJumlah, pesanGalatAdopsi, waktuWib } from "@/features/production/orderProduksiModel.js";
import "@/features/production/bahan/bahan.css";

// Rekonsiliasi pemakaian sementara (hak Gudang). TIDAK ada jalur stok baru di sini: Gudang mencatat pengeluaran lewat jalur resmi yang SUDAH ada
// (Material Issue / pemakaian unit), lalu MENAUTKAN pergerakan itu — satu pergerakan hanya untuk satu catatan (tidak dihitung ganda).
// Atau menyatakan bahan itu BUKAN stok Gudang dengan alasan jelas. Rekonsiliasi sendiri tidak menulis pergerakan, biaya, atau jurnal.
const kolom = "w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink3 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30";

export default function RekonsiliasiPanel({ usage, onSelesai, onBatal }) {
  const [data, setData] = useState({ memuat: true, kandidat: [], petunjuk: "", galat: null });
  const [cara, setCara] = useState("TAUTKAN_ISSUE"); const [pilih, setPilih] = useState(""); const [catatan, setCatatan] = useState("");
  const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(null); const kirimRef = useRef(false);

  useEffect(() => {
    let batal = false;
    api.getKandidatPergerakanSementara(usage.id).then((d) => { if (!batal) setData({ memuat: false, kandidat: d.kandidat || [], petunjuk: d.petunjuk || "", galat: null }); })
      .catch((e) => { if (!batal) setData({ memuat: false, kandidat: [], petunjuk: "", galat: e }); });
    return () => { batal = true; };
  }, [usage.id]);

  const dipilih = data.kandidat.find((k) => k.stockMovementId === pilih) || null;
  const selisih = dipilih && (!dipilih.qtySama || !dipilih.satuanSama);
  const catatanMin = cara === "TANPA_STOK" ? 10 : selisih ? 10 : 0;
  const valid = (cara === "TANPA_STOK" || (!!dipilih && dipilih.satuanSama)) && catatan.trim().length >= catatanMin;

  async function simpan() {
    if (kirimRef.current || !valid) return;
    kirimRef.current = true; setSibuk(true); setGalat(null);
    try {
      await api.rekonsiliasiPemakaianSementara(usage.id, cara === "TANPA_STOK" ? { resolusi: "TANPA_STOK", catatan: catatan.trim() } : { resolusi: "TAUTKAN_ISSUE", stockMovementId: pilih, catatan: catatan.trim() || undefined });
      await onSelesai?.();
    } catch (e) { setGalat(e); } finally { kirimRef.current = false; setSibuk(false); }
  }
  const g = galat ? pesanGalatAdopsi(galat) : null;

  return (
    <div className="space-y-3 rounded-btn border border-line bg-surface px-3 py-3" data-testid="rekonsiliasi-panel">
      <p className="m-0 text-[13px] font-semibold text-ink">Selesaikan: {usage.name} — {formatJumlah(usage.qty)} {usage.uom}</p>
      <div role="radiogroup" aria-label="Cara menyelesaikan" className="flex flex-col gap-2 sm:flex-row">
        {[["TAUTKAN_ISSUE", "Tautkan ke pengeluaran stok resmi", "Stok sudah/akan dikurangi lewat Material Issue atau pemakaian unit yang sudah ada."], ["TANPA_STOK", "Bukan stok Gudang", "Mis. dibeli operator, milik pelanggan. Tidak ada pergerakan, biaya, atau jurnal."]].map(([k, judul, teks]) => (
          <button key={k} type="button" role="radio" aria-checked={cara === k} data-testid={`rekon-cara-${k}`} onClick={() => { setCara(k); setGalat(null); }}
            className={cn("flex-1 rounded-card border px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/50", cara === k ? "border-accent bg-accentbg" : "border-line hover:bg-hovertint")}>
            <span className="block text-[13px] font-semibold text-ink">{judul}</span><span className="block text-[12px] text-ink2">{teks}</span>
          </button>
        ))}
      </div>

      {cara === "TAUTKAN_ISSUE" && (
        <div className="space-y-2" data-testid="rekon-kandidat">
          {data.memuat && <p className="m-0 text-[12.5px] text-ink3">Memuat pengeluaran stok resmi pada unit ini…</p>}
          {data.galat && <p role="alert" className="m-0 text-[12.5px] text-red">{pesanGalatAdopsi(data.galat).teks}</p>}
          {!data.memuat && !data.galat && <p className="m-0 text-[12.5px] text-ink2">{data.petunjuk}</p>}
          {!data.memuat && !data.galat && data.kandidat.length === 0 && (
            <p className="m-0 flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-ink" data-testid="rekon-kosong"><AlertTriangle size={15} className="bh-warn mt-0.5 shrink-0" aria-hidden />Belum ada pengeluaran stok resmi pada unit ini yang bisa ditautkan. Catat dulu lewat jalur resmi (Pengeluaran Material, atau “Catat pemakaian aktual” di unit), lalu kembali ke sini.</p>
          )}
          <ul className="m-0 list-none space-y-1 p-0">
            {data.kandidat.map((k) => (
              <li key={k.stockMovementId}>
                <label className={cn("flex min-h-[48px] cursor-pointer items-start gap-3 rounded-btn border px-3 py-2", pilih === k.stockMovementId ? "border-accent bg-accentbg" : "border-line hover:bg-hovertint")}>
                  <input type="radio" name={`mv-${usage.id}`} checked={pilih === k.stockMovementId} onChange={() => setPilih(k.stockMovementId)} className="mt-1 h-5 w-5" data-testid="rekon-pilih" />
                  <span className="min-w-0 flex-1 text-[12.5px] text-ink"><b>{k.nama}</b> ({k.kode}) — {formatJumlah(k.qty)} {k.satuan}<span className="block text-ink3">{k.ref} · {k.oleh || "—"} · {waktuWib(k.at)}</span>
                    {!k.satuanSama && <span className="block bh-bad">Satuan berbeda dari catatan ({usage.uom}); tidak bisa ditautkan.</span>}
                    {k.satuanSama && !k.qtySama && <span className="block bh-warn">Jumlah berbeda dari catatan ({formatJumlah(usage.qty)} {usage.uom}); jelaskan selisihnya di catatan.</span>}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className="block"><span className="mb-1 block text-[12px] text-ink3">{cara === "TANPA_STOK" ? "Alasan (wajib, minimal 10 karakter)" : selisih ? "Penjelasan selisih (wajib, minimal 10 karakter)" : "Catatan (opsional)"}</span>
        <textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={2} maxLength={500} data-testid="rekon-catatan" className={cn(kolom, "py-2")} placeholder={cara === "TANPA_STOK" ? "mis. Dibeli operator di toko luar, tidak lewat stok Gudang" : ""} /></label>
      {g && <p role="alert" data-testid="rekon-galat" className="m-0 text-[12.5px] text-red">{g.teks}</p>}
      <p className="m-0 flex items-start gap-2 text-[12px] text-ink3"><CheckCircle2 size={13} className="mt-0.5 shrink-0" aria-hidden />Menyelesaikan tidak menulis pergerakan stok, biaya, atau jurnal. Riwayat asal catatan dan siapa yang menyelesaikannya tersimpan.</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="neutral" className="min-h-[44px]" onClick={onBatal} disabled={sibuk}>Tutup</Button>
        <Button className="bh-cta min-h-[44px]" data-testid="rekon-simpan" disabled={sibuk || !valid} onClick={simpan}>{sibuk ? "Menyimpan…" : cara === "TANPA_STOK" ? "Nyatakan bukan stok Gudang" : "Tautkan & selesaikan"}</Button>
      </div>
    </div>
  );
}
