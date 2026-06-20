import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import * as XLSX from "xlsx";
import {
  MessageCircle,
  LayoutDashboard,
  Send,
  FileText,
  RotateCcw,
  Wifi,
  WifiOff,
  Plus,
  Trash2,
  Edit3,
  Check,
  AlertCircle,
  Loader2,
  Copy,
  ExternalLink,
  ChevronRight,
  Eye,
  FileSpreadsheet,
  Settings,
  HelpCircle,
  Smartphone,
  Play,
  Pause,
  RefreshCw,
  PlusCircle,
  PhoneCall,
  UserCheck,
  ListFilter
} from "lucide-react";
import {
  getWATemplatesServerFn,
  saveWATemplateServerFn,
  deleteWATemplateServerFn,
  getWACampaignsServerFn,
  createWACampaignServerFn,
  startWACampaignServerFn,
  pauseWACampaignServerFn,
  deleteWACampaignServerFn,
  getCampaignRecipientsServerFn,
  getWAAutoRepliesServerFn,
  saveWAAutoReplyServerFn,
  deleteWAAutoReplyServerFn,
  sendBulkWAServerFn,
  getWACampaignStatsServerFn,
  uploadWATemplateHeaderImageServerFn,
  getWhatsAppStatusServerFn,
  disconnectWhatsAppServerFn,
  sendTestWaServerFn
} from "../lib/auth";

interface WhatsAppHubProps {
  user: any;
  showToast: (type: "success" | "error" | "info", message: string) => void;
  setConfirmDialog: (dialog: { open: boolean; title: string; message: string; onConfirm: () => void } | null) => void;
}

