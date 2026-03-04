/**
 * Plannotator CLI
 *
 * Supports Code Review Mode (`plannotator review`):
 *    - Triggered by /plannotator-review slash command
 *    - Runs git diff, opens review UI
 *    - Outputs feedback to stdout (captured by slash command)
 *
 * Environment variables:
 *   PLANNOTATOR_REMOTE - Set to "1" or "true" for remote mode (preferred)
 *   PLANNOTATOR_PORT   - Fixed port to use (default: random locally, 19432 for remote)
 */

import {
  startPlannotatorServer,
  handleServerReady,
} from "@plannotator/server";
import {
  startReviewServer,
  handleReviewServerReady,
} from "@plannotator/server/review";
import { getGitContext, runGitDiff } from "@plannotator/server/git";

// Embed the built HTML at compile time
// @ts-ignore - Bun import attribute for text
import planHtml from "../dist/index.html" with { type: "text" };
const planHtmlContent = planHtml as unknown as string;

// @ts-ignore - Bun import attribute for text
import reviewHtml from "../dist/review.html" with { type: "text" };
const reviewHtmlContent = reviewHtml as unknown as string;

// Check for subcommand
const args = process.argv.slice(2);

if (args[0] === "review") {
  // ============================================
  // CODE REVIEW MODE
  // ============================================

  // Get git context (branches, available diff options)
  const gitContext = await getGitContext();

  // Run git diff HEAD (uncommitted changes - default)
  const { patch: rawPatch, label: gitRef } = await runGitDiff(
    "uncommitted",
    gitContext.defaultBranch
  );

  // Start review server (even if empty - user can switch diff types)
  const server = await startReviewServer({
    rawPatch,
    gitRef,
    origin: "opencode",
    diffType: "uncommitted",
    gitContext,
    htmlContent: reviewHtmlContent,
    onReady: handleReviewServerReady,
  });

  // Wait for user feedback
  const result = await server.waitForDecision();

  // Give browser time to receive response and update UI
  await Bun.sleep(1500);

  // Cleanup
  server.stop();

  // Output feedback (captured by slash command)
  console.log(result.feedback || "No feedback provided.");
  process.exit(0);
}
