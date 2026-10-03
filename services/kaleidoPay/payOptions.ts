/**
 * Settings the protocol wiring knows and the wallet adapters don't: the KaleidoSwap
 * maker URL (configured with the RGB node) and Arkade's server. Kept dependency-free
 * so services/protocols can set them without importing the payment accounts.
 */
export interface PayOptions { makerUrl?: string; arkServerUrl?: string }
let options: PayOptions = {};
export function setPayOptions(next: PayOptions): void { options = { ...options, ...next }; }
export function getPayOptions(): PayOptions { return options; }
