import Link from "next/link";
import { ArrowRight, Bell, ShieldCheck, Smartphone, FileText, Check } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0B1120] text-white font-sans overflow-hidden relative selection:bg-blue-500/30">
      
      {/* BACKGROUND EFFECTS */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-blue-600/15 blur-[120px] rounded-full pointer-events-none" />
      
      {/* NAVBAR */}
      <nav className="relative z-20 mx-auto max-w-7xl px-6 lg:px-8 pt-6 flex justify-between items-center">
        <div className="text-xl font-bold tracking-tight flex items-center gap-2 cursor-default">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-900/20">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <span>Safe<span className="text-blue-400">Ops</span></span>
        </div>
        
        <div className="flex items-center gap-6">
          <Link href="/sign-in" className="text-sm font-medium text-slate-300 hover:text-white transition-colors hidden sm:block">
            Log in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-full bg-white/10 border border-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20 transition-all"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* HERO SECTION */}
      <main className="relative z-10 pt-20 pb-20 lg:pt-32 lg:pb-32">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 text-center">
          
          {/* Trust Pill */}
          <div className="inline-flex items-center rounded-full border border-blue-500/30 bg-blue-900/20 px-4 py-1.5 text-sm font-medium text-blue-300 mb-8 shadow-[0_0_15px_-5px_rgba(59,130,246,0.5)]">
            <span className="flex h-2 w-2 rounded-full bg-blue-400 mr-2 animate-pulse"></span>
            New: SMS Alerts for Contractors
          </div>

          {/* Headline */}
          <h1 className="mx-auto max-w-5xl text-5xl font-bold tracking-tight text-white sm:text-7xl mb-8 leading-tight">
            Stop Losing Revenue to <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">
              Expired Licenses
            </span>
          </h1>

          {/* Human Bio (No AI nonsense) */}
          <p className="mx-auto max-w-2xl text-lg leading-8 text-slate-400 mb-10">
            The "set-it-and-forget-it" tool for busy business owners. 
            We track your permits and insurance. You get a text message before you get fined. 
            Simple as that.
          </p>

          {/* Primary CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20">
            <Link
              href="/sign-up"
              className="w-full sm:w-auto rounded-lg bg-blue-600 px-8 py-4 text-sm font-semibold text-white shadow-lg shadow-blue-900/30 hover:bg-blue-500 hover:shadow-blue-900/50 hover:-translate-y-0.5 transition-all duration-200 flex items-center justify-center gap-2 group"
            >
              Start Free Trial <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              href="/sign-in"
              className="w-full sm:w-auto rounded-lg px-8 py-4 text-sm font-semibold text-white border border-slate-800 bg-slate-900/50 hover:bg-slate-800 hover:border-slate-700 transition-all"
            >
              View Demo
            </Link>
          </div>

          {/* VISUAL DEMO: The "App Preview" */}
          <div className="relative max-w-4xl mx-auto">
             {/* Glow behind the card */}
             <div className="absolute inset-0 bg-blue-500/5 blur-3xl rounded-full" />
             
             {/* The Main Card */}
             <div className="relative bg-[#0F172A] border border-slate-800 rounded-2xl p-1 shadow-2xl">
                <div className="bg-[#0B1120] rounded-xl border border-slate-800/50 p-8 flex flex-col items-center sm:flex-row gap-8">
                   
                   {/* Left side: Status */}
                   <div className="flex-1 text-left">
                      <div className="flex items-center gap-2 mb-4">
                         <div className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
                         <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Urgent Alert</span>
                      </div>
                      <h3 className="text-2xl font-semibold text-white mb-2">Health Permit Expiring</h3>
                      <p className="text-slate-400 mb-6">Your Mobile Food Vendor Permit #HK-882 expires in <span className="text-red-400 font-bold">3 days</span>.</p>
                      
                      {/* Progress Bar */}
                      <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                         <div className="bg-red-500 h-full w-[92%]" />
                      </div>
                      <p className="text-xs text-right text-slate-500 mt-2">92% of duration used</p>
                   </div>

                   {/* Right side: The SMS Preview */}
                   <div className="w-full sm:w-72 bg-slate-900 rounded-lg border border-slate-800 p-4 relative">
                      <div className="absolute -top-2 -right-2 bg-blue-600 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-lg">
                         SMS PREVIEW
                      </div>
                      <div className="flex gap-3 mb-4">
                         <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                            <ShieldCheck className="w-4 h-4 text-slate-400" />
                         </div>
                         <div className="bg-slate-800 rounded-2xl rounded-tl-none p-3 text-sm text-slate-300 shadow-sm">
                            <p>⚠️ <span className="font-bold text-white">Compliance Alert:</span> Your Health Permit expires in 3 days.</p>
                            <p className="mt-2 text-blue-400 underline cursor-pointer">Renew now to avoid fines</p>
                         </div>
                      </div>
                      <div className="text-center">
                         <span className="text-[10px] text-slate-600">Sent via Automated Cron Job • 9:00 AM</span>
                      </div>
                   </div>

                </div>
             </div>
          </div>

        </div>
      </main>

      {/* FEATURES SECTION */}
      <section className="relative z-10 py-24 bg-[#0F172A] border-t border-slate-800">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-blue-400 font-semibold tracking-wide uppercase text-sm">Features</h2>
            <p className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
               Everything you need to stay safe
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            {/* Feature 1 */}
            <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 hover:border-blue-500/30 transition-colors group">
              <div className="w-12 h-12 rounded-lg bg-blue-900/20 flex items-center justify-center mb-4 group-hover:bg-blue-900/30 transition-colors">
                <Smartphone className="w-6 h-6 text-blue-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">SMS-First Alerts</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                We text you because we know you aren't sitting at a computer. Get notified on the job site.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 hover:border-indigo-500/30 transition-colors group">
              <div className="w-12 h-12 rounded-lg bg-indigo-900/20 flex items-center justify-center mb-4 group-hover:bg-indigo-900/30 transition-colors">
                <FileText className="w-6 h-6 text-indigo-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Document Vault</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Snap a photo of your permit and store it securely. Access your history instantly during an audit.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 hover:border-sky-500/30 transition-colors group">
              <div className="w-12 h-12 rounded-lg bg-sky-900/20 flex items-center justify-center mb-4 group-hover:bg-sky-900/30 transition-colors">
                <ShieldCheck className="w-6 h-6 text-sky-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Audit Protection</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Prove your compliance instantly. We track every renewal so you have a paper trail.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER (New) */}
      <footer className="bg-[#0B1120] border-t border-slate-800 py-12">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-6">
           <div className="flex items-center gap-2">
             <div className="w-6 h-6 bg-slate-800 rounded flex items-center justify-center">
                <ShieldCheck className="w-3 h-3 text-slate-400" />
             </div>
             <span className="text-slate-400 font-semibold text-sm">Compliance Reminder SaaS</span>
           </div>
           <div className="text-slate-600 text-sm">
             © {new Date().getFullYear()} All rights reserved.
           </div>
        </div>
      </footer>
    </div>
  );
}