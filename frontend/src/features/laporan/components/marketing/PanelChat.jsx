import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, ExternalLink, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { PanelSamping } from "@/components/ui/panel-samping.jsx";
import { cn } from "@/lib/utils.js";
import { formatRupiah } from "@/utils/format.js";
import { statusChat } from "../../kanalPakem.js";
import { berurutan, pesanGalat } from "../../marketingData.js";
import { unduhEksporMarketing } from "./eksporMarketing.js";

// Daftar chat di balik satu channel atau satu iklan. Server yang memilih leadnya, jadi jumlahnya sama dengan baris tabel asal. Tautan chat dibuka di tab baru supaya posisi laporan tidak hilang.
const SARING = [{ id: "semua", label: "Semua" }, { id: "order", label: "Ber-order" }, { id: "spam", label: "Spam" }];

export default function PanelChat({ pilihan, periode, onTutup }) {
  const [hasil, setHasil] = useState("semua");
  const [data, setData] = useState(null);
  const [baris, setBaris] = useState([]);
  const [memuat, setMemuat] = useState(false);
  const [galat, setGalat] = useState(null);
  const [mengunduh, setMengunduh] = useState(false);
  const [galatUnduh, setGalatUnduh] = useState(null);
  const token = useRef(0);
  const kunci = JSON.stringify(pilihan?.query || null);

  async function muat(halaman) {
    const sendiri = ++token.current; const basi = () => sendiri !== token.current;
    setMemuat(true); setGalat(null);
    try {
      const r = await berurutan(() => api.getAtribusiChat({ dari: periode.dari, sampai: periode.sampai, ...pilihan.query, hasil, halaman }), { batal: basi });
      if (basi()) return;
      setData(r); setBaris((lama) => (halaman === 1 ? r.baris : [...lama, ...r.baris]));
    } catch (e) { if (!basi() && !e?.dibatalkan) setGalat(pesanGalat(e, "Gagal memuat daftar chat.")); }
    finally { if (!basi()) setMemuat(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (pilihan && periode?.ok) { setData(null); setBaris([]); muat(1); } return () => { token.current += 1; }; }, [kunci, hasil, periode?.dari, periode?.sampai]);
  useEffect(() => { setHasil("semua"); setGalatUnduh(null); }, [kunci]);

  async function ekspor() {
    setMengunduh(true); setGalatUnduh(null);
    try { await unduhEksporMarketing({ dari: periode.dari, sampai: periode.sampai, ...pilihan.query, hasil }); }
    catch (e) { setGalatUnduh(pesanGalat(e, "Gagal membuat berkas Excel.")); }
    finally { setMengunduh(false); }
  }

  const jumlah = data?.jumlah;
  return (
    <PanelSamping open={!!pilihan} onOpenChange={(o) => { if (!o) onTutup(); }} lebar={560} className="mk-ap-portal" judul={pilihan?.judul || "Daftar chat"} subjudul={pilihan?.sub || null}>
      <div className="flex flex-col gap-3" data-testid="panel-chat">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Saring chat">
            {SARING.map((f) => (
              <button key={f.id} type="button" aria-pressed={hasil === f.id} className={cn("mk-kapsul mk-kapsul--kecil", hasil === f.id && "mk-kapsul--aktif")} onClick={() => setHasil(f.id)} data-testid={`saring-${f.id}`}>
                {f.label}{jumlah ? ` (${Number(jumlah[f.id] || 0).toLocaleString("id-ID")})` : ""}
              </button>
            ))}
          </div>
          <button type="button" className="mk-kapsul mk-kapsul--kecil" onClick={ekspor} disabled={mengunduh} data-testid="ekspor-chat">
            {mengunduh ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} {mengunduh ? "Menyiapkan…" : "Export Excel"}
          </button>
        </div>
        {galatUnduh && <p className="text-[13px] text-red" role="alert">{galatUnduh}</p>}
        {galat && <p className="flex flex-wrap items-center gap-2 text-[13px] text-red" role="alert"><AlertTriangle size={15} /> {galat} <button type="button" className="btn btn-ghost btn-sm" onClick={() => muat(1)}>Coba lagi</button></p>}
        {data && baris.length === 0 && !memuat && <p className="py-6 text-center text-[13px] text-ink3" data-testid="chat-kosong">Tidak ada chat untuk saringan ini.</p>}
        <ul className="m-0 flex list-none flex-col p-0">
          {baris.map((b) => (
            <li key={b.id} className="flex flex-col gap-1 border-t border-line py-3" data-testid="baris-chat">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <b className="text-[14px] text-ink">{b.nama || "Tanpa nama"}</b>
                <span className="text-[12px] tabular-nums text-ink3">{b.tanggal} WIB</span>
              </div>
              {b.pesanPertama ? <p className="m-0 text-[13px] text-ink2">{b.pesanPertama}</p> : <p className="m-0 text-[13px] text-ink3">Belum ada pesan masuk</p>}
              {b.iklan?.adNama && <p className="m-0 text-[12px] text-ink3">Iklan: {b.iklan.adNama}</p>}
              {!b.iklan && b.keterangan && <p className="m-0 text-[12px] text-ink3">{b.keterangan}</p>}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12.5px] text-ink2"><span className="tabular-nums">{b.nomor || "Tanpa nomor"}</span> · {statusChat(b, formatRupiah)}{b.sales ? ` · ${b.sales}` : ""}</span>
                {b.conversationId
                  ? <a className="mk-kapsul mk-kapsul--kecil" href={`/inbox?conv=${b.conversationId}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Buka chat</a>
                  : <span className="text-[12px] text-ink3">Belum ada percakapan</span>}
              </div>
            </li>
          ))}
        </ul>
        {memuat && <p className="flex items-center justify-center gap-2 py-3 text-[13px] text-ink3" data-testid="memuat-chat"><Loader2 size={15} className="animate-spin" /> Memuat chat…</p>}
        {data?.adaLagi && !memuat && <button type="button" className="btn btn-ghost btn-sm self-center" onClick={() => muat(data.halaman + 1)} data-testid="chat-lagi">Muat {data.ukuranHalaman} berikutnya</button>}
      </div>
    </PanelSamping>
  );
}
