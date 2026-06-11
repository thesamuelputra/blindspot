import { PageWithMap } from '@/components/shell/PageWithMap';
import {
  ChipRow,
  HOUR,
  PanelHeader,
  Section,
  SignalList,
  StatChip,
  useSignals,
  useSnapshotCount,
} from './kit';

// SKIES & SEAS: live air and marine picture plus marine notices and vessel
// events. Mover counts come from the positions snapshots (never raw entity
// scans, ARCHITECTURE §10).
const KINDS = ['vessel-event', 'marine-notice'];
const WINDOW = 48 * HOUR;

function SkiesSeasPanel() {
  const signals = useSignals(KINDS, WINDOW, 50);
  const aircraft = useSnapshotCount('positions:aircraft');
  const vessels = useSnapshotCount('positions:vessel');
  const ferries = useSnapshotCount('positions:ferry');

  const vesselEvents = signals?.filter((s) => s.kind === 'vessel-event');
  const notices = signals?.filter((s) => s.kind === 'marine-notice');

  return (
    <>
      <PanelHeader code="SKIES &amp; SEAS" note="LIVE PICTURE" />
      <ChipRow>
        <StatChip label="AIRCRAFT" value={aircraft ?? 0} tone="var(--accent-live)" />
        <StatChip label="VESSELS" value={vessels ?? 0} tone="var(--accent-live)" />
        <StatChip label="FERRIES" value={ferries ?? 0} tone="var(--accent-live)" />
      </ChipRow>

      <Section label="VESSEL EVENTS" count={vesselEvents?.length}>
        <SignalList rows={vesselEvents} empty="No vessel events in the window" />
      </Section>

      <Section label="MARINE NOTICES" count={notices?.length}>
        <SignalList rows={notices} empty="No marine notices in the window" />
      </Section>
    </>
  );
}

export function SkiesSeasPage() {
  return <PageWithMap page="skies-seas" side={<SkiesSeasPanel />} />;
}
