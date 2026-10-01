import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ExternalLink, ChevronRight } from "lucide-react";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { formatRupiah } from "@/utils/format.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import { toApiParams } from "@/lib/dateRange.js";
import { isAdminUser } from "@/lib/roles.js";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import KpiCard from "./KpiCard.jsx";
import ChartCard from "./ChartCard.jsx";

// ═══ REKONSILIASI SALES–FINANCE (30 Sep 2026) ═══════════════════════════════════════════════════════
// SEMUA angka dari server (services/finance/rekonSalesFinance.js — SATU helper yang juga dipakai Finance & Export Excel). Komponen ini TIDAK
// menghitung ulang: hanya menampilkan baris bridge, kartu, dan daftar order penyusun yang dikirim server.
//
// Klik baris bridge → daftar order penyusunnya (hanya bila server mengirim detail: Finance/Admin). Sales hanya melihat angka.

const tanggal = (d) => (d ? formatTanggalPendek(d) : "—");
/** Rupiah bertanda: negatif tampil "−Rp8.070.000" (bukan "Rp-8.070.000"). */
const rpBertanda = (n) => (n < 0 ? `−${formatRupiah(Math.abs(n))}` : formatRupiah(n));
const JENIS = { TRANSFER: "Transfer", CASH: "Tunai", QRIS: "QRIS", CARD: "Kartu" };

function currentUser() {
  try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; }
}

/** Ambil & simpan rekonsiliasi untuk periode laporan; `onData` meneruskan payload ke pemanggil (dipakai Export Excel). */
export function useRekonSalesFinance(range, onData) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const kunci = JSON.stringify(toApiParams(range));
  const [versi, setVersi] = useState(0);
  useEffect(() => {
    let batal = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.getRekonSalesFinance(toApiParams(range))
      .then((data) => { if (!batal) { setState({ loading: false, data, error: null }); onData?.(data); } })
      .catch((e) => { if (!batal) { setState({ loading: false, data: null, error: e.message || "Gagal memuat" }); onData?.(null); } });
    return () => { batal = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kunci, versi]);
  return { ...state, muatUlang: () => setVersi((v) => v + 1) };
}

/** Empat kartu terpisah (permintaan Owner): uang masuk dari order, DP belum lunas, ongkir diterima, tanpa atribusi Sales. */
export function KartuRekon({ data, loading, onBuka }) {
  const k = data?.kartu;
  const bisaBuka = !!data?.detailTersedia;
  const kartu = [
    { kunci: "UANG_MASUK", label: "Uang Masuk Terverifikasi dari Order", nilai: k?.uangMasukDariOrder, sub: "Payment terverifikasi yang diterima di periode ini", tip: "Total Payment aktif yang sudah diverifikasi Finance dan diterima pada periode ini, per order. Ini sisi uang (Finance) — belum tentu sama dengan Nilai Order yang Menjadi Lunas." },
    { kunci: "DP_BELUM_LUNAS", label: "DP Belum Lunas", nilai: k?.dpBelumLunas, sub: k ? `${k.jumlahOrderDp} order belum lunas` : "", tip: "Uang muka/DP terverifikasi untuk order yang belum lunas. Sudah masuk Uang Masuk tetapi belum masuk Nilai Order yang Menjadi Lunas sampai total pembayaran memenuhi tagihan." },
    { kunci: "ONGKIR", label: "Ongkir Diterima", nilai: k?.ongkirDiterima, sub: "ikut Payment, bukan nilai jasa/order", tip: "Bagian Payment yang menutup ongkir. Basis komisi Sales tetap nilai jasa/order tanpa ongkir." },
    { kunci: "TANPA_SALES", label: "Tanpa Atribusi Sales", nilai: k?.tanpaAtribusiSales, sub: k ? `${k.jumlahOrderTanpaSales} order · tetap masuk total perusahaan` : "", tip: "Order lunas yang tidak dimiliki Sales mana pun (order internal / pelanggan di luar percakapan Sales). TIDAK diberikan ke Sales secara tebakan; tetap dihitung di total perusahaan." },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy={loading}>
      {kartu.map((c, i) => (
        <div key={c.kunci} className={cn(bisaBuka && c.nilai ? "cursor-pointer" : "")} onClick={() => bisaBuka && c.nilai && onBuka(c.kunci)} role={bisaBuka && c.nilai ? "button" : undefined}>
          <KpiCard index={i} label={c.label} numericValue={c.nilai || 0} format={(v) => (k ? formatRupiah(Math.round(v)) : "—")} sub={c.sub} tooltip={c.tip} />
        </div>
      ))}
    </div>
  );
}

