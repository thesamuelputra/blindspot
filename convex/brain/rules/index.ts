import type { RuleImpl } from '../types';
import { squawkEmergency } from './squawkEmergency';
import { tsunamiCorrelation } from './tsunamiCorrelation';
import { smokeEta } from './smokeEta';
import { sanctionsMatch } from './sanctionsMatch';
import { aisGapSensitive } from './aisGapSensitive';

// Fusion rule registry (ARCHITECTURE §7.1): implementations in code, config
// (enable/severity/params) in the rules table. sanctions-match reads its
// MMSI list from the rules row params — the future opensanctions module
// maintains that row; the rule no-ops while the list is empty.
export const RULE_IMPLS: Record<string, RuleImpl> = {
  'squawk-emergency': squawkEmergency,
  'tsunami-correlation': tsunamiCorrelation,
  'smoke-eta': smokeEta,
  'sanctions-match': sanctionsMatch,
  'ais-gap-sensitive': aisGapSensitive,
};
