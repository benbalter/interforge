import { http, HttpResponse, type HttpHandler } from 'msw';
import type { Forge } from '../../src/abstract/errors.js';
import { assertRequest, assertResponse } from './openapi.js';

export type Json = Record<string, unknown>;

export interface RouteContext {
  params: Record<string, string>;
  query: URLSearchParams;
  headers: Headers;
  body: Json | undefined;
}

export type Reply = {
  status?: number;
  body?: unknown;
  /** A non-JSON body (raw media types). Not validated. */
  text?: string;
  headers?: HeadersInit;
};

/**
 * Shared plumbing for the fake forges: turns `METHOD /path/{param}` routes
 * into msw handlers, and checks every request body and response body against
 * the forge's OpenAPI description. Mismatches are collected in `violations`,
 * which tests assert is empty.
 */
export class FakeForge {
  readonly handlers: HttpHandler[] = [];
  readonly violations: string[] = [];
  /** Items per page on list endpoints, to exercise pagination. */
  pageSize = 100;

  constructor(
    readonly forge: Forge,
    readonly baseUrl: string,
  ) {}

  route(operation: string, resolve: (ctx: RouteContext) => Reply) {
    const [method, path] = operation.split(' ');
    const mswPath = this.baseUrl + path.replace(/\{(\w+)\}/g, ':$1');
    const verb = method.toLowerCase() as 'get' | 'post' | 'put' | 'patch';

    this.handlers.push(
      http[verb](mswPath, async ({ request, params }) => {
        const text = await request.text();
        const body = text ? (JSON.parse(text) as Json) : undefined;
        this.validate(
          () => body && assertRequest(this.forge, method, path, body),
        );

        const decoded = Object.fromEntries(
          Object.entries(params).map(([k, v]) => [
            k,
            decodeURIComponent(String(v)),
          ]),
        );
        const reply = resolve({
          params: decoded,
          query: new URL(request.url).searchParams,
          headers: request.headers,
          body,
        });
        const status = reply.status ?? 200;
        if (status < 300 && reply.body !== undefined) {
          this.validate(() =>
            assertResponse(this.forge, method, path, status, reply.body),
          );
        }
        if (reply.text !== undefined) {
          return new HttpResponse(reply.text, {
            status,
            headers: reply.headers,
          });
        }
        return reply.body === undefined
          ? new HttpResponse(null, { status, headers: reply.headers })
          : HttpResponse.json(reply.body, { status, headers: reply.headers });
      }),
    );
  }

  private validate(fn: () => unknown) {
    try {
      fn();
    } catch (error) {
      this.violations.push((error as Error).message);
    }
  }

  /** One page of `items`, with a `Link: rel="next"` header when there's more. */
  page<T>(items: T[], query: URLSearchParams): Reply {
    const perPage = Math.min(
      Number(query.get('per_page') ?? 30),
      this.pageSize,
    );
    const page = Number(query.get('page') ?? 1);
    const body = items.slice((page - 1) * perPage, page * perPage);
    const more = page * perPage < items.length;
    return {
      body,
      headers: more
        ? { Link: `<https://next.example/?page=${page + 1}>; rel="next"` }
        : {},
    };
  }

  notFound(): Reply {
    return { status: 404, body: { message: '404 Not Found' } };
  }
}
