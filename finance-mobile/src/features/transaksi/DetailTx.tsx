import React, { useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, CircleCheck, ShieldAlert, TriangleAlert } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { MoneyText } from "@/design/MoneyText";
import { StatusBadge } from "@/design/StatusBadge";
import { Sheet } from "@/design/Sheet";
import { TeksSensitif } from "@/design/Samarkan";
import { Button, EmptyState, MockBanner, OfflineBanner, PressableScale, SectionHeader, Skeleton } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { useOpsiForm, useTxDetail } from "@/hooks/transaksi";
import { useOnline } from "@/hooks/useOnline";
import { ApiError } from "@/api/errors";
import { ENV } from "@/lib/env";
import { formatRupiah, isMoneyString, parseInputRupiah, type Money } from "@/lib/money";
import { tanggalPendek, waktuLengkap } from "@/lib/dates";
import { S } from "@/lib/strings";
import { BannerBasi, GalatPenuh } from "@/features/umum/StatusData";
import { AlasanSheet } from "@/features/persetujuan/Sheets";
import { GaleriLampiran, LinimasaRiwayat } from "@/features/persetujuan/LampiranRiwayat";
import type { AksiTx, BarisTx, DetailTx, ModulTx, PembayaranPiutang } from "@/api/types";
import { KONFIG, modulValid } from "./modul";
import { teksJatuhTempo, utamaTx } from "./KartuTx";
import { AlokasiSheet, BayarSheet } from "./SheetAksiTx";
import { LampiranField } from "./LampiranField";
import { IsianTeks, IsianUang } from "./Isian";
import { useAksiTx, type HasilTx } from "./useAksiTx";

type Pesan = { tone: "sukses" | "galat" | "info"; teks: string };
type Sheetnya = null | "ajukan" | "bayar" | "potongGaji" | "batalkan" | "ubah" | "lampiran" | "alokasi";

const URUTAN_AKSI = ["ajukan", "bayar", "potongGaji", "lampiran", "ubah", "batalkan"] as const;
const LABEL_AKSI: Record<string, { label: string; variant: "primary" | "secondary" | "danger" | "ghost"; sukses: string }> = {
  ajukan: { label: "Ajukan untuk persetujuan", variant: "primary", sukses: "Diajukan. Dokumen kini ada di Persetujuan." },
  bayar: { label: "Bayar", variant: "primary", sukses: "Pembayaran dicatat. Status resmi dimuat dari server." },
  potongGaji: { label: "Potong dari gaji", variant: "primary", sukses: "Pemotongan gaji dicatat. Sisa kasbon dimuat dari server." },
  lampiran: { label: "Lampirkan nota", variant: "secondary", sukses: "Foto nota terpasang." },
  ubah: { label: "Ubah", variant: "secondary", sukses: "Perubahan disimpan." },
  batalkan: { label: "Batalkan", variant: "danger", sukses: "Dibatalkan. Jurnal dibalik dan alasan tercatat." },
};

function BannerPesan({ pesan }: { pesan: Pesan }) {
  const { colors } = useTheme();
  const w = pesan.tone === "sukses" ? { bg: colors.successSoft, fg: colors.success, I: CircleCheck } : pesan.tone === "galat" ? { bg: colors.dangerSoft, fg: colors.danger, I: TriangleAlert } : { bg: colors.infoSoft, fg: colors.info, I: ShieldAlert };
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ flexDirection: "row", gap: 10, padding: 12, borderRadius: radius.small, backgroundColor: w.bg, marginBottom: 12 }}>
      <w.I size={18} color={w.fg} strokeWidth={1.75} />
      <Text maxFontSizeMultiplier={1.3} style={{ flex: 1, color: colors.text, fontFamily: font.medium, fontSize: 13, lineHeight: 18 }}>{pesan.teks}</Text>
    </View>
  );
}

