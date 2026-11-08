// Pemeriksaan skema rehearsal (scripts/lib/skema-hash.sh): hanya unsur nonsemantik yang diabaikan; dump kosong wajib gagal.
import test from "node:test"; import assert from "node:assert/strict"; import { spawnSync } from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const LIB = path.resolve(import.meta.dirname, "../../scripts/lib/skema-hash.sh").replace(/\\/g, "/");
const BASH = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const DASAR = `-- dump
\\restrict AbC123
CREATE TABLE public.a (
    id integer NOT NULL,
    nama character varying(20) DEFAULT 'x'::character varying,
    harga numeric(10,2),
    CONSTRAINT a_chk CHECK (((nama)::text = ANY ((ARRAY['A'::character varying, 'B'::character varying])::text[]))),
    CONSTRAINT a_log CHECK (((harga > (0)::numeric) OR ((id > 1) AND (id < 9))))
);
CREATE TABLE public.b (
    id integer NOT NULL,
    a_id integer
);
ALTER TABLE ONLY public.a
    ADD CONSTRAINT a_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.b
    ADD CONSTRAINT b_fk FOREIGN KEY (a_id) REFERENCES public.a(id) ON DELETE RESTRICT;
CREATE INDEX a_nama_idx ON public.a USING btree (nama);
\\unrestrict AbC123
`;
function jalan(fn, ...isi) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "skema-")); const f = isi.map((x, i) => { const p = path.join(d, `f${i}`); fs.writeFileSync(p, x); return p.replace(/\\/g, "/"); });
  const r = spawnSync(BASH, ["-c", `export SKEMA_MIN_BARIS=5; source <(tr -d '\\r' < "${LIB}"); ${fn} ${f.map((x) => `"${x}"`).join(" ")}`], { encoding: "utf8" }); fs.rmSync(d, { recursive: true }); return { rc: r.status, keluar: r.stdout + r.stderr };
}
const beda = (a, b) => DASAR.replace(a, b);
test("render ulang CHECK, token restrict, komentar: tetap cocok", () => {
  const ulang = beda("((nama)::text = ANY ((ARRAY['A'::character varying, 'B'::character varying])::text[]))", "((nama)::text = ANY (ARRAY[('A'::character varying)::text, ('B'::character varying)::text]))").replaceAll("AbC123", "ZzZ999").replace("-- dump", "-- lain");
  const h = jalan("skema_banding", DASAR, ulang); assert.equal(h.rc, 0, h.keluar); assert.match(h.keluar, /SKEMA_COCOK/);
});
for (const [nama, a, b] of [
  ["kolom hilang", "    harga numeric(10,2),\n", ""],
  ["kolom pindah tabel", "    a_id integer\n", "    a_id integer,\n    harga numeric(10,2)\n"],
  ["tipe", "character varying(20) DEFAULT", "character varying(30) DEFAULT"],
  ["presisi", "numeric(10,2)", "numeric(12,2)"],
  ["default", "DEFAULT 'x'", "DEFAULT 'y'"],
  ["nilai CHECK", "'B'::character varying", "'C'::character varying"],
  ["logika CHECK", "((harga > (0)::numeric) OR ((id > 1) AND (id < 9)))", "(((harga > (0)::numeric) OR (id > 1)) AND (id < 9))"],
  ["cast non-teks CHECK", "(0)::numeric", "(0)::integer"],
  ["indeks", "USING btree (nama)", "USING hash (nama)"],
  ["FK aksi", "ON DELETE RESTRICT", "ON DELETE CASCADE"],
  ["FK target", "public.a(id) ON", "public.b(id) ON"],
]) test(`perbedaan terdeteksi: ${nama}`, () => { const v = beda(a, b); assert.notEqual(v, DASAR); const h = jalan("skema_banding", DASAR, v); assert.notEqual(h.rc, 0, h.keluar); assert.match(h.keluar, /SKEMA_GAGAL/); });
test("dump kosong atau pendek wajib gagal, termasuk dua sisi kosong", () => {
  for (const [x, y] of [["", ""], [DASAR, ""], ["", DASAR], ["-- komentar saja\n", "-- komentar saja\n"], ["x\n", "x\n"]]) { const h = jalan("skema_banding", x, y); assert.notEqual(h.rc, 0, h.keluar); assert.match(h.keluar, /kosong atau terlalu pendek/); }
  assert.notEqual(jalan("skema_tambahan", "", "", "").rc, 0);
});
const MIG = `ALTER TABLE "a" ADD COLUMN "t" VARCHAR(24);\nCREATE TABLE "c" (\n "id" INT\n);\nCREATE INDEX "c_idx" ON "c"("id");\nALTER TABLE "c" ADD CONSTRAINT "c_pkey" PRIMARY KEY ("id");\n`;
const BARU = `CREATE TABLE public.c (\n    id integer NOT NULL\n);\nCREATE INDEX c_idx ON public.c USING btree (id);\nALTER TABLE ONLY public.c\n    ADD CONSTRAINT c_pkey PRIMARY KEY (id);\n`;
const SESUDAH = DASAR.replace("    CONSTRAINT a_chk", "    t character varying(24),\n    CONSTRAINT a_chk").replace("\\unrestrict", `${BARU}\\unrestrict`);
test("tambahan persis migrasi lulus", () => { const h = jalan("skema_tambahan", DASAR, SESUDAH, MIG); assert.equal(h.rc, 0, h.keluar); assert.match(h.keluar, /tabel=1 indeks=1 kolom=1 constraint=1/); });
for (const [nama, v, re] of [
  ["skema lama berubah", SESUDAH.replace("numeric(10,2)", "numeric(12,2)"), /skema lama berubah/],
  ["tabel tak dideklarasikan", SESUDAH.replace("\\unrestrict", "CREATE TABLE public.z (\n    id integer\n);\n\\unrestrict"), /tabel tambahan/],
  ["indeks tak dideklarasikan", SESUDAH.replace("\\unrestrict", "CREATE INDEX z_idx ON public.a USING btree (id);\n\\unrestrict"), /indeks tambahan/],
  ["kolom tak dideklarasikan", SESUDAH.replace("    t character", "    u integer,\n    t character"), /kolom tambahan/],
  ["constraint pada tabel lama", SESUDAH.replace("\\unrestrict", "ALTER TABLE ONLY public.b\n    ADD CONSTRAINT b_u UNIQUE (id);\n\\unrestrict"), /tabel lama/],
  ["tabel migrasi tidak tercipta", DASAR.replace("    CONSTRAINT a_chk", "    t character varying(24),\n    CONSTRAINT a_chk"), /tabel tambahan/],
]) test(`tambahan ditolak: ${nama}`, () => { const h = jalan("skema_tambahan", DASAR, v, MIG); assert.notEqual(h.rc, 0, h.keluar); assert.match(h.keluar, re); });
