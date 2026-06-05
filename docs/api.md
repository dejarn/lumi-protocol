# API Design

_Last updated: 2026-05-20_

For installation in external projects, see [consumption.md](consumption.md).

lumi-protocol provides implementations for each target platform. Current implementations: `bridge/node` (TypeScript, consumed by the mqtt-bridge) and `device/arduino` (Arduino framework, flashed on IoT devices).

## bridge/node (TypeScript)

Three composable modules exported from the package root:

```typescript
import { LumiCodec, LumiClient, DeviceRegistry } from 'lumi-protocol'
```

**`LumiCodec`** — stateless encode/decode. No MQTT, no I/O. Testable in isolation. Throws `LumiDecodeError` on invalid buffer, bad CRC, or unsupported version.

**`LumiClient`** — receives an existing `mqtt.js` client (no second broker connection). Extends `EventEmitter` with typed events. High-level command methods return a `Promise` that resolves on ACK, plus a `send()` escape hatch for future opcodes.

**`DeviceRegistry`** — in-memory device catalogue. mqtt-bridge populates it from PostgreSQL at startup and delegates persistence to the database.

### Wiring (mqtt-bridge usage)

```typescript
const mqttClient = mqtt.connect('mqtt://localhost')
const codec      = new LumiCodec()
const client     = new LumiClient(mqttClient, codec)
const registry   = new DeviceRegistry()

client.on('discovery', (device) => {
  registry.upsert(device)
  db.upsertDevice(device)
})

client.on('state_report', (deviceId, state) => {
  db.updateDeviceState(deviceId, state)
})

await client.setPower('a3f1', true)
await client.setColor('a3f1', { h: 32768, s: 255, b: 200 })
await client.setAnimation('a3f1', 'BREATHE', { speed: 128, intensity: 200 })
```

### ACK behaviour

State-mutating commands wait for an `ACK` frame matching the sent `SEQ`. Timeout: 2 s, 3 retries. After 3 failures the `Promise` rejects with `LumiTimeoutError` and the device is marked unreachable in the registry.

### Brightness model

Two independent controls — changing one never alters the other:

- `color.b` — brightness component of the HSB color (which color is shown)
- `brightness` — master dimmer applied on top: `LED = color(h,s,b) × brightness/255`

## device/arduino (Arduino framework)

One class, standard Arduino pattern: `begin()` in `setup()`, `loop()` in `loop()`. Register one callback per opcode. The library owns MQTT, frame parsing, CRC validation, NVS reads/writes, and ACK emission. It never touches GPIO — LED driving stays in the sketch.

```cpp
LumiProtocol lumi;

void setup() {
  lumi.begin(WIFI_SSID, WIFI_PASS, BROKER_IP, "salon-strip-1");

  lumi.onSetPower([](bool on)                                       { /* drive GPIO */ });
  lumi.onSetBrightness([](uint8_t brightness)                       { /* drive GPIO */ });
  lumi.onSetColor([](uint16_t h, uint8_t s, uint8_t b)             { /* drive GPIO */ });
  lumi.onSetAnimation([](uint8_t id, uint8_t speed, uint8_t intens) { /* drive GPIO */ });
  lumi.onStopAnimation([]()                                         { /* drive GPIO */ });
  lumi.onGetState([]() -> LumiState { return ledStrip.getState(); });
}

void loop() {
  lumi.loop();       // non-blocking — MQTT, parsing, ACK dispatch
  ledStrip.loop();
}
```

`SET_ZONE` is handled entirely by the library (NVS write + MQTT resubscription). No callback needed.
