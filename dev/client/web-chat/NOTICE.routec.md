# Route C Cinny Attribution

This Route C Spike 0 source slice is derived from Cinny.

- Upstream project: Cinny
- Upstream selected source path: `/Volumes/ED-Temp/oysterun-investigation-repos/capacitor/cinnyapp__cinny`
- Upstream selected revision: `341fedd9321f44675a0394e61684263ee443bee1`
- Upstream license: GNU AGPL-3.0-only, retained in `LICENSE`

Route C changes are scoped to Oysterun Host-origin Matrix facade compatibility:

- Host session-to-Matrix room bootstrap before `matrix-js-sdk` client initialization.
- Host-scoped facade authentication; browser code must not store raw long-lived Synapse tokens.
- `mx.sendMessage` local/remote echo reconciliation proof fields.
- Matrix-backed Oysterun semantic row rendering before generic Cinny message rendering.
- Stable `data-testid` and `data-oysterun-*` DOM proof fields for later Playwright verification.

This source slice is not a Spike 0 PASS claim. Browser verification, Host/Synapse runtime proof, retained screenshots, recording, and artifact-index evidence remain required before acceptance.
