import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { HeartPulse, Home, ChevronDown, Check, X, Loader2, Eye, EyeOff } from "lucide-react";
import { sendOtpServerFn, verifyOtpServerFn, signupServerFn, checkEmailServerFn } from "../lib/auth";
import bmtLogo from "../assets/bmt-logo.png";

export const Route = createFileRoute("/signup")({
  validateSearch: (search: Record<string, unknown>): { plan?: string } => ({
    plan: (search.plan as string) || undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign Up — MediFlow AI" },
      {
        name: "description",
        content: "Create your MediFlow AI clinician or workspace account.",
      },
    ],
  }),
  component: SignupPage,
});

const carouselImages = [
  {
    url: "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&q=80&w=1000",
    alt: "Modern medical professional consulting room",
  },
  {
    url: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&q=80&w=1000",
    alt: "Person practicing yoga for health and wellness",
  },
  {
    url: "https://images.unsplash.com/photo-1498837167922-ddd27525d352?auto=format&fit=crop&q=80&w=1000",
    alt: "Healthy nutritious food plate",
  },
];

function getInitialPlan(param: string | undefined): string {
  if (!param) return "Solo";
  const p = param.toLowerCase().trim();
  if (p.includes("999") || p.includes("solo")) return "Solo";
  if (p.includes("1499") || p.includes("1,499") || p.includes("clinic")) return "Clinic";
  if (p.includes("hospital") || p.includes("custom") || p.includes("enterprise")) return "Hospital";
  return "Solo";
}

function getBusinessNameLabel(profession: string): string {
  switch (profession) {
    case "Beauty and wellness":
      return "Salon / Spa Name";
    case "Fitness Gym etc":
      return "Gym / Fitness Center Name";
    case "Professional services like law, consultant, real estate, CA":
      return "Firm / Office Name";
    case "Education institutions":
      return "Institution / Academy Name";
    default:
      return "Clinic / Hospital Name";
  }
}

