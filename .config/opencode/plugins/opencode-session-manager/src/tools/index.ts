import { createSessionListTool } from "./list";
import { createSessionReadTool } from "./read";
import { createSessionSearchTool } from "./search";
import { createSessionInfoTool } from "./info";

export function createSessionManagerTools() {
  return {
    session_list: createSessionListTool(),
    session_read: createSessionReadTool(),
    session_search: createSessionSearchTool(),
    session_info: createSessionInfoTool(),
  };
}
