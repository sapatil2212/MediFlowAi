// ─────────────────────────────────────────────────────────────────────────────
// wa-error-classify.ts  (PURE, isomorphic)
//
// Classifies WhatsApp Cloud API send outcomes into actionable buckets so the
// notification dispatcher knows whether a failure may be retried, and so the
// Super Admin dashboard can explain it. Codes and meanings follow Meta's
// documented Cloud API error codes (WhatsApp Business Platform → Support →
// Error codes). Unknown codes are never retried blindly.
//
// Classes:
//   retryable            transient Meta/network condition; safe to retry later
//   permanent            the request or recipient can never succeed as-is
//   configuration        credentials, permissions, IDs or account setup
//   template             template missing, unapproved, paused or param mismatch
//   consent              recipient opted out / not reachable by policy
//   provider_restriction WABA/phone restricted, rate-limited or quality-limited
//   unknown              unclassified; needs investigation, never auto-retried
//
// `ambiguous` marks outcomes where Meta may already have accepted the message
// (e.g. a timeout after the request was sent). Those are never auto-retried,
// to avoid duplicate customer notifications.
// ─────────────────────────────────────────────────────────────────────────────

export type ErrorClass =
  | "retryable"
  | "permanent"
  | "configuration"
  | "template"
  | "consent"
  | "provider_restriction"
  | "unknown";

export interface ClassifiedError {
  errorClass: ErrorClass;
  /** True when an automatic retry (with backoff) is safe and useful. */
  retry: boolean;
  /** Minimum delay before a retry, when Meta's semantics call for one. */
  minRetryDelayMs?: number;
  /** True when the message may already have been accepted by Meta. */
  ambiguous?: boolean;
  /** True when the condition affects every send and should raise an alert. */
  systemic?: boolean;
  /** True when the mapped template should be re-synced from Meta. */
  refreshTemplate?: boolean;
  /** Short admin-facing explanation. Never contains recipient or patient data. */
  hint: string;
}

const MINUTE = 60_000;

/** Meta error codes that are documented as temporary / retry-later. */
const RETRYABLE: Record<string, { hint: string; minRetryDelayMs?: number }> = {
  "1": { hint: "Meta reported a possible server error; the send will be retried." },
  "2": { hint: "Meta is temporarily unavailable or overloaded; the send will be retried." },
  "4": {
    hint: "The app reached its Graph API call rate limit; the send will be retried later.",
    minRetryDelayMs: 5 * MINUTE,
  },
  "80007": {
    hint: "The WhatsApp Business Account reached its rate limit; the send will be retried later.",
    minRetryDelayMs: 5 * MINUTE,
  },
  "130429": {
    hint: "Cloud API throughput was reached; the send will be retried with backoff.",
    minRetryDelayMs: MINUTE,
  },
  "131000": { hint: "Meta reported an unknown send error; the send will be retried." },
  "131016": { hint: "A Meta service is temporarily unavailable; the send will be retried." },
  "131056": {
    hint: "Too many messages to the same recipient in a short period; the send will be retried later.",
    minRetryDelayMs: 2 * MINUTE,
  },
  "131057": {
    hint: "The business account is in maintenance mode; the send will be retried later.",
    minRetryDelayMs: 10 * MINUTE,
  },
  "133004": { hint: "Meta's server is temporarily unavailable; the send will be retried." },
  "134101": {
    hint: "The template is still syncing on Meta's side; the send will be retried shortly.",
    minRetryDelayMs: 2 * MINUTE,
  },
};

const CONFIGURATION: Record<string, string> = {
  "0": "Meta could not authenticate the app user. Re-check the access token.",
  "3": "The app lacks a required capability or permission.",
  "10": "A required permission was not granted or was removed.",
  "33": "The business phone number has been deleted. Re-check the Phone Number ID.",
  "190": "The access token has expired or is invalid. Generate a new System User token.",
  "200": "No valid access token was provided, or permissions are missing.",
  "131005": "The whatsapp_business_messaging permission is missing or was removed.",
  "131037": "The business phone number does not have an approved display name.",
  "131042": "There is a problem with the WhatsApp Business Account payment method.",
  "131045": "The phone number has a registration error. Re-register the number.",
  "133010": "The phone number is not registered on the WhatsApp Business Platform.",
  "134011": "WhatsApp Payments terms acceptance is pending for this account.",
};

const TEMPLATE: Record<string, string> = {
  "132000":
    "The number of template parameters did not match the approved template. Re-sync the template.",
  "132001":
    "The template does not exist in this language or is not approved. Re-sync templates and check the language code.",
  "132005": "A template parameter made the message too long.",
  "132007": "The template content violates a WhatsApp policy.",
  "132012": "A template parameter was formatted incorrectly.",
  "132015": "The template is paused because of low quality and cannot be sent.",
  "132016": "The template was paused too many times and is permanently disabled.",
  "132018": "Meta reported a template validation error.",
  "134102": "The template is unavailable for use.",
};

const PROVIDER_RESTRICTION: Record<string, string> = {
  "368": "The WhatsApp Business Account is restricted for a policy violation.",
  "130497": "The WhatsApp Business Account cannot message users in this country.",
  "131031": "The WhatsApp Business Account is restricted or locked.",
  "131048": "The sender number is limited because previous messages were blocked or reported.",
  "131064": "The account reached a messaging limit due to template classification violations.",
};