function BarisLabel({ b, onTautan }: { b: BarisTx; onTautan: (m: ModulTx, id: string) => void }) {
  const { colors } = useTheme();
  const teksNilai = b.jenis === "tanggal" ? tanggalPendek(b.nilai) : b.jenis === "waktu" ? waktuLengkap(b.nilai) : b.nilai;
  const isi = (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 16, paddingVertical: 8 }}>
      <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, flexShrink: 0, maxWidth: "46%" }}>{b.label}</Text>
      {b.jenis === "uang" && isMoneyString(b.nilai)
        ? <View style={{ flexShrink: 1, maxWidth: "54%" }}><MoneyText value={b.nilai as Money} size="sm" /></View>
        : <View style={{ flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 2 }}>
          <TeksSensitif maxFontSizeMultiplier={1.3} style={{ color: b.tautan ? colors.primary : colors.text, fontFamily: font.medium, fontSize: 13, textAlign: "right", flexShrink: 1 }}>{teksNilai}</TeksSensitif>
          {b.tautan ? <ChevronRight size={14} color={colors.primary} strokeWidth={1.75} /> : null}
        </View>}
    </View>
  );
  const t = b.tautan;
  return t ? <PressableScale onPress={() => onTautan(t.modul, t.id)} accessibilityLabel={`${b.label}: ${teksNilai}. Buka`}>{isi}</PressableScale> : <View accessible accessibilityLabel={`${b.label}: ${teksNilai}`}>{isi}</View>;
}

function BarisPembayaran({ p, onBuka, onAlokasi }: { p: PembayaranPiutang; onBuka: () => void; onAlokasi: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
      <PressableScale onPress={onBuka} accessibilityLabel={`Pembayaran ${p.statusLabel}. Buka di Pembayaran pelanggan`}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <StatusBadge label={p.statusLabel} tone={p.status === "TERVERIFIKASI" ? "success" : p.status === "DIBATALKAN" ? "neutral" : "warning"} />
            <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, marginTop: 4 }}>{p.metode} · {p.tanggal ? tanggalPendek(p.tanggal) : "—"}</Text>
          </View>
          <View style={{ flexShrink: 0, maxWidth: "50%" }}><MoneyText value={p.nominal} size="sm" /></View>
          <ChevronRight size={16} color={colors.textMuted} strokeWidth={1.75} />
        </View>
      </PressableScale>
      {p.alokasi.length > 0 ? p.alokasi.map((a) => (
        <View key={a.orderId} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, paddingTop: 4 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12 }}>Dialokasikan ke order {a.nomor ?? "—"}</Text>
          <MoneyText value={a.nominal} size="sm" />
        </View>
      )) : null}
      {p.aksiAlokasi.boleh ? <Button label="Atur alokasi" variant="ghost" onPress={onAlokasi} style={{ marginTop: 8 }} /> : null}
    </View>
  );
}

