import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTROL_TOWER_POLL_MS,
  controlTowerRefreshOptions,
  controlTowerRetryDelay,
} from "../src/features/armada/controlTowerRefresh.js";
import { canAccessControlTower } from "../src/features/armada/controlTowerRules.js";

test("Control Tower polling berada dalam batas 60-120 detik", () => {
  assert.equal(CONTROL_TOWER_POLL_MS, 90_000);
  assert.ok(CONTROL_TOWER_POLL_MS >= 60_000);
  assert.ok(CONTROL_TOWER_POLL_MS <= 120_000);
});

test("refresh aktif hanya ketika tab terlihat", () => {
  const visible = controlTowerRefreshOptions(true);
  assert.equal(visible.refetchOnMount, "always");
  assert.equal(visible.refetchOnWindowFocus, "always");
  assert.equal(visible.refetchInterval, 90_000);
  assert.equal(visible.refetchIntervalInBackground, false);

  const hidden = controlTowerRefreshOptions(false);
  assert.equal(hidden.refetchOnWindowFocus, false);
  assert.equal(hidden.refetchInterval, false);
});

test("retry memakai exponential backoff dengan batas 30 detik", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6].map(controlTowerRetryDelay),
    [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]
  );
  assert.equal(controlTowerRefreshOptions(true).retry, 3);
});

test("akses UI mengikuti capability job:read", () => {
  assert.equal(canAccessControlTower({ capabilities: ["job:read"] }), true);
  assert.equal(canAccessControlTower({ capabilities: ["job:own:read"] }), false);
  assert.equal(canAccessControlTower({ roles: ["DISPATCHER"] }), true);
  assert.equal(canAccessControlTower({ roles: ["DRIVER"] }), false);
});
