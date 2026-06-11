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

// PULSE: local news and civic advisories. List first; the map stays for
// consistency and for the few geocoded stories that can fly to a spot.
const KINDS = ['news', 'civic'];
const WINDOW = 48 * HOUR;

function PulsePanel() {
  const signals = useSignals(KINDS, WINDOW, 50);
  const dayAgo = Date.now() - 24 * HOUR;

  const news24 = signals?.filter((s) => s.kind === 'news' && s.observedAt >= dayAgo).length;
  const civic = signals?.filter((s) => s.kind === 'civic').length;

  return (
    <>
      <PanelHeader code="PULSE" note="48H WINDOW" />
      <ChipRow>
        <StatChip label="NEWS 24H" value={news24} />
        <StatChip label="CIVIC" value={civic} />
        <StatChip label="TOTAL" value={signals?.length} />
      </ChipRow>

      <Section label="LIVE FEED" count={signals?.length}>
        <SignalList rows={signals} empty="Nothing on the wire in the window" />
      </Section>
    </>
  );
}

export function PulsePage() {
  return <PageWithMap page="pulse" side={<PulsePanel />} />;
}
