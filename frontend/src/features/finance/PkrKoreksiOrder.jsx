import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Lock } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Pilihan } from "@/features/finance/shared.jsx";
import {
  ALASAN_MIN, ALASAN_MAKS, KIRIM_OPSI_KOREKSI, LABEL_FIELD, alasanValid, barisMatriks, formAwal, galatForm, kunciBaru, perubahanDariForm, pesanGalatKoreksi, teksJalur,
} from "@/features/finance/pkrKoreksiOrderLogic.js";

// KOREKSI DATA ORDER + BATASAN FORMAT (Penjualan Karyawan). Sumber kebenaran = server (GET kemampuan-koreksi): field apa yang masih bisa dikoreksi, lewat jalur apa, dan bila terkunci kenapa.
// Format lama TIDAK disembunyikan: batasannya tampil di atas formulir. Alur: isi -> Tinjau Dampak (server, tidak menulis) -> alasan wajib -> Terapkan (revisi optimistis + Idempotency-Key).
// Jumlah/harga/item TIDAK dikoreksi di sini (format terpadu: "Koreksi item penjualan"); layar ini mengoreksi data order: alamat, kota, tanggal kirim, catatan, dan (format lama) merk/ukuran/dikirim.
const AREA = "min-h-[72px] w-full rounded-btn border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent disabled:opacity-60";

