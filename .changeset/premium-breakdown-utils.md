---
"@0dotxyz/p0-ts-sdk": patch
---

Add premium breakdown utilities: `premium-compute.utils` now exposes per-bank VBP breakdowns (surfaced via a new helper on `MarginfiAccountWrapper`) so callers can attribute the variable borrow premium component to its underlying inputs. Includes group-decode fixes and expanded tests.
