# Voice Input Planning

Voice pricing and model availability change too often to keep estimates in the repository. Recheck official provider documentation when Phase 9 begins and record measured prototype usage instead of relying on a historical price snapshot.

## Preferred Order

1. Use Apple on-device transcription when the target locale and device support it.
2. Send only the resulting text to the configured server-side structured parser.
3. Select a server-side transcription fallback only after measuring on-device accuracy.
4. Use realtime cloud transcription only if live partial results materially improve the product.

## Cost Model

Voice capture may incur separate transcription and structured-parsing costs. Combining several spoken operations into one note can reduce repeated parser instructions and schema overhead, but does not reduce transcription cost when total audio duration is unchanged.

During the prototype, measure audio duration, transcription usage, parser usage, latency, and correction rate without logging raw audio or sensitive text.

## Cost Controls

- Do not send raw audio to the transaction parser; transcribe first, then send concise text.
- Supply known currencies, categories, and accounts as compact controlled lists.
- Use one structured response rather than a conversational explanation.
- For a daily note, request an array of transaction drafts in one response.
- Avoid cloud realtime transcription unless partial live text is required.
- Do not use asynchronous batch processing for interactive entry.
- Set a project budget and usage alert in the OpenAI Platform.
