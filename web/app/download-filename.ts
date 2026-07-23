function pad(value: number) {
  return value.toString().padStart(2, "0");
}

export function safeFileStem(title: string) {
  const clean = title
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return clean || "transcription";
}

export function formatDownloadTimestamp(date: Date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

export function makeDownloadFilename(title: string, date = new Date()) {
  return `${safeFileStem(title)}-${formatDownloadTimestamp(date)}.mid`;
}
