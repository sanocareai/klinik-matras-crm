import React, { useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Wrench } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { cn } from "@/lib/utils.js";
import { formatJumlah, kunciIdempoten, pesanGalatAdopsi } from "@/features/production/orderProduksiModel.js";
import PemilihBahanKatalog from "@/features/production/bahan/PemilihBahanKatalog.jsx";
import FormSementaraKatalog from "@/features/production/bahan/FormSementaraKatalog.jsx";
import { CARA, JALUR, PESAN, barisDampak, bolehKonfirmasi, sidikIsian, tubuhPembetulan, validasiPembetulan, KATA_STATUS } from "@/features/production/bahan/pembetulanModel.js";

// PEMBETULAN BAHAN pada unit yang SUDAH selesai/terkirim — akses langsung dari drawer Order Produksi (dan tab Bahan Ruang Kerja Unit).
// Memakai layanan resmi yang sudah ada: pengeluaran/pengembalian stok (POST /units/:id/materials), koreksi jumlah berpersetujuan (koreksi-pemakaian), pemakaian sementara (provisional-usages).
// Alasan WAJIB (server menolak tanpa alasan untuk unit selesai); dampak stok / jurnal Finance / HPP operasional ditampilkan SEBELUM konfirmasi; baris lama tidak diubah.
// Dua jalur dipisah tegas: (A) catatan yang belum menjadi pengeluaran stok vs (B) pengeluaran stok yang sudah terjadi.
const kolom = "h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink3 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-60";

