/**
 * Session Manager Plugin - Verbose Test Suite
 * 
 * This script tests each tool and shows EXACTLY what the AI sees
 * when it calls the session management tools.
 */

import { 
  getAllSessions, 
  readSessionMessages, 
  getSessionInfo,
  getSessionMetadata,
  readSessionTodos,
} from "../src/storage";

import {
  formatSessionList,
  formatSessionMessages,
  formatSessionInfo,
  formatSearchResults,
  filterSessionsByDate,
  filterSessionsByProject,
  searchInSession,
} from "../src/formatters";

import type { SessionInfo, SearchResult } from "../src/types";

// ANSI colors for terminal output
const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function header(title: string) {
  console.log("\n" + "=".repeat(80));
  console.log(`${COLORS.bright}${COLORS.cyan}  ${title}${COLORS.reset}`);
  console.log("=".repeat(80) + "\n");
}

function subheader(title: string) {
  console.log(`\n${COLORS.yellow}--- ${title} ---${COLORS.reset}\n`);
}

function label(name: string) {
  console.log(`${COLORS.magenta}[${name}]${COLORS.reset}`);
}

function success(msg: string) {
  console.log(`${COLORS.green}✓ ${msg}${COLORS.reset}`);
}

function infoLog(msg: string) {
  console.log(`${COLORS.dim}${msg}${COLORS.reset}`);
}

// ============================================================================
// TEST 1: session_list
// ============================================================================
async function testSessionList() {
  header("TEST 1: session_list");
  
  infoLog("This tool lists available sessions with optional date/project filtering.");
  infoLog("The AI uses this to find sessions the user might want to reference.\n");

  subheader("Step 1: Get all session IDs from storage");
  const allSessionIds = getAllSessions();
  console.log(`Found ${allSessionIds.length} sessions in storage.`);
  console.log(`First 5 IDs: ${allSessionIds.slice(0, 5).join(", ")}\n`);

  subheader("Step 2: Build SessionInfo for each session (with metadata!)");
  const sessions: SessionInfo[] = [];
  const limit = 5;
  
  for (const id of allSessionIds.slice(0, limit)) {
    const sessionInfo = getSessionInfo(id);
    if (sessionInfo) {
      sessions.push(sessionInfo);
      console.log(`  ${COLORS.green}✓${COLORS.reset} ${sessionInfo.title}`);
      console.log(`    ID: ${id}`);
      console.log(`    Project: ${sessionInfo.project_name}`);
      console.log(`    Directory: ${sessionInfo.directory}`);
      console.log(`    Messages: ${sessionInfo.message_count}, Agents: [${sessionInfo.agents_used.join(", ")}]`);
      console.log(`    Last active: ${new Date(sessionInfo.last_message || 0).toLocaleString()}`);
    }
  }

  subheader("Step 3: Format output for AI");
  label("RAW OUTPUT - What the AI sees:");
  console.log("\n" + "─".repeat(60));
  const output = formatSessionList(sessions);
  console.log(output);
  console.log("─".repeat(60) + "\n");

  subheader("Step 4: Test date filtering (today)");
  const todaySessions = filterSessionsByDate(sessions, "today");
  console.log(`Sessions from today: ${todaySessions.length}`);
  if (todaySessions.length > 0) {
    label("Filtered output:");
    console.log(formatSessionList(todaySessions.slice(0, 3)));
  }

  subheader("Step 5: Test project filtering");
  const projectFilter = "opencode";
  const projectSessions = filterSessionsByProject(sessions, projectFilter);
  console.log(`Sessions matching "${projectFilter}": ${projectSessions.length}`);

  success("session_list test complete");
}

// ============================================================================
// TEST 2: session_read
// ============================================================================
async function testSessionRead() {
  header("TEST 2: session_read");
  
  infoLog("This tool reads messages from a specific session.");
  infoLog("The AI uses this to recall previous conversations.\n");

  // Get first available session
  const allSessionIds = getAllSessions();
  if (allSessionIds.length === 0) {
    console.log("No sessions found to test.");
    return;
  }

  const testSessionId = allSessionIds[0];
  console.log(`Testing with session: ${testSessionId}\n`);

  subheader("Step 1: Get session metadata");
  const metadata = getSessionMetadata(testSessionId);
  if (metadata) {
    label("Session Metadata (from storage/session/):");
    console.log(JSON.stringify({
      id: metadata.id,
      title: metadata.title,
      directory: metadata.directory,
      projectID: metadata.projectID,
      time: metadata.time,
    }, null, 2));
  }

  subheader("Step 2: Read messages");
  const messages = readSessionMessages(testSessionId, 3);
  console.log(`Read ${messages.length} messages from session.\n`);

  subheader("Step 3: Examine raw message structure");
  if (messages.length > 0) {
    const firstMsg = messages[0];
    label("First message (raw JSON):");
    console.log(JSON.stringify({
      id: firstMsg.id,
      role: firstMsg.role,
      agent: firstMsg.agent,
      time: firstMsg.time,
      parts_count: firstMsg.parts.length,
    }, null, 2));
  }

  subheader("Step 4: Format output for AI");
  label("RAW OUTPUT - What the AI sees:");
  console.log("\n" + "─".repeat(60));
  const info = getSessionInfo(testSessionId);
  let result = "";
  if (info) {
    result += `Session: ${info.title}\n`;
    result += `Project: ${info.project_name} (${info.directory})\n`;
    result += `Messages: ${info.message_count} total (showing ${messages.length})\n\n`;
  }
  result += formatSessionMessages(messages);
  console.log(result);
  console.log("─".repeat(60) + "\n");

  success("session_read test complete");
}

// ============================================================================
// TEST 3: session_search
// ============================================================================
async function testSessionSearch() {
  header("TEST 3: session_search");
  
  infoLog("This tool searches for text across sessions.");
  infoLog("The AI uses this to find relevant past conversations.\n");

  const searchQuery = "error";
  console.log(`Search query: "${searchQuery}"\n`);

  subheader("Step 1: Get sessions to search");
  const allSessionIds = getAllSessions().slice(0, 10);
  console.log(`Searching across ${allSessionIds.length} sessions...\n`);

  subheader("Step 2: Search each session");
  const results: SearchResult[] = [];
  
  for (const id of allSessionIds) {
    const messages = readSessionMessages(id, 50);
    const sessionResults = searchInSession(messages, searchQuery, false);
    
    if (sessionResults.length > 0) {
      const metadata = getSessionMetadata(id);
      console.log(`  ${COLORS.green}✓${COLORS.reset} ${metadata?.title || id}: ${sessionResults.length} matches`);
      for (const r of sessionResults) {
        r.session_id = id;
        results.push(r);
      }
    } else {
      console.log(`  ${COLORS.dim}○ ${id}: no matches${COLORS.reset}`);
    }
    
    if (results.length >= 5) break;
  }

  subheader("Step 3: Examine raw search result structure");
  if (results.length > 0) {
    label("First result (raw JSON):");
    console.log(JSON.stringify(results[0], null, 2));
  }

  subheader("Step 4: Format output for AI");
  label("RAW OUTPUT - What the AI sees:");
  console.log("\n" + "─".repeat(60));
  const output = formatSearchResults(results.slice(0, 5));
  console.log(output);
  console.log("─".repeat(60) + "\n");

  success("session_search test complete");
}

// ============================================================================
// TEST 4: session_info
// ============================================================================
async function testSessionInfo() {
  header("TEST 4: session_info");
  
  infoLog("This tool gets detailed metadata about a specific session.");
  infoLog("The AI uses this to understand session context and history.\n");

  const allSessionIds = getAllSessions();
  if (allSessionIds.length === 0) {
    console.log("No sessions found to test.");
    return;
  }

  const testSessionId = allSessionIds[0];
  console.log(`Testing with session: ${testSessionId}\n`);

  subheader("Step 1: Get session info (combines metadata + messages)");
  const sessionInfo = getSessionInfo(testSessionId);
  
  if (!sessionInfo) {
    console.log("Could not get session info.");
    return;
  }

  subheader("Step 2: Examine raw SessionInfo structure");
  label("Raw SessionInfo (JSON):");
  console.log(JSON.stringify(sessionInfo, null, 2));

  subheader("Step 3: Format output for AI");
  label("RAW OUTPUT - What the AI sees:");
  console.log("\n" + "─".repeat(60));
  const output = formatSessionInfo(sessionInfo);
  console.log(output);
  console.log("─".repeat(60) + "\n");

  subheader("Step 4: Verify all fields are present");
  const checks = [
    { field: "id", value: sessionInfo.id },
    { field: "title", value: sessionInfo.title },
    { field: "directory", value: sessionInfo.directory },
    { field: "project_name", value: sessionInfo.project_name },
    { field: "message_count", value: sessionInfo.message_count },
    { field: "first_message", value: sessionInfo.first_message },
    { field: "last_message", value: sessionInfo.last_message },
    { field: "agents_used", value: sessionInfo.agents_used },
  ];
  
  for (const check of checks) {
    const status = check.value !== undefined && check.value !== null && check.value !== "";
    const icon = status ? `${COLORS.green}✓${COLORS.reset}` : `${COLORS.red}✗${COLORS.reset}`;
    console.log(`  ${icon} ${check.field}: ${JSON.stringify(check.value)}`);
  }

  success("session_info test complete");
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  console.log("\n" + "█".repeat(80));
  console.log(`${COLORS.bright}${COLORS.blue}`);
  console.log("  SESSION MANAGER PLUGIN - VERBOSE TEST SUITE (v2)");
  console.log("  See exactly what the AI receives from each tool");
  console.log(`${COLORS.reset}`);
  console.log("█".repeat(80));

  await testSessionList();
  await testSessionRead();
  await testSessionSearch();
  await testSessionInfo();

  header("SUMMARY");
  console.log("The AI receives plain text output from each tool.");
  console.log("This is what gets injected into the conversation context.\n");
  
  console.log(`${COLORS.green}What's now included:${COLORS.reset}`);
  console.log("  ✓ Session titles (human-readable names)");
  console.log("  ✓ Project names and directories");
  console.log("  ✓ Properly formatted timestamps (e.g., 'Today 2:30 PM')");
  console.log("  ✓ Project-based filtering");
  console.log("  ✓ Date-based filtering (today, yesterday, specific date)");
  console.log("  ✓ Message counts and agent usage");
  console.log("  ✓ Todo lists");
}

main().catch(console.error);
