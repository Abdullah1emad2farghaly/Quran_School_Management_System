import { SystemClock } from '../modules/00-shared-kernel/public';
import {
  BcryptPasswordHasher,
  IdentityService,
  SequelizeUserRepository,
} from '../modules/08-identity-core/public';
import { getSequelize, getUnitOfWork } from './database';
import { getOutboxService } from './outbox';

let service: IdentityService | undefined;

/** Inject into other modules' use cases (never construct IdentityService elsewhere). */
export function getIdentityService(): IdentityService {
  if (!service) {
    service = new IdentityService({
      repository: new SequelizeUserRepository(getSequelize()),
      hasher: new BcryptPasswordHasher(),
      unitOfWork: getUnitOfWork(),
      outbox: getOutboxService(),
      clock: new SystemClock(),
    });
  }
  return service;
}
