"use client";

import { useState } from "react";
import { MessageSquare, Loader2, CheckCircle, XCircle } from "lucide-react";

export default function TestSmsButton() {
    const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
    const [result, setResult] = useState<any>(null);

    const handleTestSms = async () => {
        setStatus("loading");
        try {
            const res = await fetch("/api/test-sms");
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
                onClick={handleTestSms}
                disabled={status === "loading"}
                className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all ${status === "success"
                        ? "bg-green-100 text-green-700 border border-green-200"
                        : status === "error"
                            ? "bg-red-100 text-red-700 border border-red-200"
                            : "bg-blue-600 text-white hover:bg-blue-700"
                    }`}
            >
                {status === "loading" ? (
                    <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Sending Test SMS...
                    </>
                ) : status === "success" ? (
                    <>
                        <CheckCircle className="w-4 h-4" />
                        SMS Sent!
                    </>
                ) : status === "error" ? (
                    <>
                        <XCircle className="w-4 h-4" />
                        Failed
                    </>
                ) : (
                    <>
                        <MessageSquare className="w-4 h-4" />
                        Send Test SMS
                    </>
                )}
            </button>

            {result && (
                <div className={`text-xs p-3 rounded-lg ${status === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                    }`}>
                    {result.success ? (
                        <p>✅ Sent to your phone! Check your messages.</p>
                    ) : (
                        <>
                            <p className="font-semibold">Error: {result.error}</p>
                            {result.phone && <p className="mt-1">Phone: {result.phone}</p>}
                            {result.error === "Twilio not configured" && (
                                <p className="mt-2 text-gray-600">
                                    → Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER to your Vercel env vars.
                                </p>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
