import { LumiFrame } from './types';

export class LumiCodec {
  encode(_frame: LumiFrame): Buffer {
    throw new Error('not implemented');
  }

  decode(_buf: Buffer): LumiFrame {
    throw new Error('not implemented');
  }
}
