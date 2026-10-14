import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { TombolAksi } from "@/features/finance/shared.jsx";
import { BagianCustomerPenerima, BagianAlamatLokasi, BagianKebutuhan } from "@/features/finance/PkrPembeliForm.jsx";
import { formEditDariIdentitas, bodyKoreksiPembeli, adaPerubahanKoreksi, galatFormEdit, kemampuanEdit } from "@/features/finance/pkrPembeliLogic.js";

// EDIT DATA CUSTOMER (order PKR) — mode lihat → tombol edit → form → PRATINJAU DAMPAK → alasan → simpan. Tidak membuat jurnal/Payment/Order/Unit/Job baru; kolom penerima/alamat
// terkunci menurut progres Delivery (terjadwal = sinkron job yang SAMA; berjalan/selesai = diblokir server, di sini dijelaskan). Satu kunci idempotensi per niat koreksi.

const kunciBaru = () => (globalThis.crypto?.randomUUID ? `pkr-pembeli-${globalThis.crypto.randomUUID()}` : `pkr-pembeli-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
const TIDAK_DIBUAT = ["Order baru", "Unit baru", "Job baru", "Pembayaran (Payment)", "Invoice", "Pendapatan / jurnal"];

function nilaiTampil(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return [v.nama, v.telepon, v.legacy ? "(data lama)" : null].filter(Boolean).join(" · ") || "—";
  return String(v);
}

export function ModalEditCustomerPkr({ penjualan, mode = "edit", via = "finance", orderId = null, onClose, onSelesai }) {
  const identitas = penjualan?.sinkron?.identitas || null;
  const awal = useMemo(() => formEditDariIdentitas(identitas, { order: null }), [identitas]);
  const [v, setV] = useState(awal);
  const [langkah, setLangkah] = useState("isi"); // isi → tinjau
  const [pra, setPra] = useState(null);
  const [alasan, setAlasan] = useState("");
  const [galat, setGalat] = useState("");
  const [memuat, setMemuat] = useState(false);
  const kunci = useRef(kunciBaru());
  useEffect(() => { setV(awal); setLangkah("isi"); setPra(null); setAlasan(""); setGalat(""); kunci.current = kunciBaru(); }, [awal, penjualan?.id]);
  if (!penjualan) return null;

  const kemampuan = kemampuanEdit({ delivery: penjualan.sinkron?.delivery });
  const legacy = Boolean(identitas?.legacy);
  const setP = (k, val) => setV((s) => ({ ...s, [k]: val }));
  const f = { buyerName: v.nama, pembeli: v, daftar: { alamat: v.alamat, kota: v.kota, tanggalKirim: "" } };
  const body = bodyKoreksiPembeli(v, awal);
  const adaUbah = adaPerubahanKoreksi(body);
  const galatForm = galatFormEdit(v) || (legacy && !v.adalahKaryawan && !String(v.telepon).trim() ? "Isi nomor WhatsApp pembeli untuk melengkapi data customer" : null);
  const panggilPratinjau = via === "order" ? (b) => api.pratinjauKoreksiPembeliOrder(orderId, b) : (b) => api.pratinjauKoreksiPembeliPkr(penjualan.id, b);
  const panggilTerapkan = via === "order" ? (b, k) => api.koreksiPembeliOrder(orderId, b, k) : (b, k) => api.koreksiPembeliPkr(penjualan.id, b, k);

  async function tinjau() {
    setGalat(""); setMemuat(true);
    try { setPra(await panggilPratinjau(body)); setLangkah("tinjau"); } catch (e) { setGalat(e.message || "Gagal membuat pratinjau dampak"); } finally { setMemuat(false); }
  }
  async function simpan() {
    setGalat(""); setMemuat(true);
    try {
      await panggilTerapkan({ ...body, expectedRevision: pra.revisi, alasan: alasan.trim() }, kunci.current);
      await onSelesai?.();
    } catch (e) { setGalat(e.message || "Gagal menyimpan koreksi"); } finally { setMemuat(false); }
  }

  return (
    <Modal
      open onOpenChange={(o) => !o && onClose()}
      title={legacy || mode === "lengkapi" ? `Lengkapi Data Customer — ${penjualan.nomor}` : `Edit Data Customer — ${penjualan.nomor}`}
      description="Perubahan data customer, kontak, alamat, dan catatan tidak membuat jurnal dan tidak mengubah pembayaran. Pratinjau dampak ditampilkan sebelum disimpan."
      className="w-[760px] max-sm:!h-full max-sm:!max-h-full max-sm:!w-full max-sm:!max-w-full max-sm:!rounded-none"
      footer={(
        <>
          {galat && <p role="alert" className="mr-auto rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="galat-edit-customer">{galat}</p>}
          {langkah === "tinjau"
            ? <Button variant="neutral" onClick={() => setLangkah("isi")} className="max-sm:min-h-11 max-sm:px-4">Kembali ubah</Button>
            : <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>}
          {langkah === "isi" && <TombolAksi disabled={!adaUbah || !!galatForm || memuat} onClick={tinjau} data-testid="tinjau-edit-customer">{memuat ? "Menghitung dampak…" : "Tinjau Dampak"}</TombolAksi>}
          {langkah === "tinjau" && <TombolAksi disabled={alasan.trim().length < 5 || memuat} onClick={simpan} data-testid="simpan-edit-customer">Simpan Perubahan</TombolAksi>}
        </>
      )}
    >
      {kemampuan.alasan && (
        <p className={`mb-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px] ${kemampuan.alamat ? "bg-inset text-ink2" : "bg-orangebg text-orange"}`} data-testid="info-progres">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {kemampuan.alasan}
        </p>
      )}
      {legacy && (
        <p className="mb-3 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="info-legacy">
          Order ini masih memakai profil karyawan penjual. Isi nomor WhatsApp pembeli (<strong>{awal.nama || "pembeli"}</strong>) agar order berpindah ke customer yang sebenarnya — PKR, unit, job, pembayaran, dan jurnal tidak berubah.
        </p>
      )}

      {langkah === "isi" && (
        <div className="space-y-5">
          <section className="space-y-2"><h3 className="m-0 text-[10.5px] font-bold uppercase tracking-wide text-ink3">Customer &amp; penerima</h3>
            <BagianCustomerPenerima f={f} setBuyer={(n) => setP("nama", n)} setP={setP} kunciPenerima={!kemampuan.alamat} />
          </section>
          <section className="space-y-2"><h3 className="m-0 text-[10.5px] font-bold uppercase tracking-wide text-ink3">Alamat &amp; Maps</h3>
            <BagianAlamatLokasi daftar={f.daftar} setDaftar={(k, val) => setP(k, val)} pembeli={v} setP={setP} tanggalKirim={false} kunciAlamat={!kemampuan.alamat} />
          </section>
          <section className="space-y-2"><h3 className="m-0 text-[10.5px] font-bold uppercase tracking-wide text-ink3">Keluhan &amp; catatan</h3>
            <BagianKebutuhan pembeli={v} setP={setP} />
          </section>
          {galatForm && <p role="alert" className="m-0 text-[12.5px] text-red" data-testid="galat-form-edit">{galatForm}</p>}
        </div>
      )}

      {langkah === "tinjau" && pra && (
        <div className="space-y-3" data-testid="pratinjau-edit-customer">
          <ul className="m-0 list-none divide-y divide-line rounded-lg border border-line p-0">
            {pra.perubahan.map((x) => (
              <li key={x.kolom} className="grid grid-cols-1 gap-1 px-3 py-2 text-[12.5px] sm:grid-cols-[150px_1fr]">
                <span className="font-semibold text-ink2">{x.label}</span>
                <span className="min-w-0 break-words text-ink">
                  <span className="text-ink3">{nilaiTampil(x.sebelum)}</span> <ArrowRight size={12} className="inline text-ink3" aria-hidden="true" /> <strong>{nilaiTampil(x.sesudah)}</strong>
                </span>
              </li>
            ))}
          </ul>
          {pra.peringatan?.length > 0 && (
            <ul className="m-0 list-none space-y-1 rounded-lg bg-orangebg p-3 text-[12.5px] text-orange" data-testid="peringatan-dampak">
              {pra.peringatan.map((t) => <li key={t}>• {t}</li>)}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink3" data-testid="tidak-dibuat">
            <span>Tidak dibuat:</span>{TIDAK_DIBUAT.map((t) => <Badge key={t} variant="neutral">{t}</Badge>)}
          </div>
          <Field label="Alasan koreksi" required hint="Minimal 5 karakter — tercatat bersama pelaku dan nilai sebelum/sesudah di riwayat">
            <Input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. Customer mengonfirmasi alamat baru" aria-label="Alasan koreksi" />
          </Field>
        </div>
      )}
    </Modal>
  );
}

/** Dialog "Riwayat Perubahan": revisi (jenis, pelaku, waktu, alasan, sebelum → sesudah). Baca-saja. */
export function ModalRiwayatPkr({ penjualan, onClose }) {
  const [data, setData] = useState(null);
  const [galat, setGalat] = useState("");
  useEffect(() => {
    if (!penjualan) return undefined;
    let batal = false;
    setData(null); setGalat("");
    api.getRiwayatPenjualanKaryawan(penjualan.id).then((r) => { if (!batal) setData(r); }).catch((e) => { if (!batal) setGalat(e.message || "Gagal memuat riwayat"); });
    return () => { batal = true; };
  }, [penjualan]);
  if (!penjualan) return null;
  const waktu = (iso) => new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
  return (
    <Modal
      open onOpenChange={(o) => !o && onClose()} title={`Riwayat Perubahan — ${penjualan.nomor}`} className="w-[640px]"
      description="Setiap perubahan tercatat: siapa, kapan, alasan, dan nilai sebelum → sesudah. Pembayaran dan jurnal punya riwayatnya sendiri di daftar pembayaran."
      footer={<Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Tutup</Button>}
    >
      {galat && <p role="alert" className="text-[13px] text-red">{galat}</p>}
      {!data && !galat && <p className="text-[13px] text-ink3">Memuat riwayat…</p>}
      {data && data.revisi.length === 0 && <p className="text-[13px] text-ink3" data-testid="riwayat-kosong">Belum ada perubahan setelah pencatatan awal.</p>}
      {data && data.revisi.length > 0 && (
        <ol className="m-0 list-none space-y-3 p-0" data-testid="riwayat-pkr">
          {data.revisi.map((r) => (
            <li key={r.revisi} className="rounded-lg border border-line p-3 text-[12.5px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-ink">#{r.revisi} · {r.label}{r.dampak === "ADMINISTRATIF_SETELAH_PRODUKSI" && <Badge variant="accent" className="ml-1.5">Administratif — snapshot lama tersimpan</Badge>}</strong>
                <span className="text-ink3">{waktu(r.waktu)}{r.pelaku?.nama ? ` · ${r.pelaku.nama}` : ""}</span>
              </div>
              {r.alasan && <p className="m-0 mt-1 text-ink2">Alasan: {r.alasan}</p>}
              {Array.isArray(r.perubahan) && r.perubahan.length > 0 && (
                <ul className="m-0 mt-2 list-none space-y-1 p-0">
                  {r.perubahan.map((x) => (
                    <li key={x.kolom} className="break-words text-ink2"><span className="font-semibold text-ink">{x.label}:</span> <span className="text-ink3">{nilaiTampil(x.sebelum)}</span> → <strong className="text-ink">{nilaiTampil(x.sesudah)}</strong></li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
