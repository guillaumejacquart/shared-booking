# Factory checks

Generated from `software-factory/`. Do not edit these files by hand.

- `npm run verify` runs the configured checks (`factory.json`) and the policy check.
- `npm run factory:check` runs only the policy check.
- `FACTORY_BASE_REF=<git-ref>` checks changes since a ref (CI sets it).
  Without it, the policy checks the working tree against `HEAD`.
- `npm run factory:baseline` sets `policy.baseline` to the current commit, for
  grandfathering an existing batch before enforcing the policy.
  Pass a ref to choose another commit: `npm run factory:baseline -- <ref>`.
- `FACTORY_SKIP_CHECKS=1` runs only the policy check.
- `FACTORY_SKIP_POLICY=1` runs only the configured checks.

The policy blocks new explanatory comments and new lint/type/test suppressions.
Approved exceptions need `factory:allow-comment <reason>` or
`factory:allow-suppression <reason>` on the preceding line.

`factory-run.json` is a local evidence record (gitignored); CI uploads it as an
artifact.
