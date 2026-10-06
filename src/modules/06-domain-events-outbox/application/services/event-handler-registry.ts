import type { EventHandler } from '../ports/event-handler';

export class EventHandlerRegistry {
  private readonly handlers = new Map<string, EventHandler>();

  register(handler: EventHandler): void {
    if (!handler.name || handler.name.trim() === '') throw new Error('Event handler requires a name');
    if (handler.eventTypes.length === 0) throw new Error(`Event handler "${handler.name}" subscribes to no events`);
    if (this.handlers.has(handler.name)) throw new Error(`Duplicate event handler "${handler.name}"`);
    this.handlers.set(handler.name, handler);
  }

  /** Handlers for an event type, in registration order (includes "*" subscribers). */
  handlersFor(eventType: string): EventHandler[] {
    return [...this.handlers.values()].filter(
      (h) => h.eventTypes.includes(eventType) || h.eventTypes.includes('*'),
    );
  }

  names(): string[] {
    return [...this.handlers.keys()];
  }
}
