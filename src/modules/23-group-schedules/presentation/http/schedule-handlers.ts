import type { GroupScheduleService } from '../../application/services/group-schedule-service';
import { serializeOwnItem, serializeSlot } from './schedule-serializer';

export type ScheduleHandlerService = Pick<GroupScheduleService, 'addSlot' | 'changeSlot' | 'removeSlot' | 'listSlots' | 'listHistory' | 'listOwnSchedule'>;

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (typeof value === 'object' && value !== null ? (value as Json) : {});

/**
 * Framework-free handlers behind the schedule routes: they map an already validated request to the application service and the response data. The actor /
 * user id always comes from the verified token, never from the body; the weekday and the times are validated by the domain (SCHEDULE_* codes).
 */
export function createScheduleHandlers(getService: () => ScheduleHandlerService) {
  return {
    addSlot: async (groupId: string, actorId: string, body: unknown) => {
      const b = obj(body);
      return serializeSlot(await getService().addSlot(groupId, { dayOfWeek: b.dayOfWeek, startTime: b.startTime, endTime: b.endTime }, actorId));
    },
    changeSlot: async (groupId: string, slotId: string, actorId: string, body: unknown) => {
      const b = obj(body);
      const change = { ...(b.dayOfWeek !== undefined ? { dayOfWeek: b.dayOfWeek } : {}), ...(b.startTime !== undefined ? { startTime: b.startTime } : {}), ...(b.endTime !== undefined ? { endTime: b.endTime } : {}) };
      return serializeSlot(await getService().changeSlot(groupId, slotId, change, actorId));
    },
    removeSlot: (groupId: string, slotId: string, actorId: string) => getService().removeSlot(groupId, slotId, actorId),
    listSlots: async (groupId: string) => (await getService().listSlots(groupId)).map(serializeSlot),
    listHistory: async (groupId: string) => (await getService().listHistory(groupId)).map(serializeSlot),
    listOwn: async (userId: string) => (await getService().listOwnSchedule(userId)).map(serializeOwnItem),
  };
}
