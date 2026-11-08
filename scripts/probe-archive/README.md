# Archived probes

Diagnostic scripts from gates 1 to 4 and plans 05 to 09 that no handoff or plan document names. They were moved here
from `scripts/probe/` in plan 10f (decision U10) and are kept for provenance only.

This directory is excluded from `tsconfig.json`, so these scripts are not typechecked and may no longer compile against
the current simulator API. To revive one, move it back to `scripts/probe/`, fix it against the current API and cite it
from the handoff that uses it. Run a probe with `npx vite-node scripts/probe/<name>.ts`.
