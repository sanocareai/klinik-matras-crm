import { ruteDariNotifikasi } from "@/lib/tautan";

test("tautan notifikasi: hanya layar terdaftar dengan UUID sah", () => {
  const id = "0b9f2a3c-1d2e-4f50-8a6b-7c8d9e0f1a2b";
  expect(ruteDariNotifikasi({ path: `/unit/${id}` })).toBe(`/unit/${id}`);
  expect(ruteDariNotifikasi({ path: `/qc/${id}` })).toBe(`/qc/${id}`);
  expect(ruteDariNotifikasi({ path: "/kerja" })).toBe("/kerja");
  expect(ruteDariNotifikasi({ path: "/target" })).toBe("/target"); // push Komplain dengan banyak unit
  expect(ruteDariNotifikasi({ path: "/unit/../login" })).toBeNull();
  expect(ruteDariNotifikasi({ path: "https://contoh.com" })).toBeNull();
  expect(ruteDariNotifikasi({ path: `/persetujuan/expense/${id}` })).toBeNull();
  expect(ruteDariNotifikasi(null)).toBeNull();
  expect(ruteDariNotifikasi({ path: 42 })).toBeNull();
});
