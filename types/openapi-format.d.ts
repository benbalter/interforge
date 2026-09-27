declare module 'openapi-format' {
  type Doc = Record<string, unknown>;
  interface Result {
    data: Doc;
    resultData: {
      unusedActions?: unknown[];
      totalUnusedActions?: number;
    };
  }
  export function parseFile(pathOrUrl: string): Promise<Doc>;
  export function openapiOverlay(
    doc: Doc,
    options: { overlaySet: Doc },
  ): Promise<Result>;
  export function openapiFilter(
    doc: Doc,
    options: { filterSet: Record<string, unknown> },
  ): Promise<Result>;
}
