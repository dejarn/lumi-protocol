import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LumiClient } from './client';
import { LumiCodec } from './codec';
import { LumiTimeoutError } from './errors';
import { AnimationId, LumiFrame, LumiState, Opcode, PROTO_VERSION } from './types';

// --- mock MqttClient factory ---

type PublishCallback = (err?: Error) => void;

function makeMqtt() {
  let messageHandler: ((topic: string, buf: Buffer) => void) | undefined;
  const mock = {
    publish: vi.fn<(topic: string, payload: Buffer, cb: PublishCallback) => void>(),
    subscribe: vi.fn(),
    on: vi.fn((_event: string, cb: (topic: string, buf: Buffer) => void) => {
      messageHandler = cb;
      return mock;
    }),
    /** Simulate an inbound MQTT message (device → bridge) */
    receive(topic: string, buf: Buffer) {
      messageHandler?.(topic, buf);
    },
  };
  return mock;
}

const codec = new LumiCodec();
const DEVICE_ID = 0x0001;

function makeClient(mqtt: ReturnType<typeof makeMqtt>) {
  return new LumiClient(mqtt as any, codec, 50 /* fast timeout */);
}

/** Build and encode an inbound frame from the device */
function deviceFrame(opc: LumiFrame['opc'], payload: LumiFrame['payload'], seq = 1): Buffer {
  return codec.encode({ ver: PROTO_VERSION, opc, deviceId: DEVICE_ID, seq, totalLen: 0, payload } as LumiFrame);
}

/** Extract the seq from the last published buffer */
function lastPublishedSeq(mqtt: ReturnType<typeof makeMqtt>): number {
  const buf: Buffer = mqtt.publish.mock.lastCall![1];
  return buf.readUInt8(4);
}

// --- helpers to simulate ACK ---

function sendAck(
  mqtt: ReturnType<typeof makeMqtt>,
  seq: number,
  status: 0x00 | 0x01 = 0x00,
) {
  mqtt.receive(`lumi/device/${DEVICE_ID.toString(16).padStart(4, '0')}/state`,
    deviceFrame(Opcode.ACK, { ackSeq: seq, status }, seq));
}

const AVAIL_TOPIC = `lumi/device/${DEVICE_ID.toString(16).padStart(4, '0')}/availability`;
const STATE_TOPIC = `lumi/device/${DEVICE_ID.toString(16).padStart(4, '0')}/state`;

// ─────────────────────────────────────────────────────────────────────────────

