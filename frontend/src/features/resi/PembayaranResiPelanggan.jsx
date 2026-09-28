import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, ChevronRight, Clock, Loader2, ReceiptText } from "lucide-react";
import { Card, CardInset } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { api } from "@/api.js";
import { formatRupiah, PAYMENT_STATUS_LABELS } from "@/utils/format.js";
import { cn } from "@/lib/utils.js";
import { rolesOf } from "@/lib/roles.js";

// Fase 3B ("Batalkan item dari Resi") hanya untuk Finance/Admin/Owner (server: P.FINANCE_POST) — pengecekan di sini MURNI UX (sembunyikan
// tombol untuk role yang pasti akan ditolak server), server tetap satu-satunya penegak sesungguhnya.
function bisaBatalkanItemResi() {
  try {
    const user = JSON.parse(localStorage.getItem("user") || "null");
    return rolesOf(user).some((r) => ["FINANCE", "ADMIN", "OWNER"].includes(r));
  } catch { return false; }
}
const kunciBaru = (awalan) => (globalThis.crypto?.randomUUID ? `${awalan}-${globalThis.crypto.randomUUID()}` : `${awalan}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

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

function KartuResi({ r, onBukaOrder, onKlaim, onBatalkanItem, pembatalanAktif }) {
  const st = statusResi(r);
  const anchor = r.anak.find((a) => a.anchor);
  const bisaBatal = pembatalanAktif && bisaBatalkanItemResi();
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
          <li key={a.orderId} className="flex items-center">
            <button
              type="button" onClick={() => onBukaOrder?.(a.orderId)}
              className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-hovertint"
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
            {bisaBatal && (
              <button
                type="button" onClick={() => onBatalkanItem?.(a)}
                title="Batalkan item ini dari Resi"
                className="mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink3 transition-colors hover:bg-redbg hover:text-red"
                data-testid={`batalkan-item-${a.orderId}`}
              >
                <Ban size={15} />
              </button>
            )}
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
 * Fase 3B — "Batalkan item dari Resi": pratinjau dampak (realokasi, kelebihan/refund, anchor baru, ongkir, total & DP baru) SEBELUM konfirmasi.
 * Server menghitung semuanya; komponen ini hanya menampilkan. Rekening refund WAJIB kalau ada kelebihan yang tidak tertampung child aktif lain.
 */
function ModalBatalkanItem({ item, rekening, onClose, onSelesai }) {
  const [pratinjau, setPratinjau] = useState(null);
  const [galatPratinjau, setGalatPratinjau] = useState(null);
  const [alasan, setAlasan] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState(null);
  const kunci = useRef(null);

  useEffect(() => {
    if (!item) return;
    kunci.current = kunciBaru("resi-batal");
    setAlasan(""); setCashAccountId(""); setGalat(null); setSibuk(false); setPratinjau(null); setGalatPratinjau(null);
    api.getPratinjauPembatalanResi(item.orderId)
      .then(setPratinjau)
      .catch((e) => setGalatPratinjau(e.message || "Gagal memuat pratinjau pembatalan"));
  }, [item]);

  if (!item) return null;
  const perluRekening = (pratinjau?.kelebihan ?? 0) > 0;
  const valid = alasan.trim().length > 0 && !!pratinjau && !galatPratinjau && (!perluRekening || cashAccountId);

  async function kirim() {
    if (sibuk || !valid) return;
    setSibuk(true); setGalat(null);
    try {
      const hasil = await api.batalkanItemResi(item.orderId, {
        alasan: alasan.trim(), refundCashAccountId: perluRekening ? cashAccountId : undefined, versi: pratinjau.versi,
      }, kunci.current);
      const teks = hasil.kelebihan > 0
        ? `Item dibatalkan. ${formatRupiah(hasil.totalDirealokasikan)} dipindah ke order lain, ${formatRupiah(hasil.kelebihan)} menunggu persetujuan refund.`
        : hasil.totalDirealokasikan > 0
          ? `Item dibatalkan. ${formatRupiah(hasil.totalDirealokasikan)} dipindah ke order aktif lain.`
          : "Item dibatalkan.";
      onSelesai(teks);
    } catch (e) {
      setGalat(e.message || "Pembatalan gagal dikirim. Coba lagi.");
      setSibuk(false);
      if (e.status >= 400 && e.status < 500) kunci.current = kunciBaru("resi-batal");
      if (e.status === 409) onSelesai(null, { tetapBuka: true });
    }
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && !sibuk && onClose()}
      title={`Batalkan ${item.orderNumber || "item"} dari Resi`}
      className="w-[520px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} disabled={sibuk} className="max-sm:min-h-11">Batal</Button>
          <Button onClick={kirim} disabled={!valid || sibuk} className="max-sm:min-h-11" data-testid="konfirmasi-batalkan-item">
            {sibuk && <Loader2 size={14} className="animate-spin" />} Ya, batalkan item ini
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        {galatPratinjau ? (
          <p className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red" role="alert">{galatPratinjau}</p>
        ) : !pratinjau ? (
          <p className="text-ink3">Menghitung dampak…</p>
        ) : (
          <>
            <CardInset className="space-y-1.5 p-3 text-[12.5px]">
              <div className="flex justify-between"><span className="text-ink3">Tagihan item ini</span><span className="font-semibold tabular-nums">{formatRupiah(pratinjau.tagihanChild)}</span></div>
              <div className="flex justify-between"><span className="text-ink3">Sudah dibayar (teralokasi)</span><span className="font-semibold tabular-nums">{formatRupiah(pratinjau.dibayarChild)}</span></div>
              {pratinjau.totalDirealokasikan > 0 && (
                <div className="flex justify-between text-green"><span>Dipindah ke order lain</span><span className="font-semibold tabular-nums">{formatRupiah(pratinjau.totalDirealokasikan)}</span></div>
              )}
              {pratinjau.kelebihan > 0 && (
                <div className="flex justify-between text-orange"><span>Kelebihan (jadi refund)</span><span className="font-semibold tabular-nums">{formatRupiah(pratinjau.kelebihan)}</span></div>
              )}
            </CardInset>

            {pratinjau.realokasi?.length > 0 && (
              <div>
                <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-ink3">Dipindahkan ke</p>
                <ul className="space-y-1">
                  {pratinjau.realokasi.map((r) => (
                    <li key={r.orderId} className="flex justify-between rounded-btn bg-inset px-3 py-1.5 tabular-nums">
                      <span className="font-mono font-semibold text-ink2">{r.orderNumber}</span>
                      <span className="font-semibold text-green">+{formatRupiah(r.tambahan)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {pratinjau.isAnchor && (
              <p className="flex items-start gap-1.5 rounded-btn bg-accentbg px-3 py-2 text-[12px] text-accent">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                {pratinjau.anchorBaru
                  ? <span>Item ini ongkir tambahannya ({formatRupiah(pratinjau.ongkirDipindah)}) — akan dipindah ke <strong>{pratinjau.anchorBaru.orderNumber}</strong> yang jadi anchor baru Resi ini.</span>
                  : <span>Ini item TERAKHIR di Resi ini — setelah dibatalkan, Resi akan kosong (tidak ada order aktif tersisa).</span>}
              </p>
            )}
            {pratinjau.pendapatanSudahDiakui && (
              <p className="rounded-btn bg-orangebg px-3 py-2 text-[12px] text-orange">
                Pendapatan item ini sudah diakui (order sudah terkirim) — refund akan dicatat sebagai Retur &amp; Potongan Penjualan, bukan Uang Muka.
              </p>
            )}
            {!pratinjau.grupKosong && (
              <p className="text-[11.5px] text-ink3">Total Resi baru {formatRupiah(pratinjau.totalResiBaru)} · DP baru {formatRupiah(pratinjau.dpTargetBaru)}</p>
            )}

            {perluRekening && (
              <Field label="Rekening sumber pengembalian" required>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {rekening.map((r) => (
                    <button
                      key={r.id} type="button" onClick={() => setCashAccountId(r.id)}
                      className={cn("flex min-h-11 items-center rounded-xl border px-3 text-left text-[13px] transition-colors",
                        cashAccountId === r.id ? "border-accent bg-accentbg font-semibold text-accent" : "border-line bg-surface text-ink2 hover:border-accent")}
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
              </Field>
            )}

            <Field label="Alasan pembatalan" required>
              <textarea
                value={alasan} onChange={(e) => setAlasan(e.target.value)} rows={2} maxLength={500}
                placeholder="Mis. customer batalkan 1 item, salah input jumlah, dst."
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
              />
            </Field>
          </>
        )}
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
  const [batalItem, setBatalItem] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [pembatalanAktif, setPembatalanAktif] = useState(false);
  const [rekening, setRekening] = useState([]);

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
  // Fase 3B: status flag + daftar rekening (hanya untuk role yang berhak — Sales tidak dapat FINANCE_READ, jangan minta rekening untuknya).
  useEffect(() => {
    api.getResiStatus().then((s) => setPembatalanAktif(!!s?.pembatalanAktif)).catch(() => setPembatalanAktif(false));
    if (bisaBatalkanItemResi()) {
      api.getFinanceCashAccounts().then((r) => setRekening((r.accounts || []).filter((a) => a.active))).catch(() => setRekening([]));
    }
  }, []);

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
      {resi.map((r) => (
        <KartuResi key={r.groupId} r={r} onBukaOrder={onBukaOrder} onKlaim={setKlaim} onBatalkanItem={setBatalItem} pembatalanAktif={pembatalanAktif} />
      ))}
      <ModalKlaim
        resi={klaim} onClose={() => setKlaim(null)}
        onSelesai={async (teks) => { setKlaim(null); setPesan(teks); await muat(); onBerubah?.(); }}
      />
      <ModalBatalkanItem
        item={batalItem} rekening={rekening} onClose={() => setBatalItem(null)}
        onSelesai={async (teks, opsi) => {
          if (!opsi?.tetapBuka) { setBatalItem(null); if (teks) setPesan(teks); }
          await muat(); onBerubah?.();
        }}
      />
    </div>
  );
}
