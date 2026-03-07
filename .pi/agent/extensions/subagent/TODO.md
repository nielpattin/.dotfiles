# TODO

## High priority

- [ ] Add execution timeouts / watchdog support for child tasks
  - Allow a max runtime per delegated task.
  - Kill or abort hung child `pi` processes cleanly.
  - Surface timeout status clearly in results/UI.
  - Evidence: `runner.ts`

- [ ] Add automated tests
  - Cover agent discovery.
  - Cover tool input validation.
  - Cover single and parallel task execution paths.
  - Cover `spawn` vs `fork` behavior.
  - Cover rendering/status transitions where practical.
  - Evidence: no test files found in this extension.

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
  - Distinguish validation failure, startup failure, timeout, abort, and agent runtime failure.

- [ ] Add smoke-test examples to README
  - Include one single-task example and one parallel-task example with expected behavior.

- [ ] Consider concurrency tuning controls
  - Current limits are hard-coded; evaluate whether advanced users should be able to override them safely.
