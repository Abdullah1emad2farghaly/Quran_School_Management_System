import type { User } from '../../domain/entities/user';
import type { UserStatus } from '../../domain/value-objects/user-status';

/** Public view of a user. It never contains the password hash. */
export interface UserDto {
  readonly id: string;
  readonly phone: string;
  readonly status: UserStatus;
  readonly isActive: boolean;
  readonly statusChangedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    phone: user.phone,
    status: user.status,
    isActive: user.isActive,
    statusChangedAt: user.statusChangedAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
