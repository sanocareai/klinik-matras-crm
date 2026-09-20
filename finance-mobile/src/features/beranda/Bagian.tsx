import React from "react";
import { Text, View } from "react-native";
import {
  BadgeCheck, Banknote, ChevronRight, CircleCheck, Landmark, ShieldAlert, ShieldCheck, TriangleAlert, Wallet, type LucideIcon,
} from "lucide-react-native";
import { GlassCard } from "@/design/GlassCard";
import { WARNA_EMBER as warnaEmber } from "@/design/charts";
import { MoneyText } from "@/design/MoneyText";
import { TeksSensitif, useSamarkan } from "@/design/Samarkan";
import { IconCircle, PressableScale } from "@/design/ui";
import { font } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { haptic } from "@/design/haptics";
import { formatRupiah, isNegative, isZero, rasio, type Money } from "@/lib/money";
import { tanggalPendek } from "@/lib/dates";
import { has } from "@/auth/capabilities";
import type { AntreanRingkas, BagianDashboard, Capabilities, CashAccountKind, DashboardData, Ember, KasBankItem } from "@/api/types";
import { formatPersen } from "./format";

// BAGIAN-BAGIAN BERANDA. Semua angka uang datang dari server apa adanya; tidak ada penjumlahan di sini.
// Tiap bagian yang datanya tidak ada di respons menampilkan "belum tersedia" (data parsial), bukan angka nol palsu.

const IKON_REKENING: Record<CashAccountKind, LucideIcon> = { BANK: Landmark, KAS: Banknote, EWALLET: Wallet };
const LABEL_JENIS: Record<CashAccountKind, string> = { BANK: "Rekening bank", KAS: "Kas tunai", EWALLET: "Dompet digital" };

/** Satu baris "label ........ nominal" yang tidak pernah meluap: label boleh 2 baris, nominal mengecil bila panjang. */
export function BarisNilai({
  label, sub, nilai, autoNegatif = true, tebal = false, ikon, tone,
}: { label: string; sub?: string; nilai: Money; autoNegatif?: boolean; tebal?: boolean; ikon?: LucideIcon; tone?: "info" | "success" | "warning" | "danger" }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }} accessible accessibilityLabel={`${label}: ${formatRupiah(nilai)}`}>
      {ikon ? <IconCircle icon={ikon} tone={tone ?? "info"} size={38} /> : null}
      <View style={{ flex: 1 }}>
        <Text maxFontSizeMultiplier={1.4} numberOfLines={2} style={{ color: tebal ? colors.text : colors.textMuted, fontFamily: tebal ? font.semibold : font.regular, fontSize: 14, lineHeight: 19 }}>{label}</Text>
        {sub ? <Text maxFontSizeMultiplier={1.4} numberOfLines={2} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 1 }}>{sub}</Text> : null}
      </View>
      <View style={{ flexShrink: 0, maxWidth: "52%", alignItems: "flex-end" }}>
        <MoneyText value={nilai} size="md" autoNegatif={autoNegatif} />
      </View>
    </View>
  );
}

const Garis = () => {
  const { colors } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.hairline }} />;
};

// ─── Hero ──────────────────────────────────────────────────────────────────────────────────
export function HeroKas({ totalKas, jumlahRekening }: { totalKas: Money | null; jumlahRekening: number }) {
  const { colors } = useTheme();
  return (
    <GlassCard variant="hero" padding={20}>
      <View accessible accessibilityLabel={totalKas ? `Total kas dan bank: ${formatRupiah(totalKas)}` : "Total kas dan bank belum tersedia"}>
        <Text maxFontSizeMultiplier={1.4} style={{ color: colors.heroTextMuted, fontFamily: font.medium, fontSize: 13 }}>Total kas & bank</Text>
        <View style={{ marginTop: 6 }}>
          {totalKas ? <MoneyText value={totalKas} size="hero" color={colors.heroText} redupkanPecahan /> : (
            <Text style={{ color: colors.heroText, fontFamily: font.semibold, fontSize: 22 }}>Belum tersedia</Text>
          )}
        </View>
        <Text maxFontSizeMultiplier={1.4} style={{ color: colors.heroTextMuted, fontFamily: font.regular, fontSize: 12, marginTop: 10 }}>
          {jumlahRekening} rekening · posisi saat ini
        </Text>
      </View>
    </GlassCard>
  );
}

