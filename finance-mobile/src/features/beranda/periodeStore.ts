import { create } from "zustand";
import { PERIODE_DEFAULT } from "@/lib/periode";

// Periode aktif Beranda (id, bukan tanggal — supaya "Bulan ini" ikut berganti bulan). Sengaja tidak disimpan:
// setiap sesi baru mulai dari bulan berjalan.
type State = { id: string; setId: (id: string) => void };
export const usePeriode = create<State>((set) => ({ id: PERIODE_DEFAULT, setId: (id) => set({ id }) }));
