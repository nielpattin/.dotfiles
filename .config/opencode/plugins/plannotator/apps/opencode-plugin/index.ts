/**
 * Plannotator Plugin for OpenCode
 *
 * Provides an OpenCode planning experience with interactive plan review.
 * When the agent calls submit_plan, the Plannotator UI opens for the user to
 * annotate, approve, or request changes to the plan.
 *
 * Environment variables:
 *   PLANNOTATOR_REMOTE - Set to "1" or "true" for remote mode (devcontainer, SSH)
 *   PLANNOTATOR_PORT   - Fixed port to use (default: random locally, 19432 for remote)
 *
 * @packageDocumentation
 */

import { type Plugin, tool } from "@opencode-ai/plugin";
import { join } from "path";
import {
  startPlannotatorServer,
  handleServerReady,
} from "@plannotator/server";
import {
  startReviewServer,
  handleReviewServerReady,
} from "@plannotator/server/review";
import { getGitContext, runGitDiff } from "@plannotator/server/git";

export const PlannotatorPlugin: Plugin = async (ctx) => {
  // Helper to load HTML content from disk
  const loadHtml = async (filename: string) => {
    try {
      // Use import.meta.dir (points to the dist folder where index.js is)
      const filePath = join(import.meta.dir, filename);
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return await file.text();
      }
      
      // Fallback to ctx.directory/dist if import.meta.dir fails
      const fallbackPath = join(ctx.directory, "dist", filename);
      return await Bun.file(fallbackPath).text();
    } catch (err) {
      console.error(`Failed to load ${filename}. Tried ${import.meta.dir} and ${ctx.directory}/dist`, err);
      return "<html><body><h1>Error loading UI</h1><p>Check logs for details.</p></body></html>";
    }
  };

  return {
    config: async (opencodeConfig) => {
      // Add submit_plan to primary_tools so it's automatically blocked for sub-agents
      const existingPrimaryTools = opencodeConfig.experimental?.primary_tools ?? [];
      opencodeConfig.experimental = {
        ...opencodeConfig.experimental,
        primary_tools: [...existingPrimaryTools, "submit_plan"],
      };
    },

    "experimental.chat.system.transform": async (_input, output) => {
      // Skip adding Plan Submission prompt for title generation requests
      // Title generation has a specific system prompt containing "title generator"
      // and typically has no tools
      const existingSystem = output.system.join("\n").toLowerCase();
      if (existingSystem.includes("title generator") || existingSystem.includes("generate a title")) {
        return; // Skip - this is a title generation request
      }

      output.system.push(`
## Plan Submission

When you have completed your plan, you MUST call the \`submit_plan\` tool to submit it for user review.
The user will be able to:
- Review your plan visually in a dedicated UI
- Annotate specific sections with feedback
- Approve the plan to proceed with implementation
- Request changes with detailed feedback

### Visual Diagrams
You can include Mermaid diagrams in your plan to help the user visualize architecture or workflows. Use standard markdown mermaid blocks (\`\`\`mermaid). These diagrams are rendered interactively with zoom/pan support in the review UI.

If your plan is rejected, you will receive the user's annotated feedback. Revise your plan
based on their feedback and call submit_plan again.

Do NOT proceed with implementation until your plan is approved.
`);
    },

    // Handle /plannotator-review command (requires OpenCode > v1.1.25)
    "command.execute.before": async (input, output) => {
      if (input.command !== "plannotator-review") return;

      // Get git context (branches, available diff options)
      const gitContext = await getGitContext();

      // Run git diff HEAD (uncommitted changes - default)
      const { patch: rawPatch, label: gitRef } = await runGitDiff(
        "uncommitted",
        gitContext.defaultBranch
      );

      // Start server even if empty - user can switch diff types
      const server = await startReviewServer({
        rawPatch,
        gitRef,
        origin: "opencode",
        diffType: "uncommitted",
        gitContext,
        htmlContent: await loadHtml("review-editor.html"),
        onReady: handleReviewServerReady,
      });

      const result = await server.waitForDecision();
      await Bun.sleep(1500);
      server.stop();

      // Inject feedback directly into command parts
      if (result.feedback) {
        output.parts.push({
          type: "text",
          text: `# Code Review Feedback\n\n${result.feedback}\n\nPlease address this feedback.`,
        });
      } else {
        output.parts.push({
          type: "text",
          text: "Please continue with implementation.",
        });
      }

      // Handle agent/model switching if requested
      if ((result.agentSwitch && result.agentSwitch !== 'disabled') || result.model) {
        const shouldSwitchAgent = result.agentSwitch && result.agentSwitch !== 'disabled';
        const targetAgent = result.agentSwitch || 'build';

        try {
          await ctx.client.session.prompt({
            path: { id: input.sessionID },
            body: {
              ...(shouldSwitchAgent && { agent: targetAgent }),
              ...(result.model && { model: result.model }),
              noReply: true,
              parts: [],
            },
          });
        } catch {
          // Silently fail if session is busy
        }
      }
    },

    tool: {
      submit_plan: tool({
        description:
          "Submit your completed plan for interactive user review. The user can annotate, approve, or request changes. Call this when you have finished creating your implementation plan.",
        args: {
          plan: tool.schema
            .string()
            .describe("The complete implementation plan in markdown format. You can include mermaid diagrams (graph, sequence, gantt, etc.) for interactive visualization."),
          summary: tool.schema
            .string()
            .describe("A brief 1-2 sentence summary of what the plan accomplishes"),
        },

        async execute(args, context) {
          // Fetch available models to pass to the UI
          let availableModels: Array<{ providerID: string; modelID: string; name: string }> = [];

          const extractModels = (list: any[], connected?: string[]) => {
            return list
              .filter(p => !connected || connected.includes(p.id))
              .flatMap((p: any) => 
                Object.entries(p.models || {}).map(([id, m]: [string, any]) => ({
                  providerID: p.id,
                  modelID: id,
                  name: m.name || id
                }))
              );
          };

          try {
            // Strategy 1: ctx.client.provider.list() (Standard SDK method)
            // @ts-ignore
            if (typeof ctx.client.provider?.list === 'function') {
              // @ts-ignore
              const res = await ctx.client.provider.list();
              const data = (res as any)?.data || res;
              // Check for data.all (standard response)
              const list = (data as any)?.all;
              const connected = (data as any)?.connected;
              
              if (Array.isArray(list) && list.length > 0) {
                availableModels = extractModels(list, Array.isArray(connected) ? connected : undefined);
              }
            }

            // Strategy 2: ctx.client.config.providers() (Legacy/Alt method)
            // @ts-ignore
            if (availableModels.length === 0 && typeof ctx.client.config?.providers === 'function') {
              // @ts-ignore
              const res = await ctx.client.config.providers();
              const data = (res as any)?.data || res;
              const list = (data as any)?.providers || data;
              // Legacy/Alt might not have 'connected' list easily available, so we show all or try to guess
              // If we are here, Strategy 1 failed, so better to show something than nothing
              if (Array.isArray(list) && list.length > 0) {
                 availableModels = extractModels(list);
              }
            }
            
            // Strategy 3: Direct property access (Fallback)
            // @ts-ignore
            if (availableModels.length === 0) {
              // @ts-ignore
              const props = ctx.client.config?.providers || (ctx.client as any).providers;
              const list = Array.isArray(props) ? props : ((props as any)?.providers || []);
              if (list.length > 0) {
                availableModels = extractModels(list);
              }
            }
          } catch (err) {
             const msg = err instanceof Error ? err.message : String(err);
             console.warn("Plannotator: Error fetching models:", msg);
          }

          const server = await startPlannotatorServer({
            plan: args.plan,
            origin: "opencode",
            models: availableModels,
            htmlContent: await loadHtml("plannotator.html"),
            onReady: (url, isRemote, port) => {
              handleServerReady(url, isRemote, port);
            },
          });

          const result = await server.waitForDecision();
          await Bun.sleep(1500);
          server.stop();

          if (result.approved) {
            // Check agent switch setting (defaults to 'build' if not set)
            const shouldSwitchAgent = result.agentSwitch && result.agentSwitch !== 'disabled';
            const targetAgent = result.agentSwitch || 'build';

            if (shouldSwitchAgent || result.model) {
              // Switch TUI display to target agent if switching
              if (shouldSwitchAgent) {
                try {
                  await ctx.client.tui.executeCommand({
                    body: { command: "agent_cycle" },
                  });
                } catch {
                  // Silently fail
                }
              }

              // Create a user message with target agent and optional model using noReply: true
              try {
                const body: any = {
                  ...(result.model && { model: result.model }),
                  noReply: true,
                  parts: [{ type: "text", text: "Proceed with implementation" }],
                };

                // Only set agent if we are explicitly switching/setting it
                if (shouldSwitchAgent) {
                  body.agent = targetAgent;
                }

                await ctx.client.session.prompt({
                  path: { id: context.sessionID },
                  body,
                });
              } catch {
                // Silently fail if session is busy
              }
            }

            // If user approved with annotations, include them as notes for implementation
            if (result.feedback) {
              return `Plan approved with notes!

Plan Summary: ${args.summary}
${result.savedPath ? `Saved to: ${result.savedPath}` : ""}

## Implementation Notes

The user approved your plan but added the following notes to consider during implementation:

${result.feedback}

Proceed with implementation, incorporating these notes where applicable.`;
            }

            return `Plan approved!

Plan Summary: ${args.summary}
${result.savedPath ? `Saved to: ${result.savedPath}` : ""}`;
          } else {
            return `Plan needs revision.
${result.savedPath ? `\nSaved to: ${result.savedPath}` : ""}

The user has requested changes to your plan. Please review their feedback below and revise your plan accordingly.

## User Feedback

${result.feedback}

---

Please revise your plan based on this feedback and call \`submit_plan\` again when ready.`;
          }
        },
      }),
    },
  };
};

export default PlannotatorPlugin;
