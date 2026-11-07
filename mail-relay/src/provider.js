// Provider adapter: Resend (https://api.resend.com/emails).
//
// Only this Worker holds the provider API key. The request body is built from
// the three validated relay fields, so no caller-supplied key, header, cc/bcc,
// attachment or html part can reach the provider.

export const PROVIDER_ENDPOINT = "https://api.resend.com/emails";

/**
 * The exact provider payload: one sender, one recipient, one subject and the
 * plain-text body. `text` is the only content field, so the provider never
 * renders caller-supplied HTML.
 */
export function buildProviderPayload({ from, message }) {
  return {
    from,
    to: [message.to],
    subject: message.subject,
    text: message.text,
  };
}

/** URL and request init for one provider send. */
export function buildProviderRequest({ apiKey, from, message }) {
  return {
    url: PROVIDER_ENDPOINT,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildProviderPayload({ from, message })),
    },
  };
}

/**
 * Maps the provider status to a retry decision.
 * 2xx accepted. 429 and 5xx are worth another attempt (the queue retries);
 * every other 4xx is a permanent problem with this message or the account.
 * The response body is never read: it may echo the message.
 */
export function classifyProviderStatus(status) {
  const code = Number(status);
  if (Number.isFinite(code) && code >= 200 && code < 300) {
    return { ok: true, retryable: false, status: code };
  }
  const retryable = code === 429 || code >= 500;
  return { ok: false, retryable, status: code };
}
