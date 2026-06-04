#include "LumiCodec.h"
#include <string.h>

uint16_t lumiCrc16(const uint8_t* buf, size_t len) {
    uint16_t crc = LUMI_CRC_INIT;
    for (size_t i = 0; i < len; ++i) {
        crc ^= static_cast<uint16_t>(buf[i]) << 8;
        for (uint8_t bit = 0; bit < 8; ++bit) {
            crc = (crc & 0x8000u) ? ((crc << 1) ^ LUMI_CRC_POLY) : (crc << 1);
        }
        crc &= 0xFFFFu;
    }
    return crc;
}

size_t lumiBuildFrame(uint8_t ver, uint8_t opc, uint16_t deviceId, uint8_t seq,
                      const uint8_t* payload, size_t payloadLen,
                      uint8_t* outBuf, size_t outBufLen) {
    if (payloadLen > kLumiMaxPayloadLen) return 0;

    const size_t totalLen = LUMI_HEADER_SIZE + payloadLen + LUMI_CRC_SIZE;
    if (outBufLen < totalLen) return 0;

    outBuf[0] = ver;
    outBuf[1] = opc;
    outBuf[2] = static_cast<uint8_t>(deviceId >> 8);
    outBuf[3] = static_cast<uint8_t>(deviceId & 0xFFu);
    outBuf[4] = seq;
    outBuf[5] = static_cast<uint8_t>(totalLen >> 8);
    outBuf[6] = static_cast<uint8_t>(totalLen & 0xFFu);

    if (payloadLen > 0 && payload != nullptr) {
        memcpy(outBuf + LUMI_HEADER_SIZE, payload, payloadLen);
    }

    const uint16_t crc = lumiCrc16(outBuf, LUMI_HEADER_SIZE + payloadLen);
    outBuf[totalLen - 2] = static_cast<uint8_t>(crc >> 8);
    outBuf[totalLen - 1] = static_cast<uint8_t>(crc & 0xFFu);

    return totalLen;
}

LumiCodecResult lumiParseFrame(const uint8_t* buf, size_t len, LumiParsedFrame& out) {
    if (len < static_cast<size_t>(LUMI_MIN_FRAME_SIZE))
        return LumiCodecResult::ERR_FRAME_TOO_SHORT;

    const size_t totalLen =
        (static_cast<uint16_t>(buf[5]) << 8) | buf[6];
    if (len != totalLen)
        return LumiCodecResult::ERR_LENGTH_MISMATCH;

    const uint16_t storedCrc =
        (static_cast<uint16_t>(buf[totalLen - 2]) << 8) | buf[totalLen - 1];
    if (lumiCrc16(buf, totalLen - LUMI_CRC_SIZE) != storedCrc)
        return LumiCodecResult::ERR_CRC_MISMATCH;

    if (buf[0] != LUMI_PROTO_VERSION)
        return LumiCodecResult::ERR_VERSION_MISMATCH;

    const size_t payloadLen = totalLen - LUMI_HEADER_SIZE - LUMI_CRC_SIZE;
    if (payloadLen > kLumiMaxPayloadLen)
        return LumiCodecResult::ERR_PAYLOAD_TOO_LARGE;

    out.ver        = buf[0];
    out.opc        = buf[1];
    out.deviceId   = (static_cast<uint16_t>(buf[2]) << 8) | buf[3];
    out.seq        = buf[4];
    out.payload    = buf + LUMI_HEADER_SIZE;
    out.payloadLen = payloadLen;

    return LumiCodecResult::OK;
}
