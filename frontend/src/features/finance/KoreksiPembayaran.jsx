import React, { useEffect, useRef, useState } from "react";
import { ShieldCheck, ArrowRight, Upload, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import { api } from "@/api.js";
import OrderPicker from "@/features/finance/OrderPicker.jsx";
import { PratinjauKoreksi, usePinStepUp, perluPin, lupakanStepUp, tampilNilai, LABEL_FIELD } from "@/features/finance/KoreksiAman.jsx";
import { Pilihan, InputUang, formatUang, tanggalJam, tanggalPendek } from "@/features/finance/shared.jsx";

// B3.7 — KOREKSI PEMBAYARAN MASUK TERVERIFIKASI (dialog UI). Semua aturan ditegakkan dan dihitung SERVER; komponen ini hanya menampilkan:
//  • Lihat Detail        — baca saja.
//  • Edit Informasi      — bukti, catatan, nomor referensi, keterangan internal. Tanpa jurnal; audit sebelum/sesudah.
//  • Koreksi Pembayaran  — nominal, tanggal, rekening, metode, order, alokasi. WAJIB pratinjau server lebih dulu, alasan, lalu PIN di langkah terakhir.
//  • Riwayat Perubahan   — rantai versi, audit, rantai jurnal.

const LABEL_METODE = { TRANSFER: "Transfer", CASH: "Tunai", QRIS: "QRIS", CARD: "Kartu" };
const tglWIB = (t) => new Date(new Date(t).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const kunciBaru = (awalan) => `${awalan}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}`;

function Baris({ label, children }) {
  return (
    <div className="grid grid-cols-1 gap-x-3 rounded-lg bg-inset px-3 py-2 text-[12.5px] sm:grid-cols-[150px_1fr]">
      <div className="text-ink3">{label}</div>
      <div className="min-w-0 break-words">{children || <span className="text-ink3">—</span>}</div>
    </div>
  );
}

const tombolModal = "max-sm:min-h-11 max-sm:px-4";

// ─── Lihat Detail ────────────────────────────────────────────────────────────────────────────────
export function DetailPembayaranDialog({ p, onClose }) {
  const status = p.cancelledAt ? (p.replacedBy ? "Diganti versi baru" : "Dibatalkan") : p.terverifikasi ? "Sudah diverifikasi" : "Menunggu verifikasi";
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()} title="Detail Pembayaran" description={`${formatUang(p.amount)} · ${tanggalJam(p.createdAt)}`}
      className="w-[560px]" footer={<Button variant="neutral" onClick={onClose} className={tombolModal}>Tutup</Button>}
    >
      <div className="space-y-1.5">
        <Baris label="Status"><Badge variant={p.cancelledAt ? "red" : p.terverifikasi ? "green" : "orange"}>{status}</Badge></Baris>
        <Baris label="Order">{p.order?.orderNumber} · {p.order?.customer?.name}</Baris>
        <Baris label="Nominal">{formatUang(p.amount)}</Baris>
        <Baris label="Metode">{LABEL_METODE[p.method] || p.method}</Baris>
        <Baris label="Rekening penerima">{p.cashAccount?.name || "Rekening standar cara bayar"}</Baris>
        <Baris label="Dibagi ke order">
          {p.finAllocations?.length ? p.finAllocations.map((a) => <span key={a.id} className="block">{a.order?.orderNumber}: {formatUang(a.amount)}</span>) : null}
        </Baris>
        <Baris label="Dicatat oleh">{p.recordedBy?.name}</Baris>
        <Baris label="Diverifikasi oleh">{p.verifications?.[0] ? `${p.verifications[0].verifiedBy?.name || "—"} · ${tanggalJam(p.verifications[0].createdAt)}` : null}</Baris>
        <Baris label="Nomor referensi">{p.referenceNumber}</Baris>
        <Baris label="Catatan">{p.notes}</Baris>
        <Baris label="Keterangan internal">{p.internalNote}</Baris>
        {p.cancelledAt && <Baris label="Alasan">{p.cancelReason}</Baris>}
      </div>
    </Modal>
  );
}

