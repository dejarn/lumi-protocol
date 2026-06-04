#include "LumiProtocol.h"

void LumiProtocol::begin(const char* /*wifiSsid*/, const char* /*wifiPass*/,
                         const char* /*brokerIp*/, const char* /*deviceName*/) {
  // TODO: WiFi connect, MQTT connect, subscribe to device + zone topics,
  //       publish DISCOVERY_ANNOUNCE
}

void LumiProtocol::loop() {
  // TODO: mqtt.loop(), parse incoming frames, dispatch callbacks, send ACKs
}
