import { useState, useRef, useEffect, useCallback } from "react";

// ── Data ──────────────────────────────────────────────────────
const SCENARIOS = [
  { id: "ransomware", name: "Ransomware Attack", icon: "🔒", severity: "Critical", description: "Malicious encryption spreads across the network. Production systems are down. Attackers demand payment.", tags: ["CISA", "NIST IR"] },
  { id: "data-exfil", name: "Data Exfiltration", icon: "📤", severity: "High", description: "Unusual outbound traffic detected. Sensitive customer records may have been copied to an external server.", tags: ["NIST IR", "PCI-DSS"] },
  { id: "ddos", name: "DDoS Attack", icon: "🌊", severity: "High", description: "Web-facing services overwhelmed by volumetric traffic. Customer access is degraded or unavailable.", tags: ["CISA", "NIST IR"] },
  { id: "insider", name: "Insider Threat", icon: "🕵️", severity: "High", description: "A privileged user account shows anomalous behavior — bulk downloads, after-hours access, unusual destinations.", tags: ["NIST IR"] },
  { id: "phishing", name: "Spear-Phishing / BEC", icon: "🎣", severity: "Medium", description: "A targeted phishing email spoofing the CFO has led to a fraudulent wire transfer request reaching finance.", tags: ["CISA", "NIST IR"] },
  { id: "supply-chain", name: "Supply Chain Compromise", icon: "⛓️", severity: "Critical", description: "A third-party software update delivered malicious code. Unknown blast radius across all installations.", tags: ["CISA"] },
];

const INDUSTRY_PLAYBOOKS = [
  { id: "cisa", name: "CISA Incident Response", type: "industry", phases: ["Preparation", "Detection & Analysis", "Containment", "Eradication", "Recovery", "Post-Incident"] },
  { id: "nist", name: "NIST SP 800-61", type: "industry", phases: ["Preparation", "Detection & Analysis", "Containment, Eradication & Recovery", "Post-Incident Activity"] },
];

const ROLES = ["Facilitator", "Incident Commander", "Security Analyst", "Network Engineer", "Legal / Compliance", "Communications Lead", "Executive Sponsor", "Observer"];

const INJECT_LIBRARY = {
  ransomware: [
    { title: "Backup System Alert", text: "IT reports that network-attached backup drives appear to be encrypting. The offline tape backup from last week may be the only clean copy.", color: "#dc2626" },
    { title: "Ransom Note Received", text: "Attackers send a message: $4.2M in BTC within 48 hours, or keys are destroyed and data published.", color: "#dc2626" },
    { title: "Third-Party Vendor Notified", text: "A major SaaS vendor calls — they've detected the encryption spreading via your shared API credentials.", color: "#ea580c" },
    { title: "Cyber Insurance Contacted", text: "Legal reaches out to the insurer. The policy has a 72-hour notification requirement.", color: "#ca8a04" },
    { title: "Media Inquiry", text: "A reporter from a trade publication contacts PR — they've heard about the 'outage.'", color: "#ca8a04" },
  ],
  "data-exfil": [
    { title: "Exfiltration Confirmed", text: "DLP logs confirm 2.3 TB left via SFTP to an IP in Eastern Europe over 6 days.", color: "#dc2626" },
    { title: "Regulatory Clock Starts", text: "Legal: under GDPR you have 72 hours from discovery to notify the DPA. Clock started 4 hours ago.", color: "#ea580c" },
    { title: "Customer Data Identified", text: "Initial triage shows the exfiltrated data contains PII for ~340,000 customers.", color: "#dc2626" },
  ],
  ddos: [
    { title: "Amplification Vector Found", text: "Network team identifies a DNS amplification attack using your open resolver.", color: "#ea580c" },
    { title: "CDN Failover Triggered", text: "The CDN automatically failed over, but origin servers are still being hammered.", color: "#ca8a04" },
    { title: "Attack Escalates", text: "Traffic peaks at 680 Gbps. The upstream ISP is threatening to null-route your ASN.", color: "#dc2626" },
  ],
  insider: [
    { title: "HR Records Pulled", text: "The employee filed a grievance three months ago. Termination proceedings were underway.", color: "#ea580c" },
    { title: "USB Evidence Found", text: "Physical security log shows the employee badged into the server room and plugged in a USB device last Tuesday.", color: "#dc2626" },
    { title: "Legal Hold Required", text: "Legal instructs IT: preserve all logs and accounts. Do not disable — monitor only.", color: "#ca8a04" },
  ],
  phishing: [
    { title: "Wire Transfer Initiated", text: "Finance confirms a $620,000 wire was sent before the email was flagged.", color: "#dc2626" },
    { title: "Additional Targets Identified", text: "Similar emails were sent to 12 other executives. Two others clicked the link.", color: "#ea580c" },
    { title: "Credential Harvest Suspected", text: "The phishing link led to a spoofed login page. Assume all credentials entered are compromised.", color: "#dc2626" },
  ],
  "supply-chain": [
    { title: "CISA Alert Issued", text: "CISA releases a public advisory: 3,000+ organizations may be affected by the same update.", color: "#dc2626" },
    { title: "Vendor Patch Released", text: "The affected vendor issued an emergency patch, but applying it requires a full reinstall.", color: "#ea580c" },
    { title: "C2 Traffic Detected", text: "EDR identifies beaconing to a known C2 server from 17 endpoints post-update.", color: "#dc2626" },
  ],
};

// Turn-limit defaults per pace tier — used as the initial maxTurns value
// and as the "reset to default" target for each tier.
const PACE_TURN_DEFAULTS = { relaxed: 6, standard: 4, tight: 2 };

// Default facilitator config
const DEFAULT_FACILITATOR = {
  tone: "professional",        // professional | conversational | intense
  difficulty: "moderate",      // light | moderate | rigorous
  probing: "balanced",         // gentle | balanced | aggressive
  focusAreas: [],              // legal | technical | communications | executive
  customInstructions: "",
  turnPace: "standard",        // relaxed | standard | tight — default turn cap per phase
  maxTurns: PACE_TURN_DEFAULTS.standard, // editable; "reset to default" restores this from turnPace
};

