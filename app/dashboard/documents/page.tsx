"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { UploadButton } from "@/app/utils/uploadthing"; // Ensure this path matches where you put the helper
import { Trash2, ExternalLink, FileText, Plus } from "lucide-react";
import Link from "next/link";

interface Document {
  id: string;
  fileName: string;
  fileUrl: string;
  license: { licenseType: string };
}

interface License {
  id: string;
  licenseType: string;
  business: { name: string };
}

export default function DocumentsPage() {
  const { isLoaded, userId } = useAuth();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Form State
  const [formData, setFormData] = useState({
    licenseId: "",
    fileName: "",
    fileUrl: "",
  });

  // Fetch Data
  useEffect(() => {
    if (!isLoaded || !userId) return;

    const fetchData = async () => {
      try {
        const [docsRes, licRes] = await Promise.all([
          fetch("/api/documents"),
          fetch("/api/licenses")
        ]);

        if (docsRes.ok) setDocuments(await docsRes.json());
        if (licRes.ok) setLicenses(await licRes.json());
      } catch (e) {
        console.error("Error fetching data", e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [isLoaded, userId]);

  // Save to Database after Upload
  const handleSave = async () => {
    if (!formData.fileUrl || !formData.licenseId) {
      alert("Please select a license and upload a file first.");
      return;
    }

    // Determine file type from extension
    const extension = formData.fileName.split('.').pop()?.toLowerCase() || 'unknown';
    const fileType = extension === 'pdf' ? 'application/pdf' : `image/${extension}`;

    const res = await fetch("/api/documents", {
      method: "POST",
      body: JSON.stringify({
        ...formData,
        fileType,
      }),
    });

    if (res.ok) {
      const newDoc = await res.json();
      setDocuments([newDoc, ...documents]);
      setFormData({ licenseId: "", fileName: "", fileUrl: "" });
      alert("Document Saved Successfully!");
    } else {
      const errorText = await res.text();
      alert(`Failed to save document: ${errorText}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Permanently delete this document?")) return;
    await fetch(`/api/documents?id=${id}`, { method: "DELETE" });
    setDocuments(documents.filter((d) => d.id !== id));
  };

  if (isLoading) return <div className="p-8 text-center">Loading documents...</div>;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-slate-900 mb-8">Document Storage</h1>

      {/* UPLOAD SECTION */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm mb-10">
        <h2 className="text-lg font-semibold text-slate-800 mb-6 flex items-center gap-2">
          <Plus className="w-5 h-5 text-blue-600" /> Upload New Document
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

          {/* Left: File Metadata */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Link to License *</label>
              <select
                className="w-full p-2.5 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                value={formData.licenseId}
                onChange={(e) => setFormData({ ...formData, licenseId: e.target.value })}
              >
                <option value="">-- Select a License --</option>
                {licenses.map(l => (
                  <option key={l.id} value={l.id}>{l.licenseType} ({l.business?.name})</option>
                ))}
              </select>
              {licenses.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  No licenses found. <Link href="/dashboard/licenses" className="underline">Create one first.</Link>
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Document Name</label>
              <input
                type="text"
                placeholder="e.g. Health Permit 2025.pdf"
                className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                value={formData.fileName}
                onChange={(e) => setFormData({ ...formData, fileName: e.target.value })}
              />
            </div>
          </div>

          {/* Right: Upload Button Area */}
          <div className="border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center bg-slate-50/50 p-6 transition-colors hover:bg-slate-50">
            {!formData.fileUrl ? (
              <div className="text-center">
                <UploadButton
                  endpoint="documentUploader"
                  appearance={{
                    button: "bg-slate-900 text-white px-6 py-2 rounded-lg hover:bg-slate-800 transition-all",
                    allowedContent: "text-slate-500 text-xs mt-2"
                  }}
                  onClientUploadComplete={(res) => {
                    if (res && res[0]) {
                      setFormData(prev => ({ ...prev, fileUrl: res[0].url }));
                      if (!formData.fileName) setFormData(prev => ({ ...prev, fileName: res[0].name }));
                    }
                  }}
                  onUploadError={(error: Error) => {
                    alert(`Upload Error: ${error.message}`);
                  }}
                />
              </div>
            ) : (
              <div className="text-center w-full">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <FileText className="w-6 h-6 text-green-600" />
                </div>
                <p className="text-green-700 font-medium mb-1">Upload Complete!</p>
                <a href={formData.fileUrl} target="_blank" className="text-xs text-blue-600 underline block mb-4 truncate max-w-xs mx-auto">
                  {formData.fileUrl}
                </a>
                <button
                  onClick={() => setFormData({ ...formData, fileUrl: "" })}
                  className="text-xs text-red-500 hover:text-red-700 hover:underline"
                >
                  Remove & Upload Different File
                </button>
              </div>
            )}
          </div>

        </div>

        {/* Save Button */}
        <div className="mt-6 pt-6 border-t border-slate-100 flex justify-end">
          <button
            onClick={handleSave}
            disabled={!formData.fileUrl || !formData.licenseId}
            className="bg-blue-600 text-white px-8 py-2.5 rounded-lg hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium shadow-sm"
          >
            Save to Vault
          </button>
        </div>
      </div>

      {/* DOCUMENT LIST */}
      <div className="grid gap-4">
        {documents.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border border-slate-200 border-dashed">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">No documents stored yet.</p>
          </div>
        ) : (
          documents.map((doc) => (
            <div key={doc.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex justify-between items-center group">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
                  {/* Show different icon for PDF vs Image if you want, defaulting to FileText */}
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">{doc.fileName}</h3>
                  <p className="text-xs text-slate-500 flex items-center gap-1">
                    Linked to: <span className="font-medium bg-slate-100 px-2 py-0.5 rounded text-slate-700">{doc.license?.licenseType || "General"}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {/* ✅ THE NEW VIEW BUTTON */}
                <a
                  href={doc.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-sm font-medium transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  View
                </a>

                <button
                  onClick={() => handleDelete(doc.id)}
                  className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Delete File"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}