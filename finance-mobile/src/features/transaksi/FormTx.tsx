import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, CircleCheck, ShieldAlert, TriangleAlert } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { Button, MockBanner, OfflineBanner, PressableScale } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { useCariOrderRefund, useOpsiForm } from "@/hooks/transaksi";
import { useOnline } from "@/hooks/useOnline";
import { useTinggiKeyboard } from "@/hooks/useKeyboard";
import { useSession } from "@/auth/session";
import { ENV } from "@/lib/env";
import { hariIniWIB, waktuLengkap } from "@/lib/dates";
import { bandingMoney, formatRupiah, isZero, parseInputRupiah } from "@/lib/money";
import { S } from "@/lib/strings";
import { bikinKunciTx, type FormDokumen } from "@/api/transaksi";
import type { ModulTx, OpsiForm } from "@/api/types";
import { GalatPenuh } from "@/features/umum/StatusData";
import { KONFIG, bisaBuat, modulValid } from "./modul";
import { IsianPilih, IsianTanggal, IsianTeks, IsianUang, Kolom, tanggalSah } from "./Isian";
import { LampiranField } from "./LampiranField";
import { bacaDraf, hapusDraf, simpanDraf, type IsianDraf } from "./draf";
import { useAksiTx } from "./useAksiTx";

type Modul = FormDokumen["modul"];
type Nilai = Record<string, string>;
type Galat = Record<string, string>;

const AWAL: Nilai = { tanggal: "", nominal: "", keterangan: "", kategoriId: "", mode: "LANGSUNG", rekeningId: "", supplierId: "", penerima: "", catatan: "", karyawan: "", alasan: "", akunId: "", orderId: "", nomorFaktur: "", jatuhTempo: "", kategoriBiayaId: "", nama: "", telepon: "", terminHari: "", bank: "", rekening: "", atasNama: "" };

/** Validasi per modul — hanya pemeriksaan bentuk isian; aturan bisnis (nota wajib, batas refund, karyawan sah) tetap diputuskan server. */
export function validasi(modul: Modul, v: Nilai, opsi: OpsiForm | undefined, sisaRefund: string | null): Galat {
  const g: Galat = {};
  const nominal = parseInputRupiah(v.nominal ?? "");
  const nominalBad = !nominal || isZero(nominal) || nominal.startsWith("-");
  if (modul !== "supplier" && nominalBad) g.nominal = "Isi nominal lebih dari 0.";
  if (modul !== "supplier" && !tanggalSah(v.tanggal ?? "")) g.tanggal = "Tanggal tidak sah (TTTT-BB-HH).";
  if ((modul === "tagihan") && v.jatuhTempo && !tanggalSah(v.jatuhTempo)) g.jatuhTempo = "Jatuh tempo tidak sah (TTTT-BB-HH).";
  if (modul === "pengeluaran" || modul === "pembelian") {
    if (!(v.keterangan ?? "").trim()) g.keterangan = "Keterangan wajib diisi.";
    if (!v.kategoriId) g.kategoriId = "Pilih kategori.";
    if (v.mode === "LANGSUNG" && !opsi?.hanyaReimbursement && !v.rekeningId) g.rekeningId = "Pengeluaran yang dibayar langsung wajib memilih rekening sumber dana.";
  }
  if (modul === "kasbon") {
    if (!v.karyawan) g.karyawan = "Pilih karyawan.";
    if ((v.alasan ?? "").trim().length < 3) g.alasan = "Alasan/urgensi wajib diisi (minimal 3 huruf).";
    if (!v.rekeningId) g.rekeningId = "Pilih rekening sumber uang.";
  }
  if (modul === "pemasukan") {
    if (!(v.keterangan ?? "").trim()) g.keterangan = "Keterangan wajib diisi.";
    if (!v.akunId) g.akunId = "Pilih akun pendapatan.";
    if (!v.rekeningId) g.rekeningId = "Pilih rekening tujuan.";
  }
  if (modul === "refund") {
    if (!v.orderId) g.orderId = "Pilih order.";
    if ((v.alasan ?? "").trim().length < 3) g.alasan = "Alasan refund wajib diisi (minimal 3 huruf).";
    if (!v.rekeningId) g.rekeningId = "Pilih rekening sumber pengembalian.";
    if (!g.nominal && nominal && sisaRefund && bandingMoney(nominal, sisaRefund) > 0) g.nominal = `Melebihi uang yang bisa dikembalikan (${formatRupiah(sisaRefund)}).`;
  }
  if (modul === "tagihan") {
    if (!v.supplierId) g.supplierId = "Pilih supplier.";
    if (!(v.keterangan ?? "").trim()) g.keterangan = "Keterangan tagihan wajib diisi.";
    if (!v.kategoriBiayaId) g.kategoriBiayaId = "Pilih kategori biaya — tagihan harus tahu dibebankan ke mana.";
  }
  if (modul === "supplier") {
    if (!(v.nama ?? "").trim()) g.nama = "Nama supplier wajib diisi.";
    if (v.terminHari && !/^\d{1,3}$/.test(v.terminHari)) g.terminHari = "Isi angka hari (mis. 14).";
  }
  return g;
}

