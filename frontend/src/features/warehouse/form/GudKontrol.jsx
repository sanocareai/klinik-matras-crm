import React, { useId, useMemo, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils.js";
import DatePicker from "@/components/ui/date-picker.jsx";
import DateTimePicker from "@/components/ui/date-time-picker.jsx";
import { IkBawah, IkCari, IkCentang } from "@/components/gudangIcons.jsx";

// KIT KONTROL FORMULIR GUDANG (redesain Gudang, 3 Nov 2026) — pengganti <select>, <input type="date">, dan kolom angka bawaan peramban di alur Penerimaan/Retur.
// Semua kontrol memakai: pemilih/kalender APLIKASI (Radix menu + DatePicker app), keyboard penuh, `aria-invalid` + pesan galat di bawah kolom, target sentuh 44px, dan gaya `.gud-f-*` (sanss-gudang.css).
// Kontrol TIDAK menyimpan keadaan bisnis: nilai dan validasi tetap milik formulir pemanggil (payload, aturan, dan pesan server tidak berubah).

/** Label + kontrol + petunjuk/galat. Galat menang atas petunjuk. `htmlFor` mengikat label ke kontrol. */
export function GudField({ label, htmlFor, wajib, hint, galat, children, className }) {
  return (
    <div className={cn("gud-f", className)} data-invalid={galat ? "ya" : undefined}>
      {label && <label htmlFor={htmlFor} className="gud-f-label">{label}{wajib && <span className="gud-f-wajib" aria-hidden="true"> *</span>}</label>}
      {children}
      {galat ? <p className="gud-f-galat" role="alert">{galat}</p> : hint ? <p className="gud-f-hint">{hint}</p> : null}
    </div>
  );
}

/** Ubah daftar <option> (gaya lama) menjadi [{ nilai, label, hint?, nonaktif? }] — supaya pemanggil lama cukup mengganti komponen, bukan menulis ulang isinya. */
export function opsiDariChildren(children) {
  const hasil = [];
  const jalan = (anak) => React.Children.forEach(anak, (c) => {
    if (!React.isValidElement(c)) return;
    if (c.type === React.Fragment) { jalan(c.props.children); return; }
    if (c.type === "option") hasil.push({ nilai: String(c.props.value ?? ""), label: React.Children.toArray(c.props.children).join(""), nonaktif: !!c.props.disabled });
  });
  jalan(children);
  return hasil;
}

/**
 * Pemilih dropdown aplikasi (menggantikan <select>). `children` boleh <option> (API lama) atau `opsi` array. Lebih dari `ambangCari` pilihan → kolom cari muncul di dalam daftar.
 * Keyboard: Enter/Spasi/↓ membuka, ↑/↓ memindah, Enter memilih, Esc menutup, huruf = lompat (tanpa kolom cari). `kosong` = teks bila nilai belum dipilih.
 */
export function PilihGud({ value, onChange, children, opsi, placeholder = "Pilih…", disabled = false, invalid = false, kosongNormal = false, ambangCari = 8, id, className, "aria-label": ariaLabel, "data-testid": testId, kosongLabel = "Tidak ada pilihan" }) {
  const daftar = useMemo(() => opsi ?? opsiDariChildren(children), [opsi, children]);
  const [buka, setBuka] = useState(false); const [cari, setCari] = useState("");
  const kolomCari = useRef(null); const pertama = useRef(null);
  const nilai = value == null ? "" : String(value);
  // kosongNormal: pilihan bernilai "" (mis. "Semua satuan") adalah pilihan SAH yang labelnya ditampilkan biasa (saringan); selain itu "" = belum memilih (teks petunjuk redup).
  const terpilih = daftar.find((o) => o.nilai === nilai && (o.nilai !== "" || kosongNormal)) ?? null;
  const bisaCari = daftar.length > ambangCari;
  const tampil = useMemo(() => { const k = cari.trim().toLowerCase(); return bisaCari && k ? daftar.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(k)) : daftar; }, [daftar, cari, bisaCari]);
  const wadah = typeof document !== "undefined" ? document.querySelector(".app-shell") ?? undefined : undefined;
  const ubahBuka = (b) => { setBuka(b); if (!b) setCari(""); };
  return (
    <DropdownMenu.Root open={buka} onOpenChange={ubahBuka}>
      <DropdownMenu.Trigger asChild>
        <button type="button" id={id} disabled={disabled} aria-label={ariaLabel} aria-invalid={invalid || undefined} data-testid={testId} data-kosong={terpilih ? undefined : "ya"} data-saring={kosongNormal ? "ya" : undefined}
          className={cn("gud-f-pilih", className)}>
          <span className="gud-f-pilih-teks">{terpilih ? terpilih.label : placeholder}</span>
          <IkBawah size={16} className="gud-f-pilih-panah" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={wadah}>
        <DropdownMenu.Content align="start" sideOffset={6} collisionPadding={12} className="gud-menu" data-testid={testId ? `${testId}-daftar` : undefined}
          onOpenAutoFocus={(e) => { if (bisaCari) { e.preventDefault(); setTimeout(() => kolomCari.current?.focus(), 0); } }} // daftar panjang: kursor langsung di kolom cari
          onCloseAutoFocus={(e) => { if (bisaCari) e.preventDefault(); }}>
          {bisaCari && (
            <div className="gud-menu-cari">
              <IkCari size={15} aria-hidden />
              <input ref={kolomCari} value={cari} autoFocus onChange={(e) => setCari(e.target.value)} placeholder="Cari…" aria-label="Cari pilihan"
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === "ArrowDown") { e.preventDefault(); pertama.current?.focus(); } if (e.key === "Escape") ubahBuka(false); }} />
            </div>
          )}
          <div className="gud-menu-isi">
            {tampil.length === 0 && <p className="gud-menu-kosong">{daftar.length === 0 ? kosongLabel : "Tidak ada yang cocok"}</p>}
            {tampil.map((o, i) => (
              <DropdownMenu.Item key={o.nilai || `kosong-${i}`} ref={i === 0 ? pertama : undefined} disabled={o.nonaktif} data-selected={o.nilai === nilai ? "ya" : undefined} data-testid={testId ? `${testId}-${o.nilai || "kosong"}` : undefined}
                className="gud-menu-item" onSelect={() => onChange?.(o.nilai)}>
                <span className="gud-menu-item-teks">{o.label}</span>
                {o.nilai === nilai && o.nilai !== "" && <IkCentang size={16} aria-hidden />}
              </DropdownMenu.Item>
            ))}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Kolom tanggal: pemilih tanggal APLIKASI ("2 Nov 2026", kalender WIB). `value` "YYYY-MM-DD" ("" = kosong); `onChange` menerima nilai langsung. `tanpaMasaDepan` untuk tanggal kejadian lampau (mis. barang tiba). */
