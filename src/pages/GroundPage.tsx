import { PageWithMap } from '@/components/shell/PageWithMap';
import {
  ChipRow,
  HOUR,
  PanelHeader,
  Section,
  SignalList,
  StatChip,
  useSignals,
} from './kit';

// GROUND: DriveBC road events, power outages, transit service alerts.
const KINDS = ['road-event', 'outage', 'transit-alert'];
const WINDOW = 48 * HOUR;

function GroundPanel() {
  const signals = useSignals(KINDS, WINDOW, 50);

  const roads = signals?.filter((s) => s.kind === 'road-event');
  const outages = signals?.filter((s) => s.kind === 'outage');
  const transit = signals?.filter((s) => s.kind === 'transit-alert');

  return (
    <>
      <PanelHeader code="GROUND" note="48H WINDOW" />
      <ChipRow>
        <StatChip label="ROAD EVENTS" value={roads?.length} />
        <StatChip
          label="OUTAGES"
          value={outages?.length}
          tone={outages && outages.length > 0 ? 'var(--warn)' : 'var(--ok)'}
        />
        <StatChip label="TRANSIT" value={transit?.length} />
      </ChipRow>

      <Section label="ROADS" count={roads?.length}>
        <SignalList rows={roads} empty="No road events in the window" />
      </Section>

      <Section label="POWER" count={outages?.length}>
        <SignalList rows={outages} empty="No outages reported" />
      </Section>

      <Section label="TRANSIT" count={transit?.length}>
        <SignalList rows={transit} empty="No service alerts in the window" />
      </Section>
    </>
  );
}

export function GroundPage() {
  return <PageWithMap page="ground" side={<GroundPanel />} />;
}
