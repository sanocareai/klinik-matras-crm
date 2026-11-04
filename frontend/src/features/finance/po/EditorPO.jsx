import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, ChevronDown, Plus, Search, Trash2, IkBahan, IkHarga } from "@/components/ikApple.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { TERMIN_AWAL, galatTermin } from "@/features/finance/terminLogic.js";
import { TanggalPO, PemilihSupplier, SelectPO, indukGulir, ruangPopup } from "./KontrolPO.jsx";
import TerminPO from "./KontrolPO.jsx";
import { cariFieldBermasalah, fieldDariGalatBaris, barisKosong, langkahFakturSetelahSimpan } from "./poKontrol.js";
import { petaBarisHarga, teksDampakBaris, ringkasDampak, ringkasHasilSimpan, STATUS_HARGA_PO } from "@/features/finance/hargaDariPOLogic.js";
import { Pembuka } from "@/features/finance/RingkasanKecil.jsx";
import { formatUang, TombolAksi, InputUang } from "@/features/finance/shared.jsx";
import { MODE_PENDAMPING_OPSI, adaPendamping, teksPratinjauPendamping } from "@/features/kedatangan/kedatanganLogic.js";
import {
  baris0, subtotal, totalIsian, galatBaris, galatFormulir, formDariPO, bodyDariForm, SATUAN_OPSI, labelSatuan, labelJenisSku, teksSetara, infoKonversi,
  daftarBarangBaru, barisLainDariForm, barisBaruUntukCek, masalahDariCek, masalahDariGalat, jenisMasalah,
} from "@/features/finance/purchaseOrderLogic.js";
import { ModalBarangBaru, PanelMasalahBaris } from "./BarangBaruPO.jsx";
import { DAMPAK_HARGA_RINCI, KALIMAT_HARGA_SIMPAN, KETERANGAN_HARGA_SINGKAT } from "./poTampilan.js";

// Editor PO lebar (baru / ubah draf). Hanya presentasi: validasi (galatBaris/galatFormulir), subtotal, payload (bodyDariForm), idempotensi, pemeriksaan barang mirip,
// pratinjau Harga Berlaku, dan endpoint SAMA dengan formulir lama. Gaya: styles/sanss-finance-po.css (.fin-po-modal / .fin-poed).

const hariIniISO = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
let hitungKunci = 0;
const kunciBaris = () => `b${++hitungKunci}`;
const denganKunci = (l) => (l._k ? l : { ...l, _k: kunciBaris() });

