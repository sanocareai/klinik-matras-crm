import React, { useEffect, useRef, useState } from "react";
import { Loader2, BadgeCheck, AlertCircle } from "lucide-react";
import { Modal } from "@/components/ui/modal.jsx";
import KlaimLunasDialog from "@/features/klaim/KlaimLunasDialog.jsx";
import { api } from "@/api.js";
import { formatRupiah } from "@/utils/format.js";

// "Catat Pembayaran" dari foto di chat (2 Okt 2026). Sales menekan foto bukti transfer → pilih order → foto itu otomatis jadi Bukti Pembayaran pada
// draf klaim → dialog klaim biasa terbuka untuk VERIFIKASI (nominal, tanggal, rekening, catatan) → Sales mengajukan → Finance memverifikasi.
// Tidak ada alur baru: server memakai aturan klaim yang sama (backend/src/services/finance/klaimDariChat.js). Di sini hanya pemilih order + penyambung.
const LABEL_KATEGORI = { LAYANAN: "Layanan", SEWA: "Sewa", BARU: "Kasur Baru" };

export default function CatatPembayaranDariChat({ message, customerName, onClose, onChanged }) {
  const [tahap, setTahap] = useState("memuat"); // memuat | pilih | menyiapkan | dialog | galat
  const [daftar, setDaftar] = useState([]);
  const [galat, setGalat] = useState("");
  const [orderTerpilih, setOrderTerpilih] = useState(null);
  const sudahOtomatis = useRef(false);

  async function lampirkan(order) {
    setTahap("menyiapkan"); setGalat("");
    try {
      await api.lampirkanBuktiDariPesan(order.id, message.id);
      setOrderTerpilih(order);
      setTahap("dialog");
    } catch (e) {
      setGalat(e.message || "Gagal menyiapkan klaim dari foto ini");
      setTahap("galat");
    }
  }

  useEffect(() => {
    let batal = false;
    api.getKandidatOrderDariPesan(message.id).then((r) => {
      if (batal) return;
      setDaftar(r.order || []);
      const bisa = (r.order || []).filter((o) => o.bolehDiklaim || o.klaimAktifId);
      // Hanya satu order yang relevan → langsung lanjut, tanpa langkah memilih.
      if (bisa.length === 1 && (r.order || []).length === 1 && !sudahOtomatis.current) { sudahOtomatis.current = true; lampirkan(bisa[0]); } else setTahap("pilih");
    }).catch((e) => { if (!batal) { setGalat(e.message || "Gagal memuat order pelanggan"); setTahap("galat"); } });
    return () => { batal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id]);

  if (tahap === "dialog" && orderTerpilih) {
    return (
      <KlaimLunasDialog
        open
        order={{ id: orderTerpilih.id, orderNumber: orderTerpilih.orderNumber, customerName }}
        onClose={onClose}
        onChanged={() => onChanged?.()}
      />
    );
  }

  return (
    <Modal
      open
      onOpenChange={(v) => { if (!v && tahap !== "menyiapkan") onClose(); }}
      title="Catat Pembayaran dari Foto"
      description={customerName ? `Pelanggan: ${customerName}` : undefined}
      className="w-[460px] max-h-[88vh]"
    >
      {(tahap === "memuat" || tahap === "menyiapkan") && (
        <p className="flex items-center justify-center gap-2 py-8 text-[13px] text-ink3">
          <Loader2 size={16} className="animate-spin" /> {tahap === "memuat" ? "Memuat order pelanggan…" : "Melampirkan foto sebagai bukti…"}
        </p>
      )}

      {tahap === "galat" && (
        <div className="flex flex-col gap-3 py-2">
          <p className="flex items-start gap-2 rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red" role="alert"><AlertCircle size={14} className="mt-0.5 shrink-0" /> {galat}</p>
          <button type="button" onClick={onClose} className="h-10 rounded-xl bg-inset text-[13px] font-semibold text-ink2">Tutup</button>
        </div>
      )}

      {tahap === "pilih" && (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] leading-snug text-ink3">
            Foto ini akan dilampirkan sebagai <b>Bukti Pembayaran</b>. Di langkah berikutnya Anda mencocokkan nominal &amp; tanggal dengan mutasi rekening sebelum mengajukan DP / Lunas ke Finance.
          </p>
          {daftar.length === 0 && <p className="py-6 text-center text-[13px] text-ink3">Pelanggan ini belum punya order yang bisa dicatat pembayarannya.</p>}
          {daftar.map((o) => {
            const aktif = o.bolehDiklaim || !!o.klaimAktifId;
            return (
              <button
                key={o.id} type="button" disabled={!aktif} onClick={() => lampirkan(o)}
                className="flex items-start gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-55"
              >
                <BadgeCheck size={16} className="mt-0.5 shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">{o.orderNumber || "Order tanpa nomor"} · {LABEL_KATEGORI[o.category] || o.category}</span>
                  <span className="block text-[11.5px] text-ink3">Tagihan {formatRupiah(o.tagihan)} · Sisa {formatRupiah(o.sisa)}</span>
                  {o.klaimAktifId && <span className="block text-[11px] font-medium text-accent">Ada klaim berjalan — foto ditambahkan ke klaim itu</span>}
                  {!aktif && o.alasanTidakBisa && <span className="block text-[11px] text-ink3">{o.alasanTidakBisa}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