function Matriks({ kem }) {
  const baris = barisMatriks(kem);
  return (
    <details className="rounded-lg border border-line bg-surface px-3 py-2" data-testid="koreksi-matriks" open={kem.formatLama || kem.produksiBerjalan}>
      <summary className="cursor-pointer text-[12.5px] font-semibold text-ink">Apa yang bisa dan tidak bisa dikoreksi</summary>
      <ul className="m-0 mt-2 list-none space-y-2 p-0">
        {baris.map((b) => (
          <li key={b.kunci} className="flex gap-2 text-[12.5px]" data-testid="matriks-baris" data-boleh={b.boleh ? "ya" : "tidak"}>
            {b.boleh ? <Check size={14} className="mt-0.5 shrink-0 text-green" aria-label="Bisa" /> : <Lock size={14} className="mt-0.5 shrink-0 text-orange" aria-label="Terkunci" />}
            <span className="min-w-0">
              <span className="font-medium text-ink">{b.judul}</span>
              {b.boleh
                ? <span className="text-ink3">{b.jalur && b.jalur !== "koreksi-order" ? ` — ${teksJalur(b.jalur) ?? ""}` : " — bisa dikoreksi"}</span>
                : <span className="block text-ink2">{b.alasan}{b.jalur && teksJalur(b.jalur) ? ` (${teksJalur(b.jalur)})` : ""}</span>}
              {b.catatan && <span className="block text-ink3">{b.catatan}</span>}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Pratinjau({ pra }) {
  return (
    <div className="space-y-3" data-testid="koreksi-pratinjau">
      {pra.perubahan.length > 0 && (
        <section aria-label="Perubahan">
          <p className="m-0 mb-1 text-[12px] font-semibold text-ink2">Yang akan berubah</p>
          <ul className="m-0 list-none space-y-1.5 p-0">
            {pra.perubahan.map((p) => (
              <li key={p.field} className="rounded-lg bg-inset px-3 py-2 text-[12.5px]" data-testid="pratinjau-perubahan" data-field={p.field}>
                <span className="font-semibold text-ink">{p.label}</span>
                <span className="block break-words text-ink3">Sebelum: {p.sebelum ?? "—"}</span>
                <span className="block break-words text-ink">Sesudah: {p.sesudah ?? "—"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {pra.blokir.length > 0 && (
        <section role="alert" className="space-y-1 rounded-lg bg-orangebg px-3 py-2" data-testid="pratinjau-blokir">
          <p className="m-0 text-[12.5px] font-semibold text-orange">Tidak bisa diterapkan</p>
          {pra.blokir.map((b) => <p key={b.field} className="m-0 text-[12.5px] text-ink"><strong>{b.label}:</strong> {b.pesan}</p>)}
        </section>
      )}
      {pra.revisiBerubah && <p role="alert" className="m-0 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange">Data sudah berubah sejak layar dibuka — muat ulang.</p>}
      <section aria-label="Dampak" className="space-y-1 text-[12.5px]">
        <p className="m-0 text-[12px] font-semibold text-ink2">Dampak</p>
        <ul className="m-0 space-y-1 pl-4 text-ink" data-testid="pratinjau-dampak">
          {pra.dampak.jobAlamatDisinkron > 0 && <li>{pra.dampak.jobAlamatDisinkron} job pengiriman yang belum berjalan ikut memakai alamat baru.</li>}
          {pra.dampak.unitDisinkronMerkUkuran > 0 && <li>Merk/ukuran {pra.dampak.unitDisinkronMerkUkuran} unit ikut disamakan.</li>}
          {pra.dampak.perluDikirimMenjadiYa && <li>Order ditandai dikirim: kerangka job pengiriman dibuat bila unit sudah siap kirim.</li>}
          <li>Order <span className="font-mono">{pra.dampak.orderNomor}</span> dan seluruh unitnya tetap sama (tidak ada order/unit/job baru).</li>
        </ul>
        <p className="m-0 mt-1 text-ink3">Tidak berubah: {pra.dampak.tidakBerubah.join("; ")}.</p>
      </section>
    </div>
  );
}

export function ModalKoreksiOrderPkr({ penjualan, onClose, onSelesai }) {
  const [kem, setKem] = useState(null);
  const [memuat, setMemuat] = useState(true);
  const [form, setForm] = useState(null);
  const [langkah, setLangkah] = useState("isi"); // isi | tinjau
  const [pra, setPra] = useState(null);
  const [alasan, setAlasan] = useState("");
  const [galat, setGalat] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const kunci = useRef(kunciBaru());

  const muat = useCallback(async ({ simpanGalat = false } = {}) => {
    setMemuat(true);
    try {
      const k = await api.getKemampuanKoreksiPkr(penjualan.id);
      setKem(k); setForm(formAwal(k)); setLangkah("isi"); setPra(null);
      if (!simpanGalat) setGalat("");
    } catch (e) { setGalat(e.message || "Gagal memuat kemampuan koreksi"); }
    finally { setMemuat(false); }
  }, [penjualan.id]);
  useEffect(() => { muat(); }, [muat]);

  const perubahan = useMemo(() => (kem && form ? perubahanDariForm(form, kem) : {}), [kem, form]);
  const g = kem && form ? galatForm(form, kem) : "Memuat…";
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const f = kem?.field ?? {};
  const bisaKoreksi = !!kem && !!kem.order && kem.format !== "DIBATALKAN" && FIELD_ADA(f);

  async function tinjau() {
    setSibuk(true); setGalat("");
    try {
      const r = await api.pratinjauKoreksiOrderPkr(penjualan.id, { perubahan, expectedRevision: kem.revisi });
      setPra(r); setLangkah("tinjau"); kunci.current = kunciBaru();
    } catch (e) { setGalat(pesanGalatKoreksi(e)); }
    finally { setSibuk(false); }
  }
  async function terapkan() {
    setSibuk(true); setGalat("");
    try {
      await api.koreksiOrderPkr(penjualan.id, { perubahan, expectedRevision: kem.revisi, alasan: alasan.trim().replace(/\s+/g, " ") }, kunci.current);
      await onSelesai?.();
    } catch (e) {
      const pesan = pesanGalatKoreksi(e);
      if (e.code === "REVISI_BERUBAH" || e.status === 409) { await muat({ simpanGalat: true }); }
      setGalat(pesan);
    } finally { setSibuk(false); }
  }

  const tinjauAktif = langkah === "tinjau" && pra;
  return (
    <Modal
      open onOpenChange={(v) => !v && !sibuk && onClose()}
      title={`Koreksi data order — ${penjualan.nomor}`}
      description="Ubah alamat, kota, tanggal kirim, dan catatan permintaan customer. Finance, jurnal, order, unit, dan job tidak berubah selain yang ditampilkan di pratinjau."
      className="w-[680px]"
      footer={(
        <div className="flex w-full flex-col gap-2">
          {galat && <p role="alert" data-testid="koreksi-order-galat" className="m-0 rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">{galat}</p>}
          <div className="flex justify-end gap-2">
            {tinjauAktif
              ? <Button variant="neutral" onClick={() => { setLangkah("isi"); setGalat(""); }} disabled={sibuk} className="max-sm:min-h-11 max-sm:px-4" data-testid="koreksi-order-kembali">Kembali ubah</Button>
              : <Button variant="neutral" onClick={onClose} disabled={sibuk} className="max-sm:min-h-11 max-sm:px-4">Tutup</Button>}
            {tinjauAktif
              ? <Button disabled={sibuk || !pra.boleh || !alasanValid(alasan)} onClick={terapkan} className="max-sm:min-h-11 max-sm:px-4" data-testid="koreksi-order-terapkan">{sibuk ? "Menerapkan…" : "Terapkan Koreksi"}</Button>
              : <Button disabled={sibuk || memuat || !bisaKoreksi || !!g} onClick={tinjau} className="max-sm:min-h-11 max-sm:px-4" data-testid="koreksi-order-tinjau">{sibuk ? "Memeriksa…" : "Tinjau Dampak"}</Button>}
          </div>
        </div>
      )}
    >
      {memuat && !kem && <p className="m-0 text-[13px] text-ink3" data-testid="koreksi-order-memuat">Memuat kemampuan koreksi…</p>}
      {kem && form && (
        <div className="space-y-4">
          <div className="space-y-1.5" data-testid="koreksi-format">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={kem.formatLama ? "orange" : "neutral"} data-testid="koreksi-format-badge" data-format={kem.format}>{kem.formatLabel}</Badge>
              <span className="text-[12px] text-ink3">Revisi saat ini: <strong className="tabular-nums text-ink">{kem.revisi}</strong></span>
            </div>
            <p className="m-0 text-[12.5px] leading-relaxed text-ink2">{kem.penjelasan}</p>
            {kem.order && <p className="m-0 text-[12px] text-ink3">Order CRM <span className="font-mono text-ink">{kem.order.nomor}</span> · {kem.unit.length} unit aktif: {kem.unit.map((u) => u.kode.replace(/^.*-(U\d+)$/, "$1")).join(", ")}</p>}
          </div>

          {kem.formatLama && (
            <section role="note" className="space-y-1 rounded-lg border border-orange/40 bg-orangebg px-3 py-2.5" data-testid="koreksi-batasan-lama">
              <p className="m-0 text-[12.5px] font-semibold text-orange">Batasan format lama</p>
              <p className="m-0 text-[12.5px] text-ink">Jumlah unit, harga, dan daftar item <strong>tidak bisa dikoreksi</strong> pada penjualan ini.</p>
              {kem.jalurResmi && <p className="m-0 text-[12.5px] text-ink">{kem.jalurResmi}</p>}
              {kem.migrasiFormat && <p className="m-0 text-[12px] text-ink2" data-testid="koreksi-migrasi">Migrasi ke format terpadu: belum tersedia. {kem.migrasiFormat.alasan}</p>}
            </section>
          )}
          {!kem.formatLama && kem.produksiBerjalan && kem.jalurResmi && (
            <section role="note" className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-ink" data-testid="koreksi-batasan-produksi"><strong className="text-orange">Produksi sudah berjalan.</strong> {kem.jalurResmi}</section>
          )}

          <Matriks kem={kem} />

          {!bisaKoreksi && <p role="note" className="m-0 rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink2" data-testid="koreksi-tidak-bisa">{kem.penjelasan}</p>}

          {bisaKoreksi && !tinjauAktif && (
            <div className="space-y-3" data-testid="koreksi-order-form">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={LABEL_FIELD.alamat} hint={!f.alamat?.boleh ? f.alamat?.alasan : undefined} className="sm:col-span-2">
                  <Input value={form.alamat} disabled={!f.alamat?.boleh} onChange={(e) => set("alamat", e.target.value)} maxLength={500} aria-label="Alamat pengiriman" data-testid="ko-alamat" />
                </Field>
                <Field label={LABEL_FIELD.kota} hint={!f.kota?.boleh ? f.kota?.alasan : undefined}>
                  <Input value={form.kota} disabled={!f.kota?.boleh} onChange={(e) => set("kota", e.target.value)} maxLength={100} aria-label="Kota" data-testid="ko-kota" />
                </Field>
                <Field label={LABEL_FIELD.tanggalKirim} hint={!f.tanggalKirim?.boleh ? f.tanggalKirim?.alasan : "Format YYYY-MM-DD; kosongkan untuk menghapus"}>
                  <Input type="date" value={form.tanggalKirim} disabled={!f.tanggalKirim?.boleh} onChange={(e) => set("tanggalKirim", e.target.value)} aria-label="Tanggal kirim" data-testid="ko-tanggal" />
                </Field>
                <Field label={LABEL_FIELD.catatan} hint={!f.catatan?.boleh ? f.catatan?.alasan : undefined} className="sm:col-span-2">
                  <textarea className={AREA} value={form.catatan} disabled={!f.catatan?.boleh} maxLength={500} onChange={(e) => set("catatan", e.target.value)} aria-label="Catatan permintaan customer" data-testid="ko-catatan" />
                </Field>
                {kem.format === "LAMA_TANPA_ITEM" && (
                  <>
                    <Field label={LABEL_FIELD.merk} hint={!f.merk?.boleh ? f.merk?.alasan : undefined}>
                      <Input value={form.merk} disabled={!f.merk?.boleh} onChange={(e) => set("merk", e.target.value)} maxLength={100} aria-label="Merk kasur" data-testid="ko-merk" />
                    </Field>
                    <Field label={LABEL_FIELD.ukuran} hint={!f.ukuran?.boleh ? f.ukuran?.alasan : undefined}>
                      <Input value={form.ukuran} disabled={!f.ukuran?.boleh} onChange={(e) => set("ukuran", e.target.value)} maxLength={100} aria-label="Ukuran" data-testid="ko-ukuran" />
                    </Field>
                    <Field label={LABEL_FIELD.perluDikirim} hint={!f.perluDikirim?.boleh ? f.perluDikirim?.alasan : f.perluDikirim?.catatan} className="sm:col-span-2">
                      <Pilihan value={form.kirim} disabled={!f.perluDikirim?.boleh} onChange={(v) => set("kirim", v)} aria-label="Dikirim atau diambil sendiri" data-testid="ko-kirim">
                        {KIRIM_OPSI_KOREKSI.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                      </Pilihan>
                    </Field>
                  </>
                )}
              </div>
              {g && g !== "Belum ada yang diubah" && <p role="alert" className="m-0 text-[12px] text-red">{g}</p>}
            </div>
          )}

          {tinjauAktif && (
            <div className="space-y-4" data-testid="koreksi-order-tinjau-area">
              <Pratinjau pra={pra} />
              {pra.boleh && (
                <Field label="Alasan koreksi" required hint={`Wajib (minimal ${ALASAN_MIN} karakter). Tercatat bersama data sebelum/sesudah di riwayat revisi.`}>
                  <textarea className={AREA} value={alasan} maxLength={ALASAN_MAKS} onChange={(e) => setAlasan(e.target.value)} aria-label="Alasan koreksi" data-testid="koreksi-order-alasan" />
                </Field>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// Ada setidaknya satu field order yang dikenal server (order ada); bila order belum ada, field kosong.
function FIELD_ADA(f) { return Object.keys(f ?? {}).length > 0; }
