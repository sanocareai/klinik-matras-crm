import React, { useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { formatJumlah, kunciIdempoten, parseJumlah, pesanGalatAdopsi, waktuWib } from "@/features/production/orderProduksiModel.js";
import { batasKoreksi, jalurKoreksi } from "@/features/production/bahan/bahanModel.js";
import { tglIndo } from "@/features/production/bahan/pembetulanModel.js";

// Riwayat pemakaian BAHAN BARU (ledger resmi): siapa, kapan, bahan, jumlah, satuan, dokumen sumber, dampak pada stok, dan (untuk perubahan/pembetulan) tanggal pemakaian yang dilaporkan + dasar harga HPP.
// Mengubah jumlah atau mengganti bahan = tombol "Edit" pada tabel Pemakaian aktual; baris di sini tidak pernah diedit/dihapus (perubahan = baris baru).
// PENGECUALIAN yang dipertahankan: bahan yang BERCAMPUR dengan pengeluaran dari dokumen Material Issue — Edit untuk bahan itu berupa pengajuan (persetujuan), sedangkan pengeluaran langsungnya tetap bisa
// dikoreksi langsung lewat tombol lama "Salah input? Koreksi" (unit berjalan; pengembalian baru sebesar yang salah) sampai ada padanan aman untuk jenis transaksi itu.
function Koreksi({ unitId, baris, total, onSelesai, onTutup }) {
  const maks = batasKoreksi(baris, total);
  const [qty, setQty] = useState(String(maks)); const [alasan, setAlasan] = useState(""); const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(null);
  const kunci = useRef(null); const sig = useRef(""); const kirimRef = useRef(false);
  const s = `${qty}|${alasan}`; if (sig.current !== s) { sig.current = s; kunci.current = null; }
  const v = parseJumlah(qty); const sah = v !== null && v > 0 && v <= maks + 0.00005 && alasan.trim().length >= 3;
  async function kirim() {
    if (kirimRef.current || !sah) return; kirimRef.current = true; setSibuk(true); setGalat(null);
    try { kunci.current ??= kunciIdempoten("koreksi-bahan"); await api.addUnitMaterial(unitId, { materialId: baris.materialId, qty: -Math.round(v * 10000) / 10000, note: `Koreksi atas ${baris.dokumen.nomor}: ${alasan.trim()}` }, kunci.current); await onSelesai(); }
    catch (e) { setGalat(e); } finally { kirimRef.current = false; setSibuk(false); }
  }
  const g = galat ? pesanGalatAdopsi(galat) : null;
  return (
    <div className="space-y-2 rounded-btn border border-line bg-surface px-3 py-3" data-testid="koreksi-bahan-form">
      <p className="m-0 text-[12.5px] text-ink2">Koreksi resmi: <b>pengembalian baru</b> ke stok sebesar yang salah. Catatan asli ({baris.dokumen.nomor}) <b>tidak diedit atau dihapus</b>; keduanya tampil di riwayat. Maksimal {formatJumlah(maks)} {baris.satuan} (pemakaian bersih bahan ini pada unit).</p>
      <div className="flex gap-2">
        <label className="block w-32 space-y-1"><span className="block text-[12px] text-ink3">Jumlah dikembalikan ({baris.satuan})</span><input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} disabled={sibuk} data-testid="koreksi-qty" className="h-11 w-full rounded-btn border border-line bg-surface px-3 text-right text-[14px] tabular-nums text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label>
        <label className="block flex-1 space-y-1"><span className="block text-[12px] text-ink3">Alasan koreksi (wajib)</span><input value={alasan} onChange={(e) => setAlasan(e.target.value)} maxLength={250} disabled={sibuk} data-testid="koreksi-alasan" placeholder="Mis. salah ketik, seharusnya 2,5" className="h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label>
      </div>
      {g && <p role="alert" data-testid="koreksi-galat" className="m-0 text-[12px] text-red">{g.teks}</p>}
      <div className="flex justify-end gap-2"><Button variant="neutral" className="min-h-[44px]" onClick={onTutup} disabled={sibuk}>Batal</Button><Button className="bh-cta min-h-[44px]" data-testid="koreksi-kirim" disabled={sibuk || !sah} onClick={kirim}>{sibuk ? "Mencatat…" : "Catat pengembalian ke stok"}</Button></div>
    </div>
  );
}

