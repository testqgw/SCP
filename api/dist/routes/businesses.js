"use strict";
/// <reference path="../types/express.d.ts" />
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
// Get all businesses for current user
router.get('/', auth_1.verifyAuth, async (req, res) => {
    try {
        const businesses = await prisma.business.findMany({
            where: { userId: req.userId },
            include: {
                _count: {
                    select: {
                        licenses: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json(businesses);
    }
    catch (error) {
        console.error('Error fetching businesses:', error);
        res.status(500).json({ error: 'Failed to fetch businesses' });
    }
});
// Create new business
router.post('/', auth_1.verifyAuth, async (req, res) => {
    try {
        // Ensure userId is set
        if (!req.userId) {
            return res.status(401).json({ error: 'User not authenticated' });
        }
        const { name, businessType, address, city, state, zip, phone, } = req.body;
        const business = await prisma.business.create({
            data: {
                userId: req.userId,
                name,
                businessType,
                address,
                city,
                state,
                zip,
                phone,
            },
        });
        res.status(201).json(business);
    }
    catch (error) {
        console.error('Error creating business:', error);
        res.status(500).json({ error: 'Failed to create business' });
    }
});
// Update business
router.put('/:id', auth_1.verifyAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, businessType, address, city, state, zip, phone, } = req.body;
        // Check if business belongs to user
        const existingBusiness = await prisma.business.findFirst({
            where: { id, userId: req.userId },
        });
        if (!existingBusiness) {
            return res.status(404).json({ error: 'Business not found' });
        }
        const business = await prisma.business.update({
            where: { id },
            data: {
                name,
                businessType,
                address,
                city,
                state,
                zip,
                phone,
            },
        });
        res.json(business);
    }
    catch (error) {
        console.error('Error updating business:', error);
        res.status(500).json({ error: 'Failed to update business' });
    }
});
// Delete business
router.delete('/:id', auth_1.verifyAuth, async (req, res) => {
    try {
        const { id } = req.params;
        // Check if business belongs to user
        const existingBusiness = await prisma.business.findFirst({
            where: { id, userId: req.userId },
        });
        if (!existingBusiness) {
            return res.status(404).json({ error: 'Business not found' });
        }
        await prisma.business.delete({
            where: { id },
        });
        res.json({ message: 'Business deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting business:', error);
        res.status(500).json({ error: 'Failed to delete business' });
    }
});
exports.default = router;
//# sourceMappingURL=businesses.js.map