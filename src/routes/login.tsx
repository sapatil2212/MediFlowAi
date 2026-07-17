import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { HeartPulse, Home, X, Check, Loader2, AlertCircle, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import {
  loginServerFn,
  sendOtpServerFn,
  verifyOtpServerFn,
  resetPasswordServerFn,
  getExpiredUserPlanDetailsServerFn,
  createCashfreeOrderServerFn,
  verifyAndProcessPaymentServerFn
} from "../lib/auth";
import bmtLogo from "../assets/bmt-logo.png";


export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign In — BookMyTime" },
      {
        name: "description",
        content: "Sign in to your BookMyTime clinic workspace.",
      },
    ],
  }),
  component: LoginPage,
});

const carouselImages = [
  {
    url: "https://images.unsplash.com/photo-1498837167922-ddd27525d352?auto=format&fit=crop&q=80&w=1000",
    alt: "Healthy nutritious food plate",
  },
  {
    url: "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&q=80&w=1000",
    alt: "Modern medical professional consulting room",
  },
  {
    url: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&q=80&w=1000",
    alt: "Person practicing yoga for health and wellness",
  },
];

function LoginPage() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const navigate = useNavigate();

  // Login form states
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isLoginSuccess, setIsLoginSuccess] = useState(false);
  const [successName, setSuccessName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Forgot Password Modal States
  const [isForgotModalOpen, setIsForgotModalOpen] = useState(false);
  const [forgotStep, setForgotStep] = useState(1); // 1: Email, 2: OTP, 3: New Password
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotOtpValues, setForgotOtpValues] = useState(["", "", "", ""]);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [forgotVerificationSuccess, setForgotVerificationSuccess] = useState(false);
  const [forgotResetSuccess, setForgotResetSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Subscription Renewal States
  const [isRenewModalOpen, setIsRenewModalOpen] = useState(false);
  const [renewUserPlanDetails, setRenewUserPlanDetails] = useState<any>(null);
  const [selectedRenewPlan, setSelectedRenewPlan] = useState<"Basic" | "Premium">("Basic");
  const [renewLoading, setRenewLoading] = useState(false);
  const [isVerifyingPayment, setIsVerifyingPayment] = useState(false);

  // Handle click on Renew button
  const handleRenewClick = async () => {
    if (!username) {
      toast.error("Please enter your Username (Email or Phone) first.");
      return;
    }
    setLoading(true);
    setErrorMsg("");
    try {
      const details = await getExpiredUserPlanDetailsServerFn({ data: { username } });
      setRenewUserPlanDetails(details);
      setIsRenewModalOpen(true);
    } catch (err: any) {
      toast.error(err.message || "Failed to fetch account details. Please ensure your username is correct.");
    } finally {
      setLoading(false);
    }
  };

  // Initiate Cashfree checkout
  const handleInitiatePayment = async (plan: "Basic" | "Premium") => {
    setRenewLoading(true);
    try {
      const res = await createCashfreeOrderServerFn({
        data: { username, planName: plan }
      });
      
      if (res.success && res.payment_session_id) {
        toast.success("Initiating Cashfree Payment Gateway...");
        
        if (!(window as any).Cashfree) {
          throw new Error("Cashfree payment gateway SDK failed to load. Please refresh the page.");
        }
        
        const cashfree = (window as any).Cashfree({
          mode: res.environment === "production" ? "production" : "sandbox"
        });
        
        await cashfree.checkout({
          paymentSessionId: res.payment_session_id,
          returnUrl: `http://localhost:3000/login?order_id=${res.order_id}`
        });
      } else {
        toast.error("Failed to generate payment session. Please try again.");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to trigger payment. Please try again.");
    } finally {
      setRenewLoading(false);
    }
  };

  // Verify payment on return
  const verifyPayment = async (orderId: string) => {
    setIsVerifyingPayment(true);
    const loadingToastId = toast.loading("Verifying your payment with Cashfree...");
    try {
      const res = await verifyAndProcessPaymentServerFn({ data: { orderId } });
      if (res.success) {
        toast.success(`Payment verified successfully! Your ${res.plan} subscription is now Active.`, {
          id: loadingToastId,
          duration: 6000,
        });
      } else {
        // Silently dismiss the loading toast if payment is not completed/cancelled
        toast.dismiss(loadingToastId);
        console.log(`[CASHFREE] Payment verification not completed/cancelled:`, res.message);
      }
    } catch (err: any) {
      // Silently dismiss loading toast on errors to prevent confusing/technical toast alerts
      toast.dismiss(loadingToastId);
      console.error("[CASHFREE] Error verifying payment:", err);
    } finally {
      // Clear query parameters from URL silently in all cases
      if (typeof window !== "undefined") {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
      setIsVerifyingPayment(false);
    }
  };

  // Add mount effect to look for order_id
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const orderId = params.get("order_id");

      if (orderId) {
        verifyPayment(orderId);
      }
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % carouselImages.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Load remembered username on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedUsername = localStorage.getItem("remembered_username");
      const savedChecked = localStorage.getItem("remember_me_checked");
      if (savedUsername) {
        setUsername(savedUsername);
      }
      if (savedChecked === "true") {
        setRememberMe(true);
      }
    }
  }, []);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");
    try {
      const result = await loginServerFn({
        data: { username, password, rememberMe },
      });
      if (result.success) {
        if (rememberMe) {
          localStorage.setItem("remembered_username", username);
          localStorage.setItem("remember_me_checked", "true");
        } else {
          localStorage.removeItem("remembered_username");
          localStorage.removeItem("remember_me_checked");
        }
        setIsLoginSuccess(true);
        setSuccessName(result.user.name);
        setTimeout(() => {
          window.location.href = result.redirectTo || "/dashboard";
        }, 1200);
      }
    } catch (err: any) {
      const msg = err.message || "Failed to sign in. Please verify your credentials.";
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  // Handle Forgot Password OTP entry
  const handleForgotOtpChange = async (value: string, index: number) => {
    if (!/^[0-9]?$/.test(value)) return;
    const newOtp = [...forgotOtpValues];
    newOtp[index] = value;
    setForgotOtpValues(newOtp);

    // Auto focus next box
    if (value && index < 3) {
      const nextInput = document.getElementById(`forgot-otp-${index + 1}`);
      nextInput?.focus();
    }

    // Trigger verification if filled
    if (newOtp.every((v) => v !== "")) {
      setLoading(true);
      try {
        await verifyOtpServerFn({
          data: { email: forgotEmail, code: newOtp.join("") },
        });
        setForgotVerificationSuccess(true);
        toast.success("Code verified successfully!");
        setTimeout(() => {
          setForgotVerificationSuccess(false);
          setForgotOtpValues(["", "", "", ""]);
          setForgotStep(3);
        }, 1800);
      } catch (err: any) {
        setErrorMsg(err.message || "Invalid or expired verification code");
        setForgotOtpValues(["", "", "", ""]);
        document.getElementById("forgot-otp-0")?.focus();
      } finally {
        setLoading(false);
      }
    }
  };

  const handleForgotBackspace = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === "Backspace" && !forgotOtpValues[index] && index > 0) {
      const prevInput = document.getElementById(`forgot-otp-${index - 1}`);
      prevInput?.focus();
    }
  };

  // Handle Send OTP for reset password
  const handleSendForgotOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    if (!forgotEmail || !forgotEmail.includes("@")) {
      setErrorMsg("Please enter a valid email address.");
      return;
    }
    setLoading(true);
    try {
      await sendOtpServerFn({ data: forgotEmail });
      setErrorMsg("");
      setForgotStep(2);
      toast.info("Verification code sent to " + forgotEmail);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to generate verification code");
    } finally {
      setLoading(false);
    }
  };

  // Handle password reset submit
  const handlePasswordResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    if (newPassword !== confirmPassword) {
      setErrorMsg("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await resetPasswordServerFn({
        data: { email: forgotEmail, password: newPassword },
      });
      setForgotResetSuccess(true);
      toast.success("Password reset completed successfully!");

      // Auto close and reset modal
      setTimeout(() => {
        setIsForgotModalOpen(false);
        setForgotResetSuccess(false);
        setForgotStep(1);
        setForgotEmail("");
        setNewPassword("");
        setConfirmPassword("");
        setErrorMsg("");
      }, 1800);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-8 md:px-6">
      {/* Back button/Logo at top left with Home icon */}
      <div className="absolute top-6 left-6">
        <Link to="/" className="group flex items-center gap-1.5 text-zinc-600 hover:text-zinc-950 transition-colors">
          <img src={bmtLogo} alt="Book MyTime Logo" className="h-12 w-auto object-contain" />
          <span className="mx-1.5 text-zinc-300">|</span>
          <Home className="size-3.5 text-zinc-400 group-hover:text-zinc-600 transition-colors" />
          <span className="text-[10px] font-medium">Home</span>
        </Link>
      </div>

      {/* Main card container */}
      <div className="grid w-full max-w-4xl overflow-hidden rounded-[1.75rem] border border-zinc-200/60 bg-white p-4 lg:grid-cols-2 lg:gap-6 min-h-[500px]">
        {/* Left Side: Form */}
        <div className="flex flex-col justify-between py-5 px-3 sm:px-6 lg:px-8">
          <div className="my-auto space-y-5">
            {/* Header */}
            <div className="text-center">
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
                Welcome Back!
              </h1>
              <p className="mt-1 text-xs text-zinc-400">
                Sign in with your Username and Password.
              </p>
            </div>

            {/* Form */}
            <form className="space-y-3.5" onSubmit={handleLoginSubmit}>
              {errorMsg && (
                <div className="rounded-2xl bg-red-50 border border-red-100 p-3.5 text-xs text-red-800 text-left font-medium space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-red-950">
                    <AlertCircle className="size-4 shrink-0 text-red-655" />
                    Access Blocked
                  </div>
                  <p className="text-[11px] leading-relaxed text-red-700">
                    {errorMsg.split("bookmytime1355@gmail.com").map((part, index, arr) => (
                      <span key={index}>
                        {part}
                        {index < arr.length - 1 && (
                          <a href="mailto:bookmytime1355@gmail.com" className="font-bold underline hover:text-red-900 transition-colors">
                            bookmytime1355@gmail.com
                          </a>
                        )}
                      </span>
                    ))}
                  </p>
                  {(errorMsg.toLowerCase().includes("ended") || errorMsg.toLowerCase().includes("expired") || errorMsg.toLowerCase().includes("deactivated")) && (
                    <button
                      type="button"
                      onClick={handleRenewClick}
                      className="mt-2.5 w-full flex items-center justify-center gap-1.5 rounded-full bg-red-600 hover:bg-red-750 text-white font-bold py-2 px-4 text-xs transition-colors shadow-sm cursor-pointer"
                      style={{ background: "linear-gradient(135deg, #DC2626, #EF4444)" }}
                    >
                      Renew Subscription Now
                    </button>
                  )}
                </div>
              )}
              <div>
                <input
                  type="text"
                  placeholder="Username"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setErrorMsg("");
                  }}
                  className="w-full rounded-full border border-zinc-200/80 bg-white px-4 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none transition-all"
                  required
                  disabled={loading}
                />
              </div>
              <div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setErrorMsg("");
                    }}
                    className="w-full rounded-full border border-zinc-200/80 bg-white px-4 py-2 pr-10 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none transition-all"
                    required
                    disabled={loading}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* Remember Me and Forgot Password in same line */}
              <div className="flex items-center justify-between text-[10px]">
                <label className="flex items-center gap-1.5 cursor-pointer select-none font-medium text-zinc-500 hover:text-zinc-800 transition-colors">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    disabled={loading}
                    className="rounded border-zinc-250 text-brand focus:ring-0 focus:ring-offset-0 size-3"
                  />
                  Remember Me
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setIsForgotModalOpen(true);
                    setForgotStep(1);
                  }}
                  disabled={loading}
                  className="font-semibold text-zinc-900 hover:underline cursor-pointer focus:outline-none disabled:no-underline disabled:text-zinc-400"
                >
                  Forget Password?
                </button>
              </div>

              {/* Login Button */}
              <button
                type="submit"
                disabled={loading || isLoginSuccess}
                className={`w-full rounded-full py-2.5 text-xs font-semibold text-white transition-all duration-300 active:scale-[0.99] flex items-center justify-center gap-1.5 cursor-pointer ${
                  isLoginSuccess
                    ? "bg-emerald-600 hover:bg-emerald-650 shadow-md"
                    : "bg-zinc-950 hover:bg-zinc-800 disabled:bg-zinc-100 disabled:text-zinc-400 disabled:cursor-not-allowed"
                }`}
              >
                <AnimatePresence mode="wait">
                  {isLoginSuccess ? (
                    <motion.div
                      key="success"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="flex items-center justify-center gap-1.5"
                    >
                      <Check className="h-3.5 w-3.5 stroke-[3]" />
                      <span>Welcome back, {successName || "User"}!</span>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="normal"
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="flex items-center justify-center gap-1.5"
                    >
                      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      <span>Login</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </button>
            </form>
          </div>

          {/* Footer Toggle */}
          <div className="pt-4 text-center text-xs text-zinc-400">
            Did not have any account?{" "}
            <Link
              to="/signup"
              className="font-semibold text-zinc-850 hover:underline"
            >
              Register Now
            </Link>
          </div>
        </div>

        {/* Right Side: Image Showcase */}
        <div className="relative hidden h-full min-h-[400px] overflow-hidden rounded-[1.5rem] bg-zinc-900 lg:block">
          <AnimatePresence mode="wait">
            <motion.img
              key={currentSlide}
              src={carouselImages[currentSlide].url}
              alt={carouselImages[currentSlide].alt}
              initial={{ opacity: 0, scale: 1.05 }}
              animate={{ opacity: 0.85, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8 }}
              className="absolute inset-0 h-full w-full object-cover"
            />
          </AnimatePresence>

          {/* Overlay gradient */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/20" />

          {/* Carousel dots indicators */}
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 backdrop-blur-md">
            {carouselImages.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentSlide(index)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  index === currentSlide ? "w-5 bg-white" : "w-1.5 bg-white/50"
                }`}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Forgot Password Modal Overlay */}
      <AnimatePresence>
        {isForgotModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-white rounded-[1.5rem] border border-zinc-200/60 p-6 max-w-sm w-full mx-4 shadow-2xl text-center"
            >
              {/* Close Button */}
              <button
                type="button"
                onClick={() => {
                  setIsForgotModalOpen(false);
                  setForgotStep(1);
                  setForgotEmail("");
                  setForgotOtpValues(["", "", "", ""]);
                  setNewPassword("");
                  setConfirmPassword("");
                  setErrorMsg("");
                }}
                className="absolute top-4 right-4 rounded-full p-1 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 transition-all cursor-pointer"
                disabled={loading}
              >
                <X className="h-4 w-4" />
              </button>

              {/* Common inline error displaying inside the modal */}
              {errorMsg && (
                <div className="mb-4 rounded-2xl bg-red-50 border border-red-100 p-3.5 text-center">
                  <p className="text-[10px] text-red-650 font-bold leading-normal text-red-700">{errorMsg}</p>
                </div>
              )}

              {/* Step 1: Email Input */}
              {forgotStep === 1 && (
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-zinc-900">Reset Password</h3>
                  <p className="text-xs text-zinc-400">
                    Enter your email address to receive a verification code.
                  </p>
                  <form onSubmit={handleSendForgotOtp} className="space-y-3">
                    <input
                      type="email"
                      placeholder="Email Address"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      className="w-full rounded-full border border-zinc-200/80 bg-white px-4 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none transition-all"
                      required
                      disabled={loading}
                    />
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full rounded-full bg-zinc-950 py-2 text-xs font-semibold text-white hover:bg-zinc-800 transition-colors cursor-pointer flex items-center justify-center gap-1"
                    >
                      {loading && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                      Send OTP
                    </button>
                  </form>
                </div>
              )}

              {/* Step 2: OTP Entry */}
              {forgotStep === 2 && (
                <div className="space-y-4">
                  {!forgotVerificationSuccess ? (
                    <>
                      <h3 className="text-sm font-bold text-zinc-900">Verify your email</h3>
                      <p className="text-xs text-zinc-400">
                        Enter the 4-digit code sent to <br />
                        <span className="font-semibold text-zinc-700">{forgotEmail}</span>
                      </p>

                      {/* 4 Digit Boxes */}
                      <div className="flex justify-center gap-2.5 my-6">
                        {forgotOtpValues.map((val, idx) => (
                          <input
                            key={idx}
                            id={`forgot-otp-${idx}`}
                            type="text"
                            maxLength={1}
                            value={val}
                            onChange={(e) => handleForgotOtpChange(e.target.value, idx)}
                            onKeyDown={(e) => handleForgotBackspace(e, idx)}
                            disabled={loading}
                            className="w-10 h-10 border border-zinc-200/80 focus:border-brand rounded-lg text-center font-bold text-sm text-zinc-800 focus:outline-none transition-all shadow-sm disabled:bg-zinc-50"
                            autoFocus={idx === 0}
                          />
                        ))}
                      </div>

                      <p className="text-[10px] text-zinc-400">
                        Didn't receive the code?{" "}
                        <button type="button" onClick={handleSendForgotOtp} disabled={loading} className="text-brand font-bold hover:underline cursor-pointer disabled:no-underline">
                          Resend
                        </button>
                      </p>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-4 space-y-3">
                      <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 200, damping: 15 }}
                        className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 border border-emerald-100"
                      >
                        <svg
                          className="h-6 w-6 text-emerald-600"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <motion.path
                            initial={{ pathLength: 0 }}
                            animate={{ pathLength: 1 }}
                            transition={{ duration: 0.5, ease: "easeInOut", delay: 0.15 }}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      </motion.div>
                      <span className="text-xs font-bold text-emerald-600">Email Verified Successfully!</span>
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: Enter New Passwords */}
              {forgotStep === 3 && (
                <div className="space-y-4">
                  {!forgotResetSuccess ? (
                    <>
                      <h3 className="text-sm font-bold text-zinc-900">Set New Password</h3>
                      <p className="text-xs text-zinc-400">
                        Create a new secure password for your workspace.
                      </p>
                      <form onSubmit={handlePasswordResetSubmit} className="space-y-3 text-left">
                        <div>
                          <div className="relative">
                            <input
                              type={showNewPassword ? "text" : "password"}
                              placeholder="New Password"
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              className="w-full rounded-full border border-zinc-200/80 bg-white px-4 py-2 pr-10 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none transition-all"
                              required
                              disabled={loading}
                            />
                            <button
                              type="button"
                              tabIndex={-1}
                              onClick={() => setShowNewPassword((v) => !v)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 transition-colors"
                              aria-label={showNewPassword ? "Hide password" : "Show password"}
                            >
                              {showNewPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </div>
                        <div>
                          <div className="relative">
                            <input
                              type={showConfirmPassword ? "text" : "password"}
                              placeholder="Confirm New Password"
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                              className="w-full rounded-full border border-zinc-200/80 bg-white px-4 py-2 pr-10 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none transition-all"
                              required
                              disabled={loading}
                            />
                            <button
                              type="button"
                              tabIndex={-1}
                              onClick={() => setShowConfirmPassword((v) => !v)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 transition-colors"
                              aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                            >
                              {showConfirmPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={loading}
                          className="w-full rounded-full bg-zinc-950 py-2 text-xs font-semibold text-white hover:bg-zinc-800 transition-colors cursor-pointer mt-2 flex items-center justify-center gap-1"
                        >
                          {loading && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                          Reset Password
                        </button>
                      </form>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-4 space-y-3">
                      <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 200, damping: 15 }}
                        className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 border border-emerald-100"
                      >
                        <svg
                          className="h-6 w-6 text-emerald-600"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <motion.path
                            initial={{ pathLength: 0 }}
                            animate={{ pathLength: 1 }}
                            transition={{ duration: 0.5, ease: "easeInOut", delay: 0.15 }}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      </motion.div>
                      <span className="text-xs font-bold text-emerald-600">Password Reset Successfully!</span>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Cashfree Subscription Renewal Modal */}
      <AnimatePresence>
        {isRenewModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-white rounded-[2rem] border border-zinc-200/60 p-6 sm:p-8 max-w-2xl w-full shadow-2xl flex flex-col my-8"
            >
              {/* Close Button */}
              <button
                type="button"
                onClick={() => {
                  setIsRenewModalOpen(false);
                  setSelectedRenewPlan("Basic");
                }}
                className="absolute top-4 right-4 rounded-full p-1 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 transition-all cursor-pointer"
                disabled={renewLoading}
              >
                <X className="h-4 w-4" />
              </button>

              <div className="text-center mb-6">
                <h3 className="text-xl font-black text-zinc-900">Renew Workspace Subscription</h3>
                <p className="text-xs text-zinc-500 mt-1">
                  Choose a subscription plan to reactivate your BookMyTime account for tenant: <span className="font-bold text-brand">{renewUserPlanDetails?.tenantId}</span>
                </p>
              </div>

              {/* Plans Comparison */}
              <div className="grid sm:grid-cols-2 gap-4 my-2">
                {/* Basic Plan */}
                <div 
                  onClick={() => !renewLoading && setSelectedRenewPlan("Basic")}
                  className={`relative flex flex-col rounded-2xl p-5 border-2 cursor-pointer transition-all ${
                    selectedRenewPlan === "Basic" 
                      ? "border-[#0059C6] bg-[#0059C6]/[0.02] shadow-md animate-pulse-subtle" 
                      : "border-zinc-200 hover:border-zinc-300"
                  }`}
                >
                  {selectedRenewPlan === "Basic" && (
                    <div className="absolute top-3 right-3 bg-[#0059C6] text-white rounded-full p-0.5 z-10">
                      <Check className="h-3 w-3" />
                    </div>
                  )}
                  <h4 className="text-sm font-bold text-zinc-900">Basic Plan</h4>
                  <p className="text-2xl font-black text-zinc-900 mt-2">₹999<span className="text-xs font-normal text-zinc-500">/month</span></p>
                  <p className="text-[10px] text-zinc-500 mt-1">Perfect for solo practitioners and small businesses.</p>
                  <ul className="mt-4 space-y-2 border-t border-zinc-100 pt-4 flex-1">
                    {[
                      "1 Dashboard",
                      "500 Bookings / Month",
                      "Up to 500 Customers",
                      "QR Code Booking",
                      "Standard AI Assistant",
                      "Standard Support"
                    ].map((f) => (
                      <li key={f} className="flex items-center gap-1.5 text-[11px] text-zinc-650">
                        <Check className="h-3 w-3 text-[#0059C6] shrink-0" />
                        <span className="text-zinc-650 font-medium text-left">{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Premium Plan */}
                <div 
                  onClick={() => !renewLoading && setSelectedRenewPlan("Premium")}
                  className={`relative flex flex-col rounded-2xl p-5 border-2 cursor-pointer transition-all ${
                    selectedRenewPlan === "Premium" 
                      ? "border-[#0059C6] bg-[#0059C6]/[0.02] shadow-md" 
                      : "border-zinc-200 hover:border-zinc-300"
                  }`}
                >
                  <div className="absolute top-2 right-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider">
                    Popular
                  </div>
                  {selectedRenewPlan === "Premium" && (
                    <div className="absolute top-3 right-3 bg-[#0059C6] text-white rounded-full p-0.5 z-10 mt-4">
                      <Check className="h-3 w-3" />
                    </div>
                  )}
                  <h4 className="text-sm font-bold text-zinc-900 mt-2 sm:mt-0">Premium Plan</h4>
                  <p className="text-2xl font-black text-zinc-900 mt-2">₹1,499<span className="text-xs font-normal text-zinc-500">/month</span></p>
                  <p className="text-[10px] text-zinc-500 mt-1">For growing multi-professional networks & groups.</p>
                  <ul className="mt-4 space-y-2 border-t border-zinc-100 pt-4 flex-1">
                    {[
                      "1 Dashboard + 1 sub location",
                      "2,000 Bookings / Month",
                      "Up to 5,000 Customers",
                      "WhatsApp alerts included",
                      "Advanced AI Scribe & bot",
                      "Priority Support"
                    ].map((f) => (
                      <li key={f} className="flex items-center gap-1.5 text-[11px] text-zinc-650">
                        <Check className="h-3 w-3 text-[#0059C6] shrink-0" />
                        <span className="text-zinc-650 font-medium text-left">{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Checkout CTA */}
              <div className="mt-6 flex flex-col space-y-2">
                <button
                  type="button"
                  onClick={() => handleInitiatePayment(selectedRenewPlan)}
                  disabled={renewLoading}
                  className="w-full rounded-full py-2.5 text-xs font-bold text-white transition-all cursor-pointer flex items-center justify-center gap-1.5 hover:opacity-95"
                  style={{ background: "linear-gradient(135deg, #0059C6, #0D83FF)" }}
                >
                  {renewLoading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Generating Secure Payment Session...
                    </>
                  ) : (
                    <>
                      Pay & Activate Account (₹{selectedRenewPlan === "Basic" ? "999" : "1,499"})
                    </>
                  )}
                </button>
                <p className="text-[9px] text-zinc-400 text-center">
                  Payments are processed securely via Cashfree Payments. You will be redirected to complete the transaction.
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Payment Verification Processing Overlay */}
      {isVerifyingPayment && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/60 backdrop-blur-md text-white">
          <Loader2 className="h-10 w-10 animate-spin text-[#0D83FF]" />
          <p className="mt-4 text-sm font-bold tracking-wide">Verifying your payment with Cashfree...</p>
          <p className="text-xs text-zinc-450 mt-1">Please do not refresh the page or click back.</p>
        </div>
      )}
    </div>
  );
}
