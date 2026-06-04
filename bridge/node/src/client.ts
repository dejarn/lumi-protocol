import { EventEmitter } from 'events';
import { LumiCodec } from './codec';

interface MqttClient {
  publish(topic: string, message: Buffer, callback?: (err?: Error) => void): void;
  subscribe(topic: string | string[], callback?: (err: Error | null) => void): void;
  on(event: 'message', cb: (topic: string, payload: Buffer) => void): this;
}
import { LumiDevice, LumiFrame, LumiState, AnimationIdValue, PayloadSetAnimation } from './types';

export interface LumiClientEvents {
  discovery:    (device: LumiDevice) => void;
  state_report: (deviceId: number, state: LumiState) => void;
  ack:          (deviceId: number, ackSeq: number, status: 0x00 | 0x01) => void;
  error:        (deviceId: number, errorCode: number, faultyOpcode: number) => void;
}

export declare interface LumiClient {
  on<K extends keyof LumiClientEvents>(event: K, listener: LumiClientEvents[K]): this;
  emit<K extends keyof LumiClientEvents>(event: K, ...args: Parameters<LumiClientEvents[K]>): boolean;
}

export class LumiClient extends EventEmitter {
  constructor(
    private readonly mqtt: MqttClient,
    private readonly codec: LumiCodec,
  ) {
    super();
  }

  setPower(deviceId: number, on: boolean): Promise<void> {
    throw new Error('not implemented');
  }

  setBrightness(deviceId: number, brightness: number): Promise<void> {
    throw new Error('not implemented');
  }

  setColor(deviceId: number, color: { h: number; s: number; b: number }): Promise<void> {
    throw new Error('not implemented');
  }

  setAnimation(
    deviceId: number,
    animId: AnimationIdValue,
    params: Pick<PayloadSetAnimation, 'speed' | 'intensity'>,
  ): Promise<void> {
    throw new Error('not implemented');
  }

  stopAnimation(deviceId: number): Promise<void> {
    throw new Error('not implemented');
  }

  setZone(deviceId: number, zoneId: number): Promise<void> {
    throw new Error('not implemented');
  }

  getState(deviceId: number): void {
    throw new Error('not implemented');
  }

  send(frame: LumiFrame): void {
    throw new Error('not implemented');
  }
}
