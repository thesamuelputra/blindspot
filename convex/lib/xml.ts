import { XMLParser } from 'fast-xml-parser';

// Shared XML/CAP/RSS parser (ARCHITECTURE §5.8) — every XML feed goes through
// this; no per-module parser choices. Pure JS, default Convex runtime.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseXml(xml: string): any {
  return parser.parse(xml);
}

// Coerce fast-xml-parser's single-item collapse back to an array.
export function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}
