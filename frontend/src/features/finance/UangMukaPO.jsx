import React, { useEffect, useMemo, useRef, useState } from "react";
import { Info, Wallet, AlertTriangle, Undo2 } from "lucide-react";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { Uang, formatUang, TombolAksi, Pilihan, InputUang, PemilihBukti, tanggalPendek } from "@/features/finance/shared.jsx";
import CaraBayarTransfer from "@/features/finance/CaraBayarTransfer.jsx";
import { BIAYA_KOSONG, biayaTransferLengkap } from "@/features/finance/biayaTransfer.js";
import { KALIMAT_UANG_MUKA, statusMelebihi, kesiapanBayarUangMuka, bodyBayarUangMuka, kesiapanTerapkan, bodyTerapkanUangMuka } from "@/features/finance/uangMukaLogic.js";

// UANG MUKA SUPPLIER sebelum barang datang (Okt 2026). Semua angka datang dari server (po.keuangan, po.total*); layar ini hanya menampilkan, memberi tooltip definisi, dan mengirim aksi.

const idKunci = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
const hariIniISO = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

/** Label angka + ikon definisi: tooltip (title) untuk mouse, dan ketuk ikon untuk membuka definisi di bawahnya (layar sentuh tidak punya tooltip). */
function Angka({ label, nilai, definisi, tebal = false, tone = null, testid, teks = false }) {
  const [buka, setBuka] = useState(false);
  return (
    <div className="min-w-0" data-testid={testid}>
      <dt className="flex items-center gap-1 text-[11.5px] text-ink3" title={definisi}>
        <span>{label}</span>
        {definisi && (
          <button type="button" onClick={() => setBuka((v) => !v)} aria-expanded={buka} aria-label={`Arti ${label}`} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink3 hover:text-ink max-sm:h-8 max-sm:w-8">
            <Info size={12} aria-hidden="true" />
          </button>
        )}
      </dt>
      <dd className={cn("ml-0 mt-0.5 text-[14px] tabular-nums", tebal ? "font-semibold text-ink" : "text-ink", tone === "orange" && "text-orange", tone === "green" && "text-green", tone === "red" && "text-red")}>{teks ? nilai : <Uang value={nilai} />}</dd>
      {buka && definisi && <p className="m-0 mt-1 rounded-md bg-inset px-2 py-1 text-[11.5px] leading-snug text-ink2" role="note">{definisi}</p>}
    </div>
  );
}

const defServer = (daftar, kunci) => (daftar || []).find((d) => d.kunci === kunci)?.definisi;

