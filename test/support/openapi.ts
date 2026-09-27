import { readFileSync } from 'node:fs';
import { Ajv, type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';
import type { Forge } from '../../src/abstract/errors.js';

// ajv-formats is CommonJS with a default export.
const addFormats =
  addFormatsModule as unknown as typeof addFormatsModule.default;

type Json = Record<string, unknown>;

export const specs: Record<Forge, Json> = {
  github: JSON.parse(readFileSync('spec/github/openapi.json', 'utf8')),
  gitlab: JSON.parse(readFileSync('spec/gitlab/openapi.json', 'utf8')),
};

/**
 * OpenAPI 3.0 schemas aren't quite JSON Schema: `nullable: true` has to become
 * a `null` type (or an anyOf when there's no `type` to extend).
 */
function toJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toJsonSchema);
  if (!node || typeof node !== 'object') return node;

  const { nullable, ...rest } = node as Json;
  const schema = Object.fromEntries(
    Object.entries(rest).map(([key, value]) => [key, toJsonSchema(value)]),
  );
  if (nullable !== true)
    return nullable === undefined ? schema : { ...schema, nullable };
  if (typeof schema.type === 'string') {
    return {
      ...schema,
      type: [schema.type, 'null'],
      ...(Array.isArray(schema.enum) && { enum: [...schema.enum, null] }),
    };
  }
  return { anyOf: [schema, { type: 'null' }] };
}

const ajv = new Ajv({ strict: false, allErrors: true, logger: false });
addFormats(ajv);
for (const [forge, spec] of Object.entries(specs)) {
  ajv.addSchema(toJsonSchema(spec) as Json, forge);
}

const cache = new Map<string, ValidateFunction | null>();

/** Point local refs (#/components/…) at the spec registered under `forge`. */
function rebase(schema: unknown, forge: Forge): unknown {
  return JSON.parse(
    JSON.stringify(schema).replaceAll('"$ref":"#/', `"$ref":"${forge}#/`),
  );
}

function operation(forge: Forge, method: string, path: string): Json {
  const item = (specs[forge].paths as Record<string, Json>)[path];
  const op = item?.[method.toLowerCase()] as Json | undefined;
  if (!op) throw new Error(`${forge}: ${method} ${path} is not in the spec`);
  return op;
}

function compile(key: string, forge: Forge, schema: unknown) {
  if (!cache.has(key)) {
    cache.set(
      key,
      schema ? ajv.compile(toJsonSchema(rebase(schema, forge)) as Json) : null,
    );
  }
  return cache.get(key)!;
}

function check(validate: ValidateFunction | null, body: unknown, what: string) {
  if (validate && !validate(body)) {
    const errors = ajv.errorsText(validate.errors, { separator: '\n  ' });
    throw new Error(
      `${what} does not match the OpenAPI description:\n  ${errors}`,
    );
  }
}

/** Throws unless `body` matches the documented response for this operation. */
export function assertResponse(
  forge: Forge,
  method: string,
  path: string,
  status: number,
  body: unknown,
) {
  const responses = operation(forge, method, path).responses as Json;
  const response = (responses[String(status)] ?? responses.default) as
    Json | undefined;
  if (!response) {
    throw new Error(`${forge}: ${method} ${path} doesn't document a ${status}`);
  }
  const schema = (response.content as Json | undefined)?.[
    'application/json'
  ] as Json | undefined;
  const key = `${forge} ${method} ${path} ${status}`;
  check(compile(key, forge, schema?.schema), body, `Response to ${key}`);
}

/** Throws unless `body` matches the documented request body for this operation. */
export function assertRequest(
  forge: Forge,
  method: string,
  path: string,
  body: unknown,
) {
  const requestBody = operation(forge, method, path).requestBody as
    Json | undefined;
  const schema = (requestBody?.content as Json | undefined)?.[
    'application/json'
  ] as Json | undefined;
  const key = `${forge} ${method} ${path} request`;
  check(compile(key, forge, schema?.schema), body, `Request body for ${key}`);
}

/** A copy of one of the spec's named examples (GitHub ships these). */
export function example<T = Json>(forge: Forge, name: string): T {
  const examples = (specs[forge].components as Json).examples as Record<
    string,
    { value: T }
  >;
  if (!examples?.[name]) throw new Error(`${forge}: no example named ${name}`);
  return structuredClone(examples[name].value);
}

/**
 * Builds a sample object for a named schema from the spec's property-level
 * `example`s, filling required properties that have none. GitLab's description
 * has no named examples, so its fakes start from these.
 */
export function sample<T = Json>(forge: Forge, schemaName: string): T {
  const schemas = (specs[forge].components as Json).schemas as Record<
    string,
    Json
  >;
  const resolve = (schema: Json): Json =>
    typeof schema.$ref === 'string'
      ? resolve(schemas[schema.$ref.split('/').pop()!])
      : schema;

  const build = (input: Json, depth: number): unknown => {
    const schema = resolve(input);
    if (schema.example !== undefined) return structuredClone(schema.example);
    if (schema.nullable) return null;
    const variant = ((schema.oneOf ?? schema.anyOf) as Json[] | undefined)?.[0];
    if (variant) return build(variant, depth);
    switch (schema.type) {
      case 'array':
        return [];
      case 'integer':
      case 'number':
        return 1;
      case 'boolean':
        return false;
      case 'string':
        return schema.format === 'date-time' ? '2026-01-01T00:00:00.000Z' : '';
    }
    if (depth > 3) return {};
    const required = new Set((schema.required as string[] | undefined) ?? []);
    const result: Json = {};
    for (const [key, prop] of Object.entries(
      (schema.properties as Record<string, Json> | undefined) ?? {},
    )) {
      if (required.has(key) || resolve(prop).example !== undefined) {
        result[key] = build(prop, depth + 1);
      }
    }
    return result;
  };

  return build({ $ref: `#/components/schemas/${schemaName}` }, 0) as T;
}
