# DEC-06 Inventory reservation

- Status: Proposed default (awaiting owner confirmation)
- Owner/date: Project owner, 2026-11-18
- SRS: DEC-06, ADD-005, F-126

## Context
Overselling must be impossible even if the cache fails.

## Decision
Database conditional decrement is authoritative and idempotent; reservations are advisory with a 10-minute TTL and are released on failure or expiry.

## Consequences
Cache outage degrades speed, not correctness.
