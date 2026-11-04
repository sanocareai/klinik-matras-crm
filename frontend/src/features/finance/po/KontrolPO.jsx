import { createPortal } from "react-dom";
import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search, IkKalender, IkTermin } from "@/components/ikApple.jsx";
import { cn } from "@/lib/utils.js";
import "@/styles/sanss-finance-po.css"; // gaya SelectPO/Pembuka dipakai halaman lain (Pembelian, Jadwal); tanpa ini tampil polos bila dibuka langsung
import { api } from "@/api.js";
import { Input } from "@/components/ui/input.jsx";
import { adminSaatIni } from "@/features/finance/aksiMenu.jsx";
import { PILIHAN_TERMIN, TERMIN_AWAL, galatTermin } from "@/features/finance/terminLogic.js";
import {
  BULAN_PANJANG, HARI_PENDEK, formatTanggalPO, hariIniWIB, labelTanggalPenuh, selBulan, tambahBulan, tambahHari, uraiTanggal, hariKe, labelTerminRingkas, bantuanTermin,
} from "./poKontrol.js";

// Kontrol khusus editor PO: tanggal (kalender Indonesia), pemilih supplier (combobox), pilihan termin (select bergaya aplikasi) dan ringkasan termin.
// Hanya presentasi: nilai tanggal tetap string "YYYY-MM-DD" (kalender WIB, tanpa konversi UTC), payload/validasi/endpoint tidak berubah.
// Tidak mengubah date-picker.jsx bersama; popover dibangun di dalam dialog sehingga tidak terpotong oleh area gulir modal.

export function indukGulir(el) {
  let induk = el.parentElement;
  while (induk && induk !== document.body) { const o = getComputedStyle(induk).overflowY; if (o === "auto" || o === "scroll") return induk; induk = induk.parentElement; }
  return null;
}
// Ruang yang tersedia untuk daftar pilihan di dalam area gulir editor (bukan viewport): menentukan arah buka dan tinggi maksimum.
export function ruangPopup(el) {
  const r = el.getBoundingClientRect();
  const induk = indukGulir(el);
  const batas = induk ? induk.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  const bawah = Math.min(batas.bottom, window.innerHeight) - r.bottom - 8;
  const atas = r.top - Math.max(batas.top, 0) - 8;
  const naik = bawah < 220 && atas > bawah;
  return { naik, tinggi: Math.max(150, Math.min(300, naik ? atas : bawah)) };
}

/** Esc pada lapisan terbuka hanya menutup lapisan itu (bukan seluruh dialog): pendengar fase capture jendela berjalan sebelum pendengar dialog. */
function useEscTutup(buka, tutup) {
  useEffect(() => {
    if (!buka) return undefined;
    const h = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); ev.preventDefault(); tutup(); } };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [buka, tutup]);
}
function useLayarSempit() {
  const [sempit, setSempit] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(max-width: 639px)").matches);
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 639px)"); if (!mq) return undefined;
    const h = () => setSempit(mq.matches); h();
    mq.addEventListener?.("change", h); return () => mq.removeEventListener?.("change", h);
  }, []);
  return sempit;
}

// ─── TANGGAL ─────────────────────────────────────────────────────────────────
const LEBAR_KAL = 308, TINGGI_KAL = 372;

/**
 * Kolom tanggal PO: tampilan "2 Nov 2026" / placeholder "Pilih tanggal"; kalender bahasa Indonesia (Senin pertama), navigasi bulan dan tahun,
 * keyboard (panah, PageUp/PageDown, Shift = tahun, Home/End, Enter/Spasi), Esc menutup dan mengembalikan fokus ke pemicu.
 * `min` hanya menonaktifkan hari sebelumnya (aturan yang sudah ada: perkiraan datang tidak boleh sebelum tanggal PO); tidak ada batas maksimum.
 */
