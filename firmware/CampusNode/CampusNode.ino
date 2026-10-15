#include <Adafruit_SHT31.h>
#include <HTTPClient.h>
#include <SensirionI2cScd4x.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <esp_system.h>
#include <time.h>

#include "secrets.h"
#include "trust_anchor.h"
#include "RamRecordQueue.h"

// Existing wiring from the first bench test.
static constexpr int I2C_SDA_PIN = 5;
static constexpr int I2C_SCL_PIN = 4;

static constexpr uint32_t SAMPLE_INTERVAL_MS = 60UL * 1000UL;
static constexpr uint32_t HANDSHAKE_INTERVAL_MS = 120UL * 1000UL;
static constexpr uint32_t HANDSHAKE_RETRY_MS = 5000UL;
static constexpr uint32_t TLS_HANDSHAKE_TIMEOUT_SECONDS = 15UL;
static constexpr uint32_t TIME_SYNC_RETRY_MS = 60UL * 1000UL;
static constexpr uint32_t FIRST_SAMPLE_DELAY_MS = 7000UL;
static constexpr uint32_t MAX_RETRY_MS = 15UL * 60UL * 1000UL;
static constexpr uint32_t MIN_RETRY_MS = 5000UL;
static constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 12000UL;
static constexpr uint32_t WIFI_RETRY_DELAY_MS = 2000UL;
static constexpr uint8_t WIFI_RETRIES_PER_NETWORK = 5;
static constexpr uint8_t RAM_QUEUE_CAPACITY = 30;
static constexpr uint8_t UPLOAD_BATCH_SIZE = 20;
static const char *FIRMWARE_VERSION = "2026.10.15-direct-upload-retry";
static constexpr uint32_t BACKLOG_UPLOAD_DELAY_MS = 1000UL;

struct WifiCredential {
  const char *ssid;
  const char *password;
};

const WifiCredential WIFI_NETWORKS[] = {
    {WIFI_STUDENT_SSID, WIFI_STUDENT_PASSWORD},
    {WIFI_TEACHER_SSID, WIFI_TEACHER_PASSWORD},
};
static constexpr uint8_t WIFI_NETWORK_COUNT = sizeof(WIFI_NETWORKS) / sizeof(WIFI_NETWORKS[0]);

#ifndef DEVICE_ID
#define DEVICE_ID "esp32s3-m1"
#endif

#ifndef LOCATION_ID
#define LOCATION_ID "M1"
#endif

SensirionI2cScd4x scd41;
Adafruit_SHT31 sht31 = Adafruit_SHT31();
RamRecordQueue<String, RAM_QUEUE_CAPACITY> ramQueue;
bool scdReady = false;
bool shtReady = false;
bool clockReady = false;
bool handshakeConfirmed = false;
uint32_t nextSampleAt = 0;
uint32_t nextHandshakeAt = 0;
uint32_t handshakeAttemptCount = 0;
uint32_t nextTimeSyncAttemptAt = 0;
uint32_t nextWifiAttemptAt = 0;
uint32_t wifiConnectDeadline = 0;
uint32_t nextUploadAt = 0;
uint32_t uploadRetryMs = MIN_RETRY_MS;
uint32_t recordCounter = 0;
uint32_t bootNonce = 0;
uint8_t wifiNetworkIndex = 0;
uint8_t wifiAttemptsOnNetwork = 0;
bool wifiAttemptPending = false;
bool wifiWasConnected = false;

void printSensirionError(const char *operation, int16_t error) {
  char message[64];
  errorToString(error, message, sizeof(message));
  Serial.printf("%s failed: %s (%d)\n", operation, message, error);
}

bool beginScd41() {
  scd41.begin(Wire, SCD41_I2C_ADDR_62);
  delay(30);
  scd41.wakeUp();
  delay(20);
  scd41.stopPeriodicMeasurement();
  delay(500);

  int16_t error = scd41.reinit();
  if (error != 0) {
    printSensirionError("SCD41 reinit", error);
    return false;
  }
  delay(20);
  error = scd41.startPeriodicMeasurement();
  if (error != 0) {
    printSensirionError("SCD41 startPeriodicMeasurement", error);
    return false;
  }
  Serial.println("SCD41 periodic measurement started (5-second sensor cycle).");
  return true;
}

