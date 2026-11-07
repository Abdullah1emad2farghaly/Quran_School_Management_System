/** The pass the scheduler runs (implemented by `ExamService.runCycle`). */
export interface ExamLifecycleJob {
  runCycle(): Promise<{ started: number; completed: number; failed: number }>;
}

export interface ExamSchedulerOptions {
  readonly job: ExamLifecycleJob;
  /** How often the due exams are looked for. Default 15 seconds. */
  readonly intervalMs?: number;
  readonly onError?: (error: unknown) => void;
}

/**
 * In-process lifecycle runner of exams (SCHEDULED -> STARTED at the start time, STARTED -> COMPLETED at the end time), the same pattern as the class-session scheduler: a timer that
 * calls the idempotent pass `ExamService.runCycle`. Because every pass works from the STORED times, nothing is lost when the server restarts or a pass is late: the next pass
 * catches up (and `ExamService.advanceExam` also advances one exam on demand). A pass never overlaps the previous one, and an error never stops the timer.
 */
export class ExamScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private readonly intervalMs: number;

  constructor(private readonly options: ExamSchedulerOptions) {
    this.intervalMs = options.intervalMs ?? 15_000;
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass now. Returns false when a pass was already running (nothing is started twice). */
  async tick(): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      await this.options.job.runCycle();
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.running = false;
    }
    return true;
  }
}
