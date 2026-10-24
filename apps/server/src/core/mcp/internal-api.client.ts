import { Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';

/** Credentials and request details forwarded from the MCP HTTP request. */
export type ForwardedAuth = {
  authorization?: string;
  cookie?: string;
  host?: string;
  remoteAddress?: string;
  userAgent?: string;
};

export class InternalApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Calls DocIt's own REST API in-process (Fastify inject, no network) with
 * the caller's credentials, so MCP tools get exactly the same scope checks,
 * permissions, validation, and audit logging as direct API calls.
 */
@Injectable()
export class InternalApiClient {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  private get fastify(): FastifyInstance {
    return this.adapterHost.httpAdapter.getInstance<FastifyInstance>();
  }

  async post<T = any>(
    auth: ForwardedAuth,
    path: string,
    body: Record<string, unknown> = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (auth.authorization) headers.authorization = auth.authorization;
    if (auth.cookie) headers.cookie = auth.cookie;
    if (auth.host) headers.host = auth.host;
    headers['user-agent'] = auth.userAgent
      ? `${auth.userAgent} (via MCP)`
      : 'DocIt MCP';

    const res = await this.fastify.inject({
      method: 'POST',
      url: `/api${path}`,
      headers,
      payload: JSON.stringify(body),
      remoteAddress: auth.remoteAddress,
    });

    let parsed: any;
    try {
      parsed = res.body ? JSON.parse(res.body) : undefined;
    } catch {
      parsed = res.body;
    }

    if (res.statusCode >= 400) {
      const message =
        (Array.isArray(parsed?.message)
          ? parsed.message.join('; ')
          : parsed?.message) ?? `Request failed (${res.statusCode})`;
      throw new InternalApiError(res.statusCode, message);
    }

    // Successful responses are wrapped as { data, success, status }.
    return (parsed?.data ?? parsed) as T;
  }

  /** POST and return the raw response body (for streaming endpoints). */
  async postRaw(
    auth: ForwardedAuth,
    path: string,
    body: Record<string, unknown> = {},
  ): Promise<string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (auth.authorization) headers.authorization = auth.authorization;
    if (auth.cookie) headers.cookie = auth.cookie;
    if (auth.host) headers.host = auth.host;
    const res = await this.fastify.inject({
      method: 'POST',
      url: `/api${path}`,
      headers,
      payload: JSON.stringify(body),
      remoteAddress: auth.remoteAddress,
    });
    if (res.statusCode >= 400) {
      let message = `Request failed (${res.statusCode})`;
      try {
        message = JSON.parse(res.body)?.message ?? message;
      } catch {
        /* keep default */
      }
      throw new InternalApiError(res.statusCode, message);
    }
    return res.body;
  }
}