/** Ubah data sederhana: dokumen (keterangan & nominal) atau supplier. Alasan perubahan wajib (aturan server untuk dokumen). */
function UbahSheet({ visible, d, sibuk, onKirim, onTutup }: { visible: boolean; d: DetailTx; sibuk: boolean; onKirim: (perubahan: Record<string, unknown>, alasan: string) => void; onTutup: () => void }) {
  const supplier = d.modul === "supplier";
  const dok = d.modul === "pengeluaran" || d.modul === "pembelian";
  const [judul, setJudul] = useState(d.judul);
  const [nominal, setNominal] = useState(String(d.nominal).replace(/\.00$/, ""));
  const [telp, setTelp] = useState(d.supplier?.telepon ?? "");
  const [bank, setBank] = useState(d.supplier?.bank ?? "");
  const [rek, setRek] = useState(d.supplier?.rekeningBank ?? "");
  const [an, setAn] = useState(d.supplier?.atasNama ?? "");
  const [alasan, setAlasan] = useState("");
  const nom = parseInputRupiah(nominal);
  const galatNominal = dok && (!nom || nom.startsWith("-") || /^0+(\.0+)?$/.test(nom)) ? "Isi nominal lebih dari 0." : null;
  const galatAlasan = dok && alasan.trim().length < 3 ? "Alasan perubahan wajib diisi (minimal 3 huruf)." : null;
  const galatNama = !judul.trim() ? (supplier ? "Nama supplier wajib diisi." : "Keterangan wajib diisi.") : null;
  const valid = !galatNominal && !galatAlasan && !galatNama;
  return (
    <Sheet visible={visible} onClose={() => { if (!sibuk) onTutup(); }} judul={supplier ? "Ubah supplier" : "Ubah dokumen"} sub={supplier ? undefined : "Hanya tersedia selama dokumen belum dibukukan. Perubahan tercatat di riwayat."}>
      <IsianTeks label={supplier ? "Nama supplier" : "Keterangan"} nilai={judul} onUbah={setJudul} wajib galat={galatNama} />
      {dok ? <IsianUang nilai={nominal} onUbah={setNominal} galat={galatNominal} /> : null}
      {supplier ? (<><IsianTeks label="Telepon" nilai={telp} onUbah={setTelp} keyboardType="phone-pad" /><IsianTeks label="Bank" nilai={bank} onUbah={setBank} /><IsianTeks label="Nomor rekening" nilai={rek} onUbah={setRek} keyboardType="number-pad" /><IsianTeks label="Atas nama" nilai={an} onUbah={setAn} /></>) : null}
      {dok ? <IsianTeks label="Alasan perubahan" nilai={alasan} onUbah={setAlasan} wajib galat={alasan.length > 0 ? galatAlasan : null} multiline maxLength={300} /> : null}
      <Button
        label="Simpan perubahan" loading={sibuk} disabled={sibuk || !valid}
        onPress={() => onKirim(supplier ? { name: judul.trim(), phone: telp.trim(), bankName: bank.trim(), bankAccount: rek.trim(), bankHolder: an.trim() } : { description: judul.trim(), amount: nom }, alasan)}
      />
    </Sheet>
  );
}