// ─── Edit Informasi ──────────────────────────────────────────────────────────────────────────────
export function EditInfoDialog({ p, onClose, onSaved }) {
  const awal = { notes: p.notes || "", referenceNumber: p.referenceNumber || "", internalNote: p.internalNote || "", proofPhotoUrl: p.proofPhotoUrl || "" };
  const [f, setF] = useState(awal);
  const [alasan, setAlasan] = useState("");
  const [galat, setGalat] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [unggah, setUnggah] = useState(false);
  const kunci = useRef(kunciBaru("bayar-info"));
  const inputFoto = useRef(null);

  const beda = {};
  for (const k of Object.keys(awal)) if (f[k] !== awal[k]) beda[k] = f[k] || null;
  const valid = Object.keys(beda).length > 0 && alasan.trim();
  const set = (k, v) => { setF((s) => ({ ...s, [k]: v })); kunci.current = kunciBaru("bayar-info"); };

  async function pilihFoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUnggah(true); setGalat("");
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const r = await api.uploadPaymentProof(p.orderId, fd);
      set("proofPhotoUrl", r.url);
    } catch (err) { setGalat(err.message); } finally { setUnggah(false); e.target.value = ""; }
  }

  async function simpan() {
    setSibuk(true); setGalat("");
    try { await api.editInfoPembayaran(p.id, { ...beda, reason: alasan.trim() }, kunci.current); onSaved(); } catch (e) { setGalat(e.message); } finally { setSibuk(false); }
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()} title="Edit Informasi Pembayaran" description={`${p.order?.orderNumber || ""} · ${formatUang(p.amount)}`}
      className="w-[560px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className={tombolModal}>Batal</Button>
          <Button onClick={simpan} disabled={!valid || sibuk || unggah} className={tombolModal}>{sibuk ? <Loader2 size={14} className="animate-spin" /> : null}Simpan</Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="rounded-lg bg-accentbg px-3 py-2 text-[12.5px] leading-relaxed text-ink2">
          Hanya informasi pendukung. <strong>Tidak membuat jurnal</strong> dan tidak mengubah nominal, rekening, atau saldo. Perubahan tercatat (sebelum/sesudah, siapa, kapan, alasan).
        </p>
        <Field label="Nomor referensi"><Input value={f.referenceNumber} maxLength={100} onChange={(e) => set("referenceNumber", e.target.value)} placeholder="mis. nomor transaksi bank" /></Field>
        <Field label="Catatan"><Input value={f.notes} maxLength={1000} onChange={(e) => set("notes", e.target.value)} /></Field>
        <Field label="Keterangan internal" hint="Hanya untuk tim Finance"><Input value={f.internalNote} maxLength={1000} onChange={(e) => set("internalNote", e.target.value)} /></Field>
        <Field label="Bukti pembayaran">
          <div className="flex flex-wrap items-center gap-2">
            {f.proofPhotoUrl ? <img src={f.proofPhotoUrl} alt="Bukti pembayaran" className="h-16 w-16 rounded-lg border border-line object-cover" /> : <span className="text-[12.5px] text-ink3">Belum ada bukti</span>}
            <input ref={inputFoto} type="file" accept="image/*" className="hidden" onChange={pilihFoto} />
            <Button size="sm" variant="neutral" onClick={() => inputFoto.current?.click()} disabled={unggah} className="max-sm:min-h-11">
              {unggah ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}{f.proofPhotoUrl ? "Ganti foto" : "Unggah foto"}
            </Button>
            {f.proofPhotoUrl && <Button size="sm" variant="tertiary" onClick={() => set("proofPhotoUrl", "")} className="max-sm:min-h-11">Hapus foto</Button>}
          </div>
        </Field>
        <Field label="Alasan perubahan" required hint="Wajib — tercatat di riwayat audit">
          <Input value={alasan} maxLength={500} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. melengkapi nomor referensi dari mutasi bank" />
        </Field>
        {galat && <p className="text-[13px] text-red">{galat}</p>}
      </div>
    </Modal>
  );
}

// ─── Koreksi Pembayaran ──────────────────────────────────────────────────────────────────────────
function DampakStatus({ pratinjau }) {
  const baris = (pratinjau.dampakStatus || []).filter((d) => d.statusLama !== d.statusBaru || (d.paidAtLama ? 1 : 0) !== (d.paidAtBaru ? 1 : 0));
  return (
    <div className="space-y-3">
      {(pratinjau.alokasiLama?.length > 0 || pratinjau.alokasiBaru?.length > 0) && (
        <div>
          <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.05em] text-ink3">Alokasi ke order</div>
          <div className="space-y-1 text-[12.5px]">
            <div className="rounded-lg bg-inset px-3 py-2"><span className="text-ink3">Lama: </span><span className="line-through text-ink3">{pratinjau.alokasiLama?.join("; ") || "order ini saja"}</span></div>
            <div className="rounded-lg bg-inset px-3 py-2"><span className="text-ink3">Baru: </span><strong>{pratinjau.alokasiBaru?.join("; ") || "order ini saja"}</strong></div>
          </div>
        </div>
      )}
      <div>
        <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.05em] text-ink3">Status bayar order terkait</div>
        {baris.length === 0
          ? <p className="rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink2">Status bayar order tidak berubah.</p>
          : (
            <div className="space-y-1">
              {baris.map((d) => (
                <div key={d.orderId} className="flex flex-wrap items-center justify-between gap-x-3 rounded-lg bg-inset px-3 py-2 text-[12.5px]">
                  <span className="font-medium">{d.nomor}</span>
                  <span className="tabular-nums"><span className="text-ink3">{d.statusLama}</span> <ArrowRight size={11} className="inline" /> <strong>{d.statusBaru}</strong></span>
                </div>
              ))}
            </div>
          )}
      </div>
      {pratinjau.reklasUangMuka?.length > 0 && (
        <p className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] leading-relaxed text-ink2">
          Pendapatan order ini sudah diakui, jadi uang muka lamanya dipindah kembali ke Piutang lewat jurnal reklasifikasi ({formatUang(pratinjau.reklasUangMuka.reduce((s, r) => s + r.jumlah, 0))}) — ikut tercantum sebagai jurnal pengganti di atas.
        </p>
      )}
    </div>
  );
}

