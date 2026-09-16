import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, CheckCircle2, Copy, Eye, EyeOff, Loader2, X } from "lucide-react";
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
  "w-full rounded-lg border bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 transition-all focus:outline-none focus:ring-2";
const okBorder = "border-zinc-200/90 focus:border-brand focus:ring-brand/10";
const errBorder = "border-red-400 focus:border-red-500 focus:ring-red-100";

/** Server functions reject with an Error; anything else gets the fallback copy. */
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Field label shared by every control in the form. */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-[11px] font-medium text-zinc-600">
      {children}
    </label>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-[10px] font-medium text-red-500">{message}</p>;
}

/**
 * The public custom-plan enquiry form.
 *
 * Collects workspace provision requirements with an email verification step
 * presented in a dedicated OTP popup modal.
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
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);
  const [otpError, setOtpError] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [referenceId, setReferenceId] = useState("");
  const [copied, setCopied] = useState(false);

  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

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
    setShowOtpModal(false);
    setResendTimer(0);
    setErrors({});
    setFormError("");
    setOtpError("");
    setSubmitting(false);
    setReferenceId("");
    setCopied(false);
    const focusTimer = window.setTimeout(() => firstFieldRef.current?.focus(), 80);
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  // Escape closes active modals, and the page behind the dialog must not scroll.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (showOtpModal) {
          setShowOtpModal(false);
        } else {
          onClose();
        }
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, showOtpModal, onClose]);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const interval = window.setInterval(() => setResendTimer((value) => value - 1), 1000);
    return () => window.clearInterval(interval);
  }, [resendTimer]);

  // Focus the first OTP box when OTP modal opens
  useEffect(() => {
    if (showOtpModal) {
      const timer = window.setTimeout(() => {
        otpInputRefs.current[0]?.focus();
      }, 100);
      return () => window.clearTimeout(timer);
    }
  }, [showOtpModal]);

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
   * Checks eligibility and emails a verification code. Opens the OTP modal popup.
   */
  const sendOtpNow = async (): Promise<boolean> => {
    setSendingCode(true);
    setFormError("");
    setOtpError("");
    try {
      await checkCustomPlanEligibilityServerFn({ data: { email: email.trim(), phone } });
      await sendOtpServerFn({ data: email.trim().toLowerCase() });
      setOtp(Array(OTP_LENGTH).fill(""));
      setResendTimer(RESEND_SECONDS);
      setShowOtpModal(true);
      return true;
    } catch (error) {
      setFormError(errorMessage(error, "Could not send the verification code. Please try again."));
      return false;
    } finally {
      setSendingCode(false);
    }
  };

  /** Submits the request with a verified code. */
  const performSubmit = async (code: string) => {
    if (code.length !== OTP_LENGTH || submitting) return;
    setSubmitting(true);
    setOtpError("");
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
      setShowOtpModal(false);
      setReferenceId(result.referenceId);
    } catch (error) {
      const message = errorMessage(error, "Could not submit your request. Please try again.");
      setOtpError(message);
      // A rejected/expired code is reset so user can retype
      if (/verification code|otp|code/i.test(message)) {
        setOtp(Array(OTP_LENGTH).fill(""));
        otpInputRefs.current[0]?.focus();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOtpChange = (value: string, index: number) => {
    setOtpError("");
    // Handle paste of complete OTP
    if (value.length > 1) {
      const cleaned = value.replace(/\D/g, "").slice(0, OTP_LENGTH);
      if (cleaned) {
        const next = Array(OTP_LENGTH).fill("");
        cleaned.split("").forEach((char, i) => {
          if (i < OTP_LENGTH) next[i] = char;
        });
        setOtp(next);
        const nextFocus = Math.min(cleaned.length, OTP_LENGTH - 1);
        otpInputRefs.current[nextFocus]?.focus();
        if (cleaned.length === OTP_LENGTH) {
          void performSubmit(cleaned);
        }
      }
      return;
    }

    if (!/^[0-9]?$/.test(value)) return;
    const next = [...otp];
    next[index] = value;
    setOtp(next);

    if (value && index < OTP_LENGTH - 1) {
      otpInputRefs.current[index + 1]?.focus();
    }

    // Auto-verify + submit the moment every box is filled.
    if (next.every((digit) => digit !== "")) {
      void performSubmit(next.join(""));
    }
  };

  const handleOtpKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === "Backspace" && !otp[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    } else if (event.key === "ArrowLeft" && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    } else if (event.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!pasted) return;
    const next = Array(OTP_LENGTH).fill("");
    pasted.split("").forEach((char, i) => {
      if (i < OTP_LENGTH) next[i] = char;
    });
    setOtp(next);
    const nextFocus = Math.min(pasted.length, OTP_LENGTH - 1);
    otpInputRefs.current[nextFocus]?.focus();
    if (pasted.length === OTP_LENGTH) {
      void performSubmit(pasted);
    }
  };

  const handleResend = async () => {
    if (resendTimer > 0 || sendingCode || submitting) return;
    setSendingCode(true);
    setOtpError("");
    try {
      await sendOtpServerFn({ data: email.trim().toLowerCase() });
      setOtp(Array(OTP_LENGTH).fill(""));
      setResendTimer(RESEND_SECONDS);
      otpInputRefs.current[0]?.focus();
    } catch (error) {
      setOtpError(errorMessage(error, "Failed to resend code. Please try again."));
    } finally {
      setSendingCode(false);
    }
  };

  const handleInitialSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting || sendingCode) return;
    setFormError("");

    if (!validateAll()) return;
    await sendOtpNow();
  };

  const handleOtpModalSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const code = otp.join("");
    if (code.length !== OTP_LENGTH) {
      setOtpError(`Please enter the complete ${OTP_LENGTH}-digit verification code.`);
      return;
    }
    await performSubmit(code);
  };

  const copyReference = () => {
    if (!referenceId) return;
    navigator.clipboard.writeText(referenceId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const article = /^[aeiou]/i.test(planName) ? "an" : "a";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-zinc-950/50 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !showOtpModal) onClose();
          }}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cpr-title"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="my-auto w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-2xl"
          >
            {/* Header */}
            <div
              className={`flex items-start justify-between gap-4 px-5 ${
                referenceId ? "pb-0 pt-4" : "border-b border-zinc-100 py-4"
              }`}
            >
              {referenceId ? (
                <span aria-hidden="true" />
              ) : (
                <div>
                  <h2 id="cpr-title" className="text-sm font-bold text-zinc-900">
                    Request {article} {planName} plan
                  </h2>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    Tell us about your business and we will build the plan around it.
                  </p>
                </div>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
              >
                <X className="size-4" />
              </button>
            </div>

            {referenceId ? (
              /* ── Success state ── */
              <div className="px-6 pb-8 pt-5 text-center">
                <motion.div
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 280, damping: 20 }}
                  className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200/60"
                >
                  <CheckCircle2 className="size-6" />
                </motion.div>
                <h3 id="cpr-title" className="mt-3.5 text-base font-bold text-zinc-900">
                  Request Submitted Successfully
                </h3>
                <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-zinc-500">
                  Thanks, <span className="font-semibold text-zinc-800">{name.split(" ")[0] || "there"}</span>!
                  We received your custom plan request and emailed a confirmation to{" "}
                  <span className="font-semibold text-zinc-800">{email}</span>. Your workspace goes live
                  once your plan is activated.
                </p>
                <div className="mx-auto mt-4 inline-flex items-center gap-2.5 rounded-lg border border-zinc-200 bg-zinc-50/80 px-3.5 py-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    Reference ID
                  </span>
                  <span className="font-mono text-xs font-bold text-zinc-900">{referenceId}</span>
                  <button
                    type="button"
                    onClick={copyReference}
                    title="Copy reference ID"
                    className="ml-0.5 text-zinc-400 transition-colors hover:text-zinc-700"
                  >
                    {copied ? (
                      <Check className="size-3 text-emerald-600" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="mt-6 w-full rounded-lg bg-zinc-900 py-2.5 text-xs font-semibold text-white transition-all hover:bg-zinc-800"
                >
                  Done
                </button>
              </div>
            ) : (
              /* ── Form state ── */
              <form onSubmit={handleInitialSubmit} className="max-h-[75vh] overflow-y-auto px-5 py-4">
                <div className="space-y-3">
                  {/* Row 1: Full name + Phone */}
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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
                        placeholder="e.g. Minal Patil"
                        autoComplete="name"
                        aria-invalid={!!errors.name}
                        disabled={sendingCode || submitting}
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
                        placeholder="e.g. 7745868083"
                        autoComplete="tel"
                        aria-invalid={!!errors.phone}
                        disabled={sendingCode || submitting}
                        className={`${inputClass} ${errors.phone ? errBorder : okBorder}`}
                      />
                      <FieldError message={errors.phone} />
                    </div>
                  </div>

                  {/* Row 2: Work email + Password */}
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <div>
                      <FieldLabel>Work email</FieldLabel>
                      <input
                        type="email"
                        value={email}
                        onChange={(event) => {
                          setEmail(event.target.value);
                          clearError("email");
                        }}
                        placeholder="name@company.com"
                        autoComplete="email"
                        aria-invalid={!!errors.email}
                        disabled={sendingCode || submitting}
                        className={`${inputClass} ${errors.email ? errBorder : okBorder}`}
                      />
                      <FieldError message={errors.email} />
                    </div>

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
                          placeholder={`Min. ${PASSWORD_MIN_LENGTH} characters`}
                          autoComplete="new-password"
                          aria-invalid={!!errors.password}
                          disabled={sendingCode || submitting}
                          className={`${inputClass} pr-8 ${errors.password ? errBorder : okBorder}`}
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => setShowPassword((value) => !value)}
                          aria-label={showPassword ? "Hide password" : "Show password"}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors hover:text-zinc-700"
                        >
                          {showPassword ? (
                            <EyeOff className="size-3.5" />
                          ) : (
                            <Eye className="size-3.5" />
                          )}
                        </button>
                      </div>
                      <FieldError message={errors.password} />
                    </div>
                  </div>

                  {/* Row 3: Business Type + Clinic / Business Name */}
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <div>
                      <FieldLabel>Business type</FieldLabel>
                      <select
                        value={profession}
                        onChange={(event) => {
                          setProfession(event.target.value);
                          clearError("profession");
                          clearError("businessName");
                        }}
                        disabled={sendingCode || submitting}
                        className={`${inputClass} cursor-pointer font-medium ${errors.profession ? errBorder : okBorder}`}
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
                        disabled={sendingCode || submitting}
                        className={`${inputClass} ${errors.businessName ? errBorder : okBorder}`}
                      />
                      <FieldError message={errors.businessName} />
                    </div>
                  </div>

                  {/* Row 4: Team size */}
                  <div>
                    <FieldLabel>Team size</FieldLabel>
                    <select
                      value={practiceSize}
                      onChange={(event) => {
                        setPracticeSize(event.target.value);
                        clearError("practiceSize");
                      }}
                      disabled={sendingCode || submitting}
                      className={`${inputClass} cursor-pointer font-medium ${errors.practiceSize ? errBorder : okBorder}`}
                    >
                      {PRACTICE_SIZE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <FieldError message={errors.practiceSize} />
                  </div>

                  {/* Row 5: What do you need? */}
                  <div>
                    <FieldLabel>
                      What do you need? <span className="font-normal text-zinc-400">(optional)</span>
                    </FieldLabel>
                    <textarea
                      value={requirements}
                      onChange={(event) => {
                        setRequirements(event.target.value);
                        clearError("requirements");
                      }}
                      rows={2}
                      maxLength={REQUIREMENTS_MAX_LENGTH}
                      placeholder="Number of locations, integrations, volumes, custom workflows..."
                      disabled={sendingCode || submitting}
                      className={`${inputClass} resize-none ${errors.requirements ? errBorder : okBorder}`}
                    />
                    <FieldError message={errors.requirements} />
                  </div>

                  {formError && (
                    <div
                      role="alert"
                      className="rounded-lg border border-red-100 bg-red-50/80 px-3 py-2 text-center"
                    >
                      <p className="text-[11px] font-medium text-red-600">
                        {formError}
                      </p>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={sendingCode || submitting}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 py-2.5 text-xs font-semibold text-white transition-all hover:bg-zinc-800 active:scale-[0.99] disabled:opacity-60"
                >
                  {sendingCode ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      <span>Sending verification code...</span>
                    </>
                  ) : (
                    <span>Verify &amp; Submit</span>
                  )}
                </button>
                <p className="mt-2 text-center text-[10px] text-zinc-400">
                  We will email a 4-digit verification code to confirm your email.
                </p>
              </form>
            )}
          </motion.div>

          {/* Dedicated OTP Verification Popup Modal */}
          <AnimatePresence>
            {showOtpModal && (
              <div className="fixed inset-0 z-[110] flex items-center justify-center bg-zinc-950/60 p-4 backdrop-blur-sm">
                <motion.div
                  initial={{ opacity: 0, scale: 0.94, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.94, y: 10 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="relative w-full max-w-sm rounded-2xl border border-zinc-200/90 bg-white p-6 text-center shadow-2xl"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setShowOtpModal(false);
                      setOtpError("");
                    }}
                    disabled={submitting}
                    aria-label="Back to details"
                    className="absolute right-3.5 top-3.5 rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
                  >
                    <X className="size-4" />
                  </button>

                  <h3 className="text-sm font-bold text-zinc-900">Verify your email</h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    Enter the 4-digit code sent to
                  </p>
                  <div className="mt-0.5 flex items-center justify-center gap-1.5">
                    <span className="text-xs font-semibold text-zinc-800">{email}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowOtpModal(false);
                        setOtpError("");
                      }}
                      disabled={submitting}
                      className="text-[10px] font-medium text-brand underline decoration-brand/30 underline-offset-2 transition-colors hover:text-brand-dark"
                    >
                      Edit details
                    </button>
                  </div>

                  <form onSubmit={handleOtpModalSubmit} className="mt-5">
                    {/* 4-digit OTP Boxes */}
                    <div className="flex justify-center gap-2.5">
                      {otp.map((digit, index) => (
                        <input
                          key={index}
                          ref={(element) => {
                            otpInputRefs.current[index] = element;
                          }}
                          type="text"
                          inputMode="numeric"
                          maxLength={OTP_LENGTH}
                          value={digit}
                          onChange={(event) => handleOtpChange(event.target.value, index)}
                          onKeyDown={(event) => handleOtpKeyDown(event, index)}
                          onPaste={handleOtpPaste}
                          aria-label={`Digit ${index + 1}`}
                          disabled={submitting}
                          className="size-11 rounded-xl border border-zinc-200/90 bg-zinc-50/50 text-center text-base font-bold text-zinc-900 transition-all focus:border-brand focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:opacity-60"
                        />
                      ))}
                    </div>

                    {otpError && (
                      <p className="mt-3 text-[11px] font-medium text-red-500">
                        {otpError}
                      </p>
                    )}

                    <div className="mt-4 text-[11px] text-zinc-400">
                      Didn&apos;t get it?{" "}
                      <button
                        type="button"
                        onClick={handleResend}
                        disabled={resendTimer > 0 || sendingCode || submitting}
                        className="font-semibold text-brand transition-colors hover:underline disabled:text-zinc-400 disabled:no-underline"
                      >
                        {sendingCode
                          ? "Sending..."
                          : resendTimer > 0
                            ? `Resend in ${resendTimer}s`
                            : "Resend code"}
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={submitting || otp.some((d) => !d)}
                      className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 py-2.5 text-xs font-semibold text-white transition-all hover:bg-zinc-800 active:scale-[0.99] disabled:opacity-50"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" />
                          <span>Verifying &amp; Submitting...</span>
                        </>
                      ) : (
                        <span>Verify &amp; Submit</span>
                      )}
                    </button>
                  </form>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
