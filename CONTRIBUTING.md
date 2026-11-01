# Contributing

Thanks for improving `dsh-auto-summary`.

## Development flow

1. Install dependencies with `pnpm install` (Node.js 20+, pnpm 10+).
2. Make the change in `src/`, keep the module boundaries from the README's
   repository layout.
3. Run `pnpm run verify` — it typechecks, compiles the tests, and runs the
   `node:test` suite against the fake Cordis context.
4. Rebuild the published entry with `pnpm run build` and commit the resulting
   `lib/` changes. The repository ships prebuilt ESM because DSH installs
   bundles as git dependencies and package managers block dependency build
   scripts.
5. Update `README.md` (and `README.zh.md` when user-facing behavior changes) and
   `CHANGELOG.md`.

## Ground rules

- Do not modify DSH itself and do not import `@deepseek-ai/*` packages at runtime
  except the declared dependency. The built entry's only runtime import outside
  the package is `@deepseek-ai/schemastery`; keep it that way so the bundle
  resolves inside an installed profile.
- The summarized session must never be mutated: no `session.append`, no
  compaction, no injected messages.
- Keep the handoff task's guaranteed sections: the handoff agent must always see
  the session's original first prompt and the summary.
- New behavior needs a test in `test/`; pure functions are easier to test and
  preferred where a service boundary is not required.

## Reporting issues

Include the DSH version (`0.2.1-rc.5`), the profile composition, the relevant
configuration, and the plugin's `dsh-auto-summary:` log lines.
