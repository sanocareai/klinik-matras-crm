import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FileText, XCircle, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import { api } from "@/api.js";
import { Uang, formatUang, JudulKartu, Pilihan, InputUang, tanggalPendek } from "@/features/finance/shared.jsx";
import { STATUS_KLAIM_LABEL } from "@/features/klaim/klaimLunasLogic.js";

// KLAIM LUNAS DARI SALES — antrean klaim BERBUKTI (1 Okt 2026). Sales tidak lagi menandai order Lunas sendiri: klaim masuk ke sini lengkap dengan
// tanggal, nominal, metode, rekening, catatan, dan Bukti Pembayaran. Finance memilih: Verifikasi (membuat TEPAT SATU Payment resmi dari klaim ini,
// bukti klaim menjadi bukti Payment; status order dihitung ulang dari ledger), Minta Bukti (alasan wajib), atau Tolak (alasan wajib).
// Alasan desain & aturan: backend services/finance/klaimLunas.js.

const METODE = [["TRANSFER", "Transfer bank"], ["CASH", "Tunai"], ["QRIS", "QRIS / e-wallet"], ["CARD", "Kartu"]];
const LABEL_METODE = Object.fromEntries(METODE);

function tanggalIso(x) { return x ? String(x).slice(0, 10) : null; }