void appendQueueRecord(const String &record) {
  if (ramQueue.push(record)) {
    Serial.println("RAM queue full; discarded the oldest unacknowledged reading to retain the latest 30.");
  }
}

String captureIsoTime() {
  if (!clockReady) return "null";
  const time_t now = time(nullptr);
  if (now < 1760000000) return "null";
  struct tm utcTime;
  gmtime_r(&now, &utcTime);
  char iso[25];
  strftime(iso, sizeof(iso), "%Y-%m-%dT%H:%M:%SZ", &utcTime);
  return String("\"") + iso + "\"";
}

String jsonNumberOrNull(float value, uint8_t digits = 2) {
  if (!isfinite(value)) return "null";
  return String(value, static_cast<unsigned int>(digits));
}

String makeRecordJson(uint16_t co2, float scdTemperature, float scdHumidity,
                      float shtTemperature, float shtHumidity,
                      const String &capturedAt, uint32_t capturedUptime) {
  char recordId[80];
  snprintf(recordId, sizeof(recordId), "%s-%08lx-%lu", DEVICE_ID,
           static_cast<unsigned long>(bootNonce),
           static_cast<unsigned long>(++recordCounter));

  String json = "{\"record_id\":\"";
  json += recordId;
  json += "\",\"device_id\":\"" DEVICE_ID "\",\"location_id\":\"" LOCATION_ID "\"";
  json += ",\"captured_at\":" + capturedAt;
  json += ",\"uptime_ms\":" + String(capturedUptime);
  json += ",\"co2_ppm\":" + String(co2);
  json += ",\"scd_temp_c\":" + jsonNumberOrNull(scdTemperature, 2);
  json += ",\"scd_humidity_pct\":" + jsonNumberOrNull(scdHumidity, 2);
  json += ",\"sht_temp_c\":" + jsonNumberOrNull(shtTemperature, 2);
  json += ",\"sht_humidity_pct\":" + jsonNumberOrNull(shtHumidity, 2);
  json += "}";
  return json;
}

uint8_t pendingUploadCount() {
  return min(static_cast<uint8_t>(ramQueue.size()), UPLOAD_BATCH_SIZE);
}

bool serverAccepted(const String &body, uint8_t expectedCount) {
  if (body.indexOf("\"ok\":true") < 0) return false;
  const int key = body.indexOf("\"accepted\"");
  if (key < 0) return false;
  const int colon = body.indexOf(':', key);
  if (colon < 0) return false;
  return body.substring(colon + 1).toInt() == expectedCount;
}

bool confirmServerHandshake() {
  if (WiFi.status() != WL_CONNECTED || !clockReady) return false;
  String handshakeUrl = API_URL;
  const String readingsPath = "/api/readings";
  if (!handshakeUrl.endsWith(readingsPath)) {
    Serial.println("API_URL must end in /api/readings for the handshake URL.");
    return false;
  }
  handshakeUrl.remove(handshakeUrl.length() - readingsPath.length());
  handshakeUrl += "/api/device/handshake";

  WiFiClientSecure secureClient;
  secureClient.setCACert(TLS_ROOT_CA_PEM);
  secureClient.setHandshakeTimeout(TLS_HANDSHAKE_TIMEOUT_SECONDS);
  HTTPClient http;
  http.setConnectTimeout(10000);
  http.setTimeout(15000);
  if (!http.begin(secureClient, handshakeUrl)) {
    Serial.println("HTTPS handshake client could not start.");
    http.end();
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + DEVICE_API_TOKEN);
  String body = "{\"device_id\":\"" DEVICE_ID "\",\"location_id\":\"" LOCATION_ID "\"";
  body += ",\"firmware_version\":\"" + String(FIRMWARE_VERSION) + "\"";
  body += ",\"uptime_ms\":" + String(millis());
  body += String(",\"scd_ready\":") + (scdReady ? "true" : "false");
  body += String(",\"sht_ready\":") + (shtReady ? "true" : "false");
  body += String(",\"clock_ready\":") + (clockReady ? "true" : "false") + "}";
  const int status = http.POST(body);
  http.end();
  if (status == 204) {
    Serial.println("Website handshake confirmed.");
    return true;
  }
  if (status < 0) {
    Serial.printf("Website handshake transport failed (%d: %s); no upload attempted.\n",
                  status, http.errorToString(status).c_str());
  } else {
    Serial.printf("Website handshake rejected (HTTP %d); no upload attempted.\n", status);
    if (status == 401) Serial.println("Check DEVICE_API_TOKEN in server .env and firmware/secrets.h.");
  }
  return false;
}

