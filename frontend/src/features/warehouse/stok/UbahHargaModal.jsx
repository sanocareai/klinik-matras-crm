import React, { useMemo, useRef, useState } from "react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { GudField, WaktuGud } from "@/features/warehouse/form/GudKontrol.jsx";
import { IkAwas, IkMuatUlang } from "@/components/gudangIcons.jsx";
import { TEKS, rp, rpNilai, tanggalJam, keInputLokal, periksaIsian, susunMasukan, varianBukti } from "./hargaBerlakuLogic.js";

const TIPE_TEKS = { ISSUE: "Pemakaian", RETURN: "Retur", WASTE: "Waste", ADJUSTMENT: "Penyesuaian" };
const BEKU_TEKS = { DIBEKUKAN: "sudah dibekukan", DIBEKUKAN_TANPA_HARGA: "dibekukan tanpa harga", BELUM_DIBEKUKAN: "belum dibekukan", GAGAL_PEMBEKUAN: "GAGAL dibekukan (perlu diperbaiki)" };

// UBAH HARGA BERLAKU (atau KOREKSI salah input) — redesain Gudang, 3 Nov 2026: harga baru, waktu berlaku (pemilih tanggal & jam aplikasi), alasan, catatan/bukti opsional → PRATINJAU dari server → simpan.
// Satu Idempotency-Key per pembukaan modal: klik ganda / ulang = satu baris (kunci sinkron lewat ref). Hash pratinjau menjaga agar yang disimpan = yang dilihat. Harga Berlaku (HPP operasional) bukan nilai persediaan Finance.
export default function UbahHargaModal({ open, onClose, bahan, hargaSekarang, koreksi = null, onTersimpan }) {
  const [harga, setHarga] = useState(koreksi ? String(koreksi.harga).replace(".", ",") : "");
  const [mode, setMode] = useState("SEKARANG"); const [mulai, setMulai] = useState(koreksi ? keInputLokal(koreksi.berlakuMulai) : keInputLokal(new Date(Date.now() + 86400_000)));
  const [paham, setPaham] = useState(false); const kirimRef = useRef(false);
  const [alasan, setAlasan] = useState(""); const [bukti, setBukti] = useState(koreksi?.catatanBukti ?? "");
  const [galatKolom, setGalatKolom] = useState({}); const [galat, setGalat] = useState("");
  const [pra, setPra] = useState(null); const [sibuk, setSibuk] = useState(false);
  const kunci = useRef(`harga-berlaku-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`);
  const masukan = useMemo(() => susunMasukan({ bahan, harga, mode, mulaiLokal: mulai, alasan, catatanBukti: bukti, koreksiId: koreksi?.id }), [bahan, harga, mode, mulai, alasan, bukti, koreksi]);

  const lihatPratinjau = async () => {
    const e = periksaIsian({ harga, mode, mulaiLokal: mulai, alasan, koreksi: !!koreksi }); setGalatKolom(e); setGalat(""); setPaham(false);
    if (Object.keys(e).length) return;
    setSibuk(true);
    try { setPra(await api.pratinjauHargaBerlaku(masukan)); } catch (err) { setGalat(err.message); } finally { setSibuk(false); }
  };
  const simpan = async () => {
    if (kirimRef.current || sibuk || !pra) return; if (koreksi && !paham) { setGalat("Centang konfirmasi dampak dulu."); return; } kirimRef.current = true; setSibuk(true); setGalat("");
    try { const r = await api.simpanHargaBerlaku({ ...masukan, hashPratinjau: pra.hash, ...(koreksi ? { konfirmasiDampak: true } : {}) }, kunci.current); onTersimpan?.(r); onClose(); }
    catch (err) { setGalat(err.message); if (err.code === "PRATINJAU_BERUBAH") setPra(null); } finally { kirimRef.current = false; setSibuk(false); }
  };
  const ubahIsian = (set) => (e) => { set(typeof e === "string" ? e : e.target.value); setPra(null); };

  return (
    <Modal portalToBody open={open} onOpenChange={(o) => (o ? null : onClose())} title={koreksi ? "Koreksi salah input historis (tindakan khusus)" : "Ubah harga berlaku"}
      description={`${bahan.kode} — ${bahan.nama}`} className="sm:w-[520px] gud-modal"
      footer={pra ? (
        <>
          <button type="button" className="gud-tombol" onClick={() => setPra(null)} disabled={sibuk}>Ubah isian</button>
          <button type="button" className="gud-tombol gud-tombol-utama" onClick={simpan} disabled={sibuk || (koreksi && !paham)} data-testid="simpan-harga">{sibuk && <IkMuatUlang size={14} className="animate-spin" />}{koreksi ? "Simpan koreksi" : "Simpan harga"}</button>
        </>
      ) : (
        <>
          <button type="button" className="gud-tombol" onClick={onClose}>Batal</button>
          <button type="button" className="gud-tombol gud-tombol-utama" onClick={lihatPratinjau} disabled={sibuk} data-testid="lihat-pratinjau">{sibuk && <IkMuatUlang size={14} className="animate-spin" />}Lihat pratinjau</button>
        </>
      )}>
      <form className="gud-form" data-testid="modal-ubah-harga" noValidate onSubmit={(e) => { e.preventDefault(); if (!pra) lihatPratinjau(); }}>
        <p className="gud-info" data-testid="catatan-pemisah"><b>{TEKS.bukan}</b> {TEKS.finance}</p>
        {koreksi ? <p className="gud-info" data-nada="awas" data-testid="catatan-koreksi">Tindakan khusus: memperbaiki baris harga {rp(koreksi.harga)} (mulai {tanggalJam(koreksi.berlakuMulai)}). Baris lama tidak dihapus (riwayat tetap). Pemakaian yang sudah dibekukan TIDAK diubah diam-diam; semua pemakaian terdampak ditampilkan di pratinjau dan harus Anda konfirmasi.</p>
          : <p className="gud-info" data-testid="catatan-tanpa-mundur">{TEKS.aturanTanpaMundur}</p>}
        {!pra && (
          <>
            <GudField label={`Harga baru per ${bahan.satuan}`} htmlFor="hb-harga" wajib galat={galatKolom.harga} hint={`Hanya satuan stok (${bahan.satuan}). Harga per satuan lain (pak/roll) harus dikonversi dulu.`}>
              <span className="gud-f-angka" data-invalid={galatKolom.harga ? "ya" : undefined}>
                <span className="gud-f-awalan" aria-hidden="true">Rp</span>
                <input id="hb-harga" type="text" inputMode="decimal" autoComplete="off" value={harga} onChange={(e) => ubahIsian(setHarga)(e.target.value)} aria-invalid={!!galatKolom.harga || undefined} placeholder="mis. 36000" data-testid="input-harga" style={{ paddingLeft: 44, paddingRight: 72 }} />
                <span className="gud-f-satuan" data-testid="satuan-tetap">/ {bahan.satuan}</span>
              </span>
            </GudField>
            {koreksi ? (
              <GudField label="Waktu berlaku harga yang benar" htmlFor="hb-mulai" wajib galat={galatKolom.mulai} hint="Waktu berlaku baris yang dikoreksi (boleh lampau — ini koreksi, bukan perubahan harga biasa).">
                <WaktuGud id="hb-mulai" value={mulai} onChange={ubahIsian(setMulai)} invalid={!!galatKolom.mulai} data-testid="input-mulai" />
              </GudField>
            ) : (
              <fieldset className="gud-form gud-set" data-testid="pilih-waktu">
                <legend className="gud-f-label">Mulai berlaku</legend>
                <div role="radiogroup" aria-label="Mulai berlaku" className="gud-segmen">
                  <button type="button" role="radio" aria-checked={mode === "SEKARANG"} onClick={() => { setMode("SEKARANG"); setPra(null); }} data-testid="mode-sekarang">Saat disimpan (sekarang)</button>
                  <button type="button" role="radio" aria-checked={mode === "JADWAL"} onClick={() => { setMode("JADWAL"); setPra(null); }} data-testid="mode-jadwal">Jadwalkan waktu mendatang</button>
                </div>
                {mode === "JADWAL" && <GudField label="Tanggal & jam (harus di masa depan)" htmlFor="hb-mulai" wajib galat={galatKolom.mulai}><WaktuGud id="hb-mulai" value={mulai} onChange={ubahIsian(setMulai)} invalid={!!galatKolom.mulai} data-testid="input-mulai" /></GudField>}
              </fieldset>
            )}
            <GudField label="Alasan" htmlFor="hb-alasan" wajib galat={galatKolom.alasan} hint={koreksi ? "Wajib, minimal 10 karakter; tercatat bersama pelaku." : "Wajib; tercatat bersama pelaku."}>
              <textarea id="hb-alasan" rows={3} value={alasan} onChange={ubahIsian(setAlasan)} aria-invalid={!!galatKolom.alasan || undefined} className="gud-f-teks gud-f-area" data-testid="input-alasan" />
            </GudField>
            <GudField label="Catatan / bukti (opsional)" htmlFor="hb-bukti" hint="Mis. nomor nota atau nama supplier. Boleh kosong — harga tetap tersimpan dengan label “Belum didukung bukti”.">
              <textarea id="hb-bukti" rows={2} value={bukti} onChange={ubahIsian(setBukti)} className="gud-f-teks gud-f-area" data-testid="input-bukti" />
            </GudField>
            {hargaSekarang != null
              ? <p className="gud-petunjuk">Harga berlaku sekarang: <b>{rp(hargaSekarang)}</b> / {bahan.satuan}</p>
              : <p className="gud-petunjuk" data-testid="belum-ada-harga-modal">Belum ada harga berlaku (belum diisi, bukan Rp0). Pemakaian yang diposting sebelum harga ini berlaku tetap tanpa harga operasional.</p>}
          </>
        )}
        {pra && <Pratinjau pra={pra} />}
        {pra?.dampakKoreksi && <label className="gud-pilih-baris gud-info" data-nada="awas" data-testid="konfirmasi-dampak"><input type="checkbox" checked={paham} onChange={(e) => setPaham(e.target.checked)} data-testid="centang-dampak" /> <span>Saya sudah membaca {pra.dampakKoreksi.jumlah} pemakaian terdampak di atas. Nilai beku lama tidak berubah; perbaikannya lewat penerapan khusus dua orang.</span></label>}
        {galat && <p role="alert" className="gud-info" data-nada="galat" data-testid="galat-modal">{galat}</p>}
      </form>
    </Modal>
  );
}

