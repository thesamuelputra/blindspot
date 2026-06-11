import { PageWithMap } from '@/components/shell/PageWithMap';
import {
  ChipRow,
  HOUR,
  Note,
  PanelHeader,
  Section,
  SignalList,
  StatChip,
  useSignals,
  useSnapshotCount,
} from './kit';

// SIGNALS (RF): GPS interference reports and radiosonde tracks. Honest about
// the gap: most BC public safety radio is encrypted, so there is no scanner
// feed and we say so instead of faking one (BRIEF §1).
const WINDOW = 48 * HOUR;

function SignalsPanel() {
  const anomalies = useSignals(['anomaly'], WINDOW, 50);
  const jam = anomalies?.filter((s) => s.sourceSlug === 'gpsjam');
  const sondes = useSnapshotCount('positions:balloon');

  return (
    <>
      <PanelHeader code="SIGNALS" note="RF PICTURE" />
      <ChipRow>
        <StatChip
          label="GPS JAM CELLS"
          value={jam?.length}
          tone={jam && jam.length > 0 ? 'var(--warn)' : 'var(--ok)'}
        />
        <StatChip label="SONDES ALOFT" value={sondes ?? 0} tone="var(--accent-live)" />
      </ChipRow>

      <Section label="GPS INTERFERENCE" count={jam?.length}>
        <SignalList rows={jam} empty="No interference reports in the window" />
      </Section>

      <Section label="RADIOSONDES">
        <Note>
          Weather balloons currently tracked over the Island and the Salish Sea appear on the map
          as the SONDES layer. Hover one for its path, click for the full track.
        </Note>
      </Section>

      <Section label="VOICE RADIO">
        <Note>
          Most BC public safety radio is encrypted, so there is no scanner feed here. BlindSpot
          only carries what exists in the open: GPS interference reports and radiosonde tracks,
          shown above.
        </Note>
      </Section>
    </>
  );
}

export function SignalsPage() {
  return <PageWithMap page="signals" side={<SignalsPanel />} />;
}
