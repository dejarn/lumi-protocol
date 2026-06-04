# lumi-protocol — Specification v1

_Last updated: 2026-05-20_

lumi-protocol is a lightweight binary protocol for controlling LED strips on custom ESP32 devices within the Lumi home automation system. It operates as the payload layer on top of MQTT, with topic structure handling routing and frame structure carrying identity and commands.

**Stack:**
```
Home Assistant / Next.js + mqtt-bridge (Raspberry Pi)
        │
      MQTT (Mosquitto broker)
        │
   lumi-protocol frames (binary)
        │
    ESP32 devices (LED strip controllers)
```

Zigbee devices (Philips Hue, presence sensors) use their native protocols. lumi-protocol applies exclusively to custom ESP32 devices.

## Design Principles

- **Additive only:** Opcodes are never modified or removed — only new ones are added in future versions.
- **Fixed header:** Parsers always know the header size; payload length is embedded in the frame.
- **MQTT-routed:** Topic structure handles addressing. The frame carries identity, not routing.
- **Version-negotiated:** Each device announces its protocol version at boot. The controller adapts per device.
- **ACK on state-changing commands only:** Fire-and-forget for queries and discovery; acknowledged for mutations.

## Frame Structure

Every lumi-protocol frame has the following layout:

```
 0       1       2       3       4       5       6       7      7+N    9+N
 +-------+-------+-------+-------+-------+-------+-------+--//--+-------+
 |  VER  |  OPC  |   DEVICE_ID   |  SEQ  |   TOTAL_LEN   |PAYLOAD|  CRC  |
 +-------+-------+-------+-------+-------+-------+-------+--//--+-------+
   1 byte  1 byte    2 bytes       1 byte    2 bytes       N bytes  2 bytes
```

### Field Definitions

| Field | Size | Description |
|---|---|---|
| `VER` | 1 byte | Protocol version. `0x01` for this specification. |
| `OPC` | 1 byte | Opcode. See [opcodes.yaml](opcodes.yaml). |
| `DEVICE_ID` | 2 bytes | Unique device identifier, big-endian. Derived from the last 2 bytes of the ESP32's WiFi MAC address. `0xFFFF` = broadcast. |
| `SEQ` | 1 byte | Sequence number, 0–255 wrapping. Used to match ACK responses to commands. Incremented per command by the sender. |
| `TOTAL_LEN` | 2 bytes | Total frame length in bytes (header + payload + CRC), big-endian. Minimum value: `0x0009` (9 bytes, empty payload). |
| `PAYLOAD` | N bytes | Opcode-dependent. See Payloads section below. |
| `CRC` | 2 bytes | CRC-16/CCITT (initial value `0xFFFF`, polynomial `0x1021`) computed over all bytes from `VER` through the last byte of `PAYLOAD`. |

### Minimum Frame

A frame with no payload is 9 bytes:

```
VER OPC DEVICE_ID[0] DEVICE_ID[1] SEQ TOTAL_LEN[0] TOTAL_LEN[1] CRC[0] CRC[1]
```

## MQTT Topic Structure

MQTT topics handle all routing. The frame payload does not embed destination addresses.

```
lumi/zone/{zone_id}/cmd          →  Raspberry Pi → all ESP32s in a zone
lumi/device/{device_id}/cmd      →  Raspberry Pi → specific ESP32 (hex, e.g. "a3f1")
lumi/device/{device_id}/state    →  ESP32 → Raspberry Pi (STATE_REPORT, ACK, ERROR)
lumi/discovery/request           →  Raspberry Pi → all ESP32s (broadcast)
lumi/discovery/announce          →  ESP32 → Raspberry Pi
```

`{zone_id}` is a 1-byte integer rendered as decimal (e.g. `lumi/zone/1/cmd`).  
`{device_id}` is the 2-byte DEVICE_ID rendered as lowercase hex (e.g. `lumi/device/a3f1/cmd`).

### ESP32 Subscriptions (on boot)

