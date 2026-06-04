#include <LumiProtocol.h>

#define WIFI_SSID   "your-ssid"
#define WIFI_PASS   "your-password"
#define BROKER_IP   "192.168.1.1"

LumiProtocol lumi;

void setup() {
  lumi.begin(WIFI_SSID, WIFI_PASS, BROKER_IP, "salon-strip-1");

  lumi.onSetPower([](bool on) {
    // drive GPIO
  });

  lumi.onSetBrightness([](uint8_t brightness) {
    // drive GPIO
  });

  lumi.onSetColor([](uint16_t h, uint8_t s, uint8_t b) {
    // drive GPIO
  });

  lumi.onSetAnimation([](uint8_t animId, uint8_t speed, uint8_t intensity) {
    // drive GPIO
  });

  lumi.onStopAnimation([]() {
    // drive GPIO
  });

  lumi.onGetState([]() -> LumiState {
    // return current LED state
    return LumiState{};
  });
}

void loop() {
  lumi.loop();
  // ledStrip.loop();
}
