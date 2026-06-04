import { describe, expect, it } from 'vitest';
import { LumiCodec } from './codec';
import { LumiDecodeError } from './errors';
import {
  AnimationId,
  LumiFrame,
  Opcode,
  PROTO_VERSION,
} from './types';

const codec = new LumiCodec();

const BASE: Pick<LumiFrame, 'ver' | 'deviceId' | 'seq' | 'totalLen'> = {
  ver: PROTO_VERSION,
  deviceId: 0x0001,
  seq: 1,
  totalLen: 0,
};

function roundTrip(frame: LumiFrame) {
  return codec.decode(codec.encode(frame));
}

describe('LumiCodec — round-trip per opcode', () => {
  it('SET_POWER', () => {
    const frame = { ...BASE, opc: Opcode.SET_POWER, payload: { state: 0x01 as const } } as LumiFrame;
    expect(roundTrip(frame).payload).toEqual(frame.payload);
  });

  it('SET_BRIGHTNESS', () => {
    const frame = { ...BASE, opc: Opcode.SET_BRIGHTNESS, payload: { brightness: 128 } } as LumiFrame;
    expect(roundTrip(frame).payload).toEqual(frame.payload);
  });

  it('SET_COLOR', () => {
    const frame = { ...BASE, opc: Opcode.SET_COLOR, payload: { h: 300, s: 255, b: 200 } } as LumiFrame;
    expect(roundTrip(frame).payload).toEqual(frame.payload);
  });

  it('SET_ANIMATION', () => {
    const frame = {
      ...BASE,
      opc: Opcode.SET_ANIMATION,
      payload: { animId: AnimationId.BREATHE, speed: 50, intensity: 80 },
    } as LumiFrame;
    expect(roundTrip(frame).payload).toEqual(frame.payload);
  });

  it('STOP_ANIMATION', () => {
    const frame = { ...BASE, opc: Opcode.STOP_ANIMATION, payload: {} } as LumiFrame;
    expect(roundTrip(frame).payload).toEqual({});
  });

  it('SET_ZONE', () => {
    const frame = { ...BASE, opc: Opcode.SET_ZONE, payload: { zoneId: 3 } } as LumiFrame;
    expect(roundTrip(frame).payload).toEqual(frame.payload);
  });

  it('GET_STATE', () => {
    const frame = { ...BASE, opc: Opcode.GET_STATE, payload: {} } as LumiFrame;
    expect(roundTrip(frame).payload).toEqual({});
  });

  it('STATE_REPORT', () => {
    const frame = {
      ...BASE,
      opc: Opcode.STATE_REPORT,
      payload: { power: 0x01 as const, brightness: 200, h: 180, s: 128, b: 100, animId: AnimationId.PULSE },
    } as LumiFrame;
    expect(roundTrip(frame).payload).toEqual(frame.payload);
  });

  it('ACK', () => {
    const frame = { ...BASE, opc: Opcode.ACK, payload: { ackSeq: 7, status: 0x00 as const } } as LumiFrame;
    expect(roundTrip(frame).payload).toEqual(frame.payload);
  });

  it('DISCOVERY_REQUEST', () => {
    const frame = { ...BASE, opc: Opcode.DISCOVERY_REQUEST, payload: {} } as LumiFrame;
    expect(roundTrip(frame).payload).toEqual({});
  });

  it('DISCOVERY_ANNOUNCE', () => {
    const frame = {
      ...BASE,
      opc: Opcode.DISCOVERY_ANNOUNCE,
      payload: { deviceType: 1, capabilities: 0xff, protoVersion: 1, zoneId: 0, name: 'salon' },
    } as LumiFrame;
    expect(roundTrip(frame).payload).toEqual(frame.payload);
  });

  it('ERROR', () => {
    const frame = { ...BASE, opc: Opcode.ERROR, payload: { errorCode: 2, faultyOpcode: 0x03 } } as LumiFrame;
    expect(roundTrip(frame).payload).toEqual(frame.payload);
  });
});