export default function RiwayatBahanBaru({ unitId = null, data, bolehUbah = false, aktif = false, onDone = null }) {
  const baris = data.pemakaianAktual?.baris ?? []; const total = data.pemakaianAktual?.total ?? [];
  const [buka, setBuka] = useState(null); const [semua, setSemua] = useState(false);
  const bahanDenganMI = new Set(baris.filter((x) => x.dokumen?.jenis === "Material Issue Gudang").map((x) => x.materialId));
  if (!baris.length) return null;
  const tampil = semua ? baris : baris.slice(0, 6);
  return (
    <div className="space-y-2" data-testid="riwayat-bahan-baru">
      <ul className="m-0 list-none divide-y divide-line rounded-btn bg-inset p-0" data-testid="aktual-baris">
        {tampil.map((b) => {
          const balik = b.tipe === "RETURN";
          return (
            <li key={b.id} className="space-y-1 px-3 py-2 text-[12.5px]" data-testid="aktual-riwayat-baris">
              <div className="flex items-baseline gap-2"><span className="min-w-0 flex-1 truncate font-medium text-ink">{b.nama}</span><span className={cn("shrink-0 font-semibold tabular-nums", balik ? "text-green" : "text-ink")}>{balik ? "−" : ""}{formatJumlah(Math.abs(b.qty))} {b.satuan}</span></div>
              <div className="text-ink3">{b.pelaku || "—"} · {b.dilaporkan ? "dicatat " : ""}{waktuWib(b.tanggal)}{b.dilaporkan ? <> · <b className="text-ink2" data-testid="aktual-dilaporkan">dilaporkan dipakai {tglIndo(b.dilaporkan)}</b></> : null} · {b.dokumen.jenis}{b.dokumen.nomor ? ` ${b.dokumen.nomor}` : ""}</div>
              {b.hppOperasional && <div className="text-ink3" data-testid="aktual-hpp-dasar">HPP operasional: {b.hppOperasional.status === "DINILAI" ? (b.hppOperasional.harga == null ? `ada harga pada ${tglIndo(b.hppOperasional.tanggalDasar)} (angka hanya untuk peran berizin)` : `harga ${formatJumlah(b.hppOperasional.harga)} per ${b.satuan} (${b.hppOperasional.dasarTeks})`) : b.hppOperasional.status === "TANPA_HARGA" ? `TANPA_HARGA / belum diketahui — belum ada harga pada ${tglIndo(b.hppOperasional.tanggalDasar)}` : b.hppOperasional.dasarTeks}</div>}
              <div className="flex flex-wrap items-center gap-1.5"><Badge variant={balik ? "green" : "orange"} className={balik ? "bh-ok" : "bh-b-orange"}>{balik ? "Menambah stok (koreksi)" : "Mengurangi stok"}</Badge>{b.catatan && <span className="text-ink3">{b.catatan}</span>}</div>
              {bolehUbah && aktif && unitId && bahanDenganMI.has(b.materialId) && jalurKoreksi(b).jenis === "langsung" && buka !== b.id && <Button variant="neutral" size="sm" className="min-h-[44px]" onClick={() => setBuka(b.id)} data-testid="koreksi-bahan-buka"><Undo2 size={13} aria-hidden /> Salah input? Koreksi</Button>}
              {buka === b.id && <Koreksi unitId={unitId} baris={b} total={total} onSelesai={async () => { setBuka(null); await onDone?.(); }} onTutup={() => setBuka(null)} />}
            </li>
          );
        })}
      </ul>
      {baris.length > 6 && <Button variant="tertiary" size="sm" className="min-h-[40px]" onClick={() => setSemua((v) => !v)}>{semua ? "Tampilkan lebih sedikit" : `Tampilkan semua (${baris.length})`}</Button>}
    </div>
  );
}