function Dampak({ pra, ajukan }) {
  if (ajukan) {
    return (
      <div className="space-y-1 rounded-btn bg-inset px-3 py-3 text-[12.5px] text-ink" data-testid="pembetulan-dampak">
        <p className="m-0"><b>Pemakaian bahan pada unit:</b> {formatJumlah(pra.bersihSebelum)} → {formatJumlah(pra.bersihSesudah)} {pra.bahan?.unit}</p>
        <p className="m-0"><b>Stok:</b> {formatJumlah(pra.saldoSebelum)} → {formatJumlah(pra.saldoSesudah)} {pra.bahan?.unit} <span className="text-ink3">(baru berlaku setelah disetujui orang lain)</span></p>
        <p className="m-0"><b>Nilai perkiraan:</b> {pra.nilaiPerkiraan != null ? `Rp${Math.abs(pra.nilaiPerkiraan).toLocaleString("id-ID")} (bukan final)` : "belum ada harga perolehan — tidak dihitung (bukan Rp0)"}</p>
        {!pra.boleh && <p className="m-0 font-semibold text-red">{pra.penghalang?.[0]?.pesan}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-1.5 rounded-btn bg-inset px-3 py-3 text-[12.5px] text-ink" data-testid="pembetulan-dampak">
      {barisDampak(pra).map((b) => <p key={b.k} className="m-0" data-testid={`dampak-${b.k}`}><b>{b.label}:</b> {b.teks}</p>)}
      {pra.dampak?.slice(-2).map((t, i) => <p key={i} className="m-0 text-ink3">{t}</p>)}
      {pra.penghalang.map((h) => <p key={h.kode} className="m-0 font-semibold text-red" role="alert" data-testid="pembetulan-penghalang">{h.pesan}</p>)}
    </div>
  );
}

export default function PembetulanUnitSelesai({ unitId, kodeUnit, status, data, izin, onDone }) {
  const [cara, setCara] = useState(null); const [bahan, setBahan] = useState(null); const [qty, setQty] = useState(""); const [alasan, setAlasan] = useState("");
  const [pra, setPra] = useState(null); const [sidikPra, setSidikPra] = useState(""); const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(null); const [hasil, setHasil] = useState(null); const [sementara, setSementara] = useState(false);
  const kunciRef = useRef(null); const sidikKunci = useRef(""); const kirimRef = useRef(false);
  const baris = data.pemakaianAktual?.baris ?? []; const total = data.pemakaianAktual?.total ?? [];
  const bolehTulis = !!izin.pemakaianAktual;
  const bahanTercatat = useMemo(() => { const m = new Map(); for (const b of baris) if (!m.has(b.materialId)) m.set(b.materialId, { materialId: b.materialId, nama: b.nama, kode: b.kode ?? null, satuan: b.satuan }); return [...m.values()].map((b) => ({ ...b, dipakai: Number(total.find((t) => t.materialId === b.materialId)?.dipakai ?? 0) })); }, [baris, total]);
  const sidik = sidikIsian({ cara, bahan, qty, alasan });
  if (sidikKunci.current !== sidik) { sidikKunci.current = sidik; kunciRef.current = null; }
  const maks = cara === "KURANGI" ? bahanTercatat.find((b) => b.materialId === bahan?.materialId)?.dipakai ?? 0 : null;
  const v = validasiPembetulan({ cara, bahan, qty, alasan, maks });
  const siapKonfirmasi = cara === "AJUKAN" ? !!pra && pra.boleh === true && sidikPra === sidik : bolehKonfirmasi(pra, sidik, sidikPra);

  const reset = () => { setCara(null); setBahan(null); setQty(""); setAlasan(""); setPra(null); setGalat(null); setSementara(false); };
  const pilihCara = (k) => { setCara(k === cara ? null : k); setBahan(null); setQty(""); setPra(null); setGalat(null); setHasil(null); setSementara(false); };

  async function lihat() {
    if (!v.ok || sibuk) { setGalat({ message: v.galat }); return; }
    setSibuk(true); setGalat(null); setPra(null);
    try {
      const r = cara === "AJUKAN" ? await api.pratinjauKoreksiPemakaian(unitId, { materialId: bahan.materialId, qtyBaru: v.qty }) : await api.pratinjauPembetulanBahan(unitId, { materialId: bahan.materialId, jenis: cara, qty: v.qty });
      setPra(r); setSidikPra(sidik);
    } catch (e) { setGalat(e); } finally { setSibuk(false); }
  }
  async function konfirmasi() {
    if (kirimRef.current || !siapKonfirmasi || !v.ok) return;
    kirimRef.current = true; setSibuk(true); setGalat(null); kunciRef.current ??= kunciIdempoten("pembetulan");
    try {
      if (cara === "AJUKAN") { const k = await api.ajukanKoreksiPemakaian(unitId, { materialId: bahan.materialId, qtyBaru: v.qty, alasan: v.alasan }, kunciRef.current); setHasil({ jenis: "ajukan", nomor: k.nomor ?? k.correctionNumber }); }
      else { await api.addUnitMaterial(unitId, tubuhPembetulan({ cara, bahan, qty: v.qty, alasan: v.alasan }), kunciRef.current); setHasil({ jenis: cara === "TAMBAH" ? "tambah" : "kurangi" }); }
      reset(); await onDone?.();
    } catch (e) { setGalat(e); } finally { kirimRef.current = false; setSibuk(false); }
  }

  const g = galat ? pesanGalatAdopsi(galat) : null;
  const tolakKarenaStok = pra?.penghalang?.some((h) => h.kode === "STOK_BELUM_DIKETAHUI");
  return (
    <section className="space-y-3 rounded-card border border-orange px-4 py-4" data-testid="pembetulan-unit-selesai" aria-label="Pembetulan bahan unit selesai">
      <div className="flex flex-wrap items-center gap-2"><Wrench size={16} className="text-ink2" aria-hidden /><h4 className="m-0 text-[14px] font-semibold text-ink">Pembetulan bahan — unit {KATA_STATUS[status] ?? "selesai"}</h4><Badge variant="orange">alasan wajib</Badge></div>
      <p className="m-0 text-[12.5px] text-ink2" data-testid="pembetulan-pengantar">{PESAN.bukaSelesai(status)}</p>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1 rounded-btn bg-inset px-3 py-3" data-testid="jalur-catatan">
          <p className="m-0 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink">{JALUR.CATATAN.judul} <Badge variant="accent">{JALUR.CATATAN.badge}</Badge></p>
          <p className="m-0 text-[12px] text-ink2">{JALUR.CATATAN.teks}</p>
          <p className="m-0 text-[12px] text-ink3">Koreksi catatan historis ada di bagian “Catatan pemakaian historis” di bawah. Pemakaian sementara: gunakan tombol di jalur B bila stok bahan belum diketahui.</p>
        </div>
        <div className="space-y-1 rounded-btn bg-inset px-3 py-3" data-testid="jalur-stok">
          <p className="m-0 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink">{JALUR.STOK.judul} <Badge variant="orange">{JALUR.STOK.badge}</Badge></p>
          <p className="m-0 text-[12px] text-ink2">{JALUR.STOK.teks}</p>
        </div>
      </div>

      {!bolehTulis ? <p className="m-0 text-[12.5px] text-ink3" data-testid="pembetulan-hanya-lihat">{PESAN.tanpaIzin}</p> : (
        <>
          <div role="radiogroup" aria-label="Jenis pembetulan" className="flex flex-col gap-2 md:flex-row" data-testid="pembetulan-cara">
            {CARA.map((c) => (
              <button key={c.key} type="button" role="radio" aria-checked={cara === c.key} data-testid={`cara-${c.key}`} onClick={() => pilihCara(c.key)} disabled={c.key !== "TAMBAH" && bahanTercatat.length === 0}
                title={c.key !== "TAMBAH" && bahanTercatat.length === 0 ? "Belum ada pengeluaran stok tercatat pada unit ini — tidak ada yang bisa dikembalikan atau dikoreksi" : undefined}
                className={cn("min-h-[56px] flex-1 rounded-card border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50", cara === c.key ? "border-accent bg-accentbg" : "border-line hover:bg-hovertint")}>
                <span className="block text-[13.5px] font-semibold text-ink">{c.label}</span><span className="block text-[11.5px] text-ink2">{c.ringkas}</span>
              </button>
            ))}
          </div>

          {cara && !sementara && (
            <div className="space-y-3 rounded-card border border-line px-4 py-4" data-testid="pembetulan-form">
              {cara === "TAMBAH" && (bahan
                ? <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[13px] text-ink" data-testid="pembetulan-bahan">{bahan.nama} <span className="text-ink3">({bahan.kode}) · satuan {bahan.satuan}{bahan.tersedia != null ? ` · saldo ${formatJumlah(bahan.tersedia)}` : " · stok belum diketahui"}</span> <button type="button" className="ml-2 text-[12px] text-accent underline" onClick={() => { setBahan(null); setPra(null); }}>ganti</button></p>
                : <PemilihBahanKatalog dipilihIds={[]} onTambah={(k) => { setBahan({ materialId: k.materialId, nama: k.nama, kode: k.kode, satuan: k.satuan, tersedia: k.tersedia ?? null }); setPra(null); }} testid="pembetulan-pemilih" />)}
              {cara !== "TAMBAH" && (
                <label className="block"><span className="mb-1 block text-[12px] text-ink3">Bahan yang sudah tercatat pada unit ini</span>
                  <select className={kolom} value={bahan?.materialId ?? ""} data-testid="pembetulan-pilih-bahan" onChange={(e) => { const b = bahanTercatat.find((x) => x.materialId === e.target.value); setBahan(b ?? null); setPra(null); if (b && cara === "AJUKAN") setQty(String(b.dipakai)); }}>
                    <option value="">Pilih bahan…</option>{bahanTercatat.map((b) => <option key={b.materialId} value={b.materialId}>{b.nama} — pemakaian bersih {formatJumlah(b.dipakai)} {b.satuan}</option>)}
                  </select></label>
              )}
              <label className="block"><span className="mb-1 block text-[12px] text-ink3">{cara === "AJUKAN" ? `Pemakaian yang benar (${bahan?.satuan ?? "satuan"}) — total bersih pada unit` : cara === "KURANGI" ? `Jumlah dikembalikan (${bahan?.satuan ?? "satuan"})${maks ? ` — maks ${formatJumlah(maks)}` : ""}` : `Jumlah ditambahkan (${bahan?.satuan ?? "satuan"})`}</span>
                <input inputMode="decimal" value={qty} onChange={(e) => { setQty(e.target.value); setPra(null); }} data-testid="pembetulan-qty" className={cn(kolom, "text-right tabular-nums")} /></label>
              <label className="block"><span className="mb-1 block text-[12px] text-ink3">Alasan pembetulan (wajib, tersimpan di riwayat)</span>
                <textarea rows={2} maxLength={500} value={alasan} onChange={(e) => { setAlasan(e.target.value); setPra(null); }} data-testid="pembetulan-alasan" className={cn(kolom, "h-auto py-2")} /></label>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" className="min-h-[44px]" onClick={lihat} disabled={sibuk || !v.ok} data-testid="pembetulan-lihat">{sibuk && !pra ? "Menghitung…" : "Lihat dampak"}</Button>
                {tolakKarenaStok && izin.catatPemakaianSementara && status === "DELIVERED" && <Button variant="neutral" className="min-h-[44px]" data-testid="pembetulan-ke-sementara" onClick={() => setSementara(true)}>Catat sementara — stok belum diketahui</Button>}
              </div>
              {!v.ok && (qty !== "" || alasan !== "") && <p className="m-0 text-[12px] text-ink3" data-testid="pembetulan-validasi">{v.galat}</p>}
              {pra && <Dampak pra={pra} ajukan={cara === "AJUKAN"} />}
              {cara === "AJUKAN" && pra?.boleh && <p className="m-0 flex items-start gap-1.5 text-[12px] text-ink2"><Info size={13} className="mt-0.5 shrink-0" aria-hidden />Stok belum berubah. Koreksi menunggu persetujuan Owner/Finance (orang lain dari pemohon); sesudah disetujui, pembalik/selisih tercatat sebagai baris baru bertaut pemakaian asal.</p>}
              {g && <p role="alert" data-testid="pembetulan-galat" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{g.teks}</p>}
              <div className="flex justify-end gap-2"><Button variant="neutral" className="min-h-[44px]" onClick={reset} disabled={sibuk}>Batal</Button>
                <Button className="bh-cta min-h-[44px]" data-testid="pembetulan-konfirmasi" onClick={konfirmasi} disabled={sibuk || !siapKonfirmasi}>{sibuk && pra ? "Menyimpan…" : cara === "AJUKAN" ? "Ajukan koreksi" : cara === "TAMBAH" ? "Konfirmasi: catat pengeluaran" : "Konfirmasi: catat pengembalian"}</Button></div>
              {!pra && v.ok && <p className="m-0 text-[11.5px] text-ink3">Konfirmasi aktif setelah Anda melihat dampaknya. Mengubah isian mengharuskan melihat dampak lagi.</p>}
            </div>
          )}
          {cara === "TAMBAH" && sementara && bahan && (
            <FormSementaraKatalog key={`pembetulan-sem-${bahan.materialId}`} unitId={unitId} kodeUnit={kodeUnit} bahan={bahan} qtyAwal={qty} alasanPembetulan={alasan.trim()} onSelesai={async () => { reset(); await onDone?.(); }} onBatal={() => setSementara(false)} />
          )}
        </>
      )}
      {hasil && (
        <p role="status" data-testid="pembetulan-hasil" className="m-0 flex items-start gap-2 rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green"><CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden />
          {hasil.jenis === "ajukan" ? `Koreksi ${hasil.nomor ?? ""} diajukan; stok belum berubah sampai disetujui orang lain.` : hasil.jenis === "tambah" ? "Pengeluaran bahan dicatat sebagai baris baru di riwayat; stok dan HPP order sudah diperbarui." : "Pengembalian dicatat sebagai baris baru di riwayat; baris asli tidak diubah."}</p>
      )}
      <p className="m-0 flex items-start gap-1.5 text-[11.5px] text-ink3"><AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />Tidak ada jalur untuk “menyelesaikan” pembetulan lewat Posting Pemakaian Historis dari sini — itu proses terpisah di bawah kendali Owner.</p>
    </section>
  );
}
