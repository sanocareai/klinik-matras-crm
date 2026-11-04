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
import { SATUAN_KOMPONEN, aturanBaris, satuanIsianBaris, teksKonversiBaris } from "@/features/production/bahan/bahanModel.js";
import { JENIS_PRATINJAU, PENGECUALIAN_ALASAN_MAKS, PESAN, barisDampak, bolehKonfirmasi, daftarSudahTercatat, infoPengecualian, perluKonfirmasiGanda, sidikIsian, tglIndo, tubuhPembetulan, validasiPembetulan, validasiPengecualian } from "@/features/production/bahan/pembetulanModel.js";

// TAMBAH PEMAKAIAN pada unit TERKIRIM (dibuka dari tombol "+ Tambah pemakaian" → pilihan sumber). Unit dibatalkan tidak termasuk.
// Tiga sumber (cara): TAMBAH = Bahan Gudang (pengeluaran stok baru lewat POST /units/:id/materials), SEMENTARA = bahan belum tercatat (pemakaian sementara, tanpa stok), KOMPONEN = komponen lama (tanpa stok).
// Wajib: alasan + TANGGAL PEMAKAIAN yang dilaporkan (terpisah dari waktu pencatatan). Dampak (stok, jurnal Finance, HPP operasional, kemungkinan sudah tercatat) tampil SEBELUM konfirmasi.
// Mengubah/mengganti bahan yang SUDAH tercatat = tombol "Edit" pada tabel (EditPemakaianForm). Sistem tidak pernah menautkan otomatis transaksi lama; pengguna memeriksa daftar dan menyatakannya.
// PENGECUALIAN "Tetap catat meskipun stok tidak cukup" (keputusan Owner 4 Nov 2026): hanya untuk peran pengelola, hanya saat pratinjau melaporkan stok tidak cukup, dengan alasan + konfirmasi eksplisit;
// server menegakkan ulang izin, alasan, konfirmasi, cutoff opname, dan saldo. Tanggal saja tidak pernah melewati validasi stok.
// SATUAN PAKAI: bahan beraturan (LIST WIBING: stok ROLL, dipakai METER, 1 ROLL = 90 METER) diisi dalam satuan pakai; server mengonversi, saldo tetap dalam satuan stok.
const kolom = "h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink3 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-60";
// Galat server yang membuat pratinjau basi: pratinjau dibuang (harus dilihat ulang), isian TETAP di layar.
const KODE_PRATINJAU_BASI = new Set(["UNIT_SALDO_BERGESER", "UNIT_KEMUNGKINAN_GANDA", "PENGECUALIAN_MELINTASI_OPNAME", "PENGECUALIAN_STOK_BELUM_DIKETAHUI", "PENGECUALIAN_STOK_TANPA_IZIN"]);

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
      {barisDampak(pra).map((b) => <p key={b.k} className={cn("m-0", b.k === "tindakan" && "rounded-btn px-2 py-1.5 font-semibold", b.k === "tindakan" && (b.tegas ? "bg-orangebg text-ink" : "bg-accentbg text-ink"), b.peringatan && "rounded-btn bg-orangebg px-2 py-1.5 font-semibold")} data-testid={`dampak-${b.k}`}>{b.k !== "tindakan" && <b>{b.label}: </b>}{b.teks}</p>)}
      {pra.penghalang.map((h) => <p key={h.kode} className="m-0 font-semibold text-red" role="alert" data-testid="pembetulan-penghalang">{h.pesan}</p>)}
    </div>
  );
}

