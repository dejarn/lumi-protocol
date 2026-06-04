// Frame constants — derived from spec/v1/opcodes.yaml
export const PROTO_VERSION = 1;
export const HEADER_SIZE = 7;
export const CRC_SIZE = 2;
export const MIN_FRAME_SIZE = 9;

// Opcodes
export const Opcode = {
  SET_POWER:           0x01,
  SET_BRIGHTNESS:      0x02,
  SET_COLOR:           0x03,
  SET_ANIMATION:       0x04,
  STOP_ANIMATION:      0x05,
  SET_ZONE:            0x06,
  GET_STATE:           0x07,
  STATE_REPORT:        0x20,
  ACK:                 0x21,
  DISCOVERY_REQUEST:   0x40,
  DISCOVERY_ANNOUNCE:  0x41,
  ERROR:               0x50,
} as const;
export type OpcodeValue = (typeof Opcode)[keyof typeof Opcode];

// Animation IDs
export const AnimationId = {
  NONE:    0x00,
  PULSE:   0x01,
  BREATHE: 0x02,
  FLASH:   0x03,
  STROBE:  0x04,
  RAINBOW: 0x05,
} as const;
export type AnimationIdValue = (typeof AnimationId)[keyof typeof AnimationId];

// Frame header
export interface LumiFrameHeader {
  ver:      number;  // uint8 — protocol version
  opc:      OpcodeValue;
  deviceId: number;  // uint16 big-endian
  seq:      number;  // uint8
  totalLen: number;  // uint16 big-endian — header + payload + CRC
}

// Opcode payload interfaces

export interface PayloadSetPower      { state: 0x00 | 0x01 }
export interface PayloadSetBrightness { brightness: number }
export interface PayloadSetColor      { h: number; s: number; b: number }
export interface PayloadSetAnimation  { animId: AnimationIdValue; speed: number; intensity: number }
export interface PayloadStopAnimation { }
export interface PayloadSetZone       { zoneId: number }
export interface PayloadGetState      { }

export interface PayloadStateReport {
  power:      0x00 | 0x01;
  brightness: number;
  h:          number;
  s:          number;
  b:          number;
  animId:     AnimationIdValue;
}

export interface PayloadAck {
  ackSeq: number;
  status: 0x00 | 0x01;
}

export interface PayloadDiscoveryRequest  { }

export interface PayloadDiscoveryAnnounce {
  deviceType:    number;
  capabilities:  number;
  protoVersion:  number;
  zoneId:        number;
  name:          string;
}

export interface PayloadError {
  errorCode:    number;
  faultyOpcode: number;
}

// Union frame type
export type LumiFrame =
  | (LumiFrameHeader & { opc: typeof Opcode.SET_POWER;           payload: PayloadSetPower })
  | (LumiFrameHeader & { opc: typeof Opcode.SET_BRIGHTNESS;      payload: PayloadSetBrightness })
  | (LumiFrameHeader & { opc: typeof Opcode.SET_COLOR;           payload: PayloadSetColor })
  | (LumiFrameHeader & { opc: typeof Opcode.SET_ANIMATION;       payload: PayloadSetAnimation })
  | (LumiFrameHeader & { opc: typeof Opcode.STOP_ANIMATION;      payload: PayloadStopAnimation })
  | (LumiFrameHeader & { opc: typeof Opcode.SET_ZONE;            payload: PayloadSetZone })
  | (LumiFrameHeader & { opc: typeof Opcode.GET_STATE;           payload: PayloadGetState })
  | (LumiFrameHeader & { opc: typeof Opcode.STATE_REPORT;        payload: PayloadStateReport })
  | (LumiFrameHeader & { opc: typeof Opcode.ACK;                 payload: PayloadAck })
  | (LumiFrameHeader & { opc: typeof Opcode.DISCOVERY_REQUEST;   payload: PayloadDiscoveryRequest })
  | (LumiFrameHeader & { opc: typeof Opcode.DISCOVERY_ANNOUNCE;  payload: PayloadDiscoveryAnnounce })
  | (LumiFrameHeader & { opc: typeof Opcode.ERROR;               payload: PayloadError });

// Convenience alias for the STATE_REPORT payload
export type LumiState = PayloadStateReport;

// Device record (populated by DISCOVERY_ANNOUNCE)
export interface LumiDevice {
  deviceId:     number;
  deviceType:   number;
  capabilities: number;
  protoVersion: number;
  zoneId:       number;
  name:         string;
  reachable:    boolean;
  lastSeen:     Date;
}
