import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.MODEL_TARGET_PORT ?? 8080);
const model = process.env.MODEL_TARGET_MODEL ?? "gpt-5.6-luna";

function json(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function collectUserText(value, result = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectUserText(item, result);
    return result;
  }
  if (value === null || typeof value !== "object") return result;
  if (value.role === "user") {
    collectText(value.content, result);
    if (typeof value.text === "string") result.push(value.text);
  }
  for (const [key, child] of Object.entries(value)) {
    if (key !== "content" && key !== "text") collectUserText(child, result);
  }
  return result;
}

function collectText(value, result) {
  if (typeof value === "string") {
    result.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, result);
    return;
  }
  if (value !== null && typeof value === "object") {
    if (typeof value.text === "string") result.push(value.text);
    else if (typeof value.input_text === "string") result.push(value.input_text);
  }
}

function responseText(requestBody) {
  const userText = collectUserText(requestBody).at(-1) ?? "E2E mock response";
  // The file-reference test deliberately keeps its marker only in the remote file. Derive the
  // deterministic marker from the generated filename so the mock exercises the full turn path.
  const match = JSON.stringify(requestBody).match(/e2e-file-reference-(\d+)/) ?? userText.match(/e2e-file-reference-(\d+)/);
  if (match) return `STRUCTURED_FILE_REFERENCE_${match[1]}`;
  return userText.replace(/^用一句话回复[：:]\s*/, "").trim() || "E2E mock response";
}

function writeEvent(response, type, payload) {
  response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
}

function streamResponse(response, text, requestBody) {
  const id = `resp_${randomUUID().replaceAll("-", "")}`;
  const messageId = `msg_${randomUUID().replaceAll("-", "")}`;
  const createdAt = Math.floor(Date.now() / 1000);
  const message = {
    type: "message",
    id: messageId,
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", text, annotations: [] }],
  };
  const baseResponse = {
    id,
    object: "response",
    created_at: createdAt,
    model: requestBody.model ?? model,
    output: [],
    status: "in_progress",
  };

  response.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream",
  });
  writeEvent(response, "response.created", { response: baseResponse });
  writeEvent(response, "response.output_item.added", {
    output_index: 0,
    item: { ...message, status: "in_progress", content: [] },
  });
  writeEvent(response, "response.content_part.added", {
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: "", annotations: [] },
  });
  writeEvent(response, "response.output_text.delta", {
    output_index: 0,
    content_index: 0,
    delta: text,
  });
  writeEvent(response, "response.output_text.done", {
    output_index: 0,
    content_index: 0,
    text,
  });
  writeEvent(response, "response.content_part.done", {
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text, annotations: [] },
  });
  writeEvent(response, "response.output_item.done", { output_index: 0, item: message });
  writeEvent(response, "response.completed", {
    response: {
      ...baseResponse,
      output: [message],
      status: "completed",
      completed_at: Math.floor(Date.now() / 1000),
      usage: { input_tokens: 1, output_tokens: text.length, total_tokens: text.length + 1 },
    },
  });
  response.write("data: [DONE]\n\n");
  response.end();
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "model-target"}`);
  if (request.method === "GET" && url.pathname === "/v1/models") {
    json(response, 200, {
      object: "list",
      data: [{ id: model, object: "model", created: Math.floor(Date.now() / 1000), owned_by: "e2e" }],
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/responses") {
    try {
      const rawBody = await readBody(request);
      const parsedBody = rawBody === "" ? {} : JSON.parse(rawBody);
      const body = parsedBody !== null && typeof parsedBody === "object" ? parsedBody : {};
      streamResponse(response, responseText(body), body);
    } catch (error) {
      json(response, 400, { error: { message: error instanceof Error ? error.message : String(error) } });
    }
    return;
  }
  json(response, 404, { error: { message: "Not found" } });
}).listen(port, "0.0.0.0", () => {
  console.log(`E2E model target listening on ${port}`);
});
