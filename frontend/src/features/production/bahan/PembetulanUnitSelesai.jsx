import React, { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Wrench } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { cn } from "@/lib/utils.js";
import { formatJumlah, kunciIdempoten, pesanGalatAdopsi, waktuWib } from "@/features/production/orderProduksiModel.js";
import PemilihBahanKatalog from "@/features/production/bahan/PemilihBahanKatalog.jsx";
import FormSementaraKatalog from "@/features/production/bahan/FormSementaraKatalog.jsx";
import FormKomponenLama from "@/features/production/bahan/FormKomponenLama.jsx";
import { SATUAN_KOMPONEN } from "@/features/production/bahan/bahanModel.js";
import { JENIS_PRATINJAU, PESAN, barisDampak, bolehKonfirmasi, daftarSudahTercatat, perluKonfirmasiGanda, sidikIsian, tglIndo, tubuhPembetulan, validasiPembetulan } from "@/features/production/bahan/pembetulanModel.js";

// TAMBAH PEMAKAIAN pada unit TERKIRIM (dibuka dari tombol "+ Tambah pemakaian" → pilihan sumber). Unit dibatalkan tidak termasuk.
// Tiga sumber (cara): TAMBAH = Bahan Gudang (pengeluaran stok baru lewat POST /units/:id/materials), SEMENTARA = bahan belum tercatat (pemakaian sementara, tanpa stok), KOMPONEN = komponen lama (tanpa stok).
// Wajib: alasan + TANGGAL PEMAKAIAN yang dilaporkan (terpisah dari waktu pencatatan). Dampak (stok, jurnal Finance, HPP operasional, kemungkinan sudah tercatat) tampil SEBELUM konfirmasi.
// Mengubah/mengganti bahan yang SUDAH tercatat = tombol "Edit" pada tabel (EditPemakaianForm). Sistem tidak pernah menautkan otomatis transaksi lama; pengguna memeriksa daftar dan menyatakannya.
const kolom = "h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink3 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-60";

export function Kandidat({ pra, sudahPeriksa, setSudahPeriksa }) {
  const daftar = daftarSudahTercatat(pra); const wajibPeriksa = perluKonfirmasiGanda(pra);
  if (!daftar.length) return pra.stok ? <p className="m-0 text-[12px] text-ink3" data-testid="ganda-kosong">Tidak ada pengeluaran bahan ini yang tertaut ke unit, dan tidak ada transaksi lain yang tampak relevan.</p> : null;
  return (
    <div className={cn("space-y-2 rounded-btn px-3 py-3 text-[12.5px]", wajibPeriksa ? "border border-orange bg-orangebg" : "bg-inset")} data-testid="ganda-panel">
      <p className="m-0 flex items-start gap-2 font-semibold text-ink"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />{wajibPeriksa ? "Periksa dulu — kemungkinan sudah tercatat" : "Pengeluaran yang sudah tertaut ke unit"}</p>
      <p className="m-0 text-ink2">{pra.sudahTercatat.catatan}</p>
      <ul className="m-0 list-none space-y-1.5 p-0" data-testid="ganda-daftar">
        {daftar.map((x) => (
          <li key={`${x.kind}-${x.id}`} className="rounded-btn bg-surface px-3 py-2" data-testid="ganda-baris" data-kind={x.kind}>
            <p className="m-0 font-medium text-ink">{x.jenisTeks}{x.qty != null ? ` · ${formatJumlah(x.qty)} ${x.uom ?? pra.bahan?.satuan ?? ""}` : ""}{x.unit ? ` · ${x.unit}` : ""}{x.nomor ? ` · ${x.nomor}` : ""}</p>
            <p className="m-0 text-ink3">{x.dicatatPada ? `Dicatat ${waktuWib(x.dicatatPada)}` : ""}{x.dilaporkan ? ` · dilaporkan dipakai ${tglIndo(x.dilaporkan)}` : ""}{x.oleh ? ` · oleh ${x.oleh}` : ""}</p>
            {x.catatan && <p className="m-0 text-ink2">{x.catatan}</p>}
            <p className="m-0 text-[11.5px] text-ink3">Muncul karena: {x.alasan.join("; ")}.</p>
          </li>
        ))}
      </ul>
      {wajibPeriksa && <label className="flex min-h-[44px] items-start gap-2 text-[13px] text-ink"><input type="checkbox" checked={sudahPeriksa} onChange={(e) => setSudahPeriksa(e.target.checked)} data-testid="ganda-konfirmasi" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]" /><span>{PESAN.periksaGanda}</span></label>}
    </div>
  );
}

