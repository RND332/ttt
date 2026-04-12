# Twitter/X mocks

Static HTML fixtures for reviewing extension behavior against common X states.

Files:
- `for-you-scroll.html` — the For you feed with mixed media and non-media posts
- `followed-scroll.html` — the Following feed with a different post mix/order
- `tweet-page.html` — canonical single-tweet detail page
- `tweet-photo-open.html` — the `.../photo/1` image-open state for the sample tweet

These are intentionally lightweight DOM mocks, not production-grade replicas.
They include the selectors the extension already depends on:
- `article`
- `/status/` links
- `div[data-testid='tweetPhoto'] img`
- nested quoted tweets to help verify isolation
