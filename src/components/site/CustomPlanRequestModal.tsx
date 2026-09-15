import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, CheckCircle2, Eye, EyeOff, Loader2, Sparkles, X } from "lucide-react";
import { sendOtpServerFn } from "@/lib/auth";
import {
  checkCustomPlanEligibilityServerFn,
  createCustomPlanRequestServerFn,
} from "@/lib/custom-plan-requests";
import {
  PASSWORD_MIN_LENGTH,
  REQUIREMENTS_MAX_LENGTH,
  validateCustomPlanRequest,
} from "@/lib/custom-plan";
import {
  DEFAULT_PROFESSION,
  PRACTICE_SIZE_OPTIONS,
  PROFESSION_OPTIONS,
} from "@/lib/tenant-provisioning";
import { businessNameLabelForProfession } from "@/lib/restaurant-availability";

/** The team size a custom-plan enquiry defaults to. */
const DEFAULT_PRACTICE_SIZE = "Large Clinic (16-50 providers)";

const OTP_LENGTH = 4;
const RESEND_SECONDS = 30;

const inputClass =
  "w-full rounded-xl border bg-white px-3.5 py-2.5 text-xs text-zinc-800 placeholder:text-zinc-400 transition-all focus:outline-none";
const okBorder = "border-zinc-200 focus:border-brand";
const errBorder = "border-red-400 focus:border-red-500";

/** Server functions reject with an Error; anything else gets the fallback copy. */
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Field label shared by every control in the form. */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block pl-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
      {children}
    </span>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 pl-1 text-[10px] font-semibold text-red-500">{message}</p>;
}

/**
 * The public custom-plan enquiry form.
 *
 * Collects exactly what signup collects (minus the plan selector — the plan is
 * what is being negotiated) so an approved request can provision a workspace
 * with no follow-up questions. The email is proved with a one-time code before
 * the record is created, because the password captured here becomes the
 * requester's real credential once a super admin activates the plan.
 */