function Dampak({ pra }) {
  return (
    <div className="space-y-1.5 rounded-btn bg-inset px-3 py-3 text-[12.5px] text-ink" data-testid="pembetulan-dampak">
      {barisDampak(pra).map((b) => <p key={b.k} className={cn("m-0", b.k === "tindakan" && "rounded-btn px-2 py-1.5 font-semibold", b.k === "tindakan" && (b.tegas ? "bg-orangebg text-ink" : "bg-accentbg text-ink"))} data-testid={`dampak-${b.k}`}>{b.k !== "tindakan" && <b>{b.label}: </b>}{b.teks}</p>)}
      {pra.penghalang.map((h) => <p key={h.kode} className="m-0 font-semibold text-red" role="alert" data-testid="pembetulan-penghalang">{h.pesan}</p>)}
    </div>
  );
}

const JUDUL = { TAMBAH: "Tambah pemakaian — Bahan Gudang", SEMENTARA: "Tambah pemakaian — Bahan belum tercatat", KOMPONEN: "Tambah pemakaian — Komponen lama" };

export default function PembetulanUnitSelesai({ unitId, kodeUnit, izin, cara, onTutup, onDone }) {
  const [bahan, setBahan] = useState(null); const [qty, setQty] = useState(""); const [alasan, setAlasan] = useState(""); const [tanggal, setTanggal] = useState("");
  const [nama, setNama] = useState(""); const [uom, setUom] = useState("PCS"); const [asal, setAsal] = useState(""); const [catatan, setCatatan] = useState("");
  const [pra, setPra] = useState(null); const [sidikPra, setSidikPra] = useState(""); const [sudahPeriksa, setSudahPeriksa] = useState(false); const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(null); const [hasil, setHasil] = useState(null); const [stokTakDiketahui, setStokTakDiketahui] = useState(false);
  const kunciRef = useRef(null); const sidikKunci = useRef(""); const kirimRef = useRef(false);
  const bolehTulis = !!izin.pemakaianAktual;
  const sidik = sidikIsian({ cara, bahan, qty: cara === "SEMENTARA" ? `${nama}|${qty}|${uom}|${asal}|${catatan}` : qty, alasan, tanggal });
  if (sidikKunci.current !== sidik) { sidikKunci.current = sidik; kunciRef.current = null; }
  const v = validasiPembetulan({ cara, bahan: cara === "SEMENTARA" ? { materialId: "-" } : bahan, qty, alasan, tanggal, maks: null });
  const namaOk = cara !== "SEMENTARA" || nama.trim().length >= 3;
  const siap = v.ok && namaOk;
  const siapKonfirmasi = bolehKonfirmasi(pra, sidik, sidikPra, { sudahPeriksa });

  const ubah = (fn) => (e) => { fn(e.target.value); setPra(null); setSudahPeriksa(false); };
  async function lihat() {
    if (!siap || sibuk) { setGalat({ message: v.galat || "Lengkapi isian dulu." }); return; }
    setSibuk(true); setGalat(null); setPra(null); setSudahPeriksa(false);
    try {
      setPra(await api.pratinjauPembetulanBahan(unitId, { jenis: JENIS_PRATINJAU[cara], tanggalPemakaian: v.tanggal, ...(cara === "TAMBAH" ? { materialId: bahan.materialId, qty: v.qty } : {}) })); setSidikPra(sidik);
    } catch (e) { setGalat(e); } finally { setSibuk(false); }
  }
  async function konfirmasi() {
    if (kirimRef.current || !siapKonfirmasi || !v.ok) return;
    kirimRef.current = true; setSibuk(true); setGalat(null); kunciRef.current ??= kunciIdempoten("pembetulan");
    try {
      if (cara === "SEMENTARA") { await api.catatPemakaianSementara(unitId, { name: nama.trim(), qty: v.qty, uom, originNote: asal.trim() || undefined, note: catatan.trim() || undefined, alasanPembetulan: v.alasan, tanggalPemakaian: v.tanggal }, kunciRef.current); setHasil({ jenis: "sementara" }); }
      else { await api.addUnitMaterial(unitId, tubuhPembetulan({ cara, bahan, qty: v.qty, alasan: v.alasan, tanggal: v.tanggal, pra, sudahPeriksa }), kunciRef.current); setHasil({ jenis: "tambah" }); }
      await onDone?.();
    } catch (e) { setGalat(e); } finally { kirimRef.current = false; setSibuk(false); }
  }
  const g = galat ? pesanGalatAdopsi(galat) : null;
  const tolakKarenaStok = pra?.penghalang?.some((h) => h.kode === "STOK_BELUM_DIKETAHUI");

  return (
    <section className="space-y-3" data-testid="pembetulan-unit-selesai" aria-label="Tambah pemakaian unit terkirim">
      <div className="flex flex-wrap items-center gap-2"><Wrench size={16} className="text-ink2" aria-hidden /><h4 className="m-0 text-[14px] font-semibold text-ink">{JUDUL[cara]}</h4><Badge variant="orange">alasan + tanggal wajib</Badge></div>
      <p className="m-0 text-[12.5px] text-ink2" data-testid="pembetulan-pengantar">{PESAN.bukaSelesai}</p>

      {!bolehTulis ? <p className="m-0 text-[12.5px] text-ink3" data-testid="pembetulan-hanya-lihat">{PESAN.tanpaIzin}</p> : hasil ? (
        <div className="space-y-2">
          <p role="status" data-testid="pembetulan-hasil" className="m-0 flex items-start gap-2 rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green"><CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden />
            {hasil.jenis === "tambah" ? "PENGELUARAN STOK baru dicatat sebagai baris baru di riwayat; stok dan HPP order sudah diperbarui."
              : "Catatan pemakaian sementara ditambahkan (stok tidak berubah). Tampil di bagian “Bahan belum ada di katalog” berstatus Perlu rekonsiliasi Gudang."}</p>
          <div className="flex justify-end"><Button variant="neutral" className="min-h-[44px]" onClick={onTutup} data-testid="pembetulan-tutup">Tutup</Button></div>
        </div>
      ) : (
        <>
          {!(cara === "TAMBAH" && stokTakDiketahui) && (
            <div className="space-y-3 rounded-card border border-line px-4 py-4" data-testid="pembetulan-form">
              <p className="m-0 text-[12px] text-ink3" data-testid="pembetulan-tanggal-penjelas">{PESAN.tanggalPenjelas}</p>
              {cara === "TAMBAH" && (bahan
                ? <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[13px] text-ink" data-testid="pembetulan-bahan">{bahan.nama} <span className="text-ink3">({bahan.kode}) · satuan {bahan.satuan}{bahan.tersedia != null ? ` · saldo ${formatJumlah(bahan.tersedia)}` : " · stok belum diketahui"}</span> <button type="button" className="ml-2 text-[12px] text-accent underline" onClick={() => { setBahan(null); setPra(null); }}>ganti</button></p>
                : <PemilihBahanKatalog dipilihIds={new Set()} onTambah={(k) => { setBahan({ materialId: k.materialId, nama: k.nama, kode: k.kode, satuan: k.satuan, tersedia: k.tersedia ?? null }); setPra(null); }} testid="pembetulan-pemilih" />)}
              {cara === "SEMENTARA" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block sm:col-span-2"><span className="mb-1 block text-[12px] text-ink3">Nama bahan (belum ada di katalog)</span><input className={kolom} value={nama} onChange={ubah(setNama)} maxLength={120} data-testid="pembetulan-nama" placeholder="Mis. Busa potongan sisa" /></label>
                  <label className="block"><span className="mb-1 block text-[12px] text-ink3">Satuan</span><select className={kolom} value={uom} onChange={ubah(setUom)} data-testid="pembetulan-satuan">{SATUAN_KOMPONEN.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
                  <label className="block"><span className="mb-1 block text-[12px] text-ink3">Asal barang (opsional)</span><input className={kolom} value={asal} onChange={ubah(setAsal)} maxLength={300} data-testid="pembetulan-asal" /></label>
                  <label className="block sm:col-span-2"><span className="mb-1 block text-[12px] text-ink3">Catatan (opsional)</span><input className={kolom} value={catatan} onChange={ubah(setCatatan)} maxLength={300} data-testid="pembetulan-catatan" /></label>
                </div>
              )}
              {cara !== "KOMPONEN" && (
                <label className="block"><span className="mb-1 block text-[12px] text-ink3">{`Jumlah (${bahan?.satuan ?? (cara === "SEMENTARA" ? uom : "satuan")})`}</span>
                  <input inputMode="decimal" value={qty} onChange={ubah(setQty)} data-testid="pembetulan-qty" className={cn(kolom, "text-right tabular-nums")} /></label>
              )}
              <label className="block"><span className="mb-1 block text-[12px] text-ink3">Tanggal pemakaian yang dilaporkan (wajib)</span><input type="date" value={tanggal} onChange={ubah(setTanggal)} data-testid="pembetulan-tanggal" className={kolom} /></label>
              <label className="block"><span className="mb-1 block text-[12px] text-ink3">Alasan (wajib, tersimpan di riwayat)</span>
                <textarea rows={2} maxLength={500} value={alasan} onChange={ubah(setAlasan)} data-testid="pembetulan-alasan" className={cn(kolom, "h-auto py-2")} /></label>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" className="min-h-[44px]" onClick={lihat} disabled={sibuk || !siap} data-testid="pembetulan-lihat">{sibuk && !pra ? "Menghitung…" : "Lihat dampak"}</Button>
                {tolakKarenaStok && izin.catatPemakaianSementara && <Button variant="neutral" className="min-h-[44px]" data-testid="pembetulan-ke-sementara" onClick={() => setStokTakDiketahui(true)}>Catat sementara — stok belum diketahui (hanya catatan)</Button>}
              </div>
              {!siap && (qty !== "" || alasan !== "" || tanggal !== "" || cara === "KOMPONEN") && <p className="m-0 text-[12px] text-ink3" data-testid="pembetulan-validasi">{v.galat || (!namaOk ? "Nama bahan minimal 3 huruf." : "")}</p>}
              {pra && <Dampak pra={pra} />}
              {pra && <Kandidat pra={pra} sudahPeriksa={sudahPeriksa} setSudahPeriksa={setSudahPeriksa} />}
              {cara === "KOMPONEN" && pra && <FormKomponenLama key="pembetulan-komp" unitId={unitId} kodeUnit={kodeUnit} meta={{ fotoMaks: 3 }} pembetulan={{ alasan: v.alasan, tanggal: v.tanggal, siap: siapKonfirmasi }} onSelesai={async () => { setHasil({ jenis: "komponen" }); await onDone?.(); onTutup?.(); }} onBatal={onTutup} />}
              {g && <p role="alert" data-testid="pembetulan-galat" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{g.teks}</p>}
              {cara !== "KOMPONEN" && (
                <div className="flex items-stretch justify-end gap-2"><Button variant="neutral" className="min-h-[44px] shrink-0" onClick={onTutup} disabled={sibuk}>Batal</Button>
                  <Button className="bh-cta min-h-[44px] min-w-0 flex-1 !h-auto whitespace-normal py-2 leading-tight sm:flex-none" data-testid="pembetulan-konfirmasi" onClick={konfirmasi} disabled={sibuk || !siapKonfirmasi}>{sibuk && pra ? "Menyimpan…" : cara === "SEMENTARA" ? "Konfirmasi: tambah CATATAN (tanpa stok)" : "Konfirmasi: buat PENGELUARAN STOK baru"}</Button></div>
              )}
              {!pra && siap && <p className="m-0 text-[11.5px] text-ink3">Konfirmasi aktif setelah Anda melihat dampaknya. Mengubah isian mengharuskan melihat dampak lagi.</p>}
              {pra && !siapKonfirmasi && cara !== "KOMPONEN" && perluKonfirmasiGanda(pra) && !sudahPeriksa && <p className="m-0 text-[11.5px] text-orange" data-testid="pembetulan-tunggu-periksa">Centang pernyataan pemeriksaan di atas untuk melanjutkan.</p>}
            </div>
          )}
          {cara === "TAMBAH" && stokTakDiketahui && bahan && (
            <FormSementaraKatalog key={`pembetulan-sem-${bahan.materialId}`} unitId={unitId} kodeUnit={kodeUnit} bahan={bahan} qtyAwal={qty} alasanPembetulan={alasan.trim()} tanggalPembetulan={tanggal} onSelesai={async () => { setHasil({ jenis: "sementara" }); await onDone?.(); }} onBatal={() => setStokTakDiketahui(false)} />
          )}
        </>
      )}
    </section>
  );
}
