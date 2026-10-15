#pragma once

#include <Arduino.h>
#include <FS.h>
#include <algorithm>
#include <cstring>
#include <vector>

// Only numbered files in /atlas-queue are managed. Other SD files are untouched.
// Bounded segments work on FAT32; upload acknowledgements advance a byte cursor.
class SdRecordQueue {
 public:
  SdRecordQueue(fs::FS &storage, uint64_t limit, uint64_t reclaim, uint32_t segmentSize)
      : fs_(storage), limit_(limit), reclaim_(reclaim), segmentSize_(segmentSize) {}

  bool begin() {
    ready_ = false;
    prepared_ = false;
    segments_.clear();
    total_ = 0;
    nextId_ = 1;
    cursorId_ = UINT32_MAX;
    cursorOffset_ = 0;
    if (!limit_ || !reclaim_ || reclaim_ > limit_ || !segmentSize_) return fail("Invalid SD retention settings.");
    if (!fs_.exists(directory()) && !fs_.mkdir(directory())) return fail("Cannot create SD queue directory.");
    // Move, rather than copy, the previous firmware's queue into the oldest slot.
    if (fs_.exists("/queue.ndjson")) {
      const String legacy = path(0);
      if (fs_.exists(legacy) || !fs_.rename("/queue.ndjson", legacy)) return fail("Legacy SD queue migration failed; original data retained.");
      Serial.println("Existing SD queue migrated without copying records.");
    }
    File dir = fs_.open(directory(), FILE_READ);
    if (!dir || !dir.isDirectory()) return fail("Cannot open SD queue directory.");
    File entry = dir.openNextFile();
    while (entry) {
      uint32_t id = 0;
      if (!entry.isDirectory() && parseId(entry.name(), id)) {
        const uint64_t size = entry.size();
        segments_.push_back({id, size});
        total_ += size;
        if (id == UINT32_MAX) { entry.close(); dir.close(); return fail("SD segment identifiers exhausted."); }
        nextId_ = std::max(nextId_, id + 1);
      }
      entry.close();
      entry = dir.openNextFile();
      yield();
    }
    dir.close();
    std::sort(segments_.begin(), segments_.end(), [](const Segment &a, const Segment &b) { return a.id < b.id; });
    if (segments_.empty()) {
      // Do not apply a cursor from a removed segment to a reused identifier.
      if (!eraseMeta("ack")) return fail("Cannot reset empty SD queue cursor.");
    } else {
      Meta ack{};
      bool exists = false;
      if (loadMeta("ack", ackMagic(), ack, exists) && exists) {
        for (const Segment &segment : segments_) {
          if (segment.id == ack.a && ack.b <= segment.size) { cursorId_ = ack.a; cursorOffset_ = ack.b; break; }
        }
      } else if (exists) {
        // Replaying stable record IDs is safe; never guess a forward offset.
        Serial.println("SD acknowledgement cursor damaged; records will be retried safely.");
      }
    }
    ready_ = true;
    if (!resumePrune()) return false;
    Serial.printf("SD pending queue: %llu bytes; limit 10000000000, reclaim 5500000000 bytes.\n", static_cast<unsigned long long>(total_));
    return true;
  }

  bool healthy() const { return ready_; }
  bool hasPending() const { return !segments_.empty(); }
  uint64_t storedBytes() const { return total_; }

