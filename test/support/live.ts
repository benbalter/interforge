import { readFileSync } from 'node:fs';
import type { Forge } from '../../src/abstract/errors.js';
import { assertResponse } from './openapi.js';

/**
 * A fetch for live tests that checks every JSON response against the forge's
 * OpenAPI description. Mismatches are collected rather than thrown, so a run
 * reports how far the description is from real traffic.
 */
export function specCheckingFetch(forge: Forge) {
  const config = JSON.parse(
    readFileSync(`spec/${forge}/config.json`, 'utf8'),
  ) as {
    operations: string[];
  };
  const operations = config.operations.map((op) => {
    const [method, path] = op.split(' ');
    const pattern = new RegExp(`^${path.replace(/\{\w+\}/g, '[^/]+')}$`);
    return { method, path, pattern };
  });

  const violations: string[] = [];
  const unmatched: string[] = [];

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const response = await globalThis.fetch(request);
    const url = new URL(request.url);
    // GitHub Enterprise and GitLab prefixes aside, paths match the description.
    const path = url.pathname.replace(/^\/api\/v3/, '');
    const operation = operations.find(
      (op) => op.method === request.method && op.pattern.test(path),
    );
    const isJson = response.headers.get('content-type')?.includes('json');
    if (!operation) {
      unmatched.push(`${request.method} ${path}`);
    } else if (response.ok && isJson && response.status !== 204) {
      try {
        assertResponse(
          forge,
          operation.method,
          operation.path,
          response.status,
          await response.clone().json(),
        );
      } catch (error) {
        violations.push((error as Error).message);
      }
    }
    return response;
  };

  return { fetch, violations, unmatched };
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} to run live tests`);
  return value;
}
