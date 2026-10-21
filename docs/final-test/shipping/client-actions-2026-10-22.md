# Shipping — client/provider actions required

Verified 22 October 2026 against the production backend.

## Ameex: provider firewall blocks API requests

Both parcel import and the basic status endpoint are blocked upstream with HTTP 403. The provider response says:

> Access denied by Imunify360 bot-protection. IPs used for automation should be whitelisted

The backend correctly reports a failed sync (`success: false`, `failed: 1`); the direct status endpoint returns 502 for the upstream 403. A saved connection is not evidence that its API requests are currently permitted. Do not display the sync as successful merely because its HTTP envelope is 200.

Required action: have Ameex allow authorized backend API traffic through its firewall. Confirm whether they can exempt the authenticated customer API integration or require fixed outbound IP allowlisting. Cloud Run normally uses dynamic outbound addresses; do not give the service's inbound URL/IP as its outbound IP. If Ameex requires fixed egress, that needs a deliberate network/egress configuration and cost review. No firewall bypass or additional infrastructure was created.

After Ameex enables access, repeat status validation, a bounded import, parcel detail/tracking and a representative dashboard-created parcel-to-order match. Do not replace a denied response with static shipments or mark it connected-and-healthy. No credential value or customer information belongs in this document.

## Sendit: disconnected

The current account has no Sendit connection. Its sync correctly returns 409. A valid merchant connection is needed before a real Sendit parcel/label or matched callback can be accepted.

## Real-world acceptance still required

- Genuine courier Delivered/Returned events, then verify stock, revenue, fees and profit. Locally signed callback probes do not establish that the courier is delivering events.
- Print a label and scan with the frontend on an actual phone or handheld device. Software PDF decoding verifies the barcode content and backend lookup only.
- Create a representative parcel in a courier dashboard with an exact Zomaal order reference and verify automatic import/matching. QuickLivraison imported two pre-existing provider parcels successfully in this run; that does not establish a fresh controlled order match.
- Repeat representative parcel flows for connected couriers beyond ForceLog. OzoneExpress sync succeeded with no imported parcels; Ameex was blocked as above.
