import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import { api } from "@/api.js";
import {
  Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, TombolAksi, Pilihan, InputUang,
  PemilihBukti, tanggalPendek,
} from "@/features/finance/shared.jsx";
import { cn } from "@/lib/utils.js";
import FilterBar, { cocok } from "@/features/finance/FilterBar.jsx";

// ORDER YANG DITANDAI LUNAS OLEH SALES, UANG MASUKNYA BELUM DICEK.
//
// Sales menandai order Lunas di CRM, tapi itu hanya mengubah status — belum ada
// catatan uang masuk, jadi belum ada yang bisa diverifikasi dan piutangnya belum
// tertutup di buku besar. Di sini finance memverifikasi: pilih rekening tempat
// uang itu masuk (SANOBANK Kemal / PT Sano / …), lampirkan foto bukti, dan sistem
// membuat catatan pembayaran + verifikasi + jurnalnya sekaligus.
// Alasan desain & aturan akuntansinya: backend services/finance/penerimaanOrder.js.
//
// Bahasa UI sengaja sehari-hari. Di kode: kelompok "LAMA" = di layar "Lunas
// sebelum <tanggal saldo awal>", kelompok "BARU" = "Perlu dicek".

const METODE = [["TRANSFER", "Transfer bank"], ["CASH", "Tunai"], ["QRIS", "QRIS / e-wallet"], ["CARD", "Kartu"]];

function hariIniISO() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

