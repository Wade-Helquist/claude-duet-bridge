// The tool catalog: what Duet Bridge tells an MCP client it can do.
// Shared by the Worker (src/mcp.ts) and the stdio listing entry (glama/stdio.mjs),
// so keep this file free of imports and of TypeScript-only runtime syntax.

export const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
export const SERVER_INFO = { name: "duet-bridge", title: "Duet Bridge", version: "2.0.0" };

export const INSTRUCTIONS = `Duet Bridge connects you to Claude Code on the user's Mac. You talk to Claude Code in sessions.
- list_sessions shows every session. A "live" session is a Code window the user has open; connected=true means it hears you within seconds. A "headless" session is a background conversation the Mac runs for you.
- To pass work to Claude Code, call start_session with a complete brief. Claude Code sees only your text, not this chat. Use mode "read" (the default) to look things up and draft answers. Use mode "work" only when the job must edit files or run commands, and only when the user asked for that.
- To continue any session, live or headless, call send_message. Give wait_seconds (up to 45) to get the answer in the same call. If it is not back yet, call read_messages later with that session_id.
- Claude Code can also message you first. Call read_messages with no session_id at the start of a conversation and on each background check, and tell the user what is there.
- open_on_mac shows a headless session in a terminal window on the Mac, so the user can take over by hand. end_session closes a session you no longer need.
- Nothing Claude Code does sends email or messages for the user. It stages drafts for the user to review.
- bridge_status shows when the Mac last checked in. If that is more than 2 minutes ago, the Mac is probably asleep or offline, so tell the user the work will wait.
- send_job, get_job, list_jobs and cancel_job are the older one-shot path. Prefer sessions.`;

export const STATUSES = ["queued", "running", "done", "failed", "cancelled"];

export function tools(workspaces: string[]) {
  return [
    {
      name: "send_job",
      title: "Send a job to Claude Code",
      description:
        "Queue a read-only job for Claude Code on the user's Mac. Write the instructions as a complete brief: Claude Code sees only this text. Returns a job id. The Mac picks jobs up within seconds while it is awake.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "A short name for the job, for example 'Summarize this week's meeting notes'." },
          instructions: { type: "string", description: "The full brief: what to find or draft, and what the answer should look like." },
          workspace: { type: "string", enum: workspaces, default: workspaces[0], description: "Which project folder on the Mac the job runs in." },
        },
        required: ["title", "instructions"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_job",
      title: "Read a job",
      description: "Read one job: its status and, when it is done, Claude Code's full answer.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "The job id from send_job or list_jobs." } },
        required: ["id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "list_jobs",
      title: "List jobs",
      description: "List recent jobs, newest first, without their full answers.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: [...STATUSES, "all"], default: "all" },
          limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "cancel_job",
      title: "Cancel a job",
      description: "Cancel a job that is still queued. A job that already started cannot be cancelled.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "post_report",
      title: "Post a report",
      description:
        "Leave a report in the mailbox for the other side to read. Claude Code uses this to tell Duet about finished work; Duet can use it to leave notes for Claude Code.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string", description: "The report, in plain text or Markdown." },
          sender: { type: "string", description: "Who is writing, for example 'claude-code' or 'duet'.", default: "claude" },
        },
        required: ["title", "body"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "read_reports",
      title: "Read reports",
      description: "Read reports left in the mailbox. By default returns unread reports, oldest first, and marks them read.",
      inputSchema: {
        type: "object",
        properties: {
          unread_only: { type: "boolean", default: true },
          mark_read: { type: "boolean", default: true },
          limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "bridge_status",
      title: "Bridge status",
      description: "Job counts, unread messages and reports, open live windows, and when the Mac last checked in.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "list_sessions",
      title: "List Claude Code sessions",
      description:
        "List Claude Code sessions, newest activity first: live windows the user has open (connected=true means it hears you now) and headless sessions the Mac runs. Shows each one's name, folder, focus and status.",
      inputSchema: {
        type: "object",
        properties: { include_ended: { type: "boolean", default: false } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "start_session",
      title: "Start a Claude Code session",
      description:
        "Start a new background Claude Code conversation on the user's Mac and send it the first message. Write a complete brief: Claude Code sees only this text. Continue it later with send_message.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "A short name, for example 'Weekly review prep'." },
          message: { type: "string", description: "The full first message: what to do and what the answer should look like." },
          workspace: { type: "string", enum: workspaces, default: workspaces[0], description: "Which project folder on the Mac the session runs in." },
          mode: {
            type: "string", enum: ["read", "work"], default: "read",
            description: "read: look things up and answer in text. work: may also edit files and run commands, with the user's own Claude Code safety rules on. Use work only when the user asked for changes.",
          },
          wait_seconds: { type: "integer", minimum: 0, maximum: 45, default: 0, description: "Hold the call this long for the first answer." },
        },
        required: ["name", "message"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "send_message",
      title: "Message a Claude Code session",
      description:
        "Send a message to a Claude Code session, live or headless. A connected live window gets it within seconds. A headless session answers in its next turn. Give wait_seconds to get the answer in this call.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "The id from list_sessions or start_session." },
          text: { type: "string", description: "The message." },
          wait_seconds: { type: "integer", minimum: 0, maximum: 45, default: 0 },
        },
        required: ["session_id", "text"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "read_messages",
      title: "Read messages from Claude Code",
      description:
        "Read unread messages that Claude Code sent you, oldest first, and mark them read. Give a session_id for one session, or none for everything, including messages Claude Code sent outside any session.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          wait_seconds: { type: "integer", minimum: 0, maximum: 45, default: 0, description: "If nothing is there yet, wait this long for a message." },
          limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "end_session",
      title: "End a session",
      description: "Close a session. A headless session stops taking turns; a live window disconnects from Duet but stays open on the Mac.",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" } },
        required: ["session_id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "open_on_mac",
      title: "Open a session on the Mac",
      description:
        "Open a headless session in a terminal window on the user's Mac, so the user can read it and take over by hand. The window then becomes a live session.",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" } },
        required: ["session_id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
  ];
}
