export class LumiDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LumiDecodeError';
  }
}

export class LumiTimeoutError extends Error {
  readonly deviceId: number;
  readonly seq: number;

  constructor(deviceId: number, seq: number) {
    super(`ACK timeout for device 0x${deviceId.toString(16).padStart(4, '0')} seq=${seq}`);
    this.name = 'LumiTimeoutError';
    this.deviceId = deviceId;
    this.seq = seq;
  }
}