export default function LunasBelumDicatat({ onBerubah }) {
  const [data, setData] = useState(null);
  const [rekening, setRekening] = useState([]);
  const [galat, setGalat] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [q, setQ] = useState("");
  const [fSales, setFSales] = useState("");
  const [fKelompok, setFKelompok] = useState("");
  const [pilih, setPilih] = useState(new Set());
  const [modal, setModal] = useState(null); // { item } | { massal: true }

  const muat = useCallback(async () => {
    try {
      const [d, r] = await Promise.all([
        api.getFinanceLunasBelumDicatat(),
        api.getFinanceCashAccounts().catch(() => ({ accounts: [] })),
      ]);
      setData(d);
      setRekening((r.accounts || []).filter((a) => a.active));
      setGalat(null);
    } catch (e) {
      setGalat(e.message || "Gagal memuat daftar");
    }
  }, []);

  useEffect(() => { muat(); }, [muat]);

  async function aksi(fn) {
    try {
      await fn();
      setModal(null);
      setPilih(new Set());
      await muat();
      onBerubah?.();
    } catch (e) {
      setPesan(e.message);
    }
  }

  const items = data?.items || [];
  const opsiSales = useMemo(
    () => [...new Set(items.map((i) => i.salesName).filter(Boolean))].sort().map((s) => [s, s]),
    [items]
  );
  const tampil = useMemo(() => items.filter((i) => {
    if (fSales && i.salesName !== fSales) return false;
    if (fKelompok && i.kelompok !== fKelompok) return false;
    return cocok(String(q || "").split(/\s+/).map((k) => (/^[\d.]+$/.test(k) ? k.replace(/\./g, "") : k)).join(" "),
      i.orderNumber, i.customerName, i.salesName, i.sisa, i.nilaiOrder);
  }), [items, q, fSales, fKelompok]);

  const semuaTerpilih = tampil.length > 0 && tampil.every((i) => pilih.has(i.orderId));
  const terpilih = items.filter((i) => pilih.has(i.orderId));
  const totalTerpilih = terpilih.reduce((s, i) => s + i.sisa, 0);

  function toggle(id) {
    setPilih((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  if (galat) return <Card><CardContent className="py-6 text-center text-[13px] text-red">{galat}</CardContent></Card>;
  if (!data) return <Card><CardContent className="py-6 text-center text-[13px] text-ink3">Memuat…</CardContent></Card>;

  const tgl = tanggalPendek(data.cutoff);

  return (
    <>
      {pesan && (
        <Card className="bg-redbg">
          <CardContent className="flex items-center justify-between gap-3 py-3">
            <p className="text-[13px] text-ink">{pesan}</p>
            <Button size="sm" variant="neutral" onClick={() => setPesan(null)}>Tutup</Button>
          </CardContent>
        </Card>
      )}

      <Penjelasan>
        Order di bawah sudah ditandai <strong>Lunas</strong> oleh sales di CRM, tapi belum ada catatan uang masuknya.
        Tugas Anda: cek uangnya benar-benar sudah masuk, lalu tekan <strong>Verifikasi</strong> — pilih rekening
        tempat uangnya masuk dan lampirkan foto bukti. Kalau ternyata uangnya belum masuk, tekan
        <strong> Belum Lunas</strong> — status order dikembalikan.
      </Penjelasan>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KartuAngka
          label="Perlu Anda Cek" value={data.baru.jumlah} tone={data.baru.jumlah > 0 ? "orange" : "default"}
          sub={formatUang(data.baru.total)}
          info={`Order yang ditandai lunas pada atau setelah ${tgl}. Uangnya masuk ke salah satu rekening, jadi Anda perlu memilih rekening dan sebaiknya melampirkan foto bukti.`}
        />
        <KartuAngka
          label={`Lunas Sebelum ${tgl}`} value={data.lama.jumlah} sub={formatUang(data.lama.total)}
          info={`Order yang ditandai lunas sebelum ${tgl}. Uangnya sudah termasuk di saldo bank asli yang kita masukkan pada tanggal itu, jadi saldo rekening TIDAK ditambah lagi — cukup ditandai selesai. Tidak perlu memilih rekening atau foto bukti.`}
        />
        <KartuAngka label="Total Belum Dicek" value={formatUang(data.semua.total)} sub={`${data.semua.jumlah} order`} />
      </div>

      <FilterBar
        q={q} onQ={setQ}
        placeholder="Cari order, pelanggan, sales, nominal…"
        filters={[
          { key: "kel", label: "Jenis", value: fKelompok, onChange: setFKelompok, options: [["BARU", `Perlu dicek (sejak ${tgl})`], ["LAMA", `Lunas sebelum ${tgl}`]] },
          { key: "sales", label: "Sales", value: fSales, onChange: setFSales, options: opsiSales },
        ]}
        ringkasan={tampil.length === items.length ? `${items.length} order` : `${tampil.length} dari ${items.length} order`}
        onReset={() => { setQ(""); setFSales(""); setFKelompok(""); }}
      />

      {pilih.size > 0 && (
        <div className="fin-glass sticky top-[88px] z-20 flex flex-wrap items-center justify-between gap-3 p-3">
          <p className="text-[13px] text-ink"><strong>{pilih.size}</strong> order dipilih · {formatUang(totalTerpilih)}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="neutral" onClick={() => setPilih(new Set())}>Batal pilih</Button>
            <Button size="sm" onClick={() => setModal({ massal: true })}>Verifikasi yang dipilih</Button>
          </div>
        </div>
      )}

      <Card className="overflow-hidden">
        <JudulKartu
          title="Order yang Ditandai Lunas oleh Sales"
          description="Yang paling baru ditandai lunas ada di atas."
          info="Daftar ini otomatis dari status order di CRM dan pembayaran yang sudah dicatat, jadi langsung berkurang begitu sebuah order diverifikasi."
        />
        {tampil.length === 0 ? (
          <CardContent>
            <EmptyState icon={CheckCircle2} title="Tidak ada yang menunggu" description="Semua order yang ditandai lunas sudah dicek uang masuknya." />
          </CardContent>
        ) : (
          <TableWrap className="dh-table">
            <Table>
              <THead>
                <TR>
                  <TH sticky>
                    <input type="checkbox" checked={semuaTerpilih} aria-label="Pilih semua"
                      onChange={() => setPilih(semuaTerpilih ? new Set() : new Set(tampil.map((i) => i.orderId)))} />
                  </TH>
                  <TH>Order</TH><TH>Pelanggan</TH><TH>Sales</TH><TH>Ditandai Lunas</TH>
                  <TH numeric>Nilai Order</TH><TH numeric>Perlu Dicek</TH><TH>Jenis</TH><TH />
                </TR>
              </THead>
              <TBody>
                {tampil.map((i) => (
                  <TR key={i.orderId} selected={pilih.has(i.orderId)}>
                    <TD sticky>
                      <input type="checkbox" checked={pilih.has(i.orderId)} onChange={() => toggle(i.orderId)} aria-label={`Pilih ${i.orderNumber}`} />
                    </TD>
                    <TD className="font-medium">{i.orderNumber || "—"}</TD>
                    <TD className="max-w-[180px] truncate">{i.customerName}</TD>
                    <TD className="text-[12px] text-ink2">{i.salesName || "—"}</TD>
                    <TD className="whitespace-nowrap">{i.lunasSejak ? tanggalPendek(i.lunasSejak) : <span className="text-ink3">tanggal tidak diketahui</span>}</TD>
                    <TD numeric><Uang value={i.nilaiOrder} /></TD>
                    <TD numeric><Uang value={i.sisa} className="font-bold" /></TD>
                    <TD><Badge variant={i.kelompok === "BARU" ? "orange" : "neutral"}>{i.kelompok === "BARU" ? "Perlu dicek" : `Sebelum ${tgl}`}</Badge></TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="secondary" onClick={() => setModal({ item: i })}>Verifikasi</Button>
                        <TombolAksi
                          size="sm" variant="neutral" title="Uangnya ternyata belum masuk"
                          onClick={() => {
                            const alasan = window.prompt(`Kenapa ${i.orderNumber} belum lunas (uangnya belum masuk)? Status order akan dikembalikan ke belum lunas:`);
                            if (alasan?.trim()) return aksi(() => api.tolakLunas(i.orderId, alasan.trim()));
                          }}
                        >
                          <XCircle size={13} /> Belum Lunas
                        </TombolAksi>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <ModalVerifikasi
        modal={modal} onClose={() => setModal(null)} rekening={rekening} terpilih={terpilih} tgl={tgl}
        onSubmit={(payload) => aksi(() => (modal.massal
          ? api.verifikasiPenerimaanMassal({ ...payload, orderIds: terpilih.map((i) => i.orderId) }).then((r) => {
              if (r.gagal > 0) throw new Error(`${r.berhasil} berhasil, ${r.gagal} gagal: ${r.hasil.filter((h) => !h.ok).map((h) => h.error).slice(0, 2).join("; ")}`);
            })
          : api.verifikasiPenerimaan({ ...payload, orderId: modal.item.orderId })))}
      />
    </>
  );
}

function ModalVerifikasi({ modal, onClose, rekening, terpilih, tgl, onSubmit }) {
  const item = modal?.item;
  const [f, setF] = useState({ mode: "REKENING", method: "TRANSFER", cashAccountId: "", date: "", amount: "", proofPhotoUrl: "" });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    if (!modal) return;
    setF({
      mode: item ? (item.kelompok === "LAMA" ? "SEBELUM_SALDO_AWAL" : "REKENING") : "REKENING",
      method: "TRANSFER", cashAccountId: "",
      date: item?.lunasSejak || hariIniISO(), amount: item ? item.sisa : "", proofPhotoUrl: "",
    });
  }, [modal]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!modal) return null;

  const massal = !!modal.massal;
  const valid = f.mode === "SEBELUM_SALDO_AWAL"
    ? true
    : f.cashAccountId && (massal || Number(f.amount) > 0);

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={massal ? `Verifikasi ${terpilih.length} order` : `Verifikasi ${item.orderNumber}`}
      description={massal
        ? `Total ${formatUang(terpilih.reduce((s, i) => s + i.sisa, 0))} — tanggal tiap order mengikuti tanggal sales menandainya lunas`
        : `${item.customerName} · uang yang perlu dicek ${formatUang(item.sisa)}`}
      className="w-[520px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi
            onClick={() => onSubmit({
              mode: f.mode, method: f.method, cashAccountId: f.cashAccountId || undefined,
              ...(massal ? {} : { date: f.date, amount: Number(f.amount), proofPhotoUrl: f.proofPhotoUrl || undefined }),
            })}
            disabled={!valid}
          >
            Verifikasi
          </TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Uangnya masuk ke mana?">
          <Pilihan value={f.mode} onChange={(v) => set("mode", v)}>
            <option value="REKENING">Masuk ke rekening perusahaan</option>
            <option value="SEBELUM_SALDO_AWAL">{`Sudah lunas sebelum ${tgl} (tidak menambah saldo)`}</option>
          </Pilihan>
        </Field>

        {f.mode === "SEBELUM_SALDO_AWAL" ? (
          <p className="rounded-lg bg-inset px-3 py-2 text-[12.5px] leading-relaxed text-ink2">
            Uang order ini sudah termasuk di saldo bank asli yang kita masukkan pada {tgl}, jadi saldo rekening
            tidak ditambah lagi. Kalau order ini masih tercatat sebagai piutang, otomatis dianggap lunas.
            Tetap tercatat sebagai pembayaran yang sudah diverifikasi.
          </p>
        ) : (
          <>
            <Field label="Masuk ke rekening mana?" required>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {rekening.map((r) => (
                  <button
                    key={r.id} type="button" onClick={() => set("cashAccountId", r.id)}
                    className={cn(
                      "flex min-h-11 items-center rounded-xl border px-3 text-left text-[13px] transition-colors",
                      f.cashAccountId === r.id ? "border-accent bg-accentbg font-semibold text-accent" : "border-line bg-surface text-ink2 hover:border-accent"
                    )}
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
              {!massal && (
                <Field label="Tanggal uang masuk">
                  <DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} />
                </Field>
              )}
            </div>
            {!massal && (
              <>
                <Field label="Nominal yang masuk" hint="Kalau uang yang masuk lebih kecil dari nilai order, ubah di sini — sisanya tetap menunggu dicek">
                  <InputUang value={f.amount} onChange={(v) => set("amount", v)} />
                </Field>
                <Field label="Foto bukti pembayaran" hint="Salin fotonya dari WhatsApp lalu tekan Ctrl+V, atau unggah dari galeri">
                  <PemilihBukti url={f.proofPhotoUrl} onChange={(v) => set("proofPhotoUrl", v)} />
                </Field>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
