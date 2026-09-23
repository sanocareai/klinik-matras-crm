import React, { useEffect, useRef, useState } from "react";
import { Field } from "@/components/ui/field.jsx";
import { api } from "@/api.js";
import { InputUang, Pilihan, formatUang } from "@/features/finance/shared.jsx";
import {
  JENIS_BIAYA_TRANSFER, adalahRekeningBank, nilaiAwalBiaya, presetRekening, biayaTransferLengkap, bodyBiayaTransfer,
} from "@/features/finance/biayaTransfer.js";

/**
 * Pilihan Cara Bayar + metode transfer untuk form yang mengeluarkan uang
 * (termasuk dialog Koreksi). Hanya tampil untuk rekening bank/e-wallet; kas
 * tunai otomatis "Tunai".
 *
 * TIDAK ada kalkulasi di sini: Nominal Diterima, Biaya Admin, dan Total Keluar
 * Rekening diminta ke server (POST /finance/transfer-fee/preview) yang memakai
 * aturan & preset yang SAMA dengan saat menyimpan.
 *
 * `value` = {paymentMethod, transferFeeType, transferFeeAmount}; `onChange`
 * menerima objek nilai BARU penuh.
 */
export default function CaraBayarTransfer({ rekening, nominal, value, onChange }) {
  const id = rekening?.id;
  const idSebelumnya = useRef(id);
  // Ganti rekening (BUKAN saat pertama tampil) -> nilai awal mengikuti jenis rekening.
  // Saat pertama tampil nilai dari luar dihormati (mis. dialog Koreksi membawa nilai dokumen).
  useEffect(() => {
    if (idSebelumnya.current === id) return;
    idSebelumnya.current = id;
    onChange(nilaiAwalBiaya(rekening));
    /* eslint-disable-next-line */
  }, [id]);
  // Form yang di-reset dari luar mengosongkan nilai — isi lagi dari rekening yang sudah terpilih.
  useEffect(() => {
    if (rekening && !value.paymentMethod) onChange(nilaiAwalBiaya(rekening));
    /* eslint-disable-next-line */
  }, [rekening, value.paymentMethod]);

  const transfer = value.paymentMethod === "TRANSFER";
  const lengkap = biayaTransferLengkap(rekening, value);
  const [pratinjau, setPratinjau] = useState({ memuat: false, data: null, galat: "" });
  const nomor = useRef(0);
  const kotak = useRef(null);
  const berinteraksi = useRef(false);
  // Setelah pengguna memilih metode, ringkasan (Nominal diterima / Total keluar) sering berada di bawah
  // lipatan dialog — gulir ke tampilan supaya angka pentingnya langsung terlihat.
  useEffect(() => {
    if (berinteraksi.current && transfer) kotak.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [value.transferFeeType, pratinjau.data, pratinjau.galat]);

  const kunciPratinjau = JSON.stringify([id, transfer, value.transferFeeType, value.transferFeeAmount, Number(nominal) || 0]);
  useEffect(() => {
    if (!rekening || !adalahRekeningBank(rekening) || !transfer || !lengkap) {
      setPratinjau({ memuat: false, data: null, galat: "" });
      return undefined;
    }
    const saya = ++nomor.current;
    setPratinjau((s) => ({ ...s, memuat: true, galat: "" }));
    const t = setTimeout(() => {
      api.previewBiayaTransfer({ cashAccountId: id, amount: Number(nominal) || 0, ...bodyBiayaTransfer(value) })
        .then((d) => { if (saya === nomor.current) setPratinjau({ memuat: false, data: d, galat: "" }); })
        .catch((e) => { if (saya === nomor.current) setPratinjau({ memuat: false, data: null, galat: e.message || "Gagal menghitung biaya" }); });
    }, 250);
    return () => clearTimeout(t);
    /* eslint-disable-next-line */
  }, [kunciPratinjau]);

  if (!rekening || !adalahRekeningBank(rekening)) return null;

  const preset = presetRekening(rekening);
  const set = (patch) => { berinteraksi.current = true; onChange({ ...value, ...patch }); };
  const d = pratinjau.data;

  return (
    <div ref={kotak} className="space-y-3 rounded-lg bg-inset p-3" data-testid="cara-bayar-transfer">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Cara bayar" required>
          <Pilihan value={value.paymentMethod} onChange={(v) => { berinteraksi.current = true; onChange({ ...nilaiAwalBiaya(rekening), paymentMethod: v }); }}>
            <option value="TRANSFER">Transfer</option>
            <option value="TUNAI">Tunai / tanpa biaya transfer</option>
          </Pilihan>
        </Field>
        {transfer && (
          <Field label="Metode transfer" required hint="Mengisi biaya admin otomatis">
            <Pilihan value={value.transferFeeType} onChange={(v) => set({ transferFeeType: v, transferFeeAmount: "" })}>
              <option value="">— pilih —</option>
              {JENIS_BIAYA_TRANSFER.map((j) => (
                <option key={j.code} value={j.code}>
                  {j.label}{j.code !== "LAINNYA" ? ` (${formatUang(preset[j.code])})` : ""}
                </option>
              ))}
            </Pilihan>
          </Field>
        )}
      </div>

      {transfer && value.transferFeeType === "LAINNYA" && (
        <Field label="Biaya admin (custom)" required>
          <InputUang value={value.transferFeeAmount} onChange={(v) => set({ transferFeeAmount: v })} />
        </Field>
      )}

      {transfer && (
        <dl className="space-y-1 text-[13px]" aria-live="polite">
          <div className="flex justify-between gap-3"><dt className="text-ink2">Nominal diterima</dt><dd className="tabular-nums text-ink">{d ? formatUang(d.nominalDiterima) : "—"}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-ink2">Biaya admin</dt><dd className="tabular-nums text-ink">{d ? formatUang(d.biayaAdmin) : "—"}</dd></div>
          <div className="flex justify-between gap-3 border-t border-line pt-1 font-semibold"><dt className="text-ink">Total keluar rekening</dt><dd className="tabular-nums text-ink">{d ? formatUang(d.totalKeluarRekening) : "—"}</dd></div>
          {pratinjau.galat && <p className="pt-1 text-xs text-red">{pratinjau.galat}</p>}
          {!pratinjau.galat && !lengkap && <p className="pt-1 text-xs text-ink3">Pilih metode transfer untuk melihat biaya admin dan total keluar rekening.</p>}
          {!pratinjau.galat && lengkap && pratinjau.memuat && !d && <p className="pt-1 text-xs text-ink3">Menghitung di server…</p>}
          <p className="pt-1 text-xs text-ink3">Biaya admin dicatat sebagai baris beban terpisah pada transaksi yang sama. Angka dihitung server.</p>
        </dl>
      )}
    </div>
  );
}
