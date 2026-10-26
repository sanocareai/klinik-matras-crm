import React, { useRef, useState } from "react";
import { AlertTriangle, ArrowLeftRight, Info, Pencil } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { formatJumlah, kunciIdempoten, pesanGalatAdopsi } from "@/features/production/orderProduksiModel.js";
import PemilihBahanKatalog from "@/features/production/bahan/PemilihBahanKatalog.jsx";
import { Kandidat } from "@/features/production/bahan/PembetulanUnitSelesai.jsx";
import { PESAN } from "@/features/production/bahan/pembetulanModel.js";
import { MODE, badanPengajuan, badanPenerapan, badanPratinjau, barisLangkah, bolehSimpan, labelJalur, sidikPerubahan, validasiPerubahan } from "@/features/production/bahan/perubahanModel.js";

// UBAH PEMAKAIAN per bahan — dibuka dari tombol "Edit" pada baris tabel Pemakaian aktual (unit berjalan DAN terkirim).
// Menampilkan nilai lama, isian baru, alasan, tanggal pemakaian (unit terkirim) dan dampak stok/HPP/Finance dari SERVER sebelum konfirmasi. Dua perubahan: ubah jumlah, atau ganti bahan (dua langkah resmi disimpan sekaligus).
// Ledger tidak pernah ditimpa; perubahan = baris baru. Jalur ditentukan server: LANGSUNG → "Simpan perubahan"; AJUKAN → "Ajukan perubahan" (menunggu persetujuan, stok belum berubah).
const kolom = "h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink3 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-60";

function Dampak({ pra }) {
  const baris = barisLangkah(pra);
  return (
    <div className="space-y-2 rounded-btn bg-inset px-3 py-3 text-[12.5px] text-ink" data-testid="edit-dampak" data-jalur={pra.jalur}>
      {pra.ringkas.map((t, i) => <p key={i} className={cn("m-0", i === 0 && "font-semibold")} data-testid={i === 0 ? "edit-ringkas" : "edit-ringkas-lain"}>{t}</p>)}
      {baris.length > 0 && (
        <ol className="m-0 list-none space-y-2 p-0" data-testid="edit-langkah">
          {baris.map((b) => (
            <li key={b.k} className="space-y-0.5 rounded-btn bg-surface px-3 py-2" data-testid="edit-langkah-baris">
              <p className="m-0 font-semibold">{b.judul}</p>
              <p className="m-0" data-testid="edit-langkah-stok">{b.stok}</p>
              <p className="m-0 text-ink2"><b>Finance:</b> {b.finance}</p>
              <p className="m-0 text-ink2" data-testid="edit-langkah-hpp"><b>HPP operasional:</b> {b.hpp}</p>
            </li>
          ))}
        </ol>
      )}
      <p className="m-0 text-ink2" data-testid="edit-waktu">{pra.waktu.teks}</p>
      {pra.penghalang.map((h, i) => <p key={`${h.kode}-${i}`} className="m-0 font-semibold text-red" role="alert" data-testid="edit-penghalang">{h.pesan}</p>)}
    </div>
  );
}

