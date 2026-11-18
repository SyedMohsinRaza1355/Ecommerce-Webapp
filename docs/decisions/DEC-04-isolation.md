# DEC-04 Atlas isolation topology

- Status: Proposed default (awaiting owner confirmation)
- Owner/date: Project owner, 2026-11-18
- SRS: DEC-04, ADD-004, 8.4, 10.2

## Context
One DB per tenant is required. Per-tenant Atlas users may not scale and cannot be proven on a free cluster.

## Decision
Database per tenant named tenant_{instanceId}; one global MongoClient; single app credential; mandatory TenantContext in every repository call; cross-tenant tests on every endpoint. Per-tenant users deferred until a load test on a paid cluster.

## Consequences
Isolation relies on code and tests, so the test suite is a release blocker.