// ─── Saldo per rekening ────────────────────────────────────────────────────────────────────
export function DaftarRekening({ rekening }: { rekening: KasBankItem[] }) {
  const { colors } = useTheme();
  if (rekening.length === 0) {
    return (
      <GlassCard>
        <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 14, lineHeight: 20 }}>Belum ada rekening kas atau bank yang terdaftar di pembukuan.</Text>
      </GlassCard>
    );
  }
  return (
    <GlassCard padding={4}>
      <View style={{ paddingHorizontal: 12 }}>
        {rekening.map((k, i) => (
          <View key={k.id}>
            {i > 0 ? <Garis /> : null}
            <BarisNilai label={k.name} sub={k.bankName && !k.name.toLowerCase().includes(k.bankName.toLowerCase()) ? `${k.bankName} · ${LABEL_JENIS[k.kind]}` : LABEL_JENIS[k.kind]} nilai={k.saldo} ikon={IKON_REKENING[k.kind]} />
          </View>
        ))}
      </View>
    </GlassCard>
  );
}

// ─── Laba rugi periode ─────────────────────────────────────────────────────────────────────
export function KartuLabaRugi({ data }: { data: NonNullable<DashboardData["labaRugi"]> }) {
  const { colors } = useTheme();
  const margin = formatPersen(data.marginBersih);
  return (
    <GlassCard>
      <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontFamily: font.medium, fontSize: 13 }}>{isNegative(data.labaBersih) ? "Rugi bersih" : "Laba bersih"}</Text>
      <View style={{ marginTop: 4 }}>
        <MoneyText value={data.labaBersih} size="xl" autoNegatif />
      </View>
      {margin ? <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 4 }}>Margin bersih {margin}</Text> : null}
      <View style={{ marginTop: 10 }}>
        <Garis />
        <BarisNilai label="Pendapatan bersih" nilai={data.pendapatanBersih} autoNegatif={false} />
        <Garis />
        <BarisNilai label="Beban pokok" nilai={data.bebanPokok} autoNegatif={false} />
        <Garis />
        <BarisNilai label="Laba kotor" nilai={data.labaKotor} />
        <Garis />
        <BarisNilai label="Beban operasional" nilai={data.bebanOperasional} autoNegatif={false} />
      </View>
    </GlassCard>
  );
}

// ─── Piutang / utang usaha (umur) ──────────────────────────────────────────────────────────
export function KartuUmur({ judul, total, ember, kosongTeks, catatan }: { judul: string; total: Money; ember: Ember[]; kosongTeks: string; catatan?: string }) {
  const { colors } = useTheme();
  const kosong = isZero(total);
  return (
    <GlassCard>
      <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontFamily: font.medium, fontSize: 13 }}>{judul}</Text>
      <View style={{ marginTop: 4 }}><MoneyText value={total} size="xl" /></View>
      {kosong ? (
        <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, marginTop: 8 }}>{kosongTeks}</Text>
      ) : (
        <View style={{ marginTop: 12, gap: 10 }}>
          {ember.map((e, i) => {
            const isi = rasio(e.total, total);
            const warna = warnaEmber(colors)[i] ?? colors.info;
            return (
              <View key={e.label} accessible accessibilityLabel={`${e.label}: ${formatRupiah(e.total)}`}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, flex: 1 }}>{e.label}</Text>
                  <View style={{ flexShrink: 0, maxWidth: "55%", alignItems: "flex-end" }}><MoneyText value={e.total} size="sm" /></View>
                </View>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.neutralSoft, marginTop: 5, overflow: "hidden" }}>
                  <View style={{ width: `${Math.round(isi * 100)}%`, height: 6, borderRadius: 3, backgroundColor: warna }} />
                </View>
              </View>
            );
          })}
        </View>
      )}
      {catatan ? <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 10 }}>{catatan}</Text> : null}
    </GlassCard>
  );
}

// ─── Pekerjaan tertunda ────────────────────────────────────────────────────────────────────
type Tindakan = { id: string; ikon: LucideIcon; tone: "warning" | "info" | "danger"; judul: string; ringkas: string; jumlah: number; tujuan: string };

