import { HttpResponse, type HttpHandler } from 'msw';
import { createOpenApiHttp } from 'openapi-msw';
import type { Forge } from '../../src/abstract/errors.js';
import { assertRequest, assertResponse } from './openapi.js';

export type Json = Record<string, unknown>;

type Method = 'get' | 'put' | 'post' | 'patch' | 'delete';

/**
 * `METHOD /path` for every operation in a generated `paths` type, so a route
 * the description doesn't have fails to compile.
 */
export type Operation<Paths> = {
  [P in keyof Paths & string]: {
    [M in keyof Paths[P] & Method]: [Paths[P][M]] extends [undefined]
      ? never
      : `${Uppercase<M>} ${P}`;
  }[keyof Paths[P] & Method];
}[keyof Paths & string];

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
 * Shared plumbing for the fake forges: registers `METHOD /path/{param}` routes
 * as msw handlers through openapi-msw (typed by the forge's generated
 * `paths`), and checks every request and response against the forge's
 * OpenAPI description. Mismatches are collected in `violations`, which tests
 * assert is empty. Bodies are checked at runtime rather than typed, since
 * fakes build them from spec examples.
 */
/** Any forge's fake, for code that doesn't register routes. */
export type AnyFakeForge = Omit<FakeForge, 'route'>;

export class FakeForge<Paths extends object = object> {
  readonly handlers: HttpHandler[] = [];
  readonly violations: string[] = [];
  /** Items per page on list endpoints, to exercise pagination. */
  pageSize = 100;
  /** Replies served (in order) before the real handlers, e.g. rate limits. */
  readonly interruptions: Reply[] = [];
  /** Sent as rate limit headers on every response, in the forge's style. */
  rateLimit?: { limit: number; remaining: number; reset: number };
  /** How many requests reached the fake. */
  requests = 0;
  /** Tree listings use page numbers, like GitLab before keyset pagination. */
  legacyTreePagination = false;
  /** Every request URL, in order. */
  readonly urls: URL[] = [];
  /** Requests other than GET, i.e. writes. */
  writes = 0;

  // Stored loosely so FakeForge<paths> fits wherever any FakeForge does.
  private http: Record<Method, unknown>;

  constructor(
    readonly forge: Forge,
    readonly baseUrl: string,
  ) {
    this.http = createOpenApiHttp<Paths>({ baseUrl }) as unknown as Record<
      Method,
      unknown
    >;
  }

  route(operation: Operation<Paths>, resolve: (ctx: RouteContext) => Reply) {
    const [method, path] = operation.split(' ');
    const verb = method.toLowerCase() as Method;
    // Typing is enforced by Operation<Paths>; openapi-msw's per-path resolver
    // types can't follow a runtime method name.
    const register = this.http[verb] as unknown as (
      path: string,
      resolver: (info: {
        request: Request;
        params: Record<string, unknown>;
      }) => unknown,
    ) => HttpHandler;

    this.handlers.push(
      register(path, async ({ request, params }) => {
        this.requests++;
        this.urls.push(new URL(request.url));
        if (request.method !== 'GET') this.writes++;
        const headers = new Headers(this.rateLimitHeaders());
        const interruption = this.interruptions.shift();
        if (interruption) {
          new Headers(interruption.headers).forEach((v, k) =>
            headers.set(k, v),
          );
          return HttpResponse.json(interruption.body ?? {}, {
            status: interruption.status,
            headers,
          });
        }

        const text = await request.text();
        const body = text ? (JSON.parse(text) as Json) : undefined;
        this.validate(() =>
          assertRequest(this.forge, method, path, {
            url: new URL(request.url),
            headers: request.headers,
            body,
          }),
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
        new Headers(reply.headers).forEach((v, k) => headers.set(k, v));
        if (status < 300 && reply.body !== undefined) {
          this.validate(() =>
            assertResponse(this.forge, method, path, status, reply.body),
          );
        }
        if (reply.text !== undefined) {
          return new HttpResponse(reply.text, {
            status,
            headers,
          });
        }
        return reply.body === undefined
          ? new HttpResponse(null, { status, headers })
          : HttpResponse.json(reply.body, { status, headers });
      }),
    );
  }

  private rateLimitHeaders(): Record<string, string> {
    if (!this.rateLimit) return {};
    const prefix = this.forge === 'github' ? 'x-ratelimit' : 'ratelimit';
    return Object.fromEntries(
      Object.entries(this.rateLimit).map(([k, v]) => [
        `${prefix}-${k}`,
        String(v),
      ]),
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