/** Pemilih bahan: kolom cari + daftar pilihan terarah (combobox). Bahan yang sudah dipakai baris lain ditampilkan nonaktif dengan nomor barisnya. */
export function PemilihBahan({ materials, value, nomor, namaCadangan, dipakai, onPilih, fokusOtomatis = false }) {
  const [q, setQ] = useState("");
  const [buka, setBuka] = useState(false);
  const [aktif, setAktif] = useState(0);
  const [arah, setArah] = useState({ naik: false, tinggi: 260 });
  const wadah = useRef(null);
  const input = useRef(null);
  const idDaftar = useId();
  const terpilih = materials.find((m) => m.id === value);
  const semua = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? materials.filter((m) => `${m.code} ${m.name} ${m.itemGroup || ""}`.toLowerCase().includes(t)) : materials;
  }, [materials, q]);
  const hasil = semua.slice(0, 30);
  useEffect(() => { if (fokusOtomatis && !value) input.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- hanya saat baris baru ditambahkan
  useEffect(() => { setAktif(0); }, [q]);
  // Ukur ulang setelah tata letak/gulir selesai (fokus bisa menggulir area editor sesudah daftar terbuka) dan saat area gulir bergerak.
  useEffect(() => {
    if (!buka || !input.current) return undefined;
    const ukur = () => { if (input.current) setArah((a) => { const b = ruangPopup(input.current); return b.naik === a.naik && Math.abs(b.tinggi - a.tinggi) < 4 ? a : b; }); };
    ukur();
    const r1 = requestAnimationFrame(() => requestAnimationFrame(ukur));
    const induk = indukGulir(input.current);
    induk?.addEventListener("scroll", ukur, { passive: true });
    window.addEventListener("resize", ukur);
    return () => { cancelAnimationFrame(r1); induk?.removeEventListener("scroll", ukur); window.removeEventListener("resize", ukur); };
  }, [buka, q]);

  // Esc pada daftar terbuka hanya menutup daftar (bukan seluruh dialog): pendengar di fase capture jendela berjalan sebelum pendengar dialog.
  useEffect(() => {
    if (!buka) return undefined;
    const h = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); setBuka(false); } };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [buka]);
  const pilih = (m) => { if (!m || (dipakai.get(m.id) && dipakai.get(m.id) !== nomor)) return; setBuka(false); setQ(""); onPilih(m.id); };
  const tekan = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setBuka(true); setAktif((i) => Math.min(hasil.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAktif((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && buka) { e.preventDefault(); pilih(hasil[aktif]); }
  };

  if (value) {
    return (
      <div className="fin-poed-bahan fin-poed-bahan-pilih" data-testid="material-terpilih">
        <span className="fin-poed-ubin" aria-hidden="true"><IkBahan size={20} /></span>
        <div className="fin-poed-bahan-teks">
          <span className="fin-poed-bahan-nama">{terpilih ? terpilih.name : (namaCadangan || "Item")}</span>
          {terpilih && <span className="fin-poed-bahan-kode">{terpilih.code} · satuan stok {labelSatuan(terpilih.unit)}{terpilih.kind ? ` · ${labelJenisSku(terpilih.kind)}` : ""}</span>}
        </div>
        <button type="button" className="fin-tombol fin-poed-ganti" onClick={() => onPilih("")} aria-label={`Ganti bahan baris ${nomor}`}><span>Ganti</span></button>
      </div>
    );
  }
  return (
    <div className="fin-poed-bahan fin-poed-bahan-cari" ref={wadah} onBlur={(e) => { if (!wadah.current?.contains(e.relatedTarget)) setBuka(false); }}>
      <label className="fin-poed-cari">
        <Search size={17} aria-hidden="true" />
        <input
          ref={input} type="text" role="combobox" aria-expanded={buka} aria-controls={idDaftar} aria-autocomplete="list" autoComplete="off"
          aria-activedescendant={buka && hasil[aktif] ? `${idDaftar}-${aktif}` : undefined}
          value={q} onChange={(e) => { setQ(e.target.value); setBuka(true); }} onClick={() => setBuka(true)} onKeyDown={tekan}
          placeholder="Cari kode atau nama bahan…" aria-label={`Cari bahan baris ${nomor}`}
        />
        <ChevronDown size={17} aria-hidden="true" className={cn("fin-poed-chev", buka && "buka")} />
      </label>
      {buka && (
        <div className={cn("fin-poed-popup", arah.naik && "naik")} style={{ maxHeight: arah.tinggi }}>
          <ul id={idDaftar} role="listbox" aria-label={`Hasil pencarian bahan baris ${nomor}`} className="fin-poed-opsi">
            {hasil.length === 0 && <li className="fin-poed-opsi-kosong" role="presentation">Tidak ada bahan yang cocok. Bila barangnya memang belum ada, buat barang baru.</li>}
            {hasil.map((m, i) => {
              const dipakaiBaris = dipakai.get(m.id);
              const mati = !!dipakaiBaris && dipakaiBaris !== nomor;
              return (
                <li key={m.id} id={`${idDaftar}-${i}`} role="option" aria-selected={i === aktif} aria-disabled={mati || undefined} className={cn("fin-poed-opsi-i", i === aktif && "aktif", mati && "mati")}
                  onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setAktif(i)} onClick={() => pilih(m)}>
                  <span className="fin-poed-ubin kecil" aria-hidden="true"><IkBahan size={16} /></span>
                  <span className="fin-poed-opsi-teks"><span className="fin-poed-opsi-nama">{m.name}</span><span className="fin-poed-opsi-kode">{m.code} · {labelSatuan(m.unit)}{mati ? ` · sudah di baris ${dipakaiBaris}` : ""}</span></span>
                </li>
              );
            })}
          </ul>
          {semua.length > hasil.length && <p className="fin-poed-opsi-info">Menampilkan {hasil.length} dari {semua.length} bahan — ketik untuk menyaring.</p>}
        </div>
      )}
    </div>
  );
}

