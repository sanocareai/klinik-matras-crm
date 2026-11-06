import React, { useEffect, useId, useRef, useState } from "react";
import { Glif } from "./IkonApple.jsx";
import { KELOMPOK, LABEL_SEBAB_PENDEK } from "./berandaLogika.js";

// SATU toolbar: pencarian + tombol Filter (popover di desktop, lembar bawah di HP — memakai kelas .gud-filter-* yang sama dengan Stok bahan) + tab kelompok + saklar "Lewat jadwal".
// Filter yang ada hanya yang didukung data: jenis pekerjaan, tahap, dan penanda (lewat jadwal / hambatan menurut sebab dari server). Filter aktif tampil sebagai chip dengan Reset.
// Hitungan di tab/pilihan hanya ditampilkan bila SEMUA baris sudah dimuat (`lengkap`); selama masih ada sisa di server, angka itu tidak boleh terbaca sebagai total.

function FilterPopover({ jumlah, onReset, children }) {
  const [buka, setBuka] = useState(false); const akar = useRef(null); const tombol = useRef(null); const id = useId();
  useEffect(() => {
    if (!buka) return undefined;
    const luar = (e) => { if (akar.current?.contains(e.target)) return; setBuka(false); };
    const esc = (e) => { if (e.key === "Escape") { setBuka(false); tombol.current?.focus(); } };
    document.addEventListener("pointerdown", luar); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", luar); document.removeEventListener("keydown", esc); };
  }, [buka]);
  return (
    <div className="gud-filter gud-br-filter" ref={akar}>
      <button ref={tombol} type="button" className="gud-tombol gud-filter-tombol" aria-expanded={buka} aria-controls={buka ? id : undefined} aria-haspopup="dialog" onClick={() => setBuka((v) => !v)} data-testid="buka-filter">
        <Glif nama="saring" size={17} /> Filter{jumlah > 0 && <span className="gud-filter-hitung" data-testid="hitung-filter">{jumlah}</span>}
      </button>
      {buka && (
        <>
          <div className="gud-filter-tirai" onClick={() => setBuka(false)} aria-hidden />
          <div id={id} role="dialog" aria-label="Filter pekerjaan Gudang" className="gud-filter-isi" data-testid="panel-filter">
            <div className="gud-filter-kepala"><span className="gud-filter-judul">Filter</span><button type="button" className="gud-tautan" onClick={onReset} disabled={jumlah === 0} data-testid="reset-di-filter">Reset</button></div>
            <div className="gud-filter-badan">{children}</div>
            <div className="gud-filter-kaki"><button type="button" className="gud-tombol gud-tombol-utama" onClick={() => { setBuka(false); tombol.current?.focus(); }} data-testid="selesai-filter">Selesai</button></div>
          </div>
        </>
      )}
    </div>
  );
}

function Pilihan({ judul, children, testid }) {
  return <fieldset className="gud-br-grup" data-testid={testid}><legend className="gud-filter-label">{judul}</legend>{children}</fieldset>;
}
function Centang({ checked, onChange, label, jumlah, testid }) {
  return <label className="gud-br-opsi"><input type="checkbox" checked={checked} onChange={onChange} data-testid={testid} /><span className="gud-br-opsi-teks">{label}</span>{jumlah != null && <span className="gud-br-opsi-n">{jumlah}</span>}</label>;
}
function Radio({ checked, onChange, label, jumlah, nama, testid }) {
  return <label className="gud-br-opsi"><input type="radio" name={nama} checked={checked} onChange={onChange} data-testid={testid} /><span className="gud-br-opsi-teks">{label}</span>{jumlah != null && <span className="gud-br-opsi-n">{jumlah}</span>}</label>;
}
const alih = (daftar, nilai) => (daftar.includes(nilai) ? daftar.filter((x) => x !== nilai) : [...daftar, nilai]);