// Blok pengecualian stok tidak cukup. Tampil hanya bila pratinjau melaporkan stok tidak cukup (pengecualian.perlu). Tidak menghitung apa pun sendiri: semua angka dari pratinjau server.
function PengecualianStok({ info, alasan, setAlasan, konf, setKonf, onToggle, sibuk }) {
  const val = validasiPengecualian({ alasan, konfirmasi: konf });
  const opnameBerjalan = info.opname?.berjalan?.length > 0;
  return (
    <div className={cn("space-y-2 rounded-btn px-3 py-3 text-[12.5px]", info.berlaku ? "border border-orange bg-orangebg" : "bg-inset")} data-testid="pengecualian-stok" data-berlaku={info.berlaku ? "ya" : "tidak"}>
      {!info.bisa ? (
        <>
          <p className="m-0 flex items-start gap-2 font-semibold text-ink"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />Stok tidak cukup — tidak bisa dikecualikan</p>
          <p className="m-0 text-ink2" data-testid="pengecualian-sebab">{info.sebab}</p>
        </>
      ) : (
        <>
          <label className="flex min-h-[44px] items-start gap-2 text-[13px] font-semibold text-ink">
            <input type="checkbox" checked={info.diminta} disabled={sibuk} onChange={(e) => onToggle(e.target.checked)} data-testid="pengecualian-opsi" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]" />
            <span>{PESAN.pengecualianOpsi}</span>
          </label>
          <p className="m-0 text-ink2" data-testid="pengecualian-penjelas">{PESAN.pengecualianPenjelas}</p>
        </>
      )}
      {opnameBerjalan && <p className="m-0 text-ink2" data-testid="pengecualian-opname-info">{info.opname.teks}</p>}
      {info.berlaku && (
        <div className="space-y-2" data-testid="pengecualian-panel">
          <p className="m-0 font-semibold text-ink tabular-nums" data-testid="pengecualian-saldo">Saldo {formatJumlah(info.saldoSebelum)} → {formatJumlah(info.saldoSesudah)} {info.satuan} (minus)</p>
          <p className="m-0 flex items-start gap-2 font-semibold text-ink" role="note" data-testid="pengecualian-peringatan"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />{PESAN.pengecualianPeringatan}</p>
          <label className="block"><span className="mb-1 block text-[12px] text-ink3">Alasan pengecualian (wajib, tersimpan di riwayat dan audit)</span>
            <textarea rows={2} maxLength={PENGECUALIAN_ALASAN_MAKS} value={alasan} disabled={sibuk} onChange={(e) => setAlasan(e.target.value)} data-testid="pengecualian-alasan" placeholder="Mis. pemakaian lama belum tercatat; saldo dibereskan lewat opname" className={cn(kolom, "h-auto py-2")} /></label>
          <label className="flex min-h-[44px] items-start gap-2 text-[13px] text-ink"><input type="checkbox" checked={konf} disabled={sibuk} onChange={(e) => setKonf(e.target.checked)} data-testid="pengecualian-konfirmasi" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]" /><span>{PESAN.pengecualianKonfirmasi}</span></label>
          {!val.ok && (alasan !== "" || konf) && <p className="m-0 text-[12px] text-ink3" data-testid="pengecualian-validasi">{val.galat}</p>}
        </div>
      )}
    </div>
  );
}

const JUDUL = { TAMBAH: "Tambah pemakaian — Bahan Gudang", SEMENTARA: "Tambah pemakaian — Bahan belum tercatat", KOMPONEN: "Tambah pemakaian — Komponen lama" };