export default function WhatsAppHub({ user, showToast, setConfirmDialog }: WhatsAppHubProps) {
  const [activeSubTab, setActiveSubTab] = useState<"dashboard" | "templates" | "campaigns" | "auto-reply" | "connection">("dashboard");

  // Connection & polling states
  const [waStatus, setWaStatus] = useState<string>("DISCONNECTED");
  const [waQrDataUrl, setWaQrDataUrl] = useState<string>("");
  const [waConnectedNumber, setWaConnectedNumber] = useState<string>("");
  const [waQueueCount, setWaQueueCount] = useState<number>(0);
  const [waSentLogs, setWaSentLogs] = useState<any[]>([]);
  const [polling, setPolling] = useState(false);

  // Template states
  const [templates, setTemplates] = useState<any[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any | null>(null); // null means template list, object (with or without ID) means edit/create form
  const [uploadingHeaderImage, setUploadingHeaderImage] = useState(false);

  // Campaign states
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<any | null>(null);
  const [campaignRecipients, setCampaignRecipients] = useState<any[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);

  // Auto-Reply states
  const [autoReplies, setAutoReplies] = useState<any[]>([]);
  const [loadingAutoReplies, setLoadingAutoReplies] = useState(false);
  const [editingAutoReply, setEditingAutoReply] = useState<any | null>(null);

  // General Hub stats
  const [stats, setStats] = useState({ totalCampaigns: 0, totalSent: 0, totalFailed: 0, activeAutoReplies: 0 });
  const [loadingStats, setLoadingStats] = useState(false);

  // Single Quick-Send state
  const [quickPhone, setQuickPhone] = useState("");
  const [quickMsg, setQuickMsg] = useState("");
  const [sendingQuick, setSendingQuick] = useState(false);

  // Fetch status
  const fetchStatus = async () => {
    try {
      const status = await getWhatsAppStatusServerFn();
      setWaStatus(status.state);
      setWaQrDataUrl(status.qrDataUrl);
      setWaConnectedNumber(status.connectedNumber);
      setWaQueueCount(status.queueCount);
      setWaSentLogs(status.sentLog || []);
    } catch (e: any) {
      console.error("[WhatsApp Hub] Error fetching status:", e.message);
    }
  };

  // Poll status depending on active state
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => {
      fetchStatus();
    }, (waStatus === "CONNECTING" || waStatus === "QR_READY") ? 3000 : 10000);
    return () => clearInterval(interval);
  }, [waStatus]);

  // Load basic components data on tab changes
  useEffect(() => {
    loadStats();
    if (activeSubTab === "templates") loadTemplates();
    if (activeSubTab === "campaigns") loadCampaigns();
    if (activeSubTab === "auto-reply") loadAutoReplies();
  }, [activeSubTab]);

  const loadStats = async () => {
    setLoadingStats(true);
    try {
      const res = await getWACampaignStatsServerFn();
      setStats(res);
    } catch (e: any) {
      showToast("error", "Failed to load stats: " + e.message);
    } finally {
      setLoadingStats(false);
    }
  };

  const loadTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const res = await getWATemplatesServerFn();
      setTemplates(res);
    } catch (e: any) {
      showToast("error", "Failed to load templates: " + e.message);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const loadCampaigns = async () => {
    setLoadingCampaigns(true);
    try {
      const res = await getWACampaignsServerFn();
      setCampaigns(res);
    } catch (e: any) {
      showToast("error", "Failed to load campaigns: " + e.message);
    } finally {
      setLoadingCampaigns(false);
    }
  };

  const loadAutoReplies = async () => {
    setLoadingAutoReplies(true);
    try {
      const res = await getWAAutoRepliesServerFn();
      setAutoReplies(res);
    } catch (e: any) {
      showToast("error", "Failed to load auto replies: " + e.message);
    } finally {
      setLoadingAutoReplies(false);
    }
  };

  // ──────────────────────────────────────────────
  // QUICK SEND HANDLER
  // ──────────────────────────────────────────────
  const handleQuickSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickPhone.trim() || !quickMsg.trim()) {
      showToast("error", "Please enter both phone and message");
      return;
    }
    setSendingQuick(true);
    try {
      await sendTestWaServerFn({ data: { phone: quickPhone.trim(), message: quickMsg.trim() } });
      showToast("success", "Message enqueued successfully!");
      setQuickPhone("");
      setQuickMsg("");
      fetchStatus();
    } catch (err: any) {
      showToast("error", err.message || "Failed to send message");
    } finally {
      setSendingQuick(false);
    }
  };

  // ──────────────────────────────────────────────
  // TEMPLATE BUILDER SUBCOMPONENT
  // ──────────────────────────────────────────────
  const TemplateBuilder = ({ template }: { template: any }) => {
    const [name, setName] = useState(template.name || "");
    const [category, setCategory] = useState(template.category || "marketing");
    const [headerType, setHeaderType] = useState(template.headerType || "none");
    const [headerText, setHeaderText] = useState(template.headerText || "");
    const [headerImageUrl, setHeaderImageUrl] = useState(template.headerImageUrl || "");
    const [bodyText, setBodyText] = useState(template.bodyText || "");
    const [footerText, setFooterText] = useState(template.footerText || "");
    
    // Parse JSON safely
    const parseJsonSafely = (str: any, fallback: any) => {
      if (!str) return fallback;
      if (typeof str === "object") return str;
      try { return JSON.parse(str); } catch { return fallback; }
    };

    const [ctaButtons, setCtaButtons] = useState<any[]>(parseJsonSafely(template.ctaButtons, []));
    const [quickReplyButtons, setQuickReplyButtons] = useState<string[]>(parseJsonSafely(template.quickReplyButtons, []));
    
    const [saving, setSaving] = useState(false);

    // Parse variables from body text (e.g. {{1}}, {{2}})
    const variables = Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g)).map(match => `{{${match[1]}}}`);
    const uniqueVariables = Array.from(new Set(variables));

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploadingHeaderImage(true);
      try {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onloadend = async () => {
          const base64 = reader.result as string;
          const res = await uploadWATemplateHeaderImageServerFn({ data: { base64 } });
          setHeaderImageUrl(res.url);
          showToast("success", "Template image uploaded!");
        };
      } catch (err: any) {
        showToast("error", "Image upload failed: " + err.message);
      } finally {
        setUploadingHeaderImage(false);
      }
    };

    const handleSave = async () => {
      if (!name.trim()) return showToast("error", "Template name required");
      if (!bodyText.trim()) return showToast("error", "Template body message required");

      setSaving(true);
      try {
        await saveWATemplateServerFn({
          data: {
            id: template.id,
            name: name.trim(),
            category,
            headerType,
            headerText: headerType === "text" ? headerText : null,
            headerImageUrl: headerType === "image" ? headerImageUrl : null,
            bodyText,
            footerText: footerText.trim() || null,
            ctaButtons: ctaButtons.length > 0 ? ctaButtons : null,
            quickReplyButtons: quickReplyButtons.length > 0 ? quickReplyButtons : null,
            variables: uniqueVariables.length > 0 ? uniqueVariables : null,
          }
        });
        showToast("success", `Template saved!`);
        setEditingTemplate(null);
        loadTemplates();
      } catch (err: any) {
        showToast("error", "Save failed: " + err.message);
      } finally {
        setSaving(false);
      }
    };

    return (
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Pane: Builder Form */}
        <div className="rounded-3xl border border-zinc-200 bg-white p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-zinc-150 pb-4">
            <h3 className="text-base font-bold text-zinc-900">{template.id ? "Edit Template" : "New Message Template"}</h3>
            <button
              onClick={() => setEditingTemplate(null)}
              className="text-xs text-zinc-400 hover:text-zinc-650 font-bold bg-zinc-100 px-3 py-1.5 rounded-full cursor-pointer"
            >
              Back to List
            </button>
          </div>

          <div className="space-y-4">
            {/* Name & Category */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Template Name</label>
                <input
                  type="text"
                  placeholder="e.g. appointment_reminder"
                  value={name}
                  onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold focus:outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold focus:outline-none focus:border-brand"
                >
                  <option value="marketing">Marketing (Broadcasts, Offers)</option>
                  <option value="utility">Utility (Reminders, Receipts)</option>
                  <option value="greeting">Greeting (Welcome, Festive)</option>
                  <option value="followup">Follow-up (Feedback, Check-ins)</option>
                </select>
              </div>
            </div>

            {/* Header Type */}
            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Header (Optional)</label>
              <div className="flex gap-2 mb-2">
                {["none", "text", "image"].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setHeaderType(t)}
                    className={`flex-1 rounded-full py-1.5 text-xs font-bold border transition-all cursor-pointer ${
                      headerType === t ? "bg-zinc-950 text-white border-zinc-950" : "bg-zinc-50 border-zinc-200 text-zinc-650 hover:bg-zinc-100"
                    }`}
                  >
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>
              {headerType === "text" && (
                <input
                  type="text"
                  placeholder="Header text, e.g. Monthly Medical Checkup"
                  value={headerText}
                  onChange={(e) => setHeaderText(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold focus:outline-none focus:border-brand"
                />
              )}
              {headerType === "image" && (
                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    id="template-header-file"
                    className="hidden"
                  />
                  <label
                    htmlFor="template-header-file"
                    className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 px-4 py-2 text-xs font-bold text-zinc-650 cursor-pointer transition-colors"
                  >
                    {uploadingHeaderImage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Smartphone className="h-3.5 w-3.5" />}
                    Upload Header Image
                  </label>
                  {headerImageUrl && (
                    <span className="text-[10px] font-semibold text-zinc-400 truncate max-w-[200px]">Uploaded ✓</span>
                  )}
                </div>
              )}
            </div>

            {/* Body */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Message Body</label>
                <button
                  type="button"
                  onClick={() => setBodyText(prev => prev + ` {{${uniqueVariables.length + 1}}}`)}
                  className="text-[9px] font-bold text-brand hover:underline flex items-center gap-0.5"
                >
                  <PlusCircle className="h-2.5 w-2.5" /> Add Variable
                </button>
              </div>
              <textarea
                rows={5}
                placeholder="Hello {{1}}, this is a reminder for your medical checkup scheduled at {{2}}."
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold focus:outline-none focus:border-brand font-mono"
              />
              <span className="text-[9px] text-zinc-400 font-semibold block mt-1">
                Variables parsed: {uniqueVariables.join(", ") || "None"}
              </span>
            </div>

            {/* Footer */}
            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Footer Text (Optional)</label>
              <input
                type="text"
                placeholder="e.g. Reply STOP to opt out"
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold focus:outline-none focus:border-brand"
              />
            </div>

            {/* Interactive Call to Action buttons */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">CTA Buttons (Max 2)</label>
                {ctaButtons.length < 2 && (
                  <button
                    type="button"
                    onClick={() => setCtaButtons(prev => [...prev, { type: "url", label: "Visit Website", value: "https://" }])}
                    className="text-[9px] font-bold text-brand hover:underline"
                  >
                    + Add Button
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {ctaButtons.map((btn, bIdx) => (
                  <div key={bIdx} className="flex gap-2 items-center bg-zinc-50 p-2.5 rounded-xl border border-zinc-200">
                    <select
                      value={btn.type}
                      onChange={(e) => {
                        const newBtn = { ...btn, type: e.target.value, value: e.target.value === "phone" ? "" : "https://" };
                        setCtaButtons(prev => prev.map((b, i) => i === bIdx ? newBtn : b));
                      }}
                      className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold focus:outline-none"
                    >
                      <option value="url">URL Link</option>
                      <option value="phone">Phone Call</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Button Label"
                      value={btn.label}
                      onChange={(e) => setCtaButtons(prev => prev.map((b, i) => i === bIdx ? { ...b, label: e.target.value } : b))}
                      className="flex-1 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold focus:outline-none"
                    />
                    <input
                      type="text"
                      placeholder={btn.type === "phone" ? "+91..." : "https://..."}
                      value={btn.value}
                      onChange={(e) => setCtaButtons(prev => prev.map((b, i) => i === bIdx ? { ...b, value: e.target.value } : b))}
                      className="flex-1 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setCtaButtons(prev => prev.filter((_, i) => i !== bIdx))}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Reply buttons */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Quick Replies (Max 3)</label>
                {quickReplyButtons.length < 3 && (
                  <button
                    type="button"
                    onClick={() => setQuickReplyButtons(prev => [...prev, "Confirm Clinic Slot"])}
                    className="text-[9px] font-bold text-brand hover:underline"
                  >
                    + Add Reply
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {quickReplyButtons.map((btn, bIdx) => (
                  <div key={bIdx} className="flex gap-2 items-center bg-zinc-50 p-2 rounded-xl border border-zinc-200">
                    <input
                      type="text"
                      placeholder="Quick Reply Text"
                      value={btn}
                      onChange={(e) => setQuickReplyButtons(prev => prev.map((b, i) => i === bIdx ? e.target.value : b))}
                      className="flex-1 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setQuickReplyButtons(prev => prev.filter((_, i) => i !== bIdx))}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="border-t border-zinc-150 pt-4 flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 rounded-full bg-zinc-950 text-white font-bold text-xs py-2.5 hover:bg-zinc-800 transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save Template
            </button>
          </div>
        </div>

        {/* Right Pane: Premium WhatsApp Device Mockup Previews */}
        <div className="flex flex-col items-center justify-center p-6 bg-zinc-50 border border-zinc-200 rounded-3xl relative">
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest absolute top-4">Interactive Device Mockup</span>
          <div className="w-[300px] aspect-[9/18] border-[10px] border-zinc-850 bg-[#e5ddd5] rounded-[36px] shadow-2xl relative overflow-hidden flex flex-col pt-6 px-3">
            {/* Speaker & notch */}
            <div className="w-24 h-4 bg-zinc-850 rounded-full absolute top-1 left-1/2 -translate-x-1/2 z-20" />

            {/* Conversation Header */}
            <div className="bg-[#075e54] text-white p-2 rounded-t-lg -mx-3 flex items-center gap-2 shrink-0">
              <div className="h-6 w-6 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-bold font-mono">MD</div>
              <div>
                <p className="text-[9px] font-bold leading-none">MediFlow Automated Alerts</p>
                <p className="text-[7px] text-zinc-250 leading-none mt-0.5">Online</p>
              </div>
            </div>

            {/* Scrollable Message Box */}
            <div className="flex-1 overflow-y-auto py-3 space-y-2">
              <div className="bg-white rounded-xl p-2.5 text-[10px] text-zinc-800 shadow-sm border border-zinc-200 max-w-[240px] ml-1.5 space-y-1.5 relative leading-relaxed">
                {headerType === "text" && headerText && (
                  <p className="font-bold text-[10px] text-zinc-900 border-b border-zinc-100 pb-1">{headerText}</p>
                )}
                {headerType === "image" && headerImageUrl && (
                  <img src={headerImageUrl} alt="Header Preview" className="w-full h-24 object-cover rounded-lg" />
                )}
                
                {/* Replace placeholders with generic val for mockup */}
                <p className="whitespace-pre-line font-medium text-[9px]">{bodyText || "Your template message will appear here..."}</p>

                {footerText && (
                  <p className="text-[7.5px] text-zinc-400 font-bold">{footerText}</p>
                )}
              </div>

              {/* Action Buttons Mockups */}
              {ctaButtons.map((btn, bIdx) => (
                <div key={bIdx} className="bg-white hover:bg-zinc-50 rounded-xl py-2 px-3 text-[9px] font-bold text-[#0080ff] border border-zinc-200 max-w-[240px] ml-1.5 flex items-center justify-center gap-1.5 shadow-sm">
                  {btn.type === "phone" ? <PhoneCall className="h-3 w-3" /> : <ExternalLink className="h-3 w-3" />}
                  {btn.label || (btn.type === "phone" ? "Call Clinic" : "Learn More")}
                </div>
              ))}

              {quickReplyButtons.map((btn, bIdx) => (
                <div key={bIdx} className="bg-[#dfebf5] hover:bg-[#d0e0ed] rounded-xl py-2 px-3 text-[9px] font-bold text-[#075e54] border border-[#bcd2e3] max-w-[240px] ml-1.5 flex items-center justify-center gap-1 shadow-sm">
                  <UserCheck className="h-3 w-3" />
                  {btn || "Quick Reply"}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ──────────────────────────────────────────────
  // CAMPAIGN BUILDER & BROADCASTS
  // ──────────────────────────────────────────────
  const CampaignWizard = () => {
    const [wizardStep, setWizardStep] = useState(1);
    const [campaignName, setCampaignName] = useState("");
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
    
    // Safety
    const [minDelay, setMinDelay] = useState(10);
    const [maxDelay, setMaxDelay] = useState(25);
    const [dailyLimit, setDailyLimit] = useState(200);

    // Recipients
    const [parsedRecipients, setParsedRecipients] = useState<any[]>([]);
    const [manualNumbers, setManualNumbers] = useState("");
    const [contactMethod, setContactMethod] = useState<"file" | "manual">("file");

    const templateSelected = templates.find(t => t.id === selectedTemplateId);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const bstr = evt.target?.result;
          const workbook = XLSX.read(bstr, { type: "binary" });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const data: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

          if (data.length <= 1) {
            showToast("error", "The uploaded file appears to be empty or has no header row.");
            return;
          }

          const headers = data[0].map((h: any) => String(h).trim().toLowerCase());
          
          // Locate phone column
          const phoneIndex = headers.findIndex((h: string) => h.includes("phone") || h.includes("number") || h.includes("mobile") || h.includes("contact"));
          const nameIndex = headers.findIndex((h: string) => h.includes("name") || h.includes("patient") || h.includes("customer"));

          if (phoneIndex === -1) {
            showToast("error", "Could not find phone number column. Make sure the first row contains 'phone', 'number', 'mobile', or 'contact'.");
            return;
          }

          const recipientsList: any[] = [];
          for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const rawPhone = String(row[phoneIndex] || "").trim();
            if (!rawPhone) continue;

            const name = nameIndex !== -1 ? String(row[nameIndex] || "").trim() : "Recipient " + i;
            
            // Map row fields into a template variables dictionary
            const variablesObj: any = {};
            // If the template needs variables like {{1}}, {{2}}...
            // map subsequent columns as {{1}} = column 2, {{2}} = column 3, etc.
            let varCounter = 1;
            headers.forEach((h: string, idx: number) => {
              if (idx !== phoneIndex && idx !== nameIndex) {
                variablesObj[String(varCounter++)] = row[idx] || "";
              }
            });

            recipientsList.push({
              phone: rawPhone,
              name,
              variables: variablesObj
            });
          }

          setParsedRecipients(recipientsList);
          showToast("success", `Parsed ${recipientsList.length} contacts from sheet!`);
        } catch (error: any) {
          showToast("error", "Error parsing file: " + error.message);
        }
      };
      reader.readAsBinaryString(file);
    };

    const handleCreateCampaign = async () => {
      let finalRecipients: any[] = [];

      if (contactMethod === "manual") {
        const lines = manualNumbers.split("\n").map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) {
          showToast("error", "Please write or paste at least one phone number");
          return;
        }
        finalRecipients = lines.map((line, idx) => {
          // Line can be "Phone, Name" or just "Phone"
          const parts = line.split(",");
          const phone = parts[0].trim();
          const name = parts[1] ? parts[1].trim() : "Recipient " + (idx + 1);
          return { phone, name };
        });
      } else {
        if (parsedRecipients.length === 0) {
          showToast("error", "Please upload a valid Excel/CSV contact list file first");
          return;
        }
        finalRecipients = parsedRecipients;
      }

      if (!campaignName.trim()) return showToast("error", "Campaign name is required");

      try {
        const res = await createWACampaignServerFn({
          data: {
            name: campaignName.trim(),
            templateId: selectedTemplateId || null,
            minDelaySec: minDelay,
            maxDelaySec: maxDelay,
            dailyLimit,
            recipients: finalRecipients
          }
        });
        showToast("success", "Campaign created successfully as Draft!");
        setCreatingCampaign(false);
        loadCampaigns();
      } catch (err: any) {
        showToast("error", "Failed to create campaign: " + err.message);
      }
    };

    return (
      <div className="rounded-3xl border border-zinc-200 bg-white p-6 space-y-6">
        <div className="flex items-center justify-between border-b border-zinc-150 pb-4">
          <h3 className="text-base font-bold text-zinc-900">Create Broadcast Campaign (Step {wizardStep}/3)</h3>
          <button
            onClick={() => setCreatingCampaign(false)}
            className="text-xs text-zinc-400 hover:text-zinc-650 font-bold bg-zinc-100 px-3 py-1.5 rounded-full cursor-pointer"
          >
            Cancel
          </button>
        </div>

        {wizardStep === 1 && (
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Campaign Name</label>
              <input
                type="text"
                placeholder="e.g. June Diabetic Recall Campaign"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold focus:outline-none focus:border-brand"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Select Message Template</label>
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold focus:outline-none focus:border-brand"
              >
                <option value="">-- Send Plain Quick Message (No Template) --</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.category})</option>
                ))}
              </select>
            </div>

            <div className="flex justify-end pt-4">
              <button
                onClick={() => setWizardStep(2)}
                disabled={!campaignName.trim()}
                className="rounded-full bg-zinc-950 hover:bg-zinc-800 text-white font-bold text-xs px-6 py-2 cursor-pointer disabled:opacity-40"
              >
                Next Step
              </button>
            </div>
          </div>
        )}

        {wizardStep === 2 && (
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Contacts Upload Method</label>
              <div className="flex gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => setContactMethod("file")}
                  className={`flex-1 rounded-full py-1.5 text-xs font-bold border transition-all cursor-pointer ${
                    contactMethod === "file" ? "bg-zinc-950 text-white border-zinc-950" : "bg-zinc-50 border-zinc-200 text-zinc-650"
                  }`}
                >
                  Excel/CSV Upload
                </button>
                <button
                  type="button"
                  onClick={() => setContactMethod("manual")}
                  className={`flex-1 rounded-full py-1.5 text-xs font-bold border transition-all cursor-pointer ${
                    contactMethod === "manual" ? "bg-zinc-950 text-white border-zinc-950" : "bg-zinc-50 border-zinc-200 text-zinc-650"
                  }`}
                >
                  Manual Entry
                </button>
              </div>

              {contactMethod === "file" ? (
                <div className="space-y-4">
                  <div className="border-2 border-dashed border-zinc-200 hover:border-brand/40 bg-zinc-50/50 rounded-2xl p-6 text-center cursor-pointer transition-colors relative">
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleFileUpload}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                    <FileSpreadsheet className="h-8 w-8 text-zinc-400 mx-auto mb-2" />
                    <p className="text-xs font-bold text-zinc-700">Drag &amp; drop Excel or CSV sheet</p>
                    <p className="text-[10px] text-zinc-400 font-semibold mt-1">Accepts .xlsx, .xls, .csv. Must include phone header column.</p>
                  </div>

                  {parsedRecipients.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Parsed Contacts Sample ({parsedRecipients.length})</p>
                      <div className="border border-zinc-200 rounded-xl overflow-hidden max-h-40 overflow-y-auto">
                        <table className="w-full text-left text-[10px] font-semibold text-zinc-650">
                          <thead className="bg-zinc-50 text-[9px] text-zinc-400 uppercase border-b border-zinc-200">
                            <tr>
                              <th className="p-2">Name</th>
                              <th className="p-2">Phone</th>
                              <th className="p-2">Vars</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-150 bg-white">
                            {parsedRecipients.slice(0, 5).map((r, rIdx) => (
                              <tr key={rIdx}>
                                <td className="p-2 font-bold">{r.name}</td>
                                <td className="p-2">{r.phone}</td>
                                <td className="p-2 text-zinc-400">{JSON.stringify(r.variables)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Paste Numbers (one per line)</label>
                  <textarea
                    rows={6}
                    placeholder={`+919876543210, John Doe\n+919800012345, Jane Smith`}
                    value={manualNumbers}
                    onChange={(e) => setManualNumbers(e.target.value)}
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold focus:outline-none focus:border-brand font-mono"
                  />
                  <p className="text-[9px] text-zinc-400 font-semibold mt-1">Format: phone, name (optional)</p>
                </div>
              )}
            </div>

            <div className="flex justify-between pt-4">
              <button
                onClick={() => setWizardStep(1)}
                className="rounded-full border border-zinc-200 hover:bg-zinc-50 text-zinc-600 font-bold text-xs px-6 py-2 cursor-pointer"
              >
                Back
              </button>
              <button
                onClick={() => setWizardStep(3)}
                className="rounded-full bg-zinc-950 hover:bg-zinc-800 text-white font-bold text-xs px-6 py-2 cursor-pointer"
              >
                Next Step
              </button>
            </div>
          </div>
        )}

        {wizardStep === 3 && (
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-zinc-800 border-b border-zinc-100 pb-2">Anti-Ban Campaign Settings</h4>
            
            {/* Delay sliders */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Min Delay: {minDelay} seconds</label>
                <input
                  type="range"
                  min="5"
                  max="60"
                  value={minDelay}
                  onChange={(e) => setMinDelay(parseInt(e.target.value))}
                  className="w-full accent-zinc-950"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Max Delay: {maxDelay} seconds</label>
                <input
                  type="range"
                  min="10"
                  max="120"
                  value={maxDelay}
                  onChange={(e) => setMaxDelay(Math.max(minDelay + 2, parseInt(e.target.value)))}
                  className="w-full accent-zinc-950"
                />
              </div>
            </div>

            {/* Daily limit */}
            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Max Daily Message Sending Limit (For safety)</label>
              <input
                type="number"
                value={dailyLimit}
                onChange={(e) => setDailyLimit(parseInt(e.target.value))}
                className="w-32 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold focus:outline-none focus:border-brand"
              />
              <p className="text-[9px] text-zinc-400 font-semibold mt-1">Recommended is 200 messages per day per account to prevent phone number bans.</p>
            </div>

            <div className="flex justify-between pt-4 border-t border-zinc-100">
              <button
                onClick={() => setWizardStep(2)}
                className="rounded-full border border-zinc-200 hover:bg-zinc-50 text-zinc-600 font-bold text-xs px-6 py-2 cursor-pointer"
              >
                Back
              </button>
              <button
                onClick={handleCreateCampaign}
                className="rounded-full bg-zinc-950 hover:bg-zinc-800 text-white font-bold text-xs px-8 py-2.5 cursor-pointer flex items-center gap-1.5 shadow-md"
              >
                <Check className="h-4 w-4" /> Create Broadcast Campaign
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const handleStartCampaign = async (id: string) => {
    try {
      await startWACampaignServerFn({ data: id });
      showToast("success", "Campaign launched! Message sending enqueued in queue.");
      loadCampaigns();
    } catch (err: any) {
      showToast("error", "Launch failed: " + err.message);
    }
  };

  const handlePauseCampaign = async (id: string) => {
    try {
      await pauseWACampaignServerFn({ data: id });
      showToast("success", "Campaign paused in the microservice.");
      loadCampaigns();
    } catch (err: any) {
      showToast("error", "Pause failed: " + err.message);
    }
  };

  const handleDeleteCampaign = (id: string) => {
    setConfirmDialog({
      open: true,
      title: "Delete Campaign",
      message: "Are you sure you want to delete this campaign? This will delete all recipient logs and clear any remaining messages from queue.",
      onConfirm: async () => {
        try {
          await deleteWACampaignServerFn({ data: id });
          showToast("success", "Campaign deleted.");
          setSelectedCampaign(null);
          loadCampaigns();
        } catch (err: any) {
          showToast("error", "Delete failed: " + err.message);
        }
      }
    });
  };

  const handleViewRecipients = async (campaign: any) => {
    setSelectedCampaign(campaign);
    setLoadingRecipients(true);
    try {
      const res = await getCampaignRecipientsServerFn({ data: campaign.id });
      setCampaignRecipients(res);
    } catch (e: any) {
      showToast("error", "Failed to load recipients: " + e.message);
    } finally {
      setLoadingRecipients(false);
    }
  };

  // ──────────────────────────────────────────────
  // AUTO-REPLY CRUD HANDLERS
  // ──────────────────────────────────────────────
  const handleSaveAutoReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAutoReply.triggerKeyword.trim() || !editingAutoReply.replyMessage.trim()) {
      showToast("error", "Trigger and Reply message cannot be empty");
      return;
    }

    try {
      await saveWAAutoReplyServerFn({
        data: {
          id: editingAutoReply.id,
          triggerKeyword: editingAutoReply.triggerKeyword.trim(),
          matchType: editingAutoReply.matchType,
          replyMessage: editingAutoReply.replyMessage.trim(),
          isActive: editingAutoReply.isActive ? 1 : 0,
          priority: parseInt(editingAutoReply.priority) || 0
        }
      });
      showToast("success", "Auto-reply rule saved!");
      setEditingAutoReply(null);
      loadAutoReplies();
    } catch (err: any) {
      showToast("error", "Save failed: " + err.message);
    }
  };

  const handleDeleteAutoReply = (id: string) => {
    setConfirmDialog({
      open: true,
      title: "Delete Rule",
      message: "Are you sure you want to delete this keyword auto-reply rule?",
      onConfirm: async () => {
        try {
          await deleteWAAutoReplyServerFn({ data: id });
          showToast("success", "Rule deleted.");
          loadAutoReplies();
        } catch (err: any) {
          showToast("error", "Delete failed: " + err.message);
        }
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Premium WhatsApp Top Summary header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-emerald-500/10 to-teal-500/5 border border-emerald-500/15 rounded-3xl p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-emerald-500 flex items-center justify-center text-white shrink-0">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-zinc-900 flex items-center gap-2">
              WhatsApp Broadcast &amp; Automations Hub
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold border ${
                waStatus === "CONNECTED"
                  ? "bg-emerald-50 text-emerald-600 border-emerald-100"
                  : waStatus === "QR_READY" || waStatus === "CONNECTING"
                    ? "bg-amber-50 text-amber-600 border-amber-100"
                    : "bg-red-50 text-red-600 border-red-100"
              }`}>
                {waStatus === "CONNECTED" ? "Connected" : waStatus === "QR_READY" ? "Scan QR Code" : "Disconnected"}
              </span>
            </h2>
            <p className="text-xs text-zinc-500 font-medium mt-0.5">
              Build local templates, launch anti-ban broad broadcast campaigns, and configure keyword-based auto-replies.
            </p>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex bg-zinc-100 p-1 rounded-full border border-zinc-200 shrink-0 self-start sm:self-center">
          {[
            { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
            { id: "templates", label: "Templates", icon: FileText },
            { id: "campaigns", label: "Campaigns", icon: Send },
            { id: "auto-reply", label: "Auto-Replies", icon: RotateCcw },
            { id: "connection", label: "Device Link", icon: Wifi },
          ].map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setActiveSubTab(t.id as any);
                  setEditingTemplate(null);
                  setSelectedCampaign(null);
                  setEditingAutoReply(null);
                }}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[10px] font-black transition-all cursor-pointer ${
                  activeSubTab === t.id ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:text-zinc-800"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* SUB-TAB PANELS */}
      <AnimatePresence mode="wait">
        {/* DASHBOARD TAB */}
        {activeSubTab === "dashboard" && (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="grid gap-6 md:grid-cols-3"
          >
            {/* Stats Cards */}
            <div className="md:col-span-2 grid gap-4 sm:grid-cols-2">
              <div className="bg-white border border-zinc-200 rounded-3xl p-5 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Sent Messages</span>
                  <p className="text-3xl font-black text-zinc-800 tracking-tight mt-1">{stats.totalSent}</p>
                </div>
                <div className="h-10 w-10 bg-brand/5 border border-brand/10 text-brand rounded-full flex items-center justify-center font-bold">✓</div>
              </div>

              <div className="bg-white border border-zinc-200 rounded-3xl p-5 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Campaigns Dispatched</span>
                  <p className="text-3xl font-black text-zinc-800 tracking-tight mt-1">{stats.totalCampaigns}</p>
                </div>
                <div className="h-10 w-10 bg-brand/5 border border-brand/10 text-brand rounded-full flex items-center justify-center font-bold">🚀</div>
              </div>

              <div className="bg-white border border-zinc-200 rounded-3xl p-5 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Active Auto-Replies</span>
                  <p className="text-3xl font-black text-zinc-800 tracking-tight mt-1">{stats.activeAutoReplies}</p>
                </div>
                <div className="h-10 w-10 bg-brand/5 border border-brand/10 text-brand rounded-full flex items-center justify-center font-bold">🤖</div>
              </div>

              <div className="bg-white border border-zinc-200 rounded-3xl p-5 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Failed In Queue</span>
                  <p className="text-3xl font-black text-red-600 tracking-tight mt-1">{stats.totalFailed}</p>
                </div>
                <div className="h-10 w-10 bg-red-50 text-red-500 rounded-full flex items-center justify-center font-bold">✗</div>
              </div>
            </div>

            {/* Quick Broadcaster */}
            <div className="bg-white border border-zinc-200 rounded-3xl p-5 space-y-4">
              <div>
                <h3 className="text-xs font-bold text-zinc-900">Quick Message Dispatcher</h3>
                <p className="text-[10px] text-zinc-400 font-semibold">Instantly test send a message to a patient number</p>
              </div>

              <form onSubmit={handleQuickSend} className="space-y-3">
                <div>
                  <label className="text-[9px] font-bold text-zinc-400 uppercase block mb-1">Phone Number</label>
                  <input
                    type="text"
                    placeholder="+919876543210"
                    value={quickPhone}
                    onChange={(e) => setQuickPhone(e.target.value)}
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold focus:outline-none focus:border-brand"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-bold text-zinc-400 uppercase block mb-1">Message Body</label>
                  <textarea
                    rows={3}
                    placeholder="Hello, this is a quick message."
                    value={quickMsg}
                    onChange={(e) => setQuickMsg(e.target.value)}
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold focus:outline-none focus:border-brand"
                  />
                </div>
                <button
                  type="submit"
                  disabled={sendingQuick || waStatus !== "CONNECTED"}
                  className="w-full rounded-full bg-zinc-950 hover:bg-zinc-800 text-white text-xs font-bold py-2 cursor-pointer disabled:opacity-40 flex items-center justify-center gap-1.5"
                >
                  {sendingQuick ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3 w-3" />}
                  Send Quick Message
                </button>
                {waStatus !== "CONNECTED" && (
                  <p className="text-[8px] text-red-500 text-center font-bold">⚠️ Device connection is required to send messages</p>
                )}
              </form>
            </div>
          </motion.div>
        )}

        {/* TEMPLATES TAB */}
        {activeSubTab === "templates" && (
          <motion.div
            key="templates"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
          >
            {editingTemplate ? (
              <TemplateBuilder template={editingTemplate} />
            ) : (
              <div className="bg-white border border-zinc-200 rounded-3xl p-5 space-y-4">
                <div className="flex justify-between items-center border-b border-zinc-100 pb-3">
                  <div>
                    <h3 className="text-xs font-bold text-zinc-900">Saved Templates</h3>
                    <p className="text-[10px] text-zinc-400 font-semibold">Reusable templates with variables support</p>
                  </div>
                  <button
                    onClick={() => setEditingTemplate({})}
                    className="rounded-full bg-zinc-950 hover:bg-zinc-800 text-white font-bold text-xs px-4 py-1.5 flex items-center gap-1 cursor-pointer shadow-sm"
                  >
                    <Plus className="h-3.5 w-3.5" /> New Template
                  </button>
                </div>

                {loadingTemplates ? (
                  <div className="text-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin text-brand mx-auto mb-2" />
                    <p className="text-[10px] text-zinc-400 font-semibold">Loading templates...</p>
                  </div>
                ) : templates.length > 0 ? (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {templates.map((tpl) => (
                      <div key={tpl.id} className="border border-zinc-200 rounded-2xl p-4 flex flex-col justify-between hover:border-brand/35 transition-all">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-bold text-zinc-850 truncate max-w-[150px]">{tpl.name}</h4>
                            <span className="rounded-full bg-brand/10 border border-brand/20 px-2 py-0.5 text-[8px] font-black text-brand uppercase">{tpl.category}</span>
                          </div>
                          <p className="text-[10px] text-zinc-400 font-semibold line-clamp-3 leading-relaxed">{tpl.bodyText}</p>
                        </div>
                        <div className="flex gap-1.5 mt-4 pt-3 border-t border-zinc-100 justify-end">
                          <button
                            onClick={() => setEditingTemplate(tpl)}
                            className="rounded-full border border-zinc-200 hover:bg-zinc-50 px-3 py-1 text-[10px] font-bold text-zinc-650 cursor-pointer flex items-center gap-1"
                          >
                            <Edit3 className="h-3 w-3" /> Edit
                          </button>
                          <button
                            onClick={() => {
                              setConfirmDialog({
                                open: true,
                                title: "Delete Template",
                                message: `Are you sure you want to delete template "${tpl.name}"?`,
                                onConfirm: async () => {
                                  try {
                                    await deleteWATemplateServerFn({ data: tpl.id });
                                    showToast("success", "Template deleted.");
                                    loadTemplates();
                                  } catch (err: any) {
                                    showToast("error", "Delete failed: " + err.message);
                                  }
                                }
                              });
                            }}
                            className="rounded-full border border-red-200 hover:bg-red-50 px-3 py-1 text-[10px] font-bold text-red-500 cursor-pointer flex items-center gap-1"
                          >
                            <Trash2 className="h-3 w-3" /> Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-10 border border-dashed border-zinc-200 rounded-2xl">
                    <FileText className="h-8 w-8 text-zinc-350 mx-auto mb-2" />
                    <p className="text-xs font-bold text-zinc-700">No Templates Created</p>
                    <p className="text-[10px] text-zinc-400 font-semibold mt-1">Create templates with variables to launch broadcast campaigns.</p>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}

        {/* CAMPAIGNS TAB */}
        {activeSubTab === "campaigns" && (
          <motion.div
            key="campaigns"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
          >
            {creatingCampaign ? (
              <CampaignWizard />
            ) : selectedCampaign ? (
              <div className="bg-white border border-zinc-200 rounded-3xl p-5 space-y-5">
                {/* Campaign Detail Header */}
                <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                  <div>
                    <h3 className="text-xs font-bold text-zinc-900 flex items-center gap-2">
                      {selectedCampaign.name}
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[8.5px] font-black uppercase border ${
                        selectedCampaign.status === "completed"
                          ? "bg-emerald-50 text-emerald-600 border-emerald-100"
                          : selectedCampaign.status === "sending"
                            ? "bg-blue-50 text-blue-600 border-blue-100"
                            : selectedCampaign.status === "paused"
                              ? "bg-amber-50 text-amber-600 border-amber-100"
                              : "bg-zinc-50 text-zinc-600 border-zinc-100"
                      }`}>
                        {selectedCampaign.status}
                      </span>
                    </h3>
                    <p className="text-[10px] text-zinc-400 font-semibold mt-0.5">
                      Template: {selectedCampaign.templateName || "Quick Text"} · Delays: {selectedCampaign.minDelaySec}–{selectedCampaign.maxDelaySec}s
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleViewRecipients(selectedCampaign)} // Refresh
                      className="p-1.5 rounded-full border border-zinc-200 hover:bg-zinc-50 cursor-pointer"
                    >
                      <RefreshCw className="h-3.5 w-3.5 text-zinc-650" />
                    </button>
                    <button
                      onClick={() => setSelectedCampaign(null)}
                      className="text-xs text-zinc-400 hover:text-zinc-650 font-bold bg-zinc-100 px-3 py-1.5 rounded-full cursor-pointer"
                    >
                      Back to List
                    </button>
                  </div>
                </div>

                {/* Campaign Action Panel */}
                <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-zinc-50 border border-zinc-150">
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-[9px] font-bold text-zinc-400 uppercase">Progress</p>
                      <p className="text-sm font-black text-zinc-800 mt-0.5">
                        {selectedCampaign.sentCount + selectedCampaign.failedCount} / {selectedCampaign.totalRecipients} processed
                      </p>
                    </div>
                    {/* Progress Bar */}
                    <div className="w-32 bg-zinc-200 h-2.5 rounded-full overflow-hidden">
                      <div
                        className="bg-brand h-full rounded-full transition-all duration-350"
                        style={{ width: `${(selectedCampaign.totalRecipients > 0 ? ((selectedCampaign.sentCount + selectedCampaign.failedCount) / selectedCampaign.totalRecipients) * 100 : 0)}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {selectedCampaign.status === "draft" && (
                      <button
                        onClick={() => handleStartCampaign(selectedCampaign.id)}
                        disabled={waStatus !== "CONNECTED"}
                        className="rounded-full bg-brand text-white font-bold text-xs px-5 py-1.5 flex items-center gap-1.5 hover:bg-brand/90 disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        <Play className="h-3.5 w-3.5" /> Launch Campaign
                      </button>
                    )}
                    {selectedCampaign.status === "sending" && (
                      <button
                        onClick={() => handlePauseCampaign(selectedCampaign.id)}
                        className="rounded-full bg-amber-500 text-white font-bold text-xs px-5 py-1.5 flex items-center gap-1.5 hover:bg-amber-600 cursor-pointer shadow-sm"
                      >
                        <Pause className="h-3.5 w-3.5" /> Pause
                      </button>
                    )}
                    {selectedCampaign.status === "paused" && (
                      <button
                        onClick={() => handleStartCampaign(selectedCampaign.id)}
                        disabled={waStatus !== "CONNECTED"}
                        className="rounded-full bg-brand text-white font-bold text-xs px-5 py-1.5 flex items-center gap-1.5 hover:bg-brand/90 disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        <Play className="h-3.5 w-3.5" /> Resume Campaign
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteCampaign(selectedCampaign.id)}
                      className="rounded-full border border-red-200 hover:bg-red-50 text-red-500 font-bold text-xs px-4 py-1.5 flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete Campaign
                    </button>
                  </div>
                </div>

                {/* Recipient status grid */}
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Recipients List &amp; Live Delivery Status</p>
                  {loadingRecipients ? (
                    <div className="text-center py-10">
                      <Loader2 className="h-5 w-5 animate-spin text-zinc-400 mx-auto" />
                    </div>
                  ) : (
                    <div className="border border-zinc-200 rounded-2xl overflow-hidden shadow-sm">
                      <table className="w-full text-left text-xs font-semibold text-zinc-650">
                        <thead className="bg-zinc-50 text-[9.5px] text-zinc-400 uppercase border-b border-zinc-200">
                          <tr>
                            <th className="p-3">Phone</th>
                            <th className="p-3">Name</th>
                            <th className="p-3">Delivery Status</th>
                            <th className="p-3">Sent Time</th>
                            <th className="p-3">Fail Reason</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-150 bg-white">
                          {campaignRecipients.map((rec) => (
                            <tr key={rec.id} className="hover:bg-zinc-50/50">
                              <td className="p-3 font-mono">{rec.phone}</td>
                              <td className="p-3 font-bold text-zinc-800">{rec.name || "—"}</td>
                              <td className="p-3">
                                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase border ${
                                  rec.status === "sent"
                                    ? "bg-emerald-50 text-emerald-600 border-emerald-100"
                                    : rec.status === "failed"
                                      ? "bg-red-50 text-red-600 border-red-100"
                                      : "bg-amber-50 text-amber-600 border-amber-100"
                                }`}>
                                  {rec.status}
                                </span>
                              </td>
                              <td className="p-3 text-[10px] text-zinc-400">
                                {rec.sentAt ? new Date(rec.sentAt).toLocaleString("en-IN") : "Pending"}
                              </td>
                              <td className="p-3 text-[10px] text-red-500 font-semibold max-w-[200px] truncate">
                                {rec.errorMsg || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white border border-zinc-200 rounded-3xl p-5 space-y-4">
                <div className="flex justify-between items-center border-b border-zinc-100 pb-3">
                  <div>
                    <h3 className="text-xs font-bold text-zinc-900">Campaigns History</h3>
                    <p className="text-[10px] text-zinc-400 font-semibold">Monitor progress and trigger pending campaigns</p>
                  </div>
                  <button
                    onClick={() => setCreatingCampaign(true)}
                    className="rounded-full bg-zinc-950 hover:bg-zinc-800 text-white font-bold text-xs px-4 py-1.5 flex items-center gap-1 cursor-pointer shadow-sm"
                  >
                    <Plus className="h-3.5 w-3.5" /> Create Broadcast
                  </button>
                </div>

                {loadingCampaigns ? (
                  <div className="text-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin text-brand mx-auto mb-2" />
                    <p className="text-[10px] text-zinc-400 font-semibold">Loading campaigns...</p>
                  </div>
                ) : campaigns.length > 0 ? (
                  <div className="border border-zinc-200 rounded-2xl overflow-hidden shadow-sm">
                    <table className="w-full text-left text-xs font-semibold text-zinc-650">
                      <thead className="bg-zinc-50 text-[9.5px] text-zinc-400 uppercase border-b border-zinc-200">
                        <tr>
                          <th className="p-3">Campaign Info</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Recipients</th>
                          <th className="p-3">Dispatched / Failed</th>
                          <th className="p-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-150 bg-white">
                        {campaigns.map((camp) => (
                          <tr key={camp.id} className="hover:bg-zinc-50/50">
                            <td className="p-3">
                              <p className="font-bold text-zinc-800">{camp.name}</p>
                              <p className="text-[9px] text-zinc-400 font-semibold mt-0.5">Template: {camp.templateName || "Quick Text"}</p>
                            </td>
                            <td className="p-3">
                              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase border ${
                                camp.status === "completed"
                                  ? "bg-emerald-50 text-emerald-600 border-emerald-100"
                                  : camp.status === "sending"
                                    ? "bg-blue-50 text-blue-600 border-blue-100"
                                    : camp.status === "paused"
                                      ? "bg-amber-50 text-amber-600 border-amber-100"
                                      : "bg-zinc-50 text-zinc-600 border-zinc-150"
                              }`}>
                                {camp.status}
                              </span>
                            </td>
                            <td className="p-3 font-mono">{camp.totalRecipients}</td>
                            <td className="p-3 text-zinc-400">
                              <span className="text-emerald-600 font-bold">{camp.sentCount} sent</span> / <span className="text-red-500 font-bold">{camp.failedCount} failed</span>
                            </td>
                            <td className="p-3 text-right">
                              <button
                                onClick={() => handleViewRecipients(camp)}
                                className="rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-[10px] font-bold px-3.5 py-1.5 cursor-pointer inline-flex items-center gap-1"
                              >
                                View Details <ChevronRight className="h-3 w-3" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-10 border border-dashed border-zinc-200 rounded-2xl">
                    <Send className="h-8 w-8 text-zinc-350 mx-auto mb-2" />
                    <p className="text-xs font-bold text-zinc-700">No Campaigns Found</p>
                    <p className="text-[10px] text-zinc-400 font-semibold mt-1">Upload contacts and launch custom campaigns.</p>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}

        {/* AUTO-REPLIES TAB */}
        {activeSubTab === "auto-reply" && (
          <motion.div
            key="auto-reply"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="space-y-6"
          >
            {editingAutoReply ? (
              <form onSubmit={handleSaveAutoReply} className="rounded-3xl border border-zinc-200 bg-white p-6 space-y-5">
                <div className="flex items-center justify-between border-b border-zinc-150 pb-4">
                  <h3 className="text-base font-bold text-zinc-900">{editingAutoReply.id ? "Edit Auto-Reply Rule" : "Create Auto-Reply Rule"}</h3>
                  <button
                    type="button"
                    onClick={() => setEditingAutoReply(null)}
                    className="text-xs text-zinc-400 hover:text-zinc-650 font-bold bg-zinc-100 px-3 py-1.5 rounded-full cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Trigger Keyword</label>
                      <input
                        type="text"
                        placeholder="e.g. book, checkup, slot"
                        value={editingAutoReply.triggerKeyword}
                        onChange={(e) => setEditingAutoReply((prev: any) => ({ ...prev, triggerKeyword: e.target.value }))}
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold focus:outline-none focus:border-brand"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Match Type</label>
                      <select
                        value={editingAutoReply.matchType}
                        onChange={(e) => setEditingAutoReply((prev: any) => ({ ...prev, matchType: e.target.value }))}
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold focus:outline-none focus:border-brand"
                      >
                        <option value="exact">Exact Phrase Match</option>
                        <option value="contains">Contains Word</option>
                        <option value="startsWith">Starts With</option>
                        <option value="regex">Regular Expression (Advanced)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Auto-Reply Message</label>
                    <textarea
                      rows={4}
                      placeholder="Thank you for reaching out! To book a clinic appointment online, visit: https://mediflow.ai/book"
                      value={editingAutoReply.replyMessage}
                      onChange={(e) => setEditingAutoReply((prev: any) => ({ ...prev, replyMessage: e.target.value }))}
                      className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold focus:outline-none focus:border-brand"
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Match Priority (Higher Matches First)</label>
                      <input
                        type="number"
                        value={editingAutoReply.priority}
                        onChange={(e) => setEditingAutoReply((prev: any) => ({ ...prev, priority: parseInt(e.target.value) || 0 }))}
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold focus:outline-none focus:border-brand"
                      />
                    </div>
                    <div className="flex items-center pt-6 pl-1">
                      <label className="flex items-center gap-2 text-xs font-bold text-zinc-650 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editingAutoReply.isActive}
                          onChange={(e) => setEditingAutoReply((prev: any) => ({ ...prev, isActive: e.target.checked }))}
                          className="rounded"
                        />
                        Rule Active
                      </label>
                    </div>
                  </div>
                </div>

                <div className="border-t border-zinc-150 pt-4 flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 rounded-full bg-zinc-950 text-white font-bold text-xs py-2.5 hover:bg-zinc-800 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    Save Auto-Reply Rule
                  </button>
                </div>
              </form>
            ) : (
              <div className="bg-white border border-zinc-200 rounded-3xl p-5 space-y-4">
                <div className="flex justify-between items-center border-b border-zinc-100 pb-3">
                  <div>
                    <h3 className="text-xs font-bold text-zinc-900">Auto-Reply Keyword Rules</h3>
                    <p className="text-[10px] text-zinc-400 font-semibold">Define trigger words and custom templates replies</p>
                  </div>
                  <button
                    onClick={() => setEditingAutoReply({ triggerKeyword: "", matchType: "contains", replyMessage: "", isActive: true, priority: 0 })}
                    className="rounded-full bg-zinc-950 hover:bg-zinc-800 text-white font-bold text-xs px-4 py-1.5 flex items-center gap-1 cursor-pointer shadow-sm"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Rule
                  </button>
                </div>

                {loadingAutoReplies ? (
                  <div className="text-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin text-brand mx-auto" />
                  </div>
                ) : autoReplies.length > 0 ? (
                  <div className="border border-zinc-200 rounded-2xl overflow-hidden shadow-sm">
                    <table className="w-full text-left text-xs font-semibold text-zinc-650">
                      <thead className="bg-zinc-50 text-[9.5px] text-zinc-400 uppercase border-b border-zinc-200">
                        <tr>
                          <th className="p-3">Trigger Keyword</th>
                          <th className="p-3">Match</th>
                          <th className="p-3">Reply Message</th>
                          <th className="p-3">Priority</th>
                          <th className="p-3">Active</th>
                          <th className="p-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-150 bg-white">
                        {autoReplies.map((rule) => (
                          <tr key={rule.id} className="hover:bg-zinc-50/50">
                            <td className="p-3 font-mono font-bold text-zinc-800">{rule.triggerKeyword}</td>
                            <td className="p-3">
                              <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[8.5px] border border-zinc-200 font-bold">{rule.matchType}</span>
                            </td>
                            <td className="p-3 truncate max-w-[200px] text-[11px]" title={rule.replyMessage}>
                              {rule.replyMessage}
                            </td>
                            <td className="p-3 text-zinc-400">{rule.priority}</td>
                            <td className="p-3">
                              <span className={`h-2.5 w-2.5 rounded-full inline-block ${rule.isActive ? "bg-emerald-500" : "bg-zinc-300"}`} />
                            </td>
                            <td className="p-3 text-right space-x-1.5">
                              <button
                                onClick={() => setEditingAutoReply({ ...rule, isActive: !!rule.isActive })}
                                className="rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-[10px] font-bold px-3 py-1 cursor-pointer"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDeleteAutoReply(rule.id)}
                                className="rounded-full bg-red-50 hover:bg-red-100 text-red-500 text-[10px] font-bold px-3 py-1 cursor-pointer"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-10 border border-dashed border-zinc-200 rounded-2xl">
                    <RotateCcw className="h-8 w-8 text-zinc-350 mx-auto mb-2" />
                    <p className="text-xs font-bold text-zinc-700">No Auto-Reply Rules</p>
                    <p className="text-[10px] text-zinc-400 font-semibold mt-1">Add trigger rules to auto-respond to incoming messages.</p>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}

        {/* CONNECTION LINKING TAB */}
        {activeSubTab === "connection" && (
          <motion.div
            key="connection"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="grid gap-6 md:grid-cols-2"
          >
            {/* Device QR pairing state */}
            <div className="bg-white border border-zinc-200 rounded-3xl p-5 space-y-4 flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-bold text-zinc-900">WhatsApp Device Link</h3>
                <p className="text-[10px] text-zinc-400 font-semibold">Scan QR code using WhatsApp to pair your clinic number</p>
              </div>

              {waStatus === "CONNECTED" ? (
                <div className="text-center py-10 space-y-3 bg-emerald-50/20 border border-emerald-100 rounded-2xl">
                  <Wifi className="h-10 w-10 text-emerald-500 mx-auto animate-pulse" />
                  <div>
                    <p className="text-xs font-bold text-zinc-800">Your WhatsApp is Linked!</p>
                    <p className="text-[10px] font-semibold text-zinc-400 mt-0.5">Connected number: {waConnectedNumber || "Clinic Account"}</p>
                  </div>
                  <button
                    onClick={async () => {
                      setConfirmDialog({
                        open: true,
                        title: "Disconnect WhatsApp",
                        message: "Are you sure you want to disconnect? You will have to scan a new QR code to pair again.",
                        onConfirm: async () => {
                          try {
                            await disconnectWhatsAppServerFn();
                            showToast("success", "Session disconnected");
                            fetchStatus();
                          } catch (e: any) {
                            showToast("error", "Disconnect failed: " + e.message);
                          }
                        }
                      });
                    }}
                    className="rounded-full bg-red-50 hover:bg-red-100 text-red-500 text-[10px] font-bold px-5 py-2 cursor-pointer transition-all border border-red-150 inline-block"
                  >
                    Disconnect Device Link
                  </button>
                </div>
              ) : waStatus === "CONNECTING" || waStatus === "QR_READY" ? (
                <div className="text-center py-6 space-y-4">
                  {waQrDataUrl ? (
                    <div className="bg-white p-4 border border-zinc-200 rounded-2xl w-48 h-48 mx-auto shadow-sm flex items-center justify-center">
                      <img src={waQrDataUrl} alt="WhatsApp QR Code" className="w-full h-full object-contain" />
                    </div>
                  ) : (
                    <div className="h-48 w-48 bg-zinc-50 border border-zinc-200 rounded-2xl mx-auto flex flex-col items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
                      <p className="text-[9px] font-semibold text-zinc-400 mt-2">Retrieving QR Code...</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-bold text-zinc-700">Scan QR from WhatsApp Settings &gt; Linked Devices</p>
                    <p className="text-[9px] text-zinc-400 font-semibold mt-1">Automatic refreshing every 10 seconds. Keeping this tab open helps.</p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-10 space-y-3 bg-zinc-50 rounded-2xl border border-dashed border-zinc-200">
                  <WifiOff className="h-8 w-8 text-zinc-400 mx-auto" />
                  <div>
                    <p className="text-xs font-bold text-zinc-700">Service is Offline</p>
                    <p className="text-[10px] text-zinc-400 font-semibold mt-0.5">Initialize to retrieve QR code and link your phone</p>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        await fetchStatus();
                        showToast("success", "Connecting...");
                      } catch (e: any) {
                        showToast("error", "Failed: " + e.message);
                      }
                    }}
                    className="rounded-full bg-zinc-950 hover:bg-zinc-800 text-white text-[10px] font-bold px-5 py-2 cursor-pointer shadow-sm"
                  >
                    Start Initialization
                  </button>
                </div>
              )}
            </div>

            {/* Test Console Outbox logs */}
            <div className="bg-white border border-zinc-200 rounded-3xl p-5 space-y-4">
              <div>
                <h3 className="text-xs font-bold text-zinc-900">Real-Time Messaging Console</h3>
                <p className="text-[10px] text-zinc-400 font-semibold">Active queue: {waQueueCount} messages pending</p>
              </div>

              <div className="border border-zinc-200 rounded-2xl bg-zinc-950 p-4 aspect-[4/3] text-[9.5px] font-mono text-zinc-300 overflow-y-auto space-y-2 select-text">
                <p className="text-brand font-bold border-b border-zinc-800 pb-1 mb-2">// OUTBOX LOG (LAST 50 MESSAGES)</p>
                {waSentLogs.length > 0 ? (
                  waSentLogs.map((log, idx) => (
                    <div key={idx} className="border-b border-zinc-900/60 pb-1.5">
                      <span className="text-zinc-500">[{new Date(log.timestamp).toLocaleTimeString()}]</span>{" "}
                      <span className="text-emerald-500 font-bold">To: +{log.recipient}</span>{" "}
                      <span className={`px-1 py-0.5 rounded text-[8px] font-bold uppercase ${log.status === "sent" ? "bg-emerald-950 text-emerald-450" : "bg-red-950 text-red-400"}`}>
                        {log.status}
                      </span>
                      <p className="text-zinc-400 pl-4 mt-0.5 truncate">{log.message}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-zinc-500 italic">No messages sent in this session yet.</p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
