"use client";

import { useState } from "react";
import { MessageSquare, X, Send } from "lucide-react";

export default function FeedbackWidget() {
    const [isOpen, setIsOpen] = useState(false);
    const [formData, setFormData] = useState({
        type: "suggestion",
        message: "",
        email: "",
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            const res = await fetch("/api/feedback", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData),
            });

            if (res.ok) {
                setSubmitted(true);
                setTimeout(() => {
                    setIsOpen(false);
                    setSubmitted(false);
                    setFormData({ type: "suggestion", message: "", email: "" });
                }, 2000);
            }
        } catch (error) {
            console.error("Failed to submit feedback");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <>
            {/* Floating Button */}
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-6 right-6 z-50 bg-blue-600 text-white rounded-full p-4 shadow-lg hover:bg-blue-700 transition-all hover:scale-110"
                aria-label="Send Feedback"
            >
                <MessageSquare className="w-6 h-6" />
            </button>

            {/* Modal */}
            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 relative">
                        {/* Close Button */}
                        <button
                            onClick={() => setIsOpen(false)}
                            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
                        >
                            <X className="w-5 h-5" />
                        </button>

                        {submitted ? (
                            <div className="text-center py-8">
                                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Send className="w-8 h-8 text-green-600" />
                                </div>
                                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                                    Thank you!
                                </h3>
                                <p className="text-gray-600">
                                    We've received your feedback and will review it shortly.
                                </p>
                            </div>
                        ) : (
                            <>
                                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                                    We'd love to hear from you
                                </h3>
                                <p className="text-gray-600 mb-6">
                                    Have a suggestion or need help? Let us know!
                                </p>

                                <form onSubmit={handleSubmit} className="space-y-4">
                                    {/* Type Selection */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Type
                                        </label>
                                        <select
                                            value={formData.type}
                                            onChange={(e) =>
                                                setFormData({ ...formData, type: e.target.value })
                                            }
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        >
                                            <option value="suggestion">Suggestion</option>
                                            <option value="bug">Bug Report</option>
                                            <option value="help">Help / Support</option>
                                            <option value="feature">Feature Request</option>
                                        </select>
                                    </div>

                                    {/* Message */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Message
                                        </label>
                                        <textarea
                                            required
                                            value={formData.message}
                                            onChange={(e) =>
                                                setFormData({ ...formData, message: e.target.value })
                                            }
                                            rows={4}
                                            placeholder="Tell us what's on your mind..."
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                                        />
                                    </div>

                                    {/* Email (optional) */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Email (optional - for follow-up)
                                        </label>
                                        <input
                                            type="email"
                                            value={formData.email}
                                            onChange={(e) =>
                                                setFormData({ ...formData, email: e.target.value })
                                            }
                                            placeholder="your@email.com"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>

                                    {/* Submit Button */}
                                    <button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                                    >
                                        {isSubmitting ? (
                                            "Sending..."
                                        ) : (
                                            <>
                                                Send Feedback <Send className="w-4 h-4" />
                                            </>
                                        )}
                                    </button>
                                </form>
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
