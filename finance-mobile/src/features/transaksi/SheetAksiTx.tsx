import React, { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Plus, Trash2 } from "lucide-react-native";
import { Sheet } from "@/design/Sheet";
import { MoneyText } from "@/design/MoneyText";
import { Button, PressableScale } from "@/design/ui";
import { font } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { useTinggiKeyboard } from "@/hooks/useKeyboard";
import { hariIniWIB } from "@/lib/dates";
import { bandingMoney, formatRupiah, isZero, jumlahMoney, kurangMoney, parseInputRupiah, type Money } from "@/lib/money";
import type { DpEligible, OpsiForm, PembayaranPiutang } from "@/api/types";
import type { IsianAksi } from "@/api/transaksi";
import { IsianPilih, IsianTanggal, IsianUang, tanggalSah } from "./Isian";

// SHEET ISIAN AKSI — dipakai Detail (bayar dokumen/tagihan, potong gaji kasbon, atur alokasi pembayaran). Validasi inline sebelum kirim; server tetap penentu akhir.

export function BayarSheet({ visible, judul, sub, tombol, perlu, opsi, opsiMemuat, opsiGalat, onCobaOpsi, sisa, sibuk, onKirim, onTutup }: {
  visible: boolean; judul: string; sub?: string; tombol: string; perlu: string[]; opsi: OpsiForm | undefined; opsiMemuat: boolean; opsiGalat: boolean; onCobaOpsi: () => void;
  /** Batas atas nominal (sisa yang boleh dibayar/dipotong) — dibandingkan sebagai string desimal, tidak dengan Number. */
  sisa: Money | null; sibuk: boolean; onKirim: (i: IsianAksi) => void; onTutup: () => void;
}) {
  const { colors } = useTheme();
  const keyboard = useTinggiKeyboard();
  const butuhRek = perlu.includes("rekening");
  const butuhNominal = perlu.includes("nominal");
  const butuhTanggal = perlu.includes("tanggal");
  const [rek, setRek] = useState("");
  const [teksNominal, setTeksNominal] = useState(sisa && !isZero(sisa) ? String(sisa).replace(/\.00$/, "") : "");
  const [tanggal, setTanggal] = useState(hariIniWIB());
  const [dicoba, setDicoba] = useState(false);

  const nominal = butuhNominal ? parseInputRupiah(teksNominal) : null;
  const galatRek = butuhRek && !rek ? "Pilih rekening sumber uang." : null;
  const galatNominal = !butuhNominal ? null : !nominal || isZero(nominal) || nominal.startsWith("-") ? "Isi nominal lebih dari 0." : sisa && bandingMoney(nominal, sisa) > 0 ? `Nominal melebihi sisa (${formatRupiah(sisa)}).` : null;
  const galatTgl = butuhTanggal && !tanggalSah(tanggal) ? "Tanggal tidak sah (TTTT-BB-HH)." : null;
  const valid = !galatRek && !galatNominal && !galatTgl;

  const rekOpsi = (opsi?.rekening ?? []).map((r) => ({ id: r.id, label: r.name, sub: `Saldo ${formatRupiah(r.saldo)}` }));

  return (
    <Sheet visible={visible} onClose={() => { if (!sibuk) onTutup(); }} judul={judul} sub={sub}>
      <View style={{ paddingBottom: keyboard > 0 ? keyboard - 8 : 0 }}>
        <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {butuhRek ? (
            <IsianPilih
              label="Uang keluar dari" nilai={rek} opsi={rekOpsi} onUbah={setRek} wajib memuat={opsiMemuat} judulSheet="Pilih rekening" placeholder="Pilih bank / kas"
              galat={dicoba ? galatRek : null} kosongPesan="Belum ada rekening kas/bank aktif."
              petunjuk={opsiGalat ? "Rekening gagal dimuat." : "Saldo negatif tetap boleh; server yang memutuskan."}
            />
          ) : null}
          {butuhRek && opsiGalat ? <Button label="Coba lagi memuat rekening" variant="ghost" onPress={onCobaOpsi} style={{ marginBottom: 12 }} /> : null}
          {butuhNominal ? <IsianUang nilai={teksNominal} onUbah={setTeksNominal} galat={dicoba ? galatNominal : null} petunjuk={sisa ? `Sisa: ${formatRupiah(sisa)}` : null} /> : null}
          {butuhTanggal ? <IsianTanggal nilai={tanggal} onUbah={setTanggal} galat={dicoba ? galatTgl : null} /> : null}
        </ScrollView>
        <Button
          label={tombol} loading={sibuk} disabled={sibuk || (butuhRek && opsiMemuat)} style={{ marginTop: 6 }}
          onPress={() => {
            setDicoba(true);
            if (!valid) return;
            onKirim({ rekeningId: butuhRek ? rek : undefined, nominal: nominal ?? undefined, tanggal: butuhTanggal ? tanggal : undefined });
          }}
        />
        <Text style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, marginTop: 8 }}>Anda mungkin diminta PIN atau biometrik. Perintah tidak diantre saat offline.</Text>
      </View>
    </Sheet>
  );
}