export default function ToolbarBeranda({ f, setF, onReset, pilihan, penandaTersedia, hitung, lengkap, jumlahLewat, labelAntrean, jumlahAktif, hasil, dimuat }) {
  const nama = useId();
  const setIni = (p) => setF((s) => ({ ...s, ...p }));
  const chips = [
    ...f.jenis.map((j) => ({ k: `j:${j}`, teks: pilihan.jenis.find((x) => x.nilai === j)?.label ?? j, hapus: () => setIni({ jenis: f.jenis.filter((x) => x !== j) }) })),
    ...f.tahap.map((t) => ({ k: `t:${t}`, teks: t, hapus: () => setIni({ tahap: f.tahap.filter((x) => x !== t) }) })),
    ...f.antrean.map((a) => ({ k: `a:${a}`, teks: `Tahap: ${labelAntrean(a)}`, hapus: () => setIni({ antrean: f.antrean.filter((x) => x !== a) }) })),
    ...(f.penanda !== "semua" ? [{ k: "p", teks: f.penanda === "lewat" ? "Lewat jadwal" : f.penanda === "ada" ? "Ada hambatan" : f.penanda === "tanpa" ? "Tanpa penanda" : (LABEL_SEBAB_PENDEK[f.penanda] ?? f.penanda), hapus: () => setIni({ penanda: "semua" }) }] : []),
  ];
  return (
    <div className="gud-br-toolbar" data-testid="toolbar-beranda">
      <div className="gud-br-baris-cari">
        <label className="gud-br-cari">
          <Glif nama="cari" size={17} />
          <input type="search" value={f.q} onChange={(e) => setIni({ q: e.target.value })} onKeyDown={(e) => { if (e.key === "Escape") setIni({ q: "" }); }} aria-label="Cari dokumen, supplier, atau unit" data-testid="cari-gudang" placeholder="Cari dokumen, supplier, atau unit…" autoComplete="off" />
          {f.q && <button type="button" className="gud-br-hapus-cari" onClick={() => setIni({ q: "" })} aria-label="Hapus pencarian"><Glif nama="tutup" size={14} /></button>}
        </label>
        <FilterPopover jumlah={jumlahAktif} onReset={onReset}>
          <Pilihan judul="Jenis pekerjaan" testid="filter-jenis">
            {pilihan.jenis.map((o) => <Centang key={o.nilai} checked={f.jenis.includes(o.nilai)} onChange={() => setIni({ jenis: alih(f.jenis, o.nilai) })} label={o.label} jumlah={lengkap ? o.jumlah : null} testid={`jenis-${o.nilai}`} />)}
            {pilihan.jenis.length === 0 && <p className="gud-filter-bantu">Belum ada pekerjaan yang dimuat.</p>}
          </Pilihan>
          <Pilihan judul="Tahap" testid="filter-tahap">
            {pilihan.tahap.map((o) => <Centang key={o.nilai} checked={f.tahap.includes(o.nilai)} onChange={() => setIni({ tahap: alih(f.tahap, o.nilai) })} label={o.label} jumlah={lengkap ? o.jumlah : null} testid={`tahap-${o.nilai}`} />)}
          </Pilihan>
          <Pilihan judul="Keterlambatan dan hambatan" testid="filter-penanda">
            <Radio nama={nama} checked={f.penanda === "semua"} onChange={() => setIni({ penanda: "semua" })} label="Semua" testid="penanda-semua" />
            <Radio nama={nama} checked={f.penanda === "lewat"} onChange={() => setIni({ penanda: "lewat" })} label="Lewat jadwal" jumlah={lengkap ? jumlahLewat : null} testid="penanda-lewat" />
            {penandaTersedia.filter((s) => s.kode !== "JADWAL_LEWAT").map((s) => <Radio key={s.kode} nama={nama} checked={f.penanda === s.kode} onChange={() => setIni({ penanda: s.kode })} label={LABEL_SEBAB_PENDEK[s.kode] ?? s.judul} jumlah={lengkap ? s.jumlah : null} testid={`penanda-${s.kode}`} />)}
            <Radio nama={nama} checked={f.penanda === "tanpa"} onChange={() => setIni({ penanda: "tanpa" })} label="Tanpa penanda" testid="penanda-tanpa" />
            <p className="gud-filter-bantu">“Lewat jadwal” hanya untuk dokumen yang punya tanggal sah yang sudah lewat. Umur dokumen bukan keterlambatan.</p>
          </Pilihan>
        </FilterPopover>
      </div>
      <div className="gud-br-baris-tab">
        <div className="gud-tab gud-br-tab" role="tablist" aria-label="Kelompok pekerjaan">
          {KELOMPOK.filter((k) => k.kode === "semua" || !dimuat || hitung[k.kode] > 0 || f.kelompok === k.kode).map((k) => (
            <button key={k.kode} type="button" role="tab" aria-selected={f.kelompok === k.kode} onClick={() => setIni({ kelompok: k.kode })} data-testid={`tab-${k.kode}`}>
              {k.label}{lengkap && <span className="gud-tab-jumlah">{hitung[k.kode]}</span>}
            </button>
          ))}
        </div>
        <button type="button" className="gud-br-saklar" aria-pressed={f.penanda === "lewat"} onClick={() => setIni({ penanda: f.penanda === "lewat" ? "semua" : "lewat" })} data-testid="saklar-lewat">
          Lewat jadwal{lengkap && <span className="gud-br-saklar-n">{jumlahLewat}</span>}
        </button>
      </div>
      {(chips.length > 0 || f.q.trim() || f.kelompok !== "semua") && (
        <div className="gud-chip-baris gud-br-chip-baris" data-testid="chip-aktif">
          {chips.map((c) => <span key={c.k} className="gud-chip">{c.teks}<button type="button" onClick={c.hapus} aria-label={`Hapus filter ${c.teks}`}><Glif nama="tutup" size={12} /></button></span>)}
          <button type="button" className="gud-tautan" onClick={onReset} data-testid="reset-filter">Reset</button>
        </div>
      )}
      <p className="gud-br-hasil" aria-live="polite" data-testid="hasil-teks">{hasil}</p>
    </div>
  );
}
