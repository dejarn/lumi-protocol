#pragma once

#include <Arduino.h>
#include <functional>
#include <WiFi.h>
#include <PubSubClient.h>
#include <Preferences.h>

#include "LumiCodec.h"

// ── Opcodes — spec/v1/opcodes.yaml (additive only, never modify) ──────────────

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

// Device type and capability constants (DISCOVERY_ANNOUNCE payload bytes 0–1)
constexpr uint8_t LUMI_DEVICE_TYPE_LED_STRIP = 0x01u;
constexpr uint8_t LUMI_CAP_COLOR             = (1u << 0);
constexpr uint8_t LUMI_CAP_ANIMATION         = (1u << 1);
constexpr uint8_t LUMI_CAP_DIMMING           = (1u << 2);

static constexpr size_t kLumiTopicLen = 48u;

// ── Data types ────────────────────────────────────────────────────────────────

struct LumiState {
  uint8_t  power;       // 0x00 = off, 0x01 = on
  uint8_t  brightness;  // master dimmer
  uint16_t h;           // hue, big-endian, 0–65535 → 0°–360°
  uint8_t  s;           // saturation
  uint8_t  colorBri;    // HSB brightness component
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

  bool begin(const char* wifiSsid, const char* wifiPass,
             const char* brokerIp, const char* deviceName,
             uint16_t brokerPort = 1883);

  void loop();

  void onSetPower(OnSetPower cb)           { _onSetPower = cb; }
  void onSetBrightness(OnSetBrightness cb) { _onSetBrightness = cb; }
  void onSetColor(OnSetColor cb)           { _onSetColor = cb; }
  void onSetAnimation(OnSetAnimation cb)   { _onSetAnimation = cb; }
  void onStopAnimation(OnStopAnimation cb) { _onStopAnimation = cb; }
  void onGetState(OnGetState cb)           { _onGetState = cb; }

private:
    // ── MQTT / WiFi ───────────────────────────────────────────────────────────
    WiFiClient   _wifiClient;
    PubSubClient _mqtt;

    // ── Device identity ───────────────────────────────────────────────────────
    uint16_t _deviceId = 0;
    uint8_t       _zoneId          = 0;
    uint8_t       _seq             = 0;
    uint16_t      _brokerPort      = 1883;
    unsigned long _lastReconnectMs = 0;
    char     _deviceName[33] = {};     // null-terminated, max 32 UTF-8 bytes

    // ── Pre-built MQTT topic strings (computed once in begin()) ───────────────
    char _topicDeviceCmd      [kLumiTopicLen] = {};  // lumi/device/{id}/cmd
    char _topicDeviceState    [kLumiTopicLen] = {};  // lumi/device/{id}/state
    char _topicZoneCmd        [kLumiTopicLen] = {};  // lumi/zone/{zone}/cmd
    char _topicAvailability   [kLumiTopicLen] = {};  // lumi/device/{id}/availability (LWT)

    // ── Shared transmit buffer — reused for every outbound frame ─────────────
    uint8_t _txBuf[kLumiMaxFrameLen] = {};

    // ── Singleton trampoline for PubSubClient static callback ────────────────
    // PubSubClient callback has no user-data pointer; we need a static ptr.
    static LumiProtocol* _instance;

    // ── Outbound helpers ──────────────────────────────────────────────────────
    void _sendAck(uint8_t seq, uint8_t status);
    void _sendStateReport(const LumiState& state);
    void _sendDiscoveryAnnounce();
    void _sendError(uint8_t errorCode, uint8_t faultyOpc);

    // ── MQTT dispatch ─────────────────────────────────────────────────────────
    // Static trampoline — routes to _instance->_onMqttMessage.
    static void _mqttCallback(char* topic, uint8_t* payload, unsigned int len);
    void _onMqttMessage(const char* topic, const uint8_t* buf, size_t len);
    void _dispatchOpcode(const LumiParsedFrame& f);

    // ── Zone management ───────────────────────────────────────────────────────
    void _subscribeZone(uint8_t zoneId);
    void _unsubscribeZone(uint8_t zoneId);
    bool _reconnectMqtt();

    // ── User callbacks ────────────────────────────────────────────────────────
    OnSetPower      _onSetPower;
    OnSetBrightness _onSetBrightness;
    OnSetColor      _onSetColor;
    OnSetAnimation  _onSetAnimation;
    OnStopAnimation _onStopAnimation;
    OnGetState      _onGetState;
};
