"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { ArrowRight, CheckCircle, ShieldCheck, Bell, Smartphone, Loader2 } from "lucide-react";

export default function DemoPage() {
  return (
    <div className="min-h-screen bg-[#0B1120] text-white font-sans selection:bg-blue-500/30">

      {/* NAV */}
      <nav className="mx-auto max-w-7xl px-6 lg:px-8 pt-6 flex justify-between items-center">
        <Link href="/" className="text-xl font-bold tracking-tight flex items-center gap-2">
          <Logo className="w-8 h-8" />
          <span>Safe<span className="text-blue-400">Ops</span></span>
        </Link>
        <Link href="/sign-up" className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-all">
          Start Free
        </Link>
      </nav>

      <main className="relative z-10 py-16 lg:py-24">
        <div className="mx-auto max-w-6xl px-6 lg:px-8">

          <div className="text-center mb-16">
            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl mb-6">
              See SafeOps in Action
            </h1>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto">
              No video buffering. Watch our code simulate exactly how you secure your business in 3 steps.
            </p>
          </div>

          {/* 🎬 THE LIVE SIMULATOR */}
          <DemoSimulator />

          {/* FINAL CTA */}
          <div className="mt-32 bg-gradient-to-br from-blue-900/50 to-slate-900 border border-blue-800/30 rounded-3xl p-12 text-center">
            <h2 className="text-3xl font-bold text-white mb-6">Seen enough?</h2>
            <p className="text-slate-400 mb-8 max-w-xl mx-auto">
              It actually is that simple. Create your account and track your first license for free.
            </p>
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-8 py-4 text-sm font-semibold text-white shadow-lg hover:bg-blue-500 transition-all gap-2"
            >
              Create Free Account <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

        </div>
      </main>

      <footer className="bg-[#0B1120] border-t border-slate-800 py-12 text-center text-slate-600 text-sm">
        © {new Date().getFullYear()} SafeOps Inc.
      </footer>
    </div>
  );
}

// 🕹️ THE SIMULATOR COMPONENT
function DemoSimulator() {
  const [step, setStep] = useState(0);
  const [text, setText] = useState("");
  const [date, setDate] = useState("");

  useEffect(() => {
    let timeout: any;
    const runSimulation = async () => {
      // 1. Type License Name
      setStep(1);
      const fullText = "Health Permit 2025";
      for (let i = 0; i <= fullText.length; i++) {
        await new Promise(r => setTimeout(r, 80));
        setText(fullText.slice(0, i));
      }

      // 2. Select Date
      await new Promise(r => setTimeout(r, 500));
      setStep(2);
      setDate("2025-12-31");

      // 3. Click Save
      await new Promise(r => setTimeout(r, 800));
      setStep(3);

      // 4. Success & SMS
      await new Promise(r => setTimeout(r, 1500));
      setStep(4);

      // 5. Reset
      await new Promise(r => setTimeout(r, 6000));
      setStep(0);
      setText("");
      setDate("");
    };

    if (step === 0) timeout = setTimeout(runSimulation, 1000);
    return () => clearTimeout(timeout);
  }, [step]);

  return (
    <div className="relative w-full max-w-5xl mx-auto bg-slate-50 rounded-xl shadow-2xl overflow-hidden flex flex-col md:flex-row border border-slate-200 font-sans text-slate-900">

      {/* LEFT: MOCK DASHBOARD (Exact Replica of Real UI) */}
      <div className="flex-1 p-6">
        {/* Mock Header */}
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center"><div className="w-2 h-2 bg-white rounded-full"></div></div>
            <span className="font-bold text-lg text-slate-900">SafeOps</span>
          </div>
          <div className="flex gap-3 text-sm font-medium text-slate-500">
            <span>Dashboard</span>
            <span className="text-blue-600">Licenses</span>
            <span>Settings</span>
          </div>
        </div>

        {/* Mock Form */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800 mb-4">Add New License</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">License Name</label>
              <div className="h-10 w-full bg-white rounded border border-slate-300 flex items-center px-3 text-sm relative">
                {text}
                {step === 1 && <span className="w-0.5 h-4 bg-blue-600 animate-pulse ml-0.5"></span>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Issue Date</label>
                <div className="h-10 w-full bg-white rounded border border-slate-300 flex items-center px-3 text-sm text-slate-400">2024-01-01</div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Expiration Date</label>
                <div className={`h-10 w-full rounded border flex items-center px-3 text-sm transition-colors ${step >= 2 ? "bg-white border-slate-300 text-slate-900" : "bg-slate-50 border-slate-200"}`}>
                  {date}
                </div>
              </div>
            </div>
            <button className={`w-full h-10 rounded font-medium text-sm transition-all flex items-center justify-center gap-2 ${step === 3 ? "bg-blue-700 text-white" : step === 4 ? "bg-green-600 text-white" : "bg-blue-600 text-white"}`}>
              {step === 3 ? "Saving..." : step === 4 ? "Saved Successfully!" : "Track License"}
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT: REALISTIC PHONE PREVIEW */}
      <div className="w-full md:w-80 bg-[#0B1120] p-8 flex flex-col items-center justify-center relative border-l border-slate-800">
        <div className="absolute inset-0 bg-blue-600/5"></div>
        <div className="text-slate-400 text-xs font-medium mb-4 uppercase tracking-widest">Customer View</div>

        {/* Phone Body */}
        <div className="relative z-10 w-60 h-[450px] bg-black border-[6px] border-gray-800 rounded-[35px] shadow-2xl overflow-hidden">
          {/* Notch */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-20 h-5 bg-black rounded-b-xl z-20"></div>

          {/* Screen */}
          <div className="w-full h-full bg-slate-100 relative pt-8 px-3 flex flex-col">
            <div className="text-center text-gray-400 text-[10px] mb-4">Today 9:41 AM</div>

            {/* Message Bubble */}
            <div className={`transform transition-all duration-500 ${step === 4 ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"}`}>
              <div className="bg-blue-500 text-white text-xs p-3 rounded-2xl rounded-tl-none shadow-sm mb-1 max-w-[90%]">
                <strong>SafeOps Alert:</strong> Tracking enabled for "Health Permit 2025". We will alert you 90 days before it expires.
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}