Each ESP32 subscribes to:
1. `lumi/device/{own_device_id}/cmd`
2. `lumi/zone/{zone_id}/cmd` — `zone_id` read from NVS; default `0x00` if unset
3. `lumi/discovery/request`

When `SET_ZONE` is received, the ESP32 unsubscribes from the old zone topic and resubscribes to the new one.

## Payloads

### Commands (Raspberry Pi → ESP32)

#### `SET_POWER` (0x01)
```
[STATE:1]
```
`STATE`: `0x00` = off, `0x01` = on.

#### `SET_BRIGHTNESS` (0x02)
```
[BRIGHTNESS:1]
```
`BRIGHTNESS`: 0–255. `0x00` = minimum, `0xFF` = maximum. This is a **master dimmer** applied on top of the current color — see [Brightness model](#brightness-model).

#### `SET_COLOR` (0x03)
```
[H:2][S:1][B:1]
```
`H`: Hue, 0–65535 (maps to 0°–360°), big-endian.  
`S`: Saturation, 0–255.  
`B`: Brightness component of the HSB color, 0–255. Defines the color itself, **not** the global strip level — see [Brightness model](#brightness-model).

#### `SET_ANIMATION` (0x04)
```
[ANIM_ID:1][SPEED:1][INTENSITY:1]
```
`ANIM_ID`: See Animation IDs section.  
`SPEED`: 0–255 (animation period; interpretation is animation-specific).  
`INTENSITY`: 0–255 (effect strength; interpretation is animation-specific).

#### `STOP_ANIMATION` (0x05)
```
(empty payload)
```
Stops any running animation and returns to the last static state.

#### `SET_ZONE` (0x06)
```
[ZONE_ID:1]
```
Persists `ZONE_ID` to NVS and resubscribes to the corresponding MQTT zone topic.

#### `GET_STATE` (0x07)
```
(empty payload)
```
Requests a `STATE_REPORT` from the device. No ACK — the `STATE_REPORT` is the response.

### State (ESP32 → Raspberry Pi)

#### `STATE_REPORT` (0x20)
```
[POWER:1][BRIGHTNESS:1][H:2][S:1][B:1][ANIM_ID:1]
```
Published to `lumi/device/{device_id}/state` after every executed state-changing command, and in response to `GET_STATE`.

| Field | Size | Description |
|---|---|---|
| `POWER` | 1 byte | `0x00` = off, `0x01` = on |
| `BRIGHTNESS` | 1 byte | 0–255 |
| `H` | 2 bytes | Hue, 0–65535, big-endian |
| `S` | 1 byte | Saturation, 0–255 |
| `B` | 1 byte | Brightness (color), 0–255 |
| `ANIM_ID` | 1 byte | Running animation, `0x00` if none |

#### `ACK` (0x21)
```
[ACK_SEQ:1][STATUS:1]
```
`ACK_SEQ`: SEQ value from the command being acknowledged.  
`STATUS`: `0x00` = success, `0x01` = error.

Published to `lumi/device/{device_id}/state`.

### Discovery

#### `DISCOVERY_REQUEST` (0x40)
```
(empty payload)
```
Published by the Raspberry Pi to `lumi/discovery/request`. All ESP32s respond with `DISCOVERY_ANNOUNCE`.

#### `DISCOVERY_ANNOUNCE` (0x41)
```
[DEVICE_TYPE:1][CAPABILITIES:1][PROTO_VERSION:1][ZONE_ID:1][NAME_LEN:1][NAME:N]
```
Published by each ESP32 to `lumi/discovery/announce` at boot and in response to `DISCOVERY_REQUEST`.

| Field | Size | Description |
|---|---|---|
| `DEVICE_TYPE` | 1 byte | `0x01` = LED strip controller |
| `CAPABILITIES` | 1 byte | Bitmask: bit 0 = color, bit 1 = animation, bit 2 = dimming |
| `PROTO_VERSION` | 1 byte | Protocol version supported by this device (e.g. `0x01`) |
| `ZONE_ID` | 1 byte | Current zone from NVS |
| `NAME_LEN` | 1 byte | Length of `NAME` in bytes (0–32) |
| `NAME` | N bytes | UTF-8 device name (e.g. "salon-strip-1"), not null-terminated |

### Error

#### `ERROR` (0x50)
```
[ERROR_CODE:1][FAULTY_OPCODE:1]
```
Published to `lumi/device/{device_id}/state`.

| `ERROR_CODE` | Meaning |
|---|---|
| `0x01` | Unknown opcode |
| `0x02` | Invalid payload length |
| `0x03` | CRC mismatch |
| `0x04` | Version mismatch |
| `0x05` | NVS write failure |

## Animation IDs

| ID | Name | Description |
|---|---|---|
| `0x00` | NONE | No animation (static state) |
| `0x01` | PULSE | Brightness pulses up and down |
| `0x02` | BREATHE | Slow sinusoidal brightness fade |
| `0x03` | FLASH | Hard on/off blink |
| `0x04` | STROBE | Rapid flash |
| `0x05` | RAINBOW | Hue cycles through full spectrum |

`SPEED` and `INTENSITY` semantics are animation-specific and documented in the implementation.

## Brightness model

lumi-protocol carries **two independent brightness controls**, modeled on Philips Hue (separate color and luminosity sliders):

| Control | Opcode / field | Role |
|---|---|---|
| HSB `B` | `SET_COLOR` (0x03), byte 4 | Brightness *component of the color*. Defines which color is shown (e.g. a dark vs. vivid red). |
| `BRIGHTNESS` | `SET_BRIGHTNESS` (0x02) | **Master dimmer**. Global strip level applied on top of the current color. |

The final per-LED output is:

```
LED = color(H, S, B) × (BRIGHTNESS / 255)
```

The two are orthogonal: changing `BRIGHTNESS` never alters the stored color, and `SET_COLOR` never alters the master dimmer. `STATE_REPORT` reports both fields independently (`BRIGHTNESS` at byte 1, `B` at byte 5). Both libraries MUST apply this multiplication identically.

## ACK Rules

| Opcode | ACK required |
|---|---|
| `SET_POWER` (0x01) | Yes |
| `SET_BRIGHTNESS` (0x02) | Yes |
| `SET_COLOR` (0x03) | Yes |
| `SET_ANIMATION` (0x04) | Yes |
| `STOP_ANIMATION` (0x05) | Yes |
| `SET_ZONE` (0x06) | Yes |
| `GET_STATE` (0x07) | No — answered by `STATE_REPORT` |
| `DISCOVERY_*` | No |
| `ERROR` | No |

**Retransmission policy (Raspberry Pi side):** If no ACK is received within 2 seconds, retransmit with the same `SEQ`. Maximum 3 attempts. After 3 failures, log an error and mark device as unreachable.

## Version Negotiation

1. ESP32 boots, publishes `DISCOVERY_ANNOUNCE` with its `PROTO_VERSION`.
2. Raspberry Pi records `PROTO_VERSION` per `DEVICE_ID`.
3. When sending commands to a device, the controller sets `VER` in the frame to the device's announced version.
4. If a device receives a frame with an unsupported `VER`, it replies with `ERROR` code `0x04`.

This allows the Raspberry Pi to manage a mixed fleet during firmware rollouts.

## DEVICE_ID Assignment

`DEVICE_ID` is derived from the last 2 bytes of the ESP32's WiFi MAC address (bytes 4 and 5, big-endian). This is deterministic and requires no configuration.

Example: MAC `AA:BB:CC:DD:A3:F1` → `DEVICE_ID = 0xA3F1` → topic suffix `a3f1`.

In the unlikely event of a collision in a domestic deployment, reassign one device via NVS override.

## Extensibility

- New opcodes are assigned in the next available range within the appropriate category.
- Existing opcode values and payload layouts are **never modified**.
- New versions increment `VER` and are documented in [../CHANGELOG.md](../CHANGELOG.md).