export function KoreksiPembayaranDialog({ p, onClose, onSaved }) {
  const adaAlokasi = (p.finAllocations?.length ?? 0) > 0;
  const awal = { amount: String(p.amount), tanggal: tglWIB(p.createdAt), cashAccountId: p.cashAccount?.id || "", method: p.method, orderId: p.orderId };
  const [f, setF] = useState(awal);
  const [baris, setBaris] = useState(() => (adaAlokasi ? p.finAllocations.map((a) => ({ orderId: a.orderId, nomor: a.order?.orderNumber || "", amount: String(a.amount) })) : []));
  const [alasan, setAlasan] = useState("");
  const [akun, setAkun] = useState([]);
  const [pratinjau, setPratinjau] = useState(null);
  const [galat, setGalat] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const kunci = useRef({ isi: "", key: "" });
  const { minta, dialogPin } = usePinStepUp();

  useEffect(() => { api.getFinanceCashAccounts().then((r) => setAkun((r?.accounts || r || []).filter((a) => a.active !== false))).catch(() => {}); }, []);

  const beda = {};
  if (Number(f.amount) !== p.amount) beda.amount = Number(f.amount);
  if (f.tanggal !== awal.tanggal) beda.tanggal = f.tanggal;
  if ((f.cashAccountId || "") !== awal.cashAccountId && f.cashAccountId) beda.cashAccountId = f.cashAccountId;
  if (f.method !== p.method) beda.method = f.method;
  if (!adaAlokasi && f.orderId !== p.orderId) beda.orderId = f.orderId;
  const alokasiBerubah = adaAlokasi && baris.some((b, i) => Number(b.amount) !== Math.round(Number(p.finAllocations[i].amount)));
  if (alokasiBerubah) beda.alokasi = baris.map((b) => ({ orderId: b.orderId, amount: Number(b.amount) }));
  const totalAlokasi = baris.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const alokasiSama = !alokasiBerubah || totalAlokasi === Number(f.amount);
  const valid = Object.keys(beda).length > 0 && alasan.trim() && Number(f.amount) > 0 && alokasiSama;

  const ubah = (k, v) => { setF((s) => ({ ...s, [k]: v })); setPratinjau(null); };
  const ubahBaris = (i, v) => { setBaris((s) => s.map((b, idx) => (idx === i ? { ...b, amount: v } : b))); setPratinjau(null); };

  async function tinjau() {
    setGalat(""); setSibuk(true);
    try { const r = await api.koreksiPembayaran(p.id, { ...beda, reason: alasan.trim(), preview: true }); setPratinjau(r.pratinjau); } catch (e) { setGalat(e.message); } finally { setSibuk(false); }
  }

  async function simpan() {
    setGalat(""); setSibuk(true);
    const body = { ...beda, reason: alasan.trim() };
    const isi = JSON.stringify(body);
    if (kunci.current.isi !== isi) kunci.current = { isi, key: kunciBaru("bayar-koreksi") }; // isi sama → kunci sama (klik ulang/coba lagi tidak menggandakan)
    try {
      for (let percobaan = 0; percobaan < 2; percobaan++) {
        const token = await minta();
        if (!token) return;
        try {
          await api.koreksiPembayaran(p.id, body, { stepUp: token, idempotencyKey: kunci.current.key });
          onSaved();
          return;
        } catch (e) {
          if (perluPin(e) && percobaan === 0) { lupakanStepUp(); continue; }
          throw e;
        }
      }
    } catch (e) { setGalat(e.message); } finally { setSibuk(false); }
  }

  return (
    <>
      <Modal
        open onOpenChange={(v) => !v && onClose()} title="Koreksi Pembayaran"
        description={`${p.order?.orderNumber || ""} · ${formatUang(p.amount)} · ${tanggalJam(p.createdAt)}`} className="w-[640px]"
        footer={
          <>
            <Button variant="neutral" onClick={pratinjau ? () => setPratinjau(null) : onClose} className={tombolModal}>{pratinjau ? "Kembali" : "Batal"}</Button>
            {pratinjau
              ? <Button onClick={simpan} disabled={sibuk || !pratinjau.seimbang} className={tombolModal}><ShieldCheck size={14} />Simpan Koreksi</Button>
              : <Button onClick={tinjau} disabled={!valid || sibuk} className={tombolModal}>{sibuk ? <Loader2 size={14} className="animate-spin" /> : null}Lihat Pratinjau</Button>}
          </>
        }
      >
        <div className="space-y-3">
          {pratinjau ? (
            <>
              <p className="text-[12.5px] text-ink2"><strong>Alasan:</strong> {alasan}</p>
              <PratinjauKoreksi pratinjau={pratinjau} />
              <DampakStatus pratinjau={pratinjau} />
              <p className="text-[12px] text-ink3">Tombol Simpan Koreksi akan meminta PIN Finance Anda. Pembayaran lama tidak dihapus — tetap tersimpan di Riwayat Perubahan.</p>
            </>
          ) : (
            <>
              <p className="rounded-lg bg-accentbg px-3 py-2 text-[12.5px] leading-relaxed text-ink2">
                Pembayaran ini sudah masuk buku besar. Koreksi <strong>membalik jurnal lama</strong> dan membuat <strong>versi pembayaran pengganti</strong> dengan jurnal baru. Yang lama tetap tersimpan sebagai riwayat, tidak dihapus.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Nominal" required><InputUang value={f.amount} onChange={(v) => ubah("amount", v)} /></Field>
                <Field label="Tanggal pembayaran"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.tanggal} onChange={(v) => ubah("tanggal", v || awal.tanggal)} /></Field>
                <Field label="Rekening penerima">
                  <Pilihan value={f.cashAccountId} onChange={(v) => ubah("cashAccountId", v)}>
                    <option value="">{p.cashAccount ? p.cashAccount.name : "Rekening standar cara bayar"}</option>
                    {akun.filter((a) => a.id !== p.cashAccount?.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </Pilihan>
                </Field>
                <Field label="Metode pembayaran">
                  <Pilihan value={f.method} onChange={(v) => ubah("method", v)}>
                    {Object.entries(LABEL_METODE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Pilihan>
                </Field>
              </div>
              {adaAlokasi ? (
                <div className="space-y-2">
                  <div className="text-[12px] font-medium uppercase tracking-[0.05em] text-ink3">Pembagian ke order</div>
                  {baris.map((b, i) => (
                    <div key={b.orderId} className="grid grid-cols-[1fr_150px] items-center gap-2">
                      <span className="truncate text-[13px]">{b.nomor}</span>
                      <InputUang value={b.amount} onChange={(v) => ubahBaris(i, v)} />
                    </div>
                  ))}
                  <p className={`rounded-lg px-3 py-2 text-[12.5px] ${alokasiSama ? "bg-inset text-ink2" : "bg-orangebg text-orange"}`}>
                    {alokasiBerubah
                      ? `Total pembagian ${formatUang(totalAlokasi)} dari nominal ${formatUang(Number(f.amount) || 0)}${alokasiSama ? "" : " — harus sama persis."}`
                      : "Bila nominal diubah dan pembagian tidak diubah, sistem membagi ulang proporsional otomatis (pembulatan tepat)."}
                  </p>
                  <p className="text-[12px] text-ink3">Order tujuan tidak bisa diganti dari sini untuk pembayaran yang dibagi (termasuk Resi). Ubah nominal per baris saja.</p>
                </div>
              ) : (
                <Field label="Untuk order" hint="Pindahkan uang ke order lain bila salah pilih order">
                  <OrderPicker
                    value={f.orderId} onChange={(id) => ubah("orderId", id || p.orderId)}
                    saran={p.order ? [{ id: p.orderId, orderNumber: p.order.orderNumber, customerName: p.order.customer?.name, value: p.order.value, paymentStatus: p.order.paymentStatus }] : []}
                    saranLabel="Order asal pembayaran ini" placeholder="Cari order…"
                  />
                </Field>
              )}
              <Field label="Alasan koreksi" required hint="Wajib — tercatat di riwayat audit">
                <Input value={alasan} maxLength={500} onChange={(e) => { setAlasan(e.target.value); setPratinjau(null); }} placeholder="mis. salah ketik nominal saat verifikasi" />
              </Field>
              {Object.keys(beda).length === 0 && <p className="text-[12px] text-ink3">Ubah minimal satu isian untuk melanjutkan.</p>}
            </>
          )}
          {galat && <p className="text-[13px] leading-relaxed text-red">{galat}</p>}
        </div>
      </Modal>
      {dialogPin}
    </>
  );
}

// ─── Riwayat Perubahan ───────────────────────────────────────────────────────────────────────────
const WARNA_VERSI = { AKTIF: "green", DIGANTI: "orange", DIBATALKAN: "red" };
const LABEL_VERSI = { AKTIF: "Aktif", DIGANTI: "Diganti", DIBATALKAN: "Dibatalkan" };

export function RiwayatPembayaranDialog({ p, onClose }) {
  const [data, setData] = useState(null);
  const [galat, setGalat] = useState("");
  useEffect(() => { api.getRiwayatPembayaran(p.id).then(setData).catch((e) => setGalat(e.message)); }, [p.id]);
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()} title="Riwayat Perubahan Pembayaran" description="Versi pembayaran, siapa mengubah apa dan mengapa, serta rantai jurnalnya."
      className="w-[680px]" footer={<Button variant="neutral" onClick={onClose} className={tombolModal}>Tutup</Button>}
    >
      {galat && <p className="text-[13px] text-red">{galat}</p>}
      {!data && !galat && <p className="text-[13px] text-ink3">Memuat…</p>}
      {data && (
        <div className="space-y-4">
          <div>
            <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.05em] text-ink3">Versi pembayaran</div>
            <div className="space-y-1.5">
              {data.versi.map((v) => (
                <div key={v.id} className="rounded-lg bg-inset px-3 py-2 text-[12.5px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">Versi {v.nomorVersi} · {formatUang(v.nominal)}</span>
                    <Badge variant={WARNA_VERSI[v.status]}>{LABEL_VERSI[v.status]}{v.terbaru && v.status === "AKTIF" ? " (terbaru)" : ""}</Badge>
                  </div>
                  <div className="mt-0.5 text-ink3">{tanggalPendek(v.tanggal)} · {LABEL_METODE[v.metode] || v.metode} · {v.rekening || "rekening standar"} · {v.order}</div>
                  {v.alokasi.length > 0 && <div className="text-ink2">Dibagi: {v.alokasi.map((a) => `${a.order}: ${formatUang(a.nominal)}`).join("; ")}</div>}
                  {v.alasanBatal && <div className="text-ink2">{v.alasanBatal}</div>}
                </div>
              ))}
            </div>
          </div>
          {data.peristiwa.length > 0 && (
            <div>
              <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.05em] text-ink3">Perubahan</div>
              <div className="space-y-1.5">
                {data.peristiwa.map((e, i) => (
                  <div key={i} className="rounded-lg bg-inset px-3 py-2 text-[12.5px]">
                    <div className="flex flex-wrap items-center justify-between gap-x-3">
                      <span className="font-medium">{e.aksi}</span><span className="text-ink3">{tanggalJam(e.waktu)} · {e.aktor}</span>
                    </div>
                    {e.alasan && <p className="mt-0.5 text-ink2">Alasan: {e.alasan}</p>}
                    {e.perubahan.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {e.perubahan.map((c) => (
                          <li key={c.field} className="break-words">
                            <span className="text-ink3">{LABEL_FIELD[c.field] || c.field}:</span>{" "}
                            <span className="text-ink3 line-through">{tampilNilai(c.field, c.lama)}</span> → <strong>{tampilNilai(c.field, c.baru)}</strong>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {data.jurnal.length > 0 && (
            <div>
              <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.05em] text-ink3">Rantai jurnal</div>
              <div className="space-y-1">
                {data.jurnal.map((j) => (
                  <div key={j.id} className="rounded-lg bg-inset px-3 py-2 text-[12.5px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono">{j.nomor}</span>
                      <Badge variant={j.status === "REVERSED" ? "red" : "green"}>{j.status === "REVERSED" ? "Dibalik" : "Aktif"}</Badge>
                    </div>
                    <div className="text-ink3">{tanggalPendek(j.tanggal)} · {j.deskripsi}</div>
                    {j.membalikJurnal && <div className="text-ink2">Membalik {j.membalikJurnal}</div>}
                    {j.dibalikOleh && <div className="text-ink2">Dibalik oleh {j.dibalikOleh}{j.alasanBalik ? ` — ${j.alasanBalik}` : ""}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