export function DetailTxScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();
  const { modul: modulParam, id } = useLocalSearchParams<{ modul: string; id: string }>();
  const modul = modulValid(modulParam) ? modulParam : "pengeluaran";
  const k = KONFIG[modul];
  const q = useTxDetail(modul, String(id));
  const { aksi, sibuk } = useAksiTx();
  const [sheet, setSheet] = useState<Sheetnya>(null);
  const [pesan, setPesan] = useState<Pesan | null>(null);
  const [alasan, setAlasan] = useState("");
  const [foto, setFoto] = useState<string | null>(null);
  const [fotoSibuk, setFotoSibuk] = useState(false);
  const [alokasiPilih, setAlokasiPilih] = useState<PembayaranPiutang | null>(null);
  const opsi = useOpsiForm(sheet === "bayar");
  const d = q.data;
  const muatUlang = () => void q.refetch();

  function tampilkan(h: HasilTx, sukses: string, bukaLagi?: () => void) {
    if (h.ok) { setPesan({ tone: "sukses", teks: sukses }); return; }
    if (h.info.jenis === "batal") { bukaLagi?.(); return; } // step-up dibatalkan: isian yang sudah ditulis tidak hilang
    setPesan({ tone: h.info.jenis === "konflik" || h.info.jenis === "tidakPasti" ? "info" : "galat", teks: h.info.pesan });
  }

  // PENTING: Sheet (Modal) ditutup SEBELUM perintah dikirim — layar kunci step-up digambar di root aplikasi dan tertutup Modal bila masih terbuka.
  async function kirim(kode: string, isian: Parameters<typeof aksi>[3], bukaLagi: Sheetnya) {
    if (!d) return;
    const a = d.aksi[kode];
    if (!a) return;
    setSheet(null);
    const h = await aksi(d.kunci, kode, a, isian);
    if (h.ok) { setAlasan(""); setFoto(null); }
    tampilkan(h, LABEL_AKSI[kode]?.sukses ?? "Berhasil.", () => setSheet(bukaLagi));
  }

  const tidakAda = q.error instanceof ApiError && q.error.status === 404;
  const utama = d ? utamaTx(d) : null;
  const jt = d ? teksJatuhTempo(d) : null;
  const bisaAksi = d ? URUTAN_AKSI.filter((kode) => d.aksi[kode]?.boleh) : [];
  const tidakBisa = d ? URUTAN_AKSI.filter((kode) => d.aksi[kode] && !d.aksi[kode]?.boleh && d.aksi[kode]?.alasan) : [];
  const bukaTautan = (m: ModulTx, tid: string) => router.push({ pathname: "/tx/[modul]/[id]", params: { modul: m, id: tid } });

  return (
    <Screen refreshing={q.isRefetching} onRefresh={muatUlang}>
      <PressableScale onPress={() => router.back()} accessibilityLabel={`Kembali ke daftar ${k.tunggal}`} style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8, minHeight: 44 }}>
        <ChevronLeft size={22} color={colors.primary} strokeWidth={1.75} />
        <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 15 }}>{k.label}</Text>
      </PressableScale>
      {ENV.useMocks ? <MockBanner /> : null}
      {!online ? <OfflineBanner /> : null}
      {pesan ? <BannerPesan pesan={pesan} /> : null}

      {q.isLoading && !d ? (
        <View style={{ gap: 12 }} accessibilityLabel={`Memuat detail ${k.tunggal}`} accessibilityLiveRegion="polite">
          <Skeleton tinggi={110} style={{ borderRadius: radius.card }} />
          <Skeleton tinggi={220} style={{ borderRadius: radius.card }} />
        </View>
      ) : tidakAda ? (
        <EmptyState judul="Data tidak ditemukan" isi="Dokumen ini mungkin sudah tidak ada." aksi="Kembali" onAksi={() => router.back()} />
      ) : !d || !utama ? (
        <GalatPenuh error={q.error} online={online} onCoba={muatUlang} nama={`Detail ${k.tunggal}`} />
      ) : (
        <>
          {q.isError ? <BannerBasi error={q.error} online={online} onCoba={muatUlang} /> : null}
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.primary, fontFamily: font.semibold, fontSize: 13 }}>{k.tunggal.charAt(0).toUpperCase() + k.tunggal.slice(1)} · {d.nomor}</Text>
          <TeksSensitif maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 22, lineHeight: 28, marginTop: 6 }}>{d.judul}</TeksSensitif>
          <View style={{ marginTop: 12 }}><MoneyText value={utama.nilai} size="xl" /></View>
          {utama.label ? <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 2 }}>{utama.label}{d.nominal !== utama.nilai ? ` · dari ${formatRupiah(d.nominal)}` : ""}</Text> : null}
          <View style={{ marginTop: 10, flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <StatusBadge label={d.statusLabel} tone={d.nada} />
            {jt ? <StatusBadge label={jt.teks} tone={jt.lewat ? "danger" : "info"} /> : null}
          </View>

          {d.syarat ? (
            <GlassCard variant="flat" style={{ marginTop: 16 }}>
              <View accessible accessibilityLabel={`Perlu diperhatikan: ${d.syarat}`} style={{ flexDirection: "row", gap: 10 }}>
                <TriangleAlert size={18} color={colors.warning} strokeWidth={1.75} />
                <Text maxFontSizeMultiplier={1.3} style={{ flex: 1, color: colors.text, fontFamily: font.regular, fontSize: 13, lineHeight: 18 }}>{d.syarat} Unggah nota lewat “Lampirkan nota” agar bisa disetujui.</Text>
              </View>
            </GlassCard>
          ) : null}

          {d.persetujuan ? (
            <GlassCard variant="flat" style={{ marginTop: 16 }}>
              <Text maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 14 }}>Menunggu keputusan Anda</Text>
              <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, lineHeight: 18, marginTop: 4 }}>Setuju atau tolak dilakukan di Persetujuan, lengkap dengan alasan dan lampiran.</Text>
              <Button label="Buka di Persetujuan" variant="secondary" style={{ marginTop: 10 }} onPress={() => router.push({ pathname: "/persetujuan/[jenis]/[id]", params: { jenis: d.persetujuan?.jenis ?? "expense", id: d.persetujuan?.id ?? d.id } })} />
            </GlassCard>
          ) : d.status === "MENUNGGU_APPROVAL" ? (
            <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 12 }}>Menunggu keputusan pihak yang berwenang di Persetujuan.</Text>
          ) : null}

          {d.catatan ? (
            <GlassCard variant="flat" style={{ marginTop: 16 }}>
              <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, lineHeight: 18 }}>{d.catatan}</Text>
            </GlassCard>
          ) : null}

          {d.bagian.filter((b) => b.baris.length > 0).map((b) => (
            <View key={b.judul}>
              <SectionHeader judul={b.judul} />
              <GlassCard>{b.baris.map((r) => <BarisLabel key={`${b.judul}-${r.label}-${r.nilai}`} b={r} onTautan={bukaTautan} />)}</GlassCard>
            </View>
          ))}

          {modul === "piutang" ? (
            <>
              <SectionHeader judul="Pembayaran resmi" sub="Dari server. Status verifikasi & status order tetap mengikuti Pembayaran pelanggan." />
              {d.pembayaran.length > 0 ? (
                <GlassCard>
                  {d.pembayaran.map((p) => <BarisPembayaran key={p.id} p={p} onBuka={() => router.push({ pathname: "/pembayaran/[id]", params: { id: p.id } })} onAlokasi={() => { setAlokasiPilih(p); setSheet("alokasi"); }} />)}
                </GlassCard>
              ) : <GlassCard variant="flat"><Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13 }}>Belum ada pembayaran tercatat untuk order ini.</Text></GlassCard>}
            </>
          ) : null}

          {d.adaLampiran || d.lampiran.length > 0 ? (<><SectionHeader judul="Lampiran" /><GaleriLampiran lampiran={d.lampiran} ada={d.adaLampiran} onMuatUlang={muatUlang} /></>) : null}

          {d.riwayat.length > 0 ? (<><SectionHeader judul="Riwayat" /><LinimasaRiwayat riwayat={d.riwayat} /></>) : null}

          {bisaAksi.length > 0 || tidakBisa.length > 0 ? (
            <View style={{ marginTop: 22, gap: 10 }}>
              {!online && bisaAksi.length > 0 ? <Text style={{ color: colors.warning, fontFamily: font.medium, fontSize: 12 }}>{S.offline.aksiNonaktif}</Text> : null}
              {bisaAksi.map((kode) => (
                <Button key={kode} label={LABEL_AKSI[kode]?.label ?? kode} variant={LABEL_AKSI[kode]?.variant ?? "primary"} disabled={sibuk || !online} loading={sibuk && sheet === kode} onPress={() => setSheet(kode)} />
              ))}
              {tidakBisa.length > 0 ? (
                <GlassCard variant="flat">
                  <Text maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.medium, fontSize: 12, marginBottom: 4 }}>Tidak tersedia</Text>
                  {tidakBisa.map((kode) => (
                    <Text key={kode} accessibilityLabel={`${LABEL_AKSI[kode]?.label} tidak tersedia: ${d.aksi[kode]?.alasan}`} maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, lineHeight: 17, marginTop: 2 }}>
                      {LABEL_AKSI[kode]?.label}: {d.aksi[kode]?.alasan}
                    </Text>
                  ))}
                </GlassCard>
              ) : null}
            </View>
          ) : null}

          <Sheet visible={sheet === "ajukan"} onClose={() => { if (!sibuk) setSheet(null); }} judul="Ajukan untuk persetujuan?" sub="Dokumen akan masuk ke Persetujuan dan tidak bisa diubah pembuatnya lagi. Anda mungkin diminta PIN atau biometrik.">
            <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
              <Button label={S.umum.batal} variant="ghost" disabled={sibuk} onPress={() => setSheet(null)} style={{ flex: 1 }} />
              <Button label="Ajukan" loading={sibuk} disabled={sibuk} onPress={() => { void kirim("ajukan", {}, "ajukan"); }} style={{ flex: 1 }} />
            </View>
          </Sheet>

          <BayarSheet
            visible={sheet === "bayar" || sheet === "potongGaji"}
            judul={sheet === "potongGaji" ? "Potong dari gaji" : d.modul === "tagihan" ? "Bayar tagihan" : "Bayar"}
            sub={sheet === "potongGaji" ? "Pemotongan gaji tidak menyentuh kas. Nominal tidak boleh melebihi sisa kasbon." : d.modul === "tagihan" ? "Bayar sebagian atau seluruh sisa utang. Nominal tidak boleh melebihi sisa." : "Pilih rekening sumber pembayaran."}
            tombol={sheet === "potongGaji" ? "Catat pemotongan" : "Bayar sekarang"} perlu={d.aksi[sheet === "potongGaji" ? "potongGaji" : "bayar"]?.perlu ?? []}
            opsi={opsi.data} opsiMemuat={opsi.isLoading} opsiGalat={opsi.isError} onCobaOpsi={() => void opsi.refetch()} sisa={d.sisa} sibuk={sibuk}
            onTutup={() => setSheet(null)} onKirim={(i) => { void kirim(sheet === "potongGaji" ? "potongGaji" : "bayar", i, sheet); }}
          />

          <AlasanSheet
            visible={sheet === "batalkan"} sibuk={sibuk} nomor={d.nomor} alasan={alasan} onUbah={setAlasan} onTutup={() => setSheet(null)}
            judul={`Batalkan ${k.tunggal}`} sub={`Tulis alasan pembatalan ${d.nomor}. Jurnal dibalik dan alasan tercatat di riwayat.`} tombol="Batalkan" placeholder="Contoh: salah nominal, dicatat dobel"
            onKirim={() => { void kirim("batalkan", { alasan }, "batalkan"); }}
          />

          <Sheet visible={sheet === "lampiran"} onClose={() => { if (!sibuk && !fotoSibuk) setSheet(null); }} judul="Lampirkan nota" sub="Foto nota diunggah dulu, lalu dipasang ke dokumen ini.">
            <LampiranField onUrl={setFoto} onSibuk={setFotoSibuk} />
            <Button label="Pasang ke dokumen" loading={sibuk} disabled={sibuk || fotoSibuk || !foto} onPress={() => { void kirim("lampiran", { receiptUrl: foto }, "lampiran"); }} />
          </Sheet>

          {sheet === "ubah" ? <UbahSheet visible d={d} sibuk={sibuk} onTutup={() => setSheet(null)} onKirim={(p, a) => { void kirim("ubah", { perubahan: p, alasan: a }, "ubah"); }} /> : null}

          {alokasiPilih ? (
            <AlokasiSheet
              key={alokasiPilih.id} visible={sheet === "alokasi"} pembayaran={alokasiPilih} order={d.orderPelanggan} sibuk={sibuk} onTutup={() => setSheet(null)}
              onKirim={(alo) => {
                const a: AksiTx = alokasiPilih.aksiAlokasi;
                setSheet(null);
                void aksi(`${d.kunci}:${alokasiPilih.id}`, "alokasi", a, { alokasi: alo }).then((h) => tampilkan(h, "Alokasi disimpan. Status bayar order dihitung ulang server.", () => setSheet("alokasi")));
              }}
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}
