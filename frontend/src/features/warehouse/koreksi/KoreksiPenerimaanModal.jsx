import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Eye, Send, TriangleAlert } from "lucide-react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { adaPerubahan, bodyPerubahan, formKoreksiAwal, galatForm, JENIS_OPERASI, kalimatDampak, LABEL_BIDANG, mengubahStok } from "./koreksiLogic.js";

const kunciBaru = () => `koreksi-gr-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;

/** Panel dampak: SEMUA angka dari server (pratinjau read-only). */
export function DampakKoreksiGR({ hasil }) {
  if (!hasil) return null;
  if (!hasil.boleh) {
    return (
      <div className="space-y-2 rounded-lg border-l-[3px] border-red bg-redbg px-3 py-2.5 text-[12.5px]" data-testid="dampak-blokir" role="alert">
        <div className="flex items-center gap-1.5 font-semibold text-red"><TriangleAlert size={14} /> Koreksi diblokir — tidak dipaksakan</div>
        <ul className="m-0 list-none space-y-2 p-0">
          {hasil.penghalang.map((p, i) => (
            <li key={i} data-testid="penghalang" data-kode={p.kode}>
              <div className="font-semibold text-ink">{p.bahan ? `${p.bahan}: ` : ""}{p.pesan} <span className="font-normal text-ink3">({p.kode})</span></div>
              <div className="text-ink2">Jalan keluar: {p.langkah}</div>
              {Array.isArray(p.detail) && p.detail.length > 0 && <div className="text-[11.5px] text-ink3">Rincian: {p.detail.map((d) => d.nomor ? `${d.nomor} (${d.status})` : `${d.jenis} ${d.qty}`).join("; ")}</div>}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-line bg-inset px-3 py-2.5 text-[12.5px]" data-testid="dampak-koreksi">
      <div className="font-semibold text-ink">{hasil.kind === "STOCK" ? "Koreksi stok" : "Koreksi data"} — {kalimatDampak(hasil)}</div>
      {hasil.baris.filter((b) => b.stok).map((b) => (
        <div key={b.barisId} data-testid="dampak-baris">
          <div className="font-medium text-ink">{b.kode} — {b.nama}</div>
          <div className="text-ink2">Jumlah baik {b.sebelum.jumlahBaik} → {b.sesudah.jumlahBaik} {b.satuan}{b.sesudah.bahan !== b.sebelum.bahan ? ` · bahan ${b.sebelum.bahan} → ${b.sesudah.bahan}` : ""}{b.sesudah.lokasi !== b.sebelum.lokasi ? ` · lokasi ${b.sebelum.lokasi} → ${b.sesudah.lokasi}` : ""}</div>
          {b.saldo && <div className="text-ink3">Saldo bahan asal {b.saldo.sebelum} → {b.saldo.sesudah} (tersedia {b.saldo.tersedia}, reservasi {b.saldo.reservasi})</div>}
        </div>
      ))}
      {hasil.operasi.length > 0 && (
        <ul className="m-0 list-disc space-y-0.5 pl-4 text-ink2" data-testid="dampak-operasi">
          {hasil.operasi.map((o, i) => <li key={i}>{JENIS_OPERASI[o.jenis] ?? o.jenis}: {o.qty > 0 ? "+" : ""}{o.qty} · {o.kode} · lokasi {o.lokasi}</li>)}
        </ul>
      )}
      <p className="m-0 text-[11.5px] text-ink3">Jurnal, pembayaran, dan tagihan Finance tidak ditulis. QC, penerimaan fisik, dan pemakaian Produksi tidak dibuat.</p>
    </div>
  );
}

export default function KoreksiPenerimaanModal({ receiptId, onClose, onDone }) {
  const [keadaan, setKeadaan] = useState(null);
  const [form, setForm] = useState(null);
  const [bahan, setBahan] = useState([]); // kandidat bahan pengganti (aktif)
  const [galat, setGalat] = useState("");
  const [memuat, setMemuat] = useState(false);
  const [dampak, setDampak] = useState(null);
  const [bodyDampak, setBodyDampak] = useState("");
  const [hasil, setHasil] = useState(null);
  const kunci = useRef(kunciBaru());

  useEffect(() => {
    let batal = false;
    // Katalog bahan dari stok (inventory:read) — Gudang tidak harus memegang izin master bahan.
    Promise.all([api.getKeadaanKoreksiGR(receiptId), api.getStock().catch(() => [])]).then(([k, m]) => {
      if (batal) return; setKeadaan(k); setForm(formKoreksiAwal(k));
      setBahan((Array.isArray(m) ? m : m?.stock ?? []).filter((x) => x.active !== false).map((x) => ({ id: x.materialId ?? x.id, code: x.code, name: x.name, unit: x.unit })));
    }).catch((e) => !batal && setGalat(e.message));
    return () => { batal = true; };
  }, [receiptId]);

  const perubahan = useMemo(() => (form && keadaan ? bodyPerubahan(form, keadaan) : {}), [form, keadaan]);
  const bodyKini = JSON.stringify(perubahan);
  const galatDini = form && keadaan ? galatForm(form, keadaan) : "";
  const dampakBerlaku = dampak && bodyDampak === bodyKini ? dampak : null;
  const stok = mengubahStok(perubahan);

  function setMeta(k, v) { setForm((f) => ({ ...f, metadata: { ...f.metadata, [k]: v } })); }
  function setBaris(i, patch) { setForm((f) => ({ ...f, baris: f.baris.map((b, x) => (x === i ? { ...b, ...patch } : b)) })); }

  async function lihatDampak() {
    if (!adaPerubahan(perubahan)) return; setMemuat(true); setGalat("");
    try { const h = await api.pratinjauKoreksiGR(receiptId, perubahan); setDampak(h); setBodyDampak(bodyKini); } catch (e) { setGalat(e.message); } finally { setMemuat(false); }
  }
  async function ajukan() {
    if (galatDini || !dampakBerlaku?.boleh) return; setMemuat(true); setGalat("");
    try { setHasil(await api.ajukanKoreksiGR(receiptId, { perubahan, alasan: form.alasan.trim() }, kunci.current)); }
    catch (e) { setGalat(e.message); kunci.current = kunciBaru(); } finally { setMemuat(false); }
  }

  const judul = keadaan ? `Koreksi Penerimaan — ${keadaan.penerimaan.nomor}` : "Koreksi Penerimaan";
  if (hasil) {
    const menunggu = hasil.status === "PENDING_APPROVAL";
    return (
      <Modal open onOpenChange={(v) => !v && (onDone(hasil), onClose())} title={judul} className="w-[560px]" footer={<div className="flex w-full justify-end"><Button onClick={() => { onDone(hasil); onClose(); }} data-testid="tutup-hasil">Selesai</Button></div>}>
        <div className="space-y-2 text-[12.5px]" data-testid="hasil-koreksi">
          <p className="m-0 font-semibold text-ink">{menunggu ? `Koreksi ${hasil.nomor} diajukan dan menunggu persetujuan orang lain.` : `Koreksi ${hasil.nomor} sudah dicatat.`}</p>
          <p className="m-0 text-ink2">{menunggu ? "Stok belum berubah. Penyetuju (Owner/Finance yang berbeda dari pemohon) menyetujui di Barang Rusak, Retur & Penyesuaian → Koreksi Dokumen. Anda dapat membatalkannya selama menunggu." : "Catatan asal tetap terlihat; perubahan tercatat sebelum–sesudah."}</p>
          {hasil.ulang && <p className="m-0 text-ink3">Permintaan yang sama sudah pernah dikirim — ini hasil yang sama (tidak digandakan).</p>}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()} title={judul} className="w-[720px]"
      description="Catatan asal TIDAK diubah atau dihapus. Koreksi data langsung tercatat; koreksi jumlah, bahan, atau lokasi mengubah stok sehingga memerlukan persetujuan orang lain. Lihat dampaknya dulu."
      footer={
        <div className="flex w-full flex-col gap-2">
          {(galat || (galatDini && form?.alasan)) && <p role="alert" data-testid="galat-koreksi" className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] leading-snug text-orange">{galat || galatDini}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={onClose}>Batal</Button>
            <Button variant="neutral" disabled={!!galatDini || memuat || !keadaan} onClick={lihatDampak} data-testid="lihat-dampak">{memuat ? "Menghitung…" : <><Eye size={14} /> Lihat Dampak</>}</Button>
            <Button disabled={!!galatDini || !dampakBerlaku?.boleh || memuat} onClick={ajukan} data-testid="ajukan-koreksi"><Send size={14} /> {stok ? "Ajukan Koreksi Stok" : "Simpan Koreksi Data"}</Button>
          </div>
        </div>
      }
    >
      {!form ? (
        <p className="flex items-center gap-1.5 text-[12.5px] text-ink3">{galat ? galat : <><Loader2 size={14} className="animate-spin" /> Memuat…</>}</p>
      ) : !keadaan.bisaMengajukan ? (
        <p className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="tidak-bisa-ajukan">{keadaan.penerimaan.status !== "COMPLETED" ? "Penerimaan belum masuk stok — ubah isian lewat alur biasa (draf boleh diedit)." : "Masih ada koreksi lain yang menunggu persetujuan untuk penerimaan ini. Selesaikan dulu."}</p>
      ) : (
        <div className="space-y-3">
          {keadaan.penerimaan.dariPO && <p className="rounded-lg bg-accentbg px-3 py-2 text-[12px] text-accent" data-testid="info-dari-po">Penerimaan dari PO: hanya <strong>catatan</strong> dan <strong>kondisi/catatan baris</strong> yang bisa dikoreksi di sini. Jumlah, supplier, referensi, dan surat jalan memakai Koreksi Kedatangan (resmi).</p>}
          <fieldset className="space-y-2 rounded-lg border border-line p-2.5">
            <legend className="px-1 text-[11px] font-bold uppercase tracking-wide text-ink3">Data dokumen (stok tidak berubah)</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {keadaan.bidangMetadata.map((k) => (
                <Field key={k} label={LABEL_BIDANG[k] ?? k}>
                  <Input type={k === "receivedDate" ? "date" : "text"} value={form.metadata[k]} onChange={(e) => setMeta(k, e.target.value)} aria-label={`Koreksi ${LABEL_BIDANG[k] ?? k}`} data-testid={`meta-${k}`} />
                </Field>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2 rounded-lg border border-line p-2.5">
            <legend className="px-1 text-[11px] font-bold uppercase tracking-wide text-ink3">Baris item</legend>
            {form.baris.map((b, i) => (
              <div key={b.barisId} className="rounded-lg border border-line p-2" data-testid="baris-koreksi">
                <div className="flex flex-wrap items-center gap-2 text-[12.5px]"><span className="font-semibold text-ink">{b.kode}</span><span className="text-ink2">{b.nama}</span><Badge variant="neutral">{b.satuan}</Badge>{!b.bisaUbahStok && <span className="text-[11px] text-ink3">Stok baris ini tidak bisa dikoreksi di sini</span>}</div>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                  {b.bisaUbahStok && <Field label="Jumlah baik"><Input type="number" inputMode="decimal" min="0" step="any" value={b.jumlahBaik} onChange={(e) => setBaris(i, { jumlahBaik: e.target.value })} aria-label={`Koreksi jumlah baik ${b.kode}`} data-testid={`jumlah-${b.kode}`} /></Field>}
                  {b.bisaUbahStok && <Field label="Lokasi"><Input value={b.lokasi} onChange={(e) => setBaris(i, { lokasi: e.target.value })} aria-label={`Koreksi lokasi ${b.kode}`} /></Field>}
                  {b.bisaUbahStok && (
                    <Field label="Bahan (sesatuan)">
                      <select value={b.bahanId} onChange={(e) => setBaris(i, { bahanId: e.target.value })} aria-label={`Ganti bahan ${b.kode}`} className="h-9 w-full rounded-lg bg-surface px-2 text-sm text-ink outline-none" data-testid={`bahan-${b.kode}`}>
                        <option value={keadaan.baris[i].bahanId}>{b.kode} (tetap)</option>
                        {bahan.filter((m) => m.unit === b.satuan && m.id !== keadaan.baris[i].bahanId).map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
                      </select>
                    </Field>
                  )}
                  <Field label="Kondisi"><Input value={b.kondisi} onChange={(e) => setBaris(i, { kondisi: e.target.value })} aria-label={`Koreksi kondisi ${b.kode}`} /></Field>
                  <Field label="Catatan baris"><Input value={b.catatan} onChange={(e) => setBaris(i, { catatan: e.target.value })} aria-label={`Koreksi catatan baris ${b.kode}`} /></Field>
                </div>
              </div>
            ))}
          </fieldset>
          <Field label="Alasan koreksi" required hint="Contoh: jumlah baik seharusnya 7, salah ketik 10 saat Simpan ke Stok."><Input value={form.alasan} onChange={(e) => setForm((f) => ({ ...f, alasan: e.target.value }))} maxLength={500} aria-label="Alasan koreksi" data-testid="alasan-koreksi" /></Field>
          {dampakBerlaku ? <DampakKoreksiGR hasil={dampakBerlaku} /> : <p className="m-0 text-[12px] text-ink3" data-testid="petunjuk-dampak">{galatDini === "Belum ada yang diubah" ? "Ubah salah satu isian di atas." : "Tekan “Lihat Dampak” untuk memeriksa akibat koreksi ini sebelum disimpan."}</p>}
        </div>
      )}
    </Modal>
  );
}
