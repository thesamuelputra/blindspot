import type { RuleImpl } from '../types';
import { squawkEmergency } from './squawkEmergency';

// Fusion rule registry (ARCHITECTURE §7.1): implementations in code, config
// (enable/severity/params) in the rules table. Phase 4 wave adds:
// tsunami-correlation, smoke-eta, sanctions-match, ais-gap-sensitive.
export const RULE_IMPLS: Record<string, RuleImpl> = {
  'squawk-emergency': squawkEmergency,
};
