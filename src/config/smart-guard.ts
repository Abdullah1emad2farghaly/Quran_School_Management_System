import { SystemClock } from '../modules/00-shared-kernel/public';
import { SmartGuard } from '../modules/25-smart-guard/public';
import { getClassSessionService } from './class-sessions';
import { logger } from './logger';
import { getSchoolService } from './schools';

let guard: SmartGuard | undefined;

/** Module 25: the reusable Smart Guard that the protected Teacher actions of Modules 26-30 will call. It has no endpoint, no storage and no permission of its own. */
export function getSmartGuard(): SmartGuard {
  if (!guard) {
    guard = new SmartGuard({ sessions: getClassSessionService(), schools: getSchoolService(), clock: new SystemClock(), logger: logger.child({ module: 'smart-guard' }) });
  }
  return guard;
}
