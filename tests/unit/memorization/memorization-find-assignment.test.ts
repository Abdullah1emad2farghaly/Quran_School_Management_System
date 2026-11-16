import { describe, expect, it } from 'vitest';
import { S1, TEACHER, createMemorizationFakes, range } from '../../helpers/memorization-fakes';

const R_A = range(2, 1, 5);
const R_B = range(2, 6, 5);

describe('findAssignmentById (read-only lookup used by the Notification Rules module)', () => {
  it('returns the assignment in its CURRENT state: defined, then modified, then cancelled (the cancelled range is kept)', async () => {
    const f = createMemorizationFakes();
    const defined = await f.service.defineAssignment(S1, TEACHER.userId, { range: R_A });
    expect((await f.service.findAssignmentById(defined.id))?.range.segments).toEqual([{ surah: 2, firstAyah: 1, lastAyah: 5 }]);
    const returned = await f.service.modifyAssignment(defined.id, TEACHER.userId, { range: R_B });
    const modified = await f.service.findAssignmentById(defined.id);
    expect(modified?.range.segments).toEqual(returned.range.segments);
    expect(modified?.range.segments).not.toEqual(defined.range.segments);
    expect(modified?.status).toBe('ACTIVE');
    await f.service.cancelAssignment(defined.id, TEACHER.userId);
    const cancelled = await f.service.findAssignmentById(defined.id);
    expect(cancelled?.status).toBe('CANCELLED');
    expect(cancelled?.range.segments).toEqual(returned.range.segments);
  });
  it('is undefined for an unknown id, publishes nothing and changes nothing', async () => {
    const f = createMemorizationFakes();
    const before = f.types().length;
    expect(await f.service.findAssignmentById('00000000-0000-4000-8000-0000000000ff')).toBeUndefined();
    expect(f.types().length).toBe(before);
  });
});
