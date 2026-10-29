/**
 * One error type for every provider.
 *
 * `status` is HTTP-shaped so a route can pass it straight through: 4xx means the
 * reader can fix it (a wrong code, an unknown email, a login the provider
 * refused, nothing connected), 5xx means it is ours or the provider's (a proxy out
 * of bandwidth, an edge that refused our exit, a reply we could not read).
 * `readerFault` says the same thing as a boolean, for pages that only need to
 * choose between "check what you typed" and "try again later".
 *
 * Messages are written for the reader. `data` carries what the provider actually
 * said, for logs, and is never meant to be shown.
 */
export class ProviderError extends Error {
  /**
   * @param {string} message
   * @param {number} [status]
   * @param {unknown} [data]
   * @param {{ provider?: string }} [opts]
   */
  constructor(message, status = 502, data = null, { provider = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.data = data;
    this.provider = provider;
  }

  /** True when the reader can fix it themselves (any 4xx). */
  get readerFault() {
    return this.status >= 400 && this.status < 500;
  }
}

/** True for any provider error, whichever adapter threw it. */
export const isProviderError = (err) => err instanceof ProviderError;
