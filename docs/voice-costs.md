# Voice Input Cost Notes

Last reviewed: 2026-07-18. Prices are planning inputs and must be rechecked before implementation.

## Recommended Order

1. Use Apple Speech/SpeechAnalyzer on device when supported: no OpenAI audio transcription charge.
2. Send the resulting text to `gpt-5.6-luna` for structured transaction extraction.
3. Use `gpt-4o-mini-transcribe` as a server-side fallback when Apple recognition is unavailable or insufficient.
4. Use realtime cloud transcription only if live partial results materially improve the product.

## Billing Layers

Voice capture can incur two independent costs:

- speech-to-text: based on audio tokens or audio duration, depending on the model;
- transaction extraction: Luna text input and structured text output tokens.

Combining ten spoken operations into one note reduces repeated Luna instructions and schema overhead, but does not materially reduce speech-to-text cost when the total audio duration is unchanged.

## Planning Scenarios

Assumptions: ten operations per day, roughly two minutes of total speech, and concise structured output.

| Strategy | Approximate planning cost |
| --- | ---: |
| Apple on-device transcription + immediate Luna parsing | about $0.30–$0.75/month |
| Apple on-device transcription + one daily multi-operation Luna request | about $0.10–$0.30/month |
| Cloud mini transcription + Luna | add roughly $0.18–$0.36/month for two audio minutes/day, then add Luna cost |
| Realtime Whisper + Luna | audio alone is about $1.02/month at two minutes/day, then add Luna cost |

The cloud-mini range is an estimate because current billing is token-based. The application must record actual API usage and audio duration during the prototype.

## Cost Controls

- Do not send raw audio to Luna; transcribe first, then send concise text.
- Supply known currencies, categories, and accounts as compact controlled lists.
- Use one structured response rather than a conversational explanation.
- For a daily note, request an array of transaction drafts in one response.
- Avoid cloud realtime transcription unless partial live text is required.
- Do not use the OpenAI Batch API for interactive entry; it can take up to 24 hours.
- Set a project budget and usage alert in the OpenAI Platform.

## Sources

- OpenAI GPT-4o mini Transcribe: https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe
- OpenAI GPT-Realtime-Whisper: https://developers.openai.com/api/docs/models/gpt-realtime-whisper
- OpenAI GPT-5.6 Luna: https://developers.openai.com/api/docs/models/gpt-5.6-luna
- Apple Speech framework: https://developer.apple.com/documentation/speech/
- Apple on-device recognition: https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition
