import { LumiDevice, PayloadDiscoveryAnnounce } from './types';

export class DeviceRegistry {
  private readonly devices = new Map<number, LumiDevice>();

  upsert(deviceId: number, announce: PayloadDiscoveryAnnounce): LumiDevice {
    throw new Error('not implemented');
  }

  get(deviceId: number): LumiDevice | undefined {
    return this.devices.get(deviceId);
  }

  list(): LumiDevice[] {
    return Array.from(this.devices.values());
  }

  markUnreachable(deviceId: number): void {
    throw new Error('not implemented');
  }
}
