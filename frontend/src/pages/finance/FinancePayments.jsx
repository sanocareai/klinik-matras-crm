import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, Image as ImageIcon, Split } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TABLE_VIEW_CLASS, CARD_VIEW_CLASS } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import OrderPicker from "@/features/finance/OrderPicker.jsx";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, TombolAksi,
  PeriodePicker, periodeDefault, tanggalJam, InputUang,
} from "@/features/finance/shared.jsx";
import FilterBar, { cocok } from "@/features/finance/FilterBar.jsx";
import LunasBelumDicatat from "@/features/finance/LunasBelumDicatat.jsx";
import { RowActions, AKSI_COL_WIDTH } from "@/features/finance/RowActions.jsx";
import { BuktiThumb } from "@/features/finance/BuktiThumb.jsx";
import { CardList, RowCard } from "@/features/finance/cards.jsx";

// Aksi PALING RELEVAN jadi tombol utama; "Bagi pembayaran" masuk menu
// titik-tiga — foto bukti PISAH ke kolomnya sendiri (BuktiThumb), bukan
// ikut jadi tombol di kolom Aksi.
function aksiPembayaran(p, { verifikasi, setAlokasiUntuk }) {
  const items = [
    !p.cancelledAt && { key: "alokasi", label: "Bagi ke beberapa order", icon: Split, onClick: () => setAlokasiUntuk(p) },
  ].filter(Boolean);
  if (!p.cancelledAt && !p.terverifikasi) {
    return { primary: { label: "Verifikasi", variant: "secondary", onClick: () => verifikasi(p) }, items };
  }
  return { primary: null, items };
}

// PEMBAYARAN PELANGGAN & VERIFIKASI.
//
// Halaman ini TIDAK mencatat pembayaran baru — itu tetap dikerjakan sales
// (saat konfirmasi order) dan driver (di stop pengiriman), di tempat mereka
// masing-masing. Di sini finance MENCOCOKKAN uang yang tercatat dengan
// setoran yang benar-benar diterima, dan kalau perlu memecah satu
// pembayaran ke beberapa order.
//
// Verifikasi memakai endpoint LAMA (POST /armada/payments/:id/verify) yang
// sudah dipakai sejak D-011 — tidak dibuatkan jalur kedua, supaya tidak ada
// dua cara memverifikasi hal yang sama.

// "Perlu Verifikasi Finance" = klaim Lunas dari Sales (flag order di CRM, BELUM ada Payment) + pembayaran tercatat yang belum diverifikasi.
// Dulu "Ditandai Lunas oleh Sales" dan "Menunggu Verifikasi" terpisah dan membaca sumber berbeda, sehingga tab kedua bisa kosong padahal ada yang harus dicek.
const TAB = [
  { key: "perlu", label: "Perlu Verifikasi Finance" },
  { key: "lunas_crm", label: "Klaim Lunas dari Sales" },
  { key: "terverifikasi", label: "Uang Masuk Terverifikasi" },
  { key: "dibatalkan", label: "Dibatalkan" },
  { key: "", label: "Semua" },
];

const LABEL_CARA_BAYAR = { TRANSFER: "Transfer", CASH: "Tunai", QRIS: "QRIS", CARD: "Kartu" };

