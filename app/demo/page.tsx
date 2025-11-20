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
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
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
  const [step, setStep] = useState(0); // 0=Idle, 1=Typing, 2=Saving, 3=Done/SMS
  const [text, setText] = useState("");
  
  // The Automation Script
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    
    const runSimulation = async () => {
      // Step 1: Start typing "Health Permit"
      setStep(1);
      const fullText = "Health Permit 2025";
      for (let i = 0; i <= fullText.length; i++) {
        await new Promise(r => setTimeout(r, 100)); // Typing speed
        setText(fullText.slice(0, i));
      }

      // Step 2: Pause, then click Save
      await new Promise(r => setTimeout(r, 800)); 
      setStep(2); // Loading state

      // Step 3: Simulate Network Request
      await new Promise(r => setTimeout(r, 1500)); 
      setStep(3); // Success & SMS

      // Step 4: Reset after 5 seconds
      await new Promise(r => setTimeout(r, 6000));
      setStep(0);
      setText("");
    };

    // Start loop
    if (step === 0) {
      timeout = setTimeout(runSimulation, 1000);
    }

    return () => clearTimeout(timeout);
  }, [step]);

  return (
    <div className="relative w-full max-w-4xl mx-auto bg-slate-950 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col md:flex-row">
      
      {/* LEFT: The Mock Dashboard */}
      <div className="flex-1 p-8 border-r border-slate-800/50">
        <div className="flex items-center gap-2 mb-8 opacity-50">
           <div className="w-3 h-3 rounded-full bg-red-500"></div>
           <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
           <div className="w-3 h-3 rounded-full bg-green-500"></div>
        </div>

        <div className="space-y-6">
           <div>
              <label className="block text-xs font-medium text-slate-500 uppercase mb-2">License Name</label>
              <div className="h-12 w-full bg-slate-900 rounded-lg border border-slate-700 flex items-center px-4 text-white relative">
                 {text}
                 {step === 1 && <span className="w-0.5 h-5 bg-blue-500 animate-pulse ml-1"></span>}
              </div>
           </div>

           <div>
              <label className="block text-xs font-medium text-slate-500 uppercase mb-2">Expiration Date</label>
              <div className="h-12 w-full bg-slate-900 rounded-lg border border-slate-700 flex items-center px-4 text-slate-400">
                 Dec 31, 2025
              </div>
           </div>

           <button 
             className={`w-full h-12 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
               step === 2 ? "bg-blue-600/50 text-blue-200" : 
               step === 3 ? "bg-green-600 text-white" : "bg-blue-600 text-white"
             }`}
           >
             {step === 2 ? <><Loader2 className="w-4 h-4 animate-spin"/> Saving...</> : 
              step === 3 ? <><CheckCircle className="w-4 h-4"/> Saved!</> : "Add License"}
           </button>
        </div>
      </div>

      {/* RIGHT: The Mock Phone (SMS) */}
      <div className="w-full md:w-80 bg-slate-900 p-8 flex flex-col items-center justify-center relative overflow-hidden">
         <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-900/20 to-transparent"></div>
         
         {/* Phone Body */}
         <div className="relative z-10 w-56 h-96 bg-[#0F172A] border-4 border-slate-800 rounded-[30px] shadow-xl p-4 flex flex-col">
            <div className="w-16 h-4 bg-slate-800 rounded-full mx-auto mb-6"></div>
            
            {/* The Screen */}
            <div className="flex-1 relative">
               <div className="text-center text-slate-600 text-xs mb-4">Today 9:41 AM</div>
               
               {/* SMS BUBBLE - Only shows in Step 3 */}
               <div className={`transform transition-all duration-500 ${step === 3 ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"}`}>
                  <div className="bg-blue-600 text-white text-xs p-3 rounded-2xl rounded-tl-none shadow-lg mb-2">
                     <strong>SafeOps:</strong> License "Health Permit 2025" tracked successfully. We will alert you 90 days before expiration.
                  </div>
                  <div className="text-[10px] text-slate-500 ml-2">Just now</div>
               </div>
            </div>

            {/* Home Bar */}
            <div className="w-20 h-1 bg-slate-700 rounded-full mx-auto mt-auto"></div>
         </div>

         {/* Connection Line */}
         {step === 3 && (
            <div className="absolute left-0 top-1/2 w-12 h-0.5 bg-gradient-to-r from-transparent to-blue-500 md:block hidden"></div>
         )}
      </div>

    </div>
  );
}