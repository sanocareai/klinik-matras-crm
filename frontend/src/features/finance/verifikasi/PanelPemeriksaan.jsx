import React, { useEffect, useId, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { DaftarOverlay } from "@/components/ui/overlay-status.jsx";
import { AlertTriangle, ExternalLink, FileText, Loader2, Minus, Plus, RotateCcw, X } from "lucide-react";
import { ambilUrlBertanda } from "@/features/finance/receiptMedia.jsx";
import { Foto } from "@/features/finance/shared.jsx";

// PANEL PEMERIKSAAN — membantu Finance MEMBANDINGKAN sebelum bertindak: identitas, nominal/tanggal/rekening tujuan, bukti (bisa diperbesar), catatan,
// riwayat/pembayaran pengganti, dan tindakan yang tersedia. Klik baris hanya MEMBUKA panel ini; tidak ada persetujuan otomatis.
// Isi diterima sebagai `model` (disusun halaman dari data yang SUDAH dimuat); panel tidak memanggil API sendiri kecuali lewat `versi` (node) dari pemanggil.
//
// "Bukti terunggah" ≠ "bukti terverifikasi": panel hanya menampilkan berkas yang diunggah dan TIDAK menyatakan uangnya cocok dengan mutasi bank
// (pencocokan mutasi bank bukan bagian halaman ini).

const ZOOM = [1, 1.5, 2, 3];
const adalahPdf = (b) => b?.mime === "application/pdf" || /\.pdf($|\?)/i.test(b?.url || "");

/** Satu bukti besar + pembesaran. Keadaan: memuat / tampil / gagal dimuat (dengan "Coba lagi") / PDF (tautan). */
function BuktiBesar({ b }) {
  const [url, setUrl] = useState(null);
  const [keadaan, setKeadaan] = useState("memuat");
  const [zoom, setZoom] = useState(0);
  const [ulang, setUlang] = useState(0);
  const pdf = adalahPdf(b);

  useEffect(() => {
    let batal = false;
    setKeadaan("memuat"); setZoom(0); setUrl(null);
    ambilUrlBertanda(b.url).then((h) => {
      if (batal) return;
      if (!h?.url) { setKeadaan("galat"); return; }
      setUrl(h.url); setKeadaan(pdf ? "pdf" : "tampil");
    });
    return () => { batal = true; };
  }, [b.url, ulang, pdf]);

  if (keadaan === "memuat") return <div className="fin-vp-bukti-kotak" role="status"><Loader2 size={18} className="fin-vp-putar" aria-hidden="true" /> Memuat bukti…</div>;
  if (keadaan === "galat") {
    return (
      <div className="fin-vp-bukti-kotak fin-vp-bukti-galat" role="alert" data-testid="bukti-gagal">
        <AlertTriangle size={18} aria-hidden="true" />
        <span>Bukti tidak dapat dimuat.</span>
        <button type="button" className="fin-vp-kecil" onClick={() => setUlang((n) => n + 1)}><RotateCcw size={13} aria-hidden="true" /> Coba lagi</button>
      </div>
    );
  }
  if (keadaan === "pdf") {
    return (
      <div className="fin-vp-bukti-kotak" data-testid="bukti-pdf">
        <FileText size={22} aria-hidden="true" />
        <span>{b.nama || "Dokumen PDF"}</span>
        <a className="fin-vp-kecil" href={url} target="_blank" rel="noreferrer">Buka di tab baru <ExternalLink size={13} aria-hidden="true" /></a>
      </div>
    );
  }
  const skala = ZOOM[zoom];
  return (
    <div className="fin-vp-bukti-wadah">
      <div className="fin-vp-zoom" role="group" aria-label="Pembesaran bukti">
        <button type="button" className="fin-vp-kecil" onClick={() => setZoom((z) => Math.max(0, z - 1))} disabled={zoom === 0} aria-label="Perkecil bukti"><Minus size={14} aria-hidden="true" /></button>
        <span className="fin-vp-zoom-nilai" aria-live="polite">{Math.round(skala * 100)}%</span>
        <button type="button" className="fin-vp-kecil" onClick={() => setZoom((z) => Math.min(ZOOM.length - 1, z + 1))} disabled={zoom === ZOOM.length - 1} aria-label="Perbesar bukti"><Plus size={14} aria-hidden="true" /></button>
        <a className="fin-vp-kecil fin-vp-kanan" href={url} target="_blank" rel="noreferrer">Buka di tab baru <ExternalLink size={13} aria-hidden="true" /></a>
      </div>
      <div className="fin-vp-bukti-gulir" tabIndex={0} role="region" aria-label="Bukti pembayaran; gulir bila diperbesar">
        <img
          src={url} alt={b.nama || "Bukti pembayaran"} data-testid="bukti-besar" style={{ width: `${skala * 100}%` }}
          onError={() => setKeadaan("galat")}
        />
      </div>
    </div>
  );
}

function Bukti({ bukti }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [bukti]);
  const items = bukti?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="fin-vp-bukti-kotak fin-vp-bukti-kosong" data-testid="tanpa-bukti">
        <AlertTriangle size={18} aria-hidden="true" />
        <span>{bukti?.kosong || "Belum ada bukti pembayaran."}</span>
      </div>
    );
  }
  const b = items[Math.min(idx, items.length - 1)];
  return (
    <div>
      <BuktiBesar key={b.url} b={b} />
      {items.length > 1 && (
        <ul className="fin-vp-mini" aria-label="Pilih bukti">
          {items.map((x, i) => (
            <li key={x.url}>
              <button type="button" className="fin-vp-mini-tombol" aria-pressed={i === idx} aria-label={`Bukti ${i + 1} dari ${items.length}`} onClick={() => setIdx(i)}>
                {adalahPdf(x) ? <FileText size={18} aria-hidden="true" /> : <Foto url={x.url} alt="" className="fin-vp-mini-gambar" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="fin-vp-bukti-ket">Bukti {Math.min(idx, items.length - 1) + 1} dari {items.length}. Berkas yang diunggah, bukan jaminan uangnya sudah masuk.</p>
    </div>
  );
}

function Aksi({ aksi, onTutup }) {
  const [sibuk, setSibuk] = useState(false);
  if (!aksi?.length) return null;
  async function jalan(a) {
    if (sibuk || a.disabled) return;
    setSibuk(true);
    try { await a.onClick?.(); } finally { setSibuk(false); }
  }
  return (
    <div className="fin-vp-kaki">
      {aksi.map((a) => (
        <button
          key={a.key} type="button" data-testid={`aksi-${a.key}`} className={`fin-vp-aksi${a.utama ? " fin-vp-aksi-utama" : ""}`}
          disabled={sibuk || a.disabled} title={a.disabled ? a.alasan : undefined} aria-describedby={a.disabled && a.alasan ? `alasan-${a.key}` : undefined}
          onClick={() => jalan(a)}
        >
          {sibuk && a.utama && <Loader2 size={14} className="fin-vp-putar" aria-hidden="true" />}
          {a.label}
          {a.disabled && a.alasan && <span id={`alasan-${a.key}`} className="fin-sr-saja">{a.alasan}</span>}
        </button>
      ))}
      <button type="button" className="fin-vp-aksi" onClick={onTutup}>Tutup</button>
    </div>
  );
}

export default function PanelPemeriksaan({ model, onClose }) {
  const idJudul = useId();
  const wadah = typeof document !== "undefined" ? document.querySelector(".app-shell") : undefined;
  return (
    <Dialog.Root open={!!model} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal container={wadah || undefined}>
        <Dialog.Overlay className="fin-vp-lapisan" />
        <Dialog.Content className="fin-vp" aria-labelledby={idJudul} aria-describedby={undefined} data-testid="panel-pemeriksaan">
          {model && (
            <>
              <header className="fin-vp-kepala">
                <div className="fin-vp-judul-blok">
                  <p className="fin-vp-jenis">{model.jenisLabel}</p>
                  <Dialog.Title id={idJudul} className="fin-vp-judul">{model.judul}</Dialog.Title>
                  {model.subjudul && <p className="fin-vp-sub">{model.subjudul}</p>}
                </div>
                <div className="fin-vp-status">
                  {model.status && <span className={`fin-chip fin-chip-${model.status.nada}`}>{model.status.label}</span>}
                  {model.tidakDihitung && <span className="fin-vp-tdh" data-testid="panel-tidak-dihitung">Tidak dihitung</span>}
                </div>
                <Dialog.Close className="fin-vp-tutup" aria-label="Tutup panel"><X size={18} aria-hidden="true" /></Dialog.Close>
              </header>

              <div className="fin-vp-isi">
                <section className="fin-vp-kolom" aria-label="Data yang dibandingkan">
                  <dl className="fin-vp-ringkas">
                    {model.ringkas.map(([label, nilai, catatan]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{nilai}{catatan && <span className="fin-vp-catatan-kecil">{catatan}</span>}</dd>
                      </div>
                    ))}
                  </dl>

                  {model.alasanBatal && (
                    <div className="fin-vp-kotak" role="note" data-testid="panel-alasan-batal">
                      <p className="fin-vp-kotak-judul">{model.alasanBatal.judul}</p>
                      <p>{model.alasanBatal.alasan || "Alasan tidak dicatat."}</p>
                      {model.alasanBatal.oleh && <p className="fin-vp-redup">{model.alasanBatal.oleh}{model.alasanBatal.pada ? ` · ${model.alasanBatal.pada}` : ""}</p>}
                      {model.alasanBatal.catatanNilai && <p className="fin-vp-redup">{model.alasanBatal.catatanNilai}</p>}
                    </div>
                  )}

                  {model.bagian.map((b) => (
                    <section key={b.judul} className="fin-vp-bagian">
                      <h3>{b.judul}</h3>
                      <dl className="fin-vp-baris">
                        {b.baris.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([l, v]) => (
                          <div key={l}><dt>{l}</dt><dd>{v}</dd></div>
                        ))}
                      </dl>
                    </section>
                  ))}

                  {model.versi}

                  {model.dampak?.length > 0 && (
                    <section className="fin-vp-kotak fin-vp-dampak" aria-label="Dampak tindakan" data-testid="panel-dampak">
                      <p className="fin-vp-kotak-judul">{model.dampakJudul || "Bila diverifikasi"}</p>
                      <ul>{model.dampak.map((d) => <li key={d}>{d}</li>)}</ul>
                    </section>
                  )}
                </section>

                <section className="fin-vp-kolom fin-vp-kolom-bukti" aria-label="Bukti pembayaran">
                  <h3 className="fin-vp-h3">Bukti pembayaran</h3>
                  <Bukti bukti={model.bukti} />
                  {model.catatan && (
                    <div className="fin-vp-bagian">
                      <h3>Catatan</h3>
                      <p className="fin-vp-teks">{model.catatan}</p>
                    </div>
                  )}
                </section>
              </div>

              <Aksi aksi={model.aksi} onTutup={onClose} />
            </>
          )}
          <DaftarOverlay />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