  bool append(const String &record) {
    if (!ready_) return false;
    if (record.length() > maxLine() - 2) return fail("SD record is too large; not written.");
    const uint32_t incoming = record.length() + 1;
    if (total_ + incoming >= limit_) {
      const uint64_t target = total_ > reclaim_ ? total_ - reclaim_ : 0;
      Meta prune = makeMeta(pruneMagic(), static_cast<uint32_t>(target), static_cast<uint32_t>(target >> 32));
      if (!writeMeta("prune", prune)) return fail("Cannot persist SD retention target.");
      Serial.println("SD reached 10 GB: deleting oldest approximately 5.5 GB, including any pending records in those files.");
      if (!resumePrune()) return false;
    }
    bool rotate = segments_.empty() || segments_.back().id == 0 || segments_.back().size + incoming > segmentSize_;
    if (!rotate && segments_.back().size) {
      File tail = fs_.open(path(segments_.back().id), FILE_READ);
      if (!tail || !tail.seek(static_cast<uint32_t>(segments_.back().size - 1))) return fail("Cannot inspect SD queue tail.");
      rotate = tail.read() != '\n';  // Seal a partial tail left by interrupted power.
      tail.close();
    }
    if (rotate) {
      if (nextId_ == UINT32_MAX || fs_.exists(path(nextId_))) return fail("Cannot allocate SD queue segment.");
      segments_.push_back({nextId_++, 0});
    }
    Segment &segment = segments_.back();
    File file = fs_.open(path(segment.id), FILE_APPEND);
    if (!file) return fail("SD queue open failed; record not persisted.");
    const size_t written = file.print(record);
    const size_t newline = written == record.length() ? file.write(static_cast<uint8_t>('\n')) : 0;
    file.flush();
    const uint64_t size = file.size();
    file.close();
    total_ = total_ - segment.size + size;
    segment.size = size;
    if (written != record.length() || newline != 1) return fail("SD queue short write; storage will be remounted.");
    return true;
  }

  bool readBatch(String rows[], uint8_t capacity, uint8_t &count) {
    count = 0;
    prepared_ = false;
    if (!ready_) return false;
    while (!segments_.empty()) {
      const Segment segment = segments_.front();
      const uint32_t offset = cursorId_ == segment.id ? cursorOffset_ : 0;
      if (offset >= segment.size) { if (!removeHead()) return false; continue; }
      File file = fs_.open(path(segment.id), FILE_READ);
      if (!file || !file.seek(offset)) return fail("Cannot read SD pending segment.");
      while (file.available() && count < capacity) {
        char buffer[maxLine()];
        size_t length = 0;
        bool newline = false;
        bool oversized = false;
        while (file.available()) {
          const int ch = file.read();
          if (ch < 0) { file.close(); return fail("SD queue read failed."); }
          if (ch == '\n') { newline = true; break; }
          if (length < sizeof(buffer) - 1) buffer[length++] = static_cast<char>(ch);
          else oversized = true;
        }
        buffer[length] = '\0';
        if (oversized) { file.close(); return fail("Oversized SD queue row; upload paused for inspection."); }
        String line(buffer);
        line.trim();
        if (!newline && line.length() && !line.endsWith("}")) {
          Serial.println("Incomplete SD tail from interrupted write skipped.");
        } else if (line.length() > 2) {
          rows[count++] = line;
        }
        yield();
      }
      batchId_ = segment.id;
      batchEnd_ = file.position();
      file.close();
      if (count) { batchCount_ = count; prepared_ = true; return true; }
      if (!removeHead()) return false;
    }
    return false;
  }

  bool acknowledge(uint8_t count) {
    if (!ready_ || !prepared_ || count != batchCount_ || segments_.empty() || segments_.front().id != batchId_) return false;
    const Meta ack = makeMeta(ackMagic(), batchId_, batchEnd_);
    if (!writeMeta("ack", ack)) return fail("Cannot persist SD upload cursor; records retained for retry.");
    cursorId_ = batchId_;
    cursorOffset_ = batchEnd_;
    prepared_ = false;
    if (cursorOffset_ >= segments_.front().size && !removeHead()) return false;
    return true;
  }

