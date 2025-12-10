"use client";

import { useState } from "react";
import { Mail, Loader2, CheckCircle, XCircle } from "lucide-react";

export default function TestEmailButton() {
    const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
    const [result, setResult] = useState<any>(null);

    const handleTestEmail = async () => {
        setStatus("loading");
        try {
            const res = await fetch("/api/test-email");
            const data = await res.json();

            if (data.success) {
                setStatus("success");
            } else {
                setStatus("error");
            }
            setResult(data);
        } catch (err: any) {
            setStatus("error");
            setResult({ error: err.message });
        }
    };

    return (
        <div className="space-y-3">
            <button
                onClick={handleTestEmail}
                disabled={status === "loading"}
                className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all ${status === "success"
                        ? "bg-green-100 text-green-700 border border-green-200"
                        : status === "error"
                            ? "bg-red-100 text-red-700 border border-red-200"
                            : "bg-indigo-600 text-white hover:bg-indigo-700"
                    }`}
            >
                {status === "loading" ? (
                    <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Sending...
                    </>
                ) : status === "success" ? (
                    <>
                        <CheckCircle className="w-4 h-4" />
                        Email Sent!
                    </>
                ) : status === "error" ? (
                    <>
                        <XCircle className="w-4 h-4" />
                        Failed
                    </>
                ) : (
                    <>
                        <Mail className="w-4 h-4" />
                        Test Email
                    </>
                )}
            </button>

            {result && (
                <div className={`text-xs p-3 rounded-lg ${status === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                    }`}>
                    {result.success ? (
                        <p>✅ Check your inbox! A sample reminder was sent.</p>
                    ) : (
                        <>
                            <p className="font-semibold">Error: {result.error}</p>
                            {result.error === "Resend not configured" && (
                                <p className="mt-2 text-gray-600">
                                    → Add RESEND_API_KEY to your Vercel env vars.
                                </p>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
