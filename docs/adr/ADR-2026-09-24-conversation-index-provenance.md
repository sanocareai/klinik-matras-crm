# ADR: Conversation index ownership and immutable migration provenance

- Status: accepted by owner on 24 September 2026
- Domain owner: Sales/Messenger
- Historical migration provenance: `20260924090000_uang_muka_operasional`

## Decision

`Conversation_customerId_channel_idx` is a Sales/Messenger performance index. Its schema declaration originated with the Conversation race-condition work, but the ordinary index was not included in that Sales/Messenger migration. It was later emitted by Prisma into `20260924090000_uang_muka_operasional` and has already been applied in production.

The Finance migration is therefore retained byte-for-byte as immutable historical provenance. We will not edit its content or checksum, create a replacement Sales migration, manually resolve Prisma history, re-baseline migrations, or drop/recreate the index.

Production-Delivery V2 migrations must not create, alter, or remove the index and must not target Sales/Messenger objects. A regression test protects both constraints and verifies that the complete ordered migration chain still contains exactly one index creation before the V2 foundation.

## Consequences

- Logical ownership remains Sales/Messenger even though historical migration provenance remains Finance.
- Future index changes require separate Sales/Messenger approval.
- The V2 foundation stays limited to Production and Delivery objects.