export default function FinancePayments() {
  const [tab, setTab] = useState("perlu");
  const [periode, setPeriode] = useState(periodeDefault);
  const [data, setData] = useState(null);
  const [semuaPeriode, setSemuaPeriode] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [alokasiUntuk, setAlokasiUntuk] = useState(null);
  const [fotoBukti, setFotoBukti] = useState(null);
  const [q, setQ] = useState("");
  const [fMetode, setFMetode] = useState("");
  const [fVerif, setFVerif] = useState("");
  const [fAlokasi, setFAlokasi] = useState("");
  const [fBukti, setFBukti] = useState("");

  const muat = useCallback(async () => {
    // Tab "Lunas di CRM" memuat datanya sendiri (LunasBelumDicatat).
    if (tab === "lunas_crm") {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Kartu angka di atas selalu menghitung SEMUA pembayaran periode ini, apa pun tab yang dibuka.
      const [tabData, semua] = await Promise.all([
        api.getFinanceCustomerPayments({ ...periode, status: tab === "perlu" ? "belum_verifikasi" : tab }),
        tab === "" ? null : api.getFinanceCustomerPayments({ ...periode, status: "" }),
      ]);
      setData(tabData);
      setSemuaPeriode((semua || tabData).payments || []);
    } catch (e) {
      setError(e.message || "Gagal memuat pembayaran");
    } finally {
      setLoading(false);
    }
  }, [periode, tab]);

  useEffect(() => { muat(); }, [muat]);

  async function verifikasi(p) {
    try {
      await api.verifyPayment(p.id);
      await muat();
    } catch (e) {
      setPesan(e.message);
    }
  }

  const payments = data?.payments || [];
  const aktif = semuaPeriode.filter((p) => !p.cancelledAt);
  const jumlahRp = (arr) => arr.reduce((s, p) => s + (p.amount || 0), 0);
  const sudahList = aktif.filter((p) => p.terverifikasi);
  const belumList = aktif.filter((p) => !p.terverifikasi);
  const total = jumlahRp(aktif);
  const belum = jumlahRp(belumList);
  const sudah = jumlahRp(sudahList);

  const opsiMetode = useMemo(
    () => [...new Set(payments.map((p) => p.method).filter(Boolean))].sort().map((m) => [m, LABEL_CARA_BAYAR[m] || m]),
    [payments]
  );
  const tampil = useMemo(() => {
    // "150.000" harus cocok dengan nominal 150000: titik pemisah ribuan dibuang
    // dari kata yang murni angka.
    const qNorm = String(q || "").split(/\s+/).map((k) => (/^[\d.]+$/.test(k) ? k.replace(/\./g, "") : k)).join(" ");
    return payments.filter((p) => {
      if (fMetode && p.method !== fMetode) return false;
      if (fVerif === "terverifikasi" && !(p.terverifikasi && !p.cancelledAt)) return false;
      if (fVerif === "belum" && (p.terverifikasi || p.cancelledAt)) return false;
      if (fVerif === "dibatalkan" && !p.cancelledAt) return false;
      const adaAlokasi = (p.finAllocations || []).length > 0;
      if (fAlokasi === "ada" && !adaAlokasi) return false;
      if (fAlokasi === "tanpa" && adaAlokasi) return false;
      if (fBukti === "ada" && !p.proofPhotoUrl) return false;
      if (fBukti === "tanpa" && p.proofPhotoUrl) return false;
      return cocok(
        qNorm, p.order?.orderNumber, p.order?.customer?.name, p.recordedBy?.name,
        p.method, p.amount, p.notes
      );
    });
  }, [payments, q, fMetode, fVerif, fAlokasi, fBukti]);
  const disaring = !!q || !!fMetode || !!fVerif || !!fAlokasi || !!fBukti;

  function aturUlangFilter() {
    setQ(""); setFMetode(""); setFVerif(""); setFAlokasi(""); setFBukti("");
  }

  return (
    <HalamanFinance
      title="Pembayaran & Verifikasi"
      subtitle="Pastikan uang dari pelanggan benar-benar masuk ke rekening perusahaan, dan lampirkan foto buktinya."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={<PeriodePicker from={periode.from} to={periode.to} onChange={setPeriode} />}
    >
      {pesan && (
        <Card className="bg-redbg">
          <CardContent className="flex items-center justify-between gap-3 py-3">
            <p className="text-[13px] text-ink">{pesan}</p>
            <Button size="sm" variant="neutral" onClick={() => setPesan(null)}>Tutup</Button>
          </CardContent>
        </Card>
      )}

      <Penjelasan>
        <span className="inline-flex items-center gap-1.5 font-medium text-ink">
          <ShieldCheck size={14} className="text-accent" />
          Cara kerja saat ini
        </span>
        <p className="mt-1">
          {data?.gate?.enabled
            ? "Status Lunas di CRM baru berlaku setelah pembayarannya Anda verifikasi di sini (untuk pembayaran baru; " +
              "yang lama tidak berubah)."
            : "Kalau sales menandai order Lunas, statusnya langsung berlaku di CRM. Tugas Anda di halaman ini adalah " +
              "memastikan uangnya benar-benar masuk ke rekening perusahaan. Kalau ingin status Lunas baru berlaku " +
              "setelah diverifikasi, admin bisa menyalakannya di Pengaturan Finance."}
        </p>
      </Penjelasan>

      <div className={tab === "lunas_crm" ? "hidden" : "grid grid-cols-1 gap-4 sm:grid-cols-3"}>
        <KartuAngka
          label="Total Uang Masuk (periode ini)" value={formatUang(total)}
          sub={`Sudah diverifikasi ${formatUang(sudah)} · Menunggu ${formatUang(belum)}`}
          info={`Jumlah semua pembayaran pelanggan di periode yang dipilih (${aktif.length} pembayaran; yang dibatalkan tidak dihitung), dipisah antara yang sudah dan yang masih menunggu verifikasi.`}
        />
        <KartuAngka
          label="Menunggu Verifikasi" value={formatUang(belum)} tone={belum > 0 ? "orange" : "default"}
          sub={`${belumList.length} pembayaran`}
          info="Pembayaran yang sudah dicatat sales atau driver, tapi belum ada yang memastikan uangnya benar-benar masuk ke rekening atau kas perusahaan."
        />
        <KartuAngka
          label="Sudah Diverifikasi" value={formatUang(sudah)} tone="green"
          sub={`${sudahList.length} pembayaran`}
          info="Sudah dicek dan uangnya memang masuk. Status Lunas order tetap diatur dari CRM."
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {TAB.map((t) => (
          <Button key={t.key || "semua"} size="sm" variant={tab === t.key ? "secondary" : "neutral"} onClick={() => setTab(t.key)}>
            {t.label}
          </Button>
        ))}
      </div>
      <p className="text-[13px] leading-relaxed text-ink3">
        {tab === "perlu"
          ? "Semua yang perlu dicek Finance: (1) klaim Lunas dari Sales yang belum punya catatan uang masuk, dan (2) pembayaran yang sudah tercatat tapi belum diverifikasi."
          : tab === "lunas_crm"
            ? "Order yang ditandai Lunas oleh Sales, tapi belum ada catatan uang masuknya. Verifikasi Pembayaran, Tolak Klaim, atau Minta Bukti."
            : "Pembayaran yang sudah dicatat sales atau driver — tinggal dicek apakah uangnya benar-benar masuk."}
      </p>

      {tab === "perlu" && <h3 className="mt-1 text-[14px] font-semibold text-ink">1. Klaim Lunas dari Sales</h3>}
      {(tab === "lunas_crm" || tab === "perlu") && <LunasBelumDicatat ringkas={tab === "perlu"} />}
      {tab === "perlu" && <h3 className="mt-3 text-[14px] font-semibold text-ink">2. Pembayaran tercatat, menunggu verifikasi</h3>}

      <FilterBar
        className={tab === "lunas_crm" ? "hidden" : undefined}
        q={q} onQ={setQ}
        placeholder="Cari order, pelanggan, nominal…"
        filters={[
          { key: "metode", label: "Cara bayar", value: fMetode, onChange: setFMetode, options: opsiMetode },
          { key: "verif", label: "Status", value: fVerif, onChange: setFVerif, options: [["terverifikasi", "Sudah diverifikasi"], ["belum", "Menunggu verifikasi"], ["dibatalkan", "Dibatalkan"]] },
          { key: "alokasi", label: "Dibagi ke order lain", value: fAlokasi, onChange: setFAlokasi, options: [["ada", "Ya, dibagi"], ["tanpa", "Tidak dibagi"]] },
          { key: "bukti", label: "Foto bukti", value: fBukti, onChange: setFBukti, options: [["ada", "Ada foto"], ["tanpa", "Tanpa foto"]] },
        ]}
        ringkasan={disaring ? `${tampil.length} pembayaran dari ${payments.length}` : `${payments.length} pembayaran`}
        onReset={aturUlangFilter}
      />

      <Card className={tab === "lunas_crm" ? "hidden" : "overflow-hidden"}>
        <JudulKartu
          title="Daftar Uang Masuk"
          description="Kalau ada yang salah catat, batalkan lewat halaman Order. Barisnya tidak dihapus supaya jejaknya tetap ada."
          info="Pembayaran yang sudah tercatat tidak bisa diedit atau dihapus diam-diam. Kalau ada kesalahan, pembayaran itu dibatalkan dari halaman Order sehingga tetap terlihat siapa yang membatalkan dan kenapa."
        />
        {tampil.length === 0 ? (
          <CardContent><p className="py-6 text-center text-[13px] text-ink3">Tidak ada uang masuk yang cocok dengan pencarian ini.</p></CardContent>
        ) : (
          <>
          <TableWrap className={cn("dh-table", TABLE_VIEW_CLASS)}>
            <Table fixed>
              <THead>
                <TR>
                  <TH sticky width={128}>Tanggal</TH><TH width={140}>Order</TH><TH>Pelanggan</TH>
                  <TH width={110} hideBelow="2xl">Dicatat oleh</TH>
                  <TH width={92} hideBelow="2xl">Cara Bayar</TH>
                  <TH width={128} hideBelow="2xl">Masuk ke Rekening</TH>
                  <TH numeric width={112}>Nominal</TH>
                  <TH width={150} hideBelow="2xl">Untuk Order</TH>
                  <TH width={116}>Status</TH>
                  <TH width={56}>Bukti</TH>
                  <TH width={AKSI_COL_WIDTH}>Aksi</TH>
                </TR>
              </THead>
              <TBody>
                {tampil.map((p) => {
                  const a = aksiPembayaran(p, { verifikasi, setAlokasiUntuk });
                  return (
                  <TR key={p.id}>
                    <TD sticky className="whitespace-nowrap text-[12px]">{tanggalJam(p.createdAt)}</TD>
                    <TD className="truncate font-medium" title={p.order?.orderNumber || "—"}>{p.order?.orderNumber || "—"}</TD>
                    <TD truncate>{p.order?.customer?.name || "—"}</TD>
                    <TD hideBelow="2xl" truncate>{p.recordedBy?.name || "—"}</TD>
                    <TD hideBelow="2xl"><Badge variant="neutral">{LABEL_CARA_BAYAR[p.method] || p.method}</Badge></TD>
                    <TD hideBelow="2xl" truncate className="text-[12px]">
                      {p.cashAccount?.name || (
                        <span className="text-ink3" title="Rekening tidak dipilih saat pembayaran dicatat, jadi sistem memakai rekening standar untuk cara bayar ini.">
                          belum dipilih
                        </span>
                      )}
                    </TD>
                    <TD numeric><Uang value={p.amount} /></TD>
                    <TD hideBelow="2xl" className="min-w-0">
                      {p.finAllocations.length === 0
                        ? <span className="text-ink3">order ini saja</span>
                        : p.finAllocations.map((al) => (
                            <span key={al.id} className="block truncate text-[12px]" title={`${al.order?.orderNumber || "—"}: ${formatUang(al.amount)}`}>
                              {al.order?.orderNumber || "—"}: {formatUang(al.amount)}
                            </span>
                          ))}
                    </TD>
                    <TD>
                      {p.cancelledAt
                        ? <Badge variant="red">Dibatalkan</Badge>
                        : p.terverifikasi
                          ? <Badge variant="green">Sudah diverifikasi</Badge>
                          : <Badge variant="orange">Menunggu</Badge>}
                      {p.terverifikasi && (
                        <span className="mt-0.5 block truncate text-[11px] text-ink3">
                          oleh {p.verifications[0]?.verifiedBy?.name || "—"}
                        </span>
                      )}
                    </TD>
                    <TD><BuktiThumb url={p.proofPhotoUrl} onView={() => setFotoBukti(p.proofPhotoUrl)} label="Lihat foto bukti" /></TD>
                    <TD>
                      <RowActions primary={a.primary} items={a.items} />
                    </TD>
                  </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>

          <CardList className={CARD_VIEW_CLASS}>
            {tampil.map((p) => {
              const a = aksiPembayaran(p, { verifikasi, setAlokasiUntuk });
              return (
                <RowCard
                  key={p.id}
                  title={tanggalJam(p.createdAt)}
                  status={
                    p.cancelledAt ? <Badge variant="red">Dibatalkan</Badge>
                      : p.terverifikasi ? <Badge variant="green">Sudah diverifikasi</Badge>
                      : <Badge variant="orange">Menunggu</Badge>
                  }
                  subtitle={`${p.order?.orderNumber || "—"} · ${p.order?.customer?.name || "—"}`}
                  fields={[
                    { label: "Nominal", value: formatUang(p.amount) },
                    { label: "Cara Bayar", value: LABEL_CARA_BAYAR[p.method] || p.method },
                    { label: "Dicatat oleh", value: p.recordedBy?.name },
                    { label: "Masuk ke Rekening", value: p.cashAccount?.name || "belum dipilih" },
                    {
                      label: "Untuk Order", span: true,
                      value: p.finAllocations.length === 0 ? "order ini saja" : p.finAllocations.map((al) => `${al.order?.orderNumber || "—"}: ${formatUang(al.amount)}`).join(", "),
                    },
                    { label: "Bukti", value: <BuktiThumb url={p.proofPhotoUrl} onView={() => setFotoBukti(p.proofPhotoUrl)} label="Lihat foto bukti" /> },
                  ]}
                  actions={<RowActions primary={a.primary} items={a.items} />}
                />
              );
            })}
          </CardList>
          </>
        )}
      </Card>

      <ModalAlokasi
        payment={alokasiUntuk}
        onClose={() => setAlokasiUntuk(null)}
        onSaved={async () => { setAlokasiUntuk(null); await muat(); }}
        onError={setPesan}
      />

      <Modal open={Boolean(fotoBukti)} onOpenChange={(v) => !v && setFotoBukti(null)} title="Bukti Pembayaran" className="w-[560px]">
        {fotoBukti && <img src={fotoBukti} alt="Bukti pembayaran" className="max-h-[70vh] w-full rounded-lg object-contain" />}
      </Modal>
    </HalamanFinance>
  );
}

/**
 * Alokasi satu pembayaran ke beberapa order.
 *
 * Aturannya tegas dan ditegakkan backend juga: TOTAL alokasi wajib PERSIS
 * sama dengan nominal pembayaran. Menerima kurang berarti ada uang yang
 * hilang dari pembukuan; menerima lebih berarti mengarang uang. Sisa yang
 * belum teralokasi ditampilkan hidup di bawah supaya tidak perlu menghitung
 * di kepala.
 */
function ModalAlokasi({ payment, onClose, onSaved, onError }) {
  const [baris, setBaris] = useState([]);

  useEffect(() => {
    if (!payment) return;
    setBaris(
      payment.finAllocations.length > 0
        ? payment.finAllocations.map((a) => ({ orderNumber: a.order?.orderNumber || "", orderId: a.orderId, amount: String(a.amount) }))
        : [{ orderNumber: payment.order?.orderNumber || "", orderId: payment.orderId, amount: String(payment.amount) }]
    );
  }, [payment]);

  if (!payment) return null;

  const total = baris.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const sisa = (payment.amount || 0) - total;
  const valid = Math.abs(sisa) < 0.005 && baris.every((b) => b.orderId && Number(b.amount) > 0);

  function ubah(i, k, v) {
    setBaris((s) => s.map((b, idx) => (idx === i ? { ...b, [k]: v } : b)));
  }

  async function simpan() {
    try {
      await api.setFinancePaymentAllocations(
        payment.id,
        baris.map((b) => ({ orderId: b.orderId, amount: Number(b.amount) }))
      );
      await onSaved();
    } catch (e) {
      onError(e.message);
    }
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title="Bagi Pembayaran ke Beberapa Order"
      description={`${formatUang(payment.amount)} · ${LABEL_CARA_BAYAR[payment.method] || payment.method} · ${tanggalJam(payment.createdAt)}`}
      className="w-[560px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={simpan} disabled={!valid}>Simpan Pembagian</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] leading-relaxed text-ink2">
          Satu pembayaran bisa dibagi ke beberapa order — misalnya pelanggan transfer sekali untuk dua order
          sekaligus. Pembukuannya otomatis menyesuaikan dengan pembagian yang baru.
        </p>

        {baris.map((b, i) => (
          <div key={i} className="grid grid-cols-[1fr_140px_32px] items-end gap-2">
            <Field label={i === 0 ? "Untuk order" : undefined}>
              <OrderPicker
                value={b.orderId}
                onChange={(id, order) => {
                  ubah(i, "orderId", id);
                  ubah(i, "orderNumber", order?.orderNumber || "");
                }}
                // Order asal pembayaran ini ditawarkan lebih dulu: memecah
                // pembayaran hampir selalu berarti "sebagian tetap di order
                // ini, sisanya pindah".
                saran={payment.order ? [{
                  id: payment.orderId,
                  orderNumber: payment.order.orderNumber,
                  customerName: payment.order.customer?.name,
                  value: payment.order.value,
                  paymentStatus: payment.order.paymentStatus,
                }] : []}
                saranLabel="Order asal pembayaran ini"
                placeholder="Cari order…"
              />
            </Field>
            <Field label={i === 0 ? "Nominal" : undefined}>
              <InputUang value={b.amount} onChange={(v) => ubah(i, "amount", v)} />
            </Field>
            <Button
              variant="neutral" size="icon"
              disabled={baris.length <= 1}
              onClick={() => setBaris((s) => s.filter((_, idx) => idx !== i))}
              aria-label="Hapus baris"
            >
              ×
            </Button>
          </div>
        ))}

        <Button
          size="sm" variant="tertiary" className="px-0"
          onClick={() => setBaris((s) => [...s, { orderId: "", orderNumber: "", amount: "" }])}
        >
          + Tambah order
        </Button>

        <div className={`rounded-lg px-3 py-2 text-[13px] ${Math.abs(sisa) < 0.005 ? "bg-greenbg text-green" : "bg-orangebg text-orange"}`}>
          Total yang dibagi {formatUang(total)} dari {formatUang(payment.amount)}
          {Math.abs(sisa) >= 0.005 && ` — ${sisa > 0 ? "kurang" : "lebih"} ${formatUang(Math.abs(sisa))}`}
        </div>
      </div>
    </Modal>
  );
}
