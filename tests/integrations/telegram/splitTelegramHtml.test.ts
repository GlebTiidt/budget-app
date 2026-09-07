import assert from "node:assert/strict";
import test from "node:test";
import { splitTelegramHtml } from "../../../src/integrations/telegram/splitTelegramHtml.js";

test("long previews preserve every row, entity and bold span across pages", () => {
  const text = Array.from({length:100}, (_,i)=>`${i+1}. <b>Расход ${i+1} VND</b> · Еда &amp; напитки 🥑 ${"текст ".repeat(20)}\n`).join("") + "<b>" + "я".repeat(4500) + "</b>";
  const parts = splitTelegramHtml(text);
  assert.ok(parts.length > 1);
  for (const part of parts) { assert.ok(part.length <= 3800); assert.equal((part.match(/<b>/g)??[]).length,(part.match(/<\/b>/g)??[]).length); }
  const strip = (value:string)=>value.replace(/<\/?b>/g, "");
  assert.equal(parts.map(strip).join(""),strip(text));
});
