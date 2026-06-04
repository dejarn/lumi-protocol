# lumi-protocol — Changelog

All notable protocol changes are documented here.  
Format: [SemVer](https://semver.org) — protocol version maps to `VER` byte in frame header.

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
