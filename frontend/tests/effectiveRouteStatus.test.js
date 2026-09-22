// Tes regresi label status "Diperbarui" di Route Planner (22 September
// 2026, audit UI/UX RouteCard.jsx) — lihat catatan panjang di
// src/features/armada/vehicleStatus.js untuk kenapa label ini murni
// turunan tampilan, bukan status database sungguhan.
import test from "node:test";
import assert from "node:assert/strict";

import { effectiveRouteStatus } from "../src/features/armada/vehicleStatus.js";

test("rute DRAFT tetap DRAFT", () => {
  assert.equal(effectiveRouteStatus({ status: "DRAFT" }), "DRAFT");
});

test("rute PUBLISHED tanpa edit sama sekali tetap PUBLISHED", () => {
  assert.equal(
    effectiveRouteStatus({ status: "PUBLISHED", publishedAt: "2026-09-20T08:00:00Z", lastEditedAt: null }),
    "PUBLISHED"
  );
});

test("rute PUBLISHED yang diedit SETELAH terbit jadi UPDATED", () => {
  assert.equal(
    effectiveRouteStatus({
      status: "PUBLISHED",
      publishedAt: "2026-09-20T08:00:00Z",
      lastEditedAt: "2026-09-20T09:00:00Z",
    }),
    "UPDATED"
  );
});

test("lastEditedAt SEBELUM publishedAt (jejak edit darurat dari sesi SEBELUM rute ini pernah diterbitkan ulang) TIDAK dianggap UPDATED", () => {
  assert.equal(
    effectiveRouteStatus({
      status: "PUBLISHED",
      publishedAt: "2026-09-20T08:00:00Z",
      lastEditedAt: "2026-09-19T09:00:00Z",
    }),
    "PUBLISHED"
  );
});

test("CANCELLED/COMPLETED/IN_PROGRESS tidak pernah jadi UPDATED walau ada lastEditedAt lebih baru", () => {
  for (const status of ["CANCELLED", "COMPLETED", "IN_PROGRESS"]) {
    assert.equal(
      effectiveRouteStatus({ status, publishedAt: "2026-09-20T08:00:00Z", lastEditedAt: "2026-09-21T08:00:00Z" }),
      status
    );
  }
});