function BarisItem({ l, i, ctx }) {
  const { bahan, materials, petaHarga, masalah, masalahHarga, set, hapus, barisRef, bolehBuatSku, jumlahBaris, dipakai, po, setBarangBaru, fokusBaru, buka, toggle, percobaan } = ctx;
  const no = i + 1;
  const m = bahan.get(l.materialId);
  const unitStok = l.materialBaru ? l.materialBaru.satuanStok : m?.unit ?? null;
  const g = (!barisKosong(l) || percobaan) ? galatBaris(l, unitStok) : null; // baris kosong baru tampil merah setelah percobaan simpan
  const setara = teksSetara(l, unitStok);
  const kv = infoKonversi(l, unitStok);
  const satuanBeli = l.materialBaru ? (l.materialBaru.satuanBeli || l.materialBaru.satuanStok) : (l.satuanBeli || unitStok);
  const ph = petaHarga[no];
  const st = STATUS_HARGA_PO[ph?.status];
  const bermasalahHarga = !!masalahHarga[no] || !!ph?.masalah;
  const adaMasalah = !!masalah[no];
  const idRinci = `rinci-${l._k}`;
  const terbuka = buka.has(l._k) || adaMasalah || bermasalahHarga;
  const sudahBahan = !!(l.materialId || l.materialBaru);
  const pratinjauPend = teksPratinjauPendamping(l.pendamping, l.qty, satuanBeli ? labelSatuan(satuanBeli) : "");
  const flag = adaMasalah || bermasalahHarga ? "masalah" : undefined;
  return (
    <div className="fin-poed-baris" data-testid="baris-po" data-masalah={adaMasalah ? jenisMasalah(masalah[no]) : undefined} data-flag={flag} ref={(el) => { barisRef.current[no] = el; }} role="group" aria-label={`Baris ${no}`}>
      <div className="fin-poed-sel fin-poed-c-bahan">
        <span className="fin-poed-label-kecil">Bahan</span>
        {l.materialBaru ? (
          <div className="fin-poed-bahan fin-poed-bahan-baru" data-testid="barang-baru">
            <span className="fin-poed-ubin" aria-hidden="true"><IkBahan size={20} /></span>
            <div className="fin-poed-bahan-teks">
              <span className="fin-poed-bahan-nama">{l.materialBaru.nama}</span>
              <span className="fin-poed-bahan-kode">Barang baru — akan dibuat saat PO disimpan · {labelJenisSku(l.materialBaru.jenis)} · satuan stok {labelSatuan(l.materialBaru.satuanStok)}{l.materialBaru.kodeSupplier ? ` · kode supplier ${l.materialBaru.kodeSupplier}` : ""}</span>
            </div>
            <span className="fin-poed-baru-aksi">
              <button type="button" className="fin-tombol" onClick={() => setBarangBaru({ baris: i, awal: l.materialBaru })}><span>Ubah</span></button>
              <button type="button" className="fin-tombol" onClick={() => set(i, { materialBaru: null })}><span>Pakai bahan yang ada</span></button>
            </span>
          </div>
        ) : (
          <>
            <PemilihBahan
              materials={materials} value={l.materialId} nomor={no} namaCadangan={po?.lines?.find((x) => x.materialId === l.materialId)?.nama} dipakai={dipakai}
              fokusOtomatis={fokusBaru === l._k} onPilih={(id) => set(i, { materialId: id, satuanBeli: "", faktorKonversi: "" })}
            />
            {!l.materialId && bolehBuatSku && (
              <button type="button" className="fin-poed-buat" onClick={() => setBarangBaru({ baris: i, awal: null })} data-testid="tombol-barang-baru"><Plus size={14} aria-hidden="true" /> Buat barang baru</button>
            )}
          </>
        )}
        {sudahBahan && (
          <div className="fin-poed-ringkas fin-poed-ringkas-identitas">
            <Pembuka buka={terbuka} onToggle={() => toggle(l._k)} id={idRinci} className="fin-poed-rinci-tombol" data-testid={`rinci-${no}`}>Rincian baris</Pembuka>
            {setara && <span className="fin-chip fin-chip-biru" data-testid="setara">{setara}</span>}
            {adaPendamping(l.pendamping) && <span className="fin-chip fin-chip-neutral">Pendamping ada</span>}
            {st && !masalahHarga[no] && <span className={cn("fin-chip", `fin-chip-${{ accent: "biru", orange: "orange", green: "green", red: "red", neutral: "neutral" }[st.varian] || "neutral"}`)}>Harga: {st.teks}</span>}
          </div>
        )}
      </div>

      <div className="fin-poed-sel fin-poed-c-jumlah">
        <label className="fin-poed-label-kecil" htmlFor={`qty-${l._k}`}>Jumlah</label>
        <input id={`qty-${l._k}`} className="fin-poed-input" type="number" inputMode="decimal" min="0" step="any" value={l.qty} aria-label={`Jumlah baris ${no}`} aria-invalid={(percobaan && g && fieldDariGalatBaris(l, g) === "qty") || undefined} onChange={(e) => set(i, { qty: e.target.value })} />
      </div>
      <div className="fin-poed-sel fin-poed-c-satuan">
        <span className="fin-poed-label-kecil">Satuan</span>
        <span className="fin-poed-satuan" aria-label={`Satuan baris ${no}: ${satuanBeli ? labelSatuan(satuanBeli) : "belum ada"}`}>{satuanBeli ? labelSatuan(satuanBeli) : "—"}</span>
      </div>
      <div className="fin-poed-sel fin-poed-c-harga">
        <label className="fin-poed-label-kecil" htmlFor={`hrg-${l._k}`}>Harga satuan (Rp)</label>
        <div className="fin-poed-rp"><span aria-hidden="true">Rp</span><InputUang id={`hrg-${l._k}`} value={l.unitPrice} onChange={(v) => set(i, { unitPrice: v })} aria-label={`Harga satuan baris ${no}`} aria-invalid={(percobaan && g && fieldDariGalatBaris(l, g) === "harga") || undefined} className="fin-poed-input fin-poed-input-rp" /></div>
      </div>
      <div className="fin-poed-sel fin-poed-c-subtotal">
        <span className="fin-poed-label-kecil">Subtotal</span>
        <span className="fin-poed-subtotal" aria-label={`Subtotal baris ${no}`}>{formatUang(subtotal(l))}</span>
      </div>
      <div className="fin-poed-sel fin-poed-c-hapus">
        <button type="button" className="fin-poed-hapus" onClick={() => hapus(i)} disabled={jumlahBaris === 1} aria-label={`Hapus baris ${no}`}><Trash2 size={17} aria-hidden="true" /><span className="fin-poed-hapus-teks">Hapus baris</span></button>
      </div>

      {(adaMasalah || (g && (sudahBahan || percobaan))) && (
        <div className="fin-poed-ringkas fin-poed-ringkas-galat">
          {adaMasalah && <span className="fin-chip fin-chip-red">Perlu diselesaikan</span>}
          {g && (sudahBahan || percobaan) && <span className="fin-poed-galat-baris" role="status" data-testid="galat-baris">{g}</span>}
        </div>
      )}

      {terbuka && (
        <div id={idRinci} className="fin-poed-rinci">
          {!l.materialBaru && m && (
            <div className="fin-poed-blok">
              <p className="fin-poed-blok-judul">Satuan pembelian</p>
              <div className="fin-poed-konversi">
                <SelectPO value={l.satuanBeli || m.unit} onChange={(v) => set(i, v === m.unit ? { satuanBeli: "", faktorKonversi: "" } : { satuanBeli: v })} ariaLabel={`Satuan pembelian baris ${no}`} opsi={SATUAN_OPSI.map(([k, t]) => ({ nilai: k, label: t }))} />
                {kv && (
                  <label className="fin-poed-faktor">
                    <span>1 {labelSatuan(kv.satuanBeli)} =</span>
                    <input className="fin-poed-input" type="number" inputMode="decimal" min="0" step="any" value={l.faktorKonversi || ""} aria-label={`Faktor konversi baris ${no}`} placeholder={`isi ${labelSatuan(m.unit)}`} onChange={(e) => set(i, { faktorKonversi: e.target.value })} />
                    <span>{labelSatuan(m.unit)}</span>
                  </label>
                )}
              </div>
              <p className="fin-poed-blok-ket">Biasanya sama dengan satuan stok. Ubah hanya bila supplier menjual dalam satuan lain (mis. dus); isi berapa satuan stok dalam satu satuan beli.</p>
            </div>
          )}
          {!kv && (
            <div className="fin-poed-blok" data-testid="pendamping-po">
              <p className="fin-poed-blok-judul">Jumlah fisik pendamping (opsional)</p>
              <div className="fin-poed-pend-grid">
                <Field label="Satuan pendamping" hint="mis. LEMBAR, KALENG">
                  <Input value={l.pendamping?.satuan ?? ""} onChange={(e) => set(i, { pendamping: { ...l.pendamping, satuan: e.target.value } })} aria-label={`Satuan pendamping baris ${no}`} />
                </Field>
                <Field label="Mode">
                  <SelectPO value={l.pendamping?.mode ?? ""} onChange={(v) => set(i, { pendamping: { ...l.pendamping, mode: v } })} ariaLabel={`Mode pendamping baris ${no}`} opsi={[{ nilai: "", label: "— pilih mode —" }, ...MODE_PENDAMPING_OPSI.map((o) => ({ nilai: o.key, label: o.label }))]} />
                </Field>
                {l.pendamping?.mode === "TETAP" && (
                  <Field label={`Rasio (1 ${satuanBeli ? labelSatuan(satuanBeli) : "satuan"} = …)`}>
                    <input className="fin-poed-input" type="number" inputMode="decimal" min="0" step="any" value={l.pendamping.rasio ?? ""} aria-label={`Rasio pendamping baris ${no}`} onChange={(e) => set(i, { pendamping: { ...l.pendamping, rasio: e.target.value } })} />
                  </Field>
                )}
                {l.pendamping?.mode === "AKTUAL" && (
                  <Field label="Perkiraan jumlah (opsional)">
                    <input className="fin-poed-input" type="number" inputMode="decimal" min="0" step="any" value={l.pendamping.estimasi ?? ""} aria-label={`Perkiraan pendamping baris ${no}`} onChange={(e) => set(i, { pendamping: { ...l.pendamping, estimasi: e.target.value } })} />
                  </Field>
                )}
              </div>
              {l.pendamping?.mode && <p className="fin-poed-blok-ket">{MODE_PENDAMPING_OPSI.find((o) => o.key === l.pendamping.mode)?.hint} Hanya informasi kontrol — tidak memengaruhi stok, nilai persediaan, atau jurnal.</p>}
              {pratinjauPend && <p data-testid="pratinjau-pendamping" className="fin-poed-pratinjau">Tampil di PO: {pratinjauPend}</p>}
            </div>
          )}
          {(masalahHarga[no] || ph) && (
            <p data-testid="dampak-harga-baris" data-status={ph?.status ?? "GAGAL"} role={bermasalahHarga ? "alert" : "status"} className={cn("fin-poed-dampak-baris", bermasalahHarga && "masalah")}>
              <IkHarga size={16} />
              <span>{masalahHarga[no] || teksDampakBaris(ph)}</span>
            </p>
          )}
        </div>
      )}
      {adaMasalah && (
        <div className="fin-poed-masalah">
          <PanelMasalahBaris m={masalah[no]} onPakai={(id) => set(i, { materialId: id, materialBaru: null, satuanBeli: "", faktorKonversi: "" })} onPeriksa={() => setBarangBaru({ baris: i, awal: l.materialBaru, autoPeriksa: true })} onHapus={() => hapus(i)} />
        </div>
      )}
    </div>
  );
}