export default function PembetulanUnitSelesai({ unitId, kodeUnit, izin, cara, onTutup, onDone }) {
  const [bahan, setBahan] = useState(null); const [qty, setQty] = useState(""); const [alasan, setAlasan] = useState(""); const [tanggal, setTanggal] = useState("");
  const [nama, setNama] = useState(""); const [uom, setUom] = useState("PCS"); const [asal, setAsal] = useState(""); const [catatan, setCatatan] = useState("");
  const [satuanInput, setSatuanInput] = useState("");
  const [pengecualian, setPengecualian] = useState(false); const [alasanPeng, setAlasanPeng] = useState(""); const [konfSaldo, setKonfSaldo] = useState(false);
  const [pra, setPra] = useState(null); const [sidikPra, setSidikPra] = useState(""); const [sudahPeriksa, setSudahPeriksa] = useState(false); const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(null); const [hasil, setHasil] = useState(null); const [stokTakDiketahui, setStokTakDiketahui] = useState(false);
  const kunciRef = useRef(null); const sidikKunci = useRef(""); const kirimRef = useRef(false);
  const bolehTulis = !!izin.pemakaianAktual;
  // Bahan beraturan satuan pakai: satuan input (METER/ROLL) mengikuti pilihan pengguna; bahan lain memakai satuan stok.
  const bahanEf = bahan ? { ...bahan, satuanInput: satuanInput || bahan.satuanPakai?.satuanPakai } : null;
  const aturan = aturanBaris(bahanEf); const satuanKirim = aturan ? satuanIsianBaris(bahanEf) : null;
  const hitungSidik = (flag) => sidikIsian({ cara, bahan, qty: cara === "SEMENTARA" ? `${nama}|${qty}|${uom}|${asal}|${catatan}` : qty, alasan, tanggal, satuan: satuanKirim ?? "", pengecualian: flag });
  const sidik = hitungSidik(pengecualian);
  // Kunci idempotensi per NIAT: berubah bila isian ATAU alasan/konfirmasi pengecualian berubah (isi permintaan berbeda tidak boleh memakai kunci lama).
  const sidikK = `${sidik}|${alasanPeng.trim()}|${konfSaldo}`;
  if (sidikKunci.current !== sidikK) { sidikKunci.current = sidikK; kunciRef.current = null; }
  const v = validasiPembetulan({ cara, bahan: cara === "SEMENTARA" ? { materialId: "-" } : bahanEf, qty, alasan, tanggal, maks: null });
  const namaOk = cara !== "SEMENTARA" || nama.trim().length >= 3;
  const siap = v.ok && namaOk;
  const info = infoPengecualian(pra, izin);
  const valPeng = validasiPengecualian({ alasan: alasanPeng, konfirmasi: konfSaldo });
  const siapKonfirmasi = bolehKonfirmasi(pra, sidik, sidikPra, { sudahPeriksa, pengecualianOk: valPeng.ok });
  const pakaiPengecualian = !!pra?.pengecualianStok?.berlaku;

  // Mengubah isian apa pun membuang pratinjau DAN pengecualian: pengguna melihat dampak lagi dan memutuskan lagi.
  const reset = () => { setPra(null); setSudahPeriksa(false); setPengecualian(false); setKonfSaldo(false); };
  const ubah = (fn) => (e) => { fn(e.target.value); reset(); };
  async function lihat(flag = pengecualian) {
    if (!siap || sibuk) { setGalat({ message: v.galat || "Lengkapi isian dulu." }); return; }
    setSibuk(true); setGalat(null); setPra(null); setSudahPeriksa(false);
    try {
      setPra(await api.pratinjauPembetulanBahan(unitId, { jenis: JENIS_PRATINJAU[cara], tanggalPemakaian: v.tanggal, ...(cara === "TAMBAH" ? { materialId: bahan.materialId, qty: v.qty, ...(satuanKirim ? { satuan: satuanKirim } : {}), ...(flag ? { pengecualianStokTidakCukup: true } : {}) } : {}) })); setSidikPra(hitungSidik(flag));
    } catch (e) { setGalat(e); } finally { setSibuk(false); }
  }
  // Mencentang/melepas pengecualian meminta pratinjau BARU dari server (angka, peringatan, dan penghalang berubah); konfirmasi saldo minus selalu diulang.
  async function togglePengecualian(on) { setPengecualian(on); setKonfSaldo(false); await lihat(on); }
  async function konfirmasi() {
    if (kirimRef.current || !siapKonfirmasi || !v.ok) return;
    kirimRef.current = true; setSibuk(true); setGalat(null); kunciRef.current ??= kunciIdempoten("pembetulan");
    try {
      if (cara === "SEMENTARA") { await api.catatPemakaianSementara(unitId, { name: nama.trim(), qty: v.qty, uom, originNote: asal.trim() || undefined, note: catatan.trim() || undefined, alasanPembetulan: v.alasan, tanggalPemakaian: v.tanggal }, kunciRef.current); setHasil({ jenis: "sementara" }); }
      else { await api.addUnitMaterial(unitId, tubuhPembetulan({ cara, bahan, qty: v.qty, alasan: v.alasan, tanggal: v.tanggal, pra, sudahPeriksa, satuan: satuanKirim, pengecualian: pakaiPengecualian ? { alasan: valPeng.alasan, konfirmasi: konfSaldo } : null }), kunciRef.current); setHasil({ jenis: "tambah", pengecualian: pakaiPengecualian }); }
      await onDone?.();
    } catch (e) {
      setGalat(e);
      // Saldo/dokumen/opname berubah sejak pratinjau: buang pratinjau (lihat dampak lagi) tetapi pertahankan semua isian dan alasan.
      if (KODE_PRATINJAU_BASI.has(e?.code)) { setPra(null); setSudahPeriksa(false); setKonfSaldo(false); }
    } finally { kirimRef.current = false; setSibuk(false); }
  }
  const g = galat ? pesanGalatAdopsi(galat) : null;
  const tolakKarenaStok = pra?.penghalang?.some((h) => h.kode === "STOK_BELUM_DIKETAHUI");
  const teksKonversi = teksKonversiBaris(bahanEf, qty);

  return (
    <section className="space-y-3" data-testid="pembetulan-unit-selesai" aria-label="Tambah pemakaian unit terkirim">
      <div className="flex flex-wrap items-center gap-2"><Wrench size={16} className="text-ink2" aria-hidden /><h4 className="m-0 text-[14px] font-semibold text-ink">{JUDUL[cara]}</h4><Badge variant="orange">alasan + tanggal wajib</Badge></div>
      <p className="m-0 text-[12.5px] text-ink2" data-testid="pembetulan-pengantar">{PESAN.bukaSelesai}</p>

      {!bolehTulis ? <p className="m-0 text-[12.5px] text-ink3" data-testid="pembetulan-hanya-lihat">{PESAN.tanpaIzin}</p> : hasil ? (
        <div className="space-y-2">
          <p role="status" data-testid="pembetulan-hasil" className="m-0 flex items-start gap-2 rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green"><CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden />
            {hasil.jenis === "tambah" ? (hasil.pengecualian ? "PENGELUARAN STOK baru dicatat dengan pengecualian stok tidak cukup: saldo bahan kini minus sampai dibereskan lewat stock opname. Alasan pengecualian tersimpan di riwayat dan audit; tidak ada penerimaan atau koreksi otomatis. HPP order sudah diperbarui." : "PENGELUARAN STOK baru dicatat sebagai baris baru di riwayat; stok dan HPP order sudah diperbarui.")
              : "Catatan pemakaian sementara ditambahkan (stok tidak berubah). Tampil di bagian “Bahan belum ada di katalog” berstatus Perlu rekonsiliasi Gudang."}</p>
          <div className="flex justify-end"><Button variant="neutral" className="min-h-[44px]" onClick={onTutup} data-testid="pembetulan-tutup">Tutup</Button></div>
        </div>
      ) : (
        <>
          {!(cara === "TAMBAH" && stokTakDiketahui) && (
            <div className="space-y-3 rounded-card border border-line px-4 py-4" data-testid="pembetulan-form">
              <p className="m-0 text-[12px] text-ink3" data-testid="pembetulan-tanggal-penjelas">{PESAN.tanggalPenjelas}</p>
              {cara === "TAMBAH" && (bahan
                ? <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[13px] text-ink" data-testid="pembetulan-bahan">{bahan.nama} <span className="text-ink3">({bahan.kode}) · satuan stok {bahan.satuan}{bahan.tersedia != null ? ` · saldo ${formatJumlah(bahan.tersedia)} ${bahan.satuan}` : " · stok belum diketahui"}</span> <button type="button" className="ml-2 text-[12px] text-accent underline" onClick={() => { setBahan(null); setSatuanInput(""); reset(); }}>ganti</button>
                  {aturan && <span className="mt-1 block text-[12px] text-ink2" data-testid="pembetulan-satuan-pakai">Dipakai dalam {aturan.satuanPakai}: {aturan.teks}. Saldo lama tetap dibaca apa adanya dalam {bahan.satuan} (tidak diubah ke {aturan.satuanPakai}).</span>}</p>
                : <PemilihBahanKatalog dipilihIds={new Set()} onTambah={(k) => { setBahan({ materialId: k.materialId, nama: k.nama, kode: k.kode, satuan: k.satuan, tersedia: k.tersedia ?? null, satuanPakai: k.satuanPakai ?? null }); setSatuanInput(k.satuanPakai?.satuanPakai ?? ""); reset(); }} testid="pembetulan-pemilih" />)}
              {cara === "SEMENTARA" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block sm:col-span-2"><span className="mb-1 block text-[12px] text-ink3">Nama bahan (belum ada di katalog)</span><input className={kolom} value={nama} onChange={ubah(setNama)} maxLength={120} data-testid="pembetulan-nama" placeholder="Mis. Busa potongan sisa" /></label>
                  <label className="block"><span className="mb-1 block text-[12px] text-ink3">Satuan</span><select className={kolom} value={uom} onChange={ubah(setUom)} data-testid="pembetulan-satuan">{SATUAN_KOMPONEN.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
                  <label className="block"><span className="mb-1 block text-[12px] text-ink3">Asal barang (opsional)</span><input className={kolom} value={asal} onChange={ubah(setAsal)} maxLength={300} data-testid="pembetulan-asal" /></label>
                  <label className="block sm:col-span-2"><span className="mb-1 block text-[12px] text-ink3">Catatan (opsional)</span><input className={kolom} value={catatan} onChange={ubah(setCatatan)} maxLength={300} data-testid="pembetulan-catatan" /></label>
                </div>
              )}
              {cara !== "KOMPONEN" && (
                <div className="space-y-1">
                  <div className="flex items-end gap-2">
                    <label className="block min-w-0 flex-1"><span className="mb-1 block text-[12px] text-ink3">{`Jumlah (${aturan ? satuanIsianBaris(bahanEf) : (bahan?.satuan ?? (cara === "SEMENTARA" ? uom : "satuan"))})`}</span>
                      <input inputMode="decimal" value={qty} onChange={ubah(setQty)} data-testid="pembetulan-qty" className={cn(kolom, "text-right tabular-nums")} /></label>
                    {aturan && (
                      <label className="block w-28 shrink-0"><span className="mb-1 block text-[12px] text-ink3">Satuan</span>
                        <select className={kolom} value={satuanIsianBaris(bahanEf)} onChange={(e) => { setSatuanInput(e.target.value); reset(); }} data-testid="pembetulan-satuan-input" aria-label="Satuan jumlah">
                          <option value={aturan.satuanPakai}>{aturan.satuanPakai}</option><option value={aturan.satuanStok}>{aturan.satuanStok}</option>
                        </select></label>
                    )}
                  </div>
                  {teksKonversi && <p className="m-0 text-[12px] text-ink2 tabular-nums" data-testid="pembetulan-konversi">{teksKonversi} (stok dicatat dalam {aturan.satuanStok}, dibulatkan 4 desimal)</p>}
                </div>
              )}
              <label className="block"><span className="mb-1 block text-[12px] text-ink3">Tanggal pemakaian yang dilaporkan (wajib)</span><input type="date" value={tanggal} onChange={ubah(setTanggal)} data-testid="pembetulan-tanggal" className={kolom} /></label>
              <label className="block"><span className="mb-1 block text-[12px] text-ink3">Alasan (wajib, tersimpan di riwayat)</span>
                <textarea rows={2} maxLength={500} value={alasan} onChange={ubah(setAlasan)} data-testid="pembetulan-alasan" className={cn(kolom, "h-auto py-2")} /></label>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" className="min-h-[44px]" onClick={() => lihat()} disabled={sibuk || !siap} data-testid="pembetulan-lihat">{sibuk && !pra ? "Menghitung…" : "Lihat dampak"}</Button>
                {tolakKarenaStok && izin.catatPemakaianSementara && <Button variant="neutral" className="min-h-[44px]" data-testid="pembetulan-ke-sementara" onClick={() => setStokTakDiketahui(true)}>Catat sementara — stok belum diketahui (hanya catatan)</Button>}
              </div>
              {!siap && (qty !== "" || alasan !== "" || tanggal !== "" || cara === "KOMPONEN") && <p className="m-0 text-[12px] text-ink3" data-testid="pembetulan-validasi">{v.galat || (!namaOk ? "Nama bahan minimal 3 huruf." : "")}</p>}
              {pra && <Dampak pra={pra} />}
              {pra && info.tampil && <PengecualianStok info={info} alasan={alasanPeng} setAlasan={setAlasanPeng} konf={konfSaldo} setKonf={setKonfSaldo} onToggle={togglePengecualian} sibuk={sibuk} />}
              {pra && <Kandidat pra={pra} sudahPeriksa={sudahPeriksa} setSudahPeriksa={setSudahPeriksa} />}
              {cara === "KOMPONEN" && pra && <FormKomponenLama key="pembetulan-komp" unitId={unitId} kodeUnit={kodeUnit} meta={{ fotoMaks: 3 }} pembetulan={{ alasan: v.alasan, tanggal: v.tanggal, siap: siapKonfirmasi }} onSelesai={async () => { setHasil({ jenis: "komponen" }); await onDone?.(); onTutup?.(); }} onBatal={onTutup} />}
              {g && <p role="alert" data-testid="pembetulan-galat" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{g.teks}</p>}
              {cara !== "KOMPONEN" && (
                <div className="flex items-stretch justify-end gap-2"><Button variant="neutral" className="min-h-[44px] shrink-0" onClick={onTutup} disabled={sibuk}>Batal</Button>
                  <Button className="bh-cta min-h-[44px] min-w-0 flex-1 !h-auto whitespace-normal py-2 leading-tight sm:flex-none" data-testid="pembetulan-konfirmasi" onClick={konfirmasi} disabled={sibuk || !siapKonfirmasi}>{sibuk && pra ? "Menyimpan…" : cara === "SEMENTARA" ? "Konfirmasi: tambah CATATAN (tanpa stok)" : pakaiPengecualian ? "Konfirmasi: buat PENGELUARAN STOK baru — stok tidak cukup, saldo jadi minus" : "Konfirmasi: buat PENGELUARAN STOK baru"}</Button></div>
              )}
              {!pra && siap && <p className="m-0 text-[11.5px] text-ink3">Konfirmasi aktif setelah Anda melihat dampaknya. Mengubah isian mengharuskan melihat dampak lagi.</p>}
              {pra && !siapKonfirmasi && cara !== "KOMPONEN" && perluKonfirmasiGanda(pra) && !sudahPeriksa && <p className="m-0 text-[11.5px] text-orange" data-testid="pembetulan-tunggu-periksa">Centang pernyataan pemeriksaan di atas untuk melanjutkan.</p>}
              {pra && !siapKonfirmasi && pakaiPengecualian && !valPeng.ok && <p className="m-0 text-[11.5px] text-orange" data-testid="pembetulan-tunggu-pengecualian">{valPeng.galat}</p>}
            </div>
          )}
          {cara === "TAMBAH" && stokTakDiketahui && bahan && (
            <FormSementaraKatalog key={`pembetulan-sem-${bahan.materialId}`} unitId={unitId} kodeUnit={kodeUnit} bahan={aturan && satuanKirim === aturan.satuanPakai ? { ...bahan, satuan: aturan.satuanPakai } : bahan} qtyAwal={qty} alasanPembetulan={alasan.trim()} tanggalPembetulan={tanggal} onSelesai={async () => { setHasil({ jenis: "sementara" }); await onDone?.(); }} onBatal={() => setStokTakDiketahui(false)} />
          )}
        </>
      )}
    </section>
  );
}
