import { readFileSync } from 'node:fs';
import addFormatsModule from 'ajv-formats';
import { OpenAPIBackend } from 'openapi-backend';
import { sample as openapiSample } from 'openapi-sampler';
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
 * OpenAPI 3.0's `nullable` as JSON Schema null types, which Ajv understands.
 * Custom because no library converts it correctly when there's no `type`
 * beside it (GitHub puts it next to `allOf` and `oneOf`). openapi-format's
 * 3.1 conversion drops it on `allOf` (thim81/openapi-format#239),
 * @openapi-contrib/openapi-schema-to-json-schema drops it on both, and
 * @scalar/openapi-upgrader drops it on `oneOf`.
 */
function convertNullable(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(convertNullable);
  if (!node || typeof node !== 'object') return node;

  const { nullable, ...rest } = node as Json;
  // Only the boolean keyword; a property *named* nullable is a schema object.
  const keyword = typeof nullable === 'boolean';
  const schema = Object.fromEntries(
    Object.entries(keyword ? rest : (node as Json)).map(([key, value]) => [
      key,
      convertNullable(value),
    ]),
  );
  if (nullable !== true) return schema;
  if (typeof schema.type === 'string') {
    return {
      ...schema,
      type: [schema.type, 'null'],
      ...(Array.isArray(schema.enum) && { enum: [...schema.enum, null] }),
    };
  }
  return { anyOf: [schema, { type: 'null' }] };
}

/**
 * Validators from openapi-backend. The document keeps its 3.0 label, which
 * openapi-backend needs, and `quick` skips checking the converted document
 * itself.
 */
async function validator(spec: Json) {
  const data = convertNullable(spec) as Json;
  const api = new OpenAPIBackend({
    definition: { ...data, openapi: spec.openapi } as never,
    quick: true,
    validate: true,
    ajvOpts: { strict: false, allErrors: true },
    customizeAjv: (ajv) => {
      addFormats(ajv);
      return ajv;
    },
  });
  await api.init();
  return api;
}

const validators = {
  github: await validator(specs.github),
  gitlab: await validator(specs.gitlab),
};

function operationId(forge: Forge, method: string, path: string): string {
  const item = (specs[forge].paths as Record<string, Json>)[path];
  const op = item?.[method.toLowerCase()] as
    { operationId?: string } | undefined;
  if (!op?.operationId)
    throw new Error(`${forge}: ${method} ${path} is not in the spec`);
  return op.operationId;
}

function check(
  result: {
    valid: boolean;
    errors?: { instancePath: string; message?: string }[] | null;
  },
  what: string,
) {
  if (!result.valid) {
    const errors = (result.errors ?? [])
      .map((e) => `${e.instancePath || '(root)'} ${e.message}`)
      .join('\n  ');
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
  const id = operationId(forge, method, path);
  check(
    validators[forge].validateResponse(body, id, status),
    `Response to ${forge} ${method} ${path} ${status}`,
  );
}

/** Throws unless the request (path, query and body) matches the operation. */
export function assertRequest(
  forge: Forge,
  method: string,
  path: string,
  request: { url: URL; headers: Headers; body: unknown },
) {
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(request.url.searchParams.keys())) {
    const values = request.url.searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0];
  }
  check(
    validators[forge].validateRequest(
      {
        method,
        path: request.url.pathname,
        query,
        headers: Object.fromEntries(request.headers),
        body: request.body,
      },
      operationId(forge, method, path),
    ),
    `Request for ${forge} ${method} ${path}`,
  );
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
 * A sample object for a named schema, from openapi-sampler: required
 * properties, using the description's examples where it has them. GitLab's
 * description has no named examples, so its fakes start from these.
 */
export function sample<T = Json>(forge: Forge, schemaName: string): T {
  return openapiSample(
    { $ref: `#/components/schemas/${schemaName}` },
    { skipNonRequired: true, skipReadOnly: false },
    specs[forge],
  ) as T;
}
