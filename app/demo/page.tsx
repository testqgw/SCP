"use client";

import Link from "next/link";
import { Logo } from "@/components/Logo";
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
              See UltOps in Action
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
        © {new Date().getFullYear()} UltOps Inc.
      </footer>
    </div>
  );
}

// 🕹️ THE SIMULATOR COMPONENT
function DemoSimulator() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");

  // Animation Script
  useEffect(() => {
    let timeout: any;

    const runSimulation = async () => {
      // 1. Select Business (Instant)
      setStep(1);
      await new Promise(r => setTimeout(r, 500));

      // 2. Type License Name
      setStep(2);
      const fullText = "Health Permit 2025";
      for (let i = 0; i <= fullText.length; i++) {
        await new Promise(r => setTimeout(r, 50));
        setName(fullText.slice(0, i));
      }

      // 3. Fill License Number
      await new Promise(r => setTimeout(r, 400));
      setStep(3);

      // 4. Fill Issuing Authority
      await new Promise(r => setTimeout(r, 400));
      setStep(4);

      // 5. Set Issue Date
      await new Promise(r => setTimeout(r, 400));
      setStep(5);

      // 6. Set Expiration Date (Crucial Step)
      await new Promise(r => setTimeout(r, 400));
      setStep(6);

      // 7. Fill Renewal URL
      await new Promise(r => setTimeout(r, 400));
      setStep(7);

      // 8. Click "Track License"
      await new Promise(r => setTimeout(r, 800));
      setStep(8); // Loading state

      // 9. Success & SMS Arrival
      await new Promise(r => setTimeout(r, 1500));
      setStep(9); // Phone notification

      // 10. Reset Loop
      await new Promise(r => setTimeout(r, 8000)); // Longer pause at the end
      setStep(0);
      setName("");
    };

    if (step === 0) timeout = setTimeout(runSimulation, 1000);
    return () => clearTimeout(timeout);
  }, [step]);

  return (
    <div className="relative w-full max-w-6xl mx-auto bg-slate-50 rounded-xl shadow-2xl overflow-hidden flex flex-col lg:flex-row border border-slate-200 font-sans text-slate-900 text-left">

      {/* LEFT: REAL DASHBOARD REPLICA */}
      <div className="flex-1 p-8 overflow-hidden">
        <h1 className="text-2xl font-bold text-slate-900 mb-8">Manage Licenses</h1>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <span className="text-blue-600 text-xl font-bold">+</span> Add New License
          </h2>

          <div className="space-y-4">
            {/* Row 1: Business & Name */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Business *</label>
                <div className={`w-full p-2 border rounded-md bg-white border-slate-300 transition-colors ${step >= 1 ? "text-slate-900" : "text-transparent"}`}>
                  {step >= 1 ? "Joe's Food Truck" : "Select..."}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">License Name *</label>
                <div className="w-full h-[38px] border rounded-md bg-white border-slate-300 flex items-center px-2 text-slate-900 relative">
                  {name}
                  {step === 2 && <span className="w-0.5 h-5 bg-blue-600 animate-pulse ml-0.5"></span>}
                </div>
              </div>
            </div>

            {/* Row 2: Number & Authority */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">License Number</label>
                <div className={`w-full h-[38px] border rounded-md bg-white border-slate-300 flex items-center px-2 transition-colors text-slate-900 ${step >= 3 ? "text-slate-900" : "text-transparent"}`}>
                  {step >= 3 ? "HK-882-09" : ""}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Issuing Authority</label>
                <div className={`w-full h-[38px] border rounded-md bg-white border-slate-300 flex items-center px-2 transition-colors text-slate-900 ${step >= 4 ? "text-slate-900" : "text-transparent"}`}>
                  {step >= 4 ? "City Hall Dept of Health" : ""}
                </div>
              </div>
            </div>

            {/* Row 3: Dates */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Issue Date</label>
                <div className={`w-full h-[38px] border rounded-md bg-white border-slate-300 flex items-center px-2 text-slate-900 ${step >= 5 ? "text-slate-900" : "text-transparent"}`}>
                  {step >= 5 ? "2024-01-01" : ""}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Expiration Date *</label>
                <div className={`w-full h-[38px] border rounded-md bg-white border-slate-300 flex items-center px-2 ${step >= 6 ? "text-slate-900" : "text-transparent"}`}>
                  {step >= 6 ? "2025-12-31" : ""}
                </div>
              </div>
            </div>

            {/* Row 4: URL */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Renewal URL</label>
              <div className={`w-full h-[38px] border rounded-md bg-white border-slate-300 flex items-center px-2 text-blue-600 overflow-hidden ${step >= 7 ? "opacity-100" : "opacity-0"}`}>
                {step >= 7 ? "https://city.gov/renewals/portal" : ""}
              </div>
            </div>

            {/* Button */}
            <button className={`bg-blue-600 text-white px-6 py-2 rounded-md font-medium w-full sm:w-auto transition-all duration-300 ${step === 8 ? "opacity-80 scale-95" : step === 9 ? "bg-green-600" : ""}`}>
              {step === 8 ? "Saving..." : step === 9 ? "License Tracked!" : "Track License"}
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT: PHONE PREVIEW (SMS) */}
      <div className="w-full lg:w-96 bg-[#0B1120] p-8 flex flex-col items-center justify-center relative border-l border-slate-800 min-h-[600px]">
        <div className="absolute inset-0 bg-blue-600/5"></div>
        <div className="text-slate-400 text-xs font-medium mb-6 uppercase tracking-widest">Your Phone</div>

        {/* Phone Body */}
        <div className="relative z-10 w-64 h-[500px] bg-black border-[8px] border-gray-800 rounded-[45px] shadow-2xl overflow-hidden ring-1 ring-white/10">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-6 bg-black rounded-b-2xl z-20"></div>

          {/* Screen */}
          <div className="w-full h-full bg-slate-100 relative pt-10 px-4 flex flex-col font-sans">
            <div className="text-center text-gray-400 text-[10px] mb-6">Today 9:41 AM</div>

            {/* Incoming Message Animation */}
            <div className={`transform transition-all duration-500 ease-out ${step === 9 ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"}`}>
              <div className="flex flex-col gap-1">
                <div className="bg-[#E9E9EB] text-black text-xs p-3 rounded-2xl rounded-bl-none shadow-sm max-w-[85%] self-start">
                  <strong>UltOps:</strong> Tracking enabled for "Health Permit 2025".
                </div>
                <div className="bg-[#E9E9EB] text-black text-xs p-3 rounded-2xl rounded-bl-none shadow-sm max-w-[85%] self-start delay-100">
                  We will text you 90 days before it expires on 12/31/2025.
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

    </div>
  );
}