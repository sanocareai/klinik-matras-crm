# VPS Production Storage Validation — 2026-09-25

Scope: post-upgrade storage audit and runtime verification. Read-only; no build, deploy, restart, migration, backup/restore, feature-flag update, Docker cleanup, or persistent-data mutation was performed.

## Storage evidence

```text
Block device: /dev/vda = 107374182400 bytes (100 GiB)
Root partition: /dev/vda2 = 107372068352 bytes, GPT Linux filesystem
Root filesystem: ext4, mounted at /
Filesystem blocks: 105557581824 bytes
Used: 57136386048 bytes
Available: 44002504704 bytes
Human-readable: 99G total, 54G used, 41G available, 57% used
```

`/dev/vda2` already spans the upgraded block device and ext4 already exposes the expanded capacity. No `growpart`, `resize2fs`, or reboot was required or executed.

## Runtime evidence

Verification timestamp: `2026-09-25T04:01Z`.

```text
klinik-matras-backend-1: running, restart=0, started=2026-09-25T03:57:17.223951691Z
klinik-matras-waha-1: running, restart=0, started=2026-09-25T03:57:17.241598487Z
klinik-matras-waha-test-1: running, restart=0, started=2026-09-25T03:57:17.240447133Z
klinik-matras-postgres-1: running, restart=0, started=2026-09-25T03:57:17.214353456Z
Local health: HTTP 200
Public health: HTTP 200
```

All four containers share the same post-upgrade start window. No restart was issued during this validation. The PostgreSQL restart counter was `67` in the pre-upgrade audit and is `0` after the host upgrade/start window; this reset predates this validation's first runtime measurement.

## Feature flags

Database-backed audit returned `allFlagsOff: true`:

```text
delivery_v1_writer_fence=false
delivery_v2_writer_execution=false
delivery_v2_writer_route=false
delivery_web_v2_reader=false
driver_v2_snapshot_reader=false
production_v1_writer_fence=false
production_v2_reader=false
production_v2_writer=false
```

## Pending Ops decision: Job 7d34e05d-b7f2-43cd-8842-31e13645492f

Read-only decision-pack evidence at `2026-09-25T04:01:56.356Z`:

```text
Job status: SCHEDULED
Scheduled date: 2026-09-27T00:00:00.000Z
V1 routeId/driverId/helperId/vehicleId: null
Order: RES-22092026-142, status PICKUP
arrivedAt: 2026-09-24T01:47:30.266Z
completedAt: null
failure reason present: yes
latest execution event: JOB_FAILED at 2026-09-24T02:04:25.248Z
issue count: 2
execution-event count: 3
reschedule count: 1
active V2 assignments: 1
active assignment ID: 3d84a289-7be1-4f02-a0d8-765f23a014db
publication ID: ef9de4d3-0d7e-4747-8d3c-10dd364d1b7d
```

Current evidence is consistent with a V1 reschedule whose old V2 assignment has not yet been revoked. No mutation was made. Required Ops confirmation remains: the 27 September reschedule is final. Only after that confirmation may the prepared atomic, idempotent command revoke the old assignment; otherwise the job remains decision-blocked.
