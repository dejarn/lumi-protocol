import { EventEmitter } from 'events';
import { LumiCodec } from './codec';
import { LumiTimeoutError } from './errors';
import { DeviceRegistry } from './registry';
import {
  AnimationIdValue,
  LumiDevice,
  LumiFrame,
  LumiState,
  Opcode,
  OpcodeValue,
  PayloadAck,
  PayloadDiscoveryAnnounce,
  PayloadError,
  PayloadSetAnimation,
  PROTO_VERSION,
} from './types';

const deviceIdHex = (id: number): string => id.toString(16).padStart(4, '0');

interface MqttClient {
  publish(topic: string, message: Buffer, callback?: (err?: Error) => void): void;
  subscribe(topic: string | string[], callback?: (err: Error | null) => void): void;
  on(event: 'message', cb: (topic: string, payload: Buffer) => void): this;
}

export interface LumiClientEvents {
  discovery:    (device: LumiDevice) => void;
  availability: (deviceId: number, online: boolean) => void;
  state_report: (deviceId: number, state: LumiState) => void;
  ack:          (deviceId: number, ackSeq: number, status: 0x00 | 0x01) => void;
  error:        (deviceId: number, errorCode: number, faultyOpcode: number) => void;
}

export declare interface LumiClient {
  on<K extends keyof LumiClientEvents>(event: K, listener: LumiClientEvents[K]): this;
  emit<K extends keyof LumiClientEvents>(event: K, ...args: Parameters<LumiClientEvents[K]>): boolean;
}

export class LumiClient extends EventEmitter {
  private seq = 0;
  private readonly registry = new DeviceRegistry();
  private readonly pending = new Map<string, {
    resolve: () => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(
    private readonly mqtt: MqttClient,
    private readonly codec: LumiCodec,
    private readonly ackTimeoutMs = 5000,
  ) {
    super();
    this.on('error', () => {});
    this.subscribeInbound();
  }

  setPower(deviceId: number, on: boolean): Promise<void> {
    return this.sendAndAck(
      this.makeFrame(Opcode.SET_POWER, deviceId, { state: on ? 0x01 : 0x00 }),
    );
  }

  setBrightness(deviceId: number, brightness: number): Promise<void> {
    return this.sendAndAck(
      this.makeFrame(Opcode.SET_BRIGHTNESS, deviceId, { brightness }),
    );
  }

  setColor(deviceId: number, color: { h: number; s: number; b: number }): Promise<void> {
    return this.sendAndAck(
      this.makeFrame(Opcode.SET_COLOR, deviceId, color),
    );
  }

  setAnimation(
    deviceId: number,
    animId: AnimationIdValue,
    params: Pick<PayloadSetAnimation, 'speed' | 'intensity'>,
  ): Promise<void> {
    return this.sendAndAck(
      this.makeFrame(Opcode.SET_ANIMATION, deviceId, { animId, ...params }),
    );
  }

  stopAnimation(deviceId: number): Promise<void> {
    return this.sendAndAck(
      this.makeFrame(Opcode.STOP_ANIMATION, deviceId, {}),
    );
  }

  setZone(deviceId: number, zoneId: number): Promise<void> {
    if (zoneId < 0 || zoneId > 254) {
      return Promise.reject(new RangeError(`zoneId out of range [0,254]: ${zoneId}`));
    }
    return this.sendAndAck(
      this.makeFrame(Opcode.SET_ZONE, deviceId, { zoneId }),
    );
  }

  getState(deviceId: number): void {
    this.send(this.makeFrame(Opcode.GET_STATE, deviceId, {}));
  }

  /** Broadcast DISCOVERY_REQUEST to all devices on lumi/discovery/request. Fire-and-forget (no ACK). */
  discover(): void {
    const frame = this.makeFrame(Opcode.DISCOVERY_REQUEST, 0xffff, {});
    this.mqtt.publish('lumi/discovery/request', this.codec.encode(frame));
  }

  send(frame: LumiFrame): void {
    const buf = this.codec.encode(frame);
    const topic = `lumi/device/${deviceIdHex(frame.deviceId)}/cmd`;
    const { deviceId, seq } = frame;
    this.mqtt.publish(topic, buf, (err) => {
      if (!err) return;
      const key = `${deviceId}:${seq}`;
      const pending = this.pending.get(key);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(key);
        pending.reject(err);
      }
    });
  }

  private makeFrame(opc: OpcodeValue, deviceId: number, payload: LumiFrame['payload']): LumiFrame {
    return { ver: PROTO_VERSION, opc, deviceId, seq: this.nextSeq(), totalLen: 0, payload } as LumiFrame;
  }

  private sendAndAck(frame: LumiFrame): Promise<void> {
    return new Promise((resolve, reject) => {
      const key = `${frame.deviceId}:${frame.seq}`;
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new LumiTimeoutError(frame.deviceId, frame.seq));
      }, this.ackTimeoutMs);
      if (this.pending.has(key)) {
        clearTimeout(timer);
        reject(new Error(`seq collision: key ${key} already pending`));
        return;
      }
      this.pending.set(key, { resolve, reject, timer });
      this.send(frame);
    });
  }

  private nextSeq(): number {
    this.seq = (this.seq + 1) & 0xff;
    return this.seq;
  }

  private subscribeInbound(): void {
    this.mqtt.subscribe(['lumi/device/+/state', 'lumi/device/+/availability', 'lumi/discovery/announce']);
    this.mqtt.on('message', (topic, buf) => {
      const availMatch = /^lumi\/device\/([0-9a-f]{4})\/availability$/i.exec(topic);
      if (availMatch) {
        const deviceId = parseInt(availMatch[1], 16);
        const online = buf.toString() === 'online';
        this.registry.setReachable(deviceId, online);
        this.emit('availability', deviceId, online);
        return;
      }

      let frame: LumiFrame;
      try {
        frame = this.codec.decode(buf);
      } catch {
        return;
      }
      this.handleInbound(frame);
    });
  }

  private handleInbound(frame: LumiFrame): void {
    switch (frame.opc) {
      case Opcode.ACK: {
        const { ackSeq, status } = frame.payload as PayloadAck;
        const key = `${frame.deviceId}:${ackSeq}`;
        const pending = this.pending.get(key);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(key);
          if (status === 0x00) pending.resolve();
          else pending.reject(new Error(`ACK error for device 0x${frame.deviceId.toString(16)} seq=${ackSeq}`));
        }
        this.emit('ack', frame.deviceId, ackSeq, status);
        break;
      }
      case Opcode.STATE_REPORT:
        this.emit('state_report', frame.deviceId, frame.payload as LumiState);
        break;
      case Opcode.DISCOVERY_ANNOUNCE: {
        const device = this.registry.upsert(frame.deviceId, frame.payload as PayloadDiscoveryAnnounce);
        this.emit('discovery', device);
        break;
      }
      case Opcode.ERROR: {
        const { errorCode, faultyOpcode } = frame.payload as PayloadError;
        this.emit('error', frame.deviceId, errorCode, faultyOpcode);
        break;
      }
    }
  }
}
