import React, { useCallback, useEffect, useState } from "react";
import { FileMinus, Loader2, RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { api } from "@/api.js";
import { formatUang, tanggalPendek } from "@/features/finance/shared.jsx";
import { adminSaatIni } from "@/features/finance/aksiMenu.jsx";
import { BatalNotaKreditDialog } from "@/features/finance/NotaKreditDialog.jsx";
import { keteranganJurnal, labelJenis, labelSumber, labelStatusBayar } from "@/features/finance/notaKreditLogic.js";

// Riwayat Nota Kredit satu order (di drawer Piutang & detail order): nomor, jenis, nominal, pembuat/waktu/alasan, refund sumber, jurnal, status.
// `refreshKey` berubah → muat ulang. `onBuat` membuka dialog pembuatan (hanya Admin Keuangan; server tetap menjaga).
export default function RiwayatNotaKredit({ orderId, refreshKey = 0, onBuat, onChanged }) {
  const [s, setS] = useState({ memuat: true, galat: "", data: null });
  const [batal, setBatal] = useState(null);
  const admin = adminSaatIni();

  const muat = useCallback(async () => {
    setS((x) => ({ ...x, memuat: true, galat: "" }));
    try { setS({ memuat: false, galat: "", data: await api.getNotaKreditOrder(orderId) }); }
    catch (e) { setS({ memuat: false, galat: e.message || "Gagal memuat nota kredit", data: null }); }
  }, [orderId]);
  useEffect(() => { muat(); }, [muat, refreshKey]);

  const daftar = s.data?.notaKredit ?? [];
  const r = s.data?.ringkasan;

  return (
    <section className="space-y-2" aria-label="Nota Kredit" data-testid="riwayat-nota-kredit">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink"><FileMinus size={14} className="text-ink3" aria-hidden="true" />Nota Kredit ({daftar.filter((n) => n.status === "AKTIF").length} aktif)</span>
        {onBuat && (
          <Button size="sm" variant="neutral" onClick={onBuat} disabled={!admin} title={admin ? "Buat Nota Kredit" : "Butuh Admin Keuangan — akun Anda tidak punya izin ini"} data-testid="buat-nota-kredit">
            Buat Nota Kredit
          </Button>
        )}
      </div>
      {s.memuat && <p className="m-0 flex items-center gap-2 text-[12.5px] text-ink3" role="status"><Loader2 size={13} className="animate-spin" />Memuat nota kredit…</p>}
      {s.galat && (
        <p className="m-0 flex flex-wrap items-center gap-2 text-[12.5px] text-red" role="alert">{s.galat}<Button size="sm" variant="neutral" onClick={muat}><RotateCw size={12} />Coba lagi</Button></p>
      )}
      {r && (
        <p className="m-0 text-[12px] text-ink3" data-testid="ringkas-nota">
          Tagihan bersih {formatUang(r.tagihanBersih)} · pembayaran bersih {formatUang(r.pembayaranBersih)} · sisa {formatUang(r.sisa)} · {labelStatusBayar(r.statusTersimpan)}
        </p>
      )}
      {!s.memuat && !s.galat && daftar.length === 0 && <p className="m-0 text-[12.5px] text-ink3" data-testid="nota-kosong">Belum ada nota kredit untuk order ini.</p>}
      <ul className="m-0 list-none space-y-1.5 p-0">
        {daftar.map((n) => (
          <li key={n.id} className={`rounded-lg border border-line px-2.5 py-2 ${n.status === "DIBATALKAN" ? "opacity-70" : ""}`} data-testid="baris-nota-kredit">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[12px] text-ink">{n.nomor}</span>
              <span className="flex flex-wrap items-center gap-1.5">
                <span className={`font-semibold tabular-nums ${n.status === "DIBATALKAN" ? "line-through" : ""}`}>{formatUang(n.jumlah)}</span>
                <Badge variant={n.status === "AKTIF" ? "green" : "neutral"}>{n.status === "AKTIF" ? "Aktif" : "Dibatalkan"}</Badge>
              </span>
            </div>
            <p className="m-0 mt-0.5 text-[12px] text-ink3">
              {[labelSumber(n.sumber), labelJenis(n.jenis), n.tanggal && tanggalPendek(n.tanggal), n.refund && `refund ${n.refund}`, n.dibuatOleh && `oleh ${n.dibuatOleh}`, n.dibuatPada && tanggalPendek(n.dibuatPada)].filter(Boolean).join(" · ")}
            </p>
            <p className="m-0 mt-0.5 text-[12.5px] text-ink2">Alasan: {n.alasan}</p>
            <p className="m-0 mt-0.5 text-[12px] text-ink3" data-testid="jurnal-baris-nota">{keteranganJurnal(n)}</p>
            {n.status === "DIBATALKAN" && (
              <p className="m-0 mt-0.5 text-[12px] text-ink3">Dibatalkan{n.dibatalkanOleh ? ` oleh ${n.dibatalkanOleh}` : ""}{n.dibatalkanPada ? ` · ${tanggalPendek(n.dibatalkanPada)}` : ""}{n.alasanBatal ? ` — ${n.alasanBatal}` : ""}</p>
            )}
            {n.status === "AKTIF" && admin && (
              <div className="mt-1.5"><Button size="sm" variant="neutral" onClick={() => setBatal(n)} data-testid="batalkan-nota-kredit">Batalkan…</Button></div>
            )}
          </li>
        ))}
      </ul>
      {batal && <BatalNotaKreditDialog nota={batal} onClose={() => setBatal(null)} onDone={() => { setBatal(null); muat(); onChanged?.(); }} />}
    </section>
  );
}