export function TanggalPO({ id, value, onChange, placeholder = "Pilih tanggal", bolehKosong = false, min = "", invalid = false, disabled = false, ariaLabel, ariaDescribedBy }) {
  const [buka, setBuka] = useState(false);
  const [kursor, setKursor] = useState(() => (uraiTanggal(value) ? value : hariIniWIB())); // hari yang memegang fokus di kisi
  const [pos, setPos] = useState(null);
  const [dlg, setDlg] = useState(null); // elemen dialog tempat kalender dipasang (portal): .fin-poed adalah container, jadi fixed di dalamnya tetap terpotong area gulir
  const pemicu = useRef(null);
  const pop = useRef(null);
  const sempit = useLayarSempit();
  const idPop = useId();
  const adaNilai = !!uraiTanggal(value);
  const hariIni = hariIniWIB();

  const tutup = useCallback((kembaliFokus = true) => { setBuka(false); if (kembaliFokus) setTimeout(() => pemicu.current?.focus(), 0); }, []);
  useEscTutup(buka, () => tutup(true));

  function bukaKalender() {
    setKursor(adaNilai ? value : (min && min > hariIni ? min : hariIni));
    setDlg(pemicu.current?.closest('[role="dialog"]') || document.body);
    setBuka(true);
  }
  // Posisi: fixed relatif dialog (dialog punya translate → containing block). Ukur titik asal sebenarnya supaya benar apa pun containing block-nya.
  useLayoutEffect(() => {
    if (!buka || sempit || !pop.current || !pemicu.current) { setPos(null); return; }
    const p = pop.current; p.style.top = "0px"; p.style.left = "0px";
    const asal = p.getBoundingClientRect();
    const r = pemicu.current.getBoundingClientRect();
    const batas = dlg ? dlg.getBoundingClientRect() : { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight };
    const tinggi = Math.min(p.offsetHeight || TINGGI_KAL, window.innerHeight - 16);
    const lebar = p.offsetWidth || LEBAR_KAL;
    const bawah = window.innerHeight - r.bottom - 8, atas = r.top - 8;
    const naik = bawah < tinggi && atas > bawah;
    let topV = naik ? r.top - tinggi - 6 : r.bottom + 6;
    topV = Math.max(8, Math.min(topV, window.innerHeight - tinggi - 8));
    const leftV = Math.max(batas.left + 8, Math.min(r.left, batas.right - lebar - 8));
    setPos({ top: topV - asal.top, left: leftV - asal.left });
  }, [buka, sempit, dlg]);
  // Fokus ke hari aktif setiap kali kursor berubah / kalender dibuka.
  useEffect(() => {
    if (!buka) return;
    const el = pop.current?.querySelector(`[data-iso="${kursor}"]`);
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }, [buka, kursor, pos]);
  // Klik di luar menutup (tanpa memindahkan fokus dari target yang diklik).
  useEffect(() => {
    if (!buka) return undefined;
    const h = (e) => { if (!pop.current?.contains(e.target) && !pemicu.current?.contains(e.target)) setBuka(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [buka]);

  const pk = uraiTanggal(kursor) || uraiTanggal(hariIni);
  const sel = useMemo(() => selBulan(pk.y, pk.m), [pk.y, pk.m]);
  const pilih = (s) => { if (min && s < min) return; onChange(s); tutup(true); };
  const geser = (s) => { setKursor(s); };
  function tekan(e) {
    const k = e.key; let t = null;
    if (k === "ArrowLeft") t = tambahHari(kursor, -1);
    else if (k === "ArrowRight") t = tambahHari(kursor, 1);
    else if (k === "ArrowUp") t = tambahHari(kursor, -7);
    else if (k === "ArrowDown") t = tambahHari(kursor, 7);
    else if (k === "PageUp") t = tambahBulan(kursor, e.shiftKey ? -12 : -1);
    else if (k === "PageDown") t = tambahBulan(kursor, e.shiftKey ? 12 : 1);
    else if (k === "Home") t = tambahHari(kursor, -hariKe(kursor));
    else if (k === "End") t = tambahHari(kursor, 6 - hariKe(kursor));
    if (t) { e.preventDefault(); geser(t); }
  }

  const kalender = buka && (
    <>
      {sempit && <div className="fin-tgl-tirai" onMouseDown={() => setBuka(false)} aria-hidden="true" />}
      <div
        ref={pop} id={idPop} role="dialog" aria-modal="false" aria-label={`Pilih tanggal${ariaLabel ? ` — ${ariaLabel}` : ""}`}
        className={cn("fin-tgl-pop", sempit && "lembar")} style={!sempit && pos ? { top: pos.top, left: pos.left } : undefined} data-testid="kalender-po"
      >
        <div className="fin-tgl-kepala">
          <div className="fin-tgl-nav">
            <button type="button" className="fin-tgl-nav-btn" onClick={() => geser(tambahBulan(kursor, -12))} aria-label="Tahun sebelumnya"><ChevronsLeft size={17} aria-hidden="true" /></button>
            <button type="button" className="fin-tgl-nav-btn" onClick={() => geser(tambahBulan(kursor, -1))} aria-label="Bulan sebelumnya"><ChevronLeft size={17} aria-hidden="true" /></button>
          </div>
          <p className="fin-tgl-judul" aria-live="polite" data-testid="kalender-judul">{BULAN_PANJANG[pk.m]} {pk.y}</p>
          <div className="fin-tgl-nav">
            <button type="button" className="fin-tgl-nav-btn" onClick={() => geser(tambahBulan(kursor, 1))} aria-label="Bulan berikutnya"><ChevronRight size={17} aria-hidden="true" /></button>
            <button type="button" className="fin-tgl-nav-btn" onClick={() => geser(tambahBulan(kursor, 12))} aria-label="Tahun berikutnya"><ChevronsRight size={17} aria-hidden="true" /></button>
          </div>
        </div>
        <div className="fin-tgl-kisi" role="grid" aria-label={`${BULAN_PANJANG[pk.m]} ${pk.y}`} onKeyDown={tekan}>
          <div className="fin-tgl-baris" role="row">{HARI_PENDEK.map((h) => <span key={h} role="columnheader" className="fin-tgl-hari">{h}</span>)}</div>
          {Array.from({ length: sel.length / 7 }, (_, w) => (
            <div key={w} className="fin-tgl-baris" role="row">
              {sel.slice(w * 7, w * 7 + 7).map((s, i) => {
                if (!s) return <span key={`k${w}-${i}`} className="fin-tgl-kosong" role="gridcell" aria-hidden="true" />;
                const mati = !!min && s < min;
                const terpilih = s === value;
                return (
                  <span key={s} role="gridcell" aria-selected={terpilih}>
                    <button
                      type="button" data-iso={s} tabIndex={s === kursor ? 0 : -1} disabled={mati} aria-label={labelTanggalPenuh(s)} aria-current={s === hariIni ? "date" : undefined} aria-pressed={terpilih}
                      className={cn("fin-tgl-sel", terpilih && "terpilih", s === hariIni && "hariini")} onClick={() => pilih(s)}
                    >{Number(s.slice(8))}</button>
                  </span>
                );
              })}
            </div>
          ))}
        </div>
        <div className="fin-tgl-kaki">
          <button type="button" className="fin-tgl-aksi" onClick={() => pilih(hariIni)} disabled={!!min && hariIni < min}>Hari ini</button>
          {bolehKosong && adaNilai && <button type="button" className="fin-tgl-aksi" onClick={() => { onChange(""); tutup(true); }}>Kosongkan</button>}
          <button type="button" className="fin-tgl-aksi tutup" onClick={() => tutup(true)}>Tutup</button>
        </div>
      </div>
    </>
  );

  return (
    <div className="fin-tgl">
      <button
        ref={pemicu} id={id} type="button" disabled={disabled} className={cn("fin-tgl-pemicu", adaNilai && "isi", invalid && "salah")} aria-haspopup="dialog" aria-expanded={buka} aria-controls={buka ? idPop : undefined}
        aria-invalid={invalid || undefined} aria-label={ariaLabel ? `${ariaLabel}: ${adaNilai ? formatTanggalPO(value) : "belum dipilih"}` : undefined} aria-describedby={ariaDescribedBy}
        onClick={() => (buka ? tutup(false) : bukaKalender())}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !buka) { e.preventDefault(); bukaKalender(); } }}
      >
        <IkKalender size={18} className="fin-tgl-ikon" />
        <span className="fin-tgl-teks">{adaNilai ? formatTanggalPO(value) : placeholder}</span>
        <ChevronDown size={17} aria-hidden="true" className={cn("fin-poed-chev", buka && "buka")} />
      </button>
      {kalender && createPortal(kalender, dlg || document.body)}
    </div>
  );
}