// ── Web Speech API helper ─────────────────────────────────────
const speech = (() => {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  let cachedVoice = null;

  const pickVoice = () => {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    // Prefer high-quality online English voices (Google, Microsoft), then any en-US, then any English
    return (
      voices.find(v => v.lang === "en-US" && /google/i.test(v.name))  ||
      voices.find(v => v.lang === "en-US" && /microsoft/i.test(v.name)) ||
      voices.find(v => v.lang === "en-US" && !v.localService) ||
      voices.find(v => v.lang === "en-US") ||
      voices.find(v => v.lang.startsWith("en")) ||
      voices[0]
    );
  };

  // Pre-load voice as soon as the browser has them ready
  if (supported) {
    // Some browsers populate immediately (Firefox), others fire voiceschanged (Chrome)
    cachedVoice = pickVoice();
    window.speechSynthesis.addEventListener("voiceschanged", () => {
      cachedVoice = pickVoice();
    });
  }

  return {
    supported,
    speak(text, { rate = 0.95, pitch = 1, volume = 1 } = {}) {
      if (!supported) return;
      window.speechSynthesis.cancel();
      const clean = text
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/⚠️ INJECT:/g, "Inject:")
        .replace(/[#_`]/g, "")
        .replace(/<br\/>/g, " ");
      const utt = new SpeechSynthesisUtterance(clean);
      utt.rate = rate; utt.pitch = pitch; utt.volume = volume;
      // Use cached voice; if somehow still null, try one more time
      utt.voice = cachedVoice || pickVoice();
      window.speechSynthesis.speak(utt);
    },
    stop() { if (supported) window.speechSynthesis.cancel(); },
  };
})();

// ── Styles ────────────────────────────────────────────────────
const FontStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Inter:wght@300;400;500;600;700&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; height: 100%; }
    body {
      background: #080c10; color: #c9d1da;
      font-family: 'Inter', sans-serif; font-size: 14px; line-height: 1.6;
      overflow-y: scroll; min-height: 100%; display: flex; flex-direction: column;
    }
    #root { display: flex; flex-direction: column; min-height: 100vh; }
    .app-content { flex: 1; display: flex; flex-direction: column; }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: #0f1620; }
    ::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 3px; }
    .mono { font-family: 'Share Tech Mono', monospace; }

    .topbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 24px; height: 56px;
      background: #0a0f18; border-bottom: 1px solid #1a2a3a;
      position: sticky; top: 0; z-index: 200;
    }
    .topbar-brand { display: flex; align-items: center; gap: 10px; }
    .topbar-logo {
      width: 30px; height: 30px;
      background: linear-gradient(135deg, #0d6efd, #00d4ff);
      border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 16px;
    }
    .topbar-title { font-family: 'Share Tech Mono', monospace; font-size: 15px; color: #e0eaff; letter-spacing: 0.05em; }
    .topbar-subtitle { font-size: 11px; color: #4a6fa5; margin-top: 1px; }
    .topbar-right { display: flex; align-items: center; gap: 12px; }

    .exercise-subheader { position: sticky; top: 56px; z-index: 150; background: #0a0f18; border-bottom: 1px solid #1a2a3a; }

    .badge {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 3px 10px; border-radius: 4px;
      font-size: 11px; font-family: 'Share Tech Mono', monospace; letter-spacing: 0.05em;
    }
    .badge-live { background: rgba(0,212,100,0.15); color: #00d464; border: 1px solid rgba(0,212,100,0.3); }
    .badge-severity-Critical { background: rgba(220,38,38,0.15); color: #f87171; border: 1px solid rgba(220,38,38,0.3); }
    .badge-severity-High { background: rgba(234,88,12,0.15); color: #fb923c; border: 1px solid rgba(234,88,12,0.3); }
    .badge-severity-Medium { background: rgba(202,138,4,0.15); color: #fbbf24; border: 1px solid rgba(202,138,4,0.3); }

    .nav-tabs { display: flex; gap: 2px; padding: 0 24px; }
    .nav-tab {
      padding: 10px 18px; border: none; background: none;
      color: #4a6fa5; cursor: pointer; font-size: 13px;
      border-bottom: 2px solid transparent; margin-bottom: -1px;
      transition: color 0.15s, border-color 0.15s;
      display: flex; align-items: center; gap: 6px;
    }
    .nav-tab:hover { color: #7cb3f5; }
    .nav-tab.active { color: #60a5fa; border-bottom-color: #60a5fa; }

    .main { padding: 24px; max-width: 1400px; margin: 0 auto; width: 100%; }

    .card { background: #0d1621; border: 1px solid #1a2a3a; border-radius: 8px; padding: 20px; }
    .card-title {
      font-size: 11px; font-family: 'Share Tech Mono', monospace;
      color: #4a6fa5; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 14px;
    }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
    .flex { display: flex; }
    .flex-col { flex-direction: column; }
    .gap-3 { gap: 12px; }
    .gap-4 { gap: 16px; }

    .scenario-card {
      background: #0d1621; border: 1px solid #1a2a3a; border-radius: 8px;
      padding: 18px; cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
      display: flex; flex-direction: column; gap: 10px;
    }
    .scenario-card:hover { border-color: #2a4a7a; background: #0f1c2e; }
    .scenario-card.selected { border-color: #60a5fa; background: rgba(96,165,250,0.06); }
    .scenario-icon { font-size: 28px; }
    .scenario-name { font-size: 15px; font-weight: 600; color: #e0eaff; }
    .scenario-desc { font-size: 13px; color: #6b82a0; line-height: 1.5; }
    .scenario-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
    .tag {
      font-size: 10px; font-family: 'Share Tech Mono', monospace;
      padding: 2px 7px; border-radius: 3px;
      background: rgba(96,165,250,0.1); color: #60a5fa; border: 1px solid rgba(96,165,250,0.2);
    }

    .btn {
      padding: 9px 18px; border-radius: 6px; border: none;
      font-size: 13px; font-weight: 500; cursor: pointer;
      display: inline-flex; align-items: center; gap: 7px;
      transition: background 0.15s; white-space: nowrap;
    }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; transition: none; }
    .btn-primary { background: #1d4ed8; color: #fff; }
    .btn-primary:hover:not(:disabled) { background: #2563eb; }
    .btn-ghost { background: rgba(255,255,255,0.04); color: #93afd4; border: 1px solid #1a2a3a; }
    .btn-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.08); }
    .btn-success { background: rgba(22,163,74,0.2); color: #4ade80; border: 1px solid rgba(22,163,74,0.3); }
    .btn-active { background: rgba(29,78,216,0.25); color: #93c5fd; border: 1px solid #1d4ed8; }
    .btn-sm { padding: 5px 12px; font-size: 12px; }
    .btn-icon { padding: 5px 8px; font-size: 14px; background: none; border: none; cursor: pointer; color: #4a6a8a; border-radius: 4px; }
    .btn-icon:hover { background: rgba(255,255,255,0.06); color: #93afd4; }

    input[type=text], input[type=number], input[type=file], textarea, select {
      background: #0a1520; border: 1px solid #1a2a3a; border-radius: 6px;
      color: #c9d1da; padding: 9px 12px; font-size: 13px;
      font-family: 'Inter', sans-serif; width: 100%; outline: none;
      transition: border-color 0.15s;
    }
    input[type=text]:focus, input[type=number]:focus, textarea:focus, select:focus { border-color: #1d4ed8; }
    input[type=number] { width: auto; }
    input[type=file] { padding: 7px 10px; cursor: pointer; }
    textarea { resize: vertical; min-height: 80px; }
    label { font-size: 12px; color: #4a6fa5; display: block; margin-bottom: 5px; }

    /* Pill toggle group */
    .pill-group { display: flex; gap: 6px; flex-wrap: wrap; }
    .pill {
      padding: 5px 13px; border-radius: 20px; font-size: 12px; cursor: pointer;
      border: 1px solid #1a2a3a; background: #0a1520; color: #4a6a8a;
      transition: all 0.15s; user-select: none;
    }
    .pill:hover { border-color: #2a4a7a; color: #7cb3f5; }
    .pill.active { background: rgba(29,78,216,0.2); border-color: #1d4ed8; color: #93c5fd; }
    .pill.active-multi { background: rgba(22,163,74,0.12); border-color: rgba(22,163,74,0.4); color: #4ade80; }

    /* Role seat rows */
    .role-seat {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; border-radius: 6px;
      background: #0a1520; border: 1px solid #1a2a3a;
      transition: border-color 0.15s;
    }
    .role-seat:hover { border-color: #1a3050; }
    .role-seat-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .role-seat-name { flex: 1; font-size: 13px; }
    .role-seat-role { font-size: 11px; color: #3a5a7a; font-family: 'Share Tech Mono', monospace; flex-shrink: 0; }
    .role-seat-input {
      background: transparent; border: none; border-bottom: 1px solid #1a3a5a;
      color: #c9d1da; font-size: 13px; font-family: 'Inter', sans-serif;
      outline: none; width: 160px; padding: 2px 4px;
    }
    .role-seat-input::placeholder { color: #3a5a7a; }

    /* Phases */
    .phases { display: flex; overflow-x: auto; }
    .phase-item {
      flex: 1; min-width: 90px; position: relative;
      padding: 10px 16px 10px 28px;
      background: #0d1621; border: 1px solid #1a2a3a;
      font-size: 11px; color: #4a6fa5; white-space: nowrap;
    }
    .phase-item:first-child { border-radius: 6px 0 0 6px; padding-left: 16px; }
    .phase-item:last-child { border-radius: 0 6px 6px 0; }
    .phase-item:not(:first-child) { border-left: none; }
    .phase-item.active { background: rgba(29,78,216,0.2); border-color: #1d4ed8; color: #93c5fd; }
    .phase-item.done { background: rgba(22,163,74,0.1); border-color: rgba(22,163,74,0.3); color: #4ade80; }
    .phase-dot {
      position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
      width: 8px; height: 8px; border-radius: 50%; background: #1a2a3a;
    }
    .phase-item.active .phase-dot { background: #3b82f6; box-shadow: 0 0 6px #3b82f6; }
    .phase-item.done .phase-dot { background: #22c55e; }
    .phase-item:first-child .phase-dot { display: none; }

    /* Chat */
    .chat-area {
      display: flex; flex-direction: column;
      height: 460px; overflow-y: auto;
      gap: 12px; padding: 4px 4px 4px 0;
    }
    .chat-msg { display: flex; gap: 10px; }
    .chat-avatar {
      width: 30px; height: 30px; border-radius: 50%;
      background: linear-gradient(135deg, #1d4ed8, #0891b2);
      flex-shrink: 0; display: flex; align-items: center; justify-content: center;
      font-size: 12px; color: #fff; font-weight: 600;
    }
    .chat-avatar.ai { background: linear-gradient(135deg, #7c3aed, #0891b2); }
    .chat-body { flex: 1; min-width: 0; }
    .chat-meta { font-size: 11px; color: #3a5a80; margin-bottom: 3px; display: flex; align-items: center; gap: 8px; }
    .chat-text {
      background: #0d1e30; border: 1px solid #1a3050;
      border-radius: 6px; padding: 10px 13px;
      font-size: 13px; color: #b0c4da; line-height: 1.6; word-break: break-word;
    }
    .chat-text.ai-msg { border-color: rgba(124,58,237,0.3); background: rgba(124,58,237,0.06); }

    /* Voice button */
    .voice-btn {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 7px; border-radius: 3px; border: none; cursor: pointer;
      font-size: 11px; font-family: 'Share Tech Mono', monospace;
      background: rgba(255,255,255,0.04); color: #3a5a7a;
      transition: all 0.15s;
    }
    .voice-btn:hover { background: rgba(96,165,250,0.1); color: #60a5fa; }
    .voice-btn.speaking { background: rgba(124,58,237,0.15); color: #a78bfa; }

    /* Inject */
    .inject-item {
      border: 1px solid #1a2a3a; border-radius: 6px; padding: 14px;
      background: #0a1520; cursor: pointer; transition: border-color 0.15s;
    }
    .inject-item:hover { border-color: #2a4a7a; }
    .inject-title { font-size: 13px; font-weight: 600; color: #c9d4e0; margin-bottom: 4px; }
    .inject-text { font-size: 12px; color: #5a7a9a; line-height: 1.5; }
    .inject-badge { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 5px; }

    .participant-row {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 14px; border-radius: 6px;
      background: #0a1520; border: 1px solid #1a2a3a;
    }
    .participant-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; flex-shrink: 0; }
    .participant-name { flex: 1; font-size: 13px; color: #c9d1da; }
    .participant-role { font-size: 11px; color: #3a5a7a; font-family: 'Share Tech Mono', monospace; }

    .timeline { display: flex; flex-direction: column; }
    .tl-entry { display: flex; gap: 16px; }
    .tl-line { display: flex; flex-direction: column; align-items: center; }
    .tl-dot { width: 10px; height: 10px; border-radius: 50%; background: #1d4ed8; flex-shrink: 0; margin-top: 4px; }
    .tl-rule { flex: 1; width: 1px; background: #1a2a3a; margin: 4px 0; min-height: 16px; }
    .tl-body { padding-bottom: 18px; }
    .tl-time { font-size: 10px; font-family: 'Share Tech Mono', monospace; color: #3a5a7a; margin-bottom: 2px; }
    .tl-label { font-size: 13px; color: #c9d4e0; }
    .tl-detail { font-size: 12px; color: #4a6a8a; margin-top: 2px; }

    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner {
      width: 14px; height: 14px; border-radius: 50%;
      border: 2px solid rgba(96,165,250,0.3); border-top-color: #60a5fa;
      animation: spin 0.7s linear infinite; display: inline-block;
    }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
    .pulse { animation: pulse 1.8s ease-in-out infinite; }
    @keyframes wave { 0%,100% { transform: scaleY(0.4); } 50% { transform: scaleY(1.0); } }

    .section-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; gap: 12px; }
    .section-title { font-size: 18px; font-weight: 600; color: #e0eaff; }
    .section-sub { font-size: 13px; color: #4a6a8a; margin-top: 2px; }
    .divider { border: none; border-top: 1px solid #1a2a3a; margin: 14px 0; }
    .progress-bar { height: 4px; background: #1a2a3a; border-radius: 2px; overflow: hidden; }
    .progress-fill { height: 100%; background: linear-gradient(90deg, #1d4ed8, #0891b2); border-radius: 2px; transition: width 0.4s; }
    .metric-box { background: #0d1621; border: 1px solid #1a2a3a; border-radius: 8px; padding: 16px; text-align: center; }
    .metric-value { font-size: 28px; font-family: 'Share Tech Mono', monospace; color: #60a5fa; }
    .metric-label { font-size: 11px; color: #3a5a7a; margin-top: 4px; letter-spacing: 0.06em; text-transform: uppercase; }
    .hotkey {
      display: inline-block; padding: 1px 6px; border-radius: 3px;
      background: #1a2a3a; color: #4a6a8a; font-size: 10px;
      font-family: 'Share Tech Mono', monospace; border: 1px solid #2a3a4a;
    }
    .drop-zone {
      border: 2px dashed #1a3050; border-radius: 8px;
      padding: 28px; text-align: center; cursor: pointer;
      transition: border-color 0.15s, background 0.15s; background: #070d18;
    }
    .drop-zone:hover, .drop-zone.drag-over { border-color: #1d4ed8; background: rgba(29,78,216,0.06); }
    .drop-zone-label { font-size: 13px; color: #4a6a8a; line-height: 1.6; }

    /* Facilitator settings */
    .settings-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 18px; }
    .settings-label { font-size: 12px; color: #4a6fa5; font-family: 'Share Tech Mono', monospace; letter-spacing: 0.06em; }

    /* Confirmation modal */
    .modal-backdrop {
      position: fixed; inset: 0; z-index: 500;
      background: rgba(0,0,0,0.65); backdrop-filter: blur(3px);
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
    }
    .modal {
      background: #0d1621; border: 1px solid #1a2a3a; border-radius: 10px;
      padding: 28px 28px 24px; max-width: 420px; width: 100%;
      box-shadow: 0 24px 60px rgba(0,0,0,0.6);
    }
    .modal-icon { font-size: 32px; margin-bottom: 12px; }
    .modal-title { font-size: 16px; font-weight: 600; color: #e0eaff; margin-bottom: 8px; }
    .modal-body { font-size: 13px; color: #6b82a0; line-height: 1.6; margin-bottom: 24px; }
    .modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
    /* Tooltips */
    .tooltip-wrap { position: relative; display: inline-flex; align-items: center; }
    .tooltip-icon {
      width: 16px; height: 16px; border-radius: 50%;
      background: #1a2a3a; border: 1px solid #2a3a4a;
      color: #4a6a8a; font-size: 10px; font-weight: 700;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: default; margin-left: 6px; flex-shrink: 0; font-family: 'Inter', sans-serif;
      transition: background 0.15s, color 0.15s;
    }
    .tooltip-icon:hover { background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
    .tooltip-bubble {
      position: absolute; left: 24px; top: 50%; transform: translateY(-50%);
      background: #0a1520; border: 1px solid #1d4ed8;
      border-radius: 6px; padding: 10px 13px;
      width: 260px; font-size: 12px; color: #93afd4; line-height: 1.6;
      z-index: 400; pointer-events: none;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    }
    .tooltip-bubble strong { color: #e0eaff; display: block; margin-bottom: 4px; font-size: 12px; }
    /* Chat action buttons below AI messages */
    .msg-actions { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
    .msg-action-btn {
      padding: 3px 10px; border-radius: 4px; border: 1px solid #1a2a3a;
      background: rgba(255,255,255,0.03); color: #4a6a8a;
      font-size: 11px; font-family: 'Share Tech Mono', monospace;
      cursor: pointer; transition: all 0.15s; display: inline-flex; align-items: center; gap: 4px;
    }
    .msg-action-btn:hover { border-color: #ca8a04; color: #fbbf24; background: rgba(202,138,4,0.08); }
    .msg-action-btn.options-btn:hover { border-color: #60a5fa; color: #93c5fd; background: rgba(29,78,216,0.1); }
    .msg-action-btn.advance-btn {
      border-color: rgba(34,197,94,0.4); color: #4ade80;
      background: rgba(22,163,74,0.08);
    }
    .msg-action-btn.advance-btn:hover { border-color: #22c55e; color: #86efac; background: rgba(22,163,74,0.15); }
    /* Multiple choice option buttons */
    .mc-options { display: flex; flex-direction: column; gap: 8px; }
    .mc-option {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 11px 14px; border-radius: 6px; cursor: pointer;
      background: #0a1520; border: 1px solid #1a2a3a;
      font-size: 13px; color: #c9d1da; text-align: left;
      transition: border-color 0.15s, background 0.15s;
      width: 100%;
    }
    .mc-option:hover:not(:disabled) { border-color: #1d4ed8; background: rgba(29,78,216,0.1); color: #e0eaff; }
    .mc-option:disabled { opacity: 0.4; cursor: not-allowed; }
    .mc-option-label {
      flex-shrink: 0; width: 22px; height: 22px; border-radius: 4px;
      background: rgba(29,78,216,0.2); border: 1px solid #1d4ed8;
      color: #60a5fa; font-size: 11px; font-weight: 700;
      font-family: 'Share Tech Mono', monospace;
      display: flex; align-items: center; justify-content: center;
    }

    /* AAR skeleton shimmer */
    @keyframes shimmer {
      0% { background-position: -600px 0; }
      100% { background-position: 600px 0; }
    }
    .skeleton {
      background: linear-gradient(90deg, #0d1621 25%, #162030 50%, #0d1621 75%);
      background-size: 600px 100%;
      animation: shimmer 1.6s infinite linear;
      border-radius: 4px;
    }
    .skeleton-line { height: 13px; margin-bottom: 8px; }
    .skeleton-line-short { width: 40%; }
    .skeleton-line-med { width: 65%; }
    .skeleton-line-full { width: 100%; }
    .skeleton-block { height: 48px; border-radius: 6px; margin-bottom: 8px; }
    .skeleton-title { height: 10px; width: 120px; margin-bottom: 14px; }

    /* Landing page */
    .landing {
      min-height: calc(100vh - 56px);
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      padding: 48px 24px; text-align: center;
      background: radial-gradient(ellipse at 50% 0%, rgba(29,78,216,0.12) 0%, transparent 65%);
    }
    .landing-logo {
      width: 72px; height: 72px;
      background: linear-gradient(135deg, #0d6efd, #00d4ff);
      border-radius: 16px; display: flex; align-items: center;
      justify-content: center; font-size: 36px;
      margin: 0 auto 28px; box-shadow: 0 0 40px rgba(13,110,253,0.35);
    }
    .landing-wordmark {
      font-family: 'Share Tech Mono', monospace; font-size: 36px;
      letter-spacing: 0.12em; color: #e0eaff; margin-bottom: 6px;
    }
    .landing-tagline {
      font-size: 16px; color: #4a6fa5; margin-bottom: 12px;
      font-weight: 400; max-width: 480px; line-height: 1.5;
    }
    .landing-description {
      font-size: 14px; color: #3a5570; max-width: 520px;
      line-height: 1.75; margin-bottom: 40px;
    }
    .landing-features {
      display: flex; gap: 12px; justify-content: center;
      flex-wrap: wrap; margin-bottom: 48px; max-width: 640px;
    }
    .landing-feature {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 14px; border-radius: 20px;
      background: rgba(255,255,255,0.03); border: 1px solid #1a2a3a;
      font-size: 12px; color: #4a6a8a; white-space: nowrap;
    }
    .landing-feature-icon { font-size: 14px; }
    .landing-divider {
      width: 1px; height: 48px; background: linear-gradient(to bottom, transparent, #1a2a3a, transparent);
      margin: 0 auto 48px;
    }
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .fade-up { animation: fadeUp 0.5s ease forwards; }
    .fade-up-delay-1 { animation-delay: 0.1s; opacity: 0; }
    .fade-up-delay-2 { animation-delay: 0.2s; opacity: 0; }
    .fade-up-delay-3 { animation-delay: 0.35s; opacity: 0; }
    .fade-up-delay-4 { animation-delay: 0.5s; opacity: 0; }

    /* Footer */
    .footer {
      border-top: 1px solid #1a2a3a;
      background: #0a0f18;
      padding: 14px 24px;
      display: flex; align-items: center; justify-content: space-between;
      flex-wrap: wrap; gap: 10px;
    }
    .footer-left { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .footer-attr {
      font-size: 11px; color: #2a4060;
      font-family: 'Share Tech Mono', monospace; letter-spacing: 0.05em;
    }
    .footer-attr a { color: #3a5a80; text-decoration: none; }
    .footer-attr a:hover { color: #60a5fa; }
    .footer-feedback {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 12px; border-radius: 5px;
      border: 1px solid #1a2a3a; background: rgba(255,255,255,0.02);
      color: #4a6a8a; font-size: 11px; font-family: 'Share Tech Mono', monospace;
      text-decoration: none; letter-spacing: 0.04em;
      transition: border-color 0.15s, color 0.15s, background 0.15s;
    }
    .footer-feedback:hover {
      border-color: #dc2626; color: #f87171;
      background: rgba(220,38,38,0.08);
    }

    /* Voice waveform animation */
    .wave-bar {
      width: 3px; background: #a78bfa; border-radius: 2px;
      animation: wave 0.8s ease-in-out infinite;
    }
    .wave-bar:nth-child(2) { animation-delay: 0.15s; }
    .wave-bar:nth-child(3) { animation-delay: 0.3s; }
    .wave-bar:nth-child(4) { animation-delay: 0.15s; }
  `}</style>
);

// ── Topbar ────────────────────────────────────────────────────
function Topbar({ sessionName, stopped, finalDuration }) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());
  useEffect(() => {
    if (!sessionName || stopped) return;
    startRef.current = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [sessionName, stopped]);
  const displayTime = stopped ? finalDuration : elapsed;
  const fmt = s => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return (
    <div className="topbar no-print">
      <div className="topbar-brand">
        <div className="topbar-logo">🛡</div>
        <div>
          <div className="topbar-title">TACTICIAN</div>
          <div className="topbar-subtitle">Cybersecurity Tabletop Platform</div>
        </div>
      </div>
      <div className="topbar-right">
        {sessionName && <>
          <span className="mono" style={{ fontSize: 12, color: "#4a6a8a" }}>SESSION</span>
          <span className="mono" style={{ fontSize: 13, color: "#7cb3f5" }}>{sessionName}</span>
          <span style={{ color: "#1a2a3a" }}>|</span>
          <span className="mono" style={{ fontSize: 13, color: stopped ? "#4a6a8a" : "#4ade80" }}>{fmt(displayTime)}</span>
          {stopped
            ? <span className="badge" style={{ background: "rgba(74,106,138,0.15)", color: "#4a6a8a", border: "1px solid rgba(74,106,138,0.3)" }}>COMPLETE</span>
            : <span className="badge badge-live"><span className="pulse">●</span> LIVE</span>}
        </>}
      </div>
    </div>
  );
}

// ── Playbook Upload ───────────────────────────────────────────
function PlaybookUpload({ onParsed }) {
  const [status, setStatus] = useState("idle");
  const [parsedPlaybook, setParsedPlaybook] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [mode, setMode] = useState("file");
  const fileRef = useRef();

  const parseWithClaude = async (contentBlocks) => {
    setStatus("parsing");
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6", max_tokens: 1000,
          system: `You are a cybersecurity expert parsing an incident response playbook. Respond ONLY with valid JSON — no markdown, no preamble.
JSON shape: { "name": string, "phases": string[], "summary": string }
Extract actual phase/step names from the document. If unclear, infer sensible IR phases.`,
          messages: [{ role: "user", content: [...contentBlocks, { type: "text", text: "Parse this playbook and return the JSON." }] }]
        })
      });
      const data = await resp.json();
      const raw = data.content?.find(b => b.type === "text")?.text || "{}";
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      setParsedPlaybook(parsed);
      setStatus("done");
      onParsed({ ...parsed, type: "custom", id: "custom" });
    } catch {
      setStatus("error");
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "pdf") {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(file);
      });
      await parseWithClaude([{ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }]);
    } else {
      const text = await file.text();
      await parseWithClaude([{ type: "text", text: text.slice(0, 8000) }]);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button className={`btn btn-sm ${mode === "file" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("file")}>📎 Upload File</button>
        <button className={`btn btn-sm ${mode === "paste" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("paste")}>📋 Paste Text</button>
      </div>
      {mode === "file" && (
        <div className={`drop-zone${dragOver ? " drag-over" : ""}`}
          onClick={() => fileRef.current.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>{status === "done" ? "✅" : status === "parsing" ? "⏳" : "📄"}</div>
          <div className="drop-zone-label">
            {status === "idle" && <><strong style={{ color: "#c9d4e0" }}>Drop your playbook here</strong><br />PDF or TXT · Claude extracts phases automatically</>}
            {status === "parsing" && <><span className="spinner" style={{ verticalAlign: "middle" }} /> <strong style={{ color: "#93c5fd" }}>Claude is reading your playbook…</strong></>}
            {status === "done" && <strong style={{ color: "#4ade80" }}>Playbook parsed — phases extracted</strong>}
            {status === "error" && <strong style={{ color: "#f87171" }}>Parse failed — try again or paste text</strong>}
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.txt,.md" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
        </div>
      )}
      {mode === "paste" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea placeholder="Paste your playbook text here…" value={pasteText} onChange={e => setPasteText(e.target.value)} style={{ minHeight: 120 }} />
          <button className="btn btn-primary btn-sm" disabled={!pasteText.trim() || status === "parsing"}
            onClick={() => parseWithClaude([{ type: "text", text: pasteText.slice(0, 8000) }])}>
            {status === "parsing" ? <><span className="spinner" /> Parsing…</> : "✦ Parse with Claude"}
          </button>
        </div>
      )}
      {parsedPlaybook && (
        <div style={{ background: "#070d18", border: "1px solid #1a3050", borderRadius: 6, padding: 12 }}>
          <div style={{ fontWeight: 600, color: "#e0eaff", marginBottom: 4 }}>{parsedPlaybook.name}</div>
          <div style={{ fontSize: 12, color: "#5a7a9a", marginBottom: 8 }}>{parsedPlaybook.summary}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {parsedPlaybook.phases?.map((p, i) => <span key={i} className="tag">Phase {i + 1}: {p}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tooltip ───────────────────────────────────────────────────
function Tooltip({ children }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="tooltip-wrap"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      <div className="tooltip-icon" tabIndex={0} aria-label="More info">?</div>
      {visible && <div className="tooltip-bubble">{children}</div>}
    </div>
  );
}

// ── Facilitator Settings ──────────────────────────────────────
function FacilitatorSettings({ config, onChange, scenario, playbook, participants }) {
  const FOCUS_AREAS = ["Technical", "Legal / Compliance", "Communications", "Executive Decision-Making", "Vendor Management"];
  const toggle = (arr, val) => arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];
  const [showPrompt, setShowPrompt] = useState(false);

  const previewPrompt = buildSystemPrompt(
    config,
    scenario || { name: "[Scenario]", description: "[Scenario description]" },
    playbook || { name: "[Playbook]" },
    "[Current Phase]",
    participants || [{ name: "", role: "[Role]" }],
    0,
    config.maxTurns
  );

  const TONE_INFO = {
    conversational: { label: "💬 Conversational", tip: <><strong>Conversational</strong>Warmer, more approachable language. Good for teams new to tabletops or when psychological safety is a priority.</> },
    professional: { label: "🎩 Professional", tip: <><strong>Professional</strong>Claude communicates with formal, structured language — appropriate for exec-level exercises or compliance-driven drills where tone matters.</> },
    intense: { label: "⚡ High-Pressure", tip: <><strong>High-Pressure</strong>Urgent, real-time language — as though the incident is actively unfolding. Best for experienced teams who want an immersive, stressful simulation.</> },
  };
  const DIFF_INFO = {
    light: { label: "🟢 Introductory", tip: <><strong>Introductory</strong>Wrong decisions surface gently. Hints are generous. Good for teams running their first tabletop or learning a new playbook.</> },
    moderate: { label: "🟡 Moderate", tip: <><strong>Moderate</strong>Wrong calls play out realistically before consequences are surfaced. Hints are available but not overly detailed. Assumes working IR knowledge.</> },
    rigorous: { label: "🔴 Rigorous", tip: <><strong>Rigorous</strong>Mistakes compound quickly with no softening. Hints are minimal and Socratic. Designed for experienced IR teams stress-testing their playbook.</> },
  };
  const PROBE_INFO = {
    gentle: { label: "🤝 Supportive", tip: <><strong>Supportive</strong>Claude waits for the team to act and gives them space. Responds only when they take an action or ask a question — minimal interruption.</> },
    balanced: { label: "⚖️ Balanced", tip: <><strong>Balanced</strong>Responds to decisions with realistic scenario developments. Surfaces gaps as events rather than corrections. Default for most exercises.</> },
    aggressive: { label: "🔍 High-Stakes", tip: <><strong>High-Stakes</strong>Wrong decisions escalate the situation quickly and without mercy. Missed critical steps compound into visible, cascading failures.</> },
  };
  const TURN_PACE_INFO = {
    relaxed: { label: "🐢 Relaxed", tip: <><strong>Relaxed (default: 6 turns)</strong>Gives the team more room to deliberate before the phase auto-advances. Good for newer teams or dense phases.</> },
    standard: { label: "⏱️ Standard", tip: <><strong>Standard (default: 4 turns)</strong>Balanced pacing that fits most exercises — enough room to work a phase without stalling.</> },
    tight: { label: "⚡ Tight", tip: <><strong>Tight (default: 2 turns)</strong>Forces rapid decisions. Best for experienced teams or time-boxed sessions.</> },
  };
  const FOCUS_TIPS = {
    "Technical": "Evaluates decisions around containment tooling, log analysis, forensic preservation, and technical IR procedures.",
    "Legal / Compliance": "Watches for regulatory notification timelines (GDPR, HIPAA, SEC), chain-of-custody requirements, and legal hold obligations.",
    "Communications": "Tracks internal escalation paths, external disclosure decisions, media handling, and stakeholder messaging.",
    "Executive Decision-Making": "Focuses on how leadership is briefed, what decisions require executive sign-off, and business impact framing.",
    "Vendor Management": "Monitors third-party notification obligations, vendor IR coordination, and supply chain considerations.",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>

      {/* TONE */}
      <div className="settings-row">
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <div className="settings-label" style={{ marginBottom: 0 }}>TONE</div>
          <Tooltip><strong>Tone</strong>Controls the language register Claude uses throughout the exercise — how it presents scenarios, delivers consequences, and frames the situation.</Tooltip>
        </div>
        <div className="pill-group">
          {Object.entries(TONE_INFO).map(([v, { label, tip }]) => (
            <div key={v} style={{ display: "inline-flex", alignItems: "center" }}>
              <div className={`pill${config.tone === v ? " active" : ""}`} onClick={() => onChange({ ...config, tone: v })}>{label}</div>
              <Tooltip>{tip}</Tooltip>
            </div>
          ))}
        </div>
      </div>

      {/* DIFFICULTY */}
      <div className="settings-row">
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <div className="settings-label" style={{ marginBottom: 0 }}>DIFFICULTY</div>
          <Tooltip><strong>Difficulty</strong>Controls how wrong decisions play out — how hard consequences hit, how generous hints are, and how much tolerance Claude has for vague or incomplete responses.</Tooltip>
        </div>
        <div className="pill-group">
          {Object.entries(DIFF_INFO).map(([v, { label, tip }]) => (
            <div key={v} style={{ display: "inline-flex", alignItems: "center" }}>
              <div className={`pill${config.difficulty === v ? " active" : ""}`} onClick={() => onChange({ ...config, difficulty: v })}>{label}</div>
              <Tooltip>{tip}</Tooltip>
            </div>
          ))}
        </div>
      </div>

      {/* PACING */}
      <div className="settings-row">
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <div className="settings-label" style={{ marginBottom: 0 }}>PACING</div>
          <Tooltip><strong>Pacing</strong>Controls how aggressively the simulation reacts to team decisions. Gentle gives breathing room; High-Stakes means every missed step has an immediate visible impact.</Tooltip>
        </div>
        <div className="pill-group">
          {Object.entries(PROBE_INFO).map(([v, { label, tip }]) => (
            <div key={v} style={{ display: "inline-flex", alignItems: "center" }}>
              <div className={`pill${config.probing === v ? " active" : ""}`} onClick={() => onChange({ ...config, probing: v })}>{label}</div>
              <Tooltip>{tip}</Tooltip>
            </div>
          ))}
        </div>
      </div>

      {/* TURN LIMIT PER PHASE */}
      <div className="settings-row">
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <div className="settings-label" style={{ marginBottom: 0 }}>TURN LIMIT PER PHASE</div>
          <Tooltip><strong>Turn Limit Per Phase</strong>Caps how many participant turns can occur before the phase automatically advances, so teams can't stall indefinitely in one phase. Each pace tier has a sensible default, which can be overridden.</Tooltip>
        </div>
        <div className="pill-group">
          {Object.entries(TURN_PACE_INFO).map(([v, { label, tip }]) => (
            <div key={v} style={{ display: "inline-flex", alignItems: "center" }}>
              <div className={`pill${config.turnPace === v ? " active" : ""}`}
                onClick={() => onChange({ ...config, turnPace: v, maxTurns: PACE_TURN_DEFAULTS[v] })}>{label}</div>
              <Tooltip>{tip}</Tooltip>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <label style={{ margin: 0, fontSize: 12, color: "#7a9ab5" }}>Max turns before auto-advance:</label>
          <input type="number" min={1} max={20} value={config.maxTurns}
            onChange={e => onChange({ ...config, maxTurns: Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
            style={{ width: 64, textAlign: "center" }} />
          {config.maxTurns !== PACE_TURN_DEFAULTS[config.turnPace] && (
            <button className="btn btn-ghost btn-sm" onClick={() => onChange({ ...config, maxTurns: PACE_TURN_DEFAULTS[config.turnPace] })}>
              ↺ Reset to default ({PACE_TURN_DEFAULTS[config.turnPace]})
            </button>
          )}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: "#2a4a6a" }}>
          Default for {TURN_PACE_INFO[config.turnPace].label.replace(/^\S+\s/, "")}: {PACE_TURN_DEFAULTS[config.turnPace]} turns. Relaxed: 6 · Standard: 4 · Tight: 2. Custom values persist until reset.
        </div>
      </div>

      {/* FOCUS AREAS */}
      <div className="settings-row">
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <div className="settings-label" style={{ marginBottom: 0 }}>FOCUS AREAS <span style={{ color: "#2a4a6a", fontWeight: 400 }}>(optional)</span></div>
          <Tooltip><strong>Focus Areas</strong>Tells Claude which dimensions to track closely when evaluating team decisions. Multiple can be selected. Leave blank for a balanced exercise.</Tooltip>
        </div>
        <div className="pill-group">
          {FOCUS_AREAS.map(v => (
            <div key={v} style={{ display: "inline-flex", alignItems: "center" }}>
              <div className={`pill${config.focusAreas.includes(v) ? " active-multi" : ""}`}
                onClick={() => onChange({ ...config, focusAreas: toggle(config.focusAreas, v) })}>{v}</div>
              <Tooltip><strong>{v}</strong>{FOCUS_TIPS[v]}</Tooltip>
            </div>
          ))}
        </div>
      </div>

      {/* Prompt preview */}
      <div className="settings-row">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div className="settings-label" style={{ marginBottom: 0 }}>SYSTEM PROMPT SENT TO CLAUDE</div>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowPrompt(v => !v)} style={{ fontSize: 11 }}>
            {showPrompt ? "Hide ▲" : "Preview ▼"}
          </button>
        </div>
        {showPrompt && (
          <div style={{
            background: "#040a12", border: "1px solid #1a3050", borderRadius: 6,
            padding: "12px 14px", fontFamily: "'Share Tech Mono', monospace",
            fontSize: 11, color: "#5a8ab0", lineHeight: 1.8,
            whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 260, overflowY: "auto"
          }}>
            {previewPrompt}
          </div>
        )}
      </div>

      {/* Custom instructions */}
      <div className="settings-row" style={{ marginBottom: 0 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <div className="settings-label" style={{ marginBottom: 0 }}>ADDITIONAL INSTRUCTIONS</div>
          <Tooltip><strong>Additional Instructions</strong>Free-text appended verbatim to the system prompt. Use for org-specific tools (e.g. Sentinel, CrowdStrike), policies, regulatory context, or any constraint the AI facilitator should know about.</Tooltip>
        </div>
        <div style={{ position: "relative" }}>
          <textarea
            value={config.customInstructions}
            onChange={e => onChange({ ...config, customInstructions: e.target.value })}
            style={{ minHeight: 108, fontSize: 13, paddingBottom: config.customInstructions ? 8 : 90 }}
          />
          {!config.customInstructions && (
            <div style={{ position: "absolute", top: 10, left: 12, right: 12, pointerEvents: "none", userSelect: "none" }}>
              <div style={{ fontSize: 11, color: "#2a4060", fontStyle: "italic", marginBottom: 6, letterSpacing: "0.03em" }}>
                — Examples (click to type your own) —
              </div>
              {[
                "Always ask about regulatory notification timelines.",
                "Assume participants are new to IR — explain concepts before questioning.",
                "Our org uses Microsoft Sentinel and CrowdStrike — reference these tools.",
              ].map((ex, i) => (
                <div key={i} style={{ fontSize: 11, color: "#1e3a5a", fontStyle: "italic", padding: "2px 0", display: "flex", alignItems: "flex-start", gap: 5 }}>
                  <span style={{ color: "#1a3050", flexShrink: 0 }}>•</span>
                  <span>{ex}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: "#2a4a6a" }}>
          Appended verbatim to the system prompt. Use for org-specific tools, policies, or constraints.
        </div>
      </div>
    </div>
  );
}

// Build system prompt from facilitator config
function buildSystemPrompt(config, scenario, playbook, phase, participants, turnsInPhase = 0, maxTurns = config.maxTurns) {
  const toneMap = {
    professional: "formal and authoritative",
    conversational: "warm and approachable",
    intense: "urgent and high-pressure, as if this is a real incident unfolding in real time",
  };
  const diffMap = {
    light: "beginner-friendly — when participants make a wrong call, surface consequences gently; when they ask for a hint, be generous with direction",
    moderate: "assume working IR knowledge — let wrong decisions play out before surfacing consequences; hints should nudge without over-explaining",
    rigorous: "expert-level — wrong decisions carry full realistic consequences with no softening; hints are minimal and Socratic",
  };
  const probMap = {
    gentle: "give the team space and time to think; only respond when they take an action or ask a question",
    balanced: "respond to their decisions with realistic consequences; surface gaps as scenario developments rather than corrections",
    aggressive: "wrong decisions compound quickly — escalate the situation realistically and without mercy when the team misses critical steps",
  };
  const focus = config.focusAreas.length
    ? `\nPay particular attention to these dimensions when evaluating team decisions: ${config.focusAreas.join(", ")}.`
    : "";
  const custom = config.customInstructions.trim()
    ? `\n\nAdditional facilitator instructions:\n${config.customInstructions}`
    : "";
  const turnBudget = `\n\nTURN BUDGET: This phase is capped at ${maxTurns} participant turn(s) (currently on turn ${Math.min(turnsInPhase + 1, maxTurns)} of ${maxTurns}). As the team approaches this limit, prioritize wrapping up — if objectives are reasonably met, append [ADVANCE_PHASE] rather than waiting for a perfect resolution. If the limit is reached without [ADVANCE_PHASE] having been used, the app will auto-advance the phase regardless.`;

  return `You are an expert cybersecurity tabletop exercise facilitator. Your role is to simulate a realistic incident and respond to the team's decisions — not to lead or prompt them.

SCENARIO: ${scenario.name}. ${scenario.description}
PLAYBOOK: ${playbook.name}. Current phase: ${phase}.
PARTICIPANTS: ${participants.map(p => `${p.name || p.role} (${p.role})`).join(", ")}.

CORE BEHAVIOR:
- Let the team drive. Do not ask leading questions or suggest what they should do next. Respond to what they say, not what you wish they'd said.
- Evaluate every decision against the ${playbook.name} framework silently. If the team takes a correct action, acknowledge it briefly and advance the simulation's state with a new development.
- If the team makes an incorrect or incomplete decision, do not correct them directly. Let the simulation consequences play out — introduce a realistic complication that results from their choice (e.g. delayed containment leads to lateral spread, missed notification triggers a regulatory issue).
- If the team misses a critical step and moves on, surface the gap as a scenario event: "Meanwhile, [consequence of the missed step] has now occurred."
- Never volunteer the right answer. Never ask "have you considered X?" unless they have explicitly asked for a hint.
- Keep responses under 150 words unless delivering a major scenario development.
- End EVERY response with a single short line on its own that invites action — e.g. "What is your team's next action?" or "How does your team respond?" or "The clock is ticking — what do you do?" Vary the phrasing; never repeat the same closing line twice in a row.
- When the team has sufficiently addressed the key objectives of the current phase — demonstrated sound decision-making, covered the critical steps, and shown readiness to move forward — append the exact marker [ADVANCE_PHASE] on its own line at the very end of your response (after the closing action question). Do not append it prematurely; only when the phase is genuinely complete. Do not explain or mention the marker — the app handles it silently. If the team continues discussing after you have already suggested advancing, you may repeat the [ADVANCE_PHASE] marker in subsequent responses if the phase objectives remain met.

HINT MODE:
- If a participant explicitly asks for a hint, help, direction, or says they are stuck, briefly shift into hint mode: acknowledge the request, then offer one directional nudge grounded in ${playbook.name} — not the answer, just a pointer toward the right area of thinking. Return to observer mode immediately after.
- Example hint format: "Your ${playbook.name} playbook's ${phase} guidance focuses on [area] — has the team addressed that yet?"
- If a participant asks for multiple choice options, respond with a single short sentence acknowledging the request (e.g. "Here are your options — choose your team's next action." or "Select the action your team will take."), then immediately follow with the option lines and nothing else. Include 4 options total: 2-3 that are appropriate for the current phase, and 1-2 that are plausible-sounding but either belong to a different phase, are premature, or are common actions in other incident types. Do not indicate which options are correct. Do NOT write the options as plain text, numbered lists, or lettered lists anywhere in your response — ONLY use the [OPTION_X] format below, as the app renders these as buttons and any plain-text repetition will be shown to the user as duplicate content. Format each option on its own line exactly like this:
  [OPTION_A] Brief action description
  [OPTION_B] Brief action description
  [OPTION_C] Brief action description
  [OPTION_D] Brief action description
  After the team picks one, evaluate their choice and continue the simulation from that decision.

MULTI-ROLE RESPONSES:
- A single message may contain responses from multiple roles at once, each line labeled "RoleName (Role Title): response". When this happens, address each role individually and clearly — using the format "To [Role]: ..." for each one — before offering a single shared closing question at the end.

Tone: ${toneMap[config.tone]}.
Difficulty: ${diffMap[config.difficulty]}.
Pacing: ${probMap[config.probing]}.${focus}${custom}${turnBudget}`;
}

// Format a set of simultaneous per-role responses into a single labeled block
function formatMultiRoleMessage(responses) {
  return responses
    .filter(r => r.text.trim())
    .map(r => `${r.name || r.role} (${r.role}): ${r.text.trim()}`)
    .join("\n\n");
}

// ── Footer ────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="footer">
      <div className="footer-left">
        <span className="footer-attr">
          Created with <a href="https://claude.ai" target="_blank" rel="noreferrer">Claude AI</a> · Anthropic
        </span>
        <span className="footer-attr" style={{ color: "#1a2a3a" }}>|</span>
        <span className="footer-attr">
          Tactician v1.0 · UNLV Cybersecurity
        </span>
      </div>
      <a
        className="footer-feedback"
        href="https://github.com/Jensen-UNLV/Cybersecurity-AI-Table-Top-Exercise/issues"
        target="_blank"
        rel="noreferrer"
        title="Report a bug or suggest a feature on GitHub"
      >
        🐛 Report a Bug / Give Feedback
      </a>
    </footer>
  );
}

// ── Landing Page ──────────────────────────────────────────────
function LandingPage({ onBegin }) {
  return (
    <div className="landing">
      {/* Logo */}
      <div className="landing-logo fade-up">🛡</div>

      {/* Wordmark + tagline */}
      <div className="landing-wordmark fade-up fade-up-delay-1">TACTICIAN</div>
      <div className="landing-tagline fade-up fade-up-delay-1">
        AI-Powered Cybersecurity Tabletop Exercise Platform
      </div>

      {/* Description */}
      <div className="landing-description fade-up fade-up-delay-2">
        Run realistic incident response drills against industry-standard playbooks
        or your own. An AI facilitator sets the scene, adapts to your team's
        decisions, and generates a structured after-action report when you're done.
      </div>

      {/* Feature pills */}
      <div className="landing-features fade-up fade-up-delay-3">
        {[
          ["🔒", "6 Scenario Types"],
          ["📋", "CISA & NIST Playbooks"],
          ["🤖", "AI Facilitation"],
          ["⚡", "Live Injects"],
          ["💡", "Adaptive Hints"],
          ["📊", "After-Action Reports"],
        ].map(([icon, label]) => (
          <div key={label} className="landing-feature">
            <span className="landing-feature-icon">{icon}</span>
            {label}
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="fade-up fade-up-delay-4">
        <button
          className="btn btn-primary"
          onClick={onBegin}
          style={{
            fontSize: 15, padding: "13px 36px", borderRadius: 8,
            boxShadow: "0 0 24px rgba(29,78,216,0.4)",
            letterSpacing: "0.03em",
          }}
        >
          Begin Exercise →
        </button>
      </div>
    </div>
  );
}

// ── Reroll Modal ──────────────────────────────────────────────
function RerollModal({ onKeepCurrent, onReroll }) {
  const [rerolling, setRerolling] = useState(false);
  const [btnIcon, setBtnIcon] = useState("🎲");

  const handleBackdrop = (e) => { if (e.target === e.currentTarget && !rerolling) onKeepCurrent(); };

  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape" && !rerolling) onKeepCurrent(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [rerolling]);

  const handleReroll = () => {
    if (rerolling) return;
    setRerolling(true);
    // Animate the button icon cycling through scenario icons
    const icons = ["🎲", ...SCENARIOS.map(s => s.icon)];
    let tick = 0;
    const iv = setInterval(() => { setBtnIcon(icons[tick % icons.length]); tick++; }, 100);
    setTimeout(() => {
      clearInterval(iv);
      setBtnIcon("✓");
      onReroll();
    }, 1000);
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdrop}>
      <div className="modal">
        <div className="modal-icon">🎲</div>
        <div className="modal-title">Pick a new random scenario?</div>
        <div className="modal-body">
          A scenario has already been secretly selected for your team. Choose an option below.
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" disabled={rerolling} onClick={onKeepCurrent}>
            Keep Current &amp; Continue →
          </button>
          <button
            className="btn"
            disabled={rerolling}
            onClick={handleReroll}
            style={{
              background: "rgba(202,138,4,0.2)", color: "#fbbf24",
              border: "1px solid rgba(202,138,4,0.4)", minWidth: 160,
              display: "inline-flex", alignItems: "center",
              justifyContent: "center", gap: 6,
            }}
          >
            {rerolling
              ? <><span style={{ fontSize: 16, lineHeight: 1 }}>{btnIcon}</span> Re-randomizing…</>
              : <><span style={{ fontSize: 16, lineHeight: 1 }}>🎲</span> Yes, Re-randomize</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Randomizer Card ───────────────────────────────────────────
function RandomizerCard({ onSelect, isSelected, onContinue }) {
  const [spinning, setSpinning] = useState(false);
  const [displayIcon, setDisplayIcon] = useState("🎲");
  const [confirmReroll, setConfirmReroll] = useState(false);
  const intervalRef = useRef(null);
  const isSelectedRef = useRef(isSelected);

  // Keep ref in sync without triggering spin-stop side effect
  useEffect(() => { isSelectedRef.current = isSelected; }, [isSelected]);

  const prevIsSelected = useRef(isSelected);

  // When parent clears isSelected (true→false), stop spin and reset
  // When parent sets isSelected (false→true from back-nav), just reset icon
  useEffect(() => {
    const prev = prevIsSelected.current;
    prevIsSelected.current = isSelected;
    if (prev && !isSelected && spinning) {
      // User picked a different scenario — stop the spin
      setSpinning(false);
      setDisplayIcon("🎲");
      clearInterval(intervalRef.current);
    } else if (isSelected && !spinning) {
      // Restored via back navigation
      setDisplayIcon("🎲");
    }
  }, [isSelected]);

  // Clean up interval on unmount
  useEffect(() => () => clearInterval(intervalRef.current), []);

  const startSpin = (pick) => {
    setSpinning(true);
    let tick = 0;
    const icons = SCENARIOS.map(s => s.icon);
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setDisplayIcon(icons[tick % icons.length]);
      tick++;
    }, 80);
    onSelect(pick);
  };

  const handleClick = () => {
    if (spinning) return;
    // If already selected, ask for confirmation before re-rolling
    if (isSelected) {
      setConfirmReroll(true);
      return;
    }
    const pick = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
    startSpin(pick);
  };


  return (
    <>
      <div
        className={`scenario-card${isSelected && !spinning ? " selected" : ""}`}
        onClick={handleClick}
        style={{
          borderStyle: isSelected && !spinning ? "solid" : "dashed",
          borderColor: spinning ? "#ca8a04" : isSelected ? "#60a5fa" : "#1a3a5a",
          background: spinning
            ? "rgba(202,138,4,0.05)"
            : isSelected
            ? "rgba(96,165,250,0.06)"
            : "rgba(29,78,216,0.03)",
          cursor: spinning ? "default" : "pointer",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          minHeight: 80,
          transition: "border-color 0.3s, background 0.3s",
        }}
      >
        <div style={{
          fontSize: spinning ? 36 : 28,
          marginBottom: 8,
          transition: "font-size 0.1s",
          filter: spinning ? "blur(1.5px)" : "none",
        }}>
          {displayIcon}
        </div>
        <div className="scenario-name" style={{
          color: spinning ? "#ca8a04" : isSelected ? "#e0eaff" : "#7cb3f5",
        }}>
          {spinning ? "Randomizing…" : isSelected ? "Surprise Me ✓" : "Surprise Me"}
        </div>
        <div className="scenario-desc" style={{ marginTop: 6 }}>
          {spinning
            ? "Your scenario is being selected — click Continue when ready…"
            : isSelected
            ? "A scenario has been secretly selected. Click Continue to proceed, or click here to pick a new random scenario."
            : "Feeling bold? Let the platform secretly choose your scenario. The team won't know what they're facing until the exercise starts."}
        </div>
        <div style={{ marginTop: 10 }}>
          <span className="tag" style={{
            background: isSelected && !spinning ? "rgba(96,165,250,0.15)" : "rgba(29,78,216,0.12)",
            color: isSelected && !spinning ? "#93c5fd" : "#60a5fa",
            border: isSelected && !spinning ? "1px solid rgba(96,165,250,0.3)" : "1px solid rgba(29,78,216,0.3)",
          }}>
            🎲 {isSelected && !spinning ? "Randomized" : "Random"}
          </span>
        </div>
        {/* Continue button — shown once a scenario is locked in (spinning or settled) */}
        {(isSelected || spinning) && onContinue && (
          <button
            className="btn btn-primary"
            style={{ marginTop: 12, width: "100%" }}
            onClick={e => { e.stopPropagation(); onContinue(); }}
          >
            {spinning ? "Continue →" : "Continue →"}
          </button>
        )}
      </div>

      {/* Re-roll confirmation — bespoke modal with animated re-randomize button */}
      {confirmReroll && (
        <RerollModal
          onKeepCurrent={() => { setConfirmReroll(false); if (onContinue) onContinue(); }}
          onReroll={() => {
            setConfirmReroll(false);
            // Pick a new scenario silently — no card animation, navigate directly
            const pick = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
            onSelect(pick); // update parent state with new pick
            if (onContinue) onContinue();
          }}
        />
      )}
    </>
  );
}

// ── Setup Flow ────────────────────────────────────────────────
function ParticipantSetup({ onStart, lastPlayed }) {
  const [step, setStep] = useState(0);
  const [usedRandomizer, setUsedRandomizer] = useState(false);
  const [selected, setSelected] = useState({
    scenario: null, playbook: null,
    participants: ROLES.map(role => ({ role, name: "", id: role, active: role === "Facilitator" })),
    sessionName: "",
    facilitatorConfig: { ...DEFAULT_FACILITATOR },
  });

  // Auto-fill session name when scenario chosen
  const selectScenario = (sc) => {
    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    setUsedRandomizer(false); // manual pick clears randomizer flag
    setSelected(s => ({
      ...s, scenario: sc,
      sessionName: s.sessionName || `${sc.name} TTX — ${date}`,
    }));
  };

  const updateParticipant = (id, field, value) =>
    setSelected(s => ({ ...s, participants: s.participants.map(p => p.id === id ? { ...p, [field]: value } : p) }));

  const toggleSeat = (id) =>
    setSelected(s => ({ ...s, participants: s.participants.map(p => p.id === id ? { ...p, active: !p.active } : p) }));

  const activeParticipants = selected.participants.filter(p => p.active);

  // Compute synchronously — no hooks, no deferred evaluation
  const canProceed = (() => {
    if (step === 0) return !!selected.scenario;
    if (step === 1) return !!selected.playbook;
    if (step === 2) return activeParticipants.length > 0 && !!selected.sessionName.trim();
    return true;
  })();

  const STEPS = ["Select Scenario", "Choose Playbook", "Participants", "AI Facilitator"];

  return (
    <div className="main">
      {/* Stepper */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 28, flexWrap: "wrap" }}>
        {STEPS.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 26, height: 26, borderRadius: "50%",
              background: i < step ? "#22c55e" : i === step ? "#1d4ed8" : "#1a2a3a",
              color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 600, flexShrink: 0,
            }}>{i < step ? "✓" : i + 1}</div>
            <span style={{ fontSize: 13, color: i === step ? "#e0eaff" : "#3a5a7a" }}>{s}</span>
            {i < STEPS.length - 1 && <span style={{ color: "#1a2a3a", fontSize: 16, margin: "0 4px" }}>›</span>}
          </div>
        ))}
      </div>

      {/* ── Step 0: Scenario ── */}
      {step === 0 && (
        <>
          <div className="section-header" style={{ display: "block", textAlign: "center" }}>
            <div><div className="section-title">Choose a Scenario</div><div className="section-sub">Select the incident type your team will practice, or let the platform choose for you.</div></div>
          </div>

          {/* Randomizer — full width, above the regular options */}
          <div style={{ marginBottom: 20 }}>
            <RandomizerCard
              isSelected={usedRandomizer}
              onSelect={(sc) => {
                const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                setUsedRandomizer(true);
                setSelected(s => ({ ...s, scenario: sc, sessionName: s.sessionName || `TTX — ${date}` }));
              }}
              onContinue={() => { setStep(1); window.scrollTo({ top: 0, behavior: "instant" }); }}
            />
          </div>

          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <div style={{ flex: 1, height: 1, background: "#1a2a3a" }} />
            <span style={{ fontSize: 11, color: "#2a4a6a", fontFamily: "'Share Tech Mono', monospace", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>OR SELECT A SPECIFIC SCENARIO</span>
            <div style={{ flex: 1, height: 1, background: "#1a2a3a" }} />
          </div>

          {/* Regular scenario grid */}
          <div className="grid-3 gap-4" style={{ marginBottom: 24 }}>
            {SCENARIOS.map(sc => {
              const isActive = selected.scenario?.id === sc.id && !usedRandomizer;
              return (
                <div key={sc.id}
                  className={`scenario-card${isActive ? " selected" : ""}`}
                  onClick={() => !isActive && selectScenario(sc)}
                  style={{ cursor: isActive ? "default" : "pointer" }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                    <span className="scenario-icon">{sc.icon}</span>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
                      <span className={`badge badge-severity-${sc.severity}`}>{sc.severity}</span>
                      {lastPlayed?.scenarioId === sc.id && (
                        <span style={{
                          fontSize: 10, fontFamily: "'Share Tech Mono', monospace",
                          padding: "2px 7px", borderRadius: 3,
                          background: "rgba(124,58,237,0.15)", color: "#a78bfa",
                          border: "1px solid rgba(124,58,237,0.3)",
                          whiteSpace: "nowrap",
                        }}>↺ Last played</span>
                      )}
                    </div>
                  </div>
                  <div className="scenario-name">{sc.name}</div>
                  <div className="scenario-desc">{sc.description}</div>
                  {lastPlayed?.scenarioId === sc.id && (
                    <div style={{ fontSize: 11, color: "#5a4a7a", fontFamily: "'Share Tech Mono', monospace" }}>
                      {new Date(lastPlayed.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      {lastPlayed.playbookName ? ` · ${lastPlayed.playbookName}` : ""}
                    </div>
                  )}
                  <div className="scenario-tags">{sc.tags.map(t => <span key={t} className="tag">{t}</span>)}</div>
                  {/* Continue button appears on selected card */}
                  {isActive && (
                    <button
                      className="btn btn-primary"
                      style={{ marginTop: 12, width: "100%" }}
                      onClick={e => { e.stopPropagation(); setStep(1); window.scrollTo({ top: 0, behavior: "instant" }); }}
                    >
                      Continue →
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Step 1: Playbook ── */}
      {step === 1 && (
        <>
          <div className="section-header" style={{ display: "block", maxWidth: 760, margin: "0 auto 16px", textAlign: "center" }}>
            <div><div className="section-title">Select a Playbook</div><div className="section-sub">Industry standard or your own — Claude reads it automatically.</div></div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760, margin: "0 auto 24px" }}>
            {INDUSTRY_PLAYBOOKS.map(pb => (
              <div key={pb.id}
                className={`scenario-card${selected.playbook?.id === pb.id ? " selected" : ""}`}
                onClick={() => setSelected(s => ({ ...s, playbook: pb }))}
                style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
                <div style={{ fontSize: 24 }}>{pb.id === "cisa" ? "🏛" : "📋"}</div>
                <div style={{ flex: 1 }}>
                  <div className="scenario-name" style={{ marginBottom: 6 }}>{pb.name}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{pb.phases.map((p, i) => <span key={i} className="tag">{p}</span>)}</div>
                </div>
              </div>
            ))}
            <div className={`card`}
              style={{ border: selected.playbook?.type === "custom" ? "1px solid #60a5fa" : "1px solid #1a2a3a" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <span style={{ fontSize: 24 }}>📁</span>
                <div>
                  <div className="scenario-name">Your Internal Playbook</div>
                  <div style={{ fontSize: 12, color: "#4a6a8a" }}>Upload a PDF or paste text — Claude extracts phases automatically</div>
                </div>
              </div>
              <PlaybookUpload onParsed={pb => setSelected(s => ({ ...s, playbook: pb }))} />
            </div>
          </div>
        </>
      )}

      {/* ── Step 2: Participants ── */}
      {step === 2 && (
        <>
          <div className="section-header" style={{ display: "block", maxWidth: 680, margin: "0 auto 16px", textAlign: "center" }}>
            <div><div className="section-title">Participants & Session</div><div className="section-sub">Enable the roles joining this exercise. Names are optional — leave blank to use the role title.</div></div>
          </div>
          <div style={{ maxWidth: 680, margin: "0 auto 24px", display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Session details stacked on top */}
            <div className="card">
              <div className="card-title">Session Details</div>
              <div style={{ display: "flex", gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <label>Session Name</label>
                  <input type="text" value={selected.sessionName} onChange={e => setSelected(s => ({ ...s, sessionName: e.target.value }))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label>Scenario</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "#070d18", borderRadius: 6, border: "1px solid #1a2a3a", height: 38 }}>
                    <span style={{ fontSize: 16 }}>{selected.scenario?.icon}</span>
                    <span style={{ fontSize: 13, color: "#c9d4e0", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected.scenario?.name}</span>
                    <span className={`badge badge-severity-${selected.scenario?.severity}`} style={{ flexShrink: 0 }}>{selected.scenario?.severity}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Role seats stacked below, full width */}
            <div className="card">
              <div className="card-title">Role Seats — {activeParticipants.length} of {selected.participants.length} active</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {selected.participants.map(p => (
                  <div key={p.id} style={{
                    display: "grid",
                    gridTemplateColumns: "20px 1fr 1fr 28px",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px",
                    borderRadius: 6,
                    background: "#0a1520",
                    border: `1px solid ${p.active ? "#1a2a3a" : "#111820"}`,
                    opacity: p.active ? 1 : 0.45,
                    transition: "opacity 0.15s",
                  }}>
                    {/* Toggle dot */}
                    <div
                      style={{ width: 10, height: 10, borderRadius: "50%", background: p.active ? "#22c55e" : "#2a3a4a", cursor: "pointer", flexShrink: 0 }}
                      title={p.active ? "Click to deactivate" : "Click to activate"}
                      onClick={() => toggleSeat(p.id)}
                    />
                    {/* Role dropdown — always the authoritative label */}
                    <select
                      value={p.role}
                      disabled={!p.active}
                      onChange={e => updateParticipant(p.id, "role", e.target.value)}
                      style={{ fontSize: 12, padding: "5px 8px", background: "#060e18", border: "1px solid #1a2a3a", borderRadius: 4, color: p.active ? "#93afd4" : "#2a4a5a", width: "100%", cursor: p.active ? "pointer" : "default" }}
                    >
                      {ROLES.map(r => <option key={r}>{r}</option>)}
                    </select>
                    {/* Optional name field */}
                    <input
                      type="text"
                      placeholder={`Name (optional)`}
                      value={p.name}
                      disabled={!p.active}
                      onChange={e => updateParticipant(p.id, "name", e.target.value)}
                      style={{ fontSize: 12, padding: "5px 8px", background: "#060e18", border: "1px solid #1a2a3a", borderRadius: 4, color: "#c9d1da", width: "100%" }}
                    />
                    {/* Remove / restore icon */}
                    <button
                      onClick={() => toggleSeat(p.id)}
                      title={p.active ? "Deactivate seat" : "Add this role"}
                      style={{
                        width: 24, height: 24,
                        borderRadius: "50%",
                        border: p.active ? "1px solid #1a3050" : "1px solid #16a34a",
                        background: p.active ? "transparent" : "rgba(22,163,74,0.2)",
                        color: p.active ? "#3a5a7a" : "#4ade80",
                        fontSize: p.active ? 13 : 17,
                        fontWeight: p.active ? 400 : 700,
                        cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                        transition: "all 0.15s",
                        lineHeight: 1,
                        boxShadow: p.active ? "none" : "0 0 6px rgba(74,222,128,0.3)",
                      }}
                    >{p.active ? "✕" : "+"}</button>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: "#2a4a6a" }}>
                Use ✕ / + to enable or disable a seat · Change role via dropdown · Name is optional
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Step 3: Facilitator Settings ── */}
      {step === 3 && (
        <>
          <div className="section-header" style={{ display: "block", maxWidth: 760, margin: "0 auto 16px", textAlign: "center" }}>
            <div>
              <div className="section-title">AI Facilitator Settings</div>
              <div className="section-sub">Shape how the AI facilitates — tone, difficulty, focus areas, and custom instructions.</div>
            </div>
          </div>
          <div style={{ maxWidth: 760, margin: "0 auto 24px" }}>
            <div className="card">
              <div className="card-title">Facilitator Configuration</div>
              <FacilitatorSettings
                config={selected.facilitatorConfig}
                onChange={fc => setSelected(s => ({ ...s, facilitatorConfig: fc }))}
                scenario={selected.scenario}
                playbook={selected.playbook}
                participants={selected.participants.filter(p => p.active)}
              />
              <hr className="divider" />
              <div style={{ fontSize: 12, color: "#2a4a6a", lineHeight: 1.7 }}>
                <strong style={{ color: "#3a6a9a" }}>How this works:</strong> These settings shape the AI's system prompt directly — they tell it how to ask questions, what to emphasize, and how much to challenge your team. You can return to this panel mid-exercise from the Settings tab.
              </div>
            </div>
          </div>
        </>
      )}

      {/* Nav — width matches each step's content column so buttons align left under the content, not the page */}
      <div style={{
        display: "flex", gap: 10, paddingBottom: 40,
        ...(step === 0 ? {} : { maxWidth: step === 2 ? 680 : 760, margin: "0 auto" }),
      }}>
        {step > 0 && <button className="btn btn-ghost" onClick={() => {
          // Going back to step 0 after randomizer: keep the hidden scenario,
          // just return to the scenario page — Surprise Me will show as selected
          setStep(s => s - 1);
          window.scrollTo({ top: 0, behavior: "instant" });
        }}>← Back</button>}
        {step < STEPS.length - 1
          ? <button
              className="btn btn-primary"
              disabled={!canProceed}
              style={!canProceed ? { opacity: 0.4, pointerEvents: "none" } : {}}
              onClick={() => { setStep(s => s + 1); window.scrollTo({ top: 0, behavior: "instant" }); }}
            >Continue →</button>
          : <button
              className="btn btn-primary"
              disabled={!canProceed}
              style={!canProceed ? { opacity: 0.4, pointerEvents: "none" } : {}}
            onClick={() => onStart({ ...selected, participants: activeParticipants, usedRandomizer })}>
            Launch Exercise →
          </button>}
      </div>
    </div>
  );
}

// ── Voice button ──────────────────────────────────────────────
function VoiceButton({ text }) {
  const [speaking, setSpeaking] = useState(false);
  if (!speech.supported) return null;

  const toggle = () => {
    if (speaking) { speech.stop(); setSpeaking(false); return; }
    setSpeaking(true);
    speech.speak(text);
    const check = setInterval(() => {
      if (!window.speechSynthesis.speaking) { setSpeaking(false); clearInterval(check); }
    }, 300);
  };

  return (
    <button
      className={`voice-btn${speaking ? " speaking" : ""}`}
      onClick={toggle}
      title={speaking ? "Stop narration" : "Read this message aloud"}
      style={{
        padding: "3px 9px",
        borderRadius: 4,
        border: speaking ? "1px solid rgba(167,139,250,0.4)" : "1px solid #1a2a3a",
        background: speaking ? "rgba(124,58,237,0.15)" : "rgba(255,255,255,0.03)",
        color: speaking ? "#a78bfa" : "#4a6a8a",
        fontSize: 11,
        fontFamily: "'Share Tech Mono', monospace",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        transition: "all 0.15s",
      }}
    >
      {speaking
        ? <><span style={{ display: "inline-flex", alignItems: "center", gap: 2, height: 14, verticalAlign: "middle" }}>{[1,2,3,4].map(i => <span key={i} className="wave-bar" style={{ height: `${5 + i * 2}px` }} />)}</span> Stop</>
        : <>🔊 Read aloud</>}
    </button>
  );
}

// ── AI Chat ───────────────────────────────────────────────────

// Parse [OPTION_X] lines out of an AI message
function parseOptions(text) {
  const matches = [...text.matchAll(/\[OPTION_([A-D])\]\s*(.+)/g)];
  return matches.map(m => ({ label: m[1], text: m[2].trim() }));
}

// Strip [OPTION_X] lines from displayed text, and catch any plain-text
// lettered list items Claude may produce as a fallback (A: ..., B: ..., etc.)
function stripOptions(text) {
  return text
    .replace(/\[OPTION_[A-D]\].+/g, "")
    .replace(/^[A-D][.):\s]\s*.{10,}/gm, "")  // catches "A. ...", "A: ...", "A) ..."
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Detect and strip [ADVANCE_PHASE] marker from an AI message
function hasAdvancePhase(text) { return /\[ADVANCE_PHASE\]/i.test(text); }
function stripAdvancePhase(text) { return text.replace(/\[ADVANCE_PHASE\]/gi, "").replace(/\n{3,}/g, "\n\n").trim(); }

// ── Multi-Role Response Round ─────────────────────────────────
function MultiRoleInputPanel({ participants, onSubmit, onCancel, loading }) {
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries((participants || []).map(p => [p.id, ""]))
  );

  const setDraft = (id, val) => setDrafts(d => ({ ...d, [id]: val }));
  const filledCount = Object.values(drafts).filter(v => v.trim()).length;

  const submit = () => {
    const responses = (participants || [])
      .map(p => ({ role: p.role, name: p.name, text: drafts[p.id] || "" }))
      .filter(r => r.text.trim());
    if (!responses.length) return;
    onSubmit(responses);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11, color: "#4a6fa5", fontFamily: "'Share Tech Mono', monospace", letterSpacing: "0.05em" }}>
        MULTI-ROLE RESPONSE ROUND · leave blank to skip a role
      </div>
      {(participants || []).map(p => (
        <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ marginBottom: 0 }}>{p.name || p.role} <span style={{ color: "#2a4a6a" }}>({p.role})</span></label>
          <textarea
            placeholder={`${p.role}'s response…`}
            value={drafts[p.id]}
            onChange={e => setDraft(p.id, e.target.value)}
            style={{ minHeight: 56 }}
          />
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={loading}>Cancel</button>
        <button className="btn btn-primary btn-sm" disabled={!filledCount || loading} onClick={submit}>
          {loading ? <span className="spinner" /> : `⚡ Send ${filledCount} Response${filledCount === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}

function MultiRoleMessageGroup({ msg }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 10, color: "#3a5a7a", fontFamily: "'Share Tech Mono', monospace", letterSpacing: "0.05em" }}>
        MULTI-ROLE RESPONSE · {msg.time}
      </div>
      {msg.authors.map((a, i) => (
        <div key={i} className="chat-msg">
          <div className="chat-avatar">{(a.name || a.role)[0].toUpperCase()}</div>
          <div className="chat-body">
            <div className="chat-meta"><span>{a.name || a.role}</span><span style={{ opacity: 0.5 }}>·</span><span className="mono" style={{ fontSize: 10 }}>{a.role}</span></div>
            <div className="chat-text">{a.text}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AIChat({ scenario, phase, messages, onMessage, loading, onAdvancePhase, isLastPhase, participants, multiMode, onToggleMultiMode, onMultiSend, hideScenarioName }) {
  const [input, setInput] = useState("");
  const [hintState, setHintState] = useState("none");
  const [selectedOption, setSelectedOption] = useState(null);
  const chatAreaRef = useRef(null);
  const lastAiMsgRef = useRef(null);
  const optionsBottomRef = useRef(null);

  // Derive these before effects so they're in scope
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const isLastAI = lastMsg?.role === "ai";
  const currentOptions = ((hintState === "options-used" || hintState === "both-unlocked") && isLastAI)
    ? parseOptions(lastMsg.text)
    : [];
  const showOptions = currentOptions.length > 0;
  const bothUnlocked = hintState === "both-unlocked" ||
    (hintState === "options-used" && isLastAI && currentOptions.length === 0);

  // Track whether [ADVANCE_PHASE] has been suggested for the current phase.
  // Once suggested, keep the button visible until the user clicks it or the phase advances.
  const [phaseAdvanceSuggested, setPhaseAdvanceSuggested] = useState(false);

  // Set flag when any AI message in this phase contains [ADVANCE_PHASE]
  useEffect(() => {
    if (isLastAI && !isLastPhase && hasAdvancePhase(lastMsg.text)) {
      setPhaseAdvanceSuggested(true);
    }
  }, [messages]);

  // Reset when the phase changes (parent prop update signals a new phase)
  useEffect(() => {
    setPhaseAdvanceSuggested(false);
  }, [phase]);

  // When a new AI message arrives, scroll its top into view inside the chat area
  useEffect(() => {
    if (!lastAiMsgRef.current || !chatAreaRef.current) return;
    const area = chatAreaRef.current;
    const msg = lastAiMsgRef.current;
    area.scrollTop = msg.offsetTop - area.offsetTop;
  }, [messages, loading]);

  // When options appear, scroll the page so the submit button is visible
  useEffect(() => {
    if (showOptions && optionsBottomRef.current) {
      setTimeout(() => {
        optionsBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }, 50);
    }
  }, [showOptions]);

  const send = (text) => {
    const msg = text ?? input;
    if (!msg.trim() || loading) return;
    onMessage(msg);
    setInput("");
  };

  const handleRealSend = () => {
    if (!input.trim() || loading) return;
    // Preserve "both-unlocked" across real sends — only reset hint-used states
    setHintState(s => s === "both-unlocked" ? "both-unlocked" : "none");
    setSelectedOption(null);
    send(input);
  };

  const handleOptionSubmit = () => {
    if (!selectedOption || loading) return;
    setHintState("both-unlocked");
    setSelectedOption(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    send(`${selectedOption.label}: ${selectedOption.text}`);
  };

  const handleHint = () => {
    setHintState(s => s === "both-unlocked" ? "both-unlocked" : "hint-used");
    setSelectedOption(null);
    send("We're not sure what to do next — can we get a hint?");
  };

  const handleOptions = () => {
    // First time: set options-used so we parse options from the response.
    // Subsequent times (both-unlocked): keep both-unlocked but still request options.
    setHintState(s => s === "both-unlocked" ? "both-unlocked" : "options-used");
    setSelectedOption(null);
    send("We're still stuck — please show us multiple choice options.");
  };

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>AI FACILITATOR{hideScenarioName ? " · MYSTERY SCENARIO" : ` · ${scenario?.name?.toUpperCase()}`}</div>
        {participants?.length > 1 && !showOptions && (
          <button
            className={`btn btn-sm ${multiMode ? "btn-active" : "btn-ghost"}`}
            onClick={onToggleMultiMode}
            title="Collect responses from multiple roles at once"
          >👥 Multi-Role Response</button>
        )}
      </div>
      <div className="chat-area" ref={chatAreaRef}>
        {messages.map((m, i) => {
          const isThisLastAI = m.role === "ai" && i === messages.length - 1;
          if (m.multi) {
            return <MultiRoleMessageGroup key={i} msg={m} />;
          }
          // Strip [OPTION_X] and [ADVANCE_PHASE] markers from every AI message
          const displayText = m.role === "ai"
            ? stripAdvancePhase(stripOptions(m.text))
            : m.text;
          return (
            <div key={i} className="chat-msg" ref={isThisLastAI ? lastAiMsgRef : null}>
              <div className={`chat-avatar${m.role === "ai" ? " ai" : ""}`}>
                {m.role === "ai" ? "AI" : (m.author?.[0] || "U").toUpperCase()}
              </div>
              <div className="chat-body">
                <div className="chat-meta">
                  <span>{m.role === "ai" ? "AI Facilitator" : m.author}</span>
                  <span style={{ opacity: 0.5 }}>·</span>
                  <span>{m.time}</span>
                  {m.role === "ai" && <VoiceButton text={displayText} />}
                </div>
                <div className={`chat-text${m.role === "ai" ? " ai-msg" : ""}`}
                  dangerouslySetInnerHTML={{ __html: displayText.replace(/\n/g, "<br/>") }} />
              </div>
            </div>
          );
        })}
        {loading && (
          <div className="chat-msg" ref={lastAiMsgRef}>
            <div className="chat-avatar ai">AI</div>
            <div className="chat-body">
              <div className="chat-meta">AI Facilitator · now</div>
              <div className="chat-text ai-msg"><span className="spinner" /></div>
            </div>
          </div>
        )}
      </div>

      {/* Hint / options / advance action buttons */}
      {isLastAI && !loading && !showOptions && (
        <div className="msg-actions" style={{ padding: "8px 0 0" }}>
          {(hintState === "none" || bothUnlocked) && (
            <button className="msg-action-btn" onClick={handleHint}
              title="Ask the facilitator for a directional nudge without giving away the answer">
              💡 Ask for a hint
            </button>
          )}
          {(hintState === "hint-used" || bothUnlocked) && (
            <button className="msg-action-btn options-btn" onClick={handleOptions}
              title="Ask the facilitator to present multiple choice options">
              🔀 Still stuck? Ask for options
            </button>
          )}
          {phaseAdvanceSuggested && !isLastPhase && (
            <button className="msg-action-btn advance-btn" onClick={onAdvancePhase}
              title="The AI facilitator suggests the team is ready to move to the next phase">
              ✅ Advance to next phase
            </button>
          )}
        </div>
      )}

      <hr className="divider" />

      {/* Input area: multiple choice OR textarea */}
      {showOptions ? (
        <div>
          <div style={{ fontSize: 11, color: "#4a6fa5", fontFamily: "'Share Tech Mono', monospace", letterSpacing: "0.08em", marginBottom: 10 }}>
            SELECT AN OPTION THEN CLICK SUBMIT
          </div>
          <div className="mc-options">
            {currentOptions.map(opt => {
              const isSelected = selectedOption?.label === opt.label;
              return (
                <button
                  key={opt.label}
                  className="mc-option"
                  disabled={loading}
                  onClick={() => setSelectedOption(isSelected ? null : opt)}
                  style={{
                    borderColor: isSelected ? "#60a5fa" : undefined,
                    background: isSelected ? "rgba(29,78,216,0.18)" : undefined,
                    color: isSelected ? "#e0eaff" : undefined,
                  }}
                >
                  <span className="mc-option-label" style={{
                    background: isSelected ? "#1d4ed8" : undefined,
                    color: isSelected ? "#fff" : undefined,
                  }}>{opt.label}</span>
                  <span>{opt.text}</span>
                </button>
              );
            })}
          </div>
          {/* Single unified submit row — textarea for free-text, Submit works for both */}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <textarea style={{ flex: 1, minHeight: 40 }}
              placeholder="Or type your own response…"
              value={input} onChange={e => { setInput(e.target.value); setSelectedOption(null); }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleRealSend(); } }} />
            <button className="btn btn-primary" disabled={(!selectedOption && !input.trim()) || loading}
              onClick={selectedOption ? handleOptionSubmit : handleRealSend}
              style={{ alignSelf: "flex-end" }}>
              {loading ? <span className="spinner" /> : "Submit"}
            </button>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: "#2a4a6a" }}>
            {selectedOption
              ? <span style={{ color: "#60a5fa" }}>Option {selectedOption.label} selected — click Submit to confirm</span>
              : "Select an option above, or type your own response"}
          </div>
          {/* Invisible sentinel at the true bottom of the options section for scroll targeting */}
          <div ref={optionsBottomRef} style={{ height: 1 }} />
        </div>
      ) : multiMode ? (
        <MultiRoleInputPanel
          participants={participants}
          loading={loading}
          onCancel={onToggleMultiMode}
          onSubmit={onMultiSend}
        />
      ) : (
        <div>
          <div style={{ display: "flex", gap: 8 }}>
            <textarea style={{ flex: 1, minHeight: 56 }}
              placeholder={`Describe your team's next action… (${phase})`}
              value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleRealSend(); } }} />
            <button className="btn btn-primary" disabled={!input.trim() || loading}
              onClick={handleRealSend} style={{ alignSelf: "flex-end" }}>
              {loading ? <span className="spinner" /> : "Submit"}
            </button>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: "#2a4a6a" }}>
            <span className="hotkey">Enter</span> to submit · <span className="hotkey">Shift+Enter</span> new line
          </div>
        </div>
      )}
    </div>
  );
}

// ── Injects ───────────────────────────────────────────────────
function InjectPanel({ scenario, onInject }) {
  const injects = INJECT_LIBRARY[scenario?.id] || [];
  return (
    <div className="card">
      <div className="card-title">SCENARIO INJECTS</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {injects.map((inj, i) => (
          <div key={i} className="inject-item" style={{ borderLeft: `3px solid ${inj.color}` }}>
            <div className="inject-title"><span className="inject-badge" style={{ background: inj.color }} />{inj.title}</div>
            <div className="inject-text">{inj.text}</div>
            <div style={{ marginTop: 10 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => onInject(inj)}>⚡ Inject into Exercise</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomInject({ onInject }) {
  const [title, setTitle] = useState(""); const [text, setText] = useState("");
  return (
    <div className="card">
      <div className="card-title">CUSTOM INJECT</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div><label>Inject Title</label><input type="text" placeholder="e.g. CEO Demands Status Update" value={title} onChange={e => setTitle(e.target.value)} /></div>
        <div><label>Description</label><textarea placeholder="Describe the complication to introduce…" value={text} onChange={e => setText(e.target.value)} style={{ minHeight: 90 }} /></div>
        <button className="btn btn-primary btn-sm" disabled={!title.trim() || !text.trim()}
          onClick={() => { onInject({ title, text, color: "#ca8a04" }); setTitle(""); setText(""); }}>
          ⚡ Inject into Exercise
        </button>
      </div>
    </div>
  );
}

// ── After-Action Report ───────────────────────────────────────
function AARView({ session, timeline, messages, duration, onNewScenario }) {
  const [aarData, setAarData] = useState(null);
  const [loading, setLoading] = useState(false);
  const printRef = useRef();

  const fmt = s => s > 0
    ? `${Math.floor(s / 3600) > 0 ? Math.floor(s / 3600) + "h " : ""}${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s`
    : "—";

  const responseCount = messages.reduce(
    (acc, m) => m.role === "ai" ? acc : acc + (m.multi ? m.authors.length : 1), 0
  );

  const generate = async () => {
    setLoading(true);
    setAarData(null);
    try {
      const log = messages.filter(m => m.role !== "ai").map(m =>
        m.multi
          ? m.authors.map(a => `${a.name || a.role} (${a.role}): ${a.text}`).join("\n")
          : `${m.author || m.role}: ${m.text}`
      ).join("\n");
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6", max_tokens: 4000,
          system: `You are a cybersecurity tabletop exercise facilitator writing a professional After-Action Report. Respond ONLY with a single valid JSON object — no markdown code fences, no commentary before or after, no trailing text. The entire response must be parseable by JSON.parse().`,
          messages: [{ role: "user", content: `Generate an AAR for this tabletop exercise.

Scenario: ${session.scenario.name}
Playbook: ${session.playbook.name}
Duration: ${fmt(duration)}
Participants: ${session.participants.map(p => `${p.name || p.role} (${p.role})`).join(", ")}
Facilitator tone: ${session.facilitatorConfig.tone}, difficulty: ${session.facilitatorConfig.difficulty}
Discussion log: ${log || "(No discussion captured — generate a realistic template AAR.)"}

Return this exact JSON shape with no other text:
{
  "executiveSummary": "3-4 sentence paragraph summarizing the exercise and key outcomes",
  "wentWell": ["specific item", "specific item", "specific item"],
  "improvements": ["specific item", "specific item", "specific item"],
  "playbookGaps": ["specific gap vs ${session.playbook.name}", "specific gap", "specific gap"],
  "actionItems": [
    {"id": 1, "action": "specific action", "owner": "Role Title", "priority": "High"},
    {"id": 2, "action": "specific action", "owner": "Role Title", "priority": "Medium"},
    {"id": 3, "action": "specific action", "owner": "Role Title", "priority": "Low"}
  ],
  "nextSteps": ["specific step", "specific step", "specific step"]
}` }]
        })
      });
      const data = await resp.json();

      // Check for API-level errors (auth, rate limit, etc.)
      if (data.error) {
        setAarData({ error: true, detail: data.error.message || "API error" });
        setLoading(false);
        return;
      }

      const raw = (data.content?.find(b => b.type === "text")?.text || "").trim();

      // Strip any accidental markdown fences
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

      try {
        const parsed = JSON.parse(cleaned);
        setAarData(parsed);
      } catch (parseErr) {
        // JSON parse failed — show the raw response so the user can see what came back
        setAarData({ error: true, detail: `JSON parse failed. Raw response: ${raw.slice(0, 300)}` });
      }
    } catch (networkErr) {
      setAarData({ error: true, detail: `Network error: ${networkErr.message}` });
    }
    setLoading(false);
  };

  const handlePrint = () => {
    // Build a self-contained HTML page for the report and open it in a new tab.
    // window.print() is blocked inside the sandboxed artifact iframe, so we
    // export the content as a standalone document the browser can print freely.
    const participantRows = session.participants
      .map(p => `<span class="chip">${p.name || p.role}${p.name ? ` <span class="chip-role">${p.role}</span>` : ""}</span>`)
      .join("");

    const listItems = (arr, icon, color) =>
      (arr || []).map(item => `<div class="list-item" style="border-left-color:${color}"><span class="list-icon" style="color:${color}">${icon}</span>${item}</div>`).join("");

    const actionRows = (aarData?.actionItems || []).map(item =>
      `<div class="action-row">
        <span class="action-id">${String(item.id || "").padStart(2,"0")}</span>
        <div class="action-body">
          <div class="action-text">${item.action}</div>
          <div class="action-owner">Owner: ${item.owner}</div>
        </div>
        <span class="priority priority-${(item.priority||"").toLowerCase()}">${item.priority}</span>
      </div>`
    ).join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>AAR — ${session.scenario.name}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', sans-serif; font-size: 11pt; color: #111; background: #fff; padding: 32pt 40pt; }
    h1 { font-size: 20pt; font-weight: 700; color: #0f172a; margin-bottom: 4pt; }
    .sub { font-size: 10pt; color: #475569; margin-bottom: 20pt; }
    .metrics { display: flex; gap: 12pt; margin-bottom: 20pt; }
    .metric { flex: 1; border: 1px solid #e2e8f0; border-radius: 6pt; padding: 12pt; text-align: center; }
    .metric-value { font-size: 22pt; font-weight: 700; color: #1e40af; }
    .metric-label { font-size: 8pt; color: #64748b; text-transform: uppercase; letter-spacing: .05em; margin-top: 3pt; }
    .section { border: 1px solid #e2e8f0; border-radius: 6pt; padding: 16pt; margin-bottom: 14pt; page-break-inside: avoid; }
    .section-title { font-size: 8pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #475569; border-bottom: 1px solid #e2e8f0; padding-bottom: 6pt; margin-bottom: 12pt; }
    .summary { font-size: 11pt; color: #1e293b; line-height: 1.7; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12pt; margin-bottom: 14pt; }
    .list-item { display: flex; gap: 8pt; align-items: flex-start; padding: 7pt 10pt; border-radius: 4pt; border: 1px solid #e2e8f0; border-left-width: 3px; background: #f8fafc; margin-bottom: 6pt; font-size: 10pt; line-height: 1.5; color: #1e293b; }
    .list-icon { flex-shrink: 0; margin-top: 1pt; font-style: normal; }
    .action-row { display: flex; align-items: center; gap: 10pt; padding: 9pt 12pt; border: 1px solid #e2e8f0; border-radius: 4pt; background: #f8fafc; margin-bottom: 6pt; }
    .action-id { font-weight: 700; font-size: 9pt; color: #94a3b8; width: 24pt; flex-shrink: 0; }
    .action-body { flex: 1; }
    .action-text { font-size: 10pt; color: #1e293b; line-height: 1.4; }
    .action-owner { font-size: 8.5pt; color: #64748b; margin-top: 2pt; }
    .priority { font-size: 8pt; font-weight: 700; padding: 2pt 7pt; border-radius: 3pt; flex-shrink: 0; }
    .priority-high { background: #fee2e2; color: #dc2626; }
    .priority-medium { background: #fef9c3; color: #ca8a04; }
    .priority-low { background: #dcfce7; color: #16a34a; }
    .chip { display: inline-flex; align-items: center; gap: 5pt; padding: 3pt 10pt; border: 1px solid #e2e8f0; border-radius: 4pt; font-size: 9.5pt; background: #f8fafc; margin: 3pt; }
    .chip-role { color: #94a3b8; font-size: 8.5pt; }
    .chips { margin-top: 8pt; }
    @media print {
      body { padding: 12pt 16pt; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="background:#1e40af;color:#fff;padding:10pt 16pt;border-radius:6pt;margin-bottom:20pt;display:flex;align-items:center;justify-content:space-between;">
    <span style="font-size:11pt;font-weight:600;">After-Action Report — ready to print</span>
    <button onclick="window.print()" style="background:#fff;color:#1e40af;border:none;padding:6pt 16pt;border-radius:4pt;font-size:10pt;font-weight:600;cursor:pointer;">🖨 Print / Save as PDF</button>
  </div>
  <h1>After-Action Report</h1>
  <div class="sub">${session.scenario.icon} ${session.scenario.name} &nbsp;·&nbsp; ${session.playbook.name} &nbsp;·&nbsp; ${session.sessionName}</div>

  <div class="metrics">
    <div class="metric"><div class="metric-value">${session.participants.length}</div><div class="metric-label">Participants</div></div>
    <div class="metric"><div class="metric-value">${fmt(duration)}</div><div class="metric-label">Duration</div></div>
    <div class="metric"><div class="metric-value">${responseCount}</div><div class="metric-label">Responses</div></div>
  </div>

  <div class="section">
    <div class="section-title">Participants</div>
    <div class="chips">${participantRows}</div>
  </div>

  <div class="section">
    <div class="section-title">Executive Summary</div>
    <div class="summary">${aarData?.executiveSummary || ""}</div>
  </div>

  <div class="two-col">
    <div class="section">
      <div class="section-title" style="color:#15803d;">✓ What Went Well</div>
      ${listItems(aarData?.wentWell, "✓", "#15803d")}
    </div>
    <div class="section">
      <div class="section-title" style="color:#c2410c;">△ Areas for Improvement</div>
      ${listItems(aarData?.improvements, "△", "#c2410c")}
    </div>
  </div>

  <div class="section">
    <div class="section-title" style="color:#b91c1c;">⚠ Playbook Gaps — ${session.playbook.name}</div>
    ${listItems(aarData?.playbookGaps, "⚠", "#b91c1c")}
  </div>

  <div class="section">
    <div class="section-title">Recommended Action Items</div>
    ${actionRows}
  </div>

  <div class="section">
    <div class="section-title" style="color:#1d4ed8;">Next Steps</div>
    ${(aarData?.nextSteps || []).map((s, i) => `<div class="list-item" style="border-left-color:#1d4ed8"><span class="action-id">${String(i+1).padStart(2,"0")}</span>${s}</div>`).join("")}
  </div>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  };

  const priorityColor = { High: "#f87171", Medium: "#fbbf24", Low: "#4ade80" };

  return (
    <>
      {/* Print-only styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .topbar { display: none !important; }
          body { background: #fff !important; color: #111 !important; font-size: 12pt; }
          .aar-print-root { padding: 0 !important; max-width: 100% !important; }
          .aar-card { background: #fff !important; border: 1px solid #ccc !important; border-radius: 4px; page-break-inside: avoid; margin-bottom: 14pt; }
          .aar-card-title { color: #333 !important; border-bottom: 1px solid #ccc; padding-bottom: 6pt; margin-bottom: 10pt; }
          .aar-summary { color: #222 !important; }
          .aar-list-item { color: #222 !important; border-color: #ddd !important; background: #f9f9f9 !important; }
          .aar-action-row { border-color: #ddd !important; background: #f5f5f5 !important; }
          .aar-action-text { color: #111 !important; }
          .aar-action-owner { color: #444 !important; }
          .aar-priority { border: 1px solid #aaa !important; color: #333 !important; background: #eee !important; }
          .aar-metric-box { border: 1px solid #ccc !important; background: #f5f5f5 !important; }
          .aar-metric-value { color: #111 !important; }
          .aar-metric-label { color: #555 !important; }
          .aar-header-title { color: #111 !important; }
          .aar-header-sub { color: #555 !important; }
        }
      `}</style>

      <div className="main aar-print-root" style={{ paddingBottom: 60, maxWidth: 900 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, gap: 12 }}>
          <div>
            <div className="aar-header-title" style={{ fontSize: 22, fontWeight: 700, color: "#e0eaff", marginBottom: 4 }}>
              After-Action Report
            </div>
            <div className="aar-header-sub" style={{ fontSize: 13, color: "#4a6a8a" }}>
              {session.scenario.icon} {session.scenario.name} &nbsp;·&nbsp; {session.playbook.name} &nbsp;·&nbsp; {session.sessionName}
            </div>
          </div>
          <div className="no-print" style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button className="btn btn-ghost btn-sm" onClick={handlePrint} title="Print or save as PDF">🖨 Print / PDF</button>
            <button className="btn btn-primary" onClick={generate} disabled={loading}>
              {loading ? <><span className="spinner" /> Generating…</> : aarData ? "↺ Regenerate" : "✦ Generate Report"}
            </button>
          </div>
        </div>

        {/* Metrics row */}
        <div className="grid-3 gap-4" style={{ marginBottom: 24 }}>
          <div className="metric-box aar-metric-box">
            <div className="metric-value aar-metric-value">{session.participants.length}</div>
            <div className="metric-label aar-metric-label">Participants</div>
          </div>
          <div className="metric-box aar-metric-box">
            <div className="metric-value aar-metric-value">{fmt(duration)}</div>
            <div className="metric-label aar-metric-label">Duration</div>
          </div>
          <div className="metric-box aar-metric-box">
            <div className="metric-value aar-metric-value">{responseCount}</div>
            <div className="metric-label aar-metric-label">Responses</div>
          </div>
        </div>

        {/* Participant list for print */}
        <div className="aar-card card" style={{ marginBottom: 20 }}>
          <div className="aar-card-title card-title">PARTICIPANTS</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {session.participants.map((p, i) => (
              <div key={i} style={{
                padding: "5px 12px", borderRadius: 4,
                background: "#0a1520", border: "1px solid #1a2a3a",
                fontSize: 12,
              }}>
                <span style={{ color: "#c9d4e0", fontWeight: 500 }}>{p.name || p.role}</span>
                {p.name && <span style={{ color: "#3a5a7a", marginLeft: 6, fontFamily: "'Share Tech Mono', monospace", fontSize: 11 }}>{p.role}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* No report yet */}
        {!aarData && !loading && (
          <div className="card no-print" style={{ textAlign: "center", padding: "48px 20px" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <div style={{ color: "#c9d4e0", fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Ready to Generate</div>
            <div style={{ color: "#3a5a7a", fontSize: 13, marginBottom: 20 }}>Click "Generate Report" to create a structured after-action report.</div>
            <button className="btn btn-primary" onClick={generate}>✦ Generate Report</button>
          </div>
        )}

        {/* Skeleton loading state */}
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Executive Summary skeleton */}
            <div className="card">
              <div className="skeleton skeleton-title" />
              <div className="skeleton skeleton-line skeleton-line-full" />
              <div className="skeleton skeleton-line skeleton-line-full" />
              <div className="skeleton skeleton-line skeleton-line-full" />
              <div className="skeleton skeleton-line skeleton-line-med" />
            </div>
            {/* Went Well / Improvements skeleton */}
            <div className="grid-2 gap-4">
              {[0, 1].map(col => (
                <div key={col} className="card">
                  <div className="skeleton skeleton-title" />
                  {[85, 100, 70].map((w, i) => (
                    <div key={i} className="skeleton skeleton-block" style={{ width: `${w}%` }} />
                  ))}
                </div>
              ))}
            </div>
            {/* Playbook Gaps skeleton */}
            <div className="card">
              <div className="skeleton skeleton-title" />
              {[100, 90, 80].map((w, i) => (
                <div key={i} className="skeleton skeleton-block" style={{ width: `${w}%` }} />
              ))}
            </div>
            {/* Action Items skeleton */}
            <div className="card">
              <div className="skeleton skeleton-title" />
              {[0, 1, 2].map(i => (
                <div key={i} className="skeleton skeleton-block" style={{ marginBottom: 8 }} />
              ))}
            </div>
            {/* Next Steps skeleton */}
            <div className="card">
              <div className="skeleton skeleton-title" />
              {[100, 85, 75].map((w, i) => (
                <div key={i} className="skeleton skeleton-line" style={{ width: `${w}%` }} />
              ))}
            </div>
            {/* Status message */}
            <div style={{ textAlign: "center", padding: "8px 0 16px", fontSize: 12, color: "#3a5a7a", fontFamily: "'Share Tech Mono', monospace" }}>
              <span className="spinner" style={{ verticalAlign: "middle", marginRight: 8 }} />
              Claude is analysing your session and writing the report…
            </div>
          </div>
        )}

        {/* Error */}
        {aarData?.error && (
          <div className="card" style={{ borderColor: "rgba(220,38,38,0.3)", padding: 24 }}>
            <div style={{ color: "#f87171", fontWeight: 600, marginBottom: 8 }}>Failed to generate report</div>
            {aarData.detail && (
              <div style={{ fontSize: 12, color: "#5a7a9a", fontFamily: "'Share Tech Mono', monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {aarData.detail}
              </div>
            )}
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={generate}>↺ Try Again</button>
          </div>
        )}

        {/* Rendered AAR sections */}
        {aarData && !aarData.error && (
          <div ref={printRef} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Executive Summary */}
            <div className="aar-card card">
              <div className="aar-card-title card-title">EXECUTIVE SUMMARY</div>
              <div className="aar-summary" style={{ fontSize: 14, color: "#c0d4ea", lineHeight: 1.8 }}>
                {aarData.executiveSummary}
              </div>
            </div>

            {/* What Went Well + Areas for Improvement side by side */}
            <div className="grid-2 gap-4">
              <div className="aar-card card">
                <div className="aar-card-title card-title" style={{ color: "#22c55e" }}>✓ WHAT WENT WELL</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(aarData.wentWell || []).map((item, i) => (
                    <div key={i} className="aar-list-item" style={{
                      padding: "8px 12px", borderRadius: 5,
                      background: "rgba(22,163,74,0.06)", border: "1px solid rgba(22,163,74,0.2)",
                      fontSize: 13, color: "#b0c4da", lineHeight: 1.55,
                      display: "flex", gap: 8, alignItems: "flex-start"
                    }}>
                      <span style={{ color: "#22c55e", flexShrink: 0, marginTop: 1 }}>✓</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="aar-card card">
                <div className="aar-card-title card-title" style={{ color: "#fb923c" }}>△ AREAS FOR IMPROVEMENT</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(aarData.improvements || []).map((item, i) => (
                    <div key={i} className="aar-list-item" style={{
                      padding: "8px 12px", borderRadius: 5,
                      background: "rgba(234,88,12,0.06)", border: "1px solid rgba(234,88,12,0.2)",
                      fontSize: 13, color: "#b0c4da", lineHeight: 1.55,
                      display: "flex", gap: 8, alignItems: "flex-start"
                    }}>
                      <span style={{ color: "#fb923c", flexShrink: 0, marginTop: 1 }}>△</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Playbook Gaps */}
            <div className="aar-card card">
              <div className="aar-card-title card-title" style={{ color: "#f87171" }}>⚠ PLAYBOOK GAPS — {session.playbook.name.toUpperCase()}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(aarData.playbookGaps || []).map((item, i) => (
                  <div key={i} className="aar-list-item" style={{
                    padding: "8px 12px", borderRadius: 5,
                    background: "rgba(220,38,38,0.05)", border: "1px solid rgba(220,38,38,0.2)",
                    fontSize: 13, color: "#b0c4da", lineHeight: 1.55,
                    display: "flex", gap: 8, alignItems: "flex-start"
                  }}>
                    <span style={{ color: "#f87171", flexShrink: 0, marginTop: 1 }}>⚠</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Action Items */}
            <div className="aar-card card">
              <div className="aar-card-title card-title">RECOMMENDED ACTION ITEMS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(aarData.actionItems || []).map((item, i) => (
                  <div key={i} className="aar-action-row" style={{
                    display: "grid", gridTemplateColumns: "28px 1fr auto auto",
                    alignItems: "center", gap: 12,
                    padding: "10px 14px", borderRadius: 5,
                    background: "#0a1520", border: "1px solid #1a2a3a",
                  }}>
                    <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 12, color: "#3a5a7a", fontWeight: 600 }}>
                      {String(item.id || i + 1).padStart(2, "0")}
                    </div>
                    <div>
                      <div className="aar-action-text" style={{ fontSize: 13, color: "#c9d4e0", lineHeight: 1.5 }}>{item.action}</div>
                      <div className="aar-action-owner" style={{ fontSize: 11, color: "#3a5a7a", marginTop: 2, fontFamily: "'Share Tech Mono', monospace" }}>Owner: {item.owner}</div>
                    </div>
                    <div className="aar-priority" style={{
                      fontSize: 10, fontFamily: "'Share Tech Mono', monospace",
                      padding: "2px 8px", borderRadius: 3,
                      color: priorityColor[item.priority] || "#c9d4e0",
                      border: `1px solid ${priorityColor[item.priority] || "#1a2a3a"}20`,
                      background: `${priorityColor[item.priority] || "#1a2a3a"}12`,
                      whiteSpace: "nowrap",
                    }}>{item.priority}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Next Steps */}
            <div className="aar-card card">
              <div className="aar-card-title card-title">NEXT STEPS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {(aarData.nextSteps || []).map((step, i) => (
                  <div key={i} className="aar-list-item" style={{
                    padding: "8px 12px", borderRadius: 5,
                    background: "rgba(29,78,216,0.06)", border: "1px solid rgba(29,78,216,0.2)",
                    fontSize: 13, color: "#b0c4da", lineHeight: 1.55,
                    display: "flex", gap: 8, alignItems: "flex-start"
                  }}>
                    <span style={{ color: "#60a5fa", flexShrink: 0, fontFamily: "'Share Tech Mono', monospace", fontSize: 11, marginTop: 2 }}>{String(i + 1).padStart(2, "0")}</span>
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* New scenario CTA */}
        <div className="no-print" style={{
          marginTop: 32, padding: "24px 28px",
          background: "rgba(29,78,216,0.06)", border: "1px solid rgba(29,78,216,0.2)",
          borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#c9d4e0", marginBottom: 3 }}>Ready for another round?</div>
            <div style={{ fontSize: 12, color: "#3a5a7a" }}>Start a new scenario with the same or a different team configuration.</div>
          </div>
          <button className="btn btn-primary" onClick={onNewScenario} style={{ flexShrink: 0 }}>
            ↺ New Scenario
          </button>
        </div>
      </div>
    </>
  );
}

// ── Confirm Modal ─────────────────────────────────────────────
function ConfirmModal({ icon, title, body, confirmLabel, confirmStyle, cancelLabel = "Keep Going", onConfirm, onCancel }) {
  // Close on backdrop click
  const handleBackdrop = (e) => { if (e.target === e.currentTarget) onCancel(); };
  // Close on Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={handleBackdrop}>
      <div className="modal">
        {icon && <div className="modal-icon">{icon}</div>}
        <div className="modal-title">{title}</div>
        <div className="modal-body">{body}</div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>{cancelLabel}</button>
          <button
            className="btn"
            style={confirmStyle}
            onClick={onConfirm}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// Varied closing lines for inject messages, keyed by urgency color
const INJECT_CLOSINGS = {
  critical: [
    "Clock is ticking — how does your team respond?",
    "This changes everything. What's your immediate action?",
    "The situation is escalating. What does your team do?",
    "Every second counts. How does your team react?",
  ],
  high: [
    "How does your team handle this development?",
    "This requires an immediate decision. What's your next move?",
    "Your team needs to act. What's the call?",
    "A decision is needed now. How do you proceed?",
  ],
  medium: [
    "How does this affect your team's current plan?",
    "What adjustments does your team need to make?",
    "How do you incorporate this into your response?",
    "How does your team account for this?",
  ],
};

const getInjectClosing = (color) => {
  const isRed    = color === "#dc2626";
  const isOrange = color === "#ea580c";
  const pool = isRed ? INJECT_CLOSINGS.critical
    : isOrange ? INJECT_CLOSINGS.high
    : INJECT_CLOSINGS.medium;
  return pool[Math.floor(Math.random() * pool.length)];
};
const storageKey = (session) =>
  `tactician:${session.sessionName}:${session.scenario.id}`.replace(/\s+/g, "_").slice(0, 120);

const LAST_PLAYED_KEY = "tactician:lastPlayed";

const lastPlayedStorage = {
  save(scenario, playbook, sessionName) {
    try {
      localStorage.setItem(LAST_PLAYED_KEY, JSON.stringify({
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        scenarioIcon: scenario.icon,
        scenarioSeverity: scenario.severity,
        playbookName: playbook.name,
        sessionName,
        completedAt: new Date().toISOString(),
      }));
    } catch { /* silent */ }
  },
  load() {
    try {
      const raw = localStorage.getItem(LAST_PLAYED_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
};

// ── localStorage chat persistence hook ───────────────────────
function useChatStorage(session) {
  const key = storageKey(session);

  const load = () => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw); // { messages, timeline, phaseIdx, turnsInPhase, savedAt }
    } catch { return null; }
  };

  const save = (messages, timeline, phaseIdx, session, turnsInPhase) => {
    try {
      localStorage.setItem(key, JSON.stringify({
        messages, timeline, phaseIdx, turnsInPhase,
        // Persist enough session metadata to reconstruct on resume
        sessionName: session?.sessionName,
        playbook: session?.playbook,
        participants: session?.participants,
        facilitatorConfig: session?.facilitatorConfig,
        savedAt: new Date().toISOString(),
      }));
    } catch (e) {
      // Quota exceeded — prune oldest messages and retry once
      if (e.name === "QuotaExceededError") {
        try {
          const trimmed = messages.slice(-30);
          localStorage.setItem(key, JSON.stringify({
            messages: trimmed, timeline, phaseIdx, turnsInPhase,
            sessionName: session?.sessionName,
            playbook: session?.playbook,
            participants: session?.participants,
            facilitatorConfig: session?.facilitatorConfig,
            savedAt: new Date().toISOString(),
          }));
        } catch { /* silent */ }
      }
    }
  };

  const clear = () => { try { localStorage.removeItem(key); } catch { /* silent */ } };

  return { load, save, clear };
}

// ── Context summarizer ────────────────────────────────────────
// When the message array sent to Claude grows past SUMMARIZE_AFTER exchanges,
// the oldest SUMMARIZE_COUNT messages are replaced with a single summary block.
const SUMMARIZE_AFTER  = 20; // total messages before summarizing
const SUMMARIZE_COUNT  = 14; // how many old messages to collapse (must be even — full exchanges)

async function summarizeHistory(oldMessages, session, playbook, phase) {
  const toSummarize = oldMessages.slice(0, SUMMARIZE_COUNT);
  const convo = toSummarize
    .map(m => `${m.role === "ai" ? "Facilitator" : m.author || "Participant"}: ${m.text}`)
    .join("\n\n");
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6", max_tokens: 400,
        system: "You are summarizing a cybersecurity tabletop exercise conversation for context compression. Be concise and factual.",
        messages: [{
          role: "user",
          content: `Summarize the following tabletop exercise conversation in 3-5 sentences. Capture: decisions made, actions taken, key scenario developments, and any gaps identified. Do not editorialize.

Scenario: ${session.scenario.name}. Playbook: ${playbook.name}. Phase at time of conversation: ${phase}.

Conversation:
${convo}`,
        }],
      }),
    });
    const data = await resp.json();
    const summary = data.content?.find(b => b.type === "text")?.text || "";
    return {
      role: "ai",
      isSummary: true,
      text: `📝 [Earlier conversation summarized]\n\n${summary}`,
      time: toSummarize[toSummarize.length - 1]?.time || "",
    };
  } catch {
    // If summarization fails, just drop the oldest messages silently
    return null;
  }
}

// ── Exercise View ─────────────────────────────────────────────
function ExerciseView({ session, onEnd }) {
  const playbook = session.playbook;
  const phases = playbook.phases?.length
    ? playbook.phases
    : ["Preparation", "Detection & Analysis", "Containment", "Eradication", "Recovery", "Post-Incident"];

  const [phaseIdx, setPhaseIdx] = useState(0);
  const [turnsInPhase, setTurnsInPhase] = useState(0);
  const [messages, setMessages] = useState([]);
  const [timeline, setTimeline] = useState([{ label: "Exercise started", detail: `${session.scenario.name} · ${playbook.name}`, time: new Date().toLocaleTimeString() }]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("discussion");
  const [facilitatorConfig, setFacilitatorConfig] = useState(session.facilitatorConfig);
  const [confirmModal, setConfirmModal] = useState(null);
  const [multiMode, setMultiMode] = useState(false);

  const storage = useChatStorage(session);

  const currentPhase = phases[phaseIdx];
  const phaseGuidance = [
    "Confirm roles, channels, and tools. Ensure the playbook is accessible.",
    "Identify indicators of compromise. Classify severity. Notify stakeholders. Preserve evidence.",
    "Isolate affected systems. Block attacker paths. Prevent further damage.",
    "Remove malicious artifacts. Patch vulnerabilities. Validate systems are clean.",
    "Restore from known-good state. Validate functionality. Monitor closely.",
    "Document findings. Brief leadership. Update playbook. Plan next exercises.",
  ];

  const callClaude = async (msgs, system) => {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, system, messages: msgs })
    });
    const data = await resp.json();
    return data.content?.find(b => b.type === "text")?.text || "";
  };

  // Persist to localStorage after every message or phase change
  useEffect(() => {
    if (messages.length > 0) storage.save(messages, timeline, phaseIdx, session, turnsInPhase);
  }, [messages, timeline, phaseIdx, turnsInPhase]);

  // On mount: restore from resume data if passed, otherwise init fresh
  useEffect(() => {
    if (session._resumeData) {
      const r = session._resumeData;
      setMessages(r.messages || []);
      setTimeline(r.timeline || [{ label: "Session resumed", detail: session.scenario.name, time: new Date().toLocaleTimeString() }]);
      setPhaseIdx(r.phaseIdx || 0);
      setTurnsInPhase(r.turnsInPhase || 0);
    } else {
      initSession();
    }
  }, []);

  const getSystemPrompt = (turnOverride) =>
    buildSystemPrompt(facilitatorConfig, session.scenario, playbook, currentPhase, session.participants, turnOverride ?? turnsInPhase, facilitatorConfig.maxTurns);

  const initSession = async () => {
    setLoading(true);
    try {
      const text = await callClaude(
        [{ role: "user", content: `Begin the tabletop exercise. Set the scene in 2-3 paragraphs: describe the initial indicators of compromise for ${session.scenario.name} with specific, realistic technical details and timeline. Orient the team to the ${phases[0]} phase of ${playbook.name}. End by stating the situation as it currently stands — do not ask a question or suggest what the team should do. Wait for them to act.` }],
        getSystemPrompt()
      );
      setMessages([{ role: "ai", text, time: new Date().toLocaleTimeString() }]);
    } catch {
      setMessages([{ role: "ai", text: `Exercise initiated. Begin discussing your initial response to: ${session.scenario.description}`, time: new Date().toLocaleTimeString() }]);
    }
    setLoading(false);
  };

  // Build the API history, summarizing if it has grown too large
  const buildApiHistory = async (currentMessages) => {
    let msgs = [...currentMessages];
    if (msgs.length > SUMMARIZE_AFTER) {
      const summary = await summarizeHistory(msgs, session, playbook, currentPhase);
      if (summary) {
        msgs = [summary, ...msgs.slice(SUMMARIZE_COUNT)];
        // Update UI messages with summary replacing old entries
        setMessages(msgs);
      } else {
        // Fallback: just drop oldest messages
        msgs = msgs.slice(SUMMARIZE_COUNT);
      }
    }
    return msgs.map(m => ({
      role: m.role === "ai" ? "assistant" : "user",
      content: m.role === "ai" ? m.text : `${m.author || "Participant"}: ${m.text}`,
    }));
  };

  const sendMessage = async (userText) => {
    const participant = session.participants[0];
    const author = participant?.name || participant?.role || "Participant";
    const userMsg = { role: "user", author, text: userText, time: new Date().toLocaleTimeString() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setTimeline(prev => [...prev, { label: `${author} responded`, detail: userText.slice(0, 70) + (userText.length > 70 ? "…" : ""), time: new Date().toLocaleTimeString() }]);
    setLoading(true);
    const turnCount = turnsInPhase + 1;
    setTurnsInPhase(turnCount);
    try {
      const history = await buildApiHistory(updatedMessages);
      const text = await callClaude(history, getSystemPrompt(turnCount));
      setMessages(prev => [...prev, { role: "ai", text, time: new Date().toLocaleTimeString() }]);
      if (turnCount >= facilitatorConfig.maxTurns && phaseIdx < phases.length - 1) {
        advancePhase(true);
      }
    } catch {
      setMessages(prev => [...prev, { role: "ai", text: "Error. Please try again.", time: new Date().toLocaleTimeString() }]);
    }
    setLoading(false);
  };

  const sendMultiRoleMessage = async (responses) => {
    const filled = responses.filter(r => r.text.trim());
    if (!filled.length) return;
    const combinedText = formatMultiRoleMessage(filled);
    const userMsg = {
      role: "user",
      multi: true,
      authors: filled,
      text: combinedText,
      time: new Date().toLocaleTimeString(),
    };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setTimeline(prev => [
      ...prev,
      ...filled.map(r => ({
        label: `${r.name || r.role} responded (multi-role round)`,
        detail: r.text.slice(0, 70) + (r.text.length > 70 ? "…" : ""),
        time: new Date().toLocaleTimeString(),
      })),
    ]);
    setLoading(true);
    const turnCount = turnsInPhase + 1;
    setTurnsInPhase(turnCount);
    try {
      const history = await buildApiHistory(updatedMessages);
      const text = await callClaude(history, getSystemPrompt(turnCount));
      setMessages(prev => [...prev, { role: "ai", text, time: new Date().toLocaleTimeString() }]);
      if (turnCount >= facilitatorConfig.maxTurns && phaseIdx < phases.length - 1) {
        advancePhase(true);
      }
    } catch {
      setMessages(prev => [...prev, { role: "ai", text: "Error. Please try again.", time: new Date().toLocaleTimeString() }]);
    }
    setLoading(false);
    setMultiMode(false);
  };

  const injectScenario = (inj) => {
    const closing = getInjectClosing(inj.color);
    const msg = { role: "ai", text: `⚠️ INJECT: ${inj.title}\n\n${inj.text}\n\n${closing}`, time: new Date().toLocaleTimeString() };
    setMessages(prev => [...prev, msg]);
    setTimeline(prev => [...prev, { label: `Inject: ${inj.title}`, detail: inj.text.slice(0, 60) + "…", time: new Date().toLocaleTimeString() }]);
    setTab("discussion");
  };

  const advancePhase = (auto = false) => {
    if (phaseIdx >= phases.length - 1) return;
    const next = phases[phaseIdx + 1];
    setPhaseIdx(i => i + 1);
    setTurnsInPhase(0);
    setTimeline(prev => [...prev, {
      label: auto ? `Phase auto-advanced: ${next} (turn limit reached)` : `Phase: ${next}`,
      time: new Date().toLocaleTimeString(),
    }]);
    setMessages(prev => [...prev, {
      role: "ai",
      text: auto
        ? `⏱️ Turn limit reached for this phase. Moving into the **${next}** phase. What are your team's priorities and immediate actions at this stage?`
        : `Moving into the **${next}** phase. What are your team's priorities and immediate actions at this stage?`,
      time: new Date().toLocaleTimeString(),
    }]);
  };

  return (
    <>
      <div className="exercise-subheader">
        <div className="nav-tabs" style={{ borderBottom: "1px solid #1a2a3a" }}>
          {[["discussion", "💬 Discussion"], ["injects", "⚡ Injects"], ["timeline", "📅 Timeline"], ["participants", "👥 Participants"], ["settings", "⚙️ Settings"]].map(([id, label]) => (
            <button key={id} className={`nav-tab${tab === id ? " active" : ""}`} onClick={() => { setTab(id); window.scrollTo({ top: 0, behavior: "instant" }); }}>{label}</button>
          ))}
          <div style={{ flex: 1 }} />
          {/* End Early — always visible */}
          <button
            className="btn btn-ghost btn-sm"
            style={{ margin: "8px 6px 8px 0", color: "#f87171", borderColor: "rgba(220,38,38,0.3)" }}
            onClick={() => setConfirmModal("end-early")}
          >✕ End Early</button>
          {/* Next Phase / Complete */}
          {phaseIdx < phases.length - 1
            ? <button className="btn btn-ghost btn-sm" style={{ margin: "8px 0" }} onClick={() => advancePhase(false)}>Next Phase →</button>
            : <button className="btn btn-success btn-sm" style={{ margin: "8px 0" }} onClick={() => setConfirmModal("complete")}>Complete Exercise ✓</button>}
        </div>
        <div style={{ padding: "10px 24px 12px", background: "#0a0f18" }}>
          <div style={{ fontSize: 11, color: turnsInPhase >= facilitatorConfig.maxTurns - 1 ? "#f87171" : "#4a6a8a", fontFamily: "'Share Tech Mono', monospace", marginBottom: 8 }}>
            Turn {Math.min(turnsInPhase + (phaseIdx < phases.length - 1 ? 1 : 0), facilitatorConfig.maxTurns)} of {facilitatorConfig.maxTurns} this phase
          </div>
          <div className="phases">
            {phases.map((p, i) => (
              <div key={i} className={`phase-item${i === phaseIdx ? " active" : i < phaseIdx ? " done" : ""}`}>
                {i > 0 && <div className="phase-dot" />}
                <div style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", marginBottom: 2, opacity: 0.7 }}>{i < phaseIdx ? "✓ " : ""}{String(i + 1).padStart(2, "0")}</div>
                <div>{p}</div>
              </div>
            ))}
          </div>
          <div className="progress-bar" style={{ marginTop: 8 }}>
            <div className="progress-fill" style={{ width: `${(phaseIdx / Math.max(phases.length - 1, 1)) * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="main" style={{ paddingBottom: 60 }}>
        {tab === "discussion" && (
          <div className="grid-2 gap-4">
            <AIChat
              scenario={session.scenario}
              phase={currentPhase}
              messages={messages}
              onMessage={sendMessage}
              loading={loading}
              onAdvancePhase={() => advancePhase(false)}
              isLastPhase={phaseIdx >= phases.length - 1}
              participants={session.participants}
              multiMode={multiMode}
              onToggleMultiMode={() => setMultiMode(v => !v)}
              onMultiSend={sendMultiRoleMessage}
              hideScenarioName={session.usedRandomizer}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="card">
                <div className="card-title">SCENARIO BRIEF</div>
                {session.usedRandomizer ? (
                  <>
                    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
                      <span style={{ fontSize: 28 }}>🎲</span>
                      <div>
                        <div style={{ fontWeight: 600, color: "#e0eaff", marginBottom: 4 }}>Mystery Scenario</div>
                        <span className="tag" style={{ background: "rgba(124,58,237,0.15)", color: "#a78bfa", border: "1px solid rgba(124,58,237,0.3)" }}>🎲 Randomized</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: "#6b82a0", lineHeight: 1.6 }}>
                      This scenario was randomly selected. Your team won't know what you're facing — read the facilitator's updates carefully and respond to what unfolds.
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
                      <span style={{ fontSize: 28 }}>{session.scenario.icon}</span>
                      <div>
                        <div style={{ fontWeight: 600, color: "#e0eaff", marginBottom: 4 }}>{session.scenario.name}</div>
                        <span className={`badge badge-severity-${session.scenario.severity}`}>{session.scenario.severity}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: "#6b82a0", lineHeight: 1.6 }}>{session.scenario.description}</div>
                  </>
                )}
              </div>
              <div className="card">
                <div className="card-title">PHASE FOCUS · {currentPhase.toUpperCase()}</div>
                <div style={{ fontSize: 13, color: "#6b82a0", lineHeight: 1.7 }}>{phaseGuidance[Math.min(phaseIdx, phaseGuidance.length - 1)]}</div>
              </div>
              <div className="card">
                <div className="card-title">ACTIVE PARTICIPANTS</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {session.participants.map((p, i) => (
                    <div key={i} className="participant-row" style={{ padding: "7px 12px" }}>
                      <div className="participant-dot" />
                      <div className="participant-name">{p.name || p.role}</div>
                      <div className="participant-role">{p.role}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "injects" && (
          <div className="grid-2 gap-4">
            <InjectPanel scenario={session.scenario} onInject={injectScenario} />
            <CustomInject onInject={injectScenario} />
          </div>
        )}

        {tab === "timeline" && (
          <div style={{ maxWidth: 680 }}>
            <div className="card">
              <div className="card-title">EXERCISE TIMELINE</div>
              <div className="timeline">
                {timeline.map((e, i) => (
                  <div key={i} className="tl-entry">
                    <div className="tl-line">
                      <div className="tl-dot" style={{ background: i === 0 ? "#22c55e" : "#1d4ed8" }} />
                      {i < timeline.length - 1 && <div className="tl-rule" />}
                    </div>
                    <div className="tl-body">
                      <div className="tl-time">{e.time}</div>
                      <div className="tl-label">{e.label}</div>
                      {e.detail && <div className="tl-detail">{e.detail}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "participants" && (
          <div style={{ maxWidth: 560 }}>
            <div className="card">
              <div className="card-title">ACTIVE PARTICIPANTS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {session.participants.map((p, i) => (
                  <div key={i} className="participant-row">
                    <div className="participant-dot" />
                    <div className="participant-name">{p.name || p.role}</div>
                    <div className="participant-role">{p.role}</div>
                    <div style={{ marginLeft: "auto" }}><span className="badge badge-live">Active</span></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "settings" && (
          <div style={{ maxWidth: 760 }}>
            <div className="card">
              <div className="card-title">AI FACILITATOR SETTINGS</div>
              <div style={{ fontSize: 12, color: "#2a4a6a", marginBottom: 16, padding: "8px 12px", background: "rgba(29,78,216,0.06)", borderRadius: 6, border: "1px solid rgba(29,78,216,0.15)" }}>
                Changes here take effect on the <strong style={{ color: "#60a5fa" }}>next message</strong> — the facilitator adapts mid-exercise.
              </div>
              <FacilitatorSettings
                config={facilitatorConfig}
                onChange={setFacilitatorConfig}
                scenario={session.scenario}
                playbook={session.playbook}
                participants={session.participants}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Confirmation modals ── */}
      {confirmModal === "end-early" && (
        <ConfirmModal
          icon="⚠️"
          title="End this exercise early?"
          body={`You're currently in the ${currentPhase} phase with ${messages.reduce((acc, m) => m.role === "ai" ? acc : acc + (m.multi ? m.authors.length : 1), 0)} responses logged. Ending early will stop the exercise and take you to the After-Action Report. This cannot be undone.`}
          confirmLabel="End Exercise"
          confirmStyle={{ background: "rgba(220,38,38,0.2)", color: "#f87171", border: "1px solid rgba(220,38,38,0.4)" }}
          onConfirm={() => {
            setConfirmModal(null);
            lastPlayedStorage.save(session.scenario, session.playbook, session.sessionName);
            storage.clear();
            onEnd(messages, timeline);
          }}
          onCancel={() => setConfirmModal(null)}
        />
      )}
      {confirmModal === "complete" && (
        <ConfirmModal
          icon="✅"
          title="Complete the exercise?"
          body="This will end the session and generate your After-Action Report. Make sure your team has finished discussing the final phase before proceeding."
          confirmLabel="Complete Exercise ✓"
          confirmStyle={{ background: "rgba(22,163,74,0.2)", color: "#4ade80", border: "1px solid rgba(22,163,74,0.4)" }}
          onConfirm={() => {
            setConfirmModal(null);
            lastPlayedStorage.save(session.scenario, session.playbook, session.sessionName);
            storage.clear();
            onEnd(messages, timeline);
          }}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </>
  );
}

// ── Root ──────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("landing"); // landing | resume | setup | exercise | aar
  const [session, setSession] = useState(null);
  const [exerciseData, setExerciseData] = useState({ messages: [], timeline: [], duration: 0 });
  const [savedSession, setSavedSession] = useState(null); // active unfinished session found in localStorage
  const [lastPlayed, setLastPlayed] = useState(null);     // most recently completed scenario
  const startTimeRef = useRef(null);

  // Load lastPlayed on mount — always show it on scenario selection
  useEffect(() => {
    setLastPlayed(lastPlayedStorage.load());
  }, []);

  const handleBegin = () => {
    // Check for an active unfinished session
    const allKeys = Object.keys(localStorage).filter(k => k.startsWith("tactician:") && k !== LAST_PLAYED_KEY);
    const found = allKeys.map(k => {
      try { return { key: k, ...JSON.parse(localStorage.getItem(k)) }; } catch { return null; }
    }).filter(Boolean).find(s => s.messages?.length > 0);

    if (found) {
      setSavedSession(found);
      setScreen("resume");
    } else {
      setScreen("setup");
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const handleResumeSession = () => {
    // Reconstruct a minimal session object from the saved data so ExerciseView can render
    // The full session config was saved inside the storage key name — we pass savedSession
    // directly through to ExerciseView via a special resume path
    setSavedSession(prev => prev); // keep it; ExerciseView will read from localStorage by key
    // We need to rebuild the session from the storage key and stored scenario info.
    // Since we only have metadata in the key, we match against SCENARIOS + INDUSTRY_PLAYBOOKS.
    const keyParts = savedSession.key.replace("tactician:", "").split(":");
    const scenarioId = keyParts[keyParts.length - 1];
    const scenario = SCENARIOS.find(s => s.id === scenarioId) || SCENARIOS[0];
    // Reconstruct playbook — prefer saved object, then match by name, then default to CISA
    const savedPlaybook = savedSession.playbook;
    const playbook = savedPlaybook?.phases?.length
      ? savedPlaybook
      : INDUSTRY_PLAYBOOKS.find(pb => pb.name === savedPlaybook?.name) || INDUSTRY_PLAYBOOKS[0];

    // Build a minimal session — participants and facilitatorConfig from saved data or defaults
    const restoredSession = {
      scenario,
      playbook,
      participants: savedSession.participants || [{ role: "Facilitator", name: "", id: "Facilitator", active: true }],
      sessionName: savedSession.sessionName || keyParts.slice(0, -1).join(" "),
      facilitatorConfig: savedSession.facilitatorConfig || { ...DEFAULT_FACILITATOR },
      _resumeData: savedSession,
    };
    setSession(restoredSession);
    startTimeRef.current = Date.now();
    setScreen("exercise");
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const handleStartNew = () => {
    setSavedSession(null);
    setScreen("setup");
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const handleStart = (s) => {
    setSession(s);
    startTimeRef.current = Date.now();
    setScreen("exercise");
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const handleEnd = (messages, timeline) => {
    const duration = Math.floor((Date.now() - (startTimeRef.current || Date.now())) / 1000);
    setExerciseData({ messages, timeline, duration });
    setLastPlayed(lastPlayedStorage.load()); // refresh after exercise writes lastPlayed
    setScreen("aar");
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const handleNewScenario = () => {
    setSession(null);
    setSavedSession(null);
    setExerciseData({ messages: [], timeline: [], duration: 0 });
    startTimeRef.current = null;
    setLastPlayed(lastPlayedStorage.load());
    setScreen("setup");
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#080c10" }}>
      <FontStyle />
      <Topbar
        sessionName={session?.sessionName}
        stopped={screen === "aar"}
        finalDuration={exerciseData.duration}
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {screen === "landing" && <LandingPage onBegin={handleBegin} />}

        {/* Resume prompt — shown between landing and setup when an active session is found */}
        {screen === "resume" && savedSession && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
            <div className="card" style={{ textAlign: "center", padding: "36px 32px", maxWidth: 480, width: "100%" }}>
              <div style={{ fontSize: 36, marginBottom: 16 }}>💾</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#e0eaff", marginBottom: 8 }}>
                Unfinished Session Found
              </div>
              <div style={{ fontSize: 13, color: "#4a6a8a", lineHeight: 1.7, marginBottom: 24 }}>
                You have an unfinished exercise saved.<br />
                <span style={{ color: "#7cb3f5", fontFamily: "'Share Tech Mono', monospace" }}>
                  {savedSession.sessionName || "Unnamed Session"}
                </span>
                <br />
                <span style={{ fontSize: 12, color: "#3a5a7a" }}>
                  {savedSession.messages?.length || 0} messages · Last saved {savedSession.savedAt ? new Date(savedSession.savedAt).toLocaleString() : "recently"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <button className="btn btn-primary" onClick={handleResumeSession}>
                  ↩ Resume Session
                </button>
                <button className="btn btn-ghost" onClick={handleStartNew}>
                  + Start New Exercise
                </button>
              </div>
            </div>
          </div>
        )}

        {screen === "setup" && <ParticipantSetup onStart={handleStart} lastPlayed={lastPlayed} />}
        {screen === "exercise" && session && (
          <ExerciseView
            session={session}
            onEnd={handleEnd}
          />
        )}
        {screen === "aar" && session && (
          <AARView
            session={session}
            timeline={exerciseData.timeline}
            messages={exerciseData.messages}
            duration={exerciseData.duration}
            onNewScenario={handleNewScenario}
          />
        )}
      </div>
      <Footer />
    </div>
  );
}
