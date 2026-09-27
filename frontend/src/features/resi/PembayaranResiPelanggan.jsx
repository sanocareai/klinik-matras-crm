import React, { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronRight, Clock, Loader2, ReceiptText } from "lucide-react";
import { Card, CardInset } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { api } from "@/api.js";
import { formatRupiah, PAYMENT_STATUS_LABELS } from "@/utils/format.js";
import { cn } from "@/lib/utils.js";

// PEMBAYARAN RESI (Fase 3A) — kartu per Resi di profil pelanggan: total, ongkir tambahan, rincian order (bisa dibuka), sisa, dan tombol
// "Klaim Lunas Resi" SEKALI untuk semua order di Resi itu. Klaim TIDAK mengubah status bayar/komisi — keduanya berubah setelah Finance
// memverifikasi uangnya (satu antrean Resi di Finance). Semua angka dari server (tagihan kanonis, alokasi); UI tidak menghitung sendiri.
// Tersembunyi seluruhnya bila flag server RESI_PEMBAYARAN_AKTIF mati (server menjawab { aktif: false }). Resi hasil backfill lama tidak tampil.

const tanggal = (v) => (v ? new Date(v).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }) : "—");

const NADA_STATUS = { LUNAS: "green", DP: "orange", BELUM_BAYAR: "neutral" };

function statusResi(r) {
  if (r.sisa <= 0) return { label: "Lunas", variant: "green" };
  if (r.klaim) return { label: "Menunggu verifikasi Finance", variant: "orange" };
  if (r.dibayar > 0) return { label: "Sebagian dibayar", variant: "accent" };
  return { label: "Belum dibayar", variant: "neutral" };
}

function Angka({ label, value, tone }) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-medium uppercase tracking-wide text-ink3">{label}</p>
      <p className={cn("mt-0.5 truncate text-[13.5px] font-bold tabular-nums", tone === "red" ? "text-red" : tone === "green" ? "text-green" : "text-ink")}>{formatRupiah(value)}</p>
    </div>
  );
}