/** Dua kelompok yang jelas: A. Pemenuhan barang (nilai menurut harga PO) dan B. Keuangan. Tidak mencampur "sisa komitmen PO" dengan "utang tercatat". */
export function PanelKelompokPO({ po }) {
  const k = po.keuangan;
  const dp = po.progresDefinisi;
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" data-testid="kelompok-po">
      <section className="rounded-lg border border-line p-3" data-testid="kelompok-pemenuhan" aria-label="Pemenuhan barang">
        <h4 className="m-0 mb-2 text-[11px] font-bold uppercase tracking-wide text-ink3">A. Pemenuhan barang <span className="font-normal normal-case text-ink3">(nilai menurut harga PO)</span></h4>
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Angka testid="p-dipesan" label="Dipesan" nilai={po.totalDipesan} definisi={defServer(dp, "dipesan")} />
          <Angka testid="p-datang" label="Datang fisik" nilai={po.totalDatang} definisi={defServer(dp, "datang")} />
          <Angka testid="p-belum-datang" label="Belum datang" nilai={po.totalBelumDatang} definisi={defServer(dp, "belumDatang")} />
          <Angka testid="p-bersih" label="Diterima bersih dari PO" nilai={po.totalDiterimaBersih} definisi={defServer(dp, "diterimaBersih")} />
          <Angka testid="p-masuk-stok" label="Masuk stok" nilai={po.totalDiterima} definisi={defServer(dp, "masukStok")} tebal />
        </dl>
        <p className="m-0 mt-2 text-[11.5px] text-ink3">Hanya “Masuk stok” yang menambah stok. Pembayaran atau faktur tidak pernah menambah stok.</p>
      </section>
      {k && (
        <section className="rounded-lg border border-line p-3" data-testid="kelompok-keuangan" aria-label="Keuangan">
          <h4 className="m-0 mb-2 text-[11px] font-bold uppercase tracking-wide text-ink3">B. Keuangan</h4>
          <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Angka testid="k-nilai-po" label="Nilai PO" nilai={k.nilaiPO} definisi={defServer(k.definisi, "nilaiPO")} />
            <Angka testid="k-uang-muka" label="Uang muka dibayar" nilai={k.uangMukaDibayar} definisi={defServer(k.definisi, "uangMukaDibayar")} tebal />
            <Angka testid="k-ditagih" label="Sudah ditagih" nilai={k.sudahDitagih} definisi={defServer(k.definisi, "sudahDitagih")} />
            <Angka testid="k-diterapkan" label="Uang muka diterapkan" nilai={k.uangMukaDiterapkan} definisi={defServer(k.definisi, "uangMukaDiterapkan")} />
            <Angka testid="k-belum-diterapkan" label="Uang muka belum diterapkan" nilai={k.uangMukaBelumDiterapkan} definisi={defServer(k.definisi, "uangMukaBelumDiterapkan")} tone={k.uangMukaBelumDiterapkan > 0 ? "orange" : null} />
            <Angka testid="k-utang" label="Utang tercatat" nilai={k.utangTercatat} definisi={defServer(k.definisi, "utangTercatat")} />
            <Angka testid="k-dibayar" label="Sudah dibayar atas faktur" nilai={k.dibayarAtasFaktur} definisi={defServer(k.definisi, "dibayarAtasFaktur")} />
            <Angka testid="k-sisa-utang" label="Sisa utang" nilai={k.sisaUtang} definisi={defServer(k.definisi, "sisaUtang")} tebal />
            <Angka testid="k-sisa-komitmen" label="Sisa komitmen PO" nilai={k.sisaKomitmen} definisi={defServer(k.definisi, "sisaKomitmen")} tebal tone="orange" />
          </dl>
          {k.kelebihanPembayaran > 0 && <p className="m-0 mt-2 rounded-md bg-orangebg px-2.5 py-1.5 text-[12px] text-orange" role="status">Kelebihan pembayaran {formatUang(k.kelebihanPembayaran)} di atas nilai PO — menjadi Kredit Supplier (tanpa refund kas otomatis).</p>}
          <p className="m-0 mt-2 text-[11.5px] text-ink3">“Sisa komitmen PO” bukan utang: utang baru ada setelah faktur disetujui.</p>
        </section>
      )}
    </div>
  );
}

export function PeringatanUangMukaPO({ po }) {
  const w = po.keuangan?.peringatan;
  if (!w) return null;
  return (
    <div role="alert" data-testid="peringatan-uang-muka" className="flex items-start gap-2 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span><strong>Uang muka perlu dikembalikan atau dialihkan.</strong> {formatUang(po.keuangan.uangMukaBelumDiterapkan)} yang sudah dibayar belum diterapkan. Pembayarannya tidak dihapus — alihkan ke faktur supplier yang sama atau minta supplier mengembalikan.</span>
    </div>
  );
}

