import { FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';

/** Copy Fastify request headers into a web Headers object. */
export function toWebHeaders(req: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key === 'content-length') continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
  }
  return headers;
}

/** Build a web Request from a Fastify request (body re-serialized). */
export function toWebRequest(req: FastifyRequest): Request {
  const url = `${req.protocol}://${req.headers.host}${req.url}`;
  const headers = toWebHeaders(req);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  let body: string | undefined;
  if (hasBody && req.body !== undefined) {
    const type = String(req.headers['content-type'] ?? '');
    body =
      typeof req.body === 'string'
        ? req.body
        : type.includes('application/x-www-form-urlencoded')
          ? new URLSearchParams(req.body as Record<string, string>).toString()
          : JSON.stringify(req.body);
  }
  return new Request(url, { method: req.method, headers, body });
}

/** Write a web Response to the raw Fastify reply. */
export async function sendWebResponse(reply: FastifyReply, response: Response) {
  reply.hijack();
  const raw = reply.raw;
  raw.statusCode = response.status;
  const cookies = (response.headers as any).getSetCookie?.() as string[] | undefined;
  response.headers.forEach((value, key) => {
    if (key === 'set-cookie') return;
    raw.setHeader(key, value);
  });
  if (cookies?.length) raw.setHeader('set-cookie', cookies);
  if (!response.body) {
    raw.end();
    return;
  }
  Readable.fromWeb(response.body as any).pipe(raw);
}
