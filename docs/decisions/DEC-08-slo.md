# DEC-08 SLO, RPO and RTO

- Status: Proposed default (awaiting owner confirmation)
- Owner/date: Project owner, 2026-11-18
- SRS: DEC-08, ADD-053, ADD-055, NFR-04

## Context
Daily backups imply up to 24h data loss.

## Decision
99.5% storefront uptime; RPO 24h until point-in-time recovery is enabled; RTO 60 minutes per tenant restore.

## Consequences
Revisit once real orders flow.