/** Panel bridge: Uang Masuk Terverifikasi → Nilai Order yang Menjadi Lunas. */
export function PanelRekon({ data, loading, error, onBuka }) {
  const bisaBuka = !!data?.detailTersedia;
  return (
    <ChartCard
      index={2}
      title="Rekonsiliasi Sales–Finance"
      description="Dari Uang Masuk Terverifikasi (Finance) ke Nilai Order yang Menjadi Lunas (Sales) — angka dari server, sama dengan yang dipakai Finance."
      empty={error ? `Gagal memuat rekonsiliasi: ${error}` : null}
    >
      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 py-6 text-[13px] text-ink3"><Loader2 size={16} className="animate-spin" /> Memuat…</div>
      ) : data ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <tbody>
              {data.bridge.map((b) => {
                const hasil = ["TOTAL_PERUSAHAAN", "NILAI_LUNAS_SALES"].includes(b.kunci);
                const awal = b.kunci === "UANG_MASUK";
                const bisa = bisaBuka && b.nOrder > 0;
                // EFEK langkah terhadap angka berjalan = tanda × jumlah. Langkah "kurangi" yang jumlahnya NEGATIF (mis. Selisih Nominal Lain: Lunas menurut Sales
                // tanpa uang terverifikasi penuh) justru MENAMBAH — tampilannya harus "+", bukan "−" (ditemukan saat QA visual 1 Okt 2026).
                const efek = b.tanda * b.jumlah;
                const tampil = b.tanda === 0 || b.jumlah === 0 ? formatRupiah(b.jumlah) : `${efek < 0 ? "−" : "+"} ${formatRupiah(Math.abs(efek))}`;
                return (
                  <tr
                    key={b.kunci}
                    className={cn("border-b border-line last:border-0", hasil && "bg-inset font-bold", awal && "font-semibold", bisa && "cursor-pointer hover:bg-hovertint")}
                    onClick={bisa ? () => onBuka(b.kunci) : undefined}
                    role={bisa ? "button" : undefined}
                    tabIndex={bisa ? 0 : undefined}
                    onKeyDown={bisa ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onBuka(b.kunci); } } : undefined}
                  >
                    <td className="py-2 pl-2 pr-3">
                      <span className="block">{b.label}</span>
                      <span className="block text-[11px] font-normal text-ink3">{b.keterangan}</span>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-2 text-right tabular-nums text-ink3">{b.nOrder > 0 ? `${b.nOrder} order` : ""}</td>
                    <td className={cn("whitespace-nowrap py-2 pr-2 text-right tabular-nums", b.tanda !== 0 && efek < 0 && "text-red", b.tanda !== 0 && efek > 0 && "text-green")}>{tampil}</td>
                    <td className="w-5 py-2 pr-1 text-ink3">{bisa ? <ChevronRight size={14} aria-hidden /> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.residual !== 0 && (
            <p className="mt-2 rounded-btn bg-redbg px-3 py-2 text-[12px] text-red" role="alert">Bridge belum menutup: selisih {formatRupiah(data.residual)}. Hubungi admin — angka ini seharusnya nol.</p>
          )}
          {!bisaBuka && <p className="mt-2 text-[11.5px] text-ink3">Daftar order penyusun hanya tampil untuk Finance dan Admin.</p>}
        </div>
      ) : null}
    </ChartCard>
  );
}

