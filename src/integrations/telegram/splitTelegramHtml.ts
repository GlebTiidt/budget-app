// Split only between complete HTML tokens; keep bold tags balanced on every page.
// Using a conservative raw-text budget also stays below Telegram's rendered limit.
export function splitTelegramHtml(text: string, limit = 3800): string[] {
  const parts: string[] = [];
  let part = "", bold = false;
  for (const line of text.split(/(?<=\n)/u)) {
    if (part && part.length + line.length > limit && line.length <= limit) flush();
    for (const token of line.match(/<\/?b>|&(?:amp|lt|gt|quot);|[\s\S]/gu) ?? []) {
      if (part.length + token.length + 4 > limit) flush();
      part += token;
      if (token === "<b>") bold = true;
      if (token === "</b>") bold = false;
    }
  }
  if (part && part !== "<b>") parts.push(part + (bold ? "</b>" : ""));
  return parts;
  function flush() {
    parts.push(part + (bold ? "</b>" : ""));
    part = bold ? "<b>" : "";
  }
}
