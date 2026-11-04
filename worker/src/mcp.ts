// The MCP endpoint. Stateless Streamable HTTP: every POST carries JSON-RPC and gets a JSON reply.
// No server-to-client stream, so GET and DELETE answer 405.
import type { Env } from "./index";
import type { JobStatus, Mailbox } from "./mailbox";
import { INSTRUCTIONS, SERVER_INFO, STATUSES, SUPPORTED_VERSIONS, tools } from "./catalog";

function wait(args: Record<string, unknown>): number {
  const v = args.wait_seconds;
  if (v === undefined) return 0;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new ToolError("'wait_seconds' must be a whole number from 0.");
  return Math.min(v, 45) * 1000;
}

// What a session looks like to Duet: no internal ids it cannot use.
const view = <T extends { claude_id?: unknown; busy_since?: unknown }>({ claude_id, busy_since, ...rest }: T) => rest;

class ToolError extends Error {}

const text = (value: unknown) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

function str(args: Record<string, unknown>, key: string, required = true): string {
  const v = args[key];
  if (v === undefined || v === null || v === "") {
    if (required) throw new ToolError(`Missing '${key}'.`);
    return "";
  }
  if (typeof v !== "string") throw new ToolError(`'${key}' must be text.`);
  return v.trim();
}

function int(args: Record<string, unknown>, key: string, dflt: number, max: number): number {
  const v = args[key];
  if (v === undefined) return dflt;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw new ToolError(`'${key}' must be a whole number from 1.`);
  return Math.min(v, max);
}

function bool(args: Record<string, unknown>, key: string, dflt: boolean): boolean {
  const v = args[key];
  return typeof v === "boolean" ? v : dflt;
}

async function callTool(env: Env, name: string, args: Record<string, unknown>) {
  const box = mailbox(env);
  const workspaces = workspaceList(env);
  switch (name) {
    case "send_job": {
      const workspace = str(args, "workspace", false) || workspaces[0];
      if (!workspaces.includes(workspace)) throw new ToolError(`Unknown workspace '${workspace}'. Use one of: ${workspaces.join(", ")}.`);
      const job = await box.addJob(str(args, "title"), str(args, "instructions"), workspace);
      const status = await box.status();
      return text({ id: job.id, status: job.status, workspace, last_mac_checkin: status.last_mac_checkin });
    }
    case "get_job": {
      const job = await box.getJob(str(args, "id"));
      if (!job) throw new ToolError("No job has that id.");
      return text(job);
    }
    case "list_jobs": {
      const status = (str(args, "status", false) || "all") as JobStatus | "all";
      if (status !== "all" && !STATUSES.includes(status)) throw new ToolError(`Unknown status '${status}'.`);
      const jobs = await box.listJobs(status, int(args, "limit", 10, 50));
      return text(jobs.map(({ result, instructions, ...rest }) => ({ ...rest, has_result: result !== null })));
    }
    case "cancel_job": {
      const job = await box.cancelJob(str(args, "id"));
      if (!job) throw new ToolError("No job has that id.");
      if (job.status !== "cancelled") throw new ToolError(`The job is ${job.status}, so it cannot be cancelled.`);
      return text({ id: job.id, status: job.status });
    }
    case "post_report": {
      const r = await box.addReport(str(args, "title"), str(args, "body"), str(args, "sender", false) || "claude");
      return text({ id: r.id, created_at: r.created_at });
    }
    case "read_reports": {
      const rows = await box.readReports(bool(args, "unread_only", true), int(args, "limit", 20, 50), bool(args, "mark_read", true));
      return text(rows.length ? rows : "No reports.");
    }
    case "bridge_status":
      return text(await box.status());
    case "list_sessions": {
      const rows = await box.listSessions(bool(args, "include_ended", false), 50);
      return text(rows.length ? rows.map(view) : "No sessions. Start one with start_session, or ask the user to open a window with duet-code.");
    }
    case "start_session": {
      const workspace = str(args, "workspace", false) || workspaces[0];
      if (!workspaces.includes(workspace)) throw new ToolError(`Unknown workspace '${workspace}'. Use one of: ${workspaces.join(", ")}.`);
      const mode = str(args, "mode", false) || "read";
      if (mode !== "read" && mode !== "work") throw new ToolError("'mode' must be read or work.");
      const ms = wait(args);
      const { session } = await box.startHeadless(str(args, "name"), workspace, mode, str(args, "message"));
      const replies = ms ? await box.waitForDuet(session.id, ms, true, 20) : [];
      return text({ session: view(session), replies, note: replies.length ? undefined : "The Mac will answer in its next turn. Call read_messages with this session_id." });
    }
    case "send_message": {
      const id = str(args, "session_id");
      const s = await box.getSession(id);
      if (!s) throw new ToolError("No session has that id. Call list_sessions.");
      if (s.status === "ended") throw new ToolError("That session has ended. Start a new one with start_session.");
      const ms = wait(args);
      const m = await box.sendToCode(id, str(args, "text"));
      const replies = ms ? await box.waitForDuet(id, ms, true, 20) : [];
      const live = s.kind === "live" ? (await box.listSessions(false, 50)).find((r) => r.id === id)?.connected : null;
      const note = replies.length ? undefined
        : live === false ? "The window is not connected right now. It gets the message when it reconnects."
        : "No answer yet. Call read_messages with this session_id.";
      return text({ sent: m.id, replies, note });
    }
    case "read_messages": {
      const id = str(args, "session_id", false) || null;
      const rows = await box.waitForDuet(id, wait(args), true, int(args, "limit", 20, 50));
      return text(rows.length ? rows : "No new messages.");
    }
    case "end_session": {
      const s = await box.endSession(str(args, "session_id"));
      if (!s) throw new ToolError("No session has that id.");
      return text({ id: s.id, status: s.status });
    }
    case "open_on_mac": {
      const id = str(args, "session_id");
      const s = await box.getSession(id);
      if (!s) throw new ToolError("No session has that id.");
      if (s.kind !== "headless") throw new ToolError("That session is already a window on the Mac.");
      if (s.status === "busy") throw new ToolError("That session is in the middle of a turn. Try again when it answers.");
      if (s.turns === 0) throw new ToolError("That session has not finished its first turn yet, so there is nothing to open.");
      // Mark it live first, so the Mac never runs a background turn while the window opens on the same conversation.
      await box.registerLive(id, "", "", "");
      const c = await box.addCommand("open_on_mac", id);
      return text({ queued: c.id, note: "The Mac opens the window within a few seconds if it is awake." });
    }
    default:
      throw new ToolError(`Unknown tool '${name}'.`);
  }
}

