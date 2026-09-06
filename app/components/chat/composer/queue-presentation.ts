import type { QueuedSubmission } from "~~/shared/types";

export function queueDockKind(itemCount: number): "empty" | "single" | "multiple" {
  if (itemCount <= 0) return "empty";
  return itemCount === 1 ? "single" : "multiple";
}

export function queuedSubmissionPreview(item: QueuedSubmission, attachmentLabel: string) {
  const text = item.input
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text).replaceAll(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
  const attachments = item.input.flatMap((part) => {
    if (part.type === "text") return [];
    if (part.type === "skill" || part.type === "mention") {
      return typeof part.name === "string" && part.name !== "" ? [part.name] : [];
    }
    return [attachmentLabel];
  });
  return [text, ...attachments].filter(Boolean).join(" · ");
}

export function editableQueuedText(item: QueuedSubmission) {
  if (item.input.length === 0 || item.input.some((part) => part.type !== "text")) return null;
  return item.input.map((part) => (typeof part.text === "string" ? part.text : "")).join("\n");
}

export function moveQueuedSubmissionIds(
  items: QueuedSubmission[],
  id: string,
  direction: "up" | "down",
) {
  const ids = items.map((item) => item.id);
  const index = ids.indexOf(id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= ids.length) return ids;
  [ids[index], ids[target]] = [ids[target]!, ids[index]!];
  return ids;
}
