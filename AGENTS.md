# Repository agent instructions

## Demo branch scope

- Keep dashboard demo work on the `demo` branch unless the user explicitly requests another branch.
- Do not modify or merge `main` without explicit approval.

## Required demo reporting

For every change pushed to `demo`, the final update must always state:

1. The expected or verified demo label in the form `DEMO R<workflow-run-number> <short-commit-sha>`.
2. The full commit SHA.
3. The `Deploy Demo` workflow status.
4. A cache-busted demo URL in the form `https://demo.esports-live.pages.dev/?commit=<full-commit-sha>` once deployment verification succeeds.

Do not describe a demo build as published, live, or verified until the `Deploy Demo` workflow has completed successfully, including its public version-verification step. When deployment is still queued or running, report that state explicitly and still include the expected demo label when the run number is known.
