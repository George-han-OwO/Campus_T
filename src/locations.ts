// Existing records and deployed nodes use M1; the confirmed physical room is M104.
export function roomForLocation(locationId: string) {
  return locationId === "M1" ? "M104" : locationId;
}

export function locationLabel(locationId: string) {
  return locationId === "M1" ? "M 区 · M104 教室" : `点位 ${locationId}`;
}
