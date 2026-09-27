import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, ExternalLink, ReceiptText, XCircle } from "lucide-react";
import { Card, CardContent, CardInset } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import OrderTimelineDrawer from "@/features/orders/OrderTimelineDrawer.jsx";
import { api } from "@/api.js";
import { Uang, formatUang, JudulKartu, TombolAksi, Pilihan, InputUang, PemilihBukti, tanggalPendek } from "@/features/finance/shared.jsx";
import { PAYMENT_STATUS_LABELS } from "@/utils/format.js";
import { cn } from "@/lib/utils.js";

// KLAIM LUNAS RESI (Fase 3A) — SATU baris per Resi, bukan per order. Sales mengklaim lunas sekali di level Resi; Finance memeriksa uangnya
// lalu memverifikasi SEKALI: sistem membuat satu catatan pembayaran dan membaginya otomatis ke tiap order (pratinjau di bawah dihitung
// server; verifikasi menghitung ulang). Rincian order bisa dibuka satu per satu, tetapi verifikasi selalu di level Resi.
// Bagian ini hanya muncul bila flag server RESI_PEMBAYARAN_AKTIF menyala (server tidak mengirim `resi` bila mati).

const METODE = [["TRANSFER", "Transfer bank"], ["CASH", "Tunai"], ["QRIS", "QRIS / e-wallet"], ["CARD", "Kartu"]];
const NADA = { LUNAS: "green", DP: "orange", BELUM_BAYAR: "neutral" };
const kunciBaru = (awalan) => (globalThis.crypto?.randomUUID ? `${awalan}-${globalThis.crypto.randomUUID()}` : `${awalan}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
const hariIniISO = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

/** Pesan galat yang ramah untuk konflik yang umum (revisi data berubah di tempat lain). */
function pesanGalat(e) {
  if (e?.status === 403) return "Fitur pembayaran Resi sedang tidak aktif, atau Anda tidak punya akses.";
  if (e?.code === "TIDAK_ADA_KLAIM") return "Klaim Resi ini sudah diproses di tempat lain (diverifikasi atau ditolak). Daftar dimuat ulang.";
  if (e?.code === "TIDAK_ADA_SISA") return "Resi ini sudah lunas tercatat. Daftar dimuat ulang.";
  // VERSI_BERUBAH (exactly-once, hardening 2): request lain sudah lebih dulu memverifikasi/menolak Resi ini sejak form ini dibuka.
  if (e?.code === "VERSI_BERUBAH") return "Resi ini baru saja diproses dari tempat lain (mis. dua klik hampir bersamaan) — angkanya dimuat ulang, silakan periksa lalu kirim lagi kalau masih perlu.";
  if (e?.code === "SEBELUM_SALDO_AWAL_TIDAK_BERLAKU") return e.message;
  if (e?.code === "OVER_ALOKASI") return e.message;
  return e?.message || "Terjadi kesalahan. Coba lagi.";
}

function Angka({ label, value, tebal, tone }) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-medium uppercase tracking-wide text-ink3">{label}</p>
      <Uang value={value} className={cn("mt-0.5 block truncate text-[13.5px] tabular-nums", tebal && "font-bold", tone === "red" && "text-red")} />
    </div>
  );
}

function BarisResi({ r, onVerifikasi, onAksi, onBukaOrder }) {
  const [buka, setBuka] = useState(false);
  return (
    <li className="p-4" data-testid="resi-antrean">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-[14px] font-semibold text-ink">
            <ReceiptText size={15} className="shrink-0 text-accent" aria-hidden />
            <span className="truncate">{r.customerName}</span>
            <span className="font-mono text-[12px] font-bold text-ink2">Resi {r.anchorOrderNumber || ""}</span>
          </p>
          <p className="mt-0.5 text-[12px] text-ink3">
            {r.salesName || "Sales —"} · {r.anak.length} order ·{" "}
            {r.klaim ? `diklaim ${tanggalPendek(r.lunasSejak)}${r.klaim.oleh ? ` oleh ${r.klaim.oleh}` : ""}` : "klaim lunas per order (sebelum fitur Resi aktif)"}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {r.sumberKlaim === "PER_ORDER" && <Badge variant="orange">Klaim per order lama</Badge>}
          {r.buktiDiminta && <Badge variant="accent" title={r.buktiDiminta.catatan || undefined}>Bukti diminta {tanggalPendek(String(r.buktiDiminta.pada).slice(0, 10))}</Badge>}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Angka label="Total Resi" value={r.totalTagihan} />
        <Angka label="Ongkir Tambahan" value={r.ongkirTambahan} />
        <Angka label="Sudah Dicatat" value={r.sudahDicatat} />
        <Angka label="Perlu Dicek" value={r.sisa} tebal tone="red" />
      </div>

      <button
        type="button" onClick={() => setBuka((v) => !v)} aria-expanded={buka}
        className="mt-3 flex min-h-11 w-full items-center gap-1.5 rounded-btn px-2 text-left text-[12.5px] font-semibold text-accent hover:bg-accentbg"
      >
        {buka ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Rincian {r.anak.length} order{r.pembayaran?.length ? ` & ${r.pembayaran.length} pembayaran tercatat` : ""}
      </button>

      {buka && (
        <div className="mt-2 space-y-3">
          <ul className="divide-y divide-line overflow-hidden rounded-btn bg-inset" aria-label="Order dalam Resi">
            {r.anak.map((a) => (
              <li key={a.orderId}>
                <button type="button" onClick={() => onBukaOrder(a)} className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left hover:bg-hovertint" title="Buka rincian order">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[12px] font-bold text-ink">{a.orderNumber || "—"}</span>
                      {a.anchor && <span className="rounded bg-accentbg px-1.5 text-[10px] font-semibold text-accent">Ongkir {formatUang(a.ongkir)}</span>}
                      <Badge variant={NADA[a.paymentStatus] || "neutral"} className="text-[10.5px]">{PAYMENT_STATUS_LABELS[a.paymentStatus] || a.paymentStatus}</Badge>
                    </span>
                    <span className="mt-0.5 block text-[11.5px] tabular-nums text-ink3">Tagihan {formatUang(a.tagihan)} · dicatat {formatUang(a.dibayar)}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[10.5px] text-ink3">Sisa</span>
                    <Uang value={a.sisa} className="text-[12.5px] font-semibold tabular-nums" />
                  </span>
                  <ChevronRight size={14} className="shrink-0 text-ink3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          {r.dibatalkan?.length > 0 && <p className="text-[11.5px] text-ink3">Order dibatalkan (tidak ditagih): {r.dibatalkan.map((d) => d.orderNumber).join(", ")}</p>}
          {r.pembayaran?.length > 0 && (
            <div>
              <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-ink3">Pembayaran tercatat</p>
              <ul className="space-y-1.5">
                {r.pembayaran.map((p) => (
                  <li key={p.id} className={cn("flex flex-wrap items-center justify-between gap-2 rounded-btn bg-inset px-3 py-2 text-[12px]", p.dibatalkan && "opacity-50")}>
                    <span className="min-w-0">
                      <Uang value={p.amount} className={cn("font-semibold", p.dibatalkan && "line-through")} />
                      <span className="ml-1.5 text-ink3">
                        {METODE.find(([v]) => v === p.method)?.[1] || p.method} · {p.rekening || "rekening belum dipilih"} · {tanggalPendek(String(p.createdAt).slice(0, 10))}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {p.bukti?.url ? (
                        <a href={p.bukti.url} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1 font-semibold text-accent">
                          Bukti <ExternalLink size={12} />
                        </a>
                      ) : <span className="text-ink3">tanpa bukti</span>}
                      {p.dibatalkan ? <Badge variant="red">Dibatalkan</Badge> : p.terverifikasi ? <Badge variant="green">Terverifikasi</Badge> : <Badge variant="orange">Belum diverifikasi</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap justify-end gap-1">
        <Button size="sm" onClick={() => onVerifikasi(r)} className="max-sm:min-h-11 max-sm:flex-1" data-testid="verifikasi-resi">Verifikasi Resi</Button>
        <TombolAksi
          size="sm" variant="neutral" title="Minta Sales melampirkan bukti (hanya penanda, tidak mengubah status)"
          onClick={() => {
            const catatan = window.prompt(`Minta bukti pembayaran untuk Resi ${r.anchorOrderNumber || ""}. Catatan untuk Sales (boleh dikosongkan):`, "Mohon kirim bukti transfer/pembayaran");
            if (catatan !== null) return onAksi(() => api.mintaBuktiResi(r.groupId, catatan.trim(), kunciBaru("resi-bukti")));
          }}
        >
          Minta Bukti
        </TombolAksi>
        <TombolAksi
          size="sm" variant="neutral" title="Tolak klaim: uangnya ternyata belum masuk"
          onClick={() => {
            const alasan = window.prompt(`Tolak klaim lunas Resi ${r.anchorOrderNumber || ""}. Alasan (uangnya belum masuk)? Pembayaran yang sudah tercatat tidak ikut dihapus:`);
            if (alasan?.trim()) return onAksi(() => api.tolakLunasResi(r.groupId, alasan.trim(), kunciBaru("resi-tolak")));
          }}
        >
          <XCircle size={13} /> Tolak Klaim
        </TombolAksi>
      </div>
    </li>
  );
}

function ModalVerifikasiResi({ resi, rekening, onClose, onSelesai }) {
  // Mode uang masuk SELALU "Rekening" untuk Resi — Resi baru tidak pernah relevan dengan uang yang diterima sebelum tanggal saldo awal
  // (server juga menolaknya: kode SEBELUM_SALDO_AWAL_TIDAK_BERLAKU). Beda dari verifikasi per-order lama yang masih menawarkan dua mode.
  const [f, setF] = useState({ method: "TRANSFER", cashAccountId: "", date: "", amount: "", proofPhotoUrl: "" });
  const [pratinjau, setPratinjau] = useState(null);
  const [galatPratinjau, setGalatPratinjau] = useState(null);
  const [galat, setGalat] = useState(null);
  const [sibuk, setSibuk] = useState(false);
  const [pemicuMuatUlang, setPemicuMuatUlang] = useState(0);
  const kunci = useRef(null); // SATU kunci per dialog → klik ganda / kirim ulang tidak memverifikasi dua kali
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    if (!resi) return;
    kunci.current = kunciBaru("resi-verif");
    setF({ method: "TRANSFER", cashAccountId: "", date: resi.lunasSejak || hariIniISO(), amount: resi.sisa, proofPhotoUrl: "" });
    setGalat(null); setSibuk(false); setPratinjau(null); setPemicuMuatUlang(0);
  }, [resi]);

  // Pratinjau pembagian + `versi` (exactly-once) dari SERVER (baca-saja), dimuat ulang saat nominal berubah atau setelah VERSI_BERUBAH.
  useEffect(() => {
    if (!resi) return undefined;
    let batal = false;
    const t = setTimeout(() => {
      api.pratinjauVerifikasiResi(resi.groupId, f.amount || undefined)
        .then((p) => { if (!batal) { setPratinjau(p); setGalatPratinjau(null); } })
        .catch((e) => { if (!batal) { setPratinjau(null); setGalatPratinjau(pesanGalat(e)); } });
    }, 350);
    return () => { batal = true; clearTimeout(t); };
  }, [resi, f.amount, pemicuMuatUlang]);

  if (!resi) return null;
  const valid = Number(f.amount) > 0 && f.cashAccountId && !galatPratinjau && !!pratinjau?.versi;

  async function kirim() {
    if (sibuk) return;
    setSibuk(true); setGalat(null);
    try {
      const hasil = await api.verifikasiPenerimaanResi(resi.groupId, {
        mode: "REKENING", method: f.method, cashAccountId: f.cashAccountId,
        date: f.date || undefined, amount: Number(f.amount), proofPhotoUrl: f.proofPhotoUrl || undefined,
        versi: pratinjau?.versi, // exactly-once: dicocokkan ulang server di bawah row lock — lihat services/finance/penerimaanResi.js
      }, kunci.current);
      onSelesai(hasil.lunasPenuh ? "Resi terverifikasi lunas. Status tiap order diperbarui." : `Terverifikasi ${formatUang(hasil.amount)}. Sisanya tetap menunggu dicek.`);
    } catch (e) {
      setGalat(pesanGalat(e));
      setSibuk(false);
      // Ditolak server (4xx) = keputusan final untuk kunci ini; percobaan berikutnya adalah niat baru → kunci baru. Galat jaringan/5xx:
      // kunci DIPERTAHANKAN supaya kirim ulang diputar ulang bila server sebenarnya sudah memproses.
      if (e?.status >= 400 && e?.status < 500) kunci.current = kunciBaru("resi-verif");
      if (e?.status === 409) {
        // VERSI_BERUBAH atau TIDAK_ADA_KLAIM: sesuatu sudah berubah sejak form dibuka — muat ulang pratinjau (versi baru) SEBELUM
        // membiarkan pengguna mencoba lagi, supaya percobaan berikutnya tidak balapan melawan data yang sama-sama sudah basi.
        setPemicuMuatUlang((n) => n + 1);
        onSelesai(null, { tetapBuka: true });
      }
    }
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && !sibuk && onClose()}
      title={`Verifikasi Resi ${resi.anchorOrderNumber || ""}`}
      description={`${resi.customerName} · ${resi.anak.length} order · perlu dicek ${formatUang(resi.sisa)}`}
      className="w-[560px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} disabled={sibuk} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={kirim} disabled={!valid || sibuk} data-testid="kirim-verifikasi-resi">Verifikasi sekali untuk Resi ini</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Masuk ke rekening mana?" required>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {rekening.map((r) => (
              <button
                key={r.id} type="button" onClick={() => set("cashAccountId", r.id)}
                className={cn("flex min-h-11 items-center rounded-xl border px-3 text-left text-[13px] transition-colors",
                  f.cashAccountId === r.id ? "border-accent bg-accentbg font-semibold text-accent" : "border-line bg-surface text-ink2 hover:border-accent")}
              >
                {r.name}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Cara bayar">
            <Pilihan value={f.method} onChange={(v) => set("method", v)}>
              {METODE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Pilihan>
          </Field>
          <Field label="Tanggal uang masuk">
            <DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} />
          </Field>
        </div>
        <Field label="Nominal yang masuk" hint="Kalau uang yang masuk lebih kecil, ubah di sini — sisanya tetap menunggu dicek">
          <InputUang value={f.amount} onChange={(v) => set("amount", v)} />
        </Field>
        <Field label="Foto bukti pembayaran" hint="Salin fotonya dari WhatsApp lalu tekan Ctrl+V, atau unggah dari galeri">
          <PemilihBukti url={f.proofPhotoUrl} onChange={(v) => set("proofPhotoUrl", v)} />
        </Field>

        <CardInset className="p-3" data-testid="pratinjau-alokasi">
          <p className="mb-1.5 text-[12px] font-semibold text-ink">Pembagian otomatis ke tiap order</p>
          {galatPratinjau ? (
            <p className="text-[12px] text-red" role="alert">{galatPratinjau}</p>
          ) : !pratinjau ? (
            <p className="text-[12px] text-ink3">Menghitung…</p>
          ) : (
            <ul className="space-y-1 text-[12px]">
              {pratinjau.alokasi.map((a) => (
                <li key={a.orderId} className="flex items-center justify-between gap-2 tabular-nums">
                  <span className="font-mono font-semibold text-ink2">{a.orderNumber || "—"}</span>
                  <span className="text-ink3">sisa {formatUang(a.sisa)} →</span>
                  <Uang value={a.alokasi} className="font-semibold text-ink" />
                </li>
              ))}
              <li className="flex justify-between border-t border-line pt-1 font-semibold"><span>Total</span><Uang value={pratinjau.nominal} /></li>
            </ul>
          )}
          <p className="mt-1.5 text-[11px] text-ink3">Angka dihitung server dan dihitung ulang saat disimpan.</p>
        </CardInset>
        {galat && <p className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red" role="alert">{galat}</p>}
      </div>
    </Modal>
  );
}

/** Bagian antrean Resi di halaman Klaim Lunas. `items` = data.resi dari server (tidak ada bila flag mati → komponen tidak dirender). */
export default function KlaimLunasResi({ items, ringkas, rekening, onBerubah }) {
  const [modal, setModal] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [timelineOrder, setTimelineOrder] = useState(null);

  async function aksi(fn) {
    try {
      await fn();
      setPesan({ ok: true, teks: "Tersimpan." });
    } catch (e) {
      setPesan({ ok: false, teks: pesanGalat(e) });
    }
    await onBerubah?.();
  }

  async function bukaOrder(a) {
    try {
      const { items: hasil } = await api.getOrders({ search: a.orderNumber });
      const o = hasil?.find((x) => x.id === a.orderId);
      if (o) setTimelineOrder(o);
      else setPesan({ ok: false, teks: `Order ${a.orderNumber} tidak ditemukan.` });
    } catch (e) {
      setPesan({ ok: false, teks: e.message || "Gagal membuka order" });
    }
  }

  return (
    <>
      {pesan && (
        <Card className={cn("p-0", pesan.ok ? "bg-greenbg" : "bg-redbg")}>
          <CardContent className="flex items-center justify-between gap-3 px-4 py-3">
            <p className={cn("text-[13px]", pesan.ok ? "text-green" : "text-ink")} role="status">{pesan.teks}</p>
            <Button size="sm" variant="neutral" onClick={() => setPesan(null)}>Tutup</Button>
          </CardContent>
        </Card>
      )}
      <Card className="overflow-hidden p-0" data-testid="antrean-resi">
        <div className="p-6 pb-2">
          <JudulKartu
            title={`Klaim Lunas Resi${items.length ? ` · ${items.length}` : ""}`}
            description={items.length ? `Total perlu dicek ${formatUang(items.reduce((s, i) => s + i.sisa, 0))} — satu verifikasi per Resi` : "Satu verifikasi per Resi"}
            info="Sales mengklaim lunas sekali untuk seluruh order dalam Resi. Verifikasi di sini membuat satu catatan pembayaran dan membaginya otomatis ke tiap order."
          />
        </div>
        {items.length === 0 ? (
          <CardContent className="px-6 pb-6">
            <EmptyState icon={CheckCircle2} title="Tidak ada klaim Resi yang menunggu" description={ringkas ? "" : "Semua Resi yang diklaim lunas oleh Sales sudah dicek uang masuknya."} />
          </CardContent>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((r) => <BarisResi key={r.groupId} r={r} onVerifikasi={setModal} onAksi={aksi} onBukaOrder={bukaOrder} />)}
          </ul>
        )}
      </Card>
      <ModalVerifikasiResi
        resi={modal} rekening={rekening} onClose={() => setModal(null)}
        onSelesai={async (teks, opsi) => {
          if (!opsi?.tetapBuka) { setModal(null); setPesan({ ok: true, teks }); }
          await onBerubah?.();
        }}
      />
      <OrderTimelineDrawer order={timelineOrder} onClose={() => setTimelineOrder(null)} />
    </>
  );
}
