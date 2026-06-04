# lumi-protocol

> Binary protocol for MQTT-connected IoT devices — part of the **lumi** self-hosted home automation platform.

![spec v1.0](https://img.shields.io/badge/spec-v1.0-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white) ![PlatformIO](https://img.shields.io/badge/PlatformIO-Arduino-f5822a?logo=platformio&logoColor=white)

lumi-protocol is the binary communication protocol for custom IoT devices in [lumi](https://github.com/dejarn/lumi), a self-hosted home automation platform running on Raspberry Pi — no cloud, no Home Assistant. It defines the payload layer over MQTT between the `mqtt-bridge` service and a fleet of devices, with libraries for each target platform that share a single versioned spec. The current spec (v1) covers LED strip controllers; new device types are added as new opcode ranges in future versions.

```
Next.js UI / Automations
         │
 mqtt-bridge (Raspberry Pi)
 lumi-protocol  [Node.js]
         │  MQTT  (lumi/… topics)
    ┌────┴────┐
 device #1  device #2  …
 lumi-protocol [Arduino / …]
```

## Protocol

### Frame layout

| Byte(s) | Field | Size | Description |
|---------|-------|------|-------------|
| 0 | `VER` | 1 | Protocol version (`0x01`) |
| 1 | `OPC` | 1 | Opcode |
| 2–3 | `DEVICE_ID` | 2 | Device identifier (big-endian). `0xFFFF` = broadcast |
| 4 | `SEQ` | 1 | Sequence number (0–255, wraps) |
| 5–6 | `TOTAL_LEN` | 2 | Total frame length including header, payload, and CRC |
| 7…N | `PAYLOAD` | N | Opcode-specific payload |
| N+1–N+2 | `CRC` | 2 | CRC-16/CCITT (poly `0x1021`, init `0xFFFF`, covers VER → last payload byte) |

Minimum frame size: **9 bytes** (empty payload).

### Opcodes

| Range | Category | Direction | ACK |
|-------|----------|-----------|-----|
| `0x01`–`0x07` | Commands (SET_POWER, SET_BRIGHTNESS, SET_COLOR, SET_ANIMATION, STOP_ANIMATION, SET_ZONE, GET_STATE) | Pi → ESP32 | Yes (except GET_STATE) |
| `0x20`–`0x21` | State (STATE_REPORT, ACK) | ESP32 → Pi | No |
| `0x40`–`0x41` | Discovery (DISCOVERY_REQUEST, DISCOVERY_ANNOUNCE) | Both | No |
| `0x50` | Error | ESP32 → Pi | No |

> [!NOTE]
> Opcodes are **additive only**. Existing opcode values and payload layouts are never modified or removed — this is the core backward-compatibility guarantee. New opcodes are always appended in the next available slot.

See [`spec/v1/opcodes.yaml`](spec/v1/opcodes.yaml) for the full payload schemas.

### MQTT topics

| Topic | Usage |
|-------|-------|
| `lumi/zone/{zone_id}/cmd` | Command to all devices in a zone |
| `lumi/device/{device_id}/cmd` | Command to a specific device |
| `lumi/device/{device_id}/state` | State from a specific device |
| `lumi/discovery/request` | Broadcast discovery request |
| `lumi/discovery/announce` | Device self-announcement |

`device_id` is the last 2 bytes of the ESP32's WiFi MAC address, rendered as lowercase hex (e.g. `a3f1`).

## Node.js library

### Installation

```bash
pnpm add lumi-protocol
```

### Usage

```typescript
import mqtt from 'mqtt'
import { LumiCodec, LumiClient, AnimationId } from 'lumi-protocol'

const mqttClient = mqtt.connect('mqtt://broker')
const client = new LumiClient(mqttClient, new LumiCodec())

// Device discovery
client.on('discovery', (device) => {
  console.log(`Found: ${device.name} (0x${device.deviceId.toString(16)})`)
})

// State changes
client.on('state_report', (deviceId, state) => {
  console.log(`0x${deviceId.toString(16)}:`, state)
})

// Commands — each resolves on ACK (default timeout: 5 s)
await client.setPower(0xa3f1, true)
await client.setBrightness(0xa3f1, 200)
await client.setColor(0xa3f1, { h: 32768, s: 255, b: 200 })
await client.setAnimation(0xa3f1, AnimationId.BREATHE, { speed: 128, intensity: 200 })
await client.stopAnimation(0xa3f1)

// Fire-and-forget state request — listen for 'state_report' event
client.getState(0xa3f1)
```

> [!NOTE]
> **Dual brightness model** — `SET_COLOR` carries its own brightness component (`b`, the B in HSB), while `SET_BRIGHTNESS` is a separate master dimmer applied on top. The device computes `LED = color(H, S, B) × (BRIGHTNESS / 255)`. These two values are independent: dimming the master never changes the stored color.

### API

**`LumiClient`**

| Method | Returns | Description |
|--------|---------|-------------|
| `setPower(deviceId, on)` | `Promise<void>` | Turn device on/off |
| `setBrightness(deviceId, value)` | `Promise<void>` | Set master dimmer (0–255) |
| `setColor(deviceId, {h, s, b})` | `Promise<void>` | Set HSB color (h: 0–65535, s/b: 0–255) |
| `setAnimation(deviceId, animId, {speed, intensity})` | `Promise<void>` | Start animation |
| `stopAnimation(deviceId)` | `Promise<void>` | Stop animation, restore static state |
| `setZone(deviceId, zoneId)` | `Promise<void>` | Assign to zone (persisted on device) |
| `getState(deviceId)` | `void` | Request STATE_REPORT (listen for `state_report` event) |
| `send(frame)` | `void` | Send raw frame |

**Events:** `discovery(device)` · `state_report(deviceId, state)` · `ack(deviceId, seq, status)` · `error(deviceId, errorCode, faultyOpcode)`

**`LumiCodec`** — stateless encode/decode, usable without MQTT.

```typescript
const codec = new LumiCodec()
const buf = codec.encode(frame)      // Buffer
const frame = codec.decode(buf)      // LumiFrame — throws LumiDecodeError on bad CRC / version
```

**`DeviceRegistry`** — in-memory device catalogue.

```typescript
const registry = new DeviceRegistry()
client.on('discovery', (device) => registry.upsert(device.deviceId, device))
registry.list()                      // LumiDevice[]
registry.get(0xa3f1)                 // LumiDevice | undefined
registry.markUnreachable(0xa3f1)
```

## Arduino library (PlatformIO)

### Installation

Add to `platformio.ini`:

```ini
lib_deps =
    https://github.com/dejarn/lumi-protocol
```

### Usage

```cpp
#include <LumiProtocol.h>

LumiProtocol lumi;

void setup() {
  lumi.begin("MY_SSID", "MY_PASS", "192.168.1.10", "living-room-strip");

  lumi.onSetPower([](bool on) {
    // drive relay or PWM enable pin
  });

  lumi.onSetBrightness([](uint8_t brightness) {
    // update master dimmer
  });

  lumi.onSetColor([](uint16_t h, uint8_t s, uint8_t b) {
    // drive LED strip with HSB values
  });

  lumi.onSetAnimation([](uint8_t animId, uint8_t speed, uint8_t intensity) {
    // start animation loop
  });

  lumi.onStopAnimation([]() {
    // restore static state
  });

  lumi.onGetState([]() -> LumiState {
    return { power, brightness, h, s, colorBri, LUMI_ANIM_NONE };
  });
}

void loop() {
  lumi.loop();   // non-blocking — MQTT poll, frame dispatch, ACK/error emission
}
```

The library owns WiFi and MQTT connection management, frame parsing and CRC validation, NVS persistence for zone assignments, ACK emission, and device discovery announcement. The sketch only manages GPIO and LED state.

**`LumiState`**

```cpp
struct LumiState {
  uint8_t  power;      // 0x00 = off, 0x01 = on
  uint8_t  brightness; // master dimmer, 0–255
  uint16_t h;          // hue, 0–65535 (0°–360°, big-endian)
  uint8_t  s;          // saturation, 0–255
  uint8_t  colorBri;   // HSB brightness component, 0–255
  uint8_t  animId;     // LUMI_ANIM_NONE (0x00) if no animation running
};
```

## Development

```bash
# Node.js library (from bridge/node/)
pnpm test          # vitest suite
pnpm test:watch    # watch mode
pnpm build         # tsc → dist/
pnpm typecheck     # type-check without emit

# Arduino library (PlatformIO)
pio test -e native-test   # googletest native suite
pio run                   # build for ESP32
pio run -t upload         # flash to connected ESP32
```

The spec in [`spec/v1/`](spec/v1/) is the source of truth for both libraries. When adding features, update the spec first — see the [adding an opcode](CLAUDE.md) workflow.