/** Daftar pekerjaan tertunda yang boleh dilihat peran ini (berdasarkan capabilities, bukan nama role). */
export function daftarTindakan(antrean: AntreanRingkas | null, gap: number, caps: Capabilities | null): Tindakan[] {
  const hasil: Tindakan[] = [];
  if (antrean && has(caps, "financeApprove")) {
    const bagian = [
      antrean.pengeluaranMenunggu > 0 ? `${antrean.pengeluaranMenunggu} pengeluaran` : null,
      antrean.pembelianMenunggu > 0 ? `${antrean.pembelianMenunggu} pembelian` : null,
      antrean.tagihanMenunggu > 0 ? `${antrean.tagihanMenunggu} tagihan` : null,
      antrean.refundMenunggu > 0 ? `${antrean.refundMenunggu} refund` : null,
    ].filter((x): x is string => x != null);
    const jumlah = antrean.pengeluaranMenunggu + antrean.pembelianMenunggu + antrean.tagihanMenunggu + antrean.refundMenunggu;
    if (jumlah > 0) hasil.push({ id: "persetujuan", ikon: CircleCheck, tone: "warning", judul: "Menunggu persetujuan", ringkas: bagian.join(" · "), jumlah, tujuan: "/persetujuan" });
  }
  if (antrean && has(caps, "paymentRead")) {
    if (antrean.jumlahPembayaranBelumVerifikasi > 0) {
      hasil.push({ id: "verifikasi", ikon: BadgeCheck, tone: "info", judul: "Pembayaran belum diverifikasi", ringkas: "Bukti pembayaran pelanggan menunggu dicek", jumlah: antrean.jumlahPembayaranBelumVerifikasi, tujuan: "/transaksi" });
    }
    const l = antrean.lunasBelumDicatat;
    if (l.jumlah > 0) {
      const rinci = l.baru && l.lama ? `${l.baru.jumlah} baru · ${l.lama.jumlah} lama · ` : "";
      hasil.push({ id: "lunas", ikon: Banknote, tone: "info", judul: "Order lunas belum tercatat", ringkas: `${rinci}${formatRupiah(l.total)}`, jumlah: l.jumlah, tujuan: "/transaksi" });
    }
  }
  if (gap > 0) hasil.push({ id: "gap", ikon: TriangleAlert, tone: "danger", judul: "Data belum lengkap", ringkas: "Transaksi yang belum bisa dibukukan", jumlah: gap, tujuan: "/lainnya" });
  return hasil;
}

export function PekerjaanTertunda({ daftar, onBuka }: { daftar: Tindakan[]; onBuka: (tujuan: string) => void }) {
  const { colors } = useTheme();
  if (daftar.length === 0) {
    return (
      <GlassCard>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <IconCircle icon={CircleCheck} tone="success" size={38} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontFamily: font.semibold, fontSize: 14 }}>Tidak ada pekerjaan tertunda</Text>
            <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 2 }}>Semua sudah beres untuk saat ini.</Text>
          </View>
        </View>
      </GlassCard>
    );
  }
  return (
    <GlassCard padding={4}>
      {daftar.map((t, i) => (
        <View key={t.id}>
          {i > 0 ? <View style={{ height: 1, backgroundColor: colors.hairline, marginHorizontal: 12 }} /> : null}
          <PressableScale
            onPress={() => { haptic.tick(); onBuka(t.tujuan); }}
            accessibilityLabel={`${t.judul}: ${t.jumlah}. ${t.ringkas}`}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, minHeight: 56 }}
          >
            <IconCircle icon={t.ikon} tone={t.tone} size={38} />
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} numberOfLines={2} style={{ color: colors.text, fontFamily: font.medium, fontSize: 14, lineHeight: 19 }}>{t.judul}</Text>
              <Text maxFontSizeMultiplier={1.4} numberOfLines={2} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 1 }}>{t.ringkas}</Text>
            </View>
            <Text style={{ color: colors.text, fontFamily: font.semibold, fontSize: 18 }} maxFontSizeMultiplier={1.3}>{t.jumlah}</Text>
            <ChevronRight size={18} color={colors.textMuted} strokeWidth={1.75} />
          </PressableScale>
        </View>
      ))}
    </GlassCard>
  );
}

// ─── Kesehatan pembukuan ───────────────────────────────────────────────────────────────────
function Baris({ label, nilai, buruk }: { label: string; nilai: string; buruk?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, paddingVertical: 6 }} accessible accessibilityLabel={`${label}: ${nilai}`}>
      <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, flex: 1 }}>{label}</Text>
      <Text maxFontSizeMultiplier={1.4} style={{ color: buruk ? colors.danger : colors.text, fontFamily: font.medium, fontSize: 13, flexShrink: 1, textAlign: "right" }}>{nilai}</Text>
    </View>
  );
}

