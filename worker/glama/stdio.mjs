#!/usr/bin/env node
// A stdio entry point for MCP directories (Glama) that build a repo in a container and
// introspect it. Duet Bridge itself is a Cloudflare Worker behind OAuth, and its tools
// only do anything against a deployed Worker and a running Mac, so this entry answers
// initialize and tools/list with the real catalog and explains itself on tools/call.
//
// It reads src/catalog.ts directly, so it needs Node 22.18 or later (type stripping).
// No npm install needed.
//
// Run: node glama/stdio.mjs
import { createInterface } from "node:readline";
import { INSTRUCTIONS, SERVER_INFO, SUPPORTED_VERSIONS, tools } from "../src/catalog.ts";

const workspaces = (process.env.WORKSPACES || "default").split(",").map((s) => s.trim()).filter(Boolean);

const NOT_HERE =
  "This is the listing entry for Duet Bridge, not a running bridge. The tools run on a " +
  "Cloudflare Worker you deploy and reach Claude Code through a small runner on your Mac. " +
  "Setup: https://github.com/calebgrimes/claude-duet-bridge#readme";

const reply = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const error = (id, code, message) => reply({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function handle(msg) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return error(msg?.id, -32600, "Invalid request");
  if (msg.id === undefined) return; // a notification gets no reply
  const params = msg.params ?? {};
  switch (msg.method) {
    case "initialize": {
      const asked = String(params.protocolVersion ?? "");
      return reply({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        },
      });
    }
    case "ping":
      return reply({ jsonrpc: "2.0", id: msg.id, result: {} });
    case "tools/list":
      return reply({ jsonrpc: "2.0", id: msg.id, result: { tools: tools(workspaces) } });
    case "tools/call":
      return reply({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: NOT_HERE }], isError: true } });
    default:
      return error(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return error(null, -32700, "Parse error");
  }
  if (Array.isArray(msg)) msg.forEach(handle);
  else handle(msg);
});
