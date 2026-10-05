import React, { useCallback, useEffect, useRef, useState } from "react";
import { Plus, UserRound, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TABLE_VIEW_CLASS, CARD_VIEW_CLASS } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import DatePicker from "@/components/ui/date-picker.jsx";
import { api } from "@/api.js";
import { BuktiThumb } from "@/features/finance/BuktiThumb.jsx";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, TombolAksi,
  Pilihan, InputUang, PeriodePicker, periodeDefault, tanggalPendek, PemilihBukti,
} from "@/features/finance/shared.jsx";
import FilterBar, { useTertunda } from "@/features/finance/FilterBar.jsx";
import { RowActions, AKSI_COL_WIDTH } from "@/features/finance/RowActions.jsx";
import { CardList, RowCard } from "@/features/finance/cards.jsx";
import { PanelDetail, klikBuka } from "@/features/finance/PanelDetail.jsx";
import { specPenjualanKaryawan } from "@/features/finance/detailSpecs.js";
import { adminSaatIni } from "@/features/finance/aksiMenu.jsx";
import { totalItems, normalisasiJumlah, metodeButuhRekening, LABEL_METODE_PJK } from "@/features/finance/penjualanKaryawanLogic.js";

// PENJUALAN KARYAWAN — input MANUAL di luar Order. Karyawan non-Sales menjual ke kerabat; tidak membuat Order/Customer, tidak masuk produksi atau delivery.
// Pendapatan diakui saat dicatat dan tagihannya jadi Piutang Karyawan milik karyawan penjual; pelunasan = tunai/transfer ke rekening atau potong gaji.
// Semua angka (total, terbayar, sisa, status) dihitung SERVER; layar ini hanya menampilkan. Jurnal & alasan: backend services/finance/posting/penjualanKaryawan.js.

const STATUS_TAB = [
  { key: "", label: "Semua" },
  { key: "BELUM_BAYAR", label: "Belum dibayar" },
  { key: "SEBAGIAN", label: "Dibayar sebagian" },
  { key: "LUNAS", label: "Lunas" },
  { key: "DIBATALKAN", label: "Dibatalkan" },
];
const VARIAN = { BELUM_BAYAR: "orange", SEBAGIAN: "orange", LUNAS: "green", DIBATALKAN: "neutral" };

const hariIniISO = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const StatusPenjualan = ({ p }) => <Badge variant={VARIAN[p.statusTampil] || "neutral"}>{p.statusLabel}</Badge>;