/** Strip Harga Berlaku di dekat tombol simpan: kalimat tetap (perilaku aktual) + hasil pratinjau server; "Lihat dampak" membuka rincian. */
function StripDampakHarga({ dampak, pra, petaHarga }) {
  const [buka, setBuka] = useState(false);
  const id = useId();
  const baris = (pra?.baris || []).filter((b) => b.masalah || ["BARU", "NAIK", "TURUN"].includes(b.status));
  return (
    <div data-testid="dampak-harga-ringkas" role="status" className={cn("fin-poed-harga", dampak.menahan && "masalah")}>
      <div className="fin-poed-harga-baris">
        <IkHarga size={20} className="fin-poed-harga-ikon" />
        <p className="fin-poed-harga-teks" data-testid="harga-kalimat">
          <b>{KALIMAT_HARGA_SIMPAN}</b>
          <span className="fin-poed-harga-sub" data-testid="harga-sub">{dampak.teks && <span data-testid="harga-jumlah">{dampak.teks} </span>}{pra?.aktif !== false && <span className="fin-poed-harga-hpp">{KETERANGAN_HARGA_SINGKAT}</span>}</span>
        </p>
        <Pembuka buka={buka} onToggle={() => setBuka((v) => !v)} id={id} className="fin-poed-harga-tombol" aria-label="Lihat dampak"><span className="fin-poed-desk">Lihat dampak</span><span className="fin-poed-hp">Dampak</span></Pembuka>
      </div>
      {buka && (
        <div id={id} className="fin-poed-harga-isi">
          <ul>{DAMPAK_HARGA_RINCI.map((t, i) => <li key={i}>{t}</li>)}</ul>
          {baris.length > 0 && (
            <div className="fin-poed-harga-daftar" data-testid="dampak-harga-daftar">
              <p className="fin-poed-blok-judul">Perubahan pada penyimpanan ini</p>
              <ul>{baris.map((b) => <li key={b.materialId}><b>{b.kode}</b> (baris {b.barisPO.join(", ")}): {teksDampakBaris(petaHarga[b.barisPO[0]] || b)}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Pilihan bantuan alur: TIDAK menyimpan nomor faktur di PO, tidak membuat faktur/jurnal, dan tidak menyetujui PO. Hanya menjelaskan langkah lanjutan. */
function FakturDiterima({ nilai, onChange, status, izin }) {
  const id = useId();
  const langkah = langkahFakturSetelahSimpan(status, izin);
  return (
    <div className="fin-poed-faktur" data-testid="faktur-diterima">
      <label className="fin-poed-faktur-pilih" htmlFor={id}>
        <input id={id} type="checkbox" checked={nilai} onChange={(e) => onChange(e.target.checked)} />
        <span><b>Sudah menerima faktur supplier?</b><span className="fin-poed-faktur-ket">Pencatatan faktur tetap langkah terpisah, sesuai status PO.</span></span>
      </label>
      {nilai && (
        <p className="fin-poed-faktur-isi" role="note" data-testid="faktur-diterima-langkah">{langkah.teks} Nomor faktur tidak diisi di PO atau Catatan: nomor dan nilainya dicatat di formulir Catat faktur supplier.</p>
      )}
    </div>
  );
}

export default function EditorPO({ kunci, po, izin, onClose, onSaved }) {
  const mengubah = !!po;
  const bolehBuatSku = izin.admin;
  const [f, setF] = useState(() => (po
    ? (() => { const awal = formDariPO(po); return { ...awal, lines: awal.lines.map(denganKunci) }; })()
    : { supplierId: "", orderDate: hariIniISO(), expectedDate: "", notes: "", lines: [denganKunci(baris0())] }));
  const [termin, setTermin] = useState(TERMIN_AWAL);
  const [suppliers, setSuppliers] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [memuatMaster, setMemuatMaster] = useState(true);
  const [galat, setGalat] = useState("");
  const [barangBaru, setBarangBaru] = useState(null);
  const [masalah, setMasalah] = useState({});
  const [pra, setPra] = useState(null);
  const [masalahHarga, setMasalahHarga] = useState({});
  const [buka, setBuka] = useState(() => new Set());
  const [fokusBaru, setFokusBaru] = useState(null);
  const [tentang, setTentang] = useState(false);
  const [percobaan, setPercobaan] = useState(false); // sudah mencoba menyimpan → galat formulir ditampilkan
  const [disentuh, setDisentuh] = useState({}); // field yang sudah dikunjungi (blur) → galatnya boleh tampil
  const [fakturDiterima, setFakturDiterima] = useState(false); // bantuan alur saja; TIDAK ikut payload dan tidak membuat faktur
  const idForm = useId();
  const idSupplier = `${idForm}-sup`, idTglPO = `${idForm}-tpo`, idTglKirim = `${idForm}-tdt`;
  const sentuh = (k) => setDisentuh((d) => (d[k] ? d : { ...d, [k]: true }));
  const barisRef = useRef({});
  const idTentang = useId();
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const setBaris = useCallback((i, patch) => { setMasalah({}); setF((s) => ({ ...s, lines: s.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) })); }, []);
  const hapusBaris = useCallback((i) => { setMasalah({}); setF((s) => ({ ...s, lines: s.lines.length > 1 ? s.lines.filter((_, idx) => idx !== i) : s.lines })); }, []);
  const tambahBaris = () => { const b = denganKunci(baris0()); setF((s) => ({ ...s, lines: [...s.lines, b] })); setFokusBaru(b._k); };
  const keBaris = (nomor) => setTimeout(() => barisRef.current[nomor]?.scrollIntoView?.({ block: "center", behavior: "smooth" }), 50);
  const toggle = (k) => setBuka((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  useEffect(() => {
    let batal = false;
    Promise.all([
      api.getFinanceSuppliers().then((r) => { if (!batal) setSuppliers((r.suppliers || []).filter((s) => s.active !== false)); }).catch(() => {}),
      api.getMaterials({ active: "true" }).then((m) => { if (!batal) setMaterials(Array.isArray(m) ? m : []); }).catch(() => {}),
    ]).finally(() => { if (!batal) setMemuatMaster(false); });
    return () => { batal = true; };
  }, []);

  // Pratinjau dampak Harga Berlaku, ditunda 500 ms setelah isian berhenti berubah. Hanya MEMBACA: harga berubah saat PO BERHASIL DISIMPAN.
  useEffect(() => {
    const adaIsi = f.lines.some((l) => (l.materialId || l.materialBaru) && Number(l.unitPrice) > 0);
    if (!adaIsi) { setPra(null); return undefined; }
    let batal = false;
    const t = setTimeout(() => {
      const lines = f.lines.map((l) => (l.materialBaru
        ? { materialBaru: { nama: l.materialBaru.nama, satuanStok: l.materialBaru.satuanStok, satuanBeli: l.materialBaru.satuanBeli, faktorKonversi: l.materialBaru.faktorKonversi }, unitPrice: Number(l.unitPrice) }
        : { materialId: l.materialId, unitPrice: Number(l.unitPrice), ...(l.satuanBeli && l.faktorKonversi && { satuanBeli: l.satuanBeli, faktorKonversi: Number(l.faktorKonversi) }) }));
      api.pratinjauHargaPO({ poId: po?.id ?? null, lines }).then((r) => { if (!batal) setPra(r); }).catch(() => { if (!batal) setPra(null); });
    }, 500);
    return () => { batal = true; clearTimeout(t); };
  }, [f.lines, po?.id]);
  const petaHarga = useMemo(() => petaBarisHarga(pra), [pra]);
  const dampak = ringkasDampak(pra);

  const bahan = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const unitMap = useMemo(() => new Map(materials.map((m) => [m.id, m.unit])), [materials]);
  const dipakai = useMemo(() => { const p = new Map(); f.lines.forEach((l, i) => { if (l.materialId && !p.has(l.materialId)) p.set(l.materialId, i + 1); }); return p; }, [f.lines]);
  const galatForm = galatFormulir(f, unitMap) || galatTermin(termin, { tanpaTanggal: true });
  const masalahForm = cariFieldBermasalah(f, unitMap);
  const galatSupplier = (percobaan || disentuh.supplier) && !f.supplierId ? "Pilih supplier" : "";
  const galatTglPO = (percobaan || disentuh.orderDate) && !f.orderDate ? "Isi tanggal PO" : "";
  const galatTglKirim = f.expectedDate && f.orderDate && f.expectedDate < f.orderDate ? "Perkiraan datang tidak boleh sebelum tanggal PO" : "";
  const total = totalIsian(f.lines);
  const namaSupplier = suppliers.find((s) => s.id === f.supplierId)?.name || po?.supplier?.name || "";
  const jumlahBaru = daftarBarangBaru(f.lines).length;

  function fokusKe(m) {
    if (!m) return;
    setTimeout(() => {
      if (m.kunci === "supplier") document.getElementById(idSupplier)?.focus();
      else if (m.kunci === "orderDate") document.getElementById(idTglPO)?.focus();
      else if (m.kunci === "expectedDate") document.getElementById(idTglKirim)?.focus();
      else {
        const l = f.lines[(m.baris || 1) - 1]; if (!l) return;
        if (m.field === "rinci") setBuka((x) => new Set(x).add(l._k));
        setTimeout(() => {
          const el = barisRef.current[m.baris]; el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
          const t = m.field === "qty" ? el?.querySelector(`#qty-${l._k}`) : m.field === "harga" ? el?.querySelector(`#hrg-${l._k}`) : m.field === "rinci" ? el?.querySelector(".fin-poed-rinci input, .fin-poed-rinci [role=combobox]") : el?.querySelector("[role=combobox], .fin-poed-ganti");
          t?.focus?.();
        }, 60);
      }
    }, 30);
  }
  async function simpan() {
    setGalat(""); setMasalah({}); setMasalahHarga({});
    if (galatForm) { setPercobaan(true); fokusKe(masalahForm); return; }
    try {
      const body = bodyDariForm({ ...f, termin });
      // Periksa SEMUA barang baru sekaligus (urutan sama dengan penyimpanan) supaya masalah tampil di baris terkait dengan aksi penyelesaian — bukan pesan galat di bawah.
      const baruList = bolehBuatSku ? barisBaruUntukCek(f.lines) : [];
      if (baruList.length > 0) {
        let cek = null;
        try { cek = await api.cekDuplikatPO({ supplierId: f.supplierId, barisBaru: baruList }); } catch { /* server tetap memvalidasi saat simpan */ }
        const ms = cek ? masalahDariCek(cek) : {};
        const nomor = Object.keys(ms).map(Number).sort((x, y) => x - y);
        if (nomor.length > 0) { setMasalah(ms); setGalat(`${nomor.length} baris perlu diselesaikan dulu (baris ${nomor.join(", ")}) — lihat tanda dan tombol pada baris tersebut. PO belum disimpan.`); keBaris(nomor[0]); return; }
      }
      const hasil = mengubah ? await api.updatePurchaseOrder(po.id, body) : await api.createPurchaseOrder(body, `po-${kunci}`);
      await onSaved(hasil.id, ringkasHasilSimpan(hasil.hargaDariPO), { fakturDiterima, status: hasil.status || "DRAFT" });
    } catch (e) {
      if (e?.data?.hargaDariPO && Number.isInteger(e.data.baris)) { setMasalahHarga({ [e.data.baris]: e.message }); setGalat(`Baris ${e.data.baris} perlu diperbaiki dulu — PO belum disimpan dan Harga Berlaku tidak berubah.`); keBaris(e.data.baris); return; }
      const ms = masalahDariGalat(e);
      if (ms) { setMasalah({ [ms.baris]: ms }); setGalat(`Baris ${ms.baris} perlu diselesaikan dulu — lihat tanda dan tombol pada baris tersebut. PO belum disimpan.`); keBaris(ms.baris); }
      else setGalat(e.message || "Gagal menyimpan PO");
    }
  }

  const ctx = { bahan, materials, petaHarga, masalah, masalahHarga, set: setBaris, hapus: hapusBaris, barisRef, bolehBuatSku, jumlahBaris: f.lines.length, dipakai, po, setBarangBaru, fokusBaru, buka, toggle, percobaan };

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={mengubah ? `Ubah draf ${po.poNumber}` : "Pesanan pembelian baru"}
      description={mengubah ? "Perubahan disimpan sebagai draf. Draf yang sama bisa disetujui setelahnya." : "Lengkapi supplier dan bahan, lalu simpan sebagai draf."}
      className="fin-po-modal fin-po-modal-editor w-[1180px] max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
      footer={
        <div className="fin-poed-kaki">
          {(galat || (percobaan && galatForm)) && <p role="alert" data-testid="galat-po" className="fin-poed-galat"><AlertCircle size={18} aria-hidden="true" /><span>{galat || galatForm}</span></p>}
          {jumlahBaru > 0 && <p data-testid="info-barang-baru" className="fin-poed-info-baru">{jumlahBaru} barang baru akan dibuat di master material saat draf ini disimpan.</p>}
          <StripDampakHarga dampak={dampak} pra={pra} petaHarga={petaHarga} />
          <div className="fin-poed-kaki-aksi">
            <p className="fin-poed-total"><span>Total PO</span><strong aria-label={`Total PO ${formatUang(total)}`}>{formatUang(total)}</strong></p>
            <div className="fin-poed-tombol">
              <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
              <TombolAksi disabled={dampak.menahan} aria-disabled={!!galatForm || dampak.menahan || undefined} data-terkunci={galatForm ? "1" : undefined} onClick={simpan}>{mengubah ? "Simpan perubahan" : "Simpan draf"}</TombolAksi>
            </div>
          </div>
        </div>
      }
    >
      <div className="fin-poed" aria-busy={memuatMaster ? "true" : "false"}>
        <div className="fin-poed-kepala">
          <Field label="Supplier" required htmlFor={idSupplier} error={galatSupplier} className="fin-poed-f-supplier">
            <PemilihSupplier
              id={idSupplier} suppliers={suppliers} value={f.supplierId} namaCadangan={po?.supplier?.name} memuat={memuatMaster} invalid={!!galatSupplier}
              onPilih={(v) => { if (v !== f.supplierId) setTermin(TERMIN_AWAL); set("supplierId", v); sentuh("supplier"); }} onBlurLuar={() => sentuh("supplier")}
            />
          </Field>
          <Field label="Tanggal PO" required htmlFor={idTglPO} error={galatTglPO} className="fin-poed-f-tgl">
            <TanggalPO id={idTglPO} value={f.orderDate} onChange={(v) => { set("orderDate", v); sentuh("orderDate"); }} invalid={!!galatTglPO} ariaLabel="Tanggal PO" />
          </Field>
          <Field label="Perkiraan datang" htmlFor={idTglKirim} hint={galatTglKirim ? undefined : "Boleh dikosongkan."} error={galatTglKirim} className="fin-poed-f-tgl">
            <TanggalPO id={idTglKirim} value={f.expectedDate} onChange={(v) => set("expectedDate", v)} bolehKosong min={f.orderDate} invalid={!!galatTglKirim} placeholder="Pilih tanggal" ariaLabel="Perkiraan datang" />
          </Field>
          <Field label="Catatan" className="fin-poed-f-catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Contoh: kirim ke Gudang Utama sebelum Jumat" /></Field>
          <div className="fin-poed-f-termin"><TerminPO supplierId={f.supplierId} tanggalFaktur={f.orderDate} value={termin} onChange={setTermin} /></div>
        </div>
        <section className="fin-poed-item" aria-label="Item bahan">
          <div className="fin-poed-item-kepala">
            <h3>Item bahan</h3>
            <button type="button" className="fin-tombol fin-poed-tambah" onClick={tambahBaris}><Plus size={16} aria-hidden="true" /><span>Tambah baris</span></button>
          </div>
          <div className="fin-poed-tabel" role="group" aria-label="Daftar item PO">
            <div className="fin-poed-kolom" aria-hidden="true"><span>Bahan</span><span>Jumlah</span><span>Satuan</span><span>Harga satuan</span><span className="kanan">Subtotal</span><span /></div>
            {f.lines.map((l, i) => <BarisItem key={l._k} l={l} i={i} ctx={ctx} />)}
          </div>
          {f.lines.length >= 4 && <button type="button" className="fin-tombol fin-poed-tambah bawah" onClick={tambahBaris}><Plus size={16} aria-hidden="true" /><span>Tambah baris</span></button>}
          {!bolehBuatSku && f.lines.some((l) => !l.materialId && !l.materialBaru) && <p className="fin-poed-petunjuk" data-testid="petunjuk-barang-baru">Barangnya belum ada di master material? Minta Admin Finance membuat barang baru dari PO.</p>}
          {!memuatMaster && materials.length === 0 && <p className="fin-poed-petunjuk">Belum ada bahan aktif di katalog — {bolehBuatSku ? "gunakan “Buat barang baru” pada baris di atas." : "minta Admin Finance membuat barang baru, atau tambahkan lewat Stock & Material di Gudang."}</p>}
        </section>

        <FakturDiterima nilai={fakturDiterima} onChange={setFakturDiterima} status={mengubah ? po.status : "DRAFT"} izin={izin} />

        <div className="fin-poed-tentang">
          <Pembuka buka={tentang} onToggle={() => setTentang((v) => !v)} id={idTentang} className="fin-pill fin-pill-info">Tentang persetujuan dan penerimaan</Pembuka>
          <span className="fin-poed-tentang-ket">Menyimpan PO tidak menambah stok dan tidak membuat jurnal.</span>
          {tentang && <p id={idTentang} className="fin-poed-tentang-isi">PO yang disimpan berstatus draf dan belum bisa dipilih Gudang. Setelah disetujui, PO muncul di Gudang sebagai Barang Akan Datang; stok baru bertambah saat Gudang menekan Simpan ke Stok dari penerimaan. Faktur supplier dan pembayaran adalah langkah terpisah.</p>}
        </div>
      </div>

      {barangBaru && (
        <ModalBarangBaru
          awal={barangBaru.awal} supplierId={f.supplierId} supplierNama={namaSupplier} barisLain={barisLainDariForm(f.lines, barangBaru.baris)} autoPeriksa={!!barangBaru.autoPeriksa}
          onClose={() => setBarangBaru(null)} onBatalkanBaru={() => { setBaris(barangBaru.baris, { materialBaru: null }); setBarangBaru(null); }}
          onSimpan={(mb) => { setBaris(barangBaru.baris, { materialId: "", materialBaru: mb, satuanBeli: "", faktorKonversi: "" }); setBarangBaru(null); }}
          onPakaiMaterial={(id) => { setBaris(barangBaru.baris, { materialId: id, materialBaru: null, satuanBeli: "", faktorKonversi: "" }); setBarangBaru(null); }}
        />
      )}
    </Modal>
  );
}
