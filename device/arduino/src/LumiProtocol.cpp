#include "LumiProtocol.h"

LumiProtocol* LumiProtocol::_instance = nullptr;

void LumiProtocol::_sendAck(uint8_t seq, uint8_t status) {
    uint8_t payload[2];
    payload[0] = seq;
    payload[1] = status;
    _seq = static_cast<uint8_t>((_seq + 1) & 0xFFu);
    const size_t len = lumiBuildFrame(LUMI_PROTO_VERSION, LUMI_OPC_ACK, _deviceId, _seq,
                                      payload, sizeof(payload), _txBuf, sizeof(_txBuf));
    if (len > 0) {
        _mqtt.publish(_topicDeviceState, _txBuf, static_cast<unsigned int>(len));
    }
}

void LumiProtocol::_sendStateReport(const LumiState& state) {
    uint8_t payload[7];
    payload[0] = state.power;
    payload[1] = state.brightness;
    payload[2] = static_cast<uint8_t>(state.h >> 8);
    payload[3] = static_cast<uint8_t>(state.h & 0xFFu);
    payload[4] = state.s;
    payload[5] = state.colorBri;
    payload[6] = state.animId;
    _seq = static_cast<uint8_t>((_seq + 1) & 0xFFu);
    const size_t len = lumiBuildFrame(LUMI_PROTO_VERSION, LUMI_OPC_STATE_REPORT, _deviceId, _seq,
                                      payload, sizeof(payload), _txBuf, sizeof(_txBuf));
    if (len > 0) {
        _mqtt.publish(_topicDeviceState, _txBuf, static_cast<unsigned int>(len));
    }
}

void LumiProtocol::_sendDiscoveryAnnounce() {
    const size_t nameLen = strnlen(_deviceName, 32u);
    const size_t payloadLen = 5u + nameLen;

    uint8_t payload[5 + 32];
    payload[0] = LUMI_DEVICE_TYPE_LED_STRIP;
    payload[1] = LUMI_CAP_COLOR | LUMI_CAP_ANIMATION | LUMI_CAP_DIMMING;
    payload[2] = LUMI_PROTO_VERSION;
    payload[3] = _zoneId;
    payload[4] = static_cast<uint8_t>(nameLen);
    if (nameLen > 0) {
        memcpy(payload + 5, _deviceName, nameLen);
    }

    _seq = static_cast<uint8_t>((_seq + 1) & 0xFFu);
    const size_t len = lumiBuildFrame(LUMI_PROTO_VERSION, LUMI_OPC_DISCOVERY_ANNOUNCE, _deviceId, _seq,
                                      payload, payloadLen, _txBuf, sizeof(_txBuf));
    if (len > 0) {
        _mqtt.publish("lumi/discovery/announce", _txBuf, static_cast<unsigned int>(len));
    }
}

void LumiProtocol::_sendError(uint8_t errorCode, uint8_t faultyOpc) {
    uint8_t payload[2];
    payload[0] = errorCode;
    payload[1] = faultyOpc;
    _seq = static_cast<uint8_t>((_seq + 1) & 0xFFu);
    const size_t len = lumiBuildFrame(LUMI_PROTO_VERSION, LUMI_OPC_ERROR, _deviceId, _seq,
                                      payload, sizeof(payload), _txBuf, sizeof(_txBuf));
    if (len > 0) {
        _mqtt.publish(_topicDeviceState, _txBuf, static_cast<unsigned int>(len));
    }
}

void LumiProtocol::_mqttCallback(char* topic, uint8_t* payload, unsigned int len) {
    if (_instance != nullptr) {
        _instance->_onMqttMessage(topic, payload, static_cast<size_t>(len));
    }
}

void LumiProtocol::_subscribeZone(uint8_t zoneId) {
    snprintf(_topicZoneCmd, kLumiTopicLen, "lumi/zone/%u/cmd", zoneId);
    _mqtt.subscribe(_topicZoneCmd);
}

void LumiProtocol::_unsubscribeZone(uint8_t zoneId) {
    char topic[kLumiTopicLen];
    snprintf(topic, kLumiTopicLen, "lumi/zone/%u/cmd", zoneId);
    _mqtt.unsubscribe(topic);
}

bool LumiProtocol::_reconnectMqtt() {
    char clientId[16];
    snprintf(clientId, sizeof(clientId), "lumi-%04x", _deviceId);

    if (!_mqtt.connect(clientId)) return false;

    _mqtt.subscribe(_topicDeviceCmd);
    _subscribeZone(_zoneId);
    _mqtt.subscribe("lumi/discovery/request");

    _sendDiscoveryAnnounce();
    return true;
}

