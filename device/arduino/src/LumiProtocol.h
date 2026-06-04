#pragma once

#include <Arduino.h>
#include <functional>

// ── Protocol constants ────────────────────────────────────────────────────────

constexpr uint8_t LUMI_PROTO_VERSION  = 1;
constexpr uint8_t LUMI_HEADER_SIZE    = 7;
constexpr uint8_t LUMI_CRC_SIZE       = 2;
constexpr uint8_t LUMI_MIN_FRAME_SIZE = 9;

// Opcodes — spec/v1/opcodes.yaml (additive only, never modify)
constexpr uint8_t LUMI_OPC_SET_POWER          = 0x01;
constexpr uint8_t LUMI_OPC_SET_BRIGHTNESS     = 0x02;
constexpr uint8_t LUMI_OPC_SET_COLOR          = 0x03;
constexpr uint8_t LUMI_OPC_SET_ANIMATION      = 0x04;
constexpr uint8_t LUMI_OPC_STOP_ANIMATION     = 0x05;
constexpr uint8_t LUMI_OPC_SET_ZONE           = 0x06;
constexpr uint8_t LUMI_OPC_GET_STATE          = 0x07;
constexpr uint8_t LUMI_OPC_STATE_REPORT       = 0x20;
constexpr uint8_t LUMI_OPC_ACK               = 0x21;
constexpr uint8_t LUMI_OPC_DISCOVERY_REQUEST  = 0x40;
constexpr uint8_t LUMI_OPC_DISCOVERY_ANNOUNCE = 0x41;
constexpr uint8_t LUMI_OPC_ERROR             = 0x50;

// Animation IDs
constexpr uint8_t LUMI_ANIM_NONE    = 0x00;
constexpr uint8_t LUMI_ANIM_PULSE   = 0x01;
constexpr uint8_t LUMI_ANIM_BREATHE = 0x02;
constexpr uint8_t LUMI_ANIM_FLASH   = 0x03;
constexpr uint8_t LUMI_ANIM_STROBE  = 0x04;
constexpr uint8_t LUMI_ANIM_RAINBOW = 0x05;

// CRC-16/CCITT
constexpr uint16_t LUMI_CRC_POLY = 0x1021;
constexpr uint16_t LUMI_CRC_INIT = 0xFFFF;

// ── Data types ────────────────────────────────────────────────────────────────

struct LumiState {
  uint8_t  power;       // 0x00 = off, 0x01 = on
  uint8_t  brightness;  // master dimmer
  uint16_t h;           // hue, big-endian, 0–65535 → 0°–360°
  uint8_t  s;           // saturation
  uint8_t  b;           // brightness component of HSB color
  uint8_t  animId;      // 0x00 if no animation running
};

// ── Callback typedefs ─────────────────────────────────────────────────────────

using OnSetPower       = std::function<void(bool on)>;
using OnSetBrightness  = std::function<void(uint8_t brightness)>;
using OnSetColor       = std::function<void(uint16_t h, uint8_t s, uint8_t b)>;
using OnSetAnimation   = std::function<void(uint8_t animId, uint8_t speed, uint8_t intensity)>;
using OnStopAnimation  = std::function<void()>;
using OnGetState       = std::function<LumiState()>;

// ── LumiProtocol ─────────────────────────────────────────────────────────────

class LumiProtocol {
public:
  LumiProtocol() = default;

  void begin(const char* wifiSsid, const char* wifiPass,
             const char* brokerIp, const char* deviceName);

  void loop();

  void onSetPower(OnSetPower cb)           { _onSetPower = cb; }
  void onSetBrightness(OnSetBrightness cb) { _onSetBrightness = cb; }
  void onSetColor(OnSetColor cb)           { _onSetColor = cb; }
  void onSetAnimation(OnSetAnimation cb)   { _onSetAnimation = cb; }
  void onStopAnimation(OnStopAnimation cb) { _onStopAnimation = cb; }
  void onGetState(OnGetState cb)           { _onGetState = cb; }

private:
  OnSetPower      _onSetPower;
  OnSetBrightness _onSetBrightness;
  OnSetColor      _onSetColor;
  OnSetAnimation  _onSetAnimation;
  OnStopAnimation _onStopAnimation;
  OnGetState      _onGetState;
};
