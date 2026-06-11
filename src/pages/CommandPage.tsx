import { MapView } from '@/map/MapView';
import { StatTiles } from '@/components/command/StatTiles';
import { Ticker } from '@/components/command/Ticker';
import { IntsumCard } from '@/components/command/IntsumCard';

// COMMAND — the master map plus its overlays (BRIEF §4 page 1).
export function CommandPage() {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <MapView page="command" />
      <StatTiles />
      <IntsumCard />
      <Ticker />
    </div>
  );
}
