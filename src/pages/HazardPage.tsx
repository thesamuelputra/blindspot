import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { PageWithMap } from '@/components/shell/PageWithMap';
import {
  ChipRow,
  EventRow,
  HOUR,
  PanelHeader,
  Section,
  SignalList,
  StatChip,
  Status,
  useSignals,
} from './kit';

// HAZARD: seismic, tsunami, wildfire, evacuation, plus active CAP alerts.
const KINDS = ['earthquake', 'tremor', 'tsunami', 'wildfire', 'hotspot', 'evac-order'];
const WINDOW = 72 * HOUR;

function HazardPanel() {
  const signals = useSignals(KINDS, WINDOW, 50);
  const alerts = useQuery(api.alerts.active);

  const seismic = signals?.filter((s) => ['earthquake', 'tremor', 'tsunami'].includes(s.kind));
  const fire = signals?.filter((s) => ['wildfire', 'hotspot', 'evac-order'].includes(s.kind));
  const critical = signals?.filter((s) => s.severity === 'critical').length ?? 0;

  return (
    <>
      <PanelHeader code="HAZARD" note="72H WINDOW" />
      <ChipRow>
        <StatChip
          label="ACTIVE ALERTS"
          value={alerts?.length}
          tone={alerts && alerts.length > 0 ? 'var(--warn)' : 'var(--ok)'}
        />
        <StatChip label="SEISMIC" value={seismic?.length} />
        <StatChip label="FIRE" value={fire?.length} />
        <StatChip label="CRITICAL" value={critical} tone={critical > 0 ? 'var(--critical)' : 'var(--ok)'} />
      </ChipRow>

      <Section label="ACTIVE ALERTS" count={alerts?.length}>
        {alerts === undefined ? (
          <Status text="Syncing" />
        ) : alerts.length === 0 ? (
          <Status text="No active public alerts" />
        ) : (
          alerts.map((a) => (
            <EventRow
              key={a._id}
              title={a.headline}
              at={a.effective}
              source={a.sourceSlug}
              severity={a.severity}
            />
          ))
        )}
      </Section>

      <Section label="SEISMIC AND TSUNAMI" count={seismic?.length}>
        <SignalList rows={seismic} empty="Quiet. Nothing seismic in the window" />
      </Section>

      <Section label="FIRE AND EVACUATION" count={fire?.length}>
        <SignalList rows={fire} empty="No fire signals in the window" />
      </Section>
    </>
  );
}

export function HazardPage() {
  return <PageWithMap page="hazard" side={<HazardPanel />} />;
}
