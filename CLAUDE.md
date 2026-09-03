# p0-ts-sdk

## Conventions — enforced

All codebase conventions live in [code_rules.md](code_rules.md). Read it before writing or reviewing any code in this repo, and treat its rules as hard requirements:

- **When writing code**: follow the rules exactly. If a requested change would violate a rule, say so and propose the compliant alternative instead of implementing the violation.
- **When reviewing code**: flag any rule violation explicitly, citing the rule.
- **When touching existing code that violates a rule**: don't silently replicate the pattern — point it out, and migrate it if it's in scope for the change.

Before finishing: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm knip`.
