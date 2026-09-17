import React, { useCallback, useEffect, useRef, useState } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { formatUang } from "./shared.jsx";

// PENCARI ORDER untuk form-form Finance (refund, alokasi pembayaran,
// pembebanan biaya ke order).
//
// KENAPA ADA. Versi pertama halaman-halaman itu meminta ID order MENTAH
// (cuid 25 karakter) diketik/ditempel manual. Itu bukan sekadar tidak
// nyaman — ID order tidak pernah muncul di layar mana pun yang dilihat
// finance sehari-hari (yang tampil `orderNumber`, mis. "RES-03092026-014"),
// jadi satu-satunya cara mengisinya adalah membuka halaman Order di tab
// lain dan menyalin dari URL. Salah tempel satu karakter menghasilkan
// "order tidak ditemukan"; salah tempel ID order LAIN menghasilkan refund
// yang dibukukan ke order yang salah — dan itu baru ketahuan saat
// rekonsiliasi.
//
// Memakai endpoint `GET /api/orders` yang SUDAH ADA (pencarian nomor order
// & nama pelanggan sudah didukung di sana) — tidak ada endpoint pencarian
// kedua yang harus dijaga sinkron.

const JEDA_KETIK_MS = 300;

export default function OrderPicker({
  value,              // orderId terpilih (string) atau ""
  onChange,           // (orderId, orderLengkap|null) => void
  placeholder = "Cari nomor order atau nama pelanggan…",
  disabled,
  className,
  // Saring hasil sebelum ditampilkan — mis. refund cuma relevan untuk
  // order yang pernah dibayar. Fungsi MURNI, dipanggil per baris.
  filter,
  // Baris yang ditampilkan saat kotak baru dibuka tanpa kata kunci.
  // Dipakai halaman yang sudah punya daftar relevan sendiri (mis. daftar
  // piutang terbuka) supaya pengguna tidak perlu mengetik apa pun untuk
  // kasus yang paling sering.
  saran = [],
  saranLabel = "Saran",
}) {
  const [buka, setBuka] = useState(false);
  const [kata, setKata] = useState("");
  const [hasil, setHasil] = useState([]);
  const [memuat, setMemuat] = useState(false);
  const [terpilih, setTerpilih] = useState(null);
  const [error, setError] = useState(null);
  const wadahRef = useRef(null);

  // Klik di luar menutup daftar — tanpa ini, daftar menggantung di atas
  // form dan menutupi field berikutnya.
  useEffect(() => {
    function onDocClick(e) {
      if (wadahRef.current && !wadahRef.current.contains(e.target)) setBuka(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Sinkron saat parent mengosongkan pilihan (mis. modal ditutup lalu
  // dibuka lagi) — kalau tidak, label order lama menempel padahal
  // state-nya sudah kosong.
  useEffect(() => {
    if (!value) setTerpilih(null);
  }, [value]);

  const cari = useCallback(async (q) => {
    setMemuat(true);
    setError(null);
    try {
      // `limit` kecil: ini pemilih, bukan tabel. Hasil yang panjang justru
      // memperlambat keputusan.
      const r = await api.getOrders({ search: q, limit: 20 });
      const items = r.items || [];
      setHasil(filter ? items.filter(filter) : items);
    } catch (e) {
      setError(e.message || "Gagal mencari order");
      setHasil([]);
    } finally {
      setMemuat(false);
    }
  }, [filter]);

  // Jeda ketik — tanpa ini setiap huruf memicu satu request ke daftar
  // order yang query-nya berat (join unit/customer/revisi).
  useEffect(() => {
    if (!buka) return;
    const q = kata.trim();
    if (q.length < 2) { setHasil([]); return; }
    const t = setTimeout(() => cari(q), JEDA_KETIK_MS);
    return () => clearTimeout(t);
  }, [kata, buka, cari]);

  function pilih(order) {
    setTerpilih(order);
    setBuka(false);
    setKata("");
    onChange?.(order.id, order);
  }

  function kosongkan() {
    setTerpilih(null);
    setKata("");
    onChange?.("", null);
  }

  const daftar = kata.trim().length >= 2 ? hasil : saran;
  const judulDaftar = kata.trim().length >= 2 ? null : (saran.length > 0 ? saranLabel : null);

  return (
    <div ref={wadahRef} className={cn("relative", className)}>
      {terpilih ? (
        <div className="flex h-9 items-center justify-between gap-2 rounded-lg bg-surface px-3">
          <span className="min-w-0 truncate text-sm text-ink">
            <span className="font-medium">{terpilih.orderNumber || "(tanpa nomor)"}</span>
            {terpilih.customerName && <span className="text-ink2"> · {terpilih.customerName}</span>}
            {terpilih.value != null && <span className="text-ink3"> · {formatUang(terpilih.value)}</span>}
          </span>
          <button
            type="button" onClick={kosongkan} disabled={disabled}
            className="shrink-0 rounded-chip p-0.5 text-ink3 transition-colors hover:bg-hovertint hover:text-ink"
            aria-label="Ganti order"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <input
            type="text"
            value={kata}
            disabled={disabled}
            onFocus={() => setBuka(true)}
            onChange={(e) => { setKata(e.target.value); setBuka(true); }}
            placeholder={placeholder}
            className="h-9 w-full rounded-lg bg-surface pl-8 pr-3 text-sm text-ink placeholder:text-ink3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
          />
          {memuat && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-ink3" />}
        </div>
      )}

      {buka && !terpilih && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-[260px] overflow-y-auto rounded-lg bg-surface p-1 shadow-popover">
          {error ? (
            <p className="px-3 py-2 text-[13px] text-red">{error}</p>
          ) : kata.trim().length > 0 && kata.trim().length < 2 ? (
            <p className="px-3 py-2 text-[13px] text-ink3">Ketik minimal 2 huruf…</p>
          ) : daftar.length === 0 ? (
            <p className="px-3 py-2 text-[13px] text-ink3">
              {memuat ? "Mencari…" : kata.trim() ? "Tidak ada order yang cocok." : "Ketik nomor order atau nama pelanggan."}
            </p>
          ) : (
            <>
              {judulDaftar && (
                <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-ink3">{judulDaftar}</p>
              )}
              {daftar.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => pilih(o)}
                  className="flex w-full items-center justify-between gap-3 rounded-btn px-3 py-2 text-left transition-colors hover:bg-hovertint"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-ink">
                      {o.orderNumber || "(tanpa nomor)"}
                    </span>
                    <span className="block truncate text-[12px] text-ink3">
                      {o.customerName || "—"}
                      {o.value != null && ` · ${formatUang(o.value)}`}
                    </span>
                  </span>
                  {o.paymentStatus && (
                    <Badge variant={o.paymentStatus === "LUNAS" ? "green" : o.paymentStatus === "DP" ? "orange" : "neutral"}>
                      {o.paymentStatus === "BELUM_BAYAR" ? "Belum bayar" : o.paymentStatus}
                    </Badge>
                  )}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
