"use client";

import { useState } from "react";
import { MessageSquare, Mail, Bug, Lightbulb, AlertCircle, HelpCircle, Send, Check, X, User } from "lucide-react";
import { toast } from "sonner";

interface FeedbackItem {
    id: string;
    userId: string | null;
    type: string;
    message: string;
    email: string | null;
    status: string;
    adminReply: string | null;
    createdAt: string;
    updatedAt: string;
}

interface SupportMessagesProps {
    feedbackItems: FeedbackItem[];
}

export default function SupportMessages({ feedbackItems: initialItems }: SupportMessagesProps) {
    const [items, setItems] = useState<FeedbackItem[]>(initialItems);
    const [replyingTo, setReplyingTo] = useState<string | null>(null);
    const [replyText, setReplyText] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleReply = async (id: string) => {
        if (!replyText.trim()) return;
        setIsSubmitting(true);

        try {
            const res = await fetch(`/api/admin/feedback/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ adminReply: replyText, status: "reviewed" })
            });

            if (res.ok) {
                const updated = await res.json();
                setItems(items.map(item => item.id === id ? updated : item));
                setReplyingTo(null);
                setReplyText("");
                toast.success("Reply sent!");
            } else {
                toast.error("Failed to send reply");
            }
        } catch (error) {
            toast.error("Error sending reply");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleStatusChange = async (id: string, status: string) => {
        try {
            const res = await fetch(`/api/admin/feedback/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status })
            });

            if (res.ok) {
                const updated = await res.json();
                setItems(items.map(item => item.id === id ? updated : item));
                toast.success(`Marked as ${status}`);
            }
        } catch (error) {
            toast.error("Failed to update status");
        }
    };

    const getTypeIcon = (type: string) => {
        switch (type) {
            case 'bug': return <Bug className="w-5 h-5" />;
            case 'suggestion': return <Lightbulb className="w-5 h-5" />;
            case 'feature': return <AlertCircle className="w-5 h-5" />;
            default: return <HelpCircle className="w-5 h-5" />;
        }
    };

    const getTypeColor = (type: string) => {
        switch (type) {
            case 'bug': return 'bg-red-100 text-red-600';
            case 'suggestion': return 'bg-yellow-100 text-yellow-600';
            case 'feature': return 'bg-purple-100 text-purple-600';
            default: return 'bg-blue-100 text-blue-600';
        }
    };

    return (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="px-6 py-4 border-b bg-gray-50 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-blue-600" />
                    Support Messages
                </h3>
                <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-medium">
                    {items.filter(f => f.status === 'new').length} New
                </span>
            </div>

            {items.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                    <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p>No support messages yet</p>
                </div>
            ) : (
                <div className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
                    {items.map((item) => (
                        <div key={item.id} className={`p-4 ${item.status === 'new' ? 'bg-blue-50/50' : ''}`}>
                            <div className="flex items-start gap-4">
                                <div className={`p-2 rounded-lg flex-shrink-0 ${getTypeColor(item.type)}`}>
                                    {getTypeIcon(item.type)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    {/* Header Row */}
                                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                                        <span className={`px-2 py-0.5 rounded text-xs font-medium uppercase ${item.type === 'bug' ? 'bg-red-100 text-red-700' :
                                                item.type === 'suggestion' ? 'bg-yellow-100 text-yellow-700' :
                                                    item.type === 'feature' ? 'bg-purple-100 text-purple-700' :
                                                        'bg-blue-100 text-blue-700'
                                            }`}>
                                            {item.type}
                                        </span>
                                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${item.status === 'new' ? 'bg-green-100 text-green-700' :
                                                item.status === 'reviewed' ? 'bg-gray-200 text-gray-600' :
                                                    'bg-slate-200 text-slate-600'
                                            }`}>
                                            {item.status}
                                        </span>
                                        {item.email && (
                                            <span className="flex items-center gap-1 text-xs text-gray-500">
                                                <Mail className="w-3 h-3" />
                                                {item.email}
                                            </span>
                                        )}
                                        {item.userId && (
                                            <span className="flex items-center gap-1 text-xs text-gray-500">
                                                <User className="w-3 h-3" />
                                                {item.userId.slice(0, 8)}...
                                            </span>
                                        )}
                                    </div>

                                    {/* Message */}
                                    <p className="text-gray-900 text-sm mb-2">{item.message}</p>

                                    {/* Admin Reply (if exists) */}
                                    {item.adminReply && (
                                        <div className="bg-green-50 border border-green-100 rounded-lg p-3 mb-2">
                                            <p className="text-xs text-green-600 font-medium mb-1">Your Reply:</p>
                                            <p className="text-sm text-green-800">{item.adminReply}</p>
                                        </div>
                                    )}

                                    {/* Timestamp */}
                                    <p className="text-xs text-gray-400 mb-3">
                                        {new Date(item.createdAt).toLocaleDateString()} at {new Date(item.createdAt).toLocaleTimeString()}
                                    </p>

                                    {/* Action Buttons */}
                                    <div className="flex items-center gap-2">
                                        {replyingTo === item.id ? (
                                            <div className="flex-1 flex gap-2">
                                                <input
                                                    type="text"
                                                    value={replyText}
                                                    onChange={(e) => setReplyText(e.target.value)}
                                                    placeholder="Type your reply..."
                                                    className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                                    disabled={isSubmitting}
                                                    onKeyDown={(e) => e.key === 'Enter' && handleReply(item.id)}
                                                />
                                                <button
                                                    onClick={() => handleReply(item.id)}
                                                    disabled={isSubmitting || !replyText.trim()}
                                                    className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-500 disabled:opacity-50 flex items-center gap-1"
                                                >
                                                    <Send className="w-4 h-4" />
                                                    Send
                                                </button>
                                                <button
                                                    onClick={() => { setReplyingTo(null); setReplyText(""); }}
                                                    className="px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded-lg text-sm"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={() => setReplyingTo(item.id)}
                                                    className="px-3 py-1.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-lg hover:bg-blue-200 flex items-center gap-1"
                                                >
                                                    <MessageSquare className="w-3 h-3" />
                                                    Reply
                                                </button>
                                                {item.status === 'new' && (
                                                    <button
                                                        onClick={() => handleStatusChange(item.id, 'reviewed')}
                                                        className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-200 flex items-center gap-1"
                                                    >
                                                        <Check className="w-3 h-3" />
                                                        Mark Reviewed
                                                    </button>
                                                )}
                                                {item.status !== 'resolved' && (
                                                    <button
                                                        onClick={() => handleStatusChange(item.id, 'resolved')}
                                                        className="px-3 py-1.5 bg-green-100 text-green-700 text-xs font-medium rounded-lg hover:bg-green-200 flex items-center gap-1"
                                                    >
                                                        <Check className="w-3 h-3" />
                                                        Resolve
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
