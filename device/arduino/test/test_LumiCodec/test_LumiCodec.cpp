#include <gtest/gtest.h>
#include <vector>
#include "LumiCodec.h"

int main(int argc, char** argv) {
    ::testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

static size_t buildTestFrame(uint8_t opc, const uint8_t* pl, size_t plLen,
                              uint8_t* buf, uint16_t deviceId = 0xA3F1, uint8_t seq = 0x01) {
    return lumiBuildFrame(LUMI_PROTO_VERSION, opc, deviceId, seq, pl, plLen, buf, kLumiMaxFrameLen);
}

// ── CRC-16/CCITT tests ────────────────────────────────────────────────────────

TEST(Crc16, EmptyBuffer) {
    EXPECT_EQ(lumiCrc16(nullptr, 0), 0xFFFFu);
}

TEST(Crc16, SingleZeroByte) {
    const uint8_t data[] = {0x00};
    EXPECT_EQ(lumiCrc16(data, 1), 0xE1F0u);
}

TEST(Crc16, CrossCheck) {
    // Build a frame, then verify the stored CRC matches a fresh lumiCrc16 call.
    uint8_t buf[kLumiMaxFrameLen];
    const uint8_t pl[] = {0x01};
    const size_t total = buildTestFrame(0x01, pl, 1, buf);
    ASSERT_GT(total, static_cast<size_t>(LUMI_CRC_SIZE));

    const uint16_t storedCrc =
        (static_cast<uint16_t>(buf[total - 2]) << 8) | buf[total - 1];
    const uint16_t computed = lumiCrc16(buf, total - LUMI_CRC_SIZE);
    EXPECT_EQ(computed, storedCrc);
}

// ── lumiBuildFrame tests ──────────────────────────────────────────────────────

TEST(BuildFrame, SetPowerOn) {
    uint8_t buf[kLumiMaxFrameLen];
    const uint8_t pl[] = {0x01};
    const size_t total = buildTestFrame(0x01, pl, 1, buf);

    EXPECT_EQ(total, 10u);                   // 7 header + 1 payload + 2 CRC
    EXPECT_EQ(buf[0], LUMI_PROTO_VERSION);
    EXPECT_EQ(buf[1], 0x01u);               // opc SET_POWER
}

TEST(BuildFrame, EmptyPayload) {
    uint8_t buf[kLumiMaxFrameLen];
    const size_t total = buildTestFrame(0x05, nullptr, 0, buf);  // STOP_ANIMATION

    EXPECT_EQ(total, static_cast<size_t>(LUMI_MIN_FRAME_SIZE));
}

TEST(BuildFrame, PayloadTooLarge) {
    uint8_t buf[kLumiMaxFrameLen];
    uint8_t oversized[kLumiMaxPayloadLen + 1] = {};
    EXPECT_EQ(buildTestFrame(0x01, oversized, sizeof(oversized), buf), 0u);
}

TEST(BuildFrame, FieldLayout) {
    uint8_t buf[kLumiMaxFrameLen];
    const uint8_t pl[] = {0xAB};
    const size_t total = buildTestFrame(0x02, pl, 1, buf, /*deviceId=*/0x1234, /*seq=*/0x07);

    EXPECT_EQ(buf[0], LUMI_PROTO_VERSION);  // VER @ 0
    EXPECT_EQ(buf[1], 0x02u);              // OPC @ 1
    EXPECT_EQ(buf[2], 0x12u);              // DEVICE_ID high @ 2
    EXPECT_EQ(buf[3], 0x34u);              // DEVICE_ID low  @ 3
    EXPECT_EQ(buf[4], 0x07u);              // SEQ @ 4
    EXPECT_EQ(buf[5], 0x00u);              // TOTAL_LEN high @ 5
    EXPECT_EQ(buf[6], 0x0Au);             // TOTAL_LEN low  @ 6 (10 bytes)
    EXPECT_EQ(buf[7], 0xABu);              // payload @ 7
    // buf[8], buf[9] = CRC (big-endian)
    EXPECT_EQ(total, 10u);
}

TEST(BuildFrame, BroadcastDeviceId) {
    uint8_t buf[kLumiMaxFrameLen];
    buildTestFrame(0x07, nullptr, 0, buf, /*deviceId=*/0xFFFF);

    EXPECT_EQ(buf[2], 0xFFu);
    EXPECT_EQ(buf[3], 0xFFu);
}

// ── lumiParseFrame tests ──────────────────────────────────────────────────────

TEST(ParseFrame, ValidFrame) {
    uint8_t buf[kLumiMaxFrameLen];
    const uint8_t pl[] = {0x01};
    const size_t total = buildTestFrame(0x01, pl, 1, buf, 0xBEEF, 0x42);

    LumiParsedFrame f;
    EXPECT_EQ(lumiParseFrame(buf, total, f), LumiCodecResult::OK);
    EXPECT_EQ(f.ver,        LUMI_PROTO_VERSION);
    EXPECT_EQ(f.opc,        0x01u);
    EXPECT_EQ(f.deviceId,   0xBEEFu);
    EXPECT_EQ(f.seq,        0x42u);
    ASSERT_EQ(f.payloadLen, 1u);
    EXPECT_EQ(f.payload[0], 0x01u);
}

TEST(ParseFrame, TooShort) {
    uint8_t buf[8] = {0x01, 0x01, 0x00, 0x01, 0x01, 0x00, 0x08, 0x00};
    LumiParsedFrame f;
    EXPECT_EQ(lumiParseFrame(buf, 8, f), LumiCodecResult::ERR_FRAME_TOO_SHORT);
}

TEST(ParseFrame, LengthMismatch) {
    uint8_t buf[kLumiMaxFrameLen];
    const uint8_t pl[] = {0x01};
    const size_t total = buildTestFrame(0x01, pl, 1, buf);

    // Feed one extra byte (actual len ≠ TOTAL_LEN field)
    LumiParsedFrame f;
    EXPECT_EQ(lumiParseFrame(buf, total - 1, f), LumiCodecResult::ERR_LENGTH_MISMATCH);
}

TEST(ParseFrame, CrcMismatch) {
    uint8_t buf[kLumiMaxFrameLen];
    const uint8_t pl[] = {0x01};
    const size_t total = buildTestFrame(0x01, pl, 1, buf);

    buf[total - 1] ^= 0xFF;  // corrupt last CRC byte
    LumiParsedFrame f;
    EXPECT_EQ(lumiParseFrame(buf, total, f), LumiCodecResult::ERR_CRC_MISMATCH);
}

TEST(ParseFrame, VersionMismatch) {
    uint8_t buf[kLumiMaxFrameLen];
    const uint8_t pl[] = {0x01};
    size_t total = buildTestFrame(0x01, pl, 1, buf);

    // Set VER=2, recompute CRC so it passes the CRC check first.
    buf[0] = 0x02;
    const uint16_t newCrc = lumiCrc16(buf, total - LUMI_CRC_SIZE);
    buf[total - 2] = static_cast<uint8_t>(newCrc >> 8);
    buf[total - 1] = static_cast<uint8_t>(newCrc & 0xFFu);

    LumiParsedFrame f;
    EXPECT_EQ(lumiParseFrame(buf, total, f), LumiCodecResult::ERR_VERSION_MISMATCH);
}

TEST(ParseFrame, PayloadPtrIntoBuffer) {
    uint8_t buf[kLumiMaxFrameLen];
    const uint8_t pl[] = {0xDE, 0xAD};
    const size_t total = buildTestFrame(0x03, pl, 2, buf);

    LumiParsedFrame f;
    lumiParseFrame(buf, total, f);
    // payload must point into buf, not a copy
    EXPECT_EQ(f.payload, buf + LUMI_HEADER_SIZE);
}

// ── Round-trip tests ──────────────────────────────────────────────────────────

static void roundTrip(uint8_t opc, const uint8_t* pl, size_t plLen) {
    uint8_t buf[kLumiMaxFrameLen];
    const size_t total = buildTestFrame(opc, pl, plLen, buf, 0xA3F1, 0x05);
    ASSERT_GT(total, 0u);

    LumiParsedFrame f;
    ASSERT_EQ(lumiParseFrame(buf, total, f), LumiCodecResult::OK);
    EXPECT_EQ(f.opc,        opc);
    EXPECT_EQ(f.deviceId,   0xA3F1u);
    EXPECT_EQ(f.seq,        0x05u);
    ASSERT_EQ(f.payloadLen, plLen);
    if (plLen > 0) {
        EXPECT_EQ(memcmp(f.payload, pl, plLen), 0);
    }
}

TEST(RoundTrip, SetPower)      { const uint8_t pl[] = {0x01};                     roundTrip(0x01, pl, sizeof(pl)); }
TEST(RoundTrip, SetBrightness) { const uint8_t pl[] = {0x80};                     roundTrip(0x02, pl, sizeof(pl)); }
TEST(RoundTrip, SetColor)      { const uint8_t pl[] = {0x01, 0x20, 0xFF, 0xFF};   roundTrip(0x03, pl, sizeof(pl)); }
TEST(RoundTrip, SetAnimation)  { const uint8_t pl[] = {0x01, 0x64, 0x80};         roundTrip(0x04, pl, sizeof(pl)); }
TEST(RoundTrip, StopAnimation) {                                                   roundTrip(0x05, nullptr, 0);     }
TEST(RoundTrip, GetState)      {                                                   roundTrip(0x07, nullptr, 0);     }
TEST(RoundTrip, StateReport)   { const uint8_t pl[] = {0x01,0x80,0x01,0x20,0xFF,0xFF,0x01}; roundTrip(0x20, pl, sizeof(pl)); }
TEST(RoundTrip, Ack)           { const uint8_t pl[] = {0x05, 0x00};               roundTrip(0x21, pl, sizeof(pl)); }
TEST(RoundTrip, DiscoveryAnnounce) {
    // 5 fixed + 10-char name "salon-led1"
    const uint8_t pl[] = {0x01, 0x07, 0x01, 0x00, 0x0A,
                           's','a','l','o','n','-','l','e','d','1'};
    roundTrip(0x41, pl, sizeof(pl));
}
TEST(RoundTrip, Error) { const uint8_t pl[] = {0x01, 0x03}; roundTrip(0x50, pl, sizeof(pl)); }

TEST(ParseFrame, PayloadTooLarge) {
    const size_t oversizedPayload = kLumiMaxPayloadLen + 1;
    const size_t totalLen = LUMI_HEADER_SIZE + oversizedPayload + LUMI_CRC_SIZE;
    std::vector<uint8_t> buf(totalLen, 0x00);
    buf[0] = LUMI_PROTO_VERSION;
    buf[5] = static_cast<uint8_t>(totalLen >> 8);
    buf[6] = static_cast<uint8_t>(totalLen & 0xFFu);
    const uint16_t crc = lumiCrc16(buf.data(), totalLen - LUMI_CRC_SIZE);
    buf[totalLen - 2] = static_cast<uint8_t>(crc >> 8);
    buf[totalLen - 1] = static_cast<uint8_t>(crc & 0xFFu);
    LumiParsedFrame f;
    EXPECT_EQ(lumiParseFrame(buf.data(), totalLen, f), LumiCodecResult::ERR_PAYLOAD_TOO_LARGE);
}