function Pratinjau({ pra }) {
  const naik = pra.selisihPersen != null && pra.selisihPersen > 0;
  return (
    <div className="space-y-2.5" data-testid="pratinjau-harga">
      <div className="rounded-btn bg-inset px-3 py-2.5">
        <div className="text-[11px] text-ink3">Harga lama → harga baru (per {pra.satuan})</div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-2 text-[16px] font-bold tabular-nums text-ink">
          <span className="text-ink3 line-through" data-testid="harga-lama">{pra.hargaLama == null ? "belum ada" : rp(pra.hargaLama)}</span>
          <span aria-hidden>→</span><span data-testid="harga-baru">{rp(pra.hargaBaru)}</span>
          {pra.selisihPersen != null && <span className={`text-[12px] font-semibold ${naik ? "text-red" : "text-green"}`}>{naik ? "+" : ""}{pra.selisihPersen}%</span>}
        </div>
        <div className="mt-1 text-[12px] text-ink2">Mulai berlaku <b data-testid="waktu-berlaku">{pra.saatDisimpan ? "saat disimpan (sekarang)" : tanggalJam(pra.berlakuMulai)}</b> · satuan <b>{pra.satuan}</b> · alasan: {pra.alasan}</div>
        <div className="mt-1.5"><span className="gud-pill" data-warna={varianBukti(pra.labelBukti)} data-testid="label-bukti-pratinjau">{pra.teksLabelBukti}</span></div>
      </div>
      {pra.dampakKoreksi && (
        <div className="space-y-1.5 rounded-btn border border-orange/40 px-3 py-2 text-[12px] text-ink2" data-testid="dampak-koreksi">
          <div><b className="text-ink">{pra.dampakKoreksi.jumlah}</b> pemakaian terdampak (sejak {tanggalJam(pra.dampakKoreksi.dariWaktu)}): <b className="text-ink">{pra.dampakKoreksi.dibekukanDenganHargaLama}</b> sudah dibekukan dengan harga lama (nilai {rpNilai(pra.dampakKoreksi.nilaiBekuTerdampak)}), {pra.dampakKoreksi.belumDibekukan} belum dibekukan, {pra.dampakKoreksi.dibekukanTanpaHarga} dibekukan tanpa harga.</div>
          {pra.terkoreksi && <div>{pra.terkoreksi.ket}</div>}
          {pra.dampakKoreksi.baris.length > 0 && (
            <div className="max-h-44 overflow-auto rounded-btn border border-line"><table className="w-full text-[11.5px]"><thead className="sticky top-0 bg-inset text-left text-ink3"><tr><th className="px-2 py-1">Order</th><th className="px-2 py-1">Tanggal</th><th className="px-2 py-1">Jenis</th><th className="px-2 py-1 text-right">Qty</th><th className="px-2 py-1 text-right">Harga</th><th className="px-2 py-1">Keadaan</th></tr></thead>
              <tbody>{pra.dampakKoreksi.baris.map((x) => <tr key={x.movementId} className="border-t border-line"><td className="px-2 py-1">{x.order ?? x.unit}</td><td className="px-2 py-1">{x.tanggal}</td><td className="px-2 py-1">{TIPE_TEKS[x.tipe] ?? x.tipe}{x.ikutIssueAsal ? " (ikut ISSUE asal)" : ""}</td><td className="px-2 py-1 text-right tabular-nums">{x.qty}</td><td className="px-2 py-1 text-right tabular-nums">{x.ikutIssueAsal ? "ikut harga ISSUE asal" : <><span className="text-ink3 line-through">{x.hargaBerlakuSebelum != null ? rp(x.hargaBerlakuSebelum) : "belum ada"}</span> → {x.hargaBerlakuSesudah != null ? rp(x.hargaBerlakuSesudah) : "belum ada"}</>}</td><td className="px-2 py-1">{BEKU_TEKS[x.keadaanBeku]}{x.nilaiBeku != null ? ` (${rpNilai(x.nilaiBeku)})` : ""}</td></tr>)}</tbody></table></div>
          )}
          {pra.dampakKoreksi.dipotong && <div className="text-ink3">Daftar dipotong 300 baris pertama; jumlah di atas mencakup semuanya.</div>}
        </div>
      )}
      {pra.dampak && (
        <ul className="space-y-1 rounded-btn border border-line px-3 py-2 text-[12px] text-ink2" data-testid="dampak-order">
          <li><b className="text-ink">{pra.dampak.akanMemakai.order}</b> order ({pra.dampak.akanMemakai.unit} unit) belum memakai bahan ini — akan memakai harga yang berlaku saat dipakai.</li>
          <li><b className="text-ink">{pra.dampak.sudahDibekukanSejakMulai.pemakaian}</b> pemakaian sejak waktu berlaku sudah dibekukan ({rpNilai(pra.dampak.sudahDibekukanSejakMulai.nilai)}) — <b>tidak berubah</b>.</li>
          <li><b className="text-ink">{pra.dampak.belumDibekukan.pemakaian}</b> pemakaian lama belum punya harga operasional — tidak otomatis; lewat “Beri harga ke pemakaian lama” (butuh persetujuan).</li>
        </ul>
      )}
      {pra.peringatan?.map((w) => (
        <div key={w.kode} className="flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2 text-[12px] text-ink2" data-testid={`peringatan-${w.kode}`}><IkAwas size={16} aria-hidden />{w.pesan}</div>
      ))}
      <p className="text-[11.5px] leading-relaxed text-ink3">{pra.aturan} Stok, ISSUE lama, jurnal, dan GL tidak berubah oleh perubahan harga ini.</p>
    </div>
  );
}