// ─── DAFTAR PILIHAN (combobox & select) ──────────────────────────────────────
function PopupDaftar({ idDaftar, ariaLabel, arah, children, info }) {
  return (
    <div className={cn("fin-poed-popup", arah.naik && "naik")} style={{ maxHeight: arah.tinggi }}>
      <ul id={idDaftar} role="listbox" aria-label={ariaLabel} className="fin-poed-opsi">{children}</ul>
      {info}
    </div>
  );
}
function useArah(buka, ref, tergantung) {
  const [arah, setArah] = useState({ naik: false, tinggi: 260 });
  useEffect(() => {
    if (!buka || !ref.current) return undefined;
    const ukur = () => { if (ref.current) setArah((a) => { const b = ruangPopup(ref.current); return b.naik === a.naik && Math.abs(b.tinggi - a.tinggi) < 4 ? a : b; }); };
    ukur();
    const r1 = requestAnimationFrame(() => requestAnimationFrame(ukur));
    const induk = indukGulir(ref.current);
    induk?.addEventListener("scroll", ukur, { passive: true });
    window.addEventListener("resize", ukur);
    return () => { cancelAnimationFrame(r1); induk?.removeEventListener("scroll", ukur); window.removeEventListener("resize", ukur); };
  }, [buka, tergantung]); // eslint-disable-line react-hooks/exhaustive-deps -- ref stabil
  return arah;
}