export function KesehatanPembukuan({ catatan, gate }: { catatan: NonNullable<DashboardData["catatan"]>; gate: DashboardData["gate"] }) {
  const { colors } = useTheme();
  const sehat = catatan.gapTerbuka === 0 && catatan.saldoAwalTerisi;
  return (
    <GlassCard>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }} accessible accessibilityLabel={`Kesehatan pembukuan: ${sehat ? "baik" : "perlu perhatian"}`}>
        <IconCircle icon={sehat ? ShieldCheck : ShieldAlert} tone={sehat ? "success" : "warning"} size={40} />
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 15 }}>{sehat ? "Pembukuan baik" : "Perlu perhatian"}</Text>
          <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 1 }}>
            {sehat ? "Tidak ada data yang tertinggal." : "Ada yang perlu dilengkapi agar angka laporan akurat."}
          </Text>
        </View>
      </View>
      <View style={{ marginTop: 10 }}>
        <Baris label="Saldo awal" nilai={catatan.saldoAwalTerisi ? "Sudah diisi" : "Belum diisi"} buruk={!catatan.saldoAwalTerisi} />
        <Baris label="Data belum lengkap" nilai={catatan.gapTerbuka === 0 ? "Tidak ada" : `${catatan.gapTerbuka} transaksi`} buruk={catatan.gapTerbuka > 0} />
        {catatan.periodeTerbuka != null ? <Baris label="Periode akuntansi terbuka" nilai={`${catatan.periodeTerbuka} periode`} /> : null}
        {catatan.mulaiPembukuan ? <Baris label="Pembukuan dimulai" nilai={tanggalPendek(catatan.mulaiPembukuan)} /> : null}
        {gate ? <Baris label="Verifikasi pembayaran" nilai={gate.aktif ? "Wajib sebelum berstatus lunas" : "Belum diwajibkan"} /> : null}
      </View>
      {catatan.pesan.length > 0 ? (
        <View style={{ marginTop: 8, gap: 6 }}>
          {catatan.pesan.map((p) => (
            <Text key={p} maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, lineHeight: 17 }}>• {p}</Text>
          ))}
        </View>
      ) : null}
    </GlassCard>
  );
}

// ─── Jurnal terakhir ───────────────────────────────────────────────────────────────────────
export function JurnalTerakhir({ daftar }: { daftar: DashboardData["jurnalTerakhir"] }) {
  const { colors } = useTheme();
  const samar = useSamarkan();
  if (daftar.length === 0) {
    return (
      <GlassCard>
        <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 14, lineHeight: 20 }}>Belum ada jurnal yang terbukukan.</Text>
      </GlassCard>
    );
  }
  return (
    <GlassCard padding={4}>
      {daftar.map((j, i) => (
        <View
          key={j.id}
          accessible
          accessibilityLabel={`${samar ? "Disamarkan" : j.description}, ${j.entryNumber}, ${tanggalPendek(j.date)}, ${samar ? "nominal disembunyikan" : formatRupiah(j.total)}`}
          style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}
        >
          <View style={{ flex: 1 }}>
            <TeksSensitif maxFontSizeMultiplier={1.4} numberOfLines={2} style={{ color: colors.text, fontFamily: font.medium, fontSize: 14, lineHeight: 19 }}>{j.description}</TeksSensitif>
            <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 2 }}>{j.entryNumber} · {tanggalPendek(j.date)}</Text>
          </View>
          <View style={{ flexShrink: 0, maxWidth: "42%", alignItems: "flex-end" }}><MoneyText value={j.total} size="md" /></View>
        </View>
      ))}
    </GlassCard>
  );
}

// ─── Bagian tidak tersedia (data parsial) ──────────────────────────────────────────────────
const NAMA_BAGIAN: Record<BagianDashboard, string> = {
  kasBank: "saldo rekening", labaRugi: "laba rugi", piutang: "piutang", utang: "utang usaha", antrean: "pekerjaan tertunda", jurnal: "jurnal terakhir", catatan: "kesehatan pembukuan",
};

export function BagianBelumTersedia({ bagian, onCoba }: { bagian: BagianDashboard; onCoba?: () => void }) {
  const { colors } = useTheme();
  return (
    <GlassCard variant="flat">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }} accessibilityRole="alert">
        <IconCircle icon={TriangleAlert} tone="warning" size={36} />
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: colors.text, fontFamily: font.medium, fontSize: 14 }}>Data {NAMA_BAGIAN[bagian]} belum tersedia</Text>
          <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 1 }}>Server belum mengirim bagian ini. Angka lain di halaman ini tetap benar.</Text>
        </View>
        {onCoba ? (
          <PressableScale onPress={onCoba} accessibilityLabel={`Muat ulang ${NAMA_BAGIAN[bagian]}`} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 6 }}>
            <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 13 }}>Coba lagi</Text>
          </PressableScale>
        ) : null}
      </View>
    </GlassCard>
  );
}
