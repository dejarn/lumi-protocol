# lumi-protocol — Changelog

All notable protocol changes are documented here.  
Format: [SemVer](https://semver.org) — protocol version maps to `VER` byte in frame header.

---

## [Unreleased]

Documentation/clarification only — no frame or opcode change.

### Changed
- ACK delivery policy clarified to **best-effort**: 5 s timeout, no automatic retransmission, ACK timeout does not affect reachability. Supersedes the earlier "retransmit 3× at 2 s" wording, which was never implemented and contradicted the bridge's best-effort design.

### Added (bridge/node)
- `LumiClient.discover()` — broadcasts `DISCOVERY_REQUEST` (DEVICE_ID `0xFFFF`) on `lumi/discovery/request`.

### Fixed (bridge/node)
- `/cmd` topic now renders DEVICE_ID as lowercase 4-digit hex (`a3f1`), matching device subscriptions and the spec. Previously published to a decimal topic, so commands never reached devices.
- `setZone` / device `SET_ZONE` now reject reserved `ZONE_ID 0xFF`.

---

## [1.1.0] — 2026-06-05

Transport-only additions. **No frame change** — the `VER` byte stays `0x01`; existing devices and parsers are unaffected.

### Transport
- Added device availability via MQTT Last Will & Testament on `lumi/device/{device_id}/availability` — retained string `"online"`/`"offline"`. Plain payload, outside the binary framing (no opcode).
- `STATE_REPORT` is now published **retained** on `lumi/device/{device_id}/state` so late subscribers get the last known state immediately.

---

## [1.0.0] — 2026-05-20

Initial specification.

### Frame
- Fixed 7-byte header: `VER`, `OPC`, `DEVICE_ID` (2B), `SEQ`, `TOTAL_LEN` (2B)
- CRC-16/CCITT (2 bytes) appended after payload
- Big-endian byte order throughout
- `DEVICE_ID 0xFFFF` reserved for broadcast

### Opcodes
- `0x01` SET_POWER
- `0x02` SET_BRIGHTNESS
- `0x03` SET_COLOR (HSB)
- `0x04` SET_ANIMATION
- `0x05` STOP_ANIMATION
- `0x06` SET_ZONE
- `0x07` GET_STATE
- `0x20` STATE_REPORT
- `0x21` ACK
- `0x40` DISCOVERY_REQUEST
- `0x41` DISCOVERY_ANNOUNCE
- `0x50` ERROR

### Transport
- MQTT topic structure: zone, device, discovery
- ACK on state-mutating commands; retransmit 3× with 2s timeout
- Version negotiation via `DISCOVERY_ANNOUNCE.PROTO_VERSION`
- Zone membership persisted to ESP32 NVS
