## Summary

<!-- One or two sentences describing what this PR does and why. -->

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that changes existing behavior)
- [ ] Refactor (no functional change)
- [ ] Docs / chore / tooling

## Related issues

<!-- "Closes #123", "Refs #456", or "N/A". -->

## How was this tested?

<!-- Commands run, scenarios covered, screenshots for UI/docs. -->

## Checklist

- [ ] `pnpm test` passes locally
- [ ] **Tier 2 install verification** — both run for any PR touching `packages/movehat/src/**`, `bin/**`, or published templates; mark N/A in "How was this tested?" otherwise:
  - [ ] `pnpm test:example` (workspace symlink runtime)
  - [ ] `pnpm test:smoke` (npm-packed tarball + global install)
- [ ] CHANGELOG `[Unreleased]` updated if user-visible
- [ ] Docs updated if public API or CLI surface changed
- [ ] ROADMAP `[ ]` → `[x]` ticked for any DoD bullet this PR satisfies
- [ ] Conventional Commits used in commit messages
