import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { PageWithMap } from '@/components/shell/PageWithMap';
import {
  ChipRow,
  HOUR,
  Note,
  PanelHeader,
  Section,
  SignalList,
  StatChip,
  fmtValue,
  latestOf,
  useReadings,
  useSignals,
  Gauge,
} from './kit';

// SPACE: solar and geomagnetic readouts as big mono gauges, space weather
// alerts, upcoming launches, and the cached satellite TLE set.
const METRICS = ['kp_index', 'solar_wind_speed', 'xray_flux'];
const WINDOW = 7 * 24 * HOUR;

function SpacePanel() {
  const readings = useReadings(METRICS, 100);
  const signals = useSignals(['space-weather', 'launch'], WINDOW, 50);
  const tle = useQuery(api.snapshots.get, { key: 'tle:stations' });

  const kp = latestOf(readings, 'kp_index');
  const wind = latestOf(readings, 'solar_wind_speed');
  const xray = latestOf(readings, 'xray_flux');

  const spaceWx = signals?.filter((s) => s.kind === 'space-weather');
  const launches = signals?.filter((s) => s.kind === 'launch');

  const kpTone =
    kp && kp.value >= 7 ? 'var(--critical)' : kp && kp.value >= 5 ? 'var(--warn)' : 'var(--ok)';

  return (
    <>
      <PanelHeader code="SPACE" note="SUN · SATS · LAUNCH" />
      <ChipRow>
        <Gauge label="KP INDEX" value={kp ? fmtValue(kp.value) : null} at={kp?.at} tone={kpTone} />
        <Gauge
          label="SOLAR WIND"
          value={wind ? fmtValue(wind.value) : null}
          unit={wind?.unit}
          at={wind?.at}
        />
      </ChipRow>
      <ChipRow>
        <Gauge
          label="XRAY FLUX"
          value={xray ? fmtValue(xray.value) : null}
          unit={xray?.unit}
          at={xray?.at}
        />
        <StatChip label="LAUNCHES" value={launches?.length} />
      </ChipRow>

      <Section label="SPACE WEATHER" count={spaceWx?.length}>
        <SignalList rows={spaceWx} empty="No space weather alerts in the window" />
      </Section>

      <Section label="LAUNCHES" count={launches?.length}>
        <SignalList rows={launches} empty="No launches tracked in the window" />
      </Section>

      <Section label="ISS AND SATELLITES">
        <Note>
          {tle
            ? 'TLE set cached, pass prediction lands with the globe'
            : 'Waiting on the first TLE sync from CelesTrak'}
        </Note>
      </Section>
    </>
  );
}

export function SpacePage() {
  return <PageWithMap page="space" side={<SpacePanel />} />;
}
