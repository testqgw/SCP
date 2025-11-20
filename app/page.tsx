import Link from "next/link";
import { ArrowRight, Bell, ShieldCheck, Smartphone, FileText, Check, CreditCard } from "lucide-react";

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
          {/* SAFE OPS BRANDING */}
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
          
          <div className="inline-flex items-center rounded-full border border-blue-500/30 bg-blue-900/20 px-4 py-1.5 text-sm font-medium text-blue-300 mb-8 shadow-[0_0_15px_-5px_rgba(59,130,246,0.5)]">
            <span className="flex h-2 w-2 rounded-full bg-blue-400 mr-2 animate-pulse"></span>
            New: SMS Alerts for Contractors
          </div>

          <h1 className="mx-auto max-w-5xl text-5xl font-bold tracking-tight text-white sm:text-7xl mb-8 leading-tight">
            Stop Losing Revenue to <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">
              Expired Licenses
            </span>
          </h1>

          <p className="mx-auto max-w-2xl text-lg leading-8 text-slate-400 mb-10">
            The "set-it-and-forget-it" tool for busy business owners. 
            We track your permits and insurance. You get a text message before you get fined.
          </p>

          {/* UPDATED CTAs */}
          <div className="flex flex-col items-center gap-4 mb-20">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/sign-up"
                className="w-full sm:w-auto rounded-lg bg-blue-600 px-8 py-4 text-sm font-semibold text-white shadow-lg shadow-blue-900/30 hover:bg-blue-500 hover:shadow-blue-900/50 hover:-translate-y-0.5 transition-all duration-200 flex items-center justify-center gap-2 group"
              >
                Start for Free <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link
                href="/sign-in"
                className="w-full sm:w-auto rounded-lg px-8 py-4 text-sm font-semibold text-white border border-slate-800 bg-slate-900/50 hover:bg-slate-800 hover:border-slate-700 transition-all"
              >
                View Demo
              </Link>
            </div>
            {/* TRUST SIGNAL - NO CREDIT CARD */}
            <p className="text-xs text-slate-500 flex items-center gap-2">
              <CreditCard className="w-3 h-3" /> No credit card required • Track your first license free
            </p>
          </div>

          {/* APP PREVIEW */}
          <div className="relative max-w-4xl mx-auto">
             <div className="absolute inset-0 bg-blue-500/5 blur-3xl rounded-full" />
             
             <div className="relative bg-[#0F172A] border border-slate-800 rounded-2xl p-1 shadow-2xl">
                <div className="bg-[#0B1120] rounded-xl border border-slate-800/50 p-8 flex flex-col items-center sm:flex-row gap-8">
                   
                   <div className="flex-1 text-left">
                      <div className="flex items-center gap-2 mb-4">
                         <div className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
                         <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Urgent Alert</span>
                      </div>
                      <h3 className="text-2xl font-semibold text-white mb-2">Health Permit Expiring</h3>
                      <p className="text-slate-400 mb-6">Your Mobile Food Vendor Permit #HK-882 expires in <span className="text-red-400 font-bold">3 days</span>.</p>
                      
                      <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                         <div className="bg-red-500 h-full w-[92%]" />
                      </div>
                      <p className="text-xs text-right text-slate-500 mt-2">92% of duration used</p>
                   </div>

                   <div className="w-full sm:w-72 bg-slate-900 rounded-lg border border-slate-800 p-4 relative">
                      <div className="absolute -top-2 -right-2 bg-blue-600 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-lg">
                         SMS PREVIEW
                      </div>
                      <div className="flex gap-3 mb-4">
                         <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                            <ShieldCheck className="w-4 h-4 text-slate-400" />
                         </div>
                         <div className="bg-slate-800 rounded-2xl rounded-tl-none p-3 text-sm text-slate-300 shadow-sm">
                            <p>⚠️ <span className="font-bold text-white">SafeOps Alert:</span> Your Health Permit expires in 3 days.</p>
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
      <section className="relative z-10 py-32 bg-[#0B1120] border-t border-slate-800 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/10 blur-[120px] rounded-full pointer-events-none" />

        <div className="mx-auto max-w-7xl px-6 lg:px-8 relative z-10">
          <div className="text-center mb-20">
            <h2 className="text-blue-400 font-semibold tracking-wide uppercase text-xs border border-blue-500/20 inline-block px-3 py-1 rounded-full bg-blue-500/10 mb-4">
              Features
            </h2>
            <p className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
               Everything you need to stay safe.
            </p>
            <p className="mt-4 text-lg text-slate-400 max-w-2xl mx-auto">
              We replaced the spreadsheet with an intelligent engine that works 24/7.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* FEATURE 1: SMS ALERTS */}
            <div className="md:col-span-2 bg-slate-900/50 border border-slate-800 rounded-3xl p-8 sm:p-12 relative overflow-hidden group hover:border-slate-700 transition-colors">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              
              <div className="relative z-10 flex flex-col sm:flex-row gap-12 items-center">
                <div className="flex-1 text-left">
                  <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center mb-6">
                    <Smartphone className="w-6 h-6 text-blue-400" />
                  </div>
                  <h3 className="text-2xl font-semibold text-white mb-3">SMS-First Alerts</h3>
                  <p className="text-slate-400 leading-relaxed">
                    We don't rely on email. We text you directly because we know you're on the job site, not behind a desk.
                  </p>
                </div>
                <div className="w-full sm:w-64 bg-[#0F172A] border border-slate-700 rounded-2xl p-4 shadow-2xl transform rotate-3 group-hover:rotate-0 transition-transform duration-500">
                   <div className="flex items-center gap-2 mb-3 border-b border-slate-800 pb-3">
                      <div className="w-6 h-6 bg-blue-600 rounded-md flex items-center justify-center"><ShieldCheck className="w-3 h-3 text-white"/></div>
                      <span className="text-xs font-bold text-slate-300">SafeOps Alert</span>
                      <span className="text-[10px] text-slate-500 ml-auto">Now</span>
                   </div>
                   <div className="bg-slate-800/50 rounded-lg p-3 mb-2">
                      <p className="text-xs text-slate-300">⚠️ <span className="font-semibold text-white">Urgent:</span> Your Electrical License expires in 3 days.</p>
                   </div>
                   <div className="h-2 w-24 bg-slate-800 rounded-full" />
                </div>
              </div>
            </div>

            {/* FEATURE 2: DOCUMENT VAULT */}
            <div className="md:col-span-1 bg-slate-900/50 border border-slate-800 rounded-3xl p-8 relative overflow-hidden group hover:border-slate-700 transition-colors">
              <div className="absolute inset-0 bg-gradient-to-bl from-indigo-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              
              <div className="w-12 h-12 rounded-xl bg-indigo-500/20 flex items-center justify-center mb-6">
                <FileText className="w-6 h-6 text-indigo-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">Document Vault</h3>
              <p className="text-slate-400 text-sm leading-relaxed mb-8">
                Snap a photo of your permit. Store it securely. Access it instantly during an audit.
              </p>
              <div className="bg-[#0F172A] border border-slate-700 rounded-xl p-3 space-y-2 shadow-xl translate-y-4 group-hover:translate-y-2 transition-transform duration-500">
                 <div className="flex items-center gap-3 p-2 bg-slate-800/50 rounded-lg">
                    <div className="w-8 h-10 bg-red-500/20 rounded flex items-center justify-center"><span className="text-[8px] font-bold text-red-400">PDF</span></div>
                    <div className="flex-1">
                       <div className="h-2 w-20 bg-slate-700 rounded mb-1"></div>
                       <div className="h-1.5 w-12 bg-slate-800 rounded"></div>
                    </div>
                    <div className="w-4 h-4 rounded-full bg-green-500/20 flex items-center justify-center"><Check className="w-2 h-2 text-green-400" /></div>
                 </div>
              </div>
            </div>

            {/* FEATURE 3: AUDIT PROTECTION */}
            <div className="md:col-span-3 lg:col-span-3 bg-slate-900/50 border border-slate-800 rounded-3xl p-8 sm:p-12 relative overflow-hidden group hover:border-slate-700 transition-colors">
               <div className="absolute inset-0 bg-gradient-to-r from-sky-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

               <div className="flex flex-col sm:flex-row items-center gap-8">
                  <div className="flex-1 text-left sm:text-center lg:text-left">
                    <div className="inline-flex items-center gap-2 text-sky-400 font-medium text-sm mb-4">
                       <ShieldCheck className="w-4 h-4" /> Audit Protection
                    </div>
                    <h3 className="text-2xl font-semibold text-white mb-3">Always Audit Ready</h3>
                    <p className="text-slate-400 leading-relaxed max-w-2xl">
                      When the inspector shows up, you don't dig through filing cabinets. You open SafeOps. 
                      We verify every renewal and keep a permanent paper trail of your compliance history.
                    </p>
                  </div>
                  
                  <div className="flex-1 w-full max-w-md bg-[#0F172A] border border-slate-700 rounded-xl p-6 shadow-2xl">
                     <div className="space-y-6 relative pl-2">
                        <div className="absolute left-[19px] top-2 bottom-2 w-0.5 bg-slate-800" />
                        <div className="relative flex gap-4 items-center">
                           <div className="w-10 h-10 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center z-10">
                              <Check className="w-4 h-4 text-green-400" />
                           </div>
                           <div>
                              <p className="text-white text-sm font-medium">License Renewed</p>
                              <p className="text-slate-500 text-xs">Oct 24, 2024 • via Auto-Renewal</p>
                           </div>
                        </div>
                        <div className="relative flex gap-4 items-center opacity-50">
                           <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center z-10">
                              <Bell className="w-4 h-4 text-slate-400" />
                           </div>
                           <div>
                              <p className="text-slate-300 text-sm">Reminder Sent</p>
                              <p className="text-slate-600 text-xs">Oct 20, 2024 • SMS & Email</p>
                           </div>
                        </div>
                     </div>
                  </div>
               </div>
            </div>

          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-[#0B1120] border-t border-slate-800 py-12">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-6">
           <div className="flex items-center gap-2">
             <div className="w-6 h-6 bg-slate-800 rounded flex items-center justify-center">
                <ShieldCheck className="w-3 h-3 text-slate-400" />
             </div>
             <span className="text-slate-400 font-semibold text-sm">SafeOps</span>
           </div>
           <div className="text-slate-600 text-sm">
             © {new Date().getFullYear()} SafeOps Inc. All rights reserved.
           </div>
        </div>
      </footer>
    </div>
  );
}