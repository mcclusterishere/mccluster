/* No sample cars, seller accounts, finance or payment capabilities are implied.
 * This shared transport-market entry is deliberately inert until launch review. */
export function vehicleMarketMarkup() {
 return `<div class="wt-market"><p><strong>No verified listings are published.</strong> Rentals and purchases are in preparation.</p>
 <details><summary>Rent a vehicle</summary><p>Weekly rentals will appear here after owner consent, title, insurance, availability and booking safeguards are verified. No reservation or payment is accepted.</p></details>
 <details><summary>Buy a vehicle</summary><p>House-owned vehicles may eventually offer a sale price alongside a weekly rental rate. Square checkout is not connected for vehicle purchases. Card payment is not financing.</p></details>
 <details><summary>Sell and connect · later</summary><p>Seller-specific accounts, secure title review, peer-to-peer transactions and automotive social features are planned. Applications and uploads are not open.</p></details>
 <p><a href="https://matthew.mccluster.org/control.html#system:rentals">Manage fleet and booking records in Control</a></p></div>`;
}
