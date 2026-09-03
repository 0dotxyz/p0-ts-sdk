# Code Rules

Conventions for this codebase. Decisive by design — PRs that violate a rule get rejected or need an explicit, documented exception.

---

## 1. Writing new code

### The rule: match the hand-written files, not the LLM default

[`services/price/utils/compute.utils.ts`](src/services/price/utils/compute.utils.ts) and [`services/bank/bank.service.ts`](src/services/bank/bank.service.ts) are the reference for density and structure: plain exported functions, no comments unless something is non-obvious, logic inline, helpers only where they're shared. New code should be indistinguishable from them.

- **A comment carries a non-obvious _why_, or it doesn't exist.** No narrating the next line, no reviewer-speak ("so the caller doesn't re-fetch"), no change history or chat context. If it takes a paragraph to justify the code, fix the code.
- **JSDoc on exported symbols only.** The public API is the product: every export from an entry point (`src/index.ts`, `src/vendor/index.ts`, `src/vendor/jupiter/index.ts`, `src/instructions.ts`) gets a doc block stating what it does, its units, and what it throws. Nothing internal gets one.
- **Keep the exported surface small.** No new export unless a consumer outside the file needs it now; helpers stay unexported. Don't re-export from `src/index.ts` "for convenience" — the app imports what it uses.
- **Inline until the second real use.** No helper, type alias, or wrapper for single-use logic — five duplicated lines beat a new abstraction. A helper whose body is one expression is inlined.
- **One feature, one file.** Split only when a piece is reused elsewhere or the file has genuinely become hard to read. No `index.ts` barrels below a package entry point; no `utils/` + `types/` scaffolding for a single feature.
- **Search before writing.** `src/utils`, `services/*/utils` and the vendor decoders usually already have it (BN/BigNumber/I80F48 conversion, PDA derivation, account decoding, unit conversion). Reimplementing an existing helper is the most common LLM defect in this repo.
- **Handle only states that can occur.** No guard stacks for what the types already exclude; if a `!` is needed after the guards, the guards are wrong. Throw a typed error from `src/errors`, don't return `undefined` and let the caller guess.
- **Smallest diff that does the job.** No options, generics, fallbacks or "flexibility" that wasn't asked for; no drive-by refactors. Every changed line traces to the request. If a request seems to require breaking one of these, say so and propose the simpler version instead of implementing it.
- **Before opening a PR:** run `/simplify`, then read the whole diff.

### What this bans, concretely

- `/** … */` blocks on non-exported functions; comments explaining why the change is correct
- Wrapper functions or type aliases with a single call site
- New exports that only their own file uses; `export *` barrels added below an entry point
- Nested ternaries; multi-condition booleans followed by a non-null assertion
- `any`, `as unknown as`, or `!` to get past a type instead of fixing the type
- Adding a dependency the SDK doesn't strictly need (bundle size is the app's problem too)

---

<!-- Add new convention sections below. Keep each section decisive: a rule, its rationale in one or two lines, and what it concretely bans. -->