function KartuResi({ r, onBukaOrder, onKlaim }) {
  const st = statusResi(r);
  const anchor = r.anak.find((a) => a.anchor);
  return (
    <Card className="p-4" data-testid="kartu-resi">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ReceiptText size={16} className="shrink-0 text-accent" aria-hidden />
          <p className="truncate text-[14px] font-semibold text-ink">Resi {anchor?.orderNumber || ""}</p>
          <span className="text-[12px] text-ink3">· {r.anak.length} order</span>
        </div>
        <Badge variant={st.variant}>{st.label}</Badge>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Angka label="Total Resi" value={r.totalTagihan} />
        <Angka label="Ongkir Tambahan" value={r.ongkirTambahan} />
        <Angka label="Sudah Dibayar" value={r.dibayar} tone="green" />
        <Angka label="Sisa" value={r.sisa} tone={r.sisa > 0 ? "red" : undefined} />
      </div>

      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-btn bg-inset" aria-label="Order dalam Resi">
        {r.anak.map((a) => (
          <li key={a.orderId}>
            <button
              type="button" onClick={() => onBukaOrder?.(a.orderId)}
              className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-hovertint"
              title="Buka rincian order"
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[12px] font-bold text-ink">{a.orderNumber || "—"}</span>
                  {a.anchor && <span className="rounded bg-accentbg px-1.5 text-[10px] font-semibold text-accent">Ongkir di sini</span>}
                  <Badge variant={NADA_STATUS[a.paymentStatus] || "neutral"} className="text-[10.5px]">{PAYMENT_STATUS_LABELS[a.paymentStatus] || a.paymentStatus}</Badge>
                </span>
                <span className="mt-0.5 block text-[11.5px] text-ink3 tabular-nums">
                  Dibayar {formatRupiah(a.dibayar)} · Sisa {formatRupiah(a.sisa)}
                </span>
              </span>
              <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-ink2">{formatRupiah(a.tagihan)}</span>
              <ChevronRight size={14} className="shrink-0 text-ink3" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {r.dibatalkan?.length > 0 && (
        <p className="mt-2 text-[11.5px] text-ink3">Order dibatalkan (tidak ditagih): {r.dibatalkan.map((d) => d.orderNumber).join(", ")}</p>
      )}

      <div className="mt-3">
        {r.sisa <= 0 ? (
          <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-green"><CheckCircle2 size={14} /> Resi ini sudah lunas tercatat.</p>
        ) : r.klaim ? (
          <p className="flex items-start gap-1.5 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="klaim-menunggu">
            <Clock size={14} className="mt-0.5 shrink-0" />
            <span>Diklaim Lunas {tanggal(r.klaim.pada)}{r.klaim.olehNama ? ` oleh ${r.klaim.olehNama}` : ""}. Status order &amp; komisi berubah setelah Finance memverifikasi uangnya.</span>
          </p>
        ) : (
          <Button className="w-full max-sm:min-h-11 sm:w-auto" onClick={() => onKlaim(r)} data-testid="klaim-lunas-resi">
            Klaim Lunas Resi · {formatRupiah(r.sisa)}
          </Button>
        )}
      </div>
    </Card>
  );
}

function ModalKlaim({ resi, onClose, onSelesai }) {
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState(null);
  // SATU kunci per dialog: klik ganda / kirim ulang setelah koneksi putus diputar ulang server, bukan klaim kedua.
  const kunci = useRef(null);
  useEffect(() => {
    if (resi) {
      kunci.current = globalThis.crypto?.randomUUID ? `resi-klaim-${globalThis.crypto.randomUUID()}` : `resi-klaim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      setGalat(null);
      setSibuk(false);
    }
  }, [resi]);
  if (!resi) return null;

  async function kirim() {
    if (sibuk) return;
    setSibuk(true);
    setGalat(null);
    try {
      await api.klaimLunasResi(resi.groupId, kunci.current);
      onSelesai("Klaim Lunas Resi terkirim. Finance akan memverifikasi uangnya.");
    } catch (e) {
      if (e.status === 409 && e.code === "KLAIM_SUDAH_ADA") return onSelesai("Resi ini sudah diklaim Lunas sebelumnya — menunggu verifikasi Finance.");
      if (e.status === 409 && e.code === "SUDAH_LUNAS") return onSelesai("Resi ini ternyata sudah lunas tercatat.");
      setGalat(e.status === 403 ? "Fitur pembayaran Resi sedang tidak aktif." : e.message || "Klaim gagal dikirim. Coba lagi.");
      setSibuk(false);
      // Ditolak server (4xx) = final untuk kunci ini → kunci baru; galat jaringan/5xx: kunci dipertahankan agar kirim ulang diputar ulang.
      if (e.status >= 400 && e.status < 500) kunci.current = `resi-klaim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    }
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && !sibuk && onClose()}
      title="Klaim Lunas Resi"
      description={`${resi.anak.length} order sekaligus · sisa ${formatRupiah(resi.sisa)}`}
      className="w-[460px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} disabled={sibuk} className="max-sm:min-h-11">Batal</Button>
          <Button onClick={kirim} disabled={sibuk} className="max-sm:min-h-11" data-testid="konfirmasi-klaim">
            {sibuk && <Loader2 size={14} className="animate-spin" />} Ya, klaim lunas
          </Button>
        </>
      }
    >
      <div className="space-y-2 text-[13px] leading-relaxed text-ink2">
        <p>Semua order dalam Resi ini diklaim lunas <strong>sekali</strong>. Tidak perlu menandai lunas per order.</p>
        <CardInset className="p-3 text-[12.5px]">
          Status bayar order dan komisi <strong>belum berubah</strong> sekarang — baru berubah setelah Finance memeriksa uangnya masuk ke rekening.
          Kalau uangnya belum masuk, Finance akan menolak klaim ini dan status tetap seperti sebelumnya.
        </CardInset>
        {galat && <p className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red" role="alert">{galat}</p>}
      </div>
    </Modal>
  );
}

/**
 * Daftar kartu Resi milik pelanggan. `versi` = ubah nilainya untuk memuat ulang (mis. objek customer setelah refresh).
 * `onAnakResi(Set<orderId>)` memberi tahu induk order mana yang status bayarnya diatur di level Resi (dropdown per order dikunci).
 */
export default function PembayaranResiPelanggan({ customerId, versi, onBukaOrder, onBerubah, onAnakResi }) {
  const [data, setData] = useState(null);
  const [galat, setGalat] = useState(null);
  const [klaim, setKlaim] = useState(null);
  const [pesan, setPesan] = useState(null);

  const muat = useCallback(async () => {
    try {
      const d = await api.getResiPembayaranPelanggan(customerId);
      setData(d);
      setGalat(null);
      const anak = new Set();
      for (const r of d?.resi || []) if (r.layak) for (const a of r.anak) anak.add(a.orderId);
      onAnakResi?.(d?.aktif ? anak : new Set());
    } catch (e) {
      // Gagal membaca = fitur disembunyikan (fail-closed), tapi tampilkan pesan bila fitur memang aktif sebelumnya.
      setGalat(e.message || "Gagal memuat pembayaran Resi");
      onAnakResi?.(new Set());
    }
  }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { muat(); }, [muat, versi]);

  if (galat && data?.aktif) {
    return (
      <Card className="mb-3 flex items-center justify-between gap-3 p-4">
        <p className="text-[12.5px] text-red">{galat}</p>
        <Button size="sm" variant="neutral" onClick={muat}>Coba lagi</Button>
      </Card>
    );
  }
  if (!data?.aktif) return null;
  const resi = (data.resi || []).filter((r) => r.layak);
  if (resi.length === 0) return null;

  return (
    <div className="mb-3 space-y-3" data-testid="pembayaran-resi">
      {pesan && (
        <p className="flex items-center justify-between gap-2 rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green" role="status">
          {pesan}
          <button type="button" className="text-[12px] font-semibold" onClick={() => setPesan(null)}>Tutup</button>
        </p>
      )}
      {resi.map((r) => <KartuResi key={r.groupId} r={r} onBukaOrder={onBukaOrder} onKlaim={setKlaim} />)}
      <ModalKlaim
        resi={klaim} onClose={() => setKlaim(null)}
        onSelesai={async (teks) => { setKlaim(null); setPesan(teks); await muat(); onBerubah?.(); }}
      />
    </div>
  );
}
