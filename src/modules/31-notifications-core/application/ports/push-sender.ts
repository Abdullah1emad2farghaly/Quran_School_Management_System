export interface PushTarget {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

/**
 * The outcome of one push attempt.
 *  - `sent`: accepted by the push service.
 *  - `gone`: the subscription no longer exists (HTTP 404/410): delete it.
 *  - `retry`: temporary failure (network, 408, 429, 5xx): try again later.
 *  - `rejected`: permanent failure for this delivery (other 4xx): do not retry it.
 * `error` is a short code such as "HTTP 503": never the endpoint, a key or a response body.
 */
export type PushSendOutcome = { readonly kind: 'sent' } | { readonly kind: 'gone' } | { readonly kind: 'retry'; readonly error: string } | { readonly kind: 'rejected'; readonly error: string };

export interface PushSender {
  send(target: PushTarget, payload: string): Promise<PushSendOutcome>;
}
