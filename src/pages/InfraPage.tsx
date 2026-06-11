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
  latestOf,
  useReadings,
  useSignals,
  type ReadingDoc,
} from './kit';

// INFRA: power outages, network health (BGP visibility + Cloudflare traffic),
// snowpack (water supply infrastructure signal).
const METRICS = ['announced_prefixes', 'cf_traffic_change', 'swe'];
const WINDOW = 48 * HOUR;

function MetricRows({
  rows,
  metric,
  empty,
}: {
  rows: ReadingDoc[] | undefined;
  metric: string;
  empty: string;
}) {
  if (rows === undefined) return <Status text="Syncing" />;
  const subset = rows.filter((r) => r.metric === metric);
  if (subset.length === 0) return <Status text={empty} />;
  return (
    <div>
      {subset.map((r) => (
        <ReadingRow key={r._id} r={r} />
      ))}
    </div>
  );
}

function InfraPanel() {
  const outages = useSignals(['outage'], WINDOW, 50);
  const readings = useReadings(METRICS, 100);

  const traffic = latestOf(readings, 'cf_traffic_change');
  const bgpCount = readings?.filter((r) => r.metric === 'announced_prefixes').length;
  const sweCount = readings?.filter((r) => r.metric === 'swe').length;

  return (
    <>
      <PanelHeader code="INFRA" note="GRID · NET · SNOW" />
      <ChipRow>
        <StatChip
          label="OUTAGES"
          value={outages?.length}
          tone={outages && outages.length > 0 ? 'var(--warn)' : 'var(--ok)'}
        />
        <StatChip
          label="NET TRAFFIC"
          value={traffic ? `${traffic.value > 0 ? '+' : ''}${Math.round(traffic.value)}%` : null}
          tone={traffic && traffic.value < -20 ? 'var(--warn)' : undefined}
        />
        <StatChip label="BGP ASNS" value={bgpCount} />
      </ChipRow>

      <Section label="POWER OUTAGES" count={outages?.length}>
        <SignalList rows={outages} empty="No outages reported" />
      </Section>

      <Section label="NETWORK · BGP ANNOUNCED PREFIXES" count={bgpCount}>
        <MetricRows rows={readings} metric="announced_prefixes" empty="No BGP readings yet" />
      </Section>

      <Section label="NETWORK · TRAFFIC CHANGE">
        <MetricRows rows={readings} metric="cf_traffic_change" empty="No traffic readings yet" />
      </Section>

      <Section label="SNOWPACK · SNOW WATER EQUIVALENT" count={sweCount}>
        <MetricRows rows={readings} metric="swe" empty="No snow readings yet" />
      </Section>
    </>
  );
}

export function InfraPage() {
  return <PageWithMap page="infrastructure" side={<InfraPanel />} />;
}