describe('LumiCodec — encode preserves header fields', () => {
  it('deviceId and seq survive round-trip', () => {
    const frame = { ...BASE, deviceId: 0xABCD, seq: 42, opc: Opcode.SET_POWER, payload: { state: 0x00 as const } } as LumiFrame;
    const decoded = roundTrip(frame);
    expect(decoded.deviceId).toBe(0xabcd);
    expect(decoded.seq).toBe(42);
    expect(decoded.ver).toBe(PROTO_VERSION);
  });

  it('totalLen in encoded buffer equals header + payload + CRC', () => {
    const frame = { ...BASE, opc: Opcode.SET_COLOR, payload: { h: 0, s: 0, b: 0 } } as LumiFrame;
    const buf = codec.encode(frame);
    const storedLen = buf.readUInt16BE(5);
    expect(storedLen).toBe(buf.length);
  });
});

describe('LumiCodec — decode error paths', () => {
  it('throws on buffer shorter than MIN_FRAME_SIZE', () => {
    expect(() => codec.decode(Buffer.alloc(5))).toThrow(LumiDecodeError);
    expect(() => codec.decode(Buffer.alloc(5))).toThrow('frame too short');
  });

  it('throws when buf.length !== totalLen', () => {
    const frame = { ...BASE, opc: Opcode.SET_POWER, payload: { state: 0x01 as const } } as LumiFrame;
    const buf = codec.encode(frame);
    // append extra byte → length mismatch
    const padded = Buffer.concat([buf, Buffer.alloc(1)]);
    expect(() => codec.decode(padded)).toThrow('buffer length mismatch');
  });

  it('throws on CRC mismatch', () => {
    const frame = { ...BASE, opc: Opcode.SET_POWER, payload: { state: 0x01 as const } } as LumiFrame;
    const buf = codec.encode(frame);
    buf[buf.length - 1] ^= 0xff; // flip last CRC byte
    expect(() => codec.decode(buf)).toThrow('CRC mismatch');
  });

  it('throws on unsupported protocol version', () => {
    const frame = { ...BASE, opc: Opcode.SET_POWER, payload: { state: 0x01 as const } } as LumiFrame;
    const buf = codec.encode(frame);
    buf[0] = 2; // overwrite ver byte — also invalidates CRC, recompute
    // re-sign with patched CRC
    const crc = computeCrc(buf, 0, buf.length - 2);
    buf.writeUInt16BE(crc, buf.length - 2);
    expect(() => codec.decode(buf)).toThrow('unsupported protocol version: 2');
  });

  it('throws on unknown opcode', () => {
    const frame = { ...BASE, opc: Opcode.SET_POWER, payload: { state: 0x01 as const } } as LumiFrame;
    const buf = codec.encode(frame);
    buf[1] = 0xff; // overwrite opcode
    const crc = computeCrc(buf, 0, buf.length - 2);
    buf.writeUInt16BE(crc, buf.length - 2);
    expect(() => codec.decode(buf)).toThrow('unknown opcode 0xff');
  });
});

describe('LumiCodec — DISCOVERY_ANNOUNCE name truncation', () => {
  it('truncates long ASCII name to ≤ 32 bytes', () => {
    const name = 'a'.repeat(50);
    const frame = {
      ...BASE,
      opc: Opcode.DISCOVERY_ANNOUNCE,
      payload: { deviceType: 1, capabilities: 0, protoVersion: 1, zoneId: 0, name },
    } as LumiFrame;
    const decoded = roundTrip(frame);
    expect(Buffer.byteLength((decoded.payload as { name: string }).name, 'utf8')).toBeLessThanOrEqual(32);
  });

  it('does not split a multi-byte UTF-8 codepoint', () => {
    // '日' is 3 bytes; 11 chars = 33 bytes → must truncate at 10 chars (30 bytes)
    const name = '日'.repeat(11);
    const frame = {
      ...BASE,
      opc: Opcode.DISCOVERY_ANNOUNCE,
      payload: { deviceType: 1, capabilities: 0, protoVersion: 1, zoneId: 0, name },
    } as LumiFrame;
    const decoded = roundTrip(frame);
    const decodedName = (decoded.payload as { name: string }).name;
    expect(Buffer.byteLength(decodedName, 'utf8')).toBeLessThanOrEqual(32);
    // every character in the decoded name must be a valid '日'
    expect([...decodedName].every(ch => ch === '日')).toBe(true);
  });
});

// CRC-16/CCITT helper — mirrors codec internal, used to re-sign patched buffers in tests
function computeCrc(buf: Buffer, start: number, end: number): number {
  let crc = 0xffff;
  for (let i = start; i < end; i++) {
    crc ^= buf[i] << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
    }
    crc &= 0xffff;
  }
  return crc;
}
