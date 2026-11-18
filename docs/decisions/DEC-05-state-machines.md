# DEC-05 Order and payment state machines

- Status: Proposed default (awaiting owner confirmation)
- Owner/date: Project owner, 2026-11-18
- SRS: DEC-05, ADD-019, ADD-020

## Context
Order and payment state must be separate and auditable.

## Decision
Order: pending, confirmed, processing, partially_fulfilled, fulfilled, completed, cancelled. Payment: requires_payment, authorized, captured, partially_refunded, refunded, failed, disputed. Transitions are atomic, audited and reject stale changes.

## Consequences
Refund and cancel policy still needs owner input.
