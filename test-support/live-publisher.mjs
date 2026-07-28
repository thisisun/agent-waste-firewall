import { LiveEventStore } from "../src/live-event-store.mjs";

const [root, workspace, indexText] = process.argv.slice(2);
const index = Number.parseInt(indexText, 10);
const store = new LiveEventStore({
  root,
  lockTimeoutMs: 1000,
});
const published = store.publish(
  {
    hook_event_name: "PreToolUse",
    session_id: `synthetic-session-${index}`,
    cwd: workspace,
  },
  {
    output: {},
    incident: null,
    tool: {
      family: "shell",
      operation: "test",
      failed: false,
      interrupted: false,
    },
    observed: {
      progressVersion: index,
      madeProgress: false,
    },
  },
  { mode: "observe" },
  { decisionLatencyMs: index },
);

process.stdout.write(`${JSON.stringify(published)}\n`);
