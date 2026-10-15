#pragma once

// Copy this file to secrets.h. Keep real Wi-Fi passwords and the device token
// out of source control and out of deployment archives.
#define WIFI_STUDENT_SSID "YOUR_STUDENT_WIFI_NAME"
#define WIFI_STUDENT_PASSWORD "YOUR_STUDENT_WIFI_PASSWORD"
#define WIFI_TEACHER_SSID "YOUR_TEACHER_WIFI_NAME"
#define WIFI_TEACHER_PASSWORD "YOUR_TEACHER_WIFI_PASSWORD"
#define API_URL "https://map.georgehan0514.top/api/readings"
#define DEVICE_API_TOKEN "PASTE_DEVICE_API_TOKEN_HERE"

// Keep these stable for this node. Use only letters, numbers, dot, dash,
// underscore, and colon because they become database identifiers.
#define DEVICE_ID "esp32s3-m1"
#define LOCATION_ID "M1"
