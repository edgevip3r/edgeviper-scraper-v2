# Architecture (MVP)


Pipeline: snapshot → parse (RawOffer[]) → classify (Offer) → map (Betfair) → price (fair odds) → filter → publish → (Skipped log).


- **Type-centric**: Offer Types live under /bettypes. Bookmaker code stays thin.
- **Stealth**: centralized anti-bot (no proxies yet): UA/viewport/timezone, consent, hydration waits, header normalizer.
- **Idempotency**: UID in AA column; dedupe window 72h (configurable) with KO in UID to avoid blocking different fixtures.
- **Manual first**: spacing present but set to 0; Y-prefill off; L= P.