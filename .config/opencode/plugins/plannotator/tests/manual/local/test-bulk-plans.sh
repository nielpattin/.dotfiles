#!/bin/bash
# Test script to run Plannotator against all plans in a directory
#
# Usage:
#   ./test-bulk-plans.sh
#
# For each plan file:
#   1. Launches Plannotator server with that plan
#   2. Opens browser for you to review
#   3. After approve/deny, moves to next plan
#
# Great for bulk-testing Obsidian integration.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PLANS_DIR="$HOME/.plannotator/plans"

echo "=== Plannotator Bulk Plan Test ==="
echo ""

# Check plans directory exists
if [[ ! -d "$PLANS_DIR" ]]; then
    echo "Error: Plans directory not found: $PLANS_DIR"
    exit 1
fi

# Count plans
PLAN_COUNT=$(ls -1 "$PLANS_DIR"/*.md 2>/dev/null | wc -l | tr -d ' ')
echo "Found $PLAN_COUNT plans in $PLANS_DIR"
echo ""

# Build first
echo "Building annotator..."
cd "$PROJECT_ROOT"
bun run build:annotator
echo ""

# Iterate through plans
CURRENT=0
for PLAN_FILE in "$PLANS_DIR"/*.md; do
    CURRENT=$((CURRENT + 1))
    PLAN_NAME=$(basename "$PLAN_FILE")

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Plan $CURRENT of $PLAN_COUNT: $PLAN_NAME"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # Read plan content and escape for JSON
    PLAN_CONTENT=$(cat "$PLAN_FILE" | jq -Rs .)

    # Create event JSON
    PLAN_JSON="{\"tool_input\":{\"plan\":$PLAN_CONTENT}}"

    # Run the annotator server
    echo "$PLAN_JSON" | bun run "$PROJECT_ROOT/apps/annotator/server/index.ts"

    echo ""
    echo "Completed: $PLAN_NAME"
    echo ""

    # Small pause between plans
    sleep 1
done

echo "=== All $PLAN_COUNT plans processed ==="
