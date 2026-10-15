#pragma once
#include <stddef.h>

// Bounded, volatile FIFO. Acknowledged records are removed immediately.
template <typename Record, size_t Capacity>
class RamRecordQueue {
  static_assert(Capacity > 0, "RAM queue capacity must be positive");
 public:
  size_t size() const { return count_; }
  const Record &at(size_t index) const { return records_[(head_ + index) % Capacity]; }

  // On overflow keep the newest data. Returns true if an old record was dropped.
  bool push(const Record &record) {
    const bool dropped = count_ == Capacity;
    if (dropped) {
      records_[head_] = Record{};
      head_ = (head_ + 1) % Capacity;
      --count_;
    }
    records_[(head_ + count_) % Capacity] = record;
    ++count_;
    return dropped;
  }

  bool acknowledge(size_t count) {
    if (count > count_) return false;
    for (size_t i = 0; i < count; ++i) {
      records_[head_] = Record{};
      head_ = (head_ + 1) % Capacity;
      --count_;
    }
    return true;
  }

 private:
  Record records_[Capacity];
  size_t head_ = 0;
  size_t count_ = 0;
};