/** Pilih satu DP eligible lalu tentukan nominal yang diterapkan ke pembelian ini. Server tetap yang memvalidasi & memposting jurnal — sheet ini hanya membantu memilih & menghitung pratinjau. */
export function TerapkanDpSheet({ visible, totalPembelian, sisaSaatIni, data, memuat, galatMuat, onCobaMuat, sibuk, onKirim, onTutup }: {
  visible: boolean; totalPembelian: Money; sisaSaatIni: Money;
  data: DpEligible | undefined; memuat: boolean; galatMuat: boolean; onCobaMuat: () => void;
  sibuk: boolean; onKirim: (i: { advancePurchaseId: string; nominal: Money }) => void; onTutup: () => void;
}) {
  const { colors } = useTheme();
  const keyboard = useTinggiKeyboard();
  const eligible = data?.eligible ?? [];
  const [dpId, setDpId] = useState("");
  const [teksNominal, setTeksNominal] = useState("");
  const [dicoba, setDicoba] = useState(false);
  const dp = eligible.find((e) => e.id === dpId);

  const nominal = parseInputRupiah(teksNominal);
  const galatDp = !dpId ? "Pilih uang muka yang akan diterapkan." : null;
  const galatNominal = !nominal || isZero(nominal) || nominal.startsWith("-") ? "Isi nominal lebih dari 0."
    : dp && bandingMoney(nominal, dp.saldoTersedia) > 0 ? `Nominal melebihi saldo DP tersedia (${formatRupiah(dp.saldoTersedia)}).`
    : bandingMoney(nominal, sisaSaatIni) > 0 ? `Nominal melebihi sisa pembayaran (${formatRupiah(sisaSaatIni)}).`
    : null;
  const valid = !galatDp && !galatNominal;
  const sisaSetelah = nominal && !galatNominal ? kurangMoney(sisaSaatIni, nominal) : null;

  const dpOpsi = eligible.map((e) => ({ id: e.id, label: e.purchaseNumber, sub: `Saldo tersedia ${formatRupiah(e.saldoTersedia)}` }));

  return (
    <Sheet visible={visible} onClose={() => { if (!sibuk) onTutup(); }} judul="Terapkan Uang Muka" sub="Kurangi sisa pembayaran pembelian ini dengan saldo DP supplier yang sama.">
      <View style={{ paddingBottom: keyboard > 0 ? keyboard - 8 : 0 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13 }}>Total pembelian</Text>
          <MoneyText value={totalPembelian} size="sm" />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 12 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13 }}>Sisa pembayaran saat ini</Text>
          <MoneyText value={sisaSaatIni} size="sm" />
        </View>
        <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {galatMuat ? (
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: colors.danger, fontFamily: font.regular, fontSize: 13, marginBottom: 8 }}>Daftar uang muka gagal dimuat.</Text>
              <Button label="Coba lagi" variant="ghost" onPress={onCobaMuat} />
            </View>
          ) : data && !data.bisaMenerapkan ? (
            <View style={{ marginBottom: 12 }}>
              {(data.alasan ?? []).map((a, i) => (
                <Text key={i} style={{ color: colors.danger, fontFamily: font.regular, fontSize: 13, marginBottom: 4 }}>{a}</Text>
              ))}
            </View>
          ) : !memuat && eligible.length === 0 ? (
            <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, marginBottom: 12 }}>Tidak ada uang muka dari supplier yang sama dengan saldo tersedia.</Text>
          ) : (
            <>
              <IsianPilih
                label="Uang muka" nilai={dpId} opsi={dpOpsi} onUbah={(id) => { setDpId(id); const e = eligible.find((x) => x.id === id); setTeksNominal(e ? String(e.saldoTersedia.startsWith("-") ? "0" : e.saldoTersedia).replace(/\.00$/, "") : ""); }}
                wajib memuat={memuat} judulSheet="Pilih uang muka" placeholder="Pilih uang muka supplier" galat={dicoba ? galatDp : null}
              />
              {dp ? (
                <View style={{ marginBottom: 8 }}>
                  <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12 }}>Supplier: {dp.purchaseNumber}</Text>
                  <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12 }}>Saldo DP tersedia: {formatRupiah(dp.saldoTersedia)}</Text>
                </View>
              ) : null}
              <IsianUang nilai={teksNominal} onUbah={setTeksNominal} galat={dicoba ? galatNominal : null} petunjuk={dp ? `Maksimal ${formatRupiah(dp.saldoTersedia)}` : null} />
              {sisaSetelah ? (
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: colors.primarySoft }}>
                  <Text style={{ color: colors.text, fontFamily: font.medium, fontSize: 13 }}>Dr Utang Usaha / Cr Uang Muka Pembelian</Text>
                  <MoneyText value={sisaSetelah} size="sm" />
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
        <Button
          label="Terapkan" loading={sibuk} disabled={sibuk || memuat || galatMuat || (data ? !data.bisaMenerapkan : false) || eligible.length === 0} style={{ marginTop: 12 }}
          onPress={() => {
            setDicoba(true);
            if (!valid || !nominal) return;
            onKirim({ advancePurchaseId: dpId, nominal });
          }}
        />
        <Text style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, marginTop: 8 }}>Anda mungkin diminta PIN atau biometrik. Perintah tidak diantre saat offline.</Text>
      </View>
    </Sheet>
  );
}

