// ============================================================================
// Message Types
// ============================================================================

export interface MessageTime {
  created?: number;
  completed?: number;
}

export interface SessionMessage {
  id: string;
  role: "user" | "assistant";
  agent?: string;
  time?: MessageTime;
  parts: MessagePart[];
}

export interface MessagePart {
  id: string;
  type: "text" | "thinking" | "tool" | "step-start" | "reasoning";
  text?: string;
  thinking?: string;
  tool?: string;
  callID?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}

// ============================================================================
// Session Metadata (from storage/session/<projectID>/<sessionID>.json)
// ============================================================================

export interface SessionMetadata {
  id: string;
  directory: string;
  projectID: string;
  title: string;
  slug?: string;
  version?: string;
  time: {
    created: number;
    updated: number;
  };
  summary?: {
    additions?: number;
    deletions?: number;
    files?: number;
  };
}

// ============================================================================
// Session Info (combined data returned by tools)
// ============================================================================

export interface SessionInfo {
  id: string;
  title: string;
  directory: string;
  project_name: string;  // Derived from directory (last folder name)
  message_count: number;
  first_message?: number;  // Unix timestamp
  last_message?: number;   // Unix timestamp
  agents_used: string[];
  has_todos: boolean;
  todos?: TodoItem[];
}

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority?: "low" | "medium" | "high";
}

// ============================================================================
// Search Types
// ============================================================================

export interface SearchResult {
  session_id: string;
  message_id: string;
  role: "user" | "assistant";
  excerpt: string;
  match_count: number;
  timestamp?: number;  // Unix timestamp
}

// ============================================================================
// Tool Argument Types
// ============================================================================

export interface SessionListArgs {
  limit?: number;
  date_filter?: string;
  project?: string;  // Filter by project name or directory
}

export interface SessionReadArgs {
  session_id: string;
  limit?: number;
  include_todos?: boolean;
}

export interface SessionSearchArgs {
  query: string;
  session_id?: string;
  case_sensitive?: boolean;
  limit?: number;
}

export interface SessionInfoArgs {
  session_id: string;
}
