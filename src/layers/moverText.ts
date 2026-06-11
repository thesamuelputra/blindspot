import { TextLayer } from '@deck.gl/layers';
import type { SnapshotMover } from './defs/aircraft';

// Shared marker-identity labels (Samuel's contract: a marker tells you what
// the thing IS). Mono tags pinned under the icon, dark backing for contrast.

export function buildMoverLabels<T extends SnapshotMover>(
  id: string,
  data: T[],
  opts: {
    getText: (d: T) => string | undefined;
    getColor: (d: T) => [number, number, number, number];
    size?: number;
    offsetY?: number;
  },
): TextLayer<T>[] {
  const rows = data.filter((d) => !!opts.getText(d));
  if (rows.length === 0) return [];
  return [
    new TextLayer<T>({
      id,
      data: rows,
      getPosition: (d) => [d.lng, d.lat],
      getText: (d) => opts.getText(d)!,
      getSize: opts.size ?? 10,
      getColor: opts.getColor,
      getPixelOffset: [0, opts.offsetY ?? 14],
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'top',
      fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace',
      fontWeight: 700,
      background: true,
      getBackgroundColor: [10, 12, 16, 200],
      backgroundPadding: [3, 1, 3, 1],
    }),
  ];
}

// Deterministic per-tag color (bus routes): djb2 hash into a 12-hue palette
// chosen to stay readable on the dark basemap.
const TAG_PALETTE: Array<[number, number, number, number]> = [
  [56, 189, 248, 230], // cyan
  [52, 211, 153, 230], // green
  [245, 158, 11, 230], // amber
  [167, 139, 250, 230], // violet
  [244, 114, 182, 230], // pink
  [251, 146, 60, 230], // orange
  [74, 222, 128, 230], // lime-green
  [96, 165, 250, 230], // blue
  [232, 121, 249, 230], // fuchsia
  [251, 191, 36, 230], // gold
  [45, 212, 191, 230], // teal
  [248, 113, 113, 230], // soft red
];

export function tagColor(tag: string | undefined): [number, number, number, number] {
  if (!tag) return [154, 164, 178, 200];
  let h = 5381;
  for (let i = 0; i < tag.length; i++) h = ((h << 5) + h + tag.charCodeAt(i)) | 0;
  return TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length];
}

// AIS ship-type category → semantic color (vessels read by type at a glance).
export const VESSEL_CAT_COLOR: Record<string, [number, number, number, number]> = {
  cargo: [245, 158, 11, 230],
  tanker: [248, 113, 113, 235],
  passenger: [52, 211, 153, 230],
  tug: [56, 189, 248, 230],
  fishing: [167, 139, 250, 230],
  pleasure: [154, 164, 178, 200],
  military: [245, 158, 11, 255],
  vessel: [230, 234, 240, 220],
};
