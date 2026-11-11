import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, Hourglass, Info, Package, Plus, Recycle, X } from "lucide-react";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { cn } from "@/lib/utils.js";
import CatatBahanBaru from "@/features/production/bahan/CatatBahanBaru.jsx";
import BahanBelumAda from "@/features/production/bahan/BahanBelumAda.jsx";
import FormSementaraKatalog from "@/features/production/bahan/FormSementaraKatalog.jsx";
import FormKomponenLama from "@/features/production/bahan/FormKomponenLama.jsx";
import KomponenLamaDaftar from "@/features/production/bahan/KomponenLamaDaftar.jsx";
import PemakaianSementaraDaftar from "@/features/production/bahan/PemakaianSementaraDaftar.jsx";
import RiwayatBahanBaru from "@/features/production/bahan/RiwayatBahanBaru.jsx";
import CatatanHistorisBagian from "@/features/production/bahan/CatatanHistorisBagian.jsx";
import PembetulanUnitSelesai from "@/features/production/bahan/PembetulanUnitSelesai.jsx";
import TabelPemakaian from "@/features/production/bahan/TabelPemakaian.jsx";
import PemakaianTertunda from "@/features/production/pengajuan/PemakaianTertunda.jsx";
import { DETAIL_TEKNIS, PILIHAN_SUMBER, pesanHasil } from "@/features/production/bahan/perubahanModel.js";
import "@/features/production/bahan/bahan.css";
import { JUDUL_AKTUAL, KARTU_SUMBER, SATUAN_KOMPONEN as SATUAN_LIST, SUMBER_SEMENTARA, asalKomponen, barisTabelPemakaian } from "@/features/production/bahan/bahanModel.js";

// PEMAKAIAN AKTUAL — satu komponen untuk drawer Order Produksi DAN tab Bahan Ruang Kerja Unit (sebelumnya drawer punya salinan lama tanpa "Bahan belum ada").
// TIGA sumber SELALU tampil sebagai kartu (tanpa menggulir daftar bahan): Bahan dari Gudang · Bahan belum ada di katalog · Komponen lama dari kasur ini.
// Memilih kartu membuka formulirnya langsung. Tidak ada jalur yang memaksa membuat stok / Material Issue fiktif: "belum ada di katalog" = pemakaian sementara + usulan bahan (alur resmi, perlu rekonsiliasi Gudang).
// Usulan yang SUDAH terkirim tetapi pemakaian sementaranya belum tersimpan (gagal di antara dua langkah): disimpan per unit di sessionStorage (selamat dari refresh) beserta Idempotency-Key.
const kunciTertinggal = (unitId) => `bahan-usulan-tertinggal:${unitId}`;
const bacaTertinggal = (unitId) => { try { const t = sessionStorage.getItem(kunciTertinggal(unitId)); return t ? JSON.parse(t) : null; } catch { return null; } };
const tulisTertinggal = (unitId, v) => { try { if (v) sessionStorage.setItem(kunciTertinggal(unitId), JSON.stringify(v)); else sessionStorage.removeItem(kunciTertinggal(unitId)); } catch { /* penyimpanan tidak tersedia: banner tetap hidup selama komponen ada */ } };

const CARA_TERKIRIM = { gudang: "TAMBAH", belum: "SEMENTARA", lama: "KOMPONEN" }; // sumber → jenis pembetulan pada unit terkirim

