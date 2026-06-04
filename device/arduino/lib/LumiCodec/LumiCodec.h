#pragma once
#include <stdint.h>
#include <stddef.h>

// ── Protocol constants ────────────────────────────────────────────────────────

constexpr uint8_t  LUMI_PROTO_VERSION  = 1;
constexpr uint8_t  LUMI_HEADER_SIZE    = 7;
constexpr uint8_t  LUMI_CRC_SIZE       = 2;
constexpr uint8_t  LUMI_MIN_FRAME_SIZE = 9;

constexpr uint16_t LUMI_CRC_POLY = 0x1021;
constexpr uint16_t LUMI_CRC_INIT = 0xFFFF;

// Max payload is DISCOVERY_ANNOUNCE: 5 fixed bytes + 32 UTF-8 name bytes
static constexpr size_t kLumiMaxPayloadLen = 37u;
static constexpr size_t kLumiMaxFrameLen   = LUMI_HEADER_SIZE + kLumiMaxPayloadLen + LUMI_CRC_SIZE; // 46

// ── Codec types ───────────────────────────────────────────────────────────────

struct LumiParsedFrame {
    uint8_t        ver;
    uint8_t        opc;
    uint16_t       deviceId;
    uint8_t        seq;
    const uint8_t* payload;   // points into caller's buffer — caller owns lifetime
    size_t         payloadLen;
};

enum class LumiCodecResult : uint8_t {
    OK = 0,
    ERR_PAYLOAD_TOO_LARGE,
    ERR_FRAME_TOO_SHORT,
    ERR_LENGTH_MISMATCH,
    ERR_CRC_MISMATCH,
    ERR_VERSION_MISMATCH,
};

// ── Codec functions ───────────────────────────────────────────────────────────

// CRC-16/CCITT: poly=0x1021, init=0xFFFF, no input/output reflection.
uint16_t lumiCrc16(const uint8_t* buf, size_t len);

// Fills outBuf with a complete wire frame. Returns total frame size, or 0 if
// payloadLen > kLumiMaxPayloadLen or outBufLen < kLumiMaxFrameLen.
size_t lumiBuildFrame(uint8_t ver, uint8_t opc, uint16_t deviceId, uint8_t seq,
                      const uint8_t* payload, size_t payloadLen,
                      uint8_t* outBuf, size_t outBufLen);

// Validates structure, CRC, and version. On success fills out; out.payload
// points into buf (caller must keep buf alive).
LumiCodecResult lumiParseFrame(const uint8_t* buf, size_t len, LumiParsedFrame& out);
