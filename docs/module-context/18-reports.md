# 18. Apps menu: Reports / Item Value

## Screens
The "Manage Your Business" apps grid has **Reports** and **Item Value** tiles, but Figma has **no screens**
for them. Plans mention "Smart Alerts & Advanced Reports".

## Data flow
Item Value is a read-only current inventory valuation for the active store. No detailed Figma screen exists yet.

`GET /warehouse/item-value?kind=&page=&limit=` returns a paginated list and an all-items summary.
It requires `products.view` and returns `200` with empty totals when the store has no stock.

- Physical warehouse product variants and owned packaging with on-hand stock are included across all locations. Incoming stock is excluded. Archived products with stock remain included because the stock is still physically held.
- `onHand = available + reserved + damaged`. The API reports each bucket's quantity and known value separately. Reserved and damaged stock remain in on-hand value; the client can show the sellable `knownAvailableValue` separately.
- Bundle availability is calculated from components elsewhere in the warehouse module. Item Value counts the physical component variants only, never the bundle's derived quantity again.
- Product unit cost is the variant's fixed `costPrice`. Packaging unit cost is the amount actually paid on the most recent manual or Shop purchase divided by quantity. A purchase in another currency is converted to the store currency only when an exchange rate exists.
- Imported products without a cost currently store `0`. Zero-cost products and packaging without a qualifying purchase are shown with `unitCost: null`, `onHandValue: null`, and counted under `unvaluedOnHandUnits`; `complete: false` prevents the known subtotal being mistaken for a full inventory valuation. Historical zero costs cannot be distinguished from truly free items without separate cost-verification data.
- Money is returned as decimal strings. `asOf` marks the current response; this API does not reconstruct historical inventory value.
- A confirmed free packaging purchase is a known zero cost, including when paid in another currency; it does not need an exchange quote. Legacy zero-cost product records remain unknown because their cost provenance is unavailable.
- The summary covers all items matching the kind filter, independently of the current page. Packaging cost lookup selects only the latest qualifying purchase per material, including legacy Shop variant/product links.

## Questions

**Q18.1 — What is "Reports"?**
Which reports (sales, profit and loss, courier performance, product performance), and in what format (in-app charts, PDF, Excel)?
Answer: Reports are excluded from v1.

**Q18.2 — What is "Item Value"?**
Is it inventory valuation (stock × cost), or something else?
Assumption: inventory valuation.
Answer: Yes — inventory valuation (`stock × cost`).

**Q18.3 — Are designs coming, or is this out of scope for v1?**
Answer: Item Value is required in v1. No detailed Figma screen has been provided.
