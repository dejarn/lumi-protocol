import { describe, expect, it } from 'vitest';
import { DeviceRegistry } from './registry';

const ANNOUNCE = {
  deviceType: 1,
  capabilities: 0xff,
  protoVersion: 1,
  zoneId: 0,
  name: 'strip-1',
};

const DEVICE_ID = 0x0001;

describe('DeviceRegistry — reachability', () => {
  it('setReachable before upsert applies pending on first upsert', () => {
    const registry = new DeviceRegistry();
    registry.setReachable(DEVICE_ID, false);
    const device = registry.upsert(DEVICE_ID, ANNOUNCE);
    expect(device.reachable).toBe(false);
  });

  it('upsert preserves existing reachable when no pending', () => {
    const registry = new DeviceRegistry();
    registry.upsert(DEVICE_ID, ANNOUNCE);
    registry.setReachable(DEVICE_ID, false);
    const device = registry.upsert(DEVICE_ID, { ...ANNOUNCE, name: 'strip-2' });
    expect(device.reachable).toBe(false);
    expect(device.name).toBe('strip-2');
  });

  it('pending reachability is consumed after upsert', () => {
    const registry = new DeviceRegistry();
    registry.setReachable(DEVICE_ID, false);
    registry.upsert(DEVICE_ID, ANNOUNCE);
    const device = registry.upsert(DEVICE_ID, { ...ANNOUNCE, name: 'strip-2' });
    expect(device.reachable).toBe(false);
  });

  it('defaults reachable to true on first upsert without pending', () => {
    const registry = new DeviceRegistry();
    const device = registry.upsert(DEVICE_ID, ANNOUNCE);
    expect(device.reachable).toBe(true);
  });
});
