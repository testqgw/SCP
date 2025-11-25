import Link from "next/link";
import { CheckCircle2, ArrowRight } from "lucide-react";

export default function SuccessPage() {
    return (
        <div className="flex flex-col items-center justify-center min-h-[80vh] text-center px-4">
            <div className="p-4 bg-green-100 rounded-full mb-6">
                <CheckCircle2 className="w-16 h-16 text-green-600" />
            </div>

            <h1 className="text-4xl font-bold text-gray-900 mb-4">
                Payment Successful!
            </h1>

            <p className="text-xl text-gray-600 max-w-lg mb-8">
                Your subscription is now active. You have unlocked unlimited licenses and SMS alerts.
            </p>

            <div className="flex gap-4">
                <Link
                    href="/dashboard"
                    className="inline-flex items-center px-6 py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors"
                >
                    Go to Dashboard <ArrowRight className="ml-2 w-4 h-4" />
                </Link>
            </div>

            <p className="mt-8 text-sm text-gray-500">
                A receipt has been sent to your email.
            </p>
        </div>
    );
}