const CONSENT_OR_RECIPIENT: Record<string, { cls: ErrorClass; hint: string }> = {
  "131021": { cls: "permanent", hint: "The recipient is the business's own number." },
  "131026": {
    cls: "permanent",
    hint: "The message is undeliverable (not a WhatsApp number, outdated app, or terms not accepted).",
  },
  "131030": {
    cls: "configuration",
    hint: "The recipient is not on the allowed test-recipient list for this phone number.",
  },
  "131047": {
    cls: "permanent",
    hint: "Free-form message sent outside the 24-hour customer service window. Business notifications must use an approved template.",
  },
  "131049": {
    cls: "provider_restriction",
    hint: "Meta chose not to deliver the message to maintain healthy ecosystem engagement.",
  },
  "131050": { cls: "consent", hint: "The recipient stopped receiving marketing messages." },
  "130403": { cls: "consent", hint: "This business has blocked the recipient on WhatsApp." },
  "130472": { cls: "permanent", hint: "The message was withheld as part of a Meta experiment." },
};

const PERMANENT_REQUEST: Record<string, string> = {
  "100": "The request contained an unsupported or invalid parameter.",
  "131008": "The request is missing a required parameter.",
  "131009": "A parameter value is invalid (often the recipient number).",
  "131051": "Unsupported message type.",
  "131055": "The HTTP method is not allowed for this endpoint.",
  "135000": "Unknown error with the request parameters.",
  "1752041": "Meta reported a duplicate request.",
};

/** Classifies a Meta Graph error object returned for a send request. */
export function classifyMetaError(input: {
  httpStatus?: number | null;
  code?: string | number | null;
  subcode?: string | number | null;
  isTransient?: boolean | null;
}): ClassifiedError {
  const code = input.code == null ? "" : String(input.code);

  const retryable = RETRYABLE[code];
  if (retryable) {
    return {
      errorClass: "retryable",
      retry: true,
      minRetryDelayMs: retryable.minRetryDelayMs,
      hint: retryable.hint,
      systemic: code === "4" || code === "80007",
    };
  }
  if (CONFIGURATION[code]) {
    return { errorClass: "configuration", retry: false, systemic: true, hint: CONFIGURATION[code] };
  }
  if (TEMPLATE[code]) {
    return {
      errorClass: "template",
      retry: false,
      refreshTemplate: true,
      systemic: true,
      hint: TEMPLATE[code],
    };
  }
  if (PROVIDER_RESTRICTION[code]) {
    return {
      errorClass: "provider_restriction",
      retry: false,
      systemic: true,
      hint: PROVIDER_RESTRICTION[code],
    };
  }
  const recipient = CONSENT_OR_RECIPIENT[code];
  if (recipient) {
    return { errorClass: recipient.cls, retry: false, hint: recipient.hint };
  }
  if (PERMANENT_REQUEST[code]) {
    return { errorClass: "permanent", retry: false, hint: PERMANENT_REQUEST[code] };
  }
  // Undocumented code: honour Meta's explicit is_transient flag, otherwise a
  // 5xx is treated as transient and anything else needs investigation.
  if (input.isTransient === true || (input.httpStatus != null && input.httpStatus >= 500)) {
    return {
      errorClass: "retryable",
      retry: true,
      hint: "Meta reported a transient error; the send will be retried.",
    };
  }
  return {
    errorClass: "unknown",
    retry: false,
    hint: "Unrecognised Meta error. Review the error code in Meta's documentation before retrying.",
  };
}

/** Message emitted by whatsapp-cloud.ts when the local test allow-list refuses a send. */
export const TEST_ALLOWLIST_MESSAGE_FRAGMENT = "WA_CLOUD_TEST_RECIPIENTS";

/**
 * Classifies a transport-level failure (no Meta error body). Network failures
 * that can only happen before the request reached Meta are safe to retry;
 * timeouts and resets are ambiguous because Meta may have accepted the send.
 */
export function classifyTransportError(input: {
  message?: string | null;
  httpStatus?: number | null;
}): ClassifiedError {
  const message = String(input.message ?? "");
  if (message.includes(TEST_ALLOWLIST_MESSAGE_FRAGMENT)) {
    return {
      errorClass: "configuration",
      retry: false,
      hint: "This server runs in test mode (WA_CLOUD_TEST_RECIPIENTS); the recipient is not on the test list.",
    };
  }
  if (/not configured/i.test(message)) {
    return {
      errorClass: "configuration",
      retry: true,
      minRetryDelayMs: 5 * MINUTE,
      systemic: true,
      hint: "WhatsApp Cloud API credentials are not configured or enabled.",
    };
  }
  if (input.httpStatus != null && input.httpStatus >= 500) {
    return {
      errorClass: "retryable",
      retry: true,
      hint: `Meta returned HTTP ${input.httpStatus}; the send will be retried.`,
    };
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|getaddrinfo/i.test(message)) {
    return {
      errorClass: "retryable",
      retry: true,
      hint: "Could not reach graph.facebook.com before sending; the send will be retried.",
    };
  }
  if (/No message id in response/i.test(message)) {
    return {
      errorClass: "unknown",
      retry: false,
      ambiguous: true,
      hint: "Meta returned success without a message id. Verify on the recipient side before retrying.",
    };
  }
  return {
    errorClass: "unknown",
    retry: false,
    ambiguous: true,
    hint: "The request timed out or the connection dropped after sending. It may have been delivered, so it is not retried automatically.",
  };
}

/**
 * Exponential backoff with full jitter: random in [0, min(cap, base·2^(n-1))],
 * floored at `floorMs`. `attempt` is 1-based (the attempt that just failed).
 */
export function backoffDelayMs(
  attempt: number,
  opts: { baseMs?: number; capMs?: number; floorMs?: number; random?: () => number } = {},
): number {
  const base = opts.baseMs ?? 30_000;
  const cap = opts.capMs ?? 6 * 60 * MINUTE;
  const floor = opts.floorMs ?? 15_000;
  const rnd = opts.random ?? Math.random;
  const exp = Math.min(cap, base * Math.pow(2, Math.max(0, attempt - 1)));
  return Math.max(floor, Math.round(rnd() * exp));
}
