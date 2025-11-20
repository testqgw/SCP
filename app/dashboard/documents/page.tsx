"use client";
import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { UploadButton } from "@/app/utils/uploadthing";
import { Trash2, ExternalLink, FileText } from "lucide-react";

interface Document { id: string; fileName: string; fileUrl: string; license: { licenseType: string }; }
interface License { id: string; licenseType: string; }

export default function DocumentsPage() {
  const { isLoaded, userId } = useAuth();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [formData, setFormData] = useState({ licenseId: "", fileName: "", fileUrl: "" });

  useEffect(() => {
    if (!isLoaded || !userId) return;
    const fetchData = async () => {
      const [docsRes, licRes] = await Promise.all([fetch("/api/documents"), fetch("/api/licenses")]);
      if (docsRes.ok) setDocuments(await docsRes.json());
      if (licRes.ok) setLicenses(await licRes.json());
    };
    fetchData();
  }, [isLoaded, userId]);

  const handleSave = async () => {
    if (!formData.fileUrl || !formData.licenseId) return;
    const res = await fetch("/api/documents", { method: "POST", body: JSON.stringify(formData) });
    if (res.ok) {
      const newDoc = await res.json();
      setDocuments([newDoc, ...documents]);
      setFormData({ licenseId: "", fileName: "", fileUrl: "" });
      alert("Document Saved!");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete document?")) return;
    await fetch(`/api/documents?id=${id}`, { method: "DELETE" });
    setDocuments(documents.filter((d) => d.id !== id));
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-slate-900 mb-8">Document Storage</h1>
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm mb-10">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Upload New Document</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Link to License</label>
              <select className="w-full p-2 border rounded-md bg-white" value={formData.licenseId} onChange={(e) => setFormData({ ...formData, licenseId: e.target.value })}>
                <option value="">Select a License</option>
                {licenses.map(l => <option key={l.id} value={l.id}>{l.licenseType}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Document Name</label>
              <input type="text" placeholder="e.g. PDF Copy" className="w-full p-2 border rounded-md" value={formData.fileName} onChange={(e) => setFormData({ ...formData, fileName: e.target.value })} />
            </div>
            <button onClick={handleSave} disabled={!formData.fileUrl || !formData.licenseId} className="bg-slate-900 text-white px-6 py-2 rounded-md hover:bg-slate-800 disabled:opacity-50 w-full mt-2">Save to Vault</button>
          </div>
          <div className="border-2 border-dashed border-slate-300 rounded-lg flex flex-col items-center justify-center bg-slate-50 p-8">
            {!formData.fileUrl ? (
              <UploadButton endpoint="documentUploader" onClientUploadComplete={(res) => { if (res && res[0]) { setFormData(prev => ({ ...prev, fileUrl: res[0].url })); if (!formData.fileName) setFormData(prev => ({ ...prev, fileName: res[0].name })); } }} onUploadError={(error: Error) => alert(`ERROR! ${error.message}`)} />
            ) : (
              <div className="text-center"><p className="text-green-600 font-semibold mb-2">✅ Upload Complete</p><a href={formData.fileUrl} target="_blank" className="text-sm text-blue-600 underline block mb-4">View File</a><button onClick={() => setFormData({ ...formData, fileUrl: "" })} className="text-xs text-red-500 hover:underline">Remove</button></div>
            )}
          </div>
        </div>
      </div>
      <div className="grid gap-4">
        {documents.map((doc) => (
          <div key={doc.id} className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-lg"><FileText className="w-5 h-5 text-blue-600" /></div>
              <div><h3 className="font-bold text-slate-900">{doc.fileName}</h3><p className="text-xs text-slate-500">Linked to: {doc.license?.licenseType || "Unknown"}</p></div>
            </div>
            <div className="flex items-center gap-4">
              <a href={doc.fileUrl} target="_blank" className="text-blue-600 hover:text-blue-800 p-2"><ExternalLink className="w-5 h-5" /></a>
              <button onClick={() => handleDelete(doc.id)} className="text-slate-400 hover:text-red-600 p-2"><Trash2 className="w-5 h-5" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}