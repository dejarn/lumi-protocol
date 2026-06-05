import { LumiDevice, PayloadDiscoveryAnnounce } from './types';

export class DeviceRegistry {
  private readonly devices = new Map<number, LumiDevice>();
  private readonly pendingReachability = new Map<number, boolean>();

  upsert(deviceId: number, announce: PayloadDiscoveryAnnounce): LumiDevice {
    const existing = this.devices.get(deviceId);
    const reachable = this.pendingReachability.get(deviceId)
      ?? existing?.reachable
      ?? true;
    this.pendingReachability.delete(deviceId);

    const device: LumiDevice = {
      deviceId,
      deviceType: announce.deviceType,
      capabilities: announce.capabilities,
      protoVersion: announce.protoVersion,
      zoneId: announce.zoneId,
      name: announce.name,
      reachable,
      lastSeen: new Date(),
    };
    if (existing) {
      Object.assign(existing, device);
      return existing;
    }
    this.devices.set(deviceId, device);
    return device;
  }

  get(deviceId: number): LumiDevice | undefined {
    return this.devices.get(deviceId);
  }

  list(): LumiDevice[] {
    return Array.from(this.devices.values());
  }

  markUnreachable(deviceId: number): void {
    const device = this.devices.get(deviceId);
    if (device) device.reachable = false;
  }

  setReachable(deviceId: number, reachable: boolean): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.reachable = reachable;
    } else {
      this.pendingReachability.set(deviceId, reachable);
    }
  }
}