export default function KlaimLunasSales({ onBerubah }) {
  const [data, setData] = useState(null);
  const [rekening, setRekening] = useState([]);
  const [galat, setGalat] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [modal, setModal] = useState(null); // { jenis: "verifikasi" | "minta" | "tolak", klaim }

  const muat = useCallback(async () => {
    try {
      const [d, r] = await Promise.all([api.getKlaimLunasAntrean(), api.getFinanceCashAccounts().catch(() => ({ accounts: [] }))]);
      setData(d);
      setRekening((r.accounts || []).filter((a) => a.active));
      setGalat(null);
    } catch (e) { setGalat(e.message || "Gagal memuat klaim"); }
  }, []);
  useEffect(() => { muat(); }, [muat]);

  async function jalankan(fn) {
    try { await fn(); setModal(null); setPesan(null); await muat(); onBerubah?.(); } catch (e) { setPesan(e.message); }
  }

  if (galat) return <Card><CardContent className="py-6 text-center text-[13px] text-red">{galat}</CardContent></Card>;
  if (!data) return <Card><CardContent className="py-6 text-center text-[13px] text-ink3">Memuat klaim…</CardContent></Card>;

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
      <Card className="overflow-hidden" data-testid="klaim-lunas-berbukti">
        <JudulKartu
          title="Klaim Lunas Berbukti dari Sales"
          description={data.items.length ? `${data.menunggu.jumlah} menunggu verifikasi · ${formatUang(data.menunggu.total)}${data.dimintaBukti.jumlah ? ` · ${data.dimintaBukti.jumlah} menunggu bukti tambahan dari Sales` : ""}` : "Klaim yang diajukan Sales muncul di sini."}
          info="Sales mengajukan klaim dengan tanggal, nominal, metode, catatan, dan minimal satu bukti pembayaran. Mengajukan klaim belum mengubah status order atau saldo — status berubah setelah Anda memverifikasi."
        />
        {data.items.length === 0 ? (
          <CardContent>
            <EmptyState icon={CheckCircle2} title="Tidak ada klaim baru" description="Semua klaim berbukti dari Sales sudah Anda proses." />
          </CardContent>
        ) : (
          <>
          {/* Layar sempit: daftar kartu (tabel 9 kolom memaksa geser horizontal, tombol aksi di luar layar — QA visual 1 Okt 2026). */}
          <div className="flex flex-col gap-3 p-3 md:hidden" data-testid="klaim-kartu-mobile">
            {data.items.map((k) => (
              <div key={k.id} className="rounded-xl border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-[12.5px] font-semibold text-ink">{k.order.orderNumber || "—"}{k.resi && <span className="ml-1.5 font-sans text-[11px] font-medium text-accent">Resi · {k.resiInfo?.anak.length ?? "?"} order</span>}</p>
                    <p className="truncate text-[12.5px] text-ink2">{k.order.customerName} · {k.createdByName || "—"}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Uang value={k.amount} className="text-[14px] font-bold" />
                    <p className="text-[11px] text-ink3">sisa tagihan {formatUang(k.order.sisa)}</p>
                  </div>
                </div>
                <p className="mt-1 text-[11.5px] text-ink2">
                  {k.paymentDate ? tanggalPendek(k.paymentDate) : "—"} · {LABEL_METODE[k.method] || k.method || "—"}{k.cashAccount?.name ? ` → ${k.cashAccount.name}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {k.bukti.map((b) => <BuktiMini key={b.id} b={b} />)}
                  {k.bukti.length === 0 && <Badge variant="orange">Belum ada bukti</Badge>}
                </div>
                {k.note && <p className="mt-1.5 text-[12px] leading-snug text-ink2">{k.note}</p>}
                {k.peringatan.map((p) => (
                  <p key={p.kode} className="mt-1.5 flex items-start gap-1 text-[11.5px] leading-snug text-orange"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {p.pesan}</p>
                ))}
                <div className="mt-2"><Badge variant={k.status === "SUBMITTED" ? "orange" : "accent"}>{STATUS_KLAIM_LABEL[k.status] || k.status}</Badge></div>
                {k.reviewReason && <p className="mt-1 text-[11.5px] text-ink3">{k.reviewReason}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {k.status === "SUBMITTED" && <Button size="sm" variant="secondary" onClick={() => setModal({ jenis: "verifikasi", klaim: k })}>Verifikasi</Button>}
                  {k.status === "SUBMITTED" && <Button size="sm" variant="neutral" onClick={() => setModal({ jenis: "minta", klaim: k })}>Minta Bukti</Button>}
                  <Button size="sm" variant="neutral" onClick={() => setModal({ jenis: "tolak", klaim: k })}><XCircle size={13} /> Tolak</Button>
                </div>
              </div>
            ))}
          </div>
          <TableWrap className="dh-table hidden md:block">
            <Table>
              <THead>
                <TR><TH>Order</TH><TH>Pelanggan</TH><TH>Sales</TH><TH>Tanggal bayar</TH><TH numeric>Nominal klaim</TH><TH>Metode</TH><TH>Bukti Pembayaran</TH><TH>Status</TH><TH /></TR>
              </THead>
              <TBody>
                {data.items.map((k) => (
                  <TR key={k.id}>
                    <TD className="font-medium">
                      {k.order.orderNumber || "—"}
                      {k.resi && <div className="mt-0.5"><Badge variant="accent">Resi · {k.resiInfo?.anak.length ?? "?"} order</Badge></div>}
                    </TD>
                    <TD className="max-w-[170px] truncate">{k.order.customerName}</TD>
                    <TD className="text-[12px] text-ink2">{k.createdByName || "—"}</TD>
                    <TD className="whitespace-nowrap">{k.paymentDate ? tanggalPendek(k.paymentDate) : "—"}</TD>
                    <TD numeric>
                      <Uang value={k.amount} className="font-bold" />
                      <div className="text-[11px] text-ink3">sisa tagihan {formatUang(k.order.sisa)}</div>
                    </TD>
                    <TD className="text-[12px]">
                      {LABEL_METODE[k.method] || k.method || "—"}
                      {k.cashAccount?.name && <div className="text-ink3">{k.cashAccount.name}</div>}
                    </TD>
                    <TD>
                      <div className="flex flex-wrap items-center gap-1">
                        {k.bukti.map((b) => <BuktiMini key={b.id} b={b} />)}
                        {k.bukti.length === 0 && <Badge variant="orange">Belum ada bukti</Badge>}
                      </div>
                      {k.note && <p className="mt-1 max-w-[220px] text-[11px] leading-snug text-ink2">{k.note}</p>}
                      {k.peringatan.map((p) => (
                        <p key={p.kode} className="mt-1 flex max-w-[240px] items-start gap-1 text-[11px] leading-snug text-orange"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {p.pesan}</p>
                      ))}
                    </TD>
                    <TD>
                      <Badge variant={k.status === "SUBMITTED" ? "orange" : "accent"}>{STATUS_KLAIM_LABEL[k.status] || k.status}</Badge>
                      {k.reviewReason && <p className="mt-1 max-w-[180px] text-[11px] text-ink3">{k.reviewReason}</p>}
                    </TD>
                    <TD>
                      <div className="flex flex-wrap justify-end gap-1">
                        {k.status === "SUBMITTED" && <Button size="sm" variant="secondary" onClick={() => setModal({ jenis: "verifikasi", klaim: k })}>Verifikasi</Button>}
                        {k.status === "SUBMITTED" && <Button size="sm" variant="neutral" onClick={() => setModal({ jenis: "minta", klaim: k })}>Minta Bukti</Button>}
                        <Button size="sm" variant="neutral" onClick={() => setModal({ jenis: "tolak", klaim: k })}><XCircle size={13} /> Tolak</Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          </>
        )}
      </Card>

      <ModalAlasan
        modal={modal && modal.jenis !== "verifikasi" ? modal : null} onClose={() => setModal(null)}
        onKirim={(alasan) => jalankan(() => (modal.jenis === "minta"
          ? api.mintaBuktiKlaimLunas(modal.klaim.id, { alasan, versi: modal.klaim.version })
          : api.tolakKlaimLunas(modal.klaim.id, { alasan, versi: modal.klaim.version })))}
      />
      <ModalVerifikasiKlaim
        modal={modal?.jenis === "verifikasi" ? modal : null} rekening={rekening} onClose={() => setModal(null)}
        onKirim={(body) => jalankan(() => api.verifikasiKlaimLunas(modal.klaim.id, { ...body, versi: modal.klaim.version }))}
      />
    </>
  );
}

function BuktiMini({ b }) {
  const pdf = b.mime === "application/pdf";
  const cls = "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line transition-colors hover:border-accent";
  return (
    <a href={b.url} target="_blank" rel="noreferrer" title={b.nama} className={cls}>
      {pdf ? <FileText size={16} className="text-ink2" /> : <img src={b.url} alt={b.nama} loading="lazy" className="h-full w-full object-cover" />}
    </a>
  );
}

function ModalAlasan({ modal, onClose, onKirim }) {
  const [alasan, setAlasan] = useState("");
  const [sibuk, setSibuk] = useState(false);
  useEffect(() => { if (modal) { setAlasan(modal.jenis === "minta" ? "Mohon kirim bukti transfer/pembayaran yang jelas" : ""); setSibuk(false); } }, [modal]);
  if (!modal) return null;
  const tolak = modal.jenis === "tolak";
  const sah = alasan.trim().length >= 3;
  return (
    <Modal
      open onOpenChange={(v) => { if (!v && !sibuk) onClose(); }}
      title={tolak ? "Tolak Klaim Lunas" : "Minta Bukti Tambahan"}
      description={`Order ${modal.klaim.order.orderNumber || ""} — ${modal.klaim.order.customerName}`}
      footer={<>
        <Button variant="neutral" onClick={onClose} disabled={sibuk}>Batal</Button>
        <Button disabled={!sah || sibuk} onClick={() => { setSibuk(true); onKirim(alasan.trim()); }}>{tolak ? "Tolak Klaim" : "Kirim Permintaan"}</Button>
      </>}
    >
      <Field label="Alasan (wajib, dilihat Sales)" hint={tolak ? "Status order tidak berubah — klaim hanya ditutup dan Sales bisa memperbaikinya." : "Sales akan melengkapi bukti lalu mengajukan ulang."}>
        <textarea
          rows={3} maxLength={500} value={alasan} onChange={(e) => setAlasan(e.target.value)} autoFocus
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
        />
      </Field>
    </Modal>
  );
}

function ModalVerifikasiKlaim({ modal, rekening, onClose, onKirim }) {
  const k = modal?.klaim;
  const [f, setF] = useState({ method: "TRANSFER", cashAccountId: "", date: "", amount: "" });
  const [sibuk, setSibuk] = useState(false);
  const set = (key, v) => setF((s) => ({ ...s, [key]: v }));
  useEffect(() => {
    if (!k) return;
    setSibuk(false);
    setF({ method: k.method || "TRANSFER", cashAccountId: k.cashAccountId || "", date: k.paymentDate || tanggalIso(k.submittedAt) || "", amount: k.amount ?? "" });
  }, [k]);
  if (!k) return null;
  const nominal = Number(f.amount);
  const sah = Number.isInteger(nominal) && nominal > 0 && nominal <= k.order.sisa && f.date;
  return (
    <Modal
      open onOpenChange={(v) => { if (!v && !sibuk) onClose(); }}
      title="Verifikasi Klaim Lunas"
      description={`Order ${k.order.orderNumber || ""} — ${k.order.customerName}`}
      footer={<>
        <Button variant="neutral" onClick={onClose} disabled={sibuk}>Batal</Button>
        <Button
          disabled={!sah || sibuk}
          onClick={() => { setSibuk(true); onKirim({ method: f.method, cashAccountId: f.cashAccountId || undefined, date: f.date, amount: nominal }); }}
        >
          <CheckCircle2 size={14} /> Verifikasi &amp; Catat Pembayaran
        </Button>
      </>}
    >
      <div className="flex flex-col gap-3">
        <p className="rounded-xl bg-accentbg px-3 py-2.5 text-[12px] leading-relaxed text-accent">
          Ini membuat <strong>satu pembayaran resmi</strong> dari klaim Sales ({k.createdByName || "Sales"}), memakai bukti klaim sebagai bukti pembayaran, lalu menghitung ulang status order dari ledger.
          Order menjadi <strong>Lunas</strong> hanya bila pembayaran terverifikasi mencapai tagihan ({formatUang(k.order.tagihan)}; sudah terbayar {formatUang(k.order.dibayar)}).
          {k.resi && <> Ini klaim <strong>Resi ({k.resiInfo?.anak.length} order)</strong>: satu pembayaran di order pertama, dibagi otomatis oleh sistem ke tiap order sesuai sisa tagihannya (jumlah alokasi = nominal).</>}
        </p>
        <div className="flex flex-wrap gap-2">{k.bukti.map((b) => <BuktiMini key={b.id} b={b} />)}</div>
        {k.note && <p className="text-[12px] text-ink2"><strong>Catatan Sales:</strong> {k.note}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tanggal uang diterima"><DatePicker block allowFuture={false} value={f.date} onChange={(v) => set("date", v)} placeholder="Pilih tanggal" clearLabel="Kosongkan" /></Field>
          <Field label="Nominal diverifikasi" hint={`Maksimal sisa tagihan ${formatUang(k.order.sisa)}`}><InputUang value={f.amount} onChange={(v) => set("amount", v)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cara bayar"><Pilihan value={f.method} onChange={(v) => set("method", v)}>{METODE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Pilihan></Field>
          <Field label="Masuk ke rekening"><Pilihan value={f.cashAccountId} onChange={(v) => set("cashAccountId", v)}><option value="">Pilih rekening…</option>{rekening.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Pilihan></Field>
        </div>
        <p className="text-[11px] text-ink3">Tanggal sebelum 18 Sep 2026 (saldo awal) tidak menambah saldo rekening — server mengalihkannya otomatis.</p>
      </div>
    </Modal>
  );
}
