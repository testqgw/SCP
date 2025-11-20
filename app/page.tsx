import Link from "next/link";
import { ArrowRight, Bell, ShieldCheck, Smartphone, FileText } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white selection:bg-blue-500/30 font-sans overflow-hidden relative">
      
      {/* BACKGROUND GLOW EFFECTS */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-blue-600/20 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[800px] h-[600px] bg-indigo-600/10 blur-[100px] rounded-full pointer-events-none" />

      {/* NAV (Simple) */}
      <nav className="relative z-10 mx-auto max-w-7xl px-6 lg:px-8 pt-6 flex justify-between items-center">
        <div className="text-xl font-bold tracking-tight flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <span>Compliance<span className="text-slate-400">Reminder</span></span>
        </div>
        <Link href="/sign-in" className="text-sm font-medium text-slate-300 hover:text-white transition-colors">
          Log in
        </Link>
      </nav>

      {/* HERO SECTION */}
      <main className="relative z-10 pt-20 pb-32 lg:pt-32 lg:pb-40">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 text-center">
          
          {/* Badge */}
          <div className="inline-flex items-center rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-sm font-medium text-blue-300 mb-8 backdrop-blur-sm">
            <span className="flex h-2 w-2 rounded-full bg-blue-400 mr-2 animate-pulse"></span>
            Now available for Contractors & Vendors
          </div>

          {/* Headline */}
          <h1 className="mx-auto max-w-4xl text-5xl font-bold tracking-tight text-white sm:text-7xl mb-8">
            Never let an expired permit <br className="hidden sm:block" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-400 to-sky-400">
              shut down your business.
            </span>
          </h1>

          {/* New Bio (Punchier) */}
          <p className="mx-auto max-w-2xl text-lg leading-8 text-slate-400 mb-10">
            The automated compliance guard for busy owners. We monitor your licenses, insurance, and certifications—then send SMS alerts before you get fined.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/sign-up"
              className="w-full sm:w-auto rounded-lg bg-blue-600 px-8 py-4 text-sm font-semibold text-white shadow-[0_0_20px_-5px_rgba(37,99,235,0.5)] hover:bg-blue-500 hover:shadow-[0_0_30px_-5px_rgba(37,99,235,0.6)] transition-all duration-300 flex items-center justify-center gap-2"
            >
              Start Free Trial <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/sign-in"
              className="w-full sm:w-auto rounded-lg px-8 py-4 text-sm font-semibold text-white border border-slate-700 hover:bg-slate-800/50 hover:border-slate-600 transition-all"
            >
              View Demo
            </Link>
          </div>

          {/* VISUAL HOOK: Abstract Notification Cards */}
          <div className="mt-20 relative max-w-3xl mx-auto">
            {/* Card 1 (Back) */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[90%] h-32 bg-slate-800/50 rounded-xl border border-slate-700/50 blur-[2px] scale-95 translate-y-4"></div>
            
            {/* Card 2 (Front) */}
            <div className="relative bg-slate-900/80 backdrop-blur-md border border-slate-700 rounded-xl p-6 shadow-2xl text-left flex items-start gap-4 max-w-2xl mx-auto">
              <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <Bell className="w-6 h-6 text-red-400" />
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-white font-semibold">Health Permit Expiring Soon!</h3>
                    <p className="text-slate-400 text-sm mt-1">Your Mobile Food Vendor Permit expires in <span className="text-red-400 font-bold">3 days</span>.</p>
                  </div>
                  <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">Just now</span>
                </div>
                <div className="mt-4 flex gap-2">
                  <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full w-[90%] bg-red-500 rounded-full"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </main>

      {/* FEATURES GRID (Simplified) */}
      <section className="relative z-10 py-24 bg-slate-900/50 border-t border-slate-800/50">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            
            {/* Feature 1 */}
            <div className="p-8 rounded-2xl bg-slate-800/20 border border-slate-700/50 hover:bg-slate-800/40 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center mb-4">
                <Smartphone className="w-6 h-6 text-blue-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">SMS-First Alerts</h3>
              <p className="text-slate-400 leading-relaxed">
                We text you because we know you aren't sitting at a computer all day. Get notified where you actually work.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="p-8 rounded-2xl bg-slate-800/20 border border-slate-700/50 hover:bg-slate-800/40 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center mb-4">
                <FileText className="w-6 h-6 text-indigo-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Document Vault</h3>
              <p className="text-slate-400 leading-relaxed">
                Snap a photo of your permit and store it securely. Access your compliance history instantly during an audit.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="p-8 rounded-2xl bg-slate-800/20 border border-slate-700/50 hover:bg-slate-800/40 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-sky-500/20 flex items-center justify-center mb-4">
                <ShieldCheck className="w-6 h-6 text-sky-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Audit Protection</h3>
              <p className="text-slate-400 leading-relaxed">
                Never get caught off guard. We track your entire renewal history to prove you've always been compliant.
              </p>
            </div>

          </div>
        </div>
      </section>
    </div>
  );
}