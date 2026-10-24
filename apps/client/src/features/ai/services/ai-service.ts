import api from "@/lib/api-client";
import {
  IAiAnswerSource,
  IAiGenerateRequest,
  IAiSettingsResponse,
  IAiStatus,
  IAiTestResult,
  IUpdateAiSettings,
} from "@/features/ai/types/ai.types.ts";

export async function getAiSettings(): Promise<IAiSettingsResponse> {
  const req = await api.post("/ai/settings");
  return req.data;
}

export async function updateAiSettings(
  data: IUpdateAiSettings,
): Promise<IAiSettingsResponse> {
  const req = await api.post("/ai/settings/update", data);
  return req.data;
}

export async function resetAiSettings(): Promise<IAiSettingsResponse> {
  const req = await api.post("/ai/settings/delete");
  return req.data;
}

export async function testAiSettings(
  target: "chat" | "embedding",
): Promise<IAiTestResult> {
  const req = await api.post("/ai/settings/test", { target });
  return req.data;
}

export async function getAiStatus(): Promise<IAiStatus> {
  const req = await api.post("/ai/status");
  return req.data;
}

async function postStream(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  // Streaming responses bypass axios, which buffers the whole body.
  const res = await fetch(`/api${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let message = `Request failed (${res.status})`;
    try {
      message = (await res.json())?.message ?? message;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }
  return res.body.getReader();
}

/** Stream generated Markdown; calls onText with the full text so far. */
export async function streamAiGenerate(
  request: IAiGenerateRequest,
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const reader = await postStream("/ai/generate/stream", request, signal);
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onText(text);
  }
  return text;
}

export type AiAnswerHandlers = {
  onSources: (sources: IAiAnswerSource[]) => void;
  onText: (text: string) => void;
  onError: (message: string) => void;
};

/** Ask the knowledge base; the server streams newline-delimited JSON. */
export async function streamAiAnswer(
  question: string,
  handlers: AiAnswerHandlers,
  opts: { spaceId?: string; signal?: AbortSignal } = {},
): Promise<void> {
  const reader = await postStream(
    "/ai/ask",
    { question, spaceId: opts.spaceId },
    opts.signal,
  );
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "sources") handlers.onSources(event.sources);
    if (event.type === "text") {
      text += event.delta;
      handlers.onText(text);
    }
    if (event.type === "error") handlers.onError(event.message);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(handleLine);
  }
  handleLine(buffer);
}
