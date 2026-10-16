import React from "react";
import { Card } from "@/components/ui/card.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import { Uang, formatUang, JudulKartu } from "@/features/finance/shared.jsx";

// "Uang Muka & Utang per Supplier" (tab Master Supplier). Angka dari server (GET /finance/purchase-orders/uang-muka/ringkasan-supplier) — layar tidak menghitung ulang.
// Saldo bersih = utang aktif − uang muka belum diterapkan (negatif = supplier masih berutang barang kepada kita).
export function TabelUangMukaSupplier({ data }) {
  const daftar = data?.suppliers || [];
  if (!data || daftar.length === 0) return null;
  const k = data.kartu;
  return (
    <Card className="overflow-hidden" data-testid="tabel-uang-muka-supplier">
      <JudulKartu
        title="Uang Muka & Utang per Supplier"
        description="Total uang muka yang dibayar, yang sudah terpakai, yang belum diterapkan, utang aktif (faktur disetujui), dan saldo bersih."
        info={(data.definisi || []).map((d) => `${d.label}: ${d.definisi}`).join("  ")}
      />
      <TableWrap className="hidden md:block">
        <Table>
          <THead><TR><TH>Supplier</TH><TH numeric>Total uang muka</TH><TH numeric>Uang muka terpakai</TH><TH numeric>Belum diterapkan</TH><TH numeric>Utang aktif</TH><TH numeric title="Utang aktif dikurangi uang muka belum diterapkan">Saldo bersih</TH></TR></THead>
          <TBody>
            {daftar.map((s) => (
              <TR key={s.supplierId}>
                <TD className="font-medium text-ink">{s.supplier}</TD>
                <TD numeric><Uang value={s.totalUangMuka} /></TD><TD numeric><Uang value={s.uangMukaTerpakai} /></TD>
                <TD numeric className={s.uangMukaBelumDiterapkan > 0 ? "font-semibold text-orange" : ""}><Uang value={s.uangMukaBelumDiterapkan} /></TD>
                <TD numeric><Uang value={s.utangAktif} /></TD>
                <TD numeric className={s.saldoBersih < 0 ? "font-semibold text-orange" : ""}><Uang value={s.saldoBersih} /></TD>
              </TR>
            ))}
            <TR>
              <TD className="font-semibold text-ink">Total</TD>
              <TD numeric className="font-semibold"><Uang value={k.totalUangMuka} /></TD><TD numeric className="font-semibold"><Uang value={k.uangMukaTerpakai} /></TD>
              <TD numeric className="font-semibold"><Uang value={k.uangMukaBelumDiterapkan} /></TD><TD numeric className="font-semibold"><Uang value={k.utangAktif} /></TD><TD numeric className="font-semibold"><Uang value={k.saldoBersih} /></TD>
            </TR>
          </TBody>
        </Table>
      </TableWrap>
      <ul className="m-0 list-none space-y-2 p-3 md:hidden">
        {daftar.map((s) => (
          <li key={s.supplierId} className="rounded-lg border border-line p-2.5 text-[12.5px]">
            <div className="font-medium text-ink">{s.supplier}</div>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
              <div><dt className="text-ink3">Total uang muka</dt><dd className="ml-0 tabular-nums">{formatUang(s.totalUangMuka)}</dd></div>
              <div><dt className="text-ink3">Terpakai</dt><dd className="ml-0 tabular-nums">{formatUang(s.uangMukaTerpakai)}</dd></div>
              <div><dt className="text-ink3">Belum diterapkan</dt><dd className={cn("ml-0 tabular-nums", s.uangMukaBelumDiterapkan > 0 && "font-semibold text-orange")}>{formatUang(s.uangMukaBelumDiterapkan)}</dd></div>
              <div><dt className="text-ink3">Utang aktif</dt><dd className="ml-0 tabular-nums">{formatUang(s.utangAktif)}</dd></div>
              <div className="col-span-2"><dt className="text-ink3">Saldo bersih</dt><dd className={cn("ml-0 tabular-nums", s.saldoBersih < 0 && "font-semibold text-orange")}>{formatUang(s.saldoBersih)}</dd></div>
            </dl>
          </li>
        ))}
      </ul>
    </Card>
  );
}