/** Daftar uang muka PO + penerapan ke faktur (admin: batalkan penerapan). */
export function DaftarUangMukaPO({ po, admin, onBatalkan }) {
  const k = po.keuangan;
  if (!k || (k.uangMuka.length === 0 && k.penerapan.length === 0)) return null;
  return (
    <section data-testid="seksi-uang-muka">
      <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">Uang muka supplier atas PO ini</h4>
      <TableWrap className="hidden md:block">
        <Table>
          <THead><TR><TH>Dokumen</TH><TH>Tanggal</TH><TH>Rekening</TH><TH numeric>Uang muka</TH><TH numeric title="Biaya admin bank — beban terpisah, bukan bagian uang muka">Biaya admin</TH><TH numeric>Diterapkan</TH><TH numeric>Belum diterapkan</TH><TH>Referensi</TH></TR></THead>
          <TBody>
            {k.uangMuka.map((d) => (
              <TR key={d.id}>
                <TD><span className="font-mono text-[12px] font-semibold">{d.nomor}</span>{d.melebihiPO && <Badge variant="orange" className="ml-1.5">Melebihi PO</Badge>}</TD>
                <TD>{tanggalPendek(String(d.tanggal).slice(0, 10))}</TD><TD>{d.rekening || "—"}</TD>
                <TD numeric><Uang value={d.nominal} /></TD><TD numeric><Uang value={d.biayaAdmin} /></TD><TD numeric><Uang value={d.diterapkan} /></TD>
                <TD numeric className={d.saldoBelumDiterapkan > 0 ? "font-semibold text-orange" : ""}><Uang value={d.saldoBelumDiterapkan} /></TD>
                <TD>{d.referensi || "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>
      <ul className="list-none space-y-2 p-0 md:hidden">
        {k.uangMuka.map((d) => (
          <li key={d.id} className="rounded-lg border border-line p-2.5 text-[12.5px]">
            <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[12px] font-semibold text-ink">{d.nomor}</span><span className="text-ink3">{tanggalPendek(String(d.tanggal).slice(0, 10))}</span>{d.melebihiPO && <Badge variant="orange">Melebihi PO</Badge>}</div>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
              <div><dt className="text-ink3">Uang muka</dt><dd className="ml-0 tabular-nums">{formatUang(d.nominal)}</dd></div>
              <div><dt className="text-ink3">Biaya admin</dt><dd className="ml-0 tabular-nums">{formatUang(d.biayaAdmin)}</dd></div>
              <div><dt className="text-ink3">Diterapkan</dt><dd className="ml-0 tabular-nums">{formatUang(d.diterapkan)}</dd></div>
              <div><dt className="text-ink3">Belum diterapkan</dt><dd className={cn("ml-0 tabular-nums", d.saldoBelumDiterapkan > 0 && "font-semibold text-orange")}>{formatUang(d.saldoBelumDiterapkan)}</dd></div>
              <div className="col-span-2"><dt className="text-ink3">Rekening · referensi</dt><dd className="ml-0">{d.rekening || "—"}{d.referensi ? ` · ${d.referensi}` : ""}</dd></div>
            </dl>
          </li>
        ))}
      </ul>
      {k.penerapan.length > 0 && (
        <ul className="mt-2 list-none space-y-1 p-0" data-testid="daftar-penerapan">
          {k.penerapan.map((a) => (
            <li key={a.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-inset px-2.5 py-1.5 text-[12px]", a.status !== "ACTIVE" && "opacity-60")}>
              <span className="font-mono font-semibold text-ink">{a.uangMuka.nomor}</span><span className="text-ink2">→ faktur {a.faktur.nomor}</span>
              <span className="ml-auto tabular-nums text-ink">{formatUang(a.jumlah)}</span>
              <Badge variant={a.status === "ACTIVE" ? "green" : "neutral"}>{a.status === "ACTIVE" ? "Diterapkan" : "Dibatalkan"}</Badge>
              {admin && a.status === "ACTIVE" && <Button size="sm" variant="neutral" onClick={() => onBatalkan(a)} className="max-sm:min-h-11" data-testid="batalkan-penerapan"><Undo2 size={12} /> Batalkan</Button>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-[11.5px] text-ink3">{KALIMAT_UANG_MUKA}</p>
    </section>
  );
}

// ── Bayar Uang Muka ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function ModalBayarUangMuka({ po, admin, onClose, onSaved }) {
  const k = po.keuangan;
  const [rekening, setRekening] = useState([]);
  const [f, setF] = useState({ amount: "", date: hariIniISO(), cashAccountId: "", reference: "", notes: "", receiptUrl: "", konfirmasiMelebihi: false, alasanMelebihi: "", ...BIAYA_KOSONG });
  const [galat, setGalat] = useState("");
  const kunciRef = useRef({ isi: "", kunci: "" });
  const set = (kunci, v) => setF((s) => ({ ...s, [kunci]: v }));
  useEffect(() => { api.getFinanceCashAccounts().then((r) => setRekening((r.accounts || []).filter((a) => a.active))).catch(() => setGalat("Gagal memuat daftar rekening")); }, []);

  const rek = rekening.find((r) => r.id === f.cashAccountId);
  const m = statusMelebihi({ nilaiPO: k.nilaiPO, uangMukaDibayar: k.uangMukaDibayar, nominal: f.amount });
  const siap = kesiapanBayarUangMuka({ f, rekeningLengkap: biayaTransferLengkap(rek, f), melebihi: m.melebihi, admin });
  const body = useMemo(() => bodyBayarUangMuka(f, { melebihi: m.melebihi }), [f, m.melebihi]);
  const kunciBayar = () => { const isi = JSON.stringify(body); if (kunciRef.current.isi !== isi) kunciRef.current = { isi, kunci: `um-${idKunci()}` }; return kunciRef.current.kunci; };
  const sisaSetelah = Math.max(0, k.nilaiPO - m.totalSesudah - k.dibayarAtasFaktur);

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()} title={`Bayar Uang Muka · ${po.poNumber}`} description={`${po.supplier.name} — barang belum perlu datang`} className="w-[600px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi
            disabled={!siap.siap} data-testid="simpan-uang-muka"
            confirmText={`Bayar uang muka ${formatUang(Number(f.amount) || 0)} ke ${po.supplier.name} dari ${rek?.name || "rekening terpilih"}? Uang keluar nyata dari rekening dan dicatat sebagai aset Uang Muka Supplier.`}
            onClick={async () => { setGalat(""); try { await api.bayarUangMukaPO(po.id, body, kunciBayar()); await onSaved(); } catch (e) { setGalat(e.message || "Gagal membayar uang muka"); } }}
          >
            <Wallet size={14} /> Bayar Uang Muka
          </TombolAksi>
        </>
      }
    >
      <div className="space-y-3" data-testid="form-uang-muka">
        <dl className="m-0 grid grid-cols-3 gap-3 rounded-lg bg-inset px-3 py-2.5 text-[12.5px]">
          <div><dt className="text-ink3">Nilai PO</dt><dd className="ml-0 tabular-nums font-medium">{formatUang(k.nilaiPO)}</dd></div>
          <div><dt className="text-ink3">Uang muka sudah dibayar</dt><dd className="ml-0 tabular-nums font-medium">{formatUang(k.uangMukaDibayar)}</dd></div>
          <div><dt className="text-ink3">Sisa komitmen setelah ini</dt><dd className="ml-0 tabular-nums font-semibold text-orange" data-testid="sisa-setelah">{formatUang(sisaSetelah)}</dd></div>
        </dl>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Nominal uang muka" required><InputUang value={f.amount} onChange={(v) => set("amount", v)} /></Field>
          <Field label="Tanggal pembayaran" required><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} /></Field>
        </div>
        <Field label="Dibayar dari rekening" required>
          <Pilihan value={f.cashAccountId} onChange={(v) => set("cashAccountId", v)}>
            <option value="">— pilih —</option>
            {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Pilihan>
        </Field>
        <CaraBayarTransfer rekening={rek} nominal={Number(f.amount) || 0} value={f} onChange={(b) => setF((s) => ({ ...s, ...b }))} />
        <Field label="Bukti transfer" required hint="Foto bukti transfer/nota — wajib">
          <PemilihBukti url={f.receiptUrl} onChange={(v) => set("receiptUrl", v)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Nomor referensi transfer"><Input value={f.reference} maxLength={120} onChange={(e) => set("reference", e.target.value)} /></Field>
          <Field label="Catatan"><Input value={f.notes} maxLength={500} onChange={(e) => set("notes", e.target.value)} placeholder="mis. permintaan supplier sebelum kirim" /></Field>
        </div>
        {m.melebihi && (
          <div role="alert" className="space-y-2 rounded-lg bg-redbg px-3 py-2.5 text-[12.5px] text-red" data-testid="peringatan-melebihi">
            <p className="m-0 font-semibold">Total uang muka {formatUang(m.totalSesudah)} melebihi nilai PO {formatUang(k.nilaiPO)} (lebih {formatUang(m.kelebihan)}).</p>
            {admin ? (
              <>
                <p className="m-0 text-ink2">Kelebihan menjadi Kredit Supplier — tidak ada refund kas otomatis. Hanya Admin Finance, dengan alasan tertulis.</p>
                <Field label="Alasan melebihi nilai PO" required><Input value={f.alasanMelebihi} onChange={(e) => set("alasanMelebihi", e.target.value)} data-testid="alasan-melebihi" /></Field>
                <label className="flex cursor-pointer items-start gap-2 text-ink"><input type="checkbox" checked={f.konfirmasiMelebihi} onChange={(e) => set("konfirmasiMelebihi", e.target.checked)} className="mt-0.5 h-4 w-4" data-testid="konfirmasi-melebihi" /><span>Saya paham uang muka ini melebihi nilai PO.</span></label>
              </>
            ) : <p className="m-0 text-ink2">Hanya Admin Finance yang boleh melebihi nilai PO. Kurangi nominal.</p>}
          </div>
        )}
        <p className="m-0 text-[12px] text-ink3">{KALIMAT_UANG_MUKA}</p>
        {!siap.siap && <p className="m-0 text-[12px] text-ink3" role="status" data-testid="pesan-siap-uang-muka">{siap.pesan}</p>}
        {galat && <p role="alert" className="m-0 rounded-lg bg-redbg px-3 py-1.5 text-[12.5px] text-red">{galat}</p>}
      </div>
    </Modal>
  );
}

// ── Terapkan uang muka ke faktur ────────────────────────────────────────────────────────────────────────────────────────
export function ModalTerapkanUangMuka({ billId, nomorFaktur, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [pilih, setPilih] = useState(null);
  const [nominal, setNominal] = useState("");
  const [catatan, setCatatan] = useState("");
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [konfirmasiBedaPO, setKonfirmasiBedaPO] = useState(false);
  const [galat, setGalat] = useState("");
  const kunciRef = useRef({ isi: "", kunci: "" });
  useEffect(() => { api.getKandidatUangMukaFaktur(billId).then((d) => { setData(d); const pertama = d.uangMuka[0]; if (pertama) { setPilih(pertama.id); setNominal(String(pertama.saran)); } }).catch((e) => setGalat(e.message || "Gagal memuat uang muka")); }, [billId]);

  const dp = data?.uangMuka.find((d) => d.id === pilih) || null;
  const sisa = data?.faktur.sisaUtang ?? 0;
  const siap = kesiapanTerapkan({ uangMuka: dp, nominal, sisaFaktur: sisa, konfirmasi, konfirmasiBedaPO });
  const kunciTerapkan = (body) => { const isi = JSON.stringify(body); if (kunciRef.current.isi !== isi) kunciRef.current = { isi, kunci: `umt-${idKunci()}` }; return kunciRef.current.kunci; };

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()} title={`Terapkan Uang Muka · ${nomorFaktur || data?.faktur.nomor || ""}`} description="Mengurangi sisa utang faktur. Tidak ada uang keluar." className="w-[560px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi
            disabled={!siap.siap} data-testid="simpan-penerapan"
            onClick={async () => { setGalat(""); try { const body = bodyTerapkanUangMuka({ uangMuka: dp, billId, nominal, sisaFaktur: sisa, konfirmasiBedaPO, catatan }); await api.terapkanUangMukaFaktur(body, kunciTerapkan(body)); await onSaved(); } catch (e) { setGalat(e.message || "Gagal menerapkan uang muka"); } }}
          >
            Terapkan Uang Muka
          </TombolAksi>
        </>
      }
    >
      {!data && !galat && <p className="text-[13px] text-ink3">Memuat…</p>}
      {data && (
        <div className="space-y-3" data-testid="form-terapkan">
          <dl className="m-0 grid grid-cols-2 gap-3 rounded-lg bg-inset px-3 py-2.5 text-[12.5px]">
            <div><dt className="text-ink3">Nilai faktur</dt><dd className="ml-0 tabular-nums font-medium">{formatUang(data.faktur.nilai)}</dd></div>
            <div><dt className="text-ink3">Sisa utang faktur sekarang</dt><dd className="ml-0 tabular-nums font-semibold">{formatUang(sisa)}</dd></div>
          </dl>
          {data.uangMuka.length === 0 ? (
            <p className="m-0 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange">Tidak ada uang muka yang belum diterapkan untuk supplier {data.faktur.supplier}.</p>
          ) : (
            <>
              <fieldset className="m-0 space-y-1.5 border-0 p-0">
                <legend className="mb-1 text-[12.5px] font-medium text-ink">Uang muka yang diterapkan</legend>
                {data.uangMuka.map((d) => (
                  <label key={d.id} className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 max-sm:min-h-11", pilih === d.id ? "border-accent bg-accentbg" : "border-line")}>
                    <input type="radio" name="uang-muka" checked={pilih === d.id} onChange={() => { setPilih(d.id); setNominal(String(d.saran)); setKonfirmasi(false); setKonfirmasiBedaPO(false); }} className="mt-1 h-4 w-4 shrink-0" />
                    <span className="min-w-0 text-[12.5px]"><span className="block font-medium text-ink">{d.nomor}{d.purchaseOrder ? ` · ${d.purchaseOrder.nomor}` : ""}{d.samaPO && <Badge variant="green" className="ml-1.5">PO sama</Badge>}</span><span className="block text-ink3">Belum diterapkan {formatUang(d.saldoBelumDiterapkan)} dari {formatUang(d.nominal)}</span></span>
                  </label>
                ))}
              </fieldset>
              <Field label="Nominal diterapkan" required hint={dp ? `Maksimal ${formatUang(Math.min(dp.saldoBelumDiterapkan, sisa))} (saldo uang muka atau sisa faktur, mana yang lebih kecil)` : undefined}>
                <InputUang value={nominal} onChange={(v) => { setNominal(v); setKonfirmasi(false); }} max={dp ? Math.min(dp.saldoBelumDiterapkan, sisa) : undefined} />
              </Field>
              <Field label="Catatan"><Input value={catatan} maxLength={300} onChange={(e) => setCatatan(e.target.value)} /></Field>
              {dp && Number(nominal) > 0 && (
                <p className="m-0 rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink2" data-testid="pratinjau-penerapan">Jurnal: Dr Utang Usaha / Cr Uang Muka Supplier {formatUang(Number(nominal))}. Sisa utang faktur {formatUang(sisa)} → <strong className="text-ink">{formatUang(Math.max(0, sisa - Number(nominal)))}</strong>. Saldo uang muka {formatUang(dp.saldoBelumDiterapkan)} → <strong className="text-ink">{formatUang(Math.max(0, dp.saldoBelumDiterapkan - Number(nominal)))}</strong>.</p>
              )}
              {dp?.bedaPO && (
                <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange"><input type="checkbox" checked={konfirmasiBedaPO} onChange={(e) => setKonfirmasiBedaPO(e.target.checked)} className="mt-0.5 h-4 w-4" data-testid="konfirmasi-beda-po" /><span>Uang muka ini dibayar untuk {dp.purchaseOrder?.nomor}, bukan PO faktur ini. Saya konfirmasi pengalihan.</span></label>
              )}
              <label className="flex cursor-pointer items-start gap-2 text-[12.5px] text-ink"><input type="checkbox" checked={konfirmasi} onChange={(e) => setKonfirmasi(e.target.checked)} className="mt-0.5 h-4 w-4" data-testid="konfirmasi-penerapan" /><span>Saya sudah memeriksa pratinjau dan mengonfirmasi penerapan uang muka ini ke faktur.</span></label>
              {!siap.siap && <p className="m-0 text-[12px] text-ink3" role="status">{siap.pesan}</p>}
            </>
          )}
        </div>
      )}
      {galat && <p role="alert" className="mt-2 rounded-lg bg-redbg px-3 py-1.5 text-[12.5px] text-red">{galat}</p>}
    </Modal>
  );
}
