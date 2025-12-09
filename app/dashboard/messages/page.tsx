"use client";

import { useState, useEffect } from "react";
import { MessageSquare, Send, ArrowLeft, Bug, Lightbulb, AlertCircle, HelpCircle, Check } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

interface Message {
    id: string;
    type: string;
    message: string;
    email: string | null;
    status: string;
    adminReply: string | null;
    createdAt: string;
    updatedAt: string;
}

export default function MessagesPage() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(true);
    const [replyingTo, setReplyingTo] = useState<string | null>(null);
    const [replyText, setReplyText] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        fetchMessages();
    }, []);

    const fetchMessages = async () => {
        try {
            const res = await fetch("/api/feedback/my-messages");
            if (res.ok) {
                const data = await res.json();
                setMessages(data);
            }
        } catch (error) {
            console.error("Failed to fetch messages");
        } finally {
            setLoading(false);
        }
    };

    const handleReply = async (parentId: string) => {
        if (!replyText.trim()) return;
        setIsSubmitting(true);

        try {
            const res = await fetch("/api/feedback", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    type: "reply",
                    message: replyText,
                    parentId,
                }),
            });

            if (res.ok) {
                toast.success("Reply sent!");
                setReplyingTo(null);
                setReplyText("");
                fetchMessages(); // Refresh to show new message
            }
        } catch (error) {
            toast.error("Failed to send reply");
        } finally {
            setIsSubmitting(false);
        }
    };

    const getTypeIcon = (type: string) => {
        switch (type) {
            case 'bug': return <Bug className="w-4 h-4" />;
            case 'suggestion': return <Lightbulb className="w-4 h-4" />;
            case 'feature': return <AlertCircle className="w-4 h-4" />;
            default: return <HelpCircle className="w-4 h-4" />;
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-4 mb-8">
                <Link
                    href="/dashboard"
                    className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"
                >
                    <ArrowLeft className="w-5 h-5" />
                </Link>
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">My Messages</h1>
                    <p className="text-slate-600">Your conversations with UltOps support</p>
                </div>
            </div>

            {messages.length === 0 ? (
                <div className="bg-white rounded-xl border p-12 text-center">
                    <MessageSquare className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-slate-900 mb-2">No messages yet</h3>
                    <p className="text-slate-600 mb-4">Use the feedback button to send us a message!</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {messages.map((msg) => (
                        <div key={msg.id} className="bg-white rounded-xl border shadow-sm overflow-hidden">
                            {/* Message Header */}
                            <div className="px-6 py-4 bg-slate-50 border-b flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-lg ${msg.type === 'bug' ? 'bg-red-100 text-red-600' :
                                            msg.type === 'suggestion' ? 'bg-yellow-100 text-yellow-600' :
                                                msg.type === 'feature' ? 'bg-purple-100 text-purple-600' :
                                                    'bg-blue-100 text-blue-600'
                                        }`}>
                                        {getTypeIcon(msg.type)}
                                    </div>
                                    <div>
                                        <span className={`text-xs font-medium uppercase ${msg.type === 'bug' ? 'text-red-600' :
                                                msg.type === 'suggestion' ? 'text-yellow-600' :
                                                    msg.type === 'feature' ? 'text-purple-600' :
                                                        'text-blue-600'
                                            }`}>{msg.type}</span>
                                        <p className="text-xs text-slate-500">
                                            {new Date(msg.createdAt).toLocaleDateString()} at {new Date(msg.createdAt).toLocaleTimeString()}
                                        </p>
                                    </div>
                                </div>
                                <span className={`px-2 py-1 rounded text-xs font-medium ${msg.status === 'new' ? 'bg-yellow-100 text-yellow-700' :
                                        msg.status === 'reviewed' ? 'bg-blue-100 text-blue-700' :
                                            'bg-green-100 text-green-700'
                                    }`}>
                                    {msg.status === 'new' ? 'Awaiting Reply' : msg.status === 'reviewed' ? 'In Review' : 'Resolved'}
                                </span>
                            </div>

                            {/* Message Content */}
                            <div className="p-6">
                                {/* Your Message */}
                                <div className="flex gap-3 mb-4">
                                    <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 text-sm font-bold flex-shrink-0">
                                        You
                                    </div>
                                    <div className="flex-1">
                                        <div className="bg-slate-100 rounded-lg rounded-tl-none p-3">
                                            <p className="text-slate-900">{msg.message}</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Admin Reply */}
                                {msg.adminReply && (
                                    <div className="flex gap-3 mb-4">
                                        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                            UO
                                        </div>
                                        <div className="flex-1">
                                            <div className="bg-blue-50 border border-blue-100 rounded-lg rounded-tl-none p-3">
                                                <p className="text-slate-900">{msg.adminReply}</p>
                                                <p className="text-xs text-blue-600 mt-2">UltOps Support</p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Reply Input */}
                                {msg.adminReply && msg.status !== 'resolved' && (
                                    <div className="mt-4 pt-4 border-t">
                                        {replyingTo === msg.id ? (
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    value={replyText}
                                                    onChange={(e) => setReplyText(e.target.value)}
                                                    placeholder="Type your reply..."
                                                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                                    disabled={isSubmitting}
                                                    onKeyDown={(e) => e.key === 'Enter' && handleReply(msg.id)}
                                                />
                                                <button
                                                    onClick={() => handleReply(msg.id)}
                                                    disabled={isSubmitting || !replyText.trim()}
                                                    className="px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-500 disabled:opacity-50 flex items-center gap-2"
                                                >
                                                    <Send className="w-4 h-4" />
                                                    Send
                                                </button>
                                                <button
                                                    onClick={() => { setReplyingTo(null); setReplyText(""); }}
                                                    className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => setReplyingTo(msg.id)}
                                                className="flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium"
                                            >
                                                <MessageSquare className="w-4 h-4" />
                                                Reply to support
                                            </button>
                                        )}
                                    </div>
                                )}

                                {/* Resolved Message */}
                                {msg.status === 'resolved' && (
                                    <div className="mt-4 pt-4 border-t flex items-center gap-2 text-green-600">
                                        <Check className="w-4 h-4" />
                                        <span className="text-sm font-medium">This conversation has been resolved</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