export function keFormDokumen(modul: Modul, v: Nilai, url: string | null, ajukan: boolean): FormDokumen {
  return {
    modul, tanggal: v.tanggal, nominal: parseInputRupiah(v.nominal ?? ""), keterangan: v.keterangan, kategoriId: v.kategoriId, mode: v.mode, rekeningId: v.rekeningId, supplierId: v.supplierId,
    penerima: v.penerima, catatan: v.catatan, receiptUrl: url, karyawan: v.karyawan, alasan: v.alasan, akunId: v.akunId, orderId: v.orderId, ajukan,
    nomorFaktur: v.nomorFaktur, jatuhTempo: v.jatuhTempo, kategoriBiayaId: v.kategoriBiayaId,
    supplierBaru: { nama: v.nama ?? "", telepon: v.telepon, terminHari: v.terminHari, bank: v.bank, rekening: v.rekening, atasNama: v.atasNama, catatan: v.catatan },
  };
}

function BannerPesan({ tone, teks }: { tone: "sukses" | "galat" | "info"; teks: string }) {
  const { colors } = useTheme();
  const w = tone === "sukses" ? { bg: colors.successSoft, fg: colors.success, I: CircleCheck } : tone === "galat" ? { bg: colors.dangerSoft, fg: colors.danger, I: TriangleAlert } : { bg: colors.infoSoft, fg: colors.info, I: ShieldAlert };
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ flexDirection: "row", gap: 10, padding: 12, borderRadius: radius.small, backgroundColor: w.bg, marginBottom: 12 }}>
      <w.I size={18} color={w.fg} strokeWidth={1.75} />
      <Text maxFontSizeMultiplier={1.3} style={{ flex: 1, color: colors.text, fontFamily: font.medium, fontSize: 13, lineHeight: 18 }}>{teks}</Text>
    </View>
  );
}