export default function EditPemakaianForm({ unitId, selesai, baris, izin, menunggu = null, onTutup, onSelesai }) {
  const [mode, setMode] = useState(MODE.UBAH); const [qtyBaru, setQtyBaru] = useState(String(baris.aktual).replace(".", ","));
  const [keBahan, setKeBahan] = useState(null); const [qtyKe, setQtyKe] = useState(""); const [alasan, setAlasan] = useState(""); const [tanggal, setTanggal] = useState(""); const [ajukan, setAjukan] = useState(false);
  const [pra, setPra] = useState(null); const [sidikPra, setSidikPra] = useState(""); const [sudahPeriksa, setSudahPeriksa] = useState(false); const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(null);
  const kunciRef = useRef(null); const sidikKunci = useRef(""); const kirimRef = useRef(false);
  const sidik = sidikPerubahan({ mode, materialId: baris.materialId, qtyBaru, keBahan, qtyKe, alasan, tanggal, ajukan });
  if (sidikKunci.current !== sidik) { sidikKunci.current = sidik; kunciRef.current = null; }
  const v = validasiPerubahan({ mode, qtyBaru, keBahan, qtyKe, alasan, tanggal, selesai, bersih: Number(baris.aktual) });
  const ubah = (fn) => (e) => { fn(e.target.value); setPra(null); setSudahPeriksa(false); setGalat(null); };
  const ganti = (m) => { setMode(m); setPra(null); setSudahPeriksa(false); setGalat(null); setAjukan(false); if (m === MODE.GANTI) setQtyBaru("0"); else { setQtyBaru(String(baris.aktual).replace(".", ",")); setKeBahan(null); setQtyKe(""); } };
  const siap = v.ok && !sibuk;
  const bolehKirim = bolehSimpan(pra, sidik, sidikPra, { sudahPeriksa });

  async function lihat() {
    if (!v.ok || sibuk) { setGalat({ message: v.galat || "Lengkapi isian dulu." }); return; }
    setSibuk(true); setGalat(null); setPra(null); setSudahPeriksa(false);
    try { setPra(await api.pratinjauPerubahanPemakaian(unitId, badanPratinjau({ mode, materialId: baris.materialId, v, keBahan, ajukan }))); setSidikPra(sidik); }
    catch (e) { setGalat(e); } finally { setSibuk(false); }
  }
  async function kirim() {
    if (kirimRef.current || !bolehKirim || !v.ok) return;
    kirimRef.current = true; setSibuk(true); setGalat(null); kunciRef.current ??= kunciIdempoten("ubah-pemakaian");
    try {
      let h;
      if (pra.jalur === "AJUKAN") { const r = await api.ajukanKoreksiPemakaian(unitId, badanPengajuan({ materialId: baris.materialId, v }), kunciRef.current); h = { jenis: "AJUKAN", nomor: r.nomor ?? r.correctionNumber ?? null }; }
      else { const r = await api.perubahanPemakaian(unitId, badanPenerapan(pra, { mode, materialId: baris.materialId, v, keBahan, sudahPeriksa }), kunciRef.current); h = { jenis: "LANGSUNG", ulang: !!r.ulang }; }
      await onSelesai?.(h); // induk menutup formulir dan menampilkan pesan hasil (LANGSUNG = tersimpan; AJUKAN = menunggu persetujuan)
    } catch (e) { setGalat(e); } finally { kirimRef.current = false; setSibuk(false); }
  }
  const g = galat ? pesanGalatAdopsi(galat) : null;
  const perluPeriksa = (pra?.langkah ?? []).filter((l) => l.sudahTercatat?.perluKonfirmasi);

  return (
    <div className="space-y-3 rounded-btn border border-line bg-surface px-3 py-3" data-testid="edit-form" data-mode={mode}>
      <div className="flex flex-wrap items-center gap-2"><Pencil size={14} className="text-ink2" aria-hidden /><p className="m-0 min-w-0 flex-1 text-[13.5px] font-semibold text-ink">Ubah pemakaian: {baris.nama} <span className="font-normal text-ink3">({baris.kode})</span></p></div>
      <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[13px] text-ink" data-testid="edit-nilai-lama">Tercatat sekarang: <b className="tabular-nums">{formatJumlah(baris.aktual)} {baris.satuan}</b></p>
      {menunggu && <p className="m-0 flex items-start gap-1.5 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-ink" data-testid="edit-menunggu"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />Ada perubahan untuk bahan ini yang masih menunggu persetujuan ({menunggu.nomor}). Selesaikan dulu agar tidak berbenturan.</p>}

      <div role="radiogroup" aria-label="Jenis perubahan" className="flex flex-wrap gap-2">
        {[[MODE.UBAH, "Ubah jumlah", Pencil], [MODE.GANTI, "Ganti bahan", ArrowLeftRight]].map(([k, label, Ikon]) => (
          <button key={k} type="button" role="radio" aria-checked={mode === k} data-testid={`edit-mode-${k.toLowerCase()}`} onClick={() => ganti(k)} disabled={sibuk}
            className={cn("flex min-h-[44px] items-center gap-1.5 rounded-btn border px-3 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent/50", mode === k ? "border-accent bg-accentbg text-ink" : "border-line bg-surface text-ink2 hover:bg-hovertint")}><Ikon size={14} aria-hidden />{label}</button>
        ))}
      </div>

      <label className="block"><span className="mb-1 block text-[12px] text-ink3">{mode === MODE.UBAH ? `Jumlah yang benar (${baris.satuan})` : `Bahan lama yang tetap dipakai (${baris.satuan}) — 0 bila tidak jadi dipakai`}</span>
        <input inputMode="decimal" value={qtyBaru} onChange={ubah(setQtyBaru)} data-testid="edit-qty" className={cn(kolom, "text-right tabular-nums")} disabled={sibuk} /></label>

      {mode === MODE.GANTI && (
        <div className="space-y-2" data-testid="edit-ganti">
          {keBahan
            ? <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[13px] text-ink" data-testid="edit-bahan-pengganti">Bahan pengganti: <b>{keBahan.nama}</b> <span className="text-ink3">({keBahan.kode}) · satuan {keBahan.satuan}{keBahan.tersedia != null ? ` · saldo ${formatJumlah(keBahan.tersedia)}` : " · stok belum diketahui"}</span> <button type="button" className="ml-2 text-[12px] text-accent underline" onClick={() => { setKeBahan(null); setPra(null); }}>ganti pilihan</button></p>
            : <PemilihBahanKatalog dipilihIds={new Set([baris.materialId])} onTambah={(k) => { setKeBahan({ materialId: k.materialId, nama: k.nama, kode: k.kode, satuan: k.satuan, tersedia: k.tersedia ?? null }); setPra(null); }} testid="edit-pemilih" />}
          {keBahan && <label className="block"><span className="mb-1 block text-[12px] text-ink3">Jumlah bahan pengganti ({keBahan.satuan})</span><input inputMode="decimal" value={qtyKe} onChange={ubah(setQtyKe)} data-testid="edit-qty-ke" className={cn(kolom, "text-right tabular-nums")} disabled={sibuk} /></label>}
        </div>
      )}

      {selesai && <label className="block"><span className="mb-1 block text-[12px] text-ink3">Tanggal pemakaian yang dilaporkan (wajib)</span><input type="date" value={tanggal} onChange={ubah(setTanggal)} data-testid="edit-tanggal" className={kolom} disabled={sibuk} /><span className="mt-1 block text-[11.5px] text-ink3" data-testid="edit-tanggal-penjelas">{PESAN.tanggalPenjelas}</span></label>}
      <label className="block"><span className="mb-1 block text-[12px] text-ink3">Alasan (wajib, tersimpan di riwayat)</span><textarea rows={2} maxLength={500} value={alasan} onChange={ubah(setAlasan)} data-testid="edit-alasan" className={cn(kolom, "h-auto py-2")} disabled={sibuk} /></label>
      {mode === MODE.UBAH && izin?.bolehAjukanPersetujuan !== false && (
        <label className="flex min-h-[44px] items-start gap-2 text-[12.5px] text-ink2"><input type="checkbox" checked={ajukan} onChange={(e) => { setAjukan(e.target.checked); setPra(null); setSudahPeriksa(false); }} data-testid="edit-ajukan" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]" disabled={sibuk} /><span>Minta persetujuan Owner/Finance dulu (stok baru berubah setelah disetujui orang lain)</span></label>
      )}

      <div className="flex flex-wrap gap-2"><Button variant="secondary" className="min-h-[44px]" onClick={lihat} disabled={sibuk || !v.ok} data-testid="edit-lihat">{sibuk && !pra ? "Menghitung…" : "Lihat dampak"}</Button></div>
      {!v.ok && (qtyBaru !== "" || alasan !== "" || tanggal !== "") && <p className="m-0 text-[12px] text-ink3" data-testid="edit-validasi">{v.galat}</p>}
      {pra && <Dampak pra={pra} />}
      {pra && perluPeriksa.map((l) => <Kandidat key={l.urutan} pra={{ ...l, bahan: l.bahan, sudahTercatat: l.sudahTercatat }} sudahPeriksa={sudahPeriksa} setSudahPeriksa={setSudahPeriksa} />)}
      {pra?.jalur === "AJUKAN" && pra.boleh && <p className="m-0 flex items-start gap-1.5 text-[12px] text-ink2" data-testid="edit-info-ajukan"><Info size={13} className="mt-0.5 shrink-0" aria-hidden />Stok belum berubah. Pengajuan menunggu persetujuan Owner/Finance (orang lain dari pemohon); sesudah disetujui, pergerakan tercatat sebagai baris baru bertaut pemakaian asal.</p>}
      {g && <p role="alert" data-testid="edit-galat" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{g.teks}</p>}
      <div className="flex items-stretch justify-end gap-2">
        <Button variant="neutral" className="min-h-[44px] shrink-0" onClick={onTutup} disabled={sibuk} data-testid="edit-batal">Batal</Button>
        <Button className="bh-cta min-h-[44px] min-w-0 flex-1 !h-auto whitespace-normal py-2 leading-tight sm:flex-none" data-testid="edit-konfirmasi" onClick={kirim} disabled={sibuk || !bolehKirim}>{sibuk && pra ? "Menyimpan…" : pra ? labelJalur(pra) : "Simpan perubahan"}</Button>
      </div>
      {!pra && siap && <p className="m-0 text-[11.5px] text-ink3">Tombol simpan aktif setelah Anda melihat dampaknya. Mengubah isian mengharuskan melihat dampak lagi.</p>}
      {pra && !bolehKirim && pra.boleh && perluPeriksa.length > 0 && !sudahPeriksa && <p className="m-0 text-[11.5px] text-orange" data-testid="edit-tunggu-periksa">Centang pernyataan pemeriksaan di atas untuk melanjutkan.</p>}
    </div>
  );
}
