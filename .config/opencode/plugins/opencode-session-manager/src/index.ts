import type { Plugin } from "@opencode-ai/plugin";
import { createSessionManagerTools } from "./tools";

const SessionManagerPlugin: Plugin = async (_ctx) => {
  const tools = createSessionManagerTools();

  return {
    tool: {
      ...tools,
    },
  };
};

export default SessionManagerPlugin;
