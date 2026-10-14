import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { labelMode, modeBerikutnya, alasanModeValid } from "./pkrRuteLogic.js";

// MODE RUTE PRODUKSI + "Menunggu penentuan alur Produksi" (Admin Produksi). Mode TRANSISI: item tanpa rute tetap tersimpan; Delivery boleh memakai konfirmasi kesiapan fisik.
// Mode KETAT: perilaku lama (item tanpa rute ditolak; kesiapan hanya dari status Produksi). Mengubah mode TIDAK mengubah dokumen/unit/status lama.
export default function RuteProduksiPanel({ bisaTulis }) {
  const [mode, setMode] = useState(null);
  const [menunggu, setMenunggu] = useState([]);
  const [galat, setGalat] = useState(""); const [info, setInfo] = useState(""); const [sibuk, setSibuk] = useState(false);
  const [ubahBuka, setUbahBuka] = useState(false); const [alasan, setAlasan] = useState("");
  const [pra, setPra] = useState(null); const [alasanTerap, setAlasanTerap] = useState("");

  const muat = useCallback(async () => {
    try {
      setMode(await api.getPkrRuteMode());
      if (bisaTulis) setMenunggu((await api.getPkrRuteMenunggu()).order ?? []);
      setGalat("");
    } catch (e) { setGalat(e.message || "Gagal memuat mode rute Produksi"); }
  }, [bisaTulis]);
  useEffect(() => { muat(); }, [muat]);

  const jalankan = async (fn, ok) => {
    setSibuk(true); setGalat(""); setInfo("");
    try { await fn(); setInfo(ok); await muat(); } catch (e) { setGalat(e.message || "Gagal menyimpan"); } finally { setSibuk(false); }
  };
  const lihat = async (orderId) => {
    setSibuk(true); setGalat(""); setInfo("");
    try { setPra(await api.pratinjauPkrRute(orderId)); setAlasanTerap(""); } catch (e) { setGalat(e.message || "Gagal membuat pratinjau"); } finally { setSibuk(false); }
  };

  if (!mode && !galat) return <p className="text-[12.5px] text-ink3" role="status">Memuat mode rute Produksi…</p>;
  const berikut = mode ? modeBerikutnya(mode.mode) : null;
  return (
    <Card className="space-y-3 p-4" data-testid="panel-rute-produksi">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="m-0 text-[14px] font-bold text-ink">Mode rute Produksi</h3>
          {mode && <Badge variant={mode.mode === "TRANSISI" ? "orange" : "green"} data-testid="badge-mode-rute">{labelMode(mode.mode)}</Badge>}
        </div>
        {bisaTulis && mode && !ubahBuka && (
          <Button size="sm" variant="neutral" disabled={sibuk} onClick={() => { setUbahBuka(true); setAlasan(""); }} className="max-sm:min-h-11" data-testid="ubah-mode-rute">
            Ubah ke mode {labelMode(berikut).toLowerCase()}
          </Button>
        )}
      </div>
      {mode && <p className="m-0 text-[12.5px] text-ink2" data-testid="arti-mode-rute">{mode.arti}</p>}
      {mode?.diubahOleh && <p className="m-0 text-[11.5px] text-ink3">Terakhir diubah oleh {mode.diubahOleh.name}{mode.diubahPada ? ` · ${String(mode.diubahPada).slice(0, 10)}` : ""}.</p>}
      {galat && <div role="alert" className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{galat}</div>}
      {info && <div role="status" className="rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green">{info}</div>}

      {ubahBuka && mode && (
        <div className="space-y-2 rounded-lg border border-line p-3" data-testid="form-ubah-mode">
          <p className="m-0 text-[12.5px] text-ink2">
            {berikut === "KETAT"
              ? "Mode ketat menuntut rute Produksi lengkap: item tanpa rute akan DITOLAK dan konfirmasi kesiapan fisik tidak diterima lagi. Dokumen dan unit yang sudah ada tidak berubah."
              : "Mode transisi mengizinkan item tanpa rute tersimpan (\"Menunggu penentuan alur Produksi\") dan konfirmasi kesiapan fisik oleh Delivery/Admin Produksi."}
          </p>
          <Field label="Alasan perubahan mode" required hint="Minimal 5 karakter — tercatat bersama nama Anda">
            <Input value={alasan} onChange={(e) => setAlasan(e.target.value)} aria-label="Alasan perubahan mode" placeholder="mis. Workspace Produksi sudah memetakan semua produk" />
          </Field>
          <div className="flex gap-2">
            <Button size="sm" variant="neutral" onClick={() => setUbahBuka(false)} className="max-sm:min-h-11">Batal</Button>
            <Button size="sm" disabled={sibuk || !alasanModeValid(alasan)} className="max-sm:min-h-11" data-testid="terapkan-mode"
              onClick={() => jalankan(() => api.ubahPkrRuteMode({ mode: berikut, alasan: alasan.trim() }), `Mode rute Produksi: ${labelMode(berikut)}.`).then(() => setUbahBuka(false))}>
              {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : `Terapkan mode ${labelMode(berikut).toLowerCase()}`}
            </Button>
          </div>
        </div>
      )}

      {bisaTulis && (
        <div className="space-y-2" data-testid="daftar-menunggu-alur">
          <p className="m-0 text-[12.5px] font-semibold text-ink">Order menunggu penentuan alur Produksi ({menunggu.length})</p>
          {menunggu.length === 0 && <p className="m-0 text-[12.5px] text-ink3">Tidak ada order yang menunggu alur.</p>}
          {menunggu.map((o) => (
            <div key={o.orderId} className="space-y-1.5 rounded-lg bg-inset px-3 py-2 text-[12.5px]" data-testid={`menunggu-${o.nomor}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="m-0 min-w-0 break-all font-mono font-semibold text-ink">{o.nomor}{o.pkr ? <span className="font-sans font-normal text-ink3"> · {o.pkr}</span> : null}{o.customer ? <span className="font-sans font-normal text-ink3"> · {o.customer}</span> : null}</p>
                <Button size="sm" variant="neutral" disabled={sibuk} onClick={() => lihat(o.orderId)} className="max-sm:min-h-11">Pratinjau penerapan</Button>
              </div>
              <p className="m-0 text-ink2">{o.jumlahItem} item · {o.jumlahUnit} unit · {o.bisaDiterapkan ? `${o.jumlahUnitAkanDiterapkan} unit siap diterapkan` : "rute katalog belum dipetakan"}</p>
              {pra?.order?.id === o.orderId && (
                <div className="space-y-2 rounded-lg border border-line bg-surface p-2.5" data-testid="pratinjau-terapkan-alur">
                  <p className="m-0 text-ink2">{pra.catatan}</p>
                  {pra.item.map((it) => (
                    <div key={it.no}>
                      <p className="m-0 font-semibold text-ink">Item {it.no} — {it.produk}</p>
                      {it.rute.ok
                        ? <p className="m-0 text-green"><CheckCircle2 size={12} className="mr-1 inline" aria-hidden="true" />Rute: {it.rute.alurLabel ?? "layanan produksi"} — akan diterapkan ke {it.akanDiterapkan.join(", ") || "tidak ada unit"}</p>
                        : <p className="m-0 text-orange"><AlertTriangle size={12} className="mr-1 inline" aria-hidden="true" />{it.rute.pesan}{it.tindakan && !String(it.rute.pesan ?? "").includes("Katalog Item PKR") ? ` ${it.tindakan}` : ""}</p>}
                      {it.dilewati.length > 0 && <ul className="m-0 list-disc pl-5 text-ink3">{it.dilewati.map((d) => <li key={d.unit}>{d.unit}: {d.alasan}</li>)}</ul>}
                    </div>
                  ))}
                  <Field label="Catatan (opsional)"><Input value={alasanTerap} onChange={(e) => setAlasanTerap(e.target.value)} aria-label="Catatan penerapan alur" /></Field>
                  <div className="flex gap-2">
                    <Button size="sm" variant="neutral" onClick={() => setPra(null)} className="max-sm:min-h-11">Tutup</Button>
                    <Button size="sm" disabled={sibuk || !pra.bisaDiterapkan} className="max-sm:min-h-11" data-testid="terapkan-alur"
                      onClick={() => jalankan(() => api.terapkanPkrRute({ orderId: o.orderId, alasan: alasanTerap.trim() || undefined }), "Alur Produksi diterapkan ke unit yang belum mulai.").then(() => setPra(null))}>
                      Terapkan ke {pra.jumlahUnitAkanDiterapkan} unit
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