bool LumiProtocol::begin(const char* wifiSsid, const char* wifiPass,
                         const char* brokerIp, const char* deviceName) {
    _instance = this;

    strncpy(_deviceName, deviceName, sizeof(_deviceName) - 1u);
    _deviceName[sizeof(_deviceName) - 1u] = '\0';

    WiFi.begin(wifiSsid, wifiPass);
    const unsigned long wifiDeadline = millis() + 30000UL;
    while (WiFi.status() != WL_CONNECTED) {
        if (millis() > wifiDeadline) return false;
        delay(500);
    }

    uint8_t mac[6];
    WiFi.macAddress(mac);
    _deviceId = (static_cast<uint16_t>(mac[4]) << 8) | mac[5];

    snprintf(_topicDeviceCmd,   kLumiTopicLen, "lumi/device/%04x/cmd",   _deviceId);
    snprintf(_topicDeviceState, kLumiTopicLen, "lumi/device/%04x/state", _deviceId);

    {
        Preferences prefs;
        prefs.begin("lumi", /* readOnly= */ true);
        _zoneId = prefs.getUChar("zone", 0x00u);
        prefs.end();
    }

    _mqtt.setClient(_wifiClient);
    _mqtt.setServer(brokerIp, 1883);
    _mqtt.setCallback(_mqttCallback);

    return _reconnectMqtt();
}

void LumiProtocol::loop() {
    if (!_mqtt.connected()) {
        const unsigned long now = millis();
        if (now - _lastReconnectMs >= 5000UL) {
            _lastReconnectMs = now;
            _reconnectMqtt();
        }
    }
    _mqtt.loop();
}

void LumiProtocol::_onMqttMessage(const char* /*topic*/,
                                   const uint8_t* buf,
                                   size_t len) {
    LumiParsedFrame frame;
    const LumiCodecResult result = lumiParseFrame(buf, len, frame);

    if (result == LumiCodecResult::ERR_CRC_MISMATCH) {
        _sendError(0x03u, 0x00u);
        return;
    }
    if (result == LumiCodecResult::ERR_VERSION_MISMATCH) {
        _sendError(0x04u, len > 1u ? buf[1] : 0x00u);
        return;
    }
    if (result != LumiCodecResult::OK) return;

    _dispatchOpcode(frame);
}

void LumiProtocol::_dispatchOpcode(const LumiParsedFrame& f) {
    switch (f.opc) {

    case LUMI_OPC_SET_POWER: {
        if (f.payloadLen < 1u) { _sendError(0x02u, f.opc); return; }
        if (_onSetPower) _onSetPower(f.payload[0] != 0x00u);
        _sendAck(f.seq, 0x00u);
        if (_onGetState) _sendStateReport(_onGetState());
        break;
    }

    case LUMI_OPC_SET_BRIGHTNESS: {
        if (f.payloadLen < 1u) { _sendError(0x02u, f.opc); return; }
        if (_onSetBrightness) _onSetBrightness(f.payload[0]);
        _sendAck(f.seq, 0x00u);
        if (_onGetState) _sendStateReport(_onGetState());
        break;
    }

    case LUMI_OPC_SET_COLOR: {
        if (f.payloadLen < 4u) { _sendError(0x02u, f.opc); return; }
        const uint16_t h = (static_cast<uint16_t>(f.payload[0]) << 8) | f.payload[1];
        if (_onSetColor) _onSetColor(h, f.payload[2], f.payload[3]);
        _sendAck(f.seq, 0x00u);
        if (_onGetState) _sendStateReport(_onGetState());
        break;
    }

    case LUMI_OPC_SET_ANIMATION: {
        if (f.payloadLen < 3u) { _sendError(0x02u, f.opc); return; }
        if (_onSetAnimation) _onSetAnimation(f.payload[0], f.payload[1], f.payload[2]);
        _sendAck(f.seq, 0x00u);
        if (_onGetState) _sendStateReport(_onGetState());
        break;
    }

    case LUMI_OPC_STOP_ANIMATION: {
        if (_onStopAnimation) _onStopAnimation();
        _sendAck(f.seq, 0x00u);
        if (_onGetState) _sendStateReport(_onGetState());
        break;
    }

    case LUMI_OPC_SET_ZONE: {
        if (f.payloadLen < 1u) { _sendError(0x02u, f.opc); return; }
        const uint8_t newZone = f.payload[0];

        {
            Preferences prefs;
            prefs.begin("lumi", /* readOnly= */ false);
            const bool ok = prefs.putUChar("zone", newZone);
            prefs.end();
            if (!ok) {
                _sendError(0x05u, f.opc);
                return;
            }
        }

        _unsubscribeZone(_zoneId);
        _zoneId = newZone;
        _subscribeZone(_zoneId);

        _sendAck(f.seq, 0x00u);
        break;
    }

    case LUMI_OPC_GET_STATE: {
        if (_onGetState) _sendStateReport(_onGetState());
        break;
    }

    case LUMI_OPC_DISCOVERY_REQUEST: {
        _sendDiscoveryAnnounce();
        break;
    }

    default: {
        _sendError(0x01u, f.opc);
        break;
    }

    }
}