export default function FinancePenjualanKaryawan() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [fKaryawan, setFKaryawan] = useState("");
  const [periode, setPeriode] = useState(periodeDefault);
  const qTunda = useTertunda(q);
  const pernahMuat = useRef(false);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);

  const [modalBaru, setModalBaru] = useState(false);
  const [bayarUntuk, setBayarUntuk] = useState(null);
  const [riwayatId, setRiwayatId] = useState(null);
  const [panelRincian, setPanelRincian] = useState(null);
  const admin = adminSaatIni();

  const muat = useCallback(async (opsi) => {
    const diam = opsi?.diam === true;
    if (!diam) setLoading(true);
    setError(null);
    try {
      setData(await api.getPenjualanKaryawanFinance({ ...periode, status, q: qTunda.trim(), sellerId: fKaryawan }));
    } catch (e) {
      if (diam) setPesan(e.message || "Gagal menyegarkan daftar");
      else setError(e.message || "Gagal memuat penjualan karyawan");
    } finally {
      if (!diam) setLoading(false);
    }
  }, [periode, status, qTunda, fKaryawan]);

  useEffect(() => { muat({ diam: pernahMuat.current }); pernahMuat.current = true; }, [muat]);

  async function aksi(fn) {
    try {
      await fn();
      setModalBaru(false);
      setBayarUntuk(null);
      await muat({ diam: true });
    } catch (e) {
      setPesan(e.message);
    }
  }

  const daftar = data?.penjualan || [];
  const ringkasan = data?.ringkasan;
  const riwayat = daftar.find((p) => p.id === riwayatId) || null;

  function aksiBaris(p) {
    const bisaBayar = p.statusTampil === "BELUM_BAYAR" || p.statusTampil === "SEBAGIAN";
    const items = [
      { label: "Riwayat pembayaran", onClick: () => setRiwayatId(p.id) },
      {
        label: "Batalkan penjualan", destructive: true, hidden: !admin || p.statusTampil === "DIBATALKAN",
        onClick: () => {
          const alasan = window.prompt(`Alasan membatalkan ${p.nomor}? Jurnalnya akan dibalik (pembayaran yang sudah ada harus dibatalkan dulu).`);
          if (alasan?.trim()) return aksi(() => api.batalPenjualanKaryawan(p.id, alasan.trim()));
        },
      },
    ];
    return { primary: bisaBayar ? { label: "Bayar", variant: "secondary", title: "Catat pembayaran", onClick: () => setBayarUntuk(p) } : null, items };
  }
  const specBaris = (p) => specPenjualanKaryawan(p, { badge: <StatusPenjualan p={p} /> });

  return (
    <HalamanFinance
      title="Penjualan Karyawan"
      subtitle="Penjualan karyawan non-Sales ke kerabat, dicatat manual di luar Order. Tidak melewati produksi maupun delivery."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={(
        <>
          <PeriodePicker from={periode.from} to={periode.to} onChange={setPeriode} />
          <Button size="sm" onClick={() => setModalBaru(true)}><Plus size={14} /> Catat Penjualan</Button>
        </>
      )}
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
        Dipakai untuk penjualan yang <strong>tidak lewat Order</strong> (pembelinya bukan pelanggan di Inbox/CRM). Pendapatan diakui saat dicatat dan masuk
        total pendapatan perusahaan, <strong>terpisah dari omzet Tim Sales</strong>. Tagihannya tercatat sebagai <strong>Piutang Karyawan</strong> milik karyawan penjual
        sampai dibayar (tunai/transfer ke rekening) atau <strong>dipotong dari gaji</strong>. HPP tidak dibukukan di sini. Pembayaran bertanggal sebelum
        tanggal cutoff saldo awal ({data?.cutoff ? tanggalPendek(data.cutoff) : "18 Sep 2026"}) tidak menambah saldo kas/bank karena uangnya sudah tercakup di saldo awal.
      </Penjelasan>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KartuAngka label="Nilai Penjualan" value={formatUang(ringkasan?.nilai ?? 0)} sub={`${ringkasan?.jumlah ?? 0} penjualan aktif, sepanjang waktu`} />
        <KartuAngka label="Sudah Dibayar" value={formatUang(ringkasan?.terbayar ?? 0)} sub="tunai, transfer, dan potong gaji" />
        <KartuAngka
          label="Sisa Tagihan ke Karyawan" value={formatUang(ringkasan?.sisa ?? 0)} tone={(ringkasan?.sisa ?? 0) > 0 ? "orange" : "default"}
          sub="belum dibayar atau dipotong dari gaji"
          info="Bagian dari saldo akun Piutang Karyawan (1-1350) yang berasal dari penjualan karyawan. Kasbon tercatat terpisah di menu Kasbon pada akun yang sama."
        />
        <KartuAngka label="Karyawan dengan Sisa Tagihan" value={(ringkasan?.karyawan || []).filter((k) => k.sisa > 0).length} sub="orang" />
      </div>

      {(ringkasan?.karyawan || []).length > 0 && (
        <Card className="overflow-hidden">
          <JudulKartu title="Per Karyawan" description="Dihitung dari semua penjualan aktif, tidak berubah mengikuti pencarian di bawah." />
          <TableWrap className="dh-table">
            <Table>
              <THead><TR><TH sticky>Karyawan</TH><TH numeric>Penjualan</TH><TH numeric>Nilai</TH><TH numeric>Dibayar</TH><TH numeric>Sisa</TH><TH /></TR></THead>
              <TBody>
                {ringkasan.karyawan.map((k) => (
                  <TR key={k.sellerId}>
                    <TD sticky className="font-medium">{k.nama}</TD>
                    <TD numeric>{k.jumlah}</TD>
                    <TD numeric><Uang value={k.nilai} /></TD>
                    <TD numeric><Uang value={k.terbayar} nolSebagaiStrip /></TD>
                    <TD numeric><Uang value={k.sisa} className="font-bold" nolSebagaiStrip /></TD>
                    <TD><div className="flex justify-end"><Button size="sm" variant="neutral" onClick={() => setFKaryawan(k.sellerId)}>Lihat</Button></div></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {STATUS_TAB.map((t) => (
          <Button key={t.key || "semua"} size="sm" variant={status === t.key ? "secondary" : "neutral"} onClick={() => setStatus(t.key)}>{t.label}</Button>
        ))}
      </div>

      <FilterBar
        q={q} onQ={setQ}
        placeholder="Cari nomor, karyawan, pembeli, item…"
        filters={[{ key: "kar", label: "Karyawan", value: fKaryawan, onChange: setFKaryawan, options: (ringkasan?.karyawan || []).map((k) => [k.sellerId, k.nama]) }]}
        ringkasan={`${daftar.length} penjualan${data?.terpotong ? " · baru 500 teratas tampil — persempit pencarian atau periode" : ""}`}
        onReset={() => { setQ(""); setFKaryawan(""); }}
      />

      <Card className="overflow-hidden">
        <JudulKartu title="Daftar Penjualan Karyawan" description="Nomor PKR dibuat otomatis. Klik baris untuk melihat rincian item dan pembayaran." />
        {daftar.length === 0 ? (
          <CardContent>
            <EmptyState
              icon={UserRound} title="Belum ada penjualan karyawan"
              description="Belum ada yang cocok dengan filter ini."
              action={<Button size="sm" onClick={() => setModalBaru(true)}>Catat Penjualan</Button>}
            />
          </CardContent>
        ) : (
          <>
            <TableWrap className={cn("dh-table", TABLE_VIEW_CLASS)}>
              <Table fixed>
                <THead>
                  <TR>
                    <TH sticky width={124}>Nomor</TH><TH width={78}>Tanggal</TH><TH width={140}>Karyawan</TH><TH>Pembeli</TH>
                    <TH numeric width={108} hideBelow="2xl">Total</TH><TH numeric width={108} hideBelow="2xl">Dibayar</TH><TH numeric width={112}>Sisa</TH>
                    <TH width={118}>Status</TH><TH width={AKSI_COL_WIDTH}>Aksi</TH>
                  </TR>
                </THead>
                <TBody>
                  {daftar.map((p) => {
                    const a = aksiBaris(p);
                    return (
                      <TR key={p.id} {...klikBuka(() => setPanelRincian(specBaris(p)))}>
                        <TD sticky className="font-mono text-[12px]">{p.nomor}</TD>
                        <TD className="whitespace-nowrap text-[12px]">{tanggalPendek(p.date)}</TD>
                        <TD truncate className="font-medium">{p.seller?.name}</TD>
                        <TD truncate>{p.buyerName}</TD>
                        <TD hideBelow="2xl" numeric><Uang value={p.total} /></TD>
                        <TD hideBelow="2xl" numeric><Uang value={p.terbayar} nolSebagaiStrip /></TD>
                        <TD numeric><Uang value={p.sisa} className="font-bold" nolSebagaiStrip /></TD>
                        <TD><StatusPenjualan p={p} /></TD>
                        <TD><RowActions primary={a.primary} items={a.items} /></TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrap>

            <CardList className={CARD_VIEW_CLASS}>
              {daftar.map((p) => {
                const a = aksiBaris(p);
                return (
                  <RowCard
                    key={p.id}
                    onClick={() => setPanelRincian(specBaris(p))}
                    title={p.nomor}
                    status={<StatusPenjualan p={p} />}
                    subtitle={`${p.seller?.name} → ${p.buyerName}`}
                    fields={[
                      { label: "Tanggal", value: tanggalPendek(p.date) },
                      { label: "Sisa", value: formatUang(p.sisa) },
                      { label: "Total", value: formatUang(p.total) },
                      { label: "Dibayar", value: formatUang(p.terbayar) },
                    ]}
                    actions={<RowActions primary={a.primary} items={a.items} />}
                  />
                );
              })}
            </CardList>
          </>
        )}
      </Card>

      <ModalPenjualanBaru open={modalBaru} onClose={() => setModalBaru(false)} aksi={aksi} cutoff={data?.cutoff} />
      <ModalBayar cutoff={data?.cutoff} target={bayarUntuk} onClose={() => setBayarUntuk(null)} onSubmit={(d) => aksi(() => api.catatPembayaranPenjualanKaryawan(bayarUntuk.id, d))} />
      <ModalRiwayat
        penjualan={riwayat} onClose={() => setRiwayatId(null)} admin={admin}
        onBatal={(pay) => {
          const alasan = window.prompt("Alasan membatalkan pembayaran ini? Jurnalnya akan dibalik:");
          if (alasan?.trim()) return aksi(() => api.batalPembayaranPenjualanKaryawan(riwayat.id, pay.id, alasan.trim()));
        }}
      />
      <PanelDetail spec={panelRincian} onClose={() => setPanelRincian(null)} />
    </HalamanFinance>
  );
}

// Daftar rekening kas/bank aktif + status memuat/galat (dipakai dua modal).
function useRekening(aktif) {
  const [rek, setRek] = useState([]);
  const [st, setSt] = useState({ memuat: false, galat: null });
  const muat = useCallback(() => {
    setSt({ memuat: true, galat: null });
    api.getFinanceCashAccounts()
      .then((r) => { setRek((r.accounts || []).filter((a) => a.active)); setSt({ memuat: false, galat: null }); })
      .catch((e) => setSt({ memuat: false, galat: e.message || "Gagal memuat daftar rekening" }));
  }, []);
  useEffect(() => { if (aktif) muat(); }, [aktif, muat]);
  return { rek, st, muat };
}

function PilihRekening({ value, onChange, rek, st, muat, wajib, cutoff }) {
  return (
    <Field label="Uang masuk ke" required={wajib} hint={wajib ? undefined : `Opsional untuk tanggal sebelum cutoff saldo awal (${cutoff ? tanggalPendek(cutoff) : "18 Sep 2026"}) — hanya keterangan, saldo tidak berubah`}>
      <Pilihan value={value} onChange={onChange}>
        <option value="">{st.memuat ? "memuat rekening…" : "— pilih bank / kas —"}</option>
        {rek.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </Pilihan>
      {st.galat && <p className="mt-1 text-[12px] text-red">{st.galat}. <button type="button" className="font-semibold underline" onClick={muat}>Coba lagi</button></p>}
    </Field>
  );
}

const BAYAR_KOSONG = () => ({ method: "TRANSFER", amount: "", date: hariIniISO(), cashAccountId: "", receiptUrl: "", notes: "" });
const bodyBayar = (b) => ({
  method: b.method, amount: Number(b.amount), date: b.date, notes: b.notes?.trim() || undefined,
  ...(metodeButuhRekening(b.method) ? { cashAccountId: b.cashAccountId || undefined, receiptUrl: b.receiptUrl || undefined } : {}),
});

// Rekening wajib untuk uang yang diterima pada/setelah tanggal cutoff (keputusan akhir tetap di server).
const rekeningWajib = (b, cutoff) => metodeButuhRekening(b.method) && (!cutoff || b.date >= cutoff);

function BarisBayar({ b, onChange, rek, st, muat, onHapus, cutoff }) {
  const set = (k, v) => onChange({ ...b, [k]: v });
  const pakaiRek = metodeButuhRekening(b.method);
  return (
    <div className="space-y-3 rounded-lg bg-inset p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Cara bayar">
          <Pilihan value={b.method} onChange={(v) => onChange({ ...b, method: v, ...(v === "POTONG_GAJI" ? { cashAccountId: "", receiptUrl: "" } : {}) })}>
            {Object.entries(LABEL_METODE_PJK).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Pilihan>
        </Field>
        <Field label="Tanggal"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={b.date} onChange={(v) => set("date", v)} /></Field>
        <Field label="Nominal" required><InputUang value={b.amount} onChange={(v) => set("amount", v)} /></Field>
      </div>
      {pakaiRek && <PilihRekening value={b.cashAccountId} onChange={(v) => set("cashAccountId", v)} rek={rek} st={st} muat={muat} wajib={rekeningWajib(b, cutoff)} cutoff={cutoff} />}
      {pakaiRek && <Field label="Bukti" hint="Opsional"><PemilihBukti url={b.receiptUrl} onChange={(v) => set("receiptUrl", v)} /></Field>}
      {b.method === "POTONG_GAJI" && <p className="text-[12px] text-ink2">Kas tidak tersentuh. Gaji <strong>bersih</strong> tetap dicatat di Pengeluaran; bagian yang dipotong ini otomatis ditambahkan ke beban gaji.</p>}
      <Field label="Catatan"><Input value={b.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      {onHapus && <div className="flex justify-end"><Button size="sm" variant="neutral" onClick={onHapus}><Trash2 size={13} /> Hapus pembayaran ini</Button></div>}
    </div>
  );
}

function ModalPenjualanBaru({ open, onClose, aksi, cutoff }) {
  const kosong = () => ({ date: hariIniISO(), sellerId: "", buyerName: "", notes: "", items: [{ name: "", quantity: 1, unitPrice: "" }], pembayaran: [] });
  const [f, setF] = useState(kosong);
  const [karyawan, setKaryawan] = useState([]);
  const [galatKar, setGalatKar] = useState(null);
  const { rek, st, muat } = useRekening(open);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setF(kosong());
    setGalatKar(null);
    api.getKaryawanPenjualanKaryawan().then((r) => setKaryawan(r.karyawan || [])).catch((e) => setGalatKar(e.message || "Gagal memuat daftar karyawan"));
  }, [open]);

  const total = totalItems(f.items);
  const bayarTotal = f.pembayaran.reduce((a, b) => a + (Number(b.amount) || 0), 0);
  const itemsValid = f.items.length > 0 && f.items.every((i) => i.name.trim() && normalisasiJumlah(i.quantity) !== null && Number(i.unitPrice) > 0);
  const bayarValid = f.pembayaran.every((b) => Number(b.amount) > 0 && (!rekeningWajib(b, cutoff) || b.cashAccountId));
  const valid = f.sellerId && f.buyerName.trim().length >= 2 && itemsValid && bayarValid && bayarTotal <= total;
  const setItem = (i, patch) => set("items", f.items.map((it, n) => (n === i ? { ...it, ...patch } : it)));

  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Catat Penjualan Karyawan"
      description="Penjualan di luar Order. Tidak membuat order, produksi, atau pengiriman."
      className="w-[680px]"
      footer={(
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi
            disabled={!valid}
            onClick={() => aksi(() => api.createPenjualanKaryawan({
              date: f.date, sellerId: f.sellerId, buyerName: f.buyerName.trim(), notes: f.notes.trim() || undefined,
              items: f.items.map((i) => ({ name: i.name.trim(), quantity: normalisasiJumlah(i.quantity), unitPrice: Number(i.unitPrice) })), // jumlah dikirim sebagai teks bertitik ("1.6")
              pembayaran: f.pembayaran.map(bodyBayar),
            }))}
          >Catat Penjualan</TombolAksi>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tanggal penjualan"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} /></Field>
          <Field label="Karyawan penjual" required hint={galatKar ? undefined : "Akun aktif non-Sales; dialah yang menanggung tagihannya"}>
            <Pilihan value={f.sellerId} onChange={(v) => set("sellerId", v)}>
              <option value="">— pilih karyawan —</option>
              {karyawan.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </Pilihan>
            {galatKar && <p className="mt-1 text-[12px] text-red">{galatKar}</p>}
          </Field>
        </div>
        <Field label="Nama pembeli" required hint="Kerabat/pembeli — teks bebas, bukan data pelanggan CRM">
          <Input value={f.buyerName} onChange={(e) => set("buyerName", e.target.value)} placeholder="mis. Bu Ani (kerabat)" />
        </Field>

        <div className="space-y-2">
          <p className="text-[13px] font-semibold text-ink">Item yang dijual</p>
          {f.items.map((it, i) => (
            <div key={i} className="grid grid-cols-[1fr_72px_140px_auto] items-end gap-2 max-sm:grid-cols-2">
              <Field label={i === 0 ? "Nama item" : undefined} className="max-sm:col-span-2"><Input value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} placeholder="mis. Kasur Sano 160×200" /></Field>
              <Field label={i === 0 ? "Jumlah" : undefined}><Input type="text" inputMode="decimal" value={it.quantity} aria-invalid={normalisasiJumlah(it.quantity) === null} title="Boleh pecahan, mis. 1,6 (maks 3 angka di belakang koma)" onChange={(e) => setItem(i, { quantity: e.target.value })} /></Field>
              <Field label={i === 0 ? "Harga satuan" : undefined}><InputUang value={it.unitPrice} onChange={(v) => setItem(i, { unitPrice: v })} /></Field>
              <Button size="sm" variant="neutral" disabled={f.items.length === 1} aria-label="Hapus item" onClick={() => set("items", f.items.filter((_, n) => n !== i))}><Trash2 size={13} /></Button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button size="sm" variant="neutral" onClick={() => set("items", [...f.items, { name: "", quantity: 1, unitPrice: "" }])}><Plus size={13} /> Tambah item</Button>
            <p className="text-[13px] text-ink2">Total: <strong className="text-ink" data-testid="total-penjualan">{formatUang(total)}</strong></p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold text-ink">Pembayaran yang sudah diterima <span className="font-normal text-ink3">(opsional)</span></p>
            <Button size="sm" variant="neutral" onClick={() => set("pembayaran", [...f.pembayaran, BAYAR_KOSONG()])}><Plus size={13} /> Tambah pembayaran</Button>
          </div>
          {f.pembayaran.map((b, i) => (
            <BarisBayar
              key={i} b={b} rek={rek} st={st} muat={muat} cutoff={cutoff}
              onChange={(nb) => set("pembayaran", f.pembayaran.map((x, n) => (n === i ? nb : x)))}
              onHapus={() => set("pembayaran", f.pembayaran.filter((_, n) => n !== i))}
            />
          ))}
          {f.pembayaran.length > 0 && (
            <p className={cn("text-[12.5px]", bayarTotal > total ? "text-red" : "text-ink2")}>
              Dibayar {formatUang(bayarTotal)} · sisa tagihan {formatUang(Math.max(total - bayarTotal, 0))}{bayarTotal > total ? " — melebihi total penjualan" : ""}
            </p>
          )}
        </div>

        <Field label="Catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ModalBayar({ target, onClose, onSubmit, cutoff }) {
  const [b, setB] = useState(BAYAR_KOSONG);
  const { rek, st, muat } = useRekening(!!target);
  useEffect(() => { if (target) setB({ ...BAYAR_KOSONG(), amount: target.sisa }); }, [target]);
  if (!target) return null;
  const valid = Number(b.amount) > 0 && Number(b.amount) <= target.sisa && (!rekeningWajib(b, cutoff) || b.cashAccountId);
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Catat pembayaran ${target.nomor}`}
      description={`${target.seller?.name} → ${target.buyerName} · sisa tagihan ${formatUang(target.sisa)}`}
      className="w-[560px]"
      footer={(
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit(bodyBayar(b))} disabled={!valid}>Simpan Pembayaran</TombolAksi>
        </>
      )}
    >
      <BarisBayar b={b} onChange={setB} rek={rek} st={st} muat={muat} cutoff={cutoff} />
      {Number(b.amount) > target.sisa && <p className="mt-2 text-[12px] text-red">Nominal melebihi sisa tagihan.</p>}
    </Modal>
  );
}

function ModalRiwayat({ penjualan, onClose, onBatal, admin }) {
  if (!penjualan) return null;
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Pembayaran ${penjualan.nomor}`}
      description={`${penjualan.seller?.name} · total ${formatUang(penjualan.total)} · sisa ${formatUang(penjualan.sisa)}`}
      className="w-[520px]"
      footer={<Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Tutup</Button>}
    >
      <div className="space-y-2">
        {penjualan.payments.length === 0 && <p className="text-[13px] text-ink3">Belum ada pembayaran.</p>}
        {penjualan.payments.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg bg-inset px-3 py-2.5">
            <div className="min-w-0 text-[13px]">
              <p className="font-medium text-ink">
                <Uang value={p.amount} /> · {LABEL_METODE_PJK[p.method] || p.method}
                {p.cancelledAt && <Badge variant="neutral" className="ml-2">Dibatalkan</Badge>}
              </p>
              <p className="text-[12px] text-ink3">
                {tanggalPendek(p.date)}{p.cashAccount ? ` · ke ${p.cashAccount.name}` : ""}{p.notes ? ` · ${p.notes}` : ""}{p.cancelReason ? ` · batal: ${p.cancelReason}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <BuktiThumb url={p.receiptUrl} label="Lihat bukti pembayaran" />
              {admin && !p.cancelledAt && <Button size="sm" variant="neutral" onClick={() => onBatal(p)}>Batalkan</Button>}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