 private:
  struct Segment { uint32_t id; uint64_t size; };
  struct Meta { uint32_t magic, a, b, check; };
  fs::FS &fs_;
  const uint64_t limit_, reclaim_;
  const uint32_t segmentSize_;
  std::vector<Segment> segments_;
  uint64_t total_ = 0;
  uint32_t nextId_ = 1, cursorId_ = UINT32_MAX, cursorOffset_ = 0;
  uint32_t batchId_ = 0, batchEnd_ = 0;
  uint8_t batchCount_ = 0;
  bool ready_ = false, prepared_ = false;
  static const char *directory() { return "/atlas-queue"; }
  static constexpr size_t maxLine() { return 1536; }
  static constexpr uint32_t ackMagic() { return 0x41514b31; }
  static constexpr uint32_t pruneMagic() { return 0x41515031; }
  static Meta makeMeta(uint32_t magic, uint32_t a, uint32_t b) { return {magic, a, b, magic ^ a ^ b ^ 0x98b42ea7}; }
  static String path(uint32_t id) {
    char name[48];
    snprintf(name, sizeof(name), "/atlas-queue/q%010lu.ndjson", static_cast<unsigned long>(id));
    return String(name);
  }
  static String metaPath(const char *name, const char *suffix = ".state") { return String(directory()) + "/" + name + suffix; }
  static bool parseId(const char *name, uint32_t &id) {
    const char *base = std::strrchr(name, '/');
    base = base ? base + 1 : name;
    if (std::strlen(base) != 18 || base[0] != 'q' || std::strcmp(base + 11, ".ndjson")) return false;
    uint64_t number = 0;
    for (uint8_t i = 1; i <= 10; ++i) { if (base[i] < '0' || base[i] > '9') return false; number = number * 10 + base[i] - '0'; }
    if (number > UINT32_MAX) return false;
    id = static_cast<uint32_t>(number);
    return true;
  }
  bool fail(const char *message) { Serial.println(message); ready_ = false; return false; }
  bool eraseIfPresent(const String &name) { return !fs_.exists(name) || fs_.remove(name); }
  bool eraseMeta(const char *name) { return eraseIfPresent(metaPath(name)) && eraseIfPresent(metaPath(name, ".bak")) && eraseIfPresent(metaPath(name, ".tmp")); }
  bool readMeta(const String &name, uint32_t magic, Meta &meta) {
    File file = fs_.open(name, FILE_READ);
    if (!file) return false;
    const bool valid = file.size() == sizeof(Meta) && file.read(reinterpret_cast<uint8_t *>(&meta), sizeof(Meta)) == sizeof(Meta);
    file.close();
    return valid && meta.magic == magic && meta.check == makeMeta(meta.magic, meta.a, meta.b).check;
  }
  bool loadMeta(const char *name, uint32_t magic, Meta &meta, bool &exists) {
    exists = fs_.exists(metaPath(name)) || fs_.exists(metaPath(name, ".bak"));
    return !exists || readMeta(metaPath(name), magic, meta) || readMeta(metaPath(name, ".bak"), magic, meta);
  }
  bool writeMeta(const char *name, const Meta &meta) {
    const String main = metaPath(name), temp = metaPath(name, ".tmp"), backup = metaPath(name, ".bak");
    if (!eraseIfPresent(temp)) return false;
    File file = fs_.open(temp, FILE_WRITE);
    if (!file) return false;
    const size_t written = file.write(reinterpret_cast<const uint8_t *>(&meta), sizeof(Meta));
    file.flush(); file.close();
    if (written != sizeof(Meta) || !eraseIfPresent(backup)) return false;
    if (fs_.exists(main) && !fs_.rename(main, backup)) return false;
    if (!fs_.rename(temp, main)) { if (fs_.exists(backup)) fs_.rename(backup, main); return false; }
    eraseIfPresent(backup);
    return true;
  }
  bool removeHead() {
    if (segments_.empty()) return true;
    const Segment head = segments_.front();
    if (!fs_.remove(path(head.id))) return fail("Cannot remove SD queue segment; storage will be remounted.");
    total_ -= head.size;
    segments_.erase(segments_.begin());
    if (cursorId_ == head.id) { cursorId_ = UINT32_MAX; cursorOffset_ = 0; }
    return true;
  }
  bool resumePrune() {
    Meta meta{};
    bool exists = false;
    if (!loadMeta("prune", pruneMagic(), meta, exists)) return fail("SD retention journal damaged; automatic deletion paused.");
    if (!exists) return true;
    const uint64_t target = static_cast<uint64_t>(meta.a) | (static_cast<uint64_t>(meta.b) << 32);
    if (target > limit_) return fail("Invalid SD retention target; automatic deletion paused.");
    const uint64_t before = total_;
    while (total_ > target && !segments_.empty()) { if (!removeHead()) return false; delay(1); }
    if (!eraseMeta("prune")) return fail("Cannot finish SD retention journal.");
    Serial.printf("SD retention removed %llu bytes; %llu bytes remain.\n", static_cast<unsigned long long>(before - total_), static_cast<unsigned long long>(total_));
    return true;
  }
};
