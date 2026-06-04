import { LumiDecodeError } from './errors';
import {
  AnimationIdValue,
  LumiFrame,
  Opcode,
  OpcodeValue,
  PROTO_VERSION,
  HEADER_SIZE,
  CRC_SIZE,
  MIN_FRAME_SIZE,
} from './types';

function crc16(buf: Buffer, start: number, end: number): number {
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

function buildPayload(frame: LumiFrame): Buffer {
  switch (frame.opc) {
    case Opcode.SET_POWER: {
      const buf = Buffer.allocUnsafe(1);
      buf.writeUInt8(frame.payload.state, 0);
      return buf;
    }
    case Opcode.SET_BRIGHTNESS: {
      const buf = Buffer.allocUnsafe(1);
      buf.writeUInt8(frame.payload.brightness, 0);
      return buf;
    }
    case Opcode.SET_COLOR: {
      const buf = Buffer.allocUnsafe(4);
      buf.writeUInt16BE(frame.payload.h, 0);
      buf.writeUInt8(frame.payload.s, 2);
      buf.writeUInt8(frame.payload.b, 3);
      return buf;
    }
    case Opcode.SET_ANIMATION: {
      const buf = Buffer.allocUnsafe(3);
      buf.writeUInt8(frame.payload.animId, 0);
      buf.writeUInt8(frame.payload.speed, 1);
      buf.writeUInt8(frame.payload.intensity, 2);
      return buf;
    }
    case Opcode.STOP_ANIMATION:
    case Opcode.GET_STATE:
    case Opcode.DISCOVERY_REQUEST:
      return Buffer.alloc(0);
    case Opcode.SET_ZONE: {
      const buf = Buffer.allocUnsafe(1);
      buf.writeUInt8(frame.payload.zoneId, 0);
      return buf;
    }
    case Opcode.STATE_REPORT: {
      const buf = Buffer.allocUnsafe(7);
      buf.writeUInt8(frame.payload.power, 0);
      buf.writeUInt8(frame.payload.brightness, 1);
      buf.writeUInt16BE(frame.payload.h, 2);
      buf.writeUInt8(frame.payload.s, 4);
      buf.writeUInt8(frame.payload.b, 5);
      buf.writeUInt8(frame.payload.animId, 6);
      return buf;
    }
    case Opcode.ACK: {
      const buf = Buffer.allocUnsafe(2);
      buf.writeUInt8(frame.payload.ackSeq, 0);
      buf.writeUInt8(frame.payload.status, 1);
      return buf;
    }
    case Opcode.DISCOVERY_ANNOUNCE: {
      const { deviceType, capabilities, protoVersion, zoneId, name } = frame.payload;
      const nameBytes = Buffer.from(name, 'utf8');
      let nameLen = nameBytes.length;
      if (nameLen > 32) {
        nameLen = Buffer.byteLength(
          [...name].reduce((acc, ch) => {
            const next = acc + ch;
            return Buffer.byteLength(next, 'utf8') <= 32 ? next : acc;
          }, ''),
          'utf8',
        );
      }
      const buf = Buffer.allocUnsafe(5 + nameLen);
      buf.writeUInt8(deviceType, 0);
      buf.writeUInt8(capabilities, 1);
      buf.writeUInt8(protoVersion, 2);
      buf.writeUInt8(zoneId, 3);
      buf.writeUInt8(nameLen, 4);
      nameBytes.copy(buf, 5, 0, nameLen);
      return buf;
    }
    case Opcode.ERROR: {
      const buf = Buffer.allocUnsafe(2);
      buf.writeUInt8(frame.payload.errorCode, 0);
      buf.writeUInt8(frame.payload.faultyOpcode, 1);
      return buf;
    }
    default: {
      const _exhaustive: never = frame;
      throw new Error(`unsupported opcode: ${(_exhaustive as LumiFrame).opc}`);
    }
  }
}

function requirePayloadLen(opc: number, p: Buffer, min: number): void {
  if (p.length < min) {
    throw new LumiDecodeError(
      `payload too short for opcode 0x${opc.toString(16).padStart(2, '0')}`,
    );
  }
}

function parsePayload(opc: number, p: Buffer): LumiFrame['payload'] {
  switch (opc) {
    case Opcode.SET_POWER:
      requirePayloadLen(opc, p, 1);
      return { state: p.readUInt8(0) as 0x00 | 0x01 };
    case Opcode.SET_BRIGHTNESS:
      requirePayloadLen(opc, p, 1);
      return { brightness: p.readUInt8(0) };
    case Opcode.SET_COLOR:
      requirePayloadLen(opc, p, 4);
      return { h: p.readUInt16BE(0), s: p.readUInt8(2), b: p.readUInt8(3) };
    case Opcode.SET_ANIMATION:
      requirePayloadLen(opc, p, 3);
      return {
        animId: p.readUInt8(0) as AnimationIdValue,
        speed: p.readUInt8(1),
        intensity: p.readUInt8(2),
      };
    case Opcode.STOP_ANIMATION:
      return {};
    case Opcode.SET_ZONE:
      requirePayloadLen(opc, p, 1);
      return { zoneId: p.readUInt8(0) };
    case Opcode.GET_STATE:
      return {};
    case Opcode.STATE_REPORT:
      requirePayloadLen(opc, p, 7);
      return {
        power: p.readUInt8(0) as 0x00 | 0x01,
        brightness: p.readUInt8(1),
        h: p.readUInt16BE(2),
        s: p.readUInt8(4),
        b: p.readUInt8(5),
        animId: p.readUInt8(6) as AnimationIdValue,
      };
    case Opcode.ACK:
      requirePayloadLen(opc, p, 2);
      return { ackSeq: p.readUInt8(0), status: p.readUInt8(1) as 0x00 | 0x01 };
    case Opcode.DISCOVERY_REQUEST:
      return {};
    case Opcode.DISCOVERY_ANNOUNCE: {
      requirePayloadLen(opc, p, 5);
      const nameLen = p.readUInt8(4);
      requirePayloadLen(opc, p, 5 + nameLen);
      return {
        deviceType: p.readUInt8(0),
        capabilities: p.readUInt8(1),
        protoVersion: p.readUInt8(2),
        zoneId: p.readUInt8(3),
        name: p.toString('utf8', 5, 5 + nameLen),
      };
    }
    case Opcode.ERROR:
      requirePayloadLen(opc, p, 2);
      return { errorCode: p.readUInt8(0), faultyOpcode: p.readUInt8(1) };
    default:
      throw new LumiDecodeError(`unknown opcode 0x${opc.toString(16).padStart(2, '0')}`);
  }
}

export class LumiCodec {
  encode(frame: LumiFrame): Buffer {
    const payload = buildPayload(frame);
    const totalLen = HEADER_SIZE + payload.length + CRC_SIZE;
    const buf = Buffer.allocUnsafe(totalLen);
    buf.writeUInt8(PROTO_VERSION, 0);
    buf.writeUInt8(frame.opc, 1);
    buf.writeUInt16BE(frame.deviceId, 2);
    buf.writeUInt8(frame.seq, 4);
    buf.writeUInt16BE(totalLen, 5);
    payload.copy(buf, 7);
    buf.writeUInt16BE(crc16(buf, 0, totalLen - CRC_SIZE), totalLen - CRC_SIZE);
    return buf;
  }

  decode(buf: Buffer): LumiFrame {
    if (buf.length < MIN_FRAME_SIZE) {
      throw new LumiDecodeError('frame too short');
    }
    const totalLen = buf.readUInt16BE(5);
    if (buf.length !== totalLen) {
      throw new LumiDecodeError('buffer length mismatch');
    }
    const storedCrc = buf.readUInt16BE(totalLen - CRC_SIZE);
    if (crc16(buf, 0, totalLen - CRC_SIZE) !== storedCrc) {
      throw new LumiDecodeError('CRC mismatch');
    }
    const ver = buf.readUInt8(0);
    if (ver !== PROTO_VERSION) {
      throw new LumiDecodeError(`unsupported protocol version: ${ver}`);
    }
    const opc = buf.readUInt8(1) as OpcodeValue;
    const payload = parsePayload(opc, buf.subarray(HEADER_SIZE, totalLen - CRC_SIZE));
    return {
      ver,
      opc,
      deviceId: buf.readUInt16BE(2),
      seq: buf.readUInt8(4),
      totalLen,
      payload,
    } as LumiFrame;
  }
}
