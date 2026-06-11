import { PageWithMap } from '@/components/shell/PageWithMap';
import {
  ChipRow,
  HOUR,
  PanelHeader,
  ReadingRow,
  Section,
  SignalList,
  StatChip,
  Status,
  fmtValue,
  useReadings,
  useSignals,
  type ReadingDoc,
} from './kit';

// ENVIRO: latest station readings grouped by metric, plus fishery closures.
const METRICS = ['aqhi', 'water_level', 'sst', 'drought_level', 'air_temp'];
const MAX_ROWS = 12;

interface Group {
  metric: string;
  label: string;
  // worst-first for risk scales, freshest-first for plain observations
  byValue: boolean;
  tone?: (v: number) => string | undefined;
}

const GROUPS: Group[] = [
  {
    metric: 'aqhi',
    label: 'AIR QUALITY · AQHI',
    byValue: true,
    tone: (v) => (v >= 7 ? 'var(--critical)' : v >= 4 ? 'var(--warn)' : undefined),
  },
  {
    metric: 'drought_level',
    label: 'DROUGHT LEVEL',
    byValue: true,
    tone: (v) => (v >= 4 ? 'var(--critical)' : v >= 3 ? 'var(--warn)' : undefined),
  },
  { metric: 'water_level', label: 'WATER LEVEL', byValue: false },
  { metric: 'sst', label: 'SEA SURFACE TEMP', byValue: false },
  { metric: 'air_temp', label: 'AIR TEMP', byValue: false },
];

function GroupRows({ rows, group }: { rows: ReadingDoc[] | undefined; group: Group }) {
  if (rows === undefined) return <Status text="Syncing" />;
  const subset = rows
    .filter((r) => r.metric === group.metric)
    .sort((a, b) => (group.byValue ? b.value - a.value : b.at - a.at))
    .slice(0, MAX_ROWS);
  if (subset.length === 0) return <Status text="No readings yet" />;
  return (
    <div>
      {subset.map((r) => (
        <ReadingRow key={r._id} r={r} tone={group.tone?.(r.value)} />
      ))}
    </div>
  );
}

function maxOf(rows: ReadingDoc[] | undefined, metric: string): number | null {
  if (!rows) return null;
  let max: number | null = null;
  for (const r of rows) if (r.metric === metric && (max === null || r.value > max)) max = r.value;
  return max;
}

function EnviroPanel() {
  const readings = useReadings(METRICS, 100);
  const closures = useSignals(['closure-fishery'], 7 * 24 * HOUR, 50);

  const aqhiMax = maxOf(readings, 'aqhi');
  const droughtMax = maxOf(readings, 'drought_level');

  return (
    <>
      <PanelHeader code="ENVIRO" note="LATEST READINGS" />
      <ChipRow>
        <StatChip
          label="AQHI MAX"
          value={aqhiMax === null ? null : fmtValue(aqhiMax)}
          tone={aqhiMax !== null && aqhiMax >= 7 ? 'var(--critical)' : aqhiMax !== null && aqhiMax >= 4 ? 'var(--warn)' : 'var(--ok)'}
        />
        <StatChip
          label="DROUGHT MAX"
          value={droughtMax === null ? null : fmtValue(droughtMax)}
          tone={droughtMax !== null && droughtMax >= 4 ? 'var(--critical)' : droughtMax !== null && droughtMax >= 3 ? 'var(--warn)' : 'var(--ok)'}
        />
        <StatChip label="CLOSURES" value={closures?.length} />
      </ChipRow>

      {GROUPS.map((g) => (
        <Section
          key={g.metric}
          label={g.label}
          count={readings?.filter((r) => r.metric === g.metric).length}
        >
          <GroupRows rows={readings} group={g} />
        </Section>
      ))}

      <Section label="FISHERY CLOSURES · 7D" count={closures?.length}>
        <SignalList rows={closures} empty="No closure notices in the window" />
      </Section>
    </>
  );
}

export function EnviroPage() {
  return <PageWithMap page="environment" side={<EnviroPanel />} />;
}