/** Combobox pencarian supplier. Hanya memilih id; daftar, izin, dan nilai yang dikirim sama seperti <select> lama. */
export function PemilihSupplier({ id, suppliers, value, namaCadangan, memuat, invalid = false, onPilih, onBlurLuar, ariaDescribedBy }) {
  const [q, setQ] = useState("");
  const [buka, setBuka] = useState(false);
  const [aktif, setAktif] = useState(0);
  const wadah = useRef(null);
  const input = useRef(null);
  const idDaftar = useId();
  const terpilih = suppliers.find((s) => s.id === value);
  const nama = terpilih?.name || (value ? namaCadangan : "") || "";
  const hasil = useMemo(() => {
    const t = q.trim().toLowerCase();
    const daftar = t ? suppliers.filter((s) => `${s.name} ${s.code || ""} ${(s.aliases || []).join(" ")}`.toLowerCase().includes(t)) : suppliers;
    return daftar.slice(0, 50);
  }, [suppliers, q]);
  const arah = useArah(buka, input, q);
  const tutup = useCallback(() => { setBuka(false); setQ(""); }, []);
  useEscTutup(buka, tutup);
  useEffect(() => { setAktif(0); }, [q]);
  const pilih = (s) => { if (!s) return; tutup(); onPilih(s.id); };
  const tekan = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setBuka(true); setAktif((i) => Math.min(hasil.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAktif((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && buka) { e.preventDefault(); pilih(hasil[aktif]); }
    else if (e.key === "Tab") tutup();
  };
  return (
    <div className="fin-poed-bahan fin-poed-bahan-cari fin-poed-supplier" ref={wadah} onBlur={(e) => { if (!wadah.current?.contains(e.relatedTarget)) { tutup(); onBlurLuar?.(); } }}>
      <label className={cn("fin-poed-cari", invalid && "salah")}>
        <Search size={17} aria-hidden="true" />
        <input
          id={id} ref={input} type="text" role="combobox" aria-expanded={buka} aria-controls={idDaftar} aria-autocomplete="list" autoComplete="off" aria-label="Supplier" aria-invalid={invalid || undefined} aria-describedby={ariaDescribedBy}
          aria-activedescendant={buka && hasil[aktif] ? `${idDaftar}-${aktif}` : undefined} title={nama || undefined}
          value={buka ? q : nama} onChange={(e) => { setQ(e.target.value); setBuka(true); }} onFocus={() => setBuka(true)} onClick={() => setBuka(true)} onKeyDown={tekan}
          placeholder={memuat ? "Memuat supplier…" : "Cari supplier…"}
        />
        <ChevronDown size={17} aria-hidden="true" className={cn("fin-poed-chev", buka && "buka")} />
      </label>
      {buka && (
        <PopupDaftar idDaftar={idDaftar} ariaLabel="Hasil pencarian supplier" arah={arah}>
          {hasil.length === 0 && <li className="fin-poed-opsi-kosong" role="presentation">{suppliers.length === 0 ? (memuat ? "Memuat supplier…" : "Belum ada supplier aktif.") : "Tidak ada supplier yang cocok."}</li>}
          {hasil.map((s, i) => (
            <li key={s.id} id={`${idDaftar}-${i}`} role="option" aria-selected={s.id === value} className={cn("fin-poed-opsi-i", i === aktif && "aktif")} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setAktif(i)} onClick={() => pilih(s)}>
              <span className="fin-poed-opsi-teks"><span className="fin-poed-opsi-nama">{s.name}</span><span className="fin-poed-opsi-kode">{[s.code, s.phone].filter(Boolean).join(" · ")}</span></span>
              {s.id === value && <Check size={16} aria-hidden="true" className="fin-poed-centang" />}
            </li>
          ))}
        </PopupDaftar>
      )}
    </div>
  );
}

/** Select bergaya aplikasi (pemicu + daftar) menggantikan <select> native; nilai string, keyboard panah/Enter/Esc. */
export function SelectPO({ id, value, onChange, opsi, ariaLabel }) {
  const [buka, setBuka] = useState(false);
  const [aktif, setAktif] = useState(0);
  const pemicu = useRef(null);
  const wadah = useRef(null);
  const idDaftar = useId();
  const arah = useArah(buka, pemicu, 0);
  const tutup = useCallback(() => { setBuka(false); setTimeout(() => pemicu.current?.focus(), 0); }, []);
  useEscTutup(buka, tutup);
  const terpilih = opsi.find((o) => o.nilai === value);
  const bukaDaftar = () => { setAktif(Math.max(0, opsi.findIndex((o) => o.nilai === value))); setBuka(true); };
  const pilih = (o) => { onChange(o.nilai); setBuka(false); setTimeout(() => pemicu.current?.focus(), 0); };
  const tekan = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (!buka) bukaDaftar(); else setAktif((i) => Math.min(opsi.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (!buka) bukaDaftar(); else setAktif((i) => Math.max(0, i - 1)); }
    else if ((e.key === "Enter" || e.key === " ") && buka) { e.preventDefault(); pilih(opsi[aktif]); }
    else if (e.key === "Tab") setBuka(false);
  };
  return (
    <div className="fin-poed-bahan fin-poed-bahan-cari fin-select" ref={wadah} onBlur={(e) => { if (!wadah.current?.contains(e.relatedTarget)) setBuka(false); }}>
      <button
        id={id} ref={pemicu} type="button" className="fin-select-pemicu" role="combobox" aria-haspopup="listbox" aria-expanded={buka} aria-controls={buka ? idDaftar : undefined} aria-label={ariaLabel}
        aria-activedescendant={buka ? `${idDaftar}-${aktif}` : undefined} onClick={() => (buka ? setBuka(false) : bukaDaftar())} onKeyDown={tekan}
      >
        <span className="fin-select-teks">{terpilih?.label ?? "Pilih"}</span>
        <ChevronDown size={17} aria-hidden="true" className={cn("fin-poed-chev", buka && "buka")} />
      </button>
      {buka && (
        <PopupDaftar idDaftar={idDaftar} ariaLabel={ariaLabel} arah={arah}>
          {opsi.map((o, i) => (
            <li key={o.nilai || "kosong"} id={`${idDaftar}-${i}`} role="option" aria-selected={o.nilai === value} className={cn("fin-poed-opsi-i", i === aktif && "aktif")} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setAktif(i)} onClick={() => pilih(o)}>
              <span className="fin-poed-opsi-teks"><span className="fin-poed-opsi-nama">{o.label}</span></span>
              {o.nilai === value && <Check size={16} aria-hidden="true" className="fin-poed-centang" />}
            </li>
          ))}
        </PopupDaftar>
      )}
    </div>
  );
}