describe('LumiClient — command methods publish to correct topic', () => {
  let mqtt: ReturnType<typeof makeMqtt>;
  let client: LumiClient;

  beforeEach(() => {
    mqtt = makeMqtt();
    client = makeClient(mqtt);
  });

  it('setPower publishes on lumi/device/<id>/cmd', () => {
    const p = client.setPower(DEVICE_ID, true);
    expect(mqtt.publish).toHaveBeenCalledWith(
      `lumi/device/${DEVICE_ID}/cmd`,
      expect.any(Buffer),
      expect.any(Function),
    );
    // prevent unhandled rejection from pending promise
    sendAck(mqtt, lastPublishedSeq(mqtt));
    return p;
  });

  it('setBrightness payload round-trips correctly', async () => {
    const p = client.setBrightness(DEVICE_ID, 200);
    const seq = lastPublishedSeq(mqtt);
    const decoded = codec.decode(mqtt.publish.mock.lastCall![1]);
    expect((decoded.payload as { brightness: number }).brightness).toBe(200);
    sendAck(mqtt, seq);
    await p;
  });

  it('setColor payload round-trips correctly', async () => {
    const p = client.setColor(DEVICE_ID, { h: 120, s: 255, b: 100 });
    const seq = lastPublishedSeq(mqtt);
    const decoded = codec.decode(mqtt.publish.mock.lastCall![1]);
    expect(decoded.payload).toEqual({ h: 120, s: 255, b: 100 });
    sendAck(mqtt, seq);
    await p;
  });

  it('setAnimation payload round-trips correctly', async () => {
    const p = client.setAnimation(DEVICE_ID, AnimationId.PULSE, { speed: 30, intensity: 90 });
    const seq = lastPublishedSeq(mqtt);
    const decoded = codec.decode(mqtt.publish.mock.lastCall![1]);
    expect(decoded.payload).toEqual({ animId: AnimationId.PULSE, speed: 30, intensity: 90 });
    sendAck(mqtt, seq);
    await p;
  });

  it('stopAnimation publishes STOP_ANIMATION opcode', async () => {
    const p = client.stopAnimation(DEVICE_ID);
    const seq = lastPublishedSeq(mqtt);
    const decoded = codec.decode(mqtt.publish.mock.lastCall![1]);
    expect(decoded.opc).toBe(Opcode.STOP_ANIMATION);
    sendAck(mqtt, seq);
    await p;
  });

  it('setZone payload round-trips correctly', async () => {
    const p = client.setZone(DEVICE_ID, 2);
    const seq = lastPublishedSeq(mqtt);
    const decoded = codec.decode(mqtt.publish.mock.lastCall![1]);
    expect((decoded.payload as { zoneId: number }).zoneId).toBe(2);
    sendAck(mqtt, seq);
    await p;
  });

  it('getState publishes GET_STATE opcode and returns void (no promise)', () => {
    const result = client.getState(DEVICE_ID);
    expect(result).toBeUndefined();
    const decoded = codec.decode(mqtt.publish.mock.lastCall![1]);
    expect(decoded.opc).toBe(Opcode.GET_STATE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('LumiClient — ACK handling', () => {
  let mqtt: ReturnType<typeof makeMqtt>;
  let client: LumiClient;

  beforeEach(() => {
    mqtt = makeMqtt();
    client = makeClient(mqtt);
  });

  it('ACK status=0x00 resolves the promise', async () => {
    const p = client.setPower(DEVICE_ID, true);
    sendAck(mqtt, lastPublishedSeq(mqtt), 0x00);
    await expect(p).resolves.toBeUndefined();
  });

  it('ACK status=0x01 rejects the promise', async () => {
    const p = client.setPower(DEVICE_ID, true);
    sendAck(mqtt, lastPublishedSeq(mqtt), 0x01);
    await expect(p).rejects.toThrow('ACK error');
  });

  it('emits ack event for all ACK frames', async () => {
    const handler = vi.fn();
    client.on('ack', handler);
    const p = client.setPower(DEVICE_ID, true);
    const seq = lastPublishedSeq(mqtt);
    sendAck(mqtt, seq, 0x00);
    await p;
    expect(handler).toHaveBeenCalledWith(DEVICE_ID, seq, 0x00);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('LumiClient — timeout and error paths', () => {
  let mqtt: ReturnType<typeof makeMqtt>;
  let client: LumiClient;

  beforeEach(() => {
    mqtt = makeMqtt();
    client = makeClient(mqtt);
  });

  it('rejects with LumiTimeoutError when no ACK arrives', async () => {
    await expect(client.setPower(DEVICE_ID, true)).rejects.toBeInstanceOf(LumiTimeoutError);
  });

  it('rejects immediately on publish error (does not wait for timeout)', async () => {
    const p = client.setPower(DEVICE_ID, true);
    // fire the publish callback with an error
    const cb: PublishCallback = mqtt.publish.mock.lastCall![2];
    cb(new Error('send failed'));
    await expect(p).rejects.toThrow('send failed');
  });

  it('rejects with seq collision error when pending key already exists', async () => {
    // fill pending manually via two calls with the same seq
    // easiest: send 256 commands so seq wraps and collides
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 256; i++) {
      promises.push(client.setPower(DEVICE_ID, true).catch(() => {}));
    }
    // 257th call should collide on seq=1
    await expect(client.setPower(DEVICE_ID, true)).rejects.toThrow('seq collision');
    // resolve all pending to clean up timers
    for (let seq = 1; seq <= 256; seq++) {
      sendAck(mqtt, seq % 256, 0x00);
    }
  });

  it('emit("error") with no external listener does not throw', () => {
    expect(() => client.emit('error', DEVICE_ID, 0x01, 0x03)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('LumiClient — inbound event handling', () => {
  let mqtt: ReturnType<typeof makeMqtt>;
  let client: LumiClient;

  beforeEach(() => {
    mqtt = makeMqtt();
    client = makeClient(mqtt);
  });

  it('STATE_REPORT inbound emits state_report event', () => {
    const handler = vi.fn();
    client.on('state_report', handler);
    const state: LumiState = { power: 0x01, brightness: 180, h: 200, s: 128, b: 90, animId: AnimationId.NONE };
    mqtt.receive(STATE_TOPIC, deviceFrame(Opcode.STATE_REPORT, state));
    expect(handler).toHaveBeenCalledWith(DEVICE_ID, state);
  });

  it('DISCOVERY_ANNOUNCE inbound emits discovery event', () => {
    const handler = vi.fn();
    client.on('discovery', handler);
    const announce = { deviceType: 1, capabilities: 0xff, protoVersion: 1, zoneId: 0, name: 'strip-1' };
    mqtt.receive('lumi/discovery/announce', deviceFrame(Opcode.DISCOVERY_ANNOUNCE, announce));
    expect(handler).toHaveBeenCalledOnce();
    const device = handler.mock.calls[0][0];
    expect(device.deviceId).toBe(DEVICE_ID);
    expect(device.name).toBe('strip-1');
  });

  it('ERROR opcode inbound emits error event with correct args', () => {
    const handler = vi.fn();
    client.on('error', handler);
    mqtt.receive(STATE_TOPIC, deviceFrame(Opcode.ERROR, { errorCode: 5, faultyOpcode: 0x02 }));
    expect(handler).toHaveBeenCalledWith(DEVICE_ID, 5, 0x02);
  });

  it('malformed inbound frame is silently dropped (no throw)', () => {
    expect(() => mqtt.receive(STATE_TOPIC, Buffer.alloc(3))).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('LumiClient — availability (LWT)', () => {
  let mqtt: ReturnType<typeof makeMqtt>;
  let client: LumiClient;

  beforeEach(() => {
    mqtt = makeMqtt();
    client = makeClient(mqtt);
  });

  it('subscribes to lumi/device/+/availability', () => {
    expect(mqtt.subscribe).toHaveBeenCalledWith([
      'lumi/device/+/state',
      'lumi/device/+/availability',
      'lumi/discovery/announce',
    ]);
  });

  it('emits availability(true) on payload "online"', () => {
    const handler = vi.fn();
    client.on('availability', handler);
    mqtt.receive(AVAIL_TOPIC, Buffer.from('online'));
    expect(handler).toHaveBeenCalledWith(DEVICE_ID, true);
  });

  it('emits availability(false) on payload "offline"', () => {
    const handler = vi.fn();
    client.on('availability', handler);
    mqtt.receive(AVAIL_TOPIC, Buffer.from('offline'));
    expect(handler).toHaveBeenCalledWith(DEVICE_ID, false);
  });

  it('treats non-"online" payload as offline', () => {
    const handler = vi.fn();
    client.on('availability', handler);
    mqtt.receive(AVAIL_TOPIC, Buffer.from('ONLINE'));
    expect(handler).toHaveBeenCalledWith(DEVICE_ID, false);
  });

  it('discovery after offline availability sets reachable=false', () => {
    mqtt.receive(AVAIL_TOPIC, Buffer.from('offline'));
    const handler = vi.fn();
    client.on('discovery', handler);
    const announce = { deviceType: 1, capabilities: 0xff, protoVersion: 1, zoneId: 0, name: 'strip-1' };
    mqtt.receive('lumi/discovery/announce', deviceFrame(Opcode.DISCOVERY_ANNOUNCE, announce));
    expect(handler.mock.calls[0][0].reachable).toBe(false);
  });
});
