export const chartTimestamp = (value: string) => {
  const normalized = value.length === 7 ? `${value}-01` : value;
  const [year, month, day] = normalized.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 1000;
};

export const chartAxisDateValue = (timestamp: number, pointDates: readonly string[]) => {
  let nearest = "";
  let nearestOffset = Number.POSITIVE_INFINITY;
  for (const date of pointDates) {
    const offset = Math.abs(chartTimestamp(date) - timestamp);
    if (offset < nearestOffset) {
      nearest = date;
      nearestOffset = offset;
    }
  }
  return nearest || new Date(timestamp * 1000).toISOString().slice(0, 10);
};
