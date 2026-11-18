# DEC-09 Toggle semantics

- Status: Proposed default (awaiting owner confirmation)
- Owner/date: Project owner, 2026-11-18
- SRS: DEC-09, ADD-006, ADD-007, 7.1

## Context
Precedence and prerequisite logic must be deterministic.

## Decision
Order: kill-switch, instance lock, instance override, owner choice (if in plan), plan default, pack default, catalog default; then prerequisites. Forced-on and forced-off are distinct. Prerequisites are explicit AND/OR groups in data. Unknown IDs fail closed.

## Consequences
Toggle catalogue is data with a test per entry.