export function FormTxScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();
  const keyboard = useTinggiKeyboard();
  const caps = useSession((s) => s.capabilities);
  const { modul: modulParam, foto: fotoParam } = useLocalSearchParams<{ modul: string; foto?: string }>();
  const modul: ModulTx = modulValid(modulParam) ? modulParam : "pengeluaran";
  const k = KONFIG[modul];
  const opsiQ = useOpsiForm(true);
  const opsi = opsiQ.data;
  const { buat, sibuk } = useAksiTx();

  const [v, setV] = useState<Nilai>({ ...AWAL, tanggal: hariIniWIB() });
  const [url, setUrl] = useState<string | null>(null);
  const [fotoSibuk, setFotoSibuk] = useState(false);
  const [dicoba, setDicoba] = useState(false);
  const [pesan, setPesan] = useState<{ tone: "sukses" | "galat" | "info"; teks: string } | null>(null);
  const [draf, setDraf] = useState<{ isian: IsianDraf; simpanPada: string } | null>(null);
  const [cariOrder, setCariOrder] = useState("");
  const niat = useRef(bikinKunciTx());
  const set = (nama: string) => (t: string) => setV((s) => ({ ...s, [nama]: t }));

  useEffect(() => { void bacaDraf(modul).then(setDraf); }, [modul]);

  const orders = useCariOrderRefund(modul === "refund" ? cariOrder : "");
  const orderTerpilih = orders.data?.find((o) => o.id === v.orderId) ?? null;
  const sisaRefund = orderTerpilih?.sisaBisaDirefund ?? null;
  const modulForm = modul as Modul;
  const galat = validasi(modulForm, v, opsi, sisaRefund);
  const adaGalat = Object.keys(galat).length > 0;
  const tampilGalat = (n: string) => (dicoba ? galat[n] ?? null : null);

  async function kirim(ajukan: boolean) {
    setDicoba(true);
    if (adaGalat || sibuk || fotoSibuk) return;
    setPesan(null);
    const h = await buat(niat.current, keFormDokumen(modulForm, v, url, ajukan));
    if (h.ok) {
      await hapusDraf(modul);
      if (h.id && modul !== "supplier") router.replace({ pathname: "/tx/[modul]/[id]", params: { modul, id: h.id } });
      else router.back();
      return;
    }
    if (h.info.jenis === "batal") return;
    setPesan({ tone: h.info.jenis === "konflik" || h.info.jenis === "tidakPasti" ? "info" : "galat", teks: h.info.pesan });
    if (!h.info.simpanKunci) niat.current = bikinKunciTx();
  }

  async function simpanLokal() {
    const ok = await simpanDraf(modul, v);
    setPesan(ok ? { tone: "sukses", teks: "Draf disimpan di HP ini (tanpa foto). Draf tidak dikirim otomatis — buka lagi formulir ini untuk melanjutkan." } : { tone: "galat", teks: "Draf tidak bisa disimpan. Isi formulir dulu." });
    if (ok) setDraf(await bacaDraf(modul));
  }

  if (!bisaBuat(caps, modul)) {
    return (
      <Screen>
        <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: font.semibold, fontSize: 20 }}>{k.label}</Text>
        <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 14, lineHeight: 20, marginTop: 8 }}>Akun Anda tidak punya izin untuk mencatat {k.tunggal} dari aplikasi ini.</Text>
        <Button label="Kembali" variant="ghost" onPress={() => router.back()} style={{ marginTop: 16 }} />
      </Screen>
    );
  }

  const rekOpsi = (opsi?.rekening ?? []).map((r) => ({ id: r.id, label: r.name, sub: `Saldo ${formatRupiah(r.saldo)}` }));
  const opsiLabel = (d: { id: string; name: string }[] | undefined) => (d ?? []).map((x) => ({ id: x.id, label: x.name }));
  const judulTombol = modul === "pengeluaran" || modul === "pembelian" ? "Ajukan" : modul === "refund" ? "Ajukan refund" : modul === "tagihan" ? "Ajukan tagihan" : modul === "supplier" ? "Simpan supplier" : "Catat";
  const boleh = !sibuk && !fotoSibuk && online;
  const dokBiasa = modul === "pengeluaran" || modul === "pembelian";
  const pengingatNota = dokBiasa
    ? modul === "pembelian" ? "Pembelian wajib punya foto nota sebelum disetujui."
      : `Nota wajib untuk reimbursement dan nominal mulai ${opsi ? formatRupiah(opsi.ambangNotaRupiah) : "batas tertentu"} (kecuali gaji/upah/admin bank). Tanpa nota, dokumen tetap bisa diajukan tetapi tidak bisa disetujui.`
    : null;

  return (
    <Screen bawah={140 + keyboard}>
      <PressableScale onPress={() => router.back()} accessibilityLabel="Kembali" style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8, minHeight: 44 }}>
        <ChevronLeft size={22} color={colors.primary} strokeWidth={1.75} />
        <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 15 }}>{k.label}</Text>
      </PressableScale>
      {ENV.useMocks ? <MockBanner /> : null}
      {!online ? <OfflineBanner /> : null}
      <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 24, marginBottom: 12 }}>{k.tunggal === "refund" ? "Refund baru" : `Catat ${k.tunggal}`}</Text>
      {pesan ? <BannerPesan tone={pesan.tone} teks={pesan.teks} /> : null}

      {draf ? (
        <GlassCard variant="flat" style={{ marginBottom: 14 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 13 }}>Ada draf tersimpan di HP</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 2 }}>{draf.simpanPada ? waktuLengkap(draf.simpanPada) : ""} · belum dikirim</Text>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <Button label="Buang" variant="ghost" onPress={() => { void hapusDraf(modul).then(() => setDraf(null)); }} style={{ flex: 1 }} />
            <Button label="Lanjutkan" variant="secondary" onPress={() => { setV((s) => ({ ...s, ...draf.isian, tanggal: draf.isian.tanggal || s.tanggal || "" })); setDraf(null); }} style={{ flex: 1 }} />
          </View>
        </GlassCard>
      ) : null}

      {opsiQ.isError && !opsi ? <GalatPenuh error={opsiQ.error} online={online} onCoba={() => void opsiQ.refetch()} nama="Pilihan formulir" /> : (
        <>
          {modul === "pemasukan" ? (
            <GlassCard variant="flat" style={{ marginBottom: 14 }}>
              <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, lineHeight: 18 }}>Untuk bunga bank dan pemasukan di luar order. Uang dari pelanggan untuk sebuah order dicatat di Pembayaran &amp; Verifikasi, bukan di sini.</Text>
              <Button label="Buka Pembayaran pelanggan" variant="ghost" onPress={() => router.push("/pembayaran")} style={{ marginTop: 8 }} />
            </GlassCard>
          ) : null}

          {modul === "supplier" ? (
            <>
              <IsianTeks label="Nama supplier" nilai={v.nama ?? ""} onUbah={set("nama")} wajib galat={tampilGalat("nama")} />
              <IsianTeks label="Telepon" nilai={v.telepon ?? ""} onUbah={set("telepon")} keyboardType="phone-pad" />
              <IsianTeks label="Termin pembayaran (hari)" nilai={v.terminHari ?? ""} onUbah={set("terminHari")} keyboardType="number-pad" galat={tampilGalat("terminHari")} petunjuk="Dipakai menentukan jatuh tempo tagihan bila tidak diisi manual." />
              <IsianTeks label="Bank" nilai={v.bank ?? ""} onUbah={set("bank")} />
              <IsianTeks label="Nomor rekening" nilai={v.rekening ?? ""} onUbah={set("rekening")} keyboardType="number-pad" />
              <IsianTeks label="Atas nama" nilai={v.atasNama ?? ""} onUbah={set("atasNama")} />
              <IsianTeks label="Catatan" nilai={v.catatan ?? ""} onUbah={set("catatan")} multiline maxLength={300} />
            </>
          ) : (
            <>
              {modul === "refund" ? (
                <Kolom label="Order yang direfund" wajib galat={tampilGalat("orderId")} petunjuk="Server menghitung uang yang boleh dikembalikan dari pembayaran yang benar-benar diterima.">
                  <TextInput
                    value={cariOrder} onChangeText={setCariOrder} placeholder="Cari nomor order atau nama pelanggan" placeholderTextColor={colors.textFaint} accessibilityLabel="Cari order"
                    autoCorrect={false} maxFontSizeMultiplier={1.4}
                    style={{ minHeight: 48, paddingHorizontal: 14, borderRadius: radius.button, backgroundColor: colors.solidAlt, borderWidth: 1, borderColor: colors.hairline, color: colors.text, fontFamily: font.regular, fontSize: 15 }}
                  />
                  {orders.isFetching ? <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 6 }}>Mencari…</Text> : null}
                  {orders.isError ? <Text style={{ color: colors.danger, fontFamily: font.regular, fontSize: 12, marginTop: 6 }}>Pencarian gagal. Periksa koneksi lalu coba lagi.</Text> : null}
                  {cariOrder.trim().length >= 2 && orders.data && orders.data.length === 0 ? <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 6 }}>Order tidak ditemukan.</Text> : null}
                  {(orders.data ?? []).map((o) => (
                    <PressableScale key={o.id} onPress={() => setV((s) => ({ ...s, orderId: o.id }))} accessibilityLabel={`Order ${o.nomor}, ${o.pelanggan}, bisa dikembalikan ${formatRupiah(o.sisaBisaDirefund)}${v.orderId === o.id ? ", dipilih" : ""}`}
                      style={{ minHeight: 56, marginTop: 8, padding: 12, borderRadius: radius.button, borderWidth: 1, borderColor: v.orderId === o.id ? colors.primary : colors.hairline, backgroundColor: v.orderId === o.id ? colors.primarySoft : colors.solidAlt }}>
                      <Text maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 14 }}>{o.nomor} · {o.pelanggan}</Text>
                      <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 2 }}>Bisa dikembalikan {formatRupiah(o.sisaBisaDirefund)} dari order {formatRupiah(o.nilai)}</Text>
                    </PressableScale>
                  ))}
                </Kolom>
              ) : null}

              {modul === "kasbon" ? (
                <IsianPilih label="Karyawan" nilai={v.karyawan ?? ""} opsi={(opsi?.karyawan ?? []).map((x) => ({ id: x.name, label: x.name }))} onUbah={set("karyawan")} wajib memuat={opsiQ.isLoading} galat={tampilGalat("karyawan")} judulSheet="Pilih karyawan" placeholder="Pilih karyawan" petunjuk="Hanya karyawan Sano yang akunnya aktif." kosongPesan="Belum ada karyawan aktif." />
              ) : null}
              {modul === "tagihan" ? (
                <IsianPilih label="Supplier" nilai={v.supplierId ?? ""} opsi={(opsi?.supplier ?? []).map((x) => ({ id: x.id, label: x.name, sub: x.paymentTermDays ? `Termin ${x.paymentTermDays} hari` : undefined }))} onUbah={set("supplierId")} wajib memuat={opsiQ.isLoading} galat={tampilGalat("supplierId")} kosongPesan="Belum ada supplier. Tambah supplier dulu." />
              ) : null}

              {dokBiasa ? (
                <IsianPilih label="Kategori" nilai={v.kategoriId ?? ""} opsi={opsiLabel(modul === "pengeluaran" ? opsi?.kategoriPengeluaran : opsi?.kategoriPembelian)} onUbah={set("kategoriId")} wajib memuat={opsiQ.isLoading} galat={tampilGalat("kategoriId")} />
              ) : null}
              {modul === "tagihan" ? (
                <IsianPilih label="Dibebankan ke (kategori biaya)" nilai={v.kategoriBiayaId ?? ""} opsi={opsiLabel(opsi?.kategoriPengeluaran)} onUbah={set("kategoriBiayaId")} wajib memuat={opsiQ.isLoading} galat={tampilGalat("kategoriBiayaId")} />
              ) : null}
              {modul === "pemasukan" ? (
                <IsianPilih label="Akun pendapatan" nilai={v.akunId ?? ""} opsi={(opsi?.akunPemasukanLain ?? []).map((a) => ({ id: a.id, label: `${a.code} ${a.name}` }))} onUbah={set("akunId")} wajib memuat={opsiQ.isLoading} galat={tampilGalat("akunId")} petunjuk="Akun pendapatan penjualan/layanan tidak ditawarkan." />
              ) : null}

              {(dokBiasa || modul === "pemasukan" || modul === "tagihan") ? (
                <IsianTeks label={modul === "tagihan" ? "Keterangan tagihan" : "Keterangan"} nilai={v.keterangan ?? ""} onUbah={set("keterangan")} wajib galat={tampilGalat("keterangan")} maxLength={200} />
              ) : null}
              {modul === "tagihan" ? <IsianTeks label="Nomor faktur supplier" nilai={v.nomorFaktur ?? ""} onUbah={set("nomorFaktur")} /> : null}
              {modul === "kasbon" || modul === "refund" ? <IsianTeks label={modul === "kasbon" ? "Alasan / urgensi" : "Alasan refund"} nilai={v.alasan ?? ""} onUbah={set("alasan")} wajib galat={tampilGalat("alasan")} multiline maxLength={300} /> : null}

              <IsianUang nilai={v.nominal ?? ""} onUbah={set("nominal")} galat={tampilGalat("nominal")} petunjuk={sisaRefund ? `Bisa dikembalikan: ${formatRupiah(sisaRefund)}` : null} />
              <IsianTanggal label={modul === "tagihan" ? "Tanggal tagihan" : "Tanggal"} nilai={v.tanggal ?? ""} onUbah={set("tanggal")} galat={tampilGalat("tanggal")} />
              {modul === "tagihan" ? <IsianTeks label="Jatuh tempo (opsional)" nilai={v.jatuhTempo ?? ""} onUbah={set("jatuhTempo")} galat={tampilGalat("jatuhTempo")} placeholder="TTTT-BB-HH" petunjuk="Kosong = mengikuti termin supplier. Kalau supplier tanpa termin, umur dihitung dari tanggal tagihan." keyboardType="numbers-and-punctuation" /> : null}

              {dokBiasa && !opsi?.hanyaReimbursement ? (
                <IsianPilih label="Cara bayar" nilai={v.mode ?? "LANGSUNG"} opsi={(opsi?.mode ?? []).map((x) => ({ id: x.id, label: x.label }))} onUbah={set("mode")} wajib />
              ) : dokBiasa ? (
                <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginBottom: 14 }}>Akun Anda mengajukan sebagai reimbursement (uang ditalangi lalu diganti).</Text>
              ) : null}
              {(modul === "kasbon" || modul === "pemasukan" || modul === "refund" || (dokBiasa && (v.mode === "LANGSUNG" || opsi?.hanyaReimbursement === false))) && !(dokBiasa && opsi?.hanyaReimbursement) ? (
                <IsianPilih
                  label={modul === "pemasukan" ? "Masuk ke rekening" : modul === "refund" ? "Dikembalikan dari rekening" : "Uang keluar dari"} nilai={v.rekeningId ?? ""} opsi={rekOpsi} onUbah={set("rekeningId")}
                  wajib={dokBiasa ? v.mode === "LANGSUNG" : true} memuat={opsiQ.isLoading} galat={tampilGalat("rekeningId")} judulSheet="Pilih rekening" placeholder="Pilih bank / kas"
                  petunjuk={opsiQ.isError ? "Rekening gagal dimuat — tarik untuk memuat ulang." : "Saldo negatif tetap boleh; server yang memutuskan."} kosongPesan="Belum ada rekening kas/bank aktif."
                />
              ) : null}
              {dokBiasa ? <IsianTeks label="Penerima / toko (opsional)" nilai={v.penerima ?? ""} onUbah={set("penerima")} /> : null}
              {dokBiasa || modul === "pemasukan" ? <IsianTeks label="Catatan (opsional)" nilai={v.catatan ?? ""} onUbah={set("catatan")} multiline maxLength={300} /> : null}
              {opsiQ.isError ? <Button label="Coba lagi memuat pilihan" variant="ghost" onPress={() => void opsiQ.refetch()} style={{ marginBottom: 12 }} /> : null}

              <LampiranField
                label={dokBiasa ? "Foto nota" : "Bukti / lampiran (opsional)"} wajib={false} petunjuk={pengingatNota ?? undefined} awalUri={typeof fotoParam === "string" && fotoParam ? fotoParam : null}
                onUrl={setUrl} onSibuk={setFotoSibuk}
              />
            </>
          )}

          <View style={{ marginTop: 6, gap: 10 }}>
            {!online ? <Text style={{ color: colors.warning, fontFamily: font.medium, fontSize: 12 }}>{S.offline.aksiNonaktif} untuk mengirim. Draf di HP tetap bisa disimpan.</Text> : null}
            {dicoba && adaGalat ? <Text accessibilityLiveRegion="polite" style={{ color: colors.danger, fontFamily: font.regular, fontSize: 12 }}>Lengkapi isian yang ditandai merah.</Text> : null}
            <Button label={judulTombol} loading={sibuk} disabled={!boleh} onPress={() => { void kirim(true); }} />
            {dokBiasa ? <Button label="Simpan sebagai draf di server" variant="secondary" disabled={!boleh} onPress={() => { void kirim(false); }} /> : null}
            <Button label="Simpan draf di HP" variant="ghost" disabled={sibuk} onPress={() => { void simpanLokal(); }} />
            <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, lineHeight: 16 }}>Anda mungkin diminta PIN atau biometrik saat mengirim. Draf di HP tidak pernah dikirim otomatis.</Text>
          </View>
        </>
      )}
    </Screen>
  );
}