bool postPendingBatch() {
  if (WiFi.status() != WL_CONNECTED || !clockReady || !handshakeConfirmed) return false;
  String rows[UPLOAD_BATCH_SIZE];
  const uint8_t count = pendingUploadCount();
  if (!count) return true;
  for (uint8_t i = 0; i < count; ++i) rows[i] = ramQueue.at(i);

  String body = "{\"readings\":[";
  for (uint8_t i = 0; i < count; i++) {
    if (i) body += ',';
    body += rows[i];
  }
  body += "]}";

  WiFiClientSecure secureClient;
  secureClient.setCACert(TLS_ROOT_CA_PEM);
  secureClient.setHandshakeTimeout(TLS_HANDSHAKE_TIMEOUT_SECONDS);
  HTTPClient http;
  http.setConnectTimeout(10000);
  http.setTimeout(15000);
  http.setReuse(true);
  if (!http.begin(secureClient, API_URL)) {
    Serial.println("HTTPS client could not start; keeping RAM queue.");
    http.end();
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + DEVICE_API_TOKEN);
  const int status = http.POST(body);
  String responseBody = status > 0 ? http.getString() : "";
  http.end();

  if (status >= 200 && status < 300 && serverAccepted(responseBody, count)) {
    if (!ramQueue.acknowledge(count)) return false;
    Serial.printf("Uploaded and acknowledged %u record(s); %u pending in RAM.\n", count, static_cast<unsigned>(ramQueue.size()));
    return true;
  }

  Serial.printf("Upload not acknowledged (HTTP %d); keeping RAM queue.\n", status);
  if (status == 401) Serial.println("Check DEVICE_API_TOKEN in server .env and firmware/secrets.h.");
  return false;
}

void startWifiAttempt() {
  const WifiCredential &network = WIFI_NETWORKS[wifiNetworkIndex];
  WiFi.disconnect(false, false);
  ++wifiAttemptsOnNetwork;
  Serial.printf("Connecting to %s (attempt %u/%u).\n",
                network.ssid,
                wifiAttemptsOnNetwork,
                WIFI_RETRIES_PER_NETWORK);
  WiFi.begin(network.ssid, network.password);
  wifiAttemptPending = true;
  wifiConnectDeadline = millis() + WIFI_CONNECT_TIMEOUT_MS;
}

void beginWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false);
  wifiNetworkIndex = 0;
  wifiAttemptsOnNetwork = 0;
  wifiAttemptPending = false;
  wifiWasConnected = false;
  nextWifiAttemptAt = millis();
  startWifiAttempt();
}

void maintainWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiAttemptPending = false;
    wifiAttemptsOnNetwork = 0;
    if (!wifiWasConnected) {
      wifiWasConnected = true;
      handshakeConfirmed = false;
      handshakeAttemptCount = 0;
      nextHandshakeAt = millis();
      nextTimeSyncAttemptAt = millis();
      Serial.printf("Connected to %s; IP: %s\n", WiFi.SSID().c_str(), WiFi.localIP().toString().c_str());
      uploadRetryMs = MIN_RETRY_MS;
      nextUploadAt = millis();
    }
    if (!clockReady) {
      if (static_cast<int32_t>(millis() - nextTimeSyncAttemptAt) >= 0) {
        configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");
        nextTimeSyncAttemptAt = millis() + TIME_SYNC_RETRY_MS;
        Serial.println("NTP time sync requested; HTTPS handshake waits for a valid clock.");
      }
      const time_t now = time(nullptr);
      if (now >= 1760000000) {
        clockReady = true;
        Serial.println("System time synchronized.");
        uploadRetryMs = MIN_RETRY_MS;
        nextUploadAt = millis();
      }
    }
    return;
  }

  if (wifiWasConnected) {
    wifiWasConnected = false;
    handshakeConfirmed = false;
    Serial.printf("Wi-Fi disconnected; %u queued reading(s) remain in RAM until reboot.\n", static_cast<unsigned>(ramQueue.size()));
  }

  if (wifiAttemptPending) {
    if (static_cast<int32_t>(millis() - wifiConnectDeadline) < 0) return;

    wifiAttemptPending = false;
    const WifiCredential &network = WIFI_NETWORKS[wifiNetworkIndex];
    Serial.printf("Could not connect to %s (attempt %u/%u).\n",
                  network.ssid,
                  wifiAttemptsOnNetwork,
                  WIFI_RETRIES_PER_NETWORK);
    WiFi.disconnect(false, false);
    if (wifiAttemptsOnNetwork >= WIFI_RETRIES_PER_NETWORK) {
      wifiNetworkIndex = (wifiNetworkIndex + 1) % WIFI_NETWORK_COUNT;
      wifiAttemptsOnNetwork = 0;
      Serial.printf("Five attempts reached; switching to %s.\n", WIFI_NETWORKS[wifiNetworkIndex].ssid);
    }
    nextWifiAttemptAt = millis() + WIFI_RETRY_DELAY_MS;
    return;
  }

  if (static_cast<int32_t>(millis() - nextWifiAttemptAt) < 0) return;
  startWifiAttempt();
}

void updateSensorSample() {
  if (!scdReady) {
    Serial.println("SCD41 is unavailable; retrying initialization.");
    scdReady = beginScd41();
    nextSampleAt = millis() + FIRST_SAMPLE_DELAY_MS;
    return;
  }

  bool dataReady = false;
  const int16_t readyError = scd41.getDataReadyStatus(dataReady);
  if (readyError != 0) {
    printSensirionError("SCD41 getDataReadyStatus", readyError);
    nextSampleAt = millis() + 5000UL;
    return;
  }
  if (!dataReady) {
    nextSampleAt = millis() + 5000UL;
    return;
  }

  uint16_t co2 = 0;
  float scdTemperature = NAN;
  float scdHumidity = NAN;
  const int16_t readError = scd41.readMeasurement(co2, scdTemperature, scdHumidity);
  if (readError != 0 || co2 == 0) {
    printSensirionError("SCD41 readMeasurement", readError);
    nextSampleAt = millis() + 5000UL;
    return;
  }

  float shtTemperature = NAN;
  float shtHumidity = NAN;
  if (shtReady) {
    shtTemperature = sht31.readTemperature();
    shtHumidity = sht31.readHumidity();
    if (!isfinite(shtTemperature) || !isfinite(shtHumidity)) {
      Serial.println("SHT31 read failed; the SCD41 reading will still be queued.");
      shtTemperature = NAN;
      shtHumidity = NAN;
    }
  }

  Serial.printf("CO2=%u ppm | SCD41 %.1f C / %.1f %%RH | SHT31 %.1f C / %.1f %%RH\n",
                co2, scdTemperature, scdHumidity, shtTemperature, shtHumidity);
  const uint32_t capturedUptime = millis();
  const String capturedAt = captureIsoTime();
  Serial.printf("Sample captured_at=%s; %s; uptime_ms=%lu.\n", capturedAt.c_str(),
                capturedAt == "null" ? "clock not synchronized: capture time unknown" : "UTC capture time retained on retry",
                static_cast<unsigned long>(capturedUptime));
  const String record = makeRecordJson(co2, scdTemperature, scdHumidity, shtTemperature, shtHumidity, capturedAt, capturedUptime);
  appendQueueRecord(record);
  Serial.printf("Direct upload scheduled; RAM pending %u/%u.\n", static_cast<unsigned>(ramQueue.size()), RAM_QUEUE_CAPACITY);
  nextUploadAt = millis();
  nextSampleAt = millis() + SAMPLE_INTERVAL_MS;
}

