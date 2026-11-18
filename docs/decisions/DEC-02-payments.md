# DEC-02 Payment providers and reconciliation

- Status: Proposed default (awaiting owner confirmation)
- Owner/date: Project owner, 2026-11-18
- SRS: DEC-02, ADD-020, ADD-027, NFR-03

## Context
Card data must never reach our servers.

## Decision
Pluggable gateway port. Phase 4 ships a mock gateway with signed webhooks; Stripe plus one regional adapter come later. Payment and order states are separate; webhooks are the proof of payment.

## Consequences
Real gateway needs an approved account and PCI SAQ-A review.
