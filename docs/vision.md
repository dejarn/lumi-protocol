# Vision

_Last updated: 2026-05-20_

lumi-protocol is a lightweight binary protocol for controlling custom LED strip devices over MQTT. It defines the exact byte layout of every frame, a versioned opcode registry, MQTT topic conventions, and discovery and acknowledgement rules. Two implementations share the spec: `device/arduino` (C++ / Arduino on ESP32) and `bridge/node` (TypeScript for the mqtt-bridge on the Raspberry Pi).

## Problem

The Lumi home automation system controls both off-the-shelf devices (Philips Hue, Zigbee sensors) and custom LED strip controllers built on ESP32. These custom devices need a communication layer to interact with the central Raspberry Pi.

JSON over MQTT, while simple, is too verbose for embedded constraints and lacks the structure needed for versioning, ACK tracking, and device discovery. A binary protocol with a fixed header and a machine-readable opcode registry provides predictable frame sizes, efficient parsing on the ESP32, and a stable contract between the two sides of the system.

## Out of scope

- Zigbee devices — Philips Hue and presence sensors use their native protocols via Zigbee2MQTT
- Home Assistant internals — lumi-protocol sits below HA; HA communicates with the mqtt-bridge
- MQTT broker configuration — Mosquitto is assumed to be running and reachable
- OTA firmware updates for ESP32
- Physical input handling — ESP32 boards in this system have no buttons or switches
- Multi-room audio, HVAC, or any non-lighting device

## Core concepts

| Concept | Definition |
|---|---|
| **Device** | One ESP32 controlling one LED strip. Identified by a 2-byte ID derived from its WiFi MAC address. |
| **Zone** | A logical grouping of devices (e.g. "salon", "couloir"). Commands can target a zone instead of a specific device. Zone membership is stored on the device in NVS and persists across reboots. |
| **Frame** | A binary message — fixed 7-byte header, variable payload, 2-byte CRC. The unit of communication in lumi-protocol. |
| **Opcode** | A 1-byte code identifying the operation carried by a frame. Opcodes are additive: new ones are added in future versions, existing ones are never modified. |
| **Animation** | A predefined light effect (pulse, breathe, flash, strobe, rainbow) executed locally on the ESP32, parameterised by speed and intensity. |
| **Discovery** | The handshake at boot: each ESP32 announces its device type, capabilities, protocol version, and zone to the Raspberry Pi. |
| **ACK** | An acknowledgement frame sent by the ESP32 after a state-changing command. The Raspberry Pi retransmits up to 3 times on timeout. |
| **Version negotiation** | Each device announces the protocol version it supports. The Raspberry Pi adapts its framing per device, enabling a mixed fleet during firmware rollouts. |

## Actors

| Actor | Role |
|---|---|
| **Raspberry Pi (mqtt-bridge)** | Runs `bridge/node`. Sends commands, handles discovery, manages retransmission, tracks device state. Sits between the Next.js app and the ESP32 fleet. |
| **ESP32** | Runs `device/arduino`. Receives commands, executes them, reports state, announces itself at boot. |
| **Next.js app** | Orchestrator and UI. Communicates with the mqtt-bridge via internal HTTP; unaware of lumi-protocol internals. |

## Accepted trade-offs

- **HSB over RGB** — chosen for consistency with Philips Hue. Hue is encoded on 2 bytes (0–65535) for full angular precision.
- **DEVICE_ID from MAC** — last 2 bytes of the WiFi MAC. Automatic, no configuration needed. Collision is theoretically possible but negligible at domestic scale.
- **Predefined animations only (v1)** — custom sequences are deferred to v2. Keeps ESP32 parsing simple.
- **Fire-and-forget on non-mutating operations** — `GET_STATE`, discovery, and errors carry no ACK. Only state-changing commands are acknowledged.
- **Zone broadcast is best-effort** — when a command targets a zone, the Raspberry Pi cannot know which specific devices received it. Individual `STATE_REPORT` responses provide confirmation.
