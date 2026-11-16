import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfig } from '../../../src/modules/01-configuration/public';

function issuesOf(source: Record<string, string>): readonly string[] {
  try {
    loadConfig(source);
  } catch (e) {
    if (e instanceof ConfigurationError) return e.issues;
    throw e;
  }
  return [];
}

describe('real-time (Socket.IO) configuration', () => {
  it('is on by default with portable defaults and no hosting-specific value', () => {
    expect(loadConfig({}).realtime).toEqual({ enabled: true, path: '/socket.io', pingIntervalMs: 25000, pingTimeoutMs: 20000, maxConnectionsPerUser: 20 });
  });

  it('can be switched off and tuned', () => {
    const c = loadConfig({ SOCKET_IO_ENABLED: 'false', SOCKET_IO_PATH: '/realtime/', SOCKET_IO_PING_INTERVAL_MS: '10000', SOCKET_IO_PING_TIMEOUT_MS: '5000', SOCKET_IO_MAX_CONNECTIONS_PER_USER: '5' });
    expect(c.realtime).toEqual({ enabled: false, path: '/realtime', pingIntervalMs: 10000, pingTimeoutMs: 5000, maxConnectionsPerUser: 5 });
  });

  it('rejects invalid values with a clear message', () => {
    expect(issuesOf({ SOCKET_IO_ENABLED: 'yes' })).toEqual(['SOCKET_IO_ENABLED: must be "true" or "false"']);
    expect(issuesOf({ SOCKET_IO_PATH: 'socket.io' })).toHaveLength(1);
    expect(issuesOf({ SOCKET_IO_PATH: '/api/v1/socket' })).toHaveLength(1);
    expect(issuesOf({ SOCKET_IO_MAX_CONNECTIONS_PER_USER: '0' })).toEqual(['SOCKET_IO_MAX_CONNECTIONS_PER_USER: must be between 1 and 200']);
  });
});