void setup() {
  Serial.begin(115200);
  delay(350);
  Serial.println("Campus Atlas ESP32-S3 node starting.");
  Serial.printf("Firmware: %s\n", FIRMWARE_VERSION);
  Serial.printf("API target: %s\n", API_URL);
  if (String(DEVICE_API_TOKEN) == "PASTE_DEVICE_API_TOKEN_HERE") {
    Serial.println("DEVICE_API_TOKEN is still the example placeholder; website handshake will return HTTP 401.");
  }
  bootNonce = esp_random();

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(100000);
  scdReady = beginScd41();
  if (!scdReady) Serial.println("SCD41 did not start. Check VIN/GND/SCL/SDA and power.");
  shtReady = sht31.begin(0x44) || sht31.begin(0x45);
  Serial.println(shtReady ? "SHT31 detected." : "SHT31 not detected; SCD41 temperature/RH will be used.");

  Serial.printf("Direct HTTPS upload enabled; RAM retry queue capacity %u; no SD required.\n", RAM_QUEUE_CAPACITY);
  Serial.println("Website handshake: retry every 5 seconds after failure until confirmed; then every 120 seconds.");

  beginWifi();
  nextSampleAt = millis() + FIRST_SAMPLE_DELAY_MS;
  nextHandshakeAt = millis();
  nextUploadAt = millis() + MIN_RETRY_MS;
}

void loop() {
  maintainWifi();

  if (WiFi.status() == WL_CONNECTED && clockReady &&
      static_cast<int32_t>(millis() - nextHandshakeAt) >= 0) {
    const uint32_t handshakeStartedAt = millis();
    Serial.printf("Website handshake attempt %lu starting.\n", static_cast<unsigned long>(++handshakeAttemptCount));
    handshakeConfirmed = confirmServerHandshake();
    // Schedule after completion so a slow request cannot create a tight retry loop.
    const uint32_t handshakeFinishedAt = millis();
    nextHandshakeAt = handshakeFinishedAt + (handshakeConfirmed ? HANDSHAKE_INTERVAL_MS : HANDSHAKE_RETRY_MS);
    Serial.printf("Website handshake finished in %lu ms; next attempt in %lu seconds.\n",
                  static_cast<unsigned long>(handshakeFinishedAt - handshakeStartedAt),
                  static_cast<unsigned long>((handshakeConfirmed ? HANDSHAKE_INTERVAL_MS : HANDSHAKE_RETRY_MS) / 1000UL));
    if (handshakeConfirmed) {
      handshakeAttemptCount = 0;
      nextUploadAt = handshakeFinishedAt;
    }
  }

  if (static_cast<int32_t>(millis() - nextSampleAt) >= 0) {
    updateSensorSample();
  }

  if (handshakeConfirmed && ramQueue.size() > 0 && static_cast<int32_t>(millis() - nextUploadAt) >= 0) {
    if (postPendingBatch()) {
      uploadRetryMs = MIN_RETRY_MS;
      nextUploadAt = millis() + BACKLOG_UPLOAD_DELAY_MS;
    } else {
      nextUploadAt = millis() + uploadRetryMs + (esp_random() % 2000UL);
      uploadRetryMs = min(uploadRetryMs * 2, MAX_RETRY_MS);
    }
  }

  delay(40);
}
