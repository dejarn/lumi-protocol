# Consuming lumi-protocol in your projects

_Last updated: 2026-06-05_

This guide explains how to use the lumi-protocol libraries from other GitHub repositories. There is no public npm or PlatformIO registry publish — dependencies come from this repo directly.

## Overview

lumi-protocol is a monorepo. Each consumer project points at the relevant subdirectory:

| Subdirectory | Platform | Consumer project |
|--------------|----------|------------------|
| `bridge/node/` | TypeScript / Node.js | mqtt-bridge (Raspberry Pi) |
| `device/arduino/` | C++ / Arduino (ESP32) | Firmware projects (PlatformIO) |

Both libraries share the same spec in [`spec/v1/`](../spec/v1/). Pin versions with git tags on this repo (e.g. `v1.0.0`) to keep bridge and firmware aligned.

## Node.js — mqtt-bridge

### Install

From your consumer project (pnpm or npm):

```bash
pnpm add github:dejarn/lumi-protocol#main:bridge/node
pnpm add mqtt
```

Equivalent `package.json` entry with a pinned tag:

```json
{
  "dependencies": {
    "lumi-protocol": "github:dejarn/lumi-protocol#v1.0.0:bridge/node",
    "mqtt": "^5.0.0"
  }
}
```

Replace `#v1.0.0` with the tag or branch you want. The `:bridge/node` suffix tells the package manager to install from that subdirectory.

### Notes

- **`mqtt` is required in the consumer project.** `LumiClient` accepts an existing `mqtt.js` client via a duck-typed interface; the library does not bundle `mqtt` as a runtime dependency. mqtt-bridge already has `mqtt` installed — running `pnpm add mqtt` is a no-op or version bump at most, but both commands are listed here for clarity.
- **`prepare` builds on install.** The package runs `tsc` during install to produce `dist/`. No separate build step is needed in the consumer project.
- **API reference:** see [`docs/api.md`](api.md) for method signatures, events, and wiring patterns.

### Wire up

```typescript
import mqtt from 'mqtt'
import { LumiCodec, LumiClient, DeviceRegistry } from 'lumi-protocol'

const mqttClient = mqtt.connect('mqtt://broker')
const codec      = new LumiCodec()
const client     = new LumiClient(mqttClient, codec)
const registry   = new DeviceRegistry()

client.on('discovery', (device) => {
  registry.upsert(device.deviceId, device)
})

client.on('state_report', (deviceId, state) => {
  // persist or forward state
})

await client.setPower(0xa3f1, true)
```

Pass your existing `mqtt.js` client to `LumiClient` — do not create a second broker connection.

### Update

```bash
pnpm update lumi-protocol
```

Or bump the tag in `package.json` and run `pnpm install`.

---

## Arduino — ESP32 firmware (PlatformIO)

### Install (recommended: git submodule)

A bare GitHub URL in `lib_deps` does **not** work — PlatformIO expects `library.properties` at the repo root, but this library lives in `device/arduino/`.

Add the repo as a submodule in your firmware project:

```bash
git submodule add https://github.com/dejarn/lumi-protocol.git vendor/lumi-protocol
```

Then in `platformio.ini`:

```ini
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino

lib_deps =
    knolleary/PubSubClient @ ^2.8

lib_extra_dirs =
    vendor/lumi-protocol/device
```

PlatformIO discovers `arduino/` as the `LumiProtocol` library. `LumiCodec` is a private codec dependency declared in `arduino/library.json` — its source is compiled automatically alongside `LumiProtocol` with no extra steps. `PubSubClient` is a required dependency (declared in `arduino/library.json`).

### Local development alternative

When both repos sit side by side on the same machine:

```ini
lib_deps =
    knolleary/PubSubClient @ ^2.8
    file://../../lumi-protocol/device/arduino
```

This path is not portable across machines or CI — prefer the submodule approach for anything shared.

### Wire up

See [`device/arduino/examples/basic/basic.ino`](../device/arduino/examples/basic/basic.ino) for a complete sketch. Minimal pattern:

```cpp
#include <LumiProtocol.h>

LumiProtocol lumi;

void setup() {
  lumi.begin("MY_SSID", "MY_PASS", "192.168.1.10", "living-room-strip");        // port 1883 (default)
  // lumi.begin("MY_SSID", "MY_PASS", "192.168.1.10", "living-room-strip", 8883); // custom port

  lumi.onSetPower([](bool on) { /* drive GPIO */ });
  lumi.onSetColor([](uint16_t h, uint8_t s, uint8_t b) { /* drive GPIO */ });
  lumi.onGetState([]() -> LumiState { return currentState; });
}

void loop() {
  lumi.loop();
}
```

The library owns WiFi, MQTT, frame parsing, CRC validation, NVS (zone assignments), ACK emission, and discovery. Your sketch handles GPIO and LED driving via callbacks. `SET_ZONE` is handled internally — no callback needed.

### Update

```bash
cd vendor/lumi-protocol
git fetch
git checkout v1.0.0
cd ../..
git add vendor/lumi-protocol
git commit -m "chore: bump lumi-protocol to v1.0.0"
```

---

## Version alignment

Tag releases on this repo after spec changes. Both consumer projects should reference the same tag:

| Consumer | Pin method |
|----------|------------|
| mqtt-bridge | `github:dejarn/lumi-protocol#v1.0.0:bridge/node` in `package.json` |
| Firmware | Submodule checkout at tag `v1.0.0` |

**Compatibility rule:** opcodes are additive only ([`spec/v1/opcodes.yaml`](../spec/v1/opcodes.yaml)). A newer bridge can talk to an older firmware, but not the reverse if the bridge sends opcodes the firmware does not implement.

---

## Checklists

### mqtt-bridge

- [ ] Add `lumi-protocol` from GitHub (`:bridge/node` subdirectory)
- [ ] Ensure `mqtt` is present (`pnpm add mqtt`)
- [ ] Wire `LumiClient` on the existing MQTT client
- [ ] Listen for `discovery` and `state_report` events
- [ ] Pin to a git tag matching the firmware version

### ESP32 firmware

- [ ] Add `lumi-protocol` as a git submodule
- [ ] Set `lib_extra_dirs = vendor/lumi-protocol/device` in `platformio.ini`
- [ ] Add `PubSubClient` to `lib_deps`
- [ ] Register GPIO callbacks in `setup()`, call `lumi.loop()` in `loop()`
- [ ] Pin submodule to the same git tag as mqtt-bridge
