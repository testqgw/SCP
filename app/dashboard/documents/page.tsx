"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";

export default function DocumentsPage() {
  const { isLoaded, userId } = useAuth();
  const router = useRouter();
  const [documents, setDocuments] = useState<any[]>([]);
  const [licenses, setLicenses] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Form state for creating
  const [selectedLicenseId, setSelectedLicenseId] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [fileType, setFileType] = useState("");

  // Edit state
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    fileName: "",
    fileUrl: "",
    fileType: "",
  });

  // Fetch Documents and Licenses
  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch documents
        const documentsResponse = await fetch("/api/documents");
        const documentsData = await documentsResponse.json();
        setDocuments(documentsData);

        // Fetch licenses for the dropdown
        const licensesResponse = await fetch("/api/licenses");
        const licensesData = await licensesResponse.json();
        setLicenses(licensesData);
      } catch (error) {
        console.error("Failed to fetch data", error);
      } finally {
        setIsLoading(false);
      }
    }

    if (isLoaded && userId) {
      fetchData();
    }
  }, [isLoaded, userId]);

  // Create Document
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          licenseId: selectedLicenseId,
          fileName,
          fileUrl,
          fileType,
        }),
      });

      if (response.ok) {
        const newDocument = await response.json();
        setDocuments([newDocument, ...documents]); // Optimistic update
        // Reset form
        setSelectedLicenseId("");
        setFileName("");
        setFileUrl("");
        setFileType("");
        setShowForm(false);
        router.refresh();
      }
    } catch (error) {
      console.error("Failed to create document", error);
    }
  };

  // Edit handlers
  const handleEdit = (document: any) => {
    setEditingDocumentId(document.id);
    setEditForm({
      fileName: document.fileName,
      fileUrl: document.fileUrl,
      fileType: document.fileType,
    });
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDocumentId) return;

    try {
      const response = await fetch(`/api/documents/${editingDocumentId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(editForm),
      });

      if (response.ok) {
        const updatedDocument = await response.json();
        setDocuments(docs => docs.map(doc => doc.id === editingDocumentId ? updatedDocument : doc));
        setEditingDocumentId(null);
        router.refresh();
      }
    } catch (error) {
      console.error("Failed to update document", error);
    }
  };

  const handleDelete = async (documentId: string) => {
    if (!confirm("Are you sure you want to delete this document?")) return;

    try {
      const response = await fetch(`/api/documents/${documentId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setDocuments(docs => docs.filter(doc => doc.id !== documentId));
        router.refresh();
      }
    } catch (error) {
      console.error("Failed to delete document", error);
    }
  };

  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (isLoading) return <div className="p-6">Loading documents...</div>;

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Document Management</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition font-medium"
        >
          {showForm ? 'Cancel' : '+ Add Document'}
        </button>
      </div>

      {/* Add Document Form */}
      {showForm && (
        <div className="bg-white p-6 rounded-lg shadow mb-8 border">
          <h2 className="text-xl font-semibold mb-4">Add New Document</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                License *
              </label>
              <select
                className="w-full p-2 border rounded-md"
                value={selectedLicenseId}
                onChange={(e) => setSelectedLicenseId(e.target.value)}
                required
              >
                <option value="">Select a license...</option>
                {licenses.map((license) => (
                  <option key={license.id} value={license.id}>
                    {license.licenseType} - {license.business?.name || 'Unknown Business'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                File Name *
              </label>
              <input
                type="text"
                placeholder="e.g., License_Certificate.pdf"
                className="w-full p-2 border rounded-md"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                File URL *
              </label>
              <input
                type="url"
                placeholder="https://storage.example.com/documents/license.pdf"
                className="w-full p-2 border rounded-md"
                value={fileUrl}
                onChange={(e) => setFileUrl(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                File Type *
              </label>
              <input
                type="text"
                placeholder="e.g., application/pdf, image/jpeg"
                className="w-full p-2 border rounded-md"
                value={fileType}
                onChange={(e) => setFileType(e.target.value)}
                required
              />
            </div>

            <button
              type="submit"
              className="bg-green-600 text-white px-6 py-2 rounded-md hover:bg-green-700 transition font-medium"
            >
              Add Document
            </button>
          </form>
        </div>
      )}

      {/* Documents List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {documents.length === 0 ? (
          <p className="text-gray-500 col-span-full">No documents found. Add one above!</p>
        ) : (
          documents.map((document) => {
            return (
              <div key={document.id} className="bg-white rounded-lg shadow-sm border hover:shadow-md transition p-4">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="font-bold text-lg flex-1 truncate">{document.fileName}</h3>
                  <span className="px-2 py-1 rounded-full text-xs font-medium border bg-gray-100 text-gray-800 border-gray-200">
                    {document.fileType}
                  </span>
                </div>

                {/* Edit Form */}
                {editingDocumentId === document.id ? (
                  <form onSubmit={handleUpdate} className="space-y-3 mb-4">
                    <input
                      type="text"
                      placeholder="File Name"
                      className="w-full p-2 border rounded-md text-sm"
                      value={editForm.fileName}
                      onChange={(e) => setEditForm({...editForm, fileName: e.target.value})}
                      required
                    />
                    <input
                      type="url"
                      placeholder="File URL"
                      className="w-full p-2 border rounded-md text-sm"
                      value={editForm.fileUrl}
                      onChange={(e) => setEditForm({...editForm, fileUrl: e.target.value})}
                      required
                    />
                    <input
                      type="text"
                      placeholder="File Type"
                      className="w-full p-2 border rounded-md text-sm"
                      value={editForm.fileType}
                      onChange={(e) => setEditForm({...editForm, fileType: e.target.value})}
                      required
                    />
                  </form>
                ) : (
                  <div className="space-y-2 text-sm text-gray-600">
                    <p><span className="font-medium">License:</span> {document.license?.licenseType || 'Unknown'}</p>
                    <p><span className="font-medium">Business:</span> {document.license?.business?.name || 'Unknown'}</p>
                    <p><span className="font-medium">Type:</span> {document.fileType}</p>
                    <p>
                      <span className="font-medium">URL:</span> 
                      <a 
                        href={document.fileUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline ml-1 break-all"
                      >
                        {document.fileUrl}
                      </a>
                    </p>
                    <p><span className="font-medium">Uploaded:</span> {formatDate(document.uploadedAt)}</p>
                  </div>
                )}

                <div className="mt-4 flex justify-end space-x-2">
                  {editingDocumentId === document.id ? (
                    <>
                      <button 
                        onClick={handleUpdate}
                        className="text-green-600 text-sm font-medium hover:underline"
                      >
                        Save
                      </button>
                      <button 
                        onClick={() => setEditingDocumentId(null)}
                        className="text-gray-600 text-sm font-medium hover:underline"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button 
                        onClick={() => handleEdit(document)}
                        className="text-blue-600 text-sm font-medium hover:underline"
                      >
                        Edit
                      </button>
                      <button 
                        onClick={() => handleDelete(document.id)}
                        className="text-red-600 text-sm font-medium hover:underline"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}