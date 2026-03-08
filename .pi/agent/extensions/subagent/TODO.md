# TODO

## High priority

- [ ] Add automated tests
  - Added initial Bun coverage in `runner.test.ts` for normal completion and abort handling.
  - Still need broader coverage for agent discovery.
  - Still need tool input validation coverage.
  - Still need single and parallel task execution path coverage beyond runner lifecycle.
  - Still need `spawn` vs `fork` behavior coverage.
  - Still need rendering/status transition coverage where practical.

## Medium priority

- [ ] Refresh discovered agent list dynamically
  - Avoid session-start caching drift between prompt-visible agents and executable agents.
  - Recompute or invalidate the injected agent list when agent files change.
  - Evidence: `index.ts`

- [ ] Support per-task context mode in parallel runs
  - Let each task choose `spawn` or `fork` instead of forcing one top-level mode for all tasks.
  - Evidence: `index.ts`, `README.md`

- [ ] Implement task preview line in task cards
  - Replace the current placeholder with a useful task summary/snippet in the TUI.
  - Evidence: `render.ts` (`cardTaskLine` currently returns `null`).

## Documentation / polish

- [ ] Document `skills` in agent frontmatter
  - README should match implementation support.
  - Add an example showing how `skills` are declared and loaded.
  - Evidence: `agents.ts`, `runner.ts`, `README.md`

## Nice-to-have follow-ups

- [ ] Add clearer failure categories in output
  - Distinguish validation failure, startup failure, abort, and agent runtime failure.

- [ ] Add smoke-test examples to README
  - Include one single-task example and one parallel-task example with expected behavior.

- [ ] Consider concurrency tuning controls
  - Current limits are hard-coded; evaluate whether advanced users should be able to override them safely.