const JUDUL_DETAIL = {
  UANG_MASUK: "Uang Masuk Terverifikasi", DP_BELUM_LUNAS: "DP / Parsial Belum Lunas", ORDER_TIDAK_DIHITUNG: "Order Batal / Pending / Spam",
  LUNAS_PERIODE_LAIN: "Pembayaran untuk Order Lunas di Periode Lain", REFUND_NON_LUNAS: "Refund pada Order yang Kembali Belum Lunas",
  DP_SEBELUMNYA: "DP Periode Sebelumnya", REFUND_LUNAS: "Penyesuaian Refund / Reversal", ONGKIR: "Ongkir Diterima", SELISIH_LAIN: "Selisih Nominal Lain",
  TANPA_SALES: "Tanpa Atribusi Sales", DIHITUNG_GANDA: "Dihitung Ganda (dipegang >1 Sales)",
};

/** Daftar order penyusun satu baris bridge. Multi-order pelanggan yang sama dikelompokkan (TIDAK digabung / dianggap duplikat). */
export function DaftarRekonModal({ kunci, data, onClose, onDitetapkan }) {
  const navigate = useNavigate();
  const admin = useMemo(() => isAdminUser(currentUser()), []);
  const baris = kunci ? (data?.detail?.[kunci] ?? []) : [];
  const [salesAktif, setSalesAktif] = useState(null);
  const [tetapkan, setTetapkan] = useState(null); // { order, userId, alasan, sibuk, galat }

  const kelompok = useMemo(() => {
    const peta = new Map();
    for (const b of baris) {
      if (!peta.has(b.pelanggan)) peta.set(b.pelanggan, []);
      peta.get(b.pelanggan).push(b);
    }
    return [...peta.entries()].map(([pelanggan, items]) => ({ pelanggan, items, jumlah: items.reduce((s, x) => s + x.jumlah, 0) }));
  }, [baris]);

  async function bukaTetapkan(order) {
    setTetapkan({ order, userId: "", alasan: "", sibuk: false, galat: null });
    if (!salesAktif) { try { setSalesAktif((await api.getSalesFinanceSalesAktif()).sales || []); } catch { setSalesAktif([]); } }
  }
  async function simpanTetapkan() {
    setTetapkan((t) => ({ ...t, sibuk: true, galat: null }));
    try {
      await api.tetapkanPemilikSalesOrder(tetapkan.order.orderId, { userId: tetapkan.userId || null, alasan: tetapkan.alasan });
      setTetapkan(null);
      onDitetapkan?.();
    } catch (e) {
      setTetapkan((t) => ({ ...t, sibuk: false, galat: e.message }));
    }
  }

  return (
    <>
      <Modal open={!!kunci} onOpenChange={(v) => { if (!v) onClose(); }} title={kunci ? JUDUL_DETAIL[kunci] : ""} description={kunci ? `${baris.length} order · ${rpBertanda(baris.reduce((s, b) => s + b.jumlah, 0))}` : ""} className="w-[860px]">
        {baris.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-ink3">Tidak ada order pada baris ini.</p>
        ) : (
          <>
          {/* Layar lebar: tabel. Layar sempit (HP, 390px): tabel 6 kolom terpotong, jadi diganti daftar kartu per order (QA visual 1 Okt 2026). */}
          <div className="hidden max-h-[60vh] overflow-auto sm:block">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink3">
                  <th className="pb-2 pr-2 font-medium">Order</th>
                  <th className="pb-2 pr-2 text-right font-medium">Nilai Jasa</th>
                  <th className="pb-2 pr-2 text-right font-medium">Ongkir</th>
                  <th className="pb-2 pr-2 text-right font-medium">Total Tagihan</th>
                  <th className="pb-2 pr-2 text-right font-medium">Jumlah</th>
                  <th className="pb-2 font-medium">Payment</th>
                </tr>
              </thead>
              <tbody>
                {kelompok.map((g) => (
                  <React.Fragment key={g.pelanggan}>
                    {(kelompok.length > 1 || g.items.length > 1) && (
                      <tr className="bg-inset">
                        <td colSpan={6} className="px-2 py-1.5 text-[12px] font-semibold text-ink">
                          {g.pelanggan}
                          {g.items.length > 1 && <span className="ml-2 font-normal text-ink3">{g.items.length} order pelanggan yang sama · {rpBertanda(g.jumlah)} — data terpisah, tidak digabung</span>}
                        </td>
                      </tr>
                    )}
                    {g.items.map((b) => (
                      <tr key={`${b.orderId}-${b.jumlah}`} className="border-b border-line align-top last:border-0">
                        <td className="py-2 pr-2">
                          <button type="button" className="inline-flex items-center gap-1 font-mono text-[12px] text-ink hover:text-accent hover:underline" onClick={() => navigate(`/orders?id=${b.orderId}`)} title="Buka order">
                            {b.nomor} <ExternalLink size={10} />
                          </button>
                          {kelompok.length === 1 && g.items.length === 1 && <div className="text-[11px] text-ink3">{b.pelanggan}</div>}
                          <div className="text-[11px] text-ink3">{b.statusBayar} · {b.status}{b.alasan ? ` · ${b.alasan}` : ""}{b.pemegangInformasi ? ` · dipegang ${b.pemegangInformasi}` : ""}{b.sales ? ` · ${b.sales.join(", ")}` : ""}</div>
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums">{formatRupiah(b.nilaiJasa)}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{b.ongkir ? formatRupiah(b.ongkir) : "—"}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{formatRupiah(b.totalTagihan)}</td>
                        <td className={cn("py-2 pr-2 text-right font-semibold tabular-nums", b.jumlah < 0 && "text-red")}>{rpBertanda(b.jumlah)}</td>
                        <td className="py-2 text-[11.5px] text-ink2">
                          {(b.pembayaran || []).length === 0 ? <span className="text-ink3">—</span> : b.pembayaran.map((p) => (
                            <div key={`${p.id}-${p.nominal}`}>{tanggal(p.tanggal)} · {formatRupiah(p.nominal)} · {JENIS[p.metode] || p.metode}</div>
                          ))}
                          {typeof b.dibayarTotal === "number" && <div className="text-ink3">Total dibayar {formatRupiah(b.dibayarTotal)} · sisa {formatRupiah(b.sisaTagihan)}</div>}
                          {kunci === "TANPA_SALES" && admin && (
                            <Button size="sm" variant="neutral" className="mt-1" onClick={() => bukaTetapkan(b)}>Tetapkan Sales</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex max-h-[60vh] flex-col gap-2 overflow-auto sm:hidden" data-testid="rekon-kartu-mobile">
            {kelompok.map((g) => (
              <React.Fragment key={g.pelanggan}>
                {(kelompok.length > 1 || g.items.length > 1) && (
                  <div className="rounded-lg bg-inset px-2.5 py-1.5 text-[12px] font-semibold text-ink">
                    {g.pelanggan}
                    {g.items.length > 1 && <span className="block text-[11px] font-normal text-ink3">{g.items.length} order pelanggan yang sama · {rpBertanda(g.jumlah)} — data terpisah, tidak digabung</span>}
                  </div>
                )}
                {g.items.map((b) => (
                  <div key={`${b.orderId}-${b.jumlah}`} className="rounded-xl border border-line p-3">
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" className="inline-flex min-h-8 items-center gap-1 text-left font-mono text-[12.5px] text-ink hover:text-accent" onClick={() => navigate(`/orders?id=${b.orderId}`)} title="Buka order">
                        {b.nomor} <ExternalLink size={10} />
                      </button>
                      <span className={cn("shrink-0 text-[13px] font-semibold tabular-nums", b.jumlah < 0 && "text-red")}>{rpBertanda(b.jumlah)}</span>
                    </div>
                    {kelompok.length === 1 && g.items.length === 1 && <div className="text-[11.5px] text-ink2">{b.pelanggan}</div>}
                    <div className="text-[11px] text-ink3">{b.statusBayar} · {b.status}{b.alasan ? ` · ${b.alasan}` : ""}{b.pemegangInformasi ? ` · dipegang ${b.pemegangInformasi}` : ""}{b.sales ? ` · ${b.sales.join(", ")}` : ""}</div>
                    <dl className="m-0 mt-2 grid grid-cols-3 gap-2 text-[11.5px]">
                      <div className="min-w-0"><dt className="text-ink3">Nilai Jasa</dt><dd className="m-0 tabular-nums">{formatRupiah(b.nilaiJasa)}</dd></div>
                      <div className="min-w-0"><dt className="text-ink3">Ongkir</dt><dd className="m-0 tabular-nums">{b.ongkir ? formatRupiah(b.ongkir) : "—"}</dd></div>
                      <div className="min-w-0"><dt className="text-ink3">Total Tagihan</dt><dd className="m-0 tabular-nums">{formatRupiah(b.totalTagihan)}</dd></div>
                    </dl>
                    <div className="mt-2 text-[11.5px] text-ink2">
                      {(b.pembayaran || []).length === 0 ? <span className="text-ink3">Payment: —</span> : b.pembayaran.map((p) => (
                        <div key={`${p.id}-${p.nominal}`}>{tanggal(p.tanggal)} · {formatRupiah(p.nominal)} · {JENIS[p.metode] || p.metode}</div>
                      ))}
                      {typeof b.dibayarTotal === "number" && <div className="text-ink3">Total dibayar {formatRupiah(b.dibayarTotal)} · sisa {formatRupiah(b.sisaTagihan)}</div>}
                      {kunci === "TANPA_SALES" && admin && (
                        <Button size="sm" variant="neutral" className="mt-1" onClick={() => bukaTetapkan(b)}>Tetapkan Sales</Button>
                      )}
                    </div>
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>
          </>
        )}
        <div className="mt-3 flex justify-end">
          <button type="button" className="text-[12px] text-accent hover:underline" onClick={() => navigate("/finance/payments")}>Buka Pembayaran & Verifikasi</button>
        </div>
      </Modal>

      <Modal
        open={!!tetapkan} onOpenChange={(v) => { if (!v) setTetapkan(null); }} title="Tetapkan Pemilik Sales"
        description={tetapkan ? `${tetapkan.order.nomor} · ${tetapkan.order.pelanggan}` : ""} className="w-[440px]"
        footer={(
          <>
            <Button variant="neutral" onClick={() => setTetapkan(null)}>Batal</Button>
            <Button onClick={simpanTetapkan} disabled={!tetapkan || tetapkan.sibuk || !tetapkan.alasan.trim() || !tetapkan.userId}>{tetapkan?.sibuk ? "Menyimpan…" : "Simpan"}</Button>
          </>
        )}
      >
        {tetapkan && (
          <div className="space-y-3 text-[13px]">
            <p className="rounded-lg bg-inset px-3 py-2 text-[12px] text-ink2">Penugasan ulang bersifat eksplisit dan tercatat di riwayat order. Order ini akan masuk laporan Sales yang dipilih.</p>
            <label className="block">
              <span className="mb-1 block text-[12px] text-ink3">Sales pemilik</span>
              <select className="h-9 w-full rounded-lg bg-inset px-2.5" value={tetapkan.userId} onChange={(e) => setTetapkan((t) => ({ ...t, userId: e.target.value }))}>
                <option value="">Pilih Sales…</option>
                {(salesAktif || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] text-ink3">Alasan (wajib)</span>
              <textarea className="w-full rounded-lg bg-inset px-2.5 py-2" rows={2} maxLength={300} value={tetapkan.alasan} onChange={(e) => setTetapkan((t) => ({ ...t, alasan: e.target.value }))} placeholder="mis. Order KML dipegang Kiki" />
            </label>
            {tetapkan.galat && <p className="text-[12px] text-red" role="alert">{tetapkan.galat}</p>}
          </div>
        )}
      </Modal>
    </>
  );
}
