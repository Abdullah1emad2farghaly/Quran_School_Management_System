import { SystemClock } from '../modules/00-shared-kernel/public';
import { GroupScheduleService, SequelizeScheduleRepository, registerScheduleAuthorization } from '../modules/23-group-schedules/public';
import { getAuthorizationPolicyRegistry } from './authorization';
import { getSequelize, getUnitOfWork } from './database';
import { getGroupService } from './groups';
import { getOutboxService } from './outbox';
import { getTeacherService } from './teachers';

let service: GroupScheduleService | undefined;

/**
 * Module 23: the group schedule. It is also the implementation of Module 20's `GroupSchedulePort` (a Teacher change is validated against the group's
 * slots, an archive retires them): `groups.ts` reaches it lazily, and this file reaches Module 20 only inside functions (the config files reference each
 * other only inside functions, never at import time).
 */
export function getGroupScheduleService(): GroupScheduleService {
  if (!service) {
    service = new GroupScheduleService({
      slots: new SequelizeScheduleRepository(getSequelize()),
      groups: getGroupService(),
      teachers: getTeacherService(),
      unitOfWork: getUnitOfWork(),
      outbox: getOutboxService(),
      clock: new SystemClock(),
    });
  }
  return service;
}

/** The schedule permissions are registered ONCE, when this module is loaded, through the shared Authorization Engine (the scope resolver is Module 20's). */
registerScheduleAuthorization({ policies: getAuthorizationPolicyRegistry() });