export function TanggalGud({ value, onChange, min, tanpaMasaDepan = false, disabled, placeholder = "Pilih tanggal", clearLabel = "Kosongkan tanggal", invalid = false, id, "aria-label": ariaLabel, "data-testid": testId, className }) {
  return (
    <DatePicker block value={value || ""} onChange={onChange} minDate={min || undefined} allowFuture={!tanpaMasaDepan} disabled={disabled} placeholder={placeholder} clearLabel={clearLabel}
      className={className} lapisanTetap triggerClassName="gud-f-tanggal"
      triggerProps={{ ...(id ? { id } : {}), ...(testId ? { "data-testid": testId } : {}), ...(ariaLabel ? { "aria-label": ariaLabel } : {}), ...(invalid ? { "aria-invalid": true } : {}) }} />
  );
}

/** Kolom angka (jumlah): desimal, rata kanan, satuan di dalam kolom. Bukan type=number agar tidak berubah oleh roda tetikus/panah; validasi angka tetap di pemanggil. */
export function AngkaGud({ value, onChange, satuan, invalid = false, disabled = false, id, className, "aria-label": ariaLabel, "data-testid": testId, placeholder = "0", onBlur, inputRef, autoFocus }) {
  const auto = useId();
  return (
    <span className={cn("gud-f-angka", className)} data-invalid={invalid ? "ya" : undefined}>
      <input id={id ?? auto} type="text" inputMode="decimal" autoComplete="off" value={value ?? ""} disabled={disabled} placeholder={placeholder} aria-label={ariaLabel} aria-invalid={invalid || undefined} data-testid={testId} onBlur={onBlur} ref={inputRef} autoFocus={autoFocus}
        onChange={(e) => onChange?.(e.target.value.replace(",", "."))} />
      {satuan && <span className="gud-f-satuan" aria-hidden="true">{satuan}</span>}
    </span>
  );
}

/** Kolom tanggal + jam (24 jam, WIB) memakai pemilih APLIKASI (components/ui/date-time-picker.jsx). Nilai "YYYY-MM-DDTHH:mm" ("" = kosong), sama dengan kontrak input datetime-local lama. Aturan lampau/masa depan tetap di pemanggil. */
export function WaktuGud({ value, onChange, placeholder = "Pilih tanggal & jam", allowFuture = true, invalid = false, id, "data-testid": testId, className }) {
  return (
    <div className={cn("gud-f-waktu", className)} id={id} data-testid={testId} data-invalid={invalid ? "ya" : undefined}>
      <DateTimePicker value={value || ""} onChange={onChange} placeholder={placeholder} allowFuture={allowFuture} />
    </div>
  );
}