type BarisAlokasi = { orderId: string; teks: string };

/** Atur alokasi satu pembayaran ke beberapa order milik pelanggan yang sama. Total alokasi WAJIB persis sama dengan nominal pembayaran (aturan server). */
export function AlokasiSheet({ visible, pembayaran, order, sibuk, onKirim, onTutup }: {
  visible: boolean; pembayaran: PembayaranPiutang; order: { id: string; nomor: string | null }[]; sibuk: boolean;
  onKirim: (a: { orderId: string; amount: Money }[]) => void; onTutup: () => void;
}) {
  const { colors } = useTheme();
  const keyboard = useTinggiKeyboard();
  const awal = useMemo<BarisAlokasi[]>(
    () => (pembayaran.alokasi.length > 0
      ? pembayaran.alokasi.map((a) => ({ orderId: a.orderId, teks: String(a.nominal).replace(/\.00$/, "") }))
      : [{ orderId: pembayaran.asalOrderId, teks: String(pembayaran.nominal).replace(/\.00$/, "") }]),
    [pembayaran],
  );
  const [baris, setBaris] = useState<BarisAlokasi[]>(awal);
  const nomorOrder = (id: string) => order.find((o) => o.id === id)?.nomor ?? id.slice(0, 8);
  const nilai = baris.map((b) => parseInputRupiah(b.teks));
  const semuaSah = nilai.every((n) => n && !isZero(n) && !n.startsWith("-"));
  const terisi = nilai.filter((n): n is Money => !!n);
  const sisa = kurangMoney(pembayaran.nominal, terisi.length ? jumlahMoney(terisi) : ("0.00" as Money));
  const pas = isZero(sisa);
  const ganda = new Set(baris.map((b) => b.orderId)).size !== baris.length;
  const pilihan = order.filter((o) => !baris.some((b) => b.orderId === o.id));
  const ubah = (i: number, teks: string) => setBaris((s) => s.map((b, j) => (j === i ? { ...b, teks: teks.replace(/[^\d.,]/g, "") } : b)));

  return (
    <Sheet visible={visible} onClose={() => { if (!sibuk) onTutup(); }} judul="Atur alokasi pembayaran" sub="Bagikan nominal pembayaran ke order pelanggan. Total harus persis sama dengan nominal pembayaran.">
      <View style={{ paddingBottom: keyboard > 0 ? keyboard - 8 : 0 }}>
        <View accessible accessibilityLabel={`Nominal pembayaran ${formatRupiah(pembayaran.nominal)}`} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13 }}>Nominal pembayaran</Text>
          <MoneyText value={pembayaran.nominal} size="sm" />
        </View>
        <ScrollView style={{ maxHeight: 300 }} keyboardShouldPersistTaps="handled">
          {baris.map((b, i) => (
            <View key={b.orderId} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ width: "34%", color: colors.text, fontFamily: font.medium, fontSize: 13 }}>Order {nomorOrder(b.orderId)}</Text>
              <View style={{ flex: 1 }}>
                <IsianUang label={`Nominal order ${nomorOrder(b.orderId)}`} nilai={b.teks} onUbah={(t) => ubah(i, t)} wajib={false} />
              </View>
              {baris.length > 1 ? (
                <PressableScale onPress={() => setBaris((s) => s.filter((_, j) => j !== i))} accessibilityLabel={`Hapus order ${nomorOrder(b.orderId)}`} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                  <Trash2 size={18} color={colors.textMuted} strokeWidth={1.75} />
                </PressableScale>
              ) : null}
            </View>
          ))}
          {pilihan.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
              {pilihan.map((o) => (
                <PressableScale key={o.id} onPress={() => setBaris((s) => [...s, { orderId: o.id, teks: "" }])} accessibilityLabel={`Tambah order ${o.nomor ?? o.id}`} style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 18, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.primarySoft }}>
                  <Plus size={14} color={colors.primary} strokeWidth={2} />
                  <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 13 }}>{o.nomor ?? o.id.slice(0, 8)}</Text>
                </PressableScale>
              ))}
            </View>
          ) : null}
        </ScrollView>
        <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ color: pas ? colors.success : colors.warning, fontFamily: font.medium, fontSize: 13 }}>{pas ? "Seluruh nominal teralokasi" : "Belum teralokasi"}</Text>
          {!pas ? <MoneyText value={sisa} size="sm" /> : null}
        </View>
        {ganda ? <Text style={{ color: colors.danger, fontFamily: font.regular, fontSize: 12, marginTop: 4 }}>Satu order tidak boleh muncul dua kali.</Text> : null}
        <Button
          label="Simpan alokasi" loading={sibuk} disabled={sibuk || !pas || !semuaSah || ganda} style={{ marginTop: 12 }}
          onPress={() => onKirim(baris.map((b, i) => ({ orderId: b.orderId, amount: nilai[i] as Money })))}
        />
      </View>
    </Sheet>
  );
}
