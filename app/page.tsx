
import Link from "next/link";
import { ArrowRight, CheckCircle, ShieldAlert, Clock, FileText } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans">
      
      {/* 1. HERO SECTION */}
      <header className="relative overflow-hidden bg-slate-900 pt-16 pb-24 lg:pt-32 lg:pb-40">
        <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <div className="inline-flex items-center rounded-full bg-blue-500/10 px-3 py-1 text-sm font-semibold text-blue-400 ring-1 ring-inset ring-blue-500/20 mb-6">
              🚀 Now available for Food Trucks & Contractors
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl">
              Stop Losing Revenue to <span className="text-blue-400">Expired Licenses</span>
            </h1>
            <p className="mt-6 text-lg leading-8 text-slate-300">
              The "set-it-and-forget-it" compliance engine. We track your permits, insurance, and certifications so you never face a fine or shutdown again.
            </p>
            <div className="mt-10 flex items-center justify-center gap-x-6">
              <Link
                href="/sign-up"
                className="rounded-md bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 transition-all"
              >
                Start Free Trial
              </Link>
              <Link href="/sign-in" className="text-sm font-semibold leading-6 text-white hover:text-blue-300 transition-colors">
                Sign In <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </div>
        
        {/* Decorative background gradient */}
        <div className="absolute top-0 left-1/2 -z-10 -translate-x-1/2 blur-3xl xl:-top-6">
           <div className="aspect-[1155/678] w-[72.1875rem] bg-gradient-to-tr from-[#ff80b5] to-[#9089fc] opacity-20" style={{ clipPath: 'polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)' }} />
        </div>
      </header>

      {/* 2. SOCIAL PROOF / TRUST BADGES */}
      <div className="bg-slate-50 py-12">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <h2 className="text-center text-lg font-semibold leading-8 text-slate-600">
            Trusted by local businesses to stay compliant
          </h2>
          <div className="mx-auto mt-8 grid max-w-lg grid-cols-2 items-center gap-x-8 gap-y-10 sm:max-w-xl sm:grid-cols-2 sm:gap-x-10 lg:mx-0 lg:max-w-none lg:grid-cols-4">
             {/* Placeholders for logos - text for now */}
             <div className="text-center text-slate-400 font-bold text-xl">Joe's Catering</div>
             <div className="text-center text-slate-400 font-bold text-xl">City Build Inc.</div>
             <div className="text-center text-slate-400 font-bold text-xl">Fresh Food Fleet</div>
             <div className="text-center text-slate-400 font-bold text-xl">Metro Services</div>
          </div>
        </div>
      </div>

      {/* 3. PROBLEM / SOLUTION GRID */}
      <div className="py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl lg:text-center">
            <h2 className="text-base font-semibold leading-7 text-blue-600">Peace of Mind</h2>
            <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Everything you need to avoid the <span className="text-red-600">Red Tape</span>
            </p>
            <p className="mt-6 text-lg leading-8 text-slate-600">
              Spreadsheets and calendar alerts aren't enough. We built a dedicated engine to ensure you never miss a critical deadline.
            </p>
          </div>
          
          <div className="mx-auto mt-16 max-w-2xl sm:mt-20 lg:mt-24 lg:max-w-4xl">
            <dl className="grid max-w-xl grid-cols-1 gap-x-8 gap-y-10 lg:max-w-none lg:grid-cols-2 lg:gap-y-16">
              
              {/* Feature 1 */}
              <div className="relative pl-16">
                <dt className="text-base font-semibold leading-7 text-slate-900">
                  <div className="absolute left-0 top-0 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600">
                    <Clock className="h-6 w-6 text-white" />
                  </div>
                  Smart Countdown
                </dt>
                <dd className="mt-2 text-base leading-7 text-slate-600">
                  We don't just remind you once. We alert you at 90, 60, 30, 14, 7, and 1 day before expiration.
                </dd>
              </div>

              {/* Feature 2 */}
              <div className="relative pl-16">
                <dt className="text-base font-semibold leading-7 text-slate-900">
                  <div className="absolute left-0 top-0 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600">
                    <ShieldAlert className="h-6 w-6 text-white" />
                  </div>
                  SMS & Email Alerts
                </dt>
                <dd className="mt-2 text-base leading-7 text-slate-600">
                  We send text messages directly to your phone, because we know you aren't sitting at a desk all day.
                </dd>
              </div>

              {/* Feature 3 */}
              <div className="relative pl-16">
                <dt className="text-base font-semibold leading-7 text-slate-900">
                  <div className="absolute left-0 top-0 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600">
                    <FileText className="h-6 w-6 text-white" />
                  </div>
                  Document Storage
                </dt>
                <dd className="mt-2 text-base leading-7 text-slate-600">
                  Upload photos of your permits and licenses directly to your dashboard for safe keeping.
                </dd>
              </div>

              {/* Feature 4 */}
              <div className="relative pl-16">
                <dt className="text-base font-semibold leading-7 text-slate-900">
                  <div className="absolute left-0 top-0 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600">
                    <CheckCircle className="h-6 w-6 text-white" />
                  </div>
                  Audit Ready
                </dt>
                <dd className="mt-2 text-base leading-7 text-slate-600">
                  Prove your compliance instantly. All your history and current statuses are available in one click.
                </dd>
              </div>

            </dl>
          </div>
        </div>
      </div>

    </div>
  );
}