function SignupPage() {
  const { plan: urlPlan } = Route.useSearch();
  const initialPlan = getInitialPlan(urlPlan);
  const [selectedPlan, setSelectedPlan] = useState(initialPlan);
  const [currentSlide, setCurrentSlide] = useState(0);
  const navigate = useNavigate();

  // Form states
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [clinicName, setClinicName] = useState("");
  const [practiceSize, setPracticeSize] = useState(
    initialPlan === "Clinic"
      ? "Small Group (2-5 providers)"
      : initialPlan === "Hospital"
        ? "Large Clinic (16-50 providers)"
        : "Solo Practice (1 provider)"
  );
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [profession, setProfession] = useState("Healthcare and medical");
  const [emailError, setEmailError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSignupSuccess, setIsSignupSuccess] = useState(false);

  // OTP Verification states
  const [isOtpModalOpen, setIsOtpModalOpen] = useState(false);
  const [otpValues, setOtpValues] = useState(["", "", "", ""]);
  const [isVerified, setIsVerified] = useState(false);
  const [verificationSuccess, setVerificationSuccess] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  // Inline alert states
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [otpError, setOtpError] = useState("");
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsOnline(navigator.onLine);
      const handleOnline = () => setIsOnline(true);
      const handleOffline = () => setIsOnline(false);
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % carouselImages.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Resend Timer Countdown Effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isOtpModalOpen && resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isOtpModalOpen, resendTimer]);

  // Handle Send OTP
  const handleSendOtp = async () => {
    if (!navigator.onLine) {
      setEmailError("No internet connection detected. Please check your network and try again.");
      return;
    }
    if (!email || !email.includes("@")) {
      setEmailError("Please enter a valid email address first.");
      return;
    }
    setLoading(true);
    setEmailError("");
    setOtpError("");
    try {
      const checkRes = await checkEmailServerFn({ data: email });
      if (checkRes.exists) {
        setEmailError("Email already registered");
        return;
      }

      await sendOtpServerFn({ data: email });
      setIsOtpModalOpen(true);
      setResendTimer(60);
    } catch (err: any) {
      if (err.message?.includes("already registered")) {
        setEmailError("Email already registered");
      } else {
        setEmailError(err.message || "Failed to send verification code");
      }
    } finally {
      setLoading(false);
    }
  };

  // Handle OTP inputs and automatic progression
  const handleOtpChange = async (value: string, index: number) => {
    if (!/^[0-9]?$/.test(value)) return;
    const newOtp = [...otpValues];
    newOtp[index] = value;
    setOtpValues(newOtp);
    if (otpError) setOtpError("");

    // Auto-focus next box
    if (value && index < 3) {
      const nextInput = document.getElementById(`otp-${index + 1}`);
      nextInput?.focus();
    }

    // Trigger verification if complete
    if (newOtp.every((v) => v !== "")) {
      setLoading(true);
      setOtpError("");
      try {
        await verifyOtpServerFn({ data: { email, code: newOtp.join("") } });
        setVerificationSuccess(true);
        setTimeout(() => {
          setIsVerified(true);
          setIsOtpModalOpen(false);
          setVerificationSuccess(false);
          setOtpValues(["", "", "", ""]);
        }, 1800);
      } catch (err: any) {
        setOtpError(err.message || "Invalid or expired verification code");
        setOtpValues(["", "", "", ""]);
        document.getElementById("otp-0")?.focus();
      } finally {
        setLoading(false);
      }
    }
  };

  const handleBackspace = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === "Backspace" && !otpValues[index] && index > 0) {
      const prevInput = document.getElementById(`otp-${index - 1}`);
      prevInput?.focus();
    }
  };

  // Handle Form Registration Submission
  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!navigator.onLine) {
      setFormError("No internet connection detected. Please check your network and try again.");
      return;
    }
    setEmailError("");
    setPhoneError("");
    setFormError("");
    setFormSuccess("");

    setLoading(true);
    try {
      // Check if email already registered
      const checkRes = await checkEmailServerFn({ data: email });
      if (checkRes.exists) {
        setEmailError("Email already registered");
        setLoading(false);
        return;
      }

      // If not verified, trigger OTP and open modal
      if (!isVerified) {
        await sendOtpServerFn({ data: email });
        setIsOtpModalOpen(true);
        setResendTimer(60);
        setLoading(false);
        return;
      }

      await signupServerFn({
        data: {
          name,
          phone,
          email,
          clinicName,
          practiceSize,
          password,
          plan: selectedPlan,
          profession,
        },
      });
      setIsSignupSuccess(true);
      setTimeout(() => {
        navigate({ to: "/login" });
      }, 1500);
    } catch (err: any) {
      if (err.message === "Email already registered") {
        setEmailError("Email already registered");
      } else if (err.message === "Phone number already registered") {
        setPhoneError("Phone number already registered");
      } else if (err.message?.includes("already registered") || err.message?.includes("already exists")) {
        setEmailError("Email or phone number already registered");
      } else {
        setFormError(err.message || "Registration failed");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-8 md:px-6">
      {/* Back button/Logo at top left with Home icon */}
      <div className="absolute top-6 left-6">
        <Link to="/" className="group flex items-center gap-1.5 text-zinc-600 hover:text-zinc-950 transition-colors">
          <img src={bmtLogo} alt="Book MyTime Logo" className="h-8 w-auto object-contain" />
          <span className="mx-1.5 text-zinc-300">|</span>
          <Home className="size-3.5 text-zinc-400 group-hover:text-zinc-600 transition-colors" />
          <span className="text-[10px] font-medium">Home</span>
        </Link>
      </div>

      {/* Main card container */}
      <div className="grid w-full max-w-4xl overflow-hidden rounded-[1.75rem] border border-zinc-200/60 bg-white p-4 lg:grid-cols-2 lg:gap-6 min-h-[500px]">
        {/* Left Side: Form */}
        <div className="flex flex-col justify-between py-4 px-3 sm:px-6 lg:px-8">
          <div className="my-auto space-y-4">
            {/* Header */}
            <div className="text-center">
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
                Create Account
              </h1>
              <p className="mt-1 text-xs text-zinc-400">
                Sign up to start sync'ing your healthcare workspace.
              </p>
            </div>

            {/* Form */}
            <form className="space-y-3" onSubmit={handleSignupSubmit}>
              {/* 1. Name */}
              <div>
                <input
                  type="text"
                  placeholder="Name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (formError) setFormError("");
                  }}
                  className="w-full rounded-full border border-zinc-200/80 bg-white px-4 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none transition-all"
                  required
                  disabled={loading}
                />
              </div>

              {/* 2. Phone */}
              <div>
                <input
                  type="tel"
                  placeholder="Phone"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    if (phoneError) setPhoneError("");
                    if (formError) setFormError("");
                  }}
                  className={`w-full rounded-full border bg-white px-4 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none transition-all ${
                    phoneError
                      ? "border-red-500 focus:border-red-500"
                      : "border-zinc-200/80 focus:border-brand"
                  }`}
                  required
                  disabled={loading}
                />
                {phoneError && (
                  <p className="mt-1 text-[10px] text-red-500 pl-4">{phoneError}</p>
                )}
              </div>

              {/* 3. Email (with OTP verification logic) */}
              <div>
                <div className="relative flex items-center">
                  <input
                    type="email"
                    placeholder="Email Address"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (emailError) setEmailError("");
                    }}
                    disabled={isVerified || loading}
                    className={`w-full rounded-full border bg-white pl-4 pr-24 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none transition-all ${
                      emailError
                        ? "border-red-500 focus:border-red-500"
                        : isVerified
                          ? "border-emerald-200 bg-emerald-50/20 text-emerald-800"
                          : "border-zinc-200/80 focus:border-brand"
                    }`}
                    required
                  />
                  <div className="absolute right-1">
                    {isVerified ? (
                      <span className="flex items-center gap-0.5 text-[9px] font-bold text-emerald-600 px-2.5 py-0.5 bg-emerald-50 rounded-full border border-emerald-100">
                        <Check className="h-2.5 w-2.5" /> Verified
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleSendOtp}
                        disabled={!email || loading}
                        className="rounded-full bg-brand/10 hover:bg-brand/20 disabled:bg-zinc-50 disabled:text-zinc-400 text-brand text-[10px] font-bold px-3 py-1 transition-all cursor-pointer flex items-center gap-1"
                      >
                        {loading && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                        Send OTP
                      </button>
                    )}
                  </div>
                </div>
                {emailError && (
                  <p className="mt-1 text-[10px] text-red-500 pl-4">{emailError}</p>
                )}
              </div>

              {/* 4. Password */}
              <div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Create Password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (formError) setFormError("");
                    }}
                    className="w-full rounded-full border border-zinc-200/80 bg-white px-4 py-2 pr-10 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none transition-all"
                    required
                    disabled={loading}
                    minLength={6}
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

              {/* Profession Selection */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider pl-1">Business Profession / Industry</label>
                <select
                  value={profession}
                  onChange={(e) => setProfession(e.target.value)}
                  disabled={loading}
                  className="w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-800 font-semibold focus:border-brand focus:outline-none transition-all cursor-pointer"
                >
                  <option value="Healthcare and medical">Healthcare & Medical</option>
                  <option value="Beauty and wellness">Beauty & Wellness</option>
                  <option value="Fitness Gym etc">Fitness & Gym</option>
                  <option value="Professional services like law, consultant, real estate, CA">Professional Services (Law, Consultant, Real Estate, CA)</option>
                  <option value="Education institutions">Education Institutions</option>
                </select>
              </div>

              {/* 5. Business Name (Clinic / Hospital / Salon, etc. depending on Business Profession) */}
              <div className="space-y-1 animate-fade-in">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider pl-1">
                  {getBusinessNameLabel(profession)}
                </label>
                <input
                  type="text"
                  placeholder={getBusinessNameLabel(profession)}
                  value={clinicName}
                  onChange={(e) => {
                    setClinicName(e.target.value);
                    if (formError) setFormError("");
                  }}
                  className="w-full rounded-full border border-zinc-200/80 bg-white px-4 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none transition-all"
                  required
                  disabled={loading}
                />
              </div>

              {/* Plan Selection Button Group */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider pl-1">Selected Plan</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "Solo", label: "Solo (₹999)" },
                    { id: "Clinic", label: "Clinic (₹1,499)" },
                    { id: "Hospital", label: "Hospital (Custom)" },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setSelectedPlan(p.id);
                        if (p.id === "Solo") setPracticeSize("Solo Practice (1 provider)");
                        else if (p.id === "Clinic") setPracticeSize("Small Group (2-5 providers)");
                        else if (p.id === "Hospital") setPracticeSize("Large Clinic (16-50 providers)");
                      }}
                      className={`rounded-full py-2 text-[10px] sm:text-xs font-semibold border transition-all cursor-pointer ${
                        selectedPlan === p.id
                          ? "bg-zinc-950 text-white border-zinc-950 shadow-sm"
                          : "bg-white text-zinc-500 border-zinc-200 hover:bg-zinc-50"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Note: Practice size is auto-assigned based on your selected plan */}

              {/* Offline network alert */}
              {!isOnline && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-2.5 text-center mt-2">
                  <p className="text-[10px] text-red-650 font-extrabold text-red-600">
                    No internet connection detected. Please check your network and try again.
                  </p>
                </div>
              )}

              {/* Form alerts */}
              {formError && (
                <div className="rounded-xl bg-red-50 border border-red-100 p-2.5 text-center mt-2">
                  <p className="text-[10px] text-red-650 font-medium text-red-600">{formError}</p>
                </div>
              )}

              {/* 6. Sign Up Button */}
              <button
                type="submit"
                disabled={loading || isSignupSuccess}
                className={`w-full rounded-full py-2.5 text-xs font-semibold text-white transition-all duration-300 active:scale-[0.99] mt-2 flex items-center justify-center gap-1.5 cursor-pointer ${
                  isSignupSuccess
                    ? "bg-emerald-600 hover:bg-emerald-650 shadow-md"
                    : "bg-zinc-950 hover:bg-zinc-800 disabled:bg-zinc-100 disabled:text-zinc-400 disabled:cursor-not-allowed"
                }`}
              >
                <AnimatePresence mode="wait">
                  {isSignupSuccess ? (
                    <motion.div
                      key="success"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="flex items-center justify-center gap-1.5"
                    >
                      <Check className="h-3.5 w-3.5 stroke-[3]" />
                      <span>Account Created Successfully!</span>
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
                      <span>Sign Up</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </button>
            </form>
          </div>

          {/* Footer Toggle */}
          <div className="pt-4 text-center text-xs text-zinc-400">
            Already registered?{" "}
            <Link
              to="/login"
              className="font-semibold text-zinc-850 hover:underline"
            >
              Log in
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

      {/* OTP Verification Modal Overlay */}
      <AnimatePresence>
        {isOtpModalOpen && (
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
                  setIsOtpModalOpen(false);
                  setVerificationSuccess(false);
                  setOtpValues(["", "", "", ""]);
                  setOtpError("");
                }}
                className="absolute top-4 right-4 rounded-full p-1 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 transition-all cursor-pointer"
                disabled={loading}
              >
                <X className="h-4 w-4" />
              </button>

              {!verificationSuccess ? (
                <>
                  <h3 className="text-sm font-bold text-zinc-900">Verify your email</h3>
                  <p className="mt-1 text-xs text-zinc-400 px-4">
                    Enter the 4-digit code sent to <br />
                    <span className="font-semibold text-zinc-700">{email}</span>
                  </p>

                  {/* 4 Digit Boxes */}
                  <div className="flex justify-center gap-2.5 my-6">
                    {otpValues.map((val, idx) => (
                      <input
                        key={idx}
                        id={`otp-${idx}`}
                        type="text"
                        maxLength={1}
                        value={val}
                        onChange={(e) => handleOtpChange(e.target.value, idx)}
                        onKeyDown={(e) => handleBackspace(e, idx)}
                        disabled={loading}
                        className="w-10 h-10 border border-zinc-200/80 focus:border-brand rounded-lg text-center font-bold text-sm text-zinc-800 focus:outline-none transition-all shadow-sm disabled:bg-zinc-50 disabled:text-zinc-400"
                        autoFocus={idx === 0}
                      />
                    ))}
                  </div>

                  {otpError && (
                    <p className="mt-1 mb-4 text-[10px] text-red-500 font-semibold px-4">{otpError}</p>
                  )}

                  <p className="text-[10px] text-zinc-400">
                    Didn't receive the code?{" "}
                    {resendTimer > 0 ? (
                      <span className="text-brand font-bold">Resend in {resendTimer}s</span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleSendOtp}
                        disabled={loading}
                        className="text-brand font-bold hover:underline cursor-pointer disabled:no-underline"
                      >
                        Resend
                      </button>
                    )}
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
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
