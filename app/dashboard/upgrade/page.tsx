import Link from "next/link";
import { CheckCircle } from "lucide-react";

export default function UpgradePage() {
  return (
    <div className="max-w-5xl mx-auto py-16 px-6">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Upgrade to SafeOps Pro</h1>
        <p className="text-lg text-gray-600">
          Track unlimited licenses and get SMS alerts for your entire team.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
        
        {/* FREE PLAN */}
        <div className="bg-white p-8 rounded-2xl border border-gray-200 shadow-sm opacity-75">
          <h2 className="text-xl font-bold text-gray-900">Starter</h2>
          <p className="text-3xl font-bold text-gray-900 mt-4">$0<span className="text-base font-normal text-gray-500">/mo</span></p>
          <ul className="mt-8 space-y-4">
            <li className="flex items-center gap-2 text-gray-600"><CheckCircle className="w-4 h-4 text-blue-600"/> 1 License Tracked</li>
            <li className="flex items-center gap-2 text-gray-600"><CheckCircle className="w-4 h-4 text-blue-600"/> Email Reminders</li>
            <li className="flex items-center gap-2 text-gray-400"><CheckCircle className="w-4 h-4 text-gray-300"/> SMS Reminders</li>
          </ul>
          <button disabled className="mt-8 w-full py-3 rounded-lg bg-gray-100 text-gray-400 font-semibold cursor-not-allowed">
            Current Plan
          </button>
        </div>

        {/* PRO PLAN */}
        <div className="bg-[#0B1120] p-8 rounded-2xl border border-blue-500 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-bl-lg">RECOMMENDED</div>
          <h2 className="text-xl font-bold text-white">Professional</h2>
          <p className="text-3xl font-bold text-white mt-4">$49<span className="text-base font-normal text-slate-400">/mo</span></p>
          <ul className="mt-8 space-y-4">
            <li className="flex items-center gap-2 text-white"><CheckCircle className="w-4 h-4 text-blue-400"/> <strong>Unlimited</strong> Licenses</li>
            <li className="flex items-center gap-2 text-white"><CheckCircle className="w-4 h-4 text-blue-400"/> <strong>SMS</strong> & Email Reminders</li>
            <li className="flex items-center gap-2 text-white"><CheckCircle className="w-4 h-4 text-blue-400"/> Document Storage</li>
            <li className="flex items-center gap-2 text-white"><CheckCircle className="w-4 h-4 text-blue-400"/> Audit History</li>
          </ul>
          
          {/* WEEK 3: This button will link to Stripe */}
          <button className="mt-8 w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors shadow-lg shadow-blue-900/50">
            Upgrade Now
          </button>
        </div>

      </div>
    </div>
  );
}