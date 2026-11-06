import React, { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { aksiHasilCari } from "./berandaLogika.js";

// Pencarian di SELURUH dokumen Gudang (server, minimal 2 karakter) untuk dokumen yang tidak ada di daftar kerja (mis. yang sudah selesai, bahan, supplier). Dipicu oleh kata kunci yang sama
// dengan kotak cari Beranda; hasil yang sudah tampil di daftar kerja tidak diulang. Baca-saja: tombol hanya membuka dokumen. Aksi "Simpan ke stok" dari hasil pencarian tidak ditawarkan
// (jumlah baik tidak diketahui di sini) — dokumennya sendiri yang menunjukkan tindakan yang sah.
export default function HasilCariServer({ q, kunciAda, onBuka }) {
  const [hasil, setHasil] = useState(null); const [memuat, setMemuat] = useState(false); const [galat, setGalat] = useState(""); const urut = useRef(0);
  useEffect(() => {
    const kata = q.trim();
    if (kata.length < 2) { urut.current++; setHasil(null); setGalat(""); setMemuat(false); return undefined; }
    const n = ++urut.current; setMemuat(true);
    const t = setTimeout(async () => {
      try { const d = await api.cariGudang(kata); if (n === urut.current) { setHasil(d); setGalat(""); } } catch (e) { if (n === urut.current) setGalat(e.message || "Pencarian gagal"); } finally { if (n === urut.current) setMemuat(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  if (q.trim().length < 2) return null;
  const kelompok = (hasil?.kelompok ?? []).map((k) => ({ ...k, hasil: k.hasil.filter((h) => !kunciAda.has(`${h.jenis}:${h.id}`)) })).filter((k) => k.hasil.length > 0);
  if (!memuat && !galat && kelompok.length === 0) return null;
  return (
    <section className="gud-br-cari-server" aria-label="Hasil di seluruh Gudang" data-testid="hasil-pencarian">
      <h3 className="gud-br-cari-judul">Juga ditemukan di Gudang <span className="gud-br-sekunder">(di luar daftar kerja)</span></h3>
      {memuat && <p className="gud-br-sekunder" aria-busy="true"><Loader2 size={13} className="animate-spin inline" /> Mencari…</p>}
      {galat && <p role="alert" className="gud-br-galat-kecil">{galat}</p>}
      {kelompok.map((k) => (
        <div key={k.jenis} data-testid={`hasil-${k.jenis}`}>
          <h4 className="gud-br-cari-kel">{k.label}</h4>
          <ul className="gud-br-cari-daftar">
            {k.hasil.map((h) => { const a = aksiHasilCari(h); return (
              <li key={`${h.jenis}:${h.id}`} data-testid="hasil-baris">
                <button type="button" className="gud-br-cari-buka" onClick={() => onBuka(h, null)} data-testid="buka-hasil">
                  <span className="gud-br-nomor-teks">{h.nomor}</span>{h.judul && h.judul !== h.nomor && <span className="gud-br-sekunder"> {h.judul}</span>}{h.status && <span className="gud-br-pil gud-br-pil-netral">{h.status}</span>}{h.sub && <span className="gud-br-cari-sub">{h.sub}</span>}
                </button>
                {a && <button type="button" className="gud-br-tombol gud-br-tombol-garis" onClick={() => onBuka(h, a.kode)} data-testid="aksi-hasil" data-kode={a.kode}>{a.label}</button>}
              </li>
            ); })}
          </ul>
        </div>
      ))}
    </section>
  );
}