export default function PemakaianAktualBagian({ unitId, data, izin, aktif, onDone, rencanaEdit = false, onMulai = null, tanpaJudul = false, sinyalBuka = 0, slotRencana = null }) {
  const kodeUnit = data.unit.unitCode; const terkirim = data.unit.status === "DELIVERED";
  const boleh = !!izin.pemakaianAktual && aktif; // pencatatan unit berjalan (formulir lama)
  const bolehTambah = !!izin.pemakaianAktual && (aktif || terkirim); // "+ Catat bahan": unit berjalan ATAU terkirim (unit dibatalkan tidak)
  const bolehBelumAda = bolehTambah && (!!izin.catatPemakaianSementara || !!izin.usulBahan);
  const [mode, setMode] = useState(null); // null | "gudang" | "belum" | "lama" | "katalog"
  const [tambahBuka, setTambahBuka] = useState(false); const [editId, setEditId] = useState(null); const [hasilEdit, setHasilEdit] = useState(null);
  const [tertinggal, setTertinggalState] = useState(() => bacaTertinggal(unitId));
  const setTertinggal = (v) => { setTertinggalState(v); tulisTertinggal(unitId, v); };
  // Pemakaian sementara bertaut ke usulan itu sudah ada di server (mis. respons hilang padahal tersimpan, atau dicatat dari perangkat lain) → tidak ada lagi yang tertinggal.
  useEffect(() => { if (tertinggal && (data.pemakaianSementara?.items ?? []).some((i) => i.proposalId === tertinggal.usulan?.id)) setTertinggal(null); }, [data.pemakaianSementara, tertinggal?.usulan?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [awalCari, setAwalCari] = useState(""); const [awalBelum, setAwalBelum] = useState({ nama: "", satuan: "PCS", alasan: "" }); const [bahanKat, setBahanKat] = useState(null); // bahan katalog (stok belum diketahui) yang dicatat sementara
  const [konfirmGanti, setKonfirmGanti] = useState(null); // { ke } — isian belum dikonfirmasi akan dibuang bila sumber diganti / form ditutup (ke = null: tutup)
  const dirtyGudangRef = useRef(false); const formRef = useRef(null);
  const bukaKatalog = (b) => { setBahanKat(b); setMode("katalog"); onMulai?.("katalog"); };
  const kl = data.komponenLama ?? { items: [], dibatalkan: [] };
  const sementara = data.pemakaianSementara ?? { items: [], total: { perluRekonsiliasi: 0 } };
  const menunggu = data.koreksiMenunggu ?? [];
  const adaBaru = (data.pemakaianAktual?.baris ?? []).length > 0; const adaLama = kl.items.length + kl.dibatalkan.length > 0; const adaSementara = sementara.items.length > 0;
  const adaTabel = barisTabelPemakaian(data, { menunggu }).length > 0; const adaRiwayat = adaBaru || adaLama || adaSementara;
  const jumlahRiwayat = (data.pemakaianAktual?.baris ?? []).length + sementara.items.length + kl.items.length + kl.dibatalkan.length;
  const formTampil = bolehTambah && (tambahBuka || !!mode);

  // Isian belum dikonfirmasi? Bahan Gudang melapor lewat onDirty; formulir lain dicek dari kolom isian yang terlihat (bukan kolom cari).
  const adaIsian = () => {
    if (mode === "gudang" && dirtyGudangRef.current) return true;
    const w = formRef.current; if (!w) return false;
    return [...w.querySelectorAll("input, textarea")].some((el) => !["search", "checkbox", "radio", "hidden", "button", "submit"].includes(el.type) && el.type !== "file" && String(el.value ?? "").trim() !== "" && !el.disabled && !el.readOnly)
      || [...w.querySelectorAll("input[type=file]")].some((el) => el.files?.length);
  };
  const terapkanPilih = (k) => { setMode(k); setEditId(null); setHasilEdit(null); setAwalCari(""); setAwalBelum({ nama: "", satuan: "PCS", alasan: "" }); dirtyGudangRef.current = false; setKonfirmGanti(null); if (k) onMulai?.(k); };
  const pilih = (k) => { if (k === mode) return; if (mode && adaIsian()) { setKonfirmGanti({ ke: k }); return; } terapkanPilih(k); };
  const lanjutkanTertinggal = () => { setAwalCari(""); setAwalBelum({ nama: "", satuan: "PCS", alasan: "", dariTertinggal: true }); setMode("belum"); onMulai?.("belum"); };
  const tutupLangsung = () => { setMode(null); setTambahBuka(false); setKonfirmGanti(null); dirtyGudangRef.current = false; };
  const tutup = () => { if (mode && adaIsian()) { setKonfirmGanti({ ke: null }); return; } tutupLangsung(); };
  const selesaiKomponen = async () => { tutupLangsung(); await onDone(); };
  const bukaTambah = () => { setEditId(null); setHasilEdit(null); setTambahBuka(true); setMode(terkirim ? "gudang" : "gudang"); dirtyGudangRef.current = false; onMulai?.("tambah"); };
  const bukaEdit = (id) => { tutupLangsung(); setHasilEdit(null); setEditId(id); onMulai?.("edit"); };
  // Sinyal dari luar (mis. tombol tindakan berikutnya "Catat pemakaian bahan"): hanya MEMBUKA form.
  const sinyalRef = useRef(sinyalBuka);
  useEffect(() => { if (sinyalBuka !== sinyalRef.current) { sinyalRef.current = sinyalBuka; if (bolehTambah && !rencanaEdit) bukaTambah(); } }, [sinyalBuka]); // eslint-disable-line react-hooks/exhaustive-deps

  const infoSumber = mode ? (PILIHAN_SUMBER[mode === "katalog" ? "gudang" : mode] || PILIHAN_SUMBER.gudang) : null;

  return (
    <section aria-labelledby={tanpaJudul ? undefined : "aktual-judul"} aria-label={tanpaJudul ? JUDUL_AKTUAL : undefined} className="prod-bhn" data-testid="sec-aktual" id="sec-aktual">
      <div className="prod-bhn-kepala">
        <h3 id="aktual-judul" className="m-0">Pemakaian bahan</h3>
        {bolehTambah && <Button className="prod-bhn-catat" onClick={bukaTambah} disabled={rencanaEdit} aria-haspopup="dialog" data-testid="tambah-pemakaian" title={rencanaEdit ? "Selesaikan atau batalkan penyusunan rencana dulu" : undefined}><Plus size={17} aria-hidden /> Catat bahan</Button>}
      </div>

      {tertinggal && mode !== "belum" && (
        <div role="alert" data-testid="usulan-tertinggal" className="prod-peringatan">
          <p className="m-0 flex items-start gap-2"><AlertTriangle size={16} className="bh-warn mt-0.5 shrink-0" aria-hidden /><span><b>Ada yang belum selesai:</b> usulan bahan “{tertinggal.usulan?.name}” <b>sudah terkirim ke Gudang</b> ({tertinggal.usulan?.statusLabel}), tetapi pemakaian sementaranya <b>belum tersimpan</b> di unit ini. Lanjutkan agar pemakaiannya tercatat — usulan tidak akan dikirim ulang.</span></p>
          <div className="flex flex-wrap gap-2">
            {boleh && <Button className="min-h-[44px]" data-testid="usulan-tertinggal-lanjut" onClick={() => { setTambahBuka(true); lanjutkanTertinggal(); }}>Lanjutkan mencatat pemakaian</Button>}
            <Button variant="neutral" className="min-h-[44px]" data-testid="usulan-tertinggal-lewati" onClick={() => setTertinggal(null)}>Hanya usulan, tidak mencatat pemakaian</Button>
          </div>
        </div>
      )}
      {!izin.pemakaianAktual && <p className="prod-pn-catatan" data-testid="aktual-hanya-lihat">Akun Anda hanya bisa melihat pemakaian bahan.</p>}
      {izin.pemakaianAktual && !aktif && !terkirim && <p className="prod-pn-catatan" data-testid="unit-dibatalkan-terkunci">Unit sudah dibatalkan; pemakaian tidak dicatat lagi.</p>}
      {hasilEdit && (
        <p role="status" className="prod-umpan ok m-0 flex items-start gap-2" data-testid="edit-hasil" data-jenis={hasilEdit.jenis}><CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden /><span className="min-w-0 flex-1">{pesanHasil(hasilEdit.jenis, hasilEdit)}</span>
          <button type="button" onClick={() => setHasilEdit(null)} aria-label="Tutup pesan" className="prod-ikon-tombol"><X size={16} aria-hidden /></button></p>
      )}

      {/* Pemakaian yang sudah DILAPORKAN, menunggu verifikasi ADMIN (terpisah dari pemakaian resmi; stok & HPP belum berubah) */}
      <PemakaianTertunda unitId={unitId} />

      {/* Daftar pemakaian aktual (tiga sumber dalam satu daftar, dampak singkat per baris, Edit per baris; unit berjalan DAN terkirim) */}
      {adaTabel && <TabelPemakaian unitId={unitId} kodeUnit={kodeUnit} data={data} izin={izin} aktif={aktif} terkirim={terkirim} rencanaEdit={rencanaEdit} menunggu={menunggu} editId={editId} onEditGudang={bukaEdit} onTutupGudang={() => setEditId(null)} onHasilEdit={setHasilEdit} onDone={onDone} />}
      {!adaTabel && <p className="prod-kosong-kecil m-0" data-testid="aktual-kosong">Belum ada pemakaian tercatat.{bolehTambah ? " Tekan “Catat bahan”; rencana bahan tidak wajib." : ""}</p>}
      <p className="prod-bhn-info"><Info size={17} aria-hidden /> Rencana bahan tidak mengurangi stok.</p>

      {slotRencana}

      {izin.pemakaianAktual && (
        <details className="prod-lipat" data-testid="detail-teknis">
          <summary>Detail teknis: stok, tanggal, harga, dan persetujuan</summary>
          <div className="space-y-2 pb-3">{DETAIL_TEKNIS.map((d) => <p key={d.judul} className="m-0"><b>{d.judul}.</b> {d.teks}</p>)}</div>
        </details>
      )}

      {/* RIWAYAT dan dokumen pemakaian — TERTUTUP bawaan. Hanya sumber yang punya isi yang tampil. Jejak lengkap: dokumen sumber, pelaku, waktu, dampak saldo, HPP, yang dibatalkan/dikoreksi. */}
      {adaRiwayat && (
        <details className="prod-lipat" data-testid="riwayat-pemakaian">
          <summary>Riwayat dan dokumen pemakaian ({jumlahRiwayat})</summary>
          <div className="space-y-4 pb-2 pt-1">
            {adaBaru && <div className="space-y-2" data-testid="sec-bahan-baru"><h4 className="m-0">{KARTU_SUMBER.gudang.label}</h4><RiwayatBahanBaru unitId={unitId} data={data} bolehUbah={!!izin.pemakaianAktual} aktif={aktif} onDone={onDone} /></div>}
            {adaSementara && <div className="space-y-2" data-testid="sec-pemakaian-sementara"><h4 className="m-0 flex flex-wrap items-center gap-2"><Hourglass size={14} aria-hidden />{KARTU_SUMBER.belum.label}{sementara.total.perluRekonsiliasi > 0 && <Badge variant="orange" className="bh-b-orange" title={SUMBER_SEMENTARA.dampak}>{sementara.total.perluRekonsiliasi} perlu rekonsiliasi Gudang</Badge>}</h4>
              <PemakaianSementaraDaftar data={sementara} bolehCatat={!!izin.catatPemakaianSementara} bolehGudang={!!izin.putuskanUsulan} aktif={aktif} onDone={onDone} /></div>}
            {adaLama && <div className="space-y-2" data-testid="sec-komponen-lama"><h4 className="m-0">{KARTU_SUMBER.lama.label}</h4><KomponenLamaDaftar unitId={unitId} kodeUnit={kodeUnit} data={kl} bolehUbah={!!izin.pemakaianAktual} aktif={aktif} meta={{ fotoMaks: 3 }} onDone={onDone} /></div>}
          </div>
        </details>
      )}

      <CatatanHistorisBagian data={data} unitId={unitId} izin={izin} onDone={onDone} />

      {/* FORM "Catat pemakaian bahan": dialog lebar — pilih sumber → pilih bahan → isi jumlah → periksa → konfirmasi. Membuka/menutup/memilih TIDAK menulis apa pun; stok hanya berubah saat tombol konfirmasi ditekan. */}
      <Modal open={formTampil} onOpenChange={(v) => { if (!v) tutup(); }} title="Catat pemakaian bahan" description={`${kodeUnit}${data.unit.order?.customer?.name ? ` · ${data.unit.order.customer.name}` : ""}`}
        contentProps={{ "data-testid": "dialog-catat-bahan" }}
        className="prod-dlg-bahan flex flex-col max-sm:!left-0 max-sm:!top-0 max-sm:!h-full max-sm:!max-h-full max-sm:!w-full max-sm:!max-w-full max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-none">
        <div ref={formRef} className="prod-bhn-form" data-testid="panel-catat-aktual" data-mode={mode}>
          <div role="radiogroup" aria-label="Sumber pemakaian bahan" className="prod-sumber-seg" data-testid="aktual-sumber-tombol">
            {[["gudang", Package, false, null], ["belum", HelpCircle, !bolehBelumAda, "Akun Anda tidak boleh mencatat pemakaian sementara atau mengusulkan bahan"], ["lama", Recycle, false, null]].map(([kunci, Ikon, mati, alasan]) => {
              const aktifSumber = (mode === "katalog" ? "gudang" : mode) === kunci;
              return (
                <button key={kunci} type="button" role="radio" aria-checked={aktifSumber} disabled={mati || rencanaEdit} title={mati ? alasan : undefined} data-testid={`sumber-${kunci}`} className={cn("prod-sumber-seg-item", aktifSumber && "aktif")} onClick={() => pilih(kunci)}>
                  <Ikon size={18} aria-hidden />{kunci === "lama" ? "Komponen pelanggan" : PILIHAN_SUMBER[kunci].label}
                </button>
              );
            })}
          </div>
          {infoSumber && <p className="prod-sumber-info" data-testid={`sumber-${mode === "katalog" ? "gudang" : mode}-dampak`}>{mode === "katalog" || mode === "gudang" ? "Bahan Gudang: stok berkurang lewat Material Issue/pergerakan stok resmi, tepat sekali, saat dikonfirmasi." : mode === "belum" ? "Bahan belum tercatat: hanya fakta pemakaian sementara; stok, biaya, dan jurnal tidak berubah sampai Gudang merekonsiliasi." : "Komponen pelanggan: milik pelanggan (bongkaran kasur), bukan stok perusahaan dan tanpa biaya bahan baru."}</p>}

          {konfirmGanti && (
            <div role="alertdialog" aria-label="Isian belum dikonfirmasi" className="prod-peringatan" data-testid="konfirmasi-ganti-sumber">
              <p className="m-0"><b>Isian ini belum dikonfirmasi.</b> {konfirmGanti.ke ? "Mengganti sumber akan membuang isian sumber ini." : "Menutup form akan membuang isiannya."} Tidak ada yang tercatat dan stok tidak berubah.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="neutral" className="min-h-[44px]" onClick={() => setKonfirmGanti(null)} data-testid="ganti-batal">Kembali ke isian</Button>
                <Button className="min-h-[44px]" data-testid="ganti-ya" onClick={() => (konfirmGanti.ke ? terapkanPilih(konfirmGanti.ke) : tutupLangsung())}>{konfirmGanti.ke ? "Ganti sumber, buang isian" : "Tutup, buang isian"}</Button>
              </div>
            </div>
          )}

          {terkirim ? (
            <PembetulanUnitSelesai key={`terkirim-${mode}`} unitId={unitId} kodeUnit={kodeUnit} izin={izin} cara={CARA_TERKIRIM[mode === "katalog" ? "gudang" : mode]} onTutup={tutupLangsung} onDone={onDone} />
          ) : (
            <>
              {mode === "lama" && <p className="prod-sumber-teks" data-testid="mode-teks">{KARTU_SUMBER.lama.teks} {asalKomponen(kodeUnit)}.</p>}
              {mode === "gudang" && <CatatBahanBaru key={`gudang-${awalCari}`} onTertinggal={setTertinggal} onDirty={(d) => { dirtyGudangRef.current = d; }} data={data} unitId={unitId} izin={izin} awalCariAwal={awalCari} onDone={onDone} onTutup={tutupLangsung} onPakaiSementara={bukaKatalog} onBukanBahanIni={(b) => { setAwalBelum({ nama: "", satuan: SATUAN_LIST.includes(b.satuan) ? b.satuan : "PCS", alasan: "" }); setMode("belum"); }} />}
              {mode === "katalog" && bahanKat && <FormSementaraKatalog key={`katalog-${bahanKat.materialId}`} unitId={unitId} kodeUnit={kodeUnit} bahan={bahanKat} qtyAwal={bahanKat.qty ?? ""} onSelesai={onDone} onBatal={tutup} onBukanBahanIni={() => { setAwalBelum({ nama: "", satuan: SATUAN_LIST.includes(bahanKat.satuan) ? bahanKat.satuan : "PCS", alasan: "" }); setMode("belum"); }} />}
              {mode === "belum" && <BahanBelumAda key={`belum-${awalBelum.nama}-${awalBelum.dariTertinggal ? "lanjut" : "baru"}`} awalNama={awalBelum.nama} awalSatuan={awalBelum.satuan} alasanAwal={awalBelum.alasan} tertinggalAwal={awalBelum.dariTertinggal ? tertinggal : null} onTertinggal={setTertinggal} unitId={unitId} kodeUnit={kodeUnit} izin={izin} onTutup={tutupLangsung} onDone={onDone} onSementaraKatalog={bukaKatalog} onGunakanKatalog={(k) => { setAwalCari(k.nama); setMode("gudang"); }} />}
              {mode === "lama" && <FormKomponenLama key="lama" unitId={unitId} kodeUnit={kodeUnit} meta={{ fotoMaks: 3 }} onSelesai={selesaiKomponen} onBatal={tutup} />}
            </>
          )}
        </div>
      </Modal>
    </section>
  );
}