export function CustomPlanRequestModal({
  open,
  onClose,
  planName = "Enterprise",
}: {
  open: boolean;
  onClose: () => void;
  planName?: string;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [profession, setProfession] = useState(DEFAULT_PROFESSION);
  const [businessName, setBusinessName] = useState("");
  const [practiceSize, setPracticeSize] = useState(DEFAULT_PRACTICE_SIZE);
  const [requirements, setRequirements] = useState("");

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [codeSent, setCodeSent] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [referenceId, setReferenceId] = useState("");

  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const businessNameLabel = useMemo(() => businessNameLabelForProfession(profession), [profession]);

  // Reset everything whenever the dialog is reopened so a previous submission or
  // error state never leaks into a fresh enquiry.
  useEffect(() => {
    if (!open) return;
    setName("");
    setPhone("");
    setEmail("");
    setPassword("");
    setShowPassword(false);
    setProfession(DEFAULT_PROFESSION);
    setBusinessName("");
    setPracticeSize(DEFAULT_PRACTICE_SIZE);
    setRequirements("");
    setOtp(Array(OTP_LENGTH).fill(""));
    setCodeSent(false);
    setResendTimer(0);
    setErrors({});
    setFormError("");
    setSubmitting(false);
    setReferenceId("");
    const focusTimer = window.setTimeout(() => firstFieldRef.current?.focus(), 80);
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  // Escape closes, and the page behind the dialog must not scroll.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const interval = window.setInterval(() => setResendTimer((value) => value - 1), 1000);
    return () => window.clearInterval(interval);
  }, [resendTimer]);

  const clearError = (field: string) => {
    setFormError("");
    setErrors((previous) => {
      if (!previous[field]) return previous;
      const next = { ...previous };
      delete next[field];
      return next;
    });
  };

  /** Runs the shared validator and paints one message per offending field. */
  const validateAll = (): boolean => {
    const result = validateCustomPlanRequest({
      name,
      phone,
      email,
      password,
      profession,
      businessName,
      practiceSize,
      requirements,
    });
    if (result.ok) {
      setErrors({});
      return true;
    }
    const mapped: Record<string, string> = {};
    for (const error of result.errors) {
      if (!mapped[error.field]) mapped[error.field] = error.message;
    }
    setErrors(mapped);
    return false;
  };

  /**
   * Checks eligibility and emails a verification code. Shared by the initial
   * submit and the "Resend" control. Returns whether a code went out.
   */
  const sendOtpNow = async (): Promise<boolean> => {
    setSendingCode(true);
    setFormError("");
    try {
      await checkCustomPlanEligibilityServerFn({ data: { email: email.trim(), phone } });
      await sendOtpServerFn({ data: email.trim().toLowerCase() });
      setCodeSent(true);
      setOtp(Array(OTP_LENGTH).fill(""));
      setResendTimer(RESEND_SECONDS);
      window.setTimeout(() => document.getElementById("cpr-otp-0")?.focus(), 60);
      return true;
    } catch (error) {
      setFormError(errorMessage(error, "Could not send the verification code. Please try again."));
      return false;
    } finally {
      setSendingCode(false);
    }
  };

  /** Submits the request with a verified code. Called automatically once the
   *  final OTP digit is entered (and by the button as a manual fallback). */
  const performSubmit = async (code: string) => {
    if (code.length !== OTP_LENGTH || submitting) return;
    setSubmitting(true);
    setFormError("");
    try {
      const result = await createCustomPlanRequestServerFn({
        data: {
          name,
          phone,
          email,
          password,
          profession,
          businessName,
          practiceSize,
          requirements,
          otp: code,
        },
      });
      setReferenceId(result.referenceId);
    } catch (error) {
      const message = errorMessage(error, "Could not submit your request. Please try again.");
      setFormError(message);
      // A rejected/expired code is worth resetting for so the requester can
      // retype it without losing everything else they filled in.
      if (/verification code/i.test(message)) {
        setOtp(Array(OTP_LENGTH).fill(""));
        document.getElementById("cpr-otp-0")?.focus();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOtpChange = (value: string, index: number) => {
    if (!/^[0-9]?$/.test(value)) return;
    setFormError("");
    const next = [...otp];
    next[index] = value;
    setOtp(next);
    if (value && index < OTP_LENGTH - 1) {
      document.getElementById(`cpr-otp-${index + 1}`)?.focus();
    }
    // Auto-verify + submit the moment every box is filled.
    if (next.every((digit) => digit !== "")) {
      void performSubmit(next.join(""));
    }
  };

  const handleOtpKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === "Backspace" && !otp[index] && index > 0) {
      document.getElementById(`cpr-otp-${index - 1}`)?.focus();
    }
  };

  const handleResend = async () => {
    if (resendTimer > 0 || sendingCode || submitting) return;
    await sendOtpNow();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting || sendingCode) return;
    setFormError("");

    // First press: validate the whole form, then email the code and reveal the
    // OTP boxes. There is no separate "send code" step.
    if (!codeSent) {
      if (!validateAll()) return;
      await sendOtpNow();
      return;
    }

    // Manual fallback if auto-submit didn't fire (e.g. paste without keyup).
    const code = otp.join("");
    if (code.length !== OTP_LENGTH) {
      setFormError(`Enter the ${OTP_LENGTH}-digit code we emailed you.`);
      return;
    }
    await performSubmit(code);
  };

  // Fields lock once the code is on its way, so the submitted request always
  // matches the details the code was issued for.
  const fieldsDisabled = submitting || sendingCode || codeSent;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-zinc-950/50 p-4 backdrop-blur-sm sm:items-center"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cpr-title"
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 12 }}
            transition={{ duration: 0.18 }}
            className="my-auto w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl"
          >
            {/* Header. On success the heading, blurb, and icon are dropped — the
                confirmation panel below carries its own tick and heading, so
                repeating them here would say the same thing twice. */}
            <div
              className={`flex items-start justify-between gap-4 px-6 ${
                referenceId ? "pb-0 pt-4" : "border-b border-zinc-100 py-5"
              }`}
            >
              {referenceId ? (
                <span aria-hidden="true" />
              ) : (
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                    <Sparkles className="size-4" />
                  </span>
                  <div>
                    <h2 id="cpr-title" className="text-base font-bold tracking-tight text-zinc-900">
                      Request a {planName} plan
                    </h2>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                      Tell us about your business and we will build the plan around it.
                    </p>
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
              >
                <X className="size-4" />
              </button>
            </div>

            {referenceId ? (
              /* ── Success state ── */
              <div className="px-6 pb-10 pt-6 text-center">
                <motion.div
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 18 }}
                  className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-emerald-100"
                >
                  <CheckCircle2 className="size-9 text-emerald-500" strokeWidth={2.2} />
                </motion.div>
                {/* Carries the cpr-title id in this state so the dialog keeps an
                    accessible name once the header heading is gone. */}
                <h3 id="cpr-title" className="mt-5 text-lg font-bold tracking-tight text-zinc-900">
                  Thanks, {name.split(" ")[0] || "there"}!
                </h3>
                <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-zinc-500">
                  Your custom plan request is with our team. We have emailed a confirmation to{" "}
                  <span className="font-semibold text-zinc-700">{email}</span>. Your workspace goes
                  live as soon as your plan is approved and activated.
                </p>
                <div className="mx-auto mt-5 inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    Reference
                  </span>
                  <span className="font-mono text-xs font-bold text-zinc-900">{referenceId}</span>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="mt-7 w-full rounded-xl bg-zinc-900 py-2.5 text-xs font-bold text-white transition-all hover:bg-zinc-800"
                >
                  Done
                </button>
              </div>
            ) : (
              /* ── Form state ── */
              <form onSubmit={handleSubmit} className="max-h-[70vh] overflow-y-auto px-6 py-5">
                <div className="space-y-3.5">
                  <div>
                    <FieldLabel>Full name</FieldLabel>
                    <input
                      ref={firstFieldRef}
                      type="text"
                      value={name}
                      onChange={(event) => {
                        setName(event.target.value);
                        clearError("name");
                      }}
                      placeholder="Your name"
                      autoComplete="name"
                      aria-invalid={!!errors.name}
                      disabled={fieldsDisabled}
                      className={`${inputClass} ${errors.name ? errBorder : okBorder}`}
                    />
                    <FieldError message={errors.name} />
                  </div>

                  <div>
                    <FieldLabel>Phone</FieldLabel>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(event) => {
                        setPhone(event.target.value);
                        clearError("phone");
                      }}
                      placeholder="+91 98765 43210"
                      autoComplete="tel"
                      aria-invalid={!!errors.phone}
                      disabled={fieldsDisabled}
                      className={`${inputClass} ${errors.phone ? errBorder : okBorder}`}
                    />
                    <FieldError message={errors.phone} />
                  </div>

                  <div>
                    <FieldLabel>Work email</FieldLabel>
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        clearError("email");
                      }}
                      placeholder="you@company.com"
                      autoComplete="email"
                      aria-invalid={!!errors.email}
                      disabled={fieldsDisabled}
                      className={`${inputClass} ${errors.email ? errBorder : okBorder}`}
                    />
                    <FieldError message={errors.email} />
                  </div>

                  {/* Verification code — revealed after the first submit sends it. */}
                  <AnimatePresence initial={false}>
                    {codeSent && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="rounded-xl border border-brand/20 bg-brand/[0.04] px-4 py-3.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-brand">
                              Verify your email
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                setCodeSent(false);
                                setOtp(Array(OTP_LENGTH).fill(""));
                                setFormError("");
                              }}
                              disabled={submitting}
                              className="text-[10px] font-bold text-zinc-400 transition-colors hover:text-zinc-700 disabled:opacity-50"
                            >
                              Edit details
                            </button>
                          </div>
                          <p className="mt-1 text-[11px] text-zinc-500">
                            Enter the {OTP_LENGTH}-digit code sent to{" "}
                            <span className="font-semibold text-zinc-700">{email}</span>.
                          </p>
                          <div className="mt-3 flex items-center gap-2">
                            {otp.map((digit, index) => (
                              <input
                                key={index}
                                id={`cpr-otp-${index}`}
                                type="text"
                                inputMode="numeric"
                                maxLength={1}
                                value={digit}
                                onChange={(event) => handleOtpChange(event.target.value, index)}
                                onKeyDown={(event) => handleOtpKeyDown(event, index)}
                                aria-label={`Verification code digit ${index + 1}`}
                                disabled={submitting}
                                autoFocus={index === 0}
                                className="size-11 rounded-xl border border-zinc-200 bg-white text-center text-base font-bold text-zinc-900 transition-all focus:border-brand focus:outline-none disabled:opacity-60"
                              />
                            ))}
                            {submitting && (
                              <Loader2 className="ml-1 size-4 animate-spin text-brand" />
                            )}
                          </div>
                          <div className="mt-2.5 text-[10px] text-zinc-400">
                            Didn&apos;t get it?{" "}
                            <button
                              type="button"
                              onClick={handleResend}
                              disabled={resendTimer > 0 || sendingCode || submitting}
                              className="font-bold text-brand transition-colors hover:text-brand/80 disabled:text-zinc-400"
                            >
                              {sendingCode
                                ? "Sending..."
                                : resendTimer > 0
                                  ? `Resend in ${resendTimer}s`
                                  : "Resend code"}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div>
                    <FieldLabel>Create password</FieldLabel>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(event) => {
                          setPassword(event.target.value);
                          clearError("password");
                        }}
                        placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
                        autoComplete="new-password"
                        aria-invalid={!!errors.password}
                        disabled={fieldsDisabled}
                        className={`${inputClass} pr-10 ${errors.password ? errBorder : okBorder}`}
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowPassword((value) => !value)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors hover:text-zinc-700"
                      >
                        {showPassword ? (
                          <EyeOff className="size-3.5" />
                        ) : (
                          <Eye className="size-3.5" />
                        )}
                      </button>
                    </div>
                    <FieldError message={errors.password} />
                    <p className="mt-1 pl-1 text-[10px] text-zinc-400">
                      This becomes your sign-in password once your plan is activated.
                    </p>
                  </div>

                  <div>
                    <FieldLabel>Business type</FieldLabel>
                    <select
                      value={profession}
                      onChange={(event) => {
                        setProfession(event.target.value);
                        clearError("profession");
                        clearError("businessName");
                      }}
                      disabled={fieldsDisabled}
                      className={`${inputClass} cursor-pointer font-semibold ${errors.profession ? errBorder : okBorder}`}
                    >
                      {PROFESSION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <FieldError message={errors.profession} />
                  </div>

                  <div>
                    <FieldLabel>{businessNameLabel}</FieldLabel>
                    <input
                      type="text"
                      value={businessName}
                      onChange={(event) => {
                        setBusinessName(event.target.value);
                        clearError("businessName");
                      }}
                      placeholder={businessNameLabel}
                      aria-invalid={!!errors.businessName}
                      disabled={fieldsDisabled}
                      className={`${inputClass} ${errors.businessName ? errBorder : okBorder}`}
                    />
                    <FieldError message={errors.businessName} />
                  </div>

                  <div>
                    <FieldLabel>Team size</FieldLabel>
                    <select
                      value={practiceSize}
                      onChange={(event) => {
                        setPracticeSize(event.target.value);
                        clearError("practiceSize");
                      }}
                      disabled={fieldsDisabled}
                      className={`${inputClass} cursor-pointer font-semibold ${errors.practiceSize ? errBorder : okBorder}`}
                    >
                      {PRACTICE_SIZE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <FieldError message={errors.practiceSize} />
                  </div>

                  <div>
                    <FieldLabel>
                      What do you need? <span className="text-zinc-300">(optional)</span>
                    </FieldLabel>
                    <textarea
                      value={requirements}
                      onChange={(event) => {
                        setRequirements(event.target.value);
                        clearError("requirements");
                      }}
                      rows={3}
                      maxLength={REQUIREMENTS_MAX_LENGTH}
                      placeholder="Number of locations, integrations, volumes, anything specific..."
                      disabled={fieldsDisabled}
                      className={`${inputClass} resize-none ${errors.requirements ? errBorder : okBorder}`}
                    />
                    <FieldError message={errors.requirements} />
                  </div>

                  {formError && (
                    <div
                      role="alert"
                      className="rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5"
                    >
                      <p className="text-[11px] font-semibold leading-relaxed text-red-600">
                        {formError}
                      </p>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={submitting || sendingCode}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 py-3 text-xs font-bold text-white transition-all hover:bg-zinc-800 active:scale-[0.99] disabled:opacity-60"
                >
                  {sendingCode ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" /> Sending verification code...
                    </>
                  ) : submitting ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" /> Submitting request...
                    </>
                  ) : codeSent ? (
                    <>
                      <Check className="size-3.5" /> Verify &amp; submit
                    </>
                  ) : (
                    <>
                      <Check className="size-3.5" /> Submit request
                    </>
                  )}
                </button>
                <p className="mt-3 text-center text-[10px] leading-relaxed text-zinc-400">
                  {codeSent
                    ? "Enter the code above — we'll submit your request automatically once it's verified."
                    : "We'll email a quick verification code to confirm your address, then submit your request."}
                </p>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
