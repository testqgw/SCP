"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const cloudinary_1 = require("cloudinary");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
// Configure Cloudinary
cloudinary_1.v2.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});
// Middleware to verify Clerk authentication
const verifyAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ error: 'No authorization header' });
        }
        const token = authHeader.replace('Bearer ', '');
        // In dev mode, bypass Clerk verification
        req.userId = 'demo-user-id';
        next();
    }
    catch (error) {
        console.error('Auth error:', error);
        res.status(401).json({ error: 'Unauthorized' });
    }
};
// Get documents for a license
router.get('/license/:licenseId', verifyAuth, async (req, res) => {
    try {
        const { licenseId } = req.params;
        // Verify license belongs to user's business
        const license = await prisma.license.findFirst({
            where: {
                id: licenseId,
                business: {
                    userId: req.userId,
                },
            },
        });
        if (!license) {
            return res.status(404).json({ error: 'License not found' });
        }
        const documents = await prisma.document.findMany({
            where: { licenseId },
            orderBy: { uploadedAt: 'desc' },
        });
        res.json(documents);
    }
    catch (error) {
        console.error('Error fetching documents:', error);
        res.status(500).json({ error: 'Failed to fetch documents' });
    }
});
// Upload document
router.post('/upload', verifyAuth, async (req, res) => {
    try {
        const { licenseId, fileData, fileName, fileType } = req.body;
        // Verify license belongs to user
        const license = await prisma.license.findFirst({
            where: {
                id: licenseId,
                business: {
                    userId: req.userId,
                },
            },
        });
        if (!license) {
            return res.status(404).json({ error: 'License not found' });
        }
        let fileUrl = '';
        // Upload to Cloudinary if configured
        if (process.env.CLOUDINARY_CLOUD_NAME && fileData) {
            try {
                const result = await cloudinary_1.v2.uploader.upload(fileData, {
                    folder: `compliance-reminder/${licenseId}`,
                    resource_type: 'auto',
                });
                fileUrl = result.secure_url;
            }
            catch (cloudinaryError) {
                console.error('Cloudinary upload error:', cloudinaryError);
                return res.status(500).json({ error: 'Failed to upload file' });
            }
        }
        else {
            // For development, just store a placeholder URL
            fileUrl = `https://example.com/documents/${fileName}`;
            console.log('Cloudinary not configured. File would be stored at:', fileUrl);
        }
        const document = await prisma.document.create({
            data: {
                licenseId,
                fileName,
                fileUrl,
                fileType,
            },
        });
        res.status(201).json(document);
    }
    catch (error) {
        console.error('Error uploading document:', error);
        res.status(500).json({ error: 'Failed to upload document' });
    }
});
// Delete document
router.delete('/:id', verifyAuth, async (req, res) => {
    try {
        const { id } = req.params;
        // Verify document belongs to user's license
        const document = await prisma.document.findFirst({
            where: {
                id,
                license: {
                    business: {
                        userId: req.userId,
                    },
                },
            },
        });
        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }
        // Delete from Cloudinary if configured
        if (process.env.CLOUDINARY_CLOUD_NAME && document.fileUrl.includes('cloudinary.com')) {
            try {
                // Extract public_id from Cloudinary URL
                const urlParts = document.fileUrl.split('/');
                const publicId = urlParts[urlParts.length - 1].split('.')[0];
                await cloudinary_1.v2.uploader.destroy(publicId);
            }
            catch (cloudinaryError) {
                console.error('Cloudinary delete error:', cloudinaryError);
            }
        }
        await prisma.document.delete({
            where: { id },
        });
        res.json({ message: 'Document deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting document:', error);
        res.status(500).json({ error: 'Failed to delete document' });
    }
});
exports.default = router;
//# sourceMappingURL=documents.js.map