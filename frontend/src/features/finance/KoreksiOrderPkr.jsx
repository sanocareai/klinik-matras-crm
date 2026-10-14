import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Lock, ShieldCheck, Truck, Wallet, Factory, UserRound } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { TombolAksi, formatUang } from "@/features/finance/shared.jsx";
import { BagianCustomerPenerima, BagianAlamatLokasi, BagianKebutuhan } from "@/features/finance/PkrPembeliForm.jsx";
import { FormItemPenjualan } from "@/features/finance/PkrItemPenjualanForm.jsx";
import { useKatalogPkr } from "@/features/finance/PkrOrderCrm.jsx";
import {
  JENIS_KOREKSI, SECTION_KOREKSI, LABEL_TAHAP_PRODUKSI, LABEL_TAHAP_DELIVERY, LABEL_MODE, VARIAN_MODE, statusField, formAwalKoreksi, bodyKoreksiOrder, adaPerubahanOrder,
  galatKoreksiOrder, alasanValid, perluKonfirmasiAdministratif, ringkasDampak, bacaGalatPratinjau, totalTambahan,
} from "@/features/finance/pkrKoreksiOrderLogic.js";

// KOREKSI ORDER PKR — satu pintu resmi. Dua jenis dibedakan tegas: PERBAIKAN salah input vs TAMBAHAN permintaan customer. Form memakai komponen Order CRM Inbox (customer & penerima,
// alamat/Maps/patokan, keluhan & catatan, item). Field yang terkunci progres selalu menampilkan ALASAN dan TINDAKAN yang benar (bukan sekadar disabled). Footer lengket:
// Batal · Lihat Dampak · Terapkan Koreksi. Aturan sebenarnya ditegakkan server; pratinjau memakai fungsi hitung yang sama dengan penerapan.

const formatRupiah = (n) => formatUang(Number(n) || 0, { kurung: false });
const kunciBaru = () => (globalThis.crypto?.randomUUID ? `pkr-order-${globalThis.crypto.randomUUID()}` : `pkr-order-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

function nilaiTampil(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return [v.nama, v.telepon].filter(Boolean).join(" · ") || "—";
  return String(v);
}

function BannerKunci({ status, onTindakan, testid }) {
  if (!status?.alasan) return null;
  const kunci = status.terkunci;
  return (
    <div className={`flex flex-wrap items-start gap-2 rounded-lg px-3 py-2 text-[12.5px] ${kunci ? "bg-orangebg text-orange" : "bg-inset text-ink2"}`} data-testid={testid}>
      {kunci ? <Lock size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> : <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <p className="m-0"><strong>{LABEL_MODE[status.mode] ?? status.mode}.</strong> {status.alasan}</p>
        {status.tindakan && (
          <Button size="sm" variant="neutral" className="mt-1.5 max-sm:min-h-11" onClick={() => onTindakan?.(status.tindakan)} data-testid={`tindakan-${status.tindakan.kode.toLowerCase()}`}>
            {status.tindakan.label}
          </Button>
        )}
      </div>
    </div>
  );
}

function Seksi({ no, judul, children, ringkas = null }) {
  return (
    <section className="space-y-2" data-testid={`seksi-koreksi-${no}`}>
      <h3 className="m-0 flex flex-wrap items-center gap-2 text-[10.5px] font-bold uppercase tracking-wide text-ink3">
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-inset px-1 text-[10px] text-ink2">{no}</span>{judul}
        {ringkas}
      </h3>
      {children}
    </section>
  );
}

export function ModalKoreksiOrderPkr({ penjualan, jenisAwal = "PERBAIKAN", onClose, onSelesai, onBukaKoreksiItem = null }) {
  const identitas = penjualan?.sinkron?.identitas || null;
  const [kem, setKem] = useState(null);
  const [galatMuat, setGalatMuat] = useState("");
  const [jenis, setJenis] = useState(jenisAwal);
  const [f, setF] = useState(null);
  const [awal, setAwal] = useState(null);
  const [langkah, setLangkah] = useState("isi"); // isi → dampak
  const [pra, setPra] = useState(null);
  const [alasan, setAlasan] = useState("");
  const [galat, setGalat] = useState("");
  const [memuat, setMemuat] = useState(false);
  const kunci = useRef(kunciBaru());
  const { katalog, memuat: memuatKatalog, galat: galatKatalog } = useKatalogPkr(!!penjualan && jenis === "TAMBAHAN");

  useEffect(() => {
    if (!penjualan) return undefined;
    let batal = false;
    setKem(null); setGalatMuat(""); setLangkah("isi"); setPra(null); setAlasan(""); setGalat(""); kunci.current = kunciBaru();
    api.getKemampuanKoreksiOrder(penjualan.id).then((k) => {
      if (batal) return;
      const dasar = formAwalKoreksi(k, identitas);
      setKem(k); setAwal(dasar); setF(structuredClone(dasar));
    }).catch((e) => !batal && setGalatMuat(e.message || "Gagal memuat keadaan order"));
    return () => { batal = true; };
  }, [penjualan?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setLangkah("isi"); setPra(null); kunci.current = kunciBaru(); }, [jenis]);
  const body = useMemo(() => (kem && f ? bodyKoreksiOrder(jenis, f, awal, kem, katalog) : null), [kem, f, awal, jenis, katalog]);
  const adaUbah = adaPerubahanOrder(body);
  const galatForm = kem && f ? galatKoreksiOrder(jenis, f, kem, katalog) : null;
  const perluKonfirmasi = perluKonfirmasiAdministratif(kem, body);
  const galatPra = bacaGalatPratinjau(pra);
  const dampak = useMemo(() => ringkasDampak(pra, kem), [pra, kem]);
  const setP = (k, v) => setF((s) => ({ ...s, pembeli: { ...s.pembeli, [k]: v } }));
  const setSpek = (k, v) => setF((s) => ({ ...s, spek: { ...s.spek, [k]: v } }));
  const setNilai = (no, v) => setF((s) => ({ ...s, nilai: { ...s.nilai, [no]: v } }));
  const setItemEdit = (no, k, v) => setF((s) => ({ ...s, itemEdit: { ...s.itemEdit, [no]: { ...s.itemEdit[no], [k]: v } } }));

  const sCustomer = statusField(kem, "customer");
  const sAlamat = statusField(kem, "alamat");
  const sSpek = statusField(kem, "spesifikasi");
  const sJumlah = statusField(kem, "jumlah");
  const sNilai = statusField(kem, "nilai");
  const tindakan = (t) => {
    if (t.kode === "TAMBAHAN") setJenis("TAMBAHAN");
    else if (t.kode === "KOREKSI_DELIVERY") { onClose?.(); window.location.assign("/armada/jobs"); }
  };

  async function lihatDampak() {
    setGalat(""); setMemuat(true);
    try {
      const r = await api.pratinjauKoreksiOrderPkr(penjualan.id, { ...body, expectedRevision: kem.revisi, alasan: alasan.trim() || undefined });
      setPra(r); setLangkah("dampak");
    } catch (e) { setGalat(e.message || "Gagal membuat pratinjau dampak"); } finally { setMemuat(false); }
  }
  async function terapkan() {
    setGalat(""); setMemuat(true);
    try {
      await api.koreksiOrderPkr(penjualan.id, { ...body, expectedRevision: kem.revisi, alasan: alasan.trim() }, kunci.current);
      await onSelesai?.();
    } catch (e) { setGalat(e.message || "Gagal menerapkan koreksi"); } finally { setMemuat(false); }
  }

  const baris = kem?.keuangan?.baris ?? [];
  const totalBaru = baris.reduce((a, b) => a + b.jumlah * (Number(String(f?.nilai?.[b.no] ?? b.harga).replace(",", ".")) || 0), 0);
  const kelebihan = kem && f ? Math.max(0, kem.keuangan.terbayar - totalBaru) : 0;
  const adaPerubahanNilai = Boolean(body?.nilai);

  return (
    <Modal
      open onOpenChange={(o) => !o && onClose?.()}
      title={`Koreksi Order — ${penjualan.nomor}`}
      description="Perbaiki data yang salah input atau catat tambahan permintaan customer. Setiap perubahan butuh alasan, tercatat di Riwayat Perubahan, dan dampaknya ditampilkan sebelum diterapkan."
      className="w-[860px] max-sm:!h-full max-sm:!max-h-full max-sm:!w-full max-sm:!max-w-full max-sm:!rounded-none"
      footer={(
        <div className="sticky bottom-0 flex w-full flex-wrap items-center justify-end gap-2" data-testid="footer-koreksi-order">
          {galat && <p role="alert" className="mr-auto rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="galat-koreksi-order">{galat}</p>}
          <Button variant="neutral" onClick={langkah === "dampak" ? () => setLangkah("isi") : onClose} className="max-sm:min-h-11 max-sm:px-4" data-testid="koreksi-batal">{langkah === "dampak" ? "Kembali ubah" : "Batal"}</Button>
          <Button variant="neutral" disabled={!kem || !adaUbah || !!galatForm || memuat || (perluKonfirmasi && !f?.konfirmasiAdministratif)} onClick={lihatDampak} className="max-sm:min-h-11 max-sm:px-4" data-testid="koreksi-lihat-dampak">
            {memuat && langkah === "isi" ? "Menghitung dampak…" : "Lihat Dampak"}
          </Button>
          <TombolAksi disabled={langkah !== "dampak" || !pra?.valid || !alasanValid(alasan) || memuat} onClick={terapkan} data-testid="koreksi-terapkan">Terapkan Koreksi</TombolAksi>
        </div>
      )}
    >
      {galatMuat && <p role="alert" className="m-0 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange">{galatMuat}</p>}
      {!kem && !galatMuat && <p className="m-0 text-[13px] text-ink3">Memuat keadaan order…</p>}
      {kem && f && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]" data-testid="progres-koreksi">
            <Badge variant="neutral"><Factory size={11} className="mr-1 inline" aria-hidden="true" />{LABEL_TAHAP_PRODUKSI[kem.progres.tahapProduksi] ?? kem.progres.tahapProduksi}</Badge>
            <Badge variant="neutral"><Truck size={11} className="mr-1 inline" aria-hidden="true" />{LABEL_TAHAP_DELIVERY[kem.progres.tahapDelivery] ?? kem.progres.tahapDelivery}</Badge>
            <Badge variant="neutral">{kem.progres.unitAktif} unit · revisi {kem.revisi}</Badge>
            {kem.legacy && <Badge variant="orange">Order lama (tanpa daftar item)</Badge>}
          </div>

          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Jenis koreksi" data-testid="jenis-koreksi">
            {Object.values(JENIS_KOREKSI).map((j) => (
              <label key={j.kode} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-[12.5px] ${jenis === j.kode ? "border-accent bg-accentbg" : "border-line bg-surface"}`}>
                <input type="radio" name="jenis-koreksi" value={j.kode} checked={jenis === j.kode} onChange={() => setJenis(j.kode)} className="mt-0.5 accent-[var(--accent)]" data-testid={`jenis-${j.kode.toLowerCase()}`} />
                <span><strong className="block text-ink">{j.label}</strong><span className="text-ink3">{j.hint}</span></span>
              </label>
            ))}
          </div>

          {langkah === "isi" && jenis === "PERBAIKAN" && (
            <div className="space-y-5">
              <Seksi no={1} judul="Customer & penerima">
                <BannerKunci status={sCustomer.alasan ? sCustomer : null} onTindakan={tindakan} testid="kunci-customer" />
                <BagianCustomerPenerima f={{ buyerName: f.pembeli.nama, pembeli: f.pembeli }} setBuyer={(n) => setP("nama", n)} setP={setP} kunciPenerima={sAlamat.terkunci} />
              </Seksi>
              <Seksi no={2} judul="Alamat, Maps dan patokan">
                <BannerKunci status={sAlamat.alasan ? sAlamat : null} onTindakan={tindakan} testid="kunci-alamat" />
                <BagianAlamatLokasi daftar={{ alamat: f.pembeli.alamat, kota: f.pembeli.kota, tanggalKirim: "" }} setDaftar={(k, v) => setP(k, v)} pembeli={f.pembeli} setP={setP} tanggalKirim={false} kunciAlamat={sAlamat.terkunci} />
              </Seksi>
              <Seksi no={3} judul="Keluhan dan catatan">
                <BagianKebutuhan pembeli={f.pembeli} setP={setP} />
              </Seksi>
              <Seksi no={4} judul="Item, jumlah, ukuran dan spesifikasi">
                <BannerKunci status={sSpek} onTindakan={tindakan} testid="kunci-spesifikasi" />
                {kem.legacy ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Merk kasur"><Input value={f.spek.merk} disabled={sSpek.terkunci} onChange={(e) => setSpek("merk", e.target.value)} aria-label="Merk kasur" /></Field>
                    <Field label="Ukuran"><Input value={f.spek.ukuran} disabled={sSpek.terkunci} onChange={(e) => setSpek("ukuran", e.target.value)} aria-label="Ukuran" /></Field>
                    <Field label="Jumlah unit" hint={sJumlah.terkunci ? "Terkunci: unit sudah berjalan/selesai" : "Boleh turun sebelum dikerjakan; naik = tambahan"}>
                      <Input inputMode="numeric" value={f.jumlah} disabled={sJumlah.terkunci} onChange={(e) => setF((s) => ({ ...s, jumlah: e.target.value }))} aria-label="Jumlah unit" />
                    </Field>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(kem.item ?? []).map((it) => (
                      <div key={it.no} className="rounded-lg border border-line p-3 text-[12.5px]" data-testid={`item-koreksi-${it.no}`}>
                        <p className="m-0 mb-2 flex flex-wrap items-center gap-1.5 font-semibold text-ink">
                          Item {it.no} · {it.produk || it.kategori} ×{it.jumlah}
                          {it.tambahan && <Badge variant="accent">Tambahan pesanan</Badge>}
                          {it.pesananAwalLama && <Badge variant="neutral">Pesanan awal (order lama)</Badge>}
                        </p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {["panjang", "lebar", "tebal", "tinggi"].map((d) => (
                            <Field key={d} label={`${d[0].toUpperCase()}${d.slice(1)} (cm)`}><Input inputMode="decimal" value={f.itemEdit[it.no]?.[d] ?? ""} disabled={sSpek.terkunci} onChange={(e) => setItemEdit(it.no, d, e.target.value)} aria-label={`${d} item ${it.no}`} /></Field>
                          ))}
                        </div>
                        <Field label="Spesifikasi / catatan pekerjaan"><Input value={f.itemEdit[it.no]?.spesifikasi ?? ""} disabled={sSpek.terkunci} onChange={(e) => setItemEdit(it.no, "spesifikasi", e.target.value)} aria-label={`spesifikasi item ${it.no}`} /></Field>
                      </div>
                    ))}
                    {sJumlah.alasan && <BannerKunci status={{ ...sJumlah, tindakan: sJumlah.terkunci ? sJumlah.tindakan : null }} onTindakan={tindakan} testid="kunci-jumlah" />}
                    {kem.terpadu && sJumlah.boleh && onBukaKoreksiItem && (
                      <Button size="sm" variant="neutral" onClick={onBukaKoreksiItem} className="max-sm:min-h-11" data-testid="buka-koreksi-item">Buka Koreksi Item &amp; Pemenuhan</Button>
                    )}
                  </div>
                )}
                {perluKonfirmasi && (
                  <label className="flex items-start gap-2 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="konfirmasi-administratif">
                    <input type="checkbox" checked={f.konfirmasiAdministratif} onChange={(e) => setF((s) => ({ ...s, konfirmasiAdministratif: e.target.checked }))} className="mt-0.5 accent-[var(--accent)]" />
                    <span><AlertTriangle size={13} className="mr-1 inline" aria-hidden="true" />Produksi sudah selesai. Saya menyatakan data lama memang <strong>salah</strong> dan pekerjaan fisik mengikuti data yang benar. Snapshot data lama tersimpan; BOM, bahan, stok, milestone, PIC, dan jurnal tidak berubah.</span>
                  </label>
                )}
              </Seksi>
              <Seksi no={5} judul="Pickup/Delivery">
                <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink2">
                  <Truck size={14} aria-hidden="true" /> {LABEL_TAHAP_DELIVERY[kem.progres.tahapDelivery]}
                  {kem.legacy && (
                    <label className="ml-auto flex items-center gap-1.5">
                      <input type="checkbox" checked={f.spek.perluDikirim === true} disabled={sAlamat.terkunci} onChange={(e) => setSpek("perluDikirim", e.target.checked)} className="accent-[var(--accent)]" aria-label="Dikirim ke alamat" /> Dikirim ke alamat pembeli
                    </label>
                  )}
                </div>
                <BannerKunci status={sAlamat.alasan ? sAlamat : null} onTindakan={tindakan} testid="kunci-delivery" />
              </Seksi>
              <Seksi no={6} judul="Harga dan nilai" ringkas={<Badge variant="accent">Jurnal delta resmi</Badge>}>
                <BannerKunci status={sNilai} onTindakan={tindakan} testid="info-nilai" />
                <div className="overflow-x-auto rounded-lg border border-line">
                  <table className="w-full text-[12.5px]">
                    <thead><tr className="text-left text-ink3"><th className="px-3 py-1.5">Baris</th><th className="px-3 py-1.5 text-right">Jumlah</th><th className="px-3 py-1.5 text-right">Harga satuan</th><th className="px-3 py-1.5 text-right">Subtotal</th></tr></thead>
                    <tbody>
                      {baris.map((b) => {
                        const h = Number(String(f.nilai[b.no] ?? b.harga).replace(",", ".")) || 0;
                        return (
                          <tr key={b.no} className="border-t border-line">
                            <td className="px-3 py-1.5">{b.no}. {b.nama}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{b.jumlah}</td>
                            <td className="px-3 py-1.5 text-right"><Input inputMode="decimal" value={f.nilai[b.no] ?? ""} onChange={(e) => setNilai(b.no, e.target.value)} className="ml-auto w-32 text-right" aria-label={`Harga baris ${b.no}`} /></td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{formatRupiah(h * b.jumlah)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink2" data-testid="ringkas-nilai">
                  <span><Wallet size={13} className="mr-1 inline" aria-hidden="true" />Total {formatRupiah(kem.keuangan.total)} <ArrowRight size={11} className="inline" aria-hidden="true" /> <strong>{formatRupiah(totalBaru)}</strong></span>
                  <span>Terbayar {formatRupiah(kem.keuangan.terbayar)}</span>
                  <span>Sisa <strong>{formatRupiah(Math.max(0, totalBaru - kem.keuangan.terbayar))}</strong></span>
                </div>
                {adaPerubahanNilai && kelebihan > 0 && (
                  <p role="alert" className="m-0 flex items-start gap-2 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="peringatan-kelebihan">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                    Nilai baru di bawah pembayaran: kelebihan bayar <strong className="mx-1">{formatRupiah(kelebihan)}</strong>. Selesaikan lewat Koreksi Pembayaran / Refund resmi — kas tidak dikeluarkan otomatis.
                  </p>
                )}
              </Seksi>
            </div>
          )}

          {langkah === "isi" && jenis === "TAMBAHAN" && (
            <Seksi no={4} judul="Item tambahan (produk, jumlah, ukuran, harga)">
              <p className="m-0 rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink2" data-testid="info-tambahan">
                Item dan unit BARU dibuat; unit lama tidak disentuh. Nilai tambahan dijurnal sebagai delta Finance dan tampil sebagai <strong>Tambahan pesanan</strong>.
                {kem.legacy && " Order lama ini dicatat dulu sebagai satu item \"Pesanan awal\" (unit yang ada hanya ditautkan, tidak diubah)."}
              </p>
              <FormItemPenjualan katalog={katalog} nilai={{ items: f.tambahan, alamat: "", kota: "", tanggalKirim: "" }} onChange={(v) => setF((s) => ({ ...s, tambahan: v.items }))} memuat={memuatKatalog} galatMuat={galatKatalog} sembunyikanLogistik />
              <p className="m-0 text-[12.5px] text-ink2">Nilai tambahan: <strong>{formatRupiah(totalTambahan(f.tambahan))}</strong></p>
            </Seksi>
          )}

          {galatForm && langkah === "isi" && adaUbah && <p role="alert" className="m-0 text-[12.5px] text-red" data-testid="galat-form-koreksi">{galatForm}</p>}

          {langkah === "dampak" && pra && (
            <Seksi no={7} judul="Pratinjau dampak">
              {galatPra ? (
                <div role="alert" className="space-y-1 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="pratinjau-ditolak">
                  <p className="m-0 font-semibold">{galatPra.pesan}</p>
                  {galatPra.kelebihanBayar !== null && <p className="m-0" data-testid="kelebihan-bayar">Kelebihan bayar: <strong>{formatRupiah(galatPra.kelebihanBayar)}</strong></p>}
                  {galatPra.petunjuk && <p className="m-0">{galatPra.petunjuk}</p>}
                </div>
              ) : (
                <div className="space-y-3" data-testid="pratinjau-koreksi-order">
                  {dampak.customer.length > 0 && (
                    <div className="rounded-lg border border-line" data-testid="dampak-customer">
                      <p className="m-0 flex items-center gap-1.5 border-b border-line px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3"><UserRound size={12} aria-hidden="true" /> Customer & kontak</p>
                      <ul className="m-0 list-none divide-y divide-line p-0">
                        {dampak.customer.map((x, i) => (
                          <li key={`${x.label}-${i}`} className="grid grid-cols-1 gap-1 px-3 py-2 text-[12.5px] sm:grid-cols-[150px_1fr]">
                            <span className="font-semibold text-ink2">{x.label}</span>
                            <span className="min-w-0 break-words"><span className="text-ink3">{nilaiTampil(x.sebelum)}</span> <ArrowRight size={12} className="inline text-ink3" aria-hidden="true" /> <strong>{nilaiTampil(x.sesudah)}</strong></span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-line p-3 text-[12.5px]" data-testid="dampak-finance">
                      <p className="m-0 mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3"><Wallet size={12} aria-hidden="true" /> Finance</p>
                      {dampak.finance.length === 0 ? <p className="m-0 text-ink3">Tidak ada perubahan nilai/jurnal.</p> : dampak.finance.map((k, i) => (
                        <div key={i} className="space-y-0.5">
                          <p className="m-0">Total {formatRupiah(k.totalSebelum)} <ArrowRight size={11} className="inline" aria-hidden="true" /> <strong>{formatRupiah(k.totalSesudah)}</strong></p>
                          <p className="m-0">Selisih <strong>{formatRupiah(k.selisih)}</strong> · Sisa {formatRupiah(k.sisaSesudah)}</p>
                          <p className="m-0 text-ink3">{k.jurnal}</p>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-lg border border-line p-3 text-[12.5px]" data-testid="dampak-produksi">
                      <p className="m-0 mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3"><Factory size={12} aria-hidden="true" /> Produksi</p>
                      {dampak.produksi.length === 0 ? <p className="m-0 text-ink3">Tidak ada perubahan unit/produksi.</p> : <ul className="m-0 list-none space-y-0.5 p-0">{dampak.produksi.map((t, i) => <li key={i}>{t}</li>)}</ul>}
                    </div>
                    <div className="rounded-lg border border-line p-3 text-[12.5px]" data-testid="dampak-delivery">
                      <p className="m-0 mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3"><Truck size={12} aria-hidden="true" /> Delivery</p>
                      {dampak.delivery.length === 0 ? <p className="m-0 text-ink3">Tidak ada perubahan job pengiriman.</p> : <ul className="m-0 list-none space-y-0.5 p-0">{dampak.delivery.map((t, i) => <li key={i}>{t}</li>)}</ul>}
                    </div>
                  </div>
                  {dampak.menungguAlur.length > 0 && (
                    <div role="status" className="space-y-1 rounded-lg bg-orangebg p-3 text-[12.5px] text-orange" data-testid="menunggu-alur">
                      <p className="m-0 font-semibold">Menunggu penentuan alur Produksi</p>
                      <ul className="m-0 list-none space-y-1 p-0">{dampak.menungguAlur.map((t, i) => <li key={i}>• {t}</li>)}</ul>
                    </div>
                  )}
                  {dampak.peringatan.length > 0 && (
                    <ul className="m-0 list-none space-y-1 rounded-lg bg-orangebg p-3 text-[12.5px] text-orange" data-testid="peringatan-dampak">
                      {dampak.peringatan.map((t, i) => <li key={i}>• {t}</li>)}
                    </ul>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink3" data-testid="tidak-dibuat">
                    <span>Tidak dibuat:</span>{dampak.tidakDibuat.map((t) => <Badge key={t} variant="neutral">{t}</Badge>)}
                  </div>
                  <Field label="Alasan koreksi" required hint="Minimal 5 karakter — tercatat bersama pelaku dan nilai sebelum/sesudah di Riwayat Perubahan">
                    <Input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. Customer mengonfirmasi alamat dan ukuran yang benar" aria-label="Alasan koreksi" />
                  </Field>
                </div>
              )}
            </Seksi>
          )}
        </div>
      )}
    </Modal>
  );
}

export { SECTION_KOREKSI };