// The RPC stub's own type is too deep for the checker, so callers see plain async methods.
type MailboxApi = {
  [K in keyof Mailbox]: Mailbox[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never;
};

export function mailbox(env: Env): MailboxApi {
  return env.MAILBOX.get(env.MAILBOX.idFromName("main")) as unknown as MailboxApi;
}

export function workspaceList(env: Env): string[] {
  return (env.WORKSPACES || "default").split(",").map((s) => s.trim()).filter(Boolean);
}

type RpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const rpcError = (id: RpcMessage["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handleOne(env: Env, msg: RpcMessage): Promise<object | null> {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(msg?.id, -32600, "Invalid request");
  }
  // A notification has no id and gets no reply.
  if (msg.id === undefined) return null;
  const params = msg.params ?? {};
  switch (msg.method) {
    case "initialize": {
      const asked = String(params.protocolVersion ?? "");
      return {
        jsonrpc: "2.0", id: msg.id,
        result: {
          protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id: msg.id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id: msg.id, result: { tools: tools(workspaceList(env)) } };
    case "tools/call": {
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        return { jsonrpc: "2.0", id: msg.id, result: await callTool(env, name, args) };
      } catch (e) {
        if (e instanceof ToolError) {
          return { jsonrpc: "2.0", id: msg.id, result: { ...text(e.message), isError: true } };
        }
        throw e;
      }
    }
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }
  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map((m) => handleOne(env, m as RpcMessage)))).filter(Boolean);
    return replies.length ? Response.json(replies) : new Response(null, { status: 202 });
  }
  const reply = await handleOne(env, body as RpcMessage);
  return reply ? Response.json(reply) : new Response(null, { status: 202 });
}