// ─── TERMIN ──────────────────────────────────────────────────────────────────
/**
 * Ringkasan termin PO: "Termin pembayaran: 7 hari" / "Belum ditetapkan". Tombol "Ubah" hanya untuk admin keuangan (aturan lama: server menegakkan).
 * Mengubah termin tetap mewajibkan alasan (galatTermin); PO tidak mewajibkan tanggal jatuh tempo (Tanggal khusus diisi saat faktur dicatat).
 * `value` = { ganti, pilihan, dueDate, alasan } sama seperti TerminFaktur; endpoint pratinjau termin dan payload tidak berubah.
 */
export default function TerminPO({ supplierId, tanggalFaktur = "", value, onChange }) {
  const [pr, setPr] = useState(null);
  const [galatMuat, setGalatMuat] = useState("");
  const [terbuka, setTerbuka] = useState(false);
  const [draf, setDraf] = useState(TERMIN_AWAL);
  const [lihatGalat, setLihatGalat] = useState(false);
  const admin = adminSaatIni();
  const idPanel = useId();
  const tombol = useRef(null);
  useEffect(() => {
    if (!supplierId) { setPr(null); return undefined; }
    let batal = false;
    api.pratinjauTermin({ supplierId, billDate: tanggalFaktur || undefined, dasar: "TANGGAL_TIBA" })
      .then((r) => { if (!batal) { setPr(r); setGalatMuat(""); } })
      .catch((e) => { if (!batal) setGalatMuat(e.message || "Gagal memuat termin"); });
    return () => { batal = true; };
  }, [supplierId, tanggalFaktur]);
  const tutupPanel = useCallback(() => { setTerbuka(false); setTimeout(() => tombol.current?.focus(), 0); }, []);
  useEscTutup(terbuka, tutupPanel);
  if (!supplierId) return null;

  const galatDraf = galatTermin(draf, { tanpaTanggal: true });
  const label = galatMuat ? "" : labelTerminRingkas(pr, value);
  const { dasar, tambahan } = bantuanTermin(pr);
  const sumber = !value.ganti && pr?.ada && pr.sumber ? { MASTER_SUPPLIER: "master supplier", PO: "PO" }[pr.sumber] || "" : "";
  const opsi = PILIHAN_TERMIN.map((p) => ({ nilai: p.nilai, label: p.label }));
  const bukaPanel = () => { setDraf(value.ganti ? { ...value } : { ...TERMIN_AWAL, ganti: true, pilihan: "" }); setLihatGalat(false); setTerbuka(true); };
  const terapkan = () => { if (galatDraf) { setLihatGalat(true); return; } onChange({ ...draf, ganti: true }); setTerbuka(false); setTimeout(() => tombol.current?.focus(), 0); };
  const kembalikan = () => { onChange({ ...TERMIN_AWAL }); setTerbuka(false); setTimeout(() => tombol.current?.focus(), 0); };

  return (
    <div className="fin-termin" data-testid="termin-faktur">
      <div className="fin-termin-baris">
        <span className="fin-termin-ikon" aria-hidden="true"><IkTermin size={22} /></span>
        <div className="fin-termin-isi">
          <p className="fin-termin-nilai" data-testid="termin-ringkas">
            {galatMuat ? <span className="fin-termin-galat">{galatMuat}</span> : !pr ? "Memuat termin…" : (
              <><span className="fin-termin-label">Termin pembayaran:</span> <strong>{label}</strong>{value.ganti && <span className="fin-chip fin-chip-orange fin-termin-chip">Diubah untuk PO ini</span>}{sumber && <span className="fin-termin-sumber"> · {sumber}</span>}</>
            )}
          </p>
          <p className="fin-termin-bantu" data-testid="termin-bantuan">{dasar}{tambahan ? ` ${tambahan}` : ""}</p>
        </div>
        {admin && pr && (
          <button ref={tombol} type="button" className="fin-tombol fin-termin-ubah" aria-expanded={terbuka} aria-controls={terbuka ? idPanel : undefined} onClick={() => (terbuka ? tutupPanel() : bukaPanel())} data-testid="termin-ubah">
            <span>Ubah</span><ChevronDown size={15} aria-hidden="true" className={cn("fin-poed-chev", terbuka && "buka")} />
          </button>
        )}
      </div>
      {terbuka && (
        <div id={idPanel} className="fin-termin-panel" role="group" aria-label="Ubah termin pembayaran">
          <div className="fin-termin-grid">
            <div className="fin-termin-f">
              <label htmlFor={`${idPanel}-p`} className="fin-termin-lbl">Termin baru</label>
              <SelectPO id={`${idPanel}-p`} value={draf.pilihan} onChange={(v) => setDraf((d) => ({ ...d, ganti: true, pilihan: v }))} opsi={opsi} ariaLabel="Termin baru" />
            </div>
            <div className="fin-termin-f">
              <label htmlFor={`${idPanel}-a`} className="fin-termin-lbl">Alasan <span className="fin-termin-wajib">*</span></label>
              <Input id={`${idPanel}-a`} value={draf.alasan} onChange={(e) => setDraf((d) => ({ ...d, alasan: e.target.value }))} placeholder="mis. nego dengan supplier" aria-label="Alasan ganti termin" aria-invalid={lihatGalat && !!galatDraf || undefined} />
            </div>
          </div>
          {draf.pilihan === "TANGGAL_KHUSUS" && <p className="fin-termin-bantu" data-testid="catatan-tanggal-khusus-po">Tanggal khusus: tanggal jatuh tempo diisi saat faktur dicatat, bukan di PO.</p>}
          {lihatGalat && galatDraf && <p role="alert" className="fin-termin-galat" data-testid="galat-termin">{galatDraf}</p>}
          <div className="fin-termin-aksi">
            <button type="button" className="fin-tombol" onClick={tutupPanel}><span>Batal</span></button>
            {value.ganti && <button type="button" className="fin-tombol" onClick={kembalikan}><span>Pakai termin supplier</span></button>}
            <button type="button" className="fin-tombol fin-termin-terapkan" onClick={terapkan}><span>Terapkan</span></button>
          </div>
        </div>
      )}
    </div>
  );
}
