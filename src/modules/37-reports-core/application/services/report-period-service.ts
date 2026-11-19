import { SystemClock, type Clock } from '../../../00-shared-kernel/public';
import { resolveReportPeriod } from '../../domain/services/report-period-resolver';
import { studentReportWindow, type StudentReportWindow } from '../../domain/services/student-report-window';
import type { ReportPeriodRequest, ResolvedReportPeriod } from '../../domain/value-objects/report-period';

export interface ReportPeriodServiceDeps {
  readonly clock?: Clock;
}

/**
 * What the report modules (Module 38) use to interpret a requested period: the period rules (§66) and the student effective start (§67) in ONE place, so no report re-implements them.
 * It reads no data and authorizes nothing: WHICH data a caller may see is decided by the reporting scope of the Authorization Engine in the report that uses it.
 */
export class ReportPeriodService {
  private readonly clock: Clock;

  constructor(deps: ReportPeriodServiceDeps = {}) {
    this.clock = deps.clock ?? new SystemClock();
  }

  resolvePeriod(request: ReportPeriodRequest): ResolvedReportPeriod {
    return resolveReportPeriod(request, this.clock.now());
  }

  /** The window of `period` that may contain a student's data, given the student's join date (`YYYY-MM-DD`). */
  studentWindow(period: ResolvedReportPeriod, joinDate: string): StudentReportWindow {
    return studentReportWindow(period, joinDate);
  }
}
