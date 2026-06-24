import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Lock, Loader2, ArrowLeft, ShieldAlert, Mail, Shield, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { loginSuperAdminServerFn, getAdminConfigServerFn } from "../lib/admin";

export const Route = createFileRoute("/admin/login")({
  head: () => ({
    meta: [
      { title: "SaaS Owner Control Center — BookMyTime" },
      {
        name: "description",
        content: "Administrative login portal for BookMyTime platform owners.",
      },
    ],
  }),
  component: AdminLoginPage,
});

function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [securityKey, setSecurityKey] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showSecurityKey, setShowSecurityKey] = useState(false);
  
  const [config, setConfig] = useState({ adminEmail: "admin@bookmytime.ai", hasSecurityKey: false });
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadConfig() {
      try {
        const res = await getAdminConfigServerFn();
        if (res) {
          setConfig(res);
        }
      } catch (err) {
        console.error("Failed to load admin login config:", err);
      } finally {
        setLoadingConfig(false);
      }
    }
    loadConfig();
  }, []);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await loginSuperAdminServerFn({
        data: { 
          email, 
          password, 
          securityKey: config.hasSecurityKey ? securityKey : undefined 
        },
      });
      if (result.success) {
        toast.success(`Welcome, ${result.admin.name}! Redirecting to control console...`);
        setTimeout(() => {
          window.location.href = "/admin/dashboard";
        }, 1200);
      }
    } catch (err: any) {
      toast.error(err.message || "Invalid administrative credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-12 md:px-6 overflow-hidden select-none font-sans">
      
      {/* Floating Back Button */}
      <div className="absolute top-6 left-6 z-10">
        <Link to="/" className="group flex items-center gap-2 text-zinc-500 hover:text-zinc-900 text-xs font-bold transition-all px-3.5 py-2 rounded-xl bg-white border border-zinc-200/80 shadow-sm active:scale-[0.98]">
          <ArrowLeft className="size-4 group-hover:-translate-x-0.5 transition-transform text-zinc-400" />
          <span>Back to Home</span>
        </Link>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-md z-10"
      >
        <div className="overflow-hidden rounded-[2rem] border border-zinc-200 bg-white p-8 md:p-10 shadow-lg relative">
          
          {/* Header */}
          <div className="flex flex-col items-center text-center space-y-4 mb-8">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-zinc-900 shadow-sm border border-zinc-800 ring-4 ring-zinc-100">
              <Lock className="size-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-zinc-900">
                Administrative Portal
              </h1>
              <p className="mt-1.5 text-xs text-zinc-550">
                Access the BookMyTime SaaS Owner Management Console.
              </p>
            </div>
          </div>

          {/* Form */}
          <form className="space-y-4" onSubmit={handleLoginSubmit}>
            
            {/* Email Field */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-zinc-450 uppercase tracking-widest pl-1">
                Admin Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
                <input
                  type="email"
                  placeholder="admin@bookmytime.ai"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 pl-10 pr-4 py-3 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:outline-none transition-all shadow-inner font-semibold"
                  required
                  disabled={loading}
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-zinc-450 uppercase tracking-widest pl-1">
                Secret Passcode
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 pl-10 pr-10 py-3 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:outline-none transition-all shadow-inner font-semibold"
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 transition-colors"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {/* Security Key Field */}
            {(!loadingConfig && config.hasSecurityKey) && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="space-y-1.5"
              >
                <label className="text-[10px] font-bold text-zinc-450 uppercase tracking-widest pl-1">
                  Console Security Key
                </label>
                <div className="relative">
                  <Shield className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
                  <input
                    type={showSecurityKey ? "text" : "password"}
                    placeholder="Enter security key..."
                    value={securityKey}
                    onChange={(e) => setSecurityKey(e.target.value)}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50 pl-10 pr-10 py-3 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:outline-none transition-all shadow-inner font-semibold"
                    required
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecurityKey(!showSecurityKey)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 transition-colors"
                  >
                    {showSecurityKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </motion.div>
            )}



            {/* Login Action Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-zinc-900 hover:bg-zinc-800 py-3 text-xs font-bold text-white transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer shadow mt-6"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin text-white" />
              ) : (
                <span>Access Dashboard Console</span>
              )}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
