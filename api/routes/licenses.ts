/// <reference path="../types/express.d.ts" />

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyAuth } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Calculate license status based on expiration date
const calculateLicenseStatus = (expirationDate: Date | string, gracePeriodDays: number = 0) => {
  const now = new Date();
  const expDate = expirationDate instanceof Date ? expirationDate : new Date(expirationDate);
  const timeDiff = expDate.getTime() - now.getTime();
  const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));

  if (daysDiff < -gracePeriodDays) {
    return 'expired';
  } else if (daysDiff <= 30) {
    return 'expiring_soon';
  } else {
    return 'current';
  }
};

// Get all licenses for current user's businesses
router.get('/', verifyAuth, async (req, res) => {
  try {
    const licenses = await prisma.license.findMany({
      where: {
        business: {
          userId: req.userId,
        },
      },
      include: {
        business: {
          select: {
            name: true,
          },
        },
        _count: {
          select: {
            documents: true,
          },
        },
      },
      orderBy: { expirationDate: 'asc' },
    });

    // Update status for each license based on expiration date
    const updatedLicenses = licenses.map((license: any) => ({
      ...license,
      status: calculateLicenseStatus(license.expirationDate, license.gracePeriodDays),
    }));

    res.json(updatedLicenses);
  } catch (error) {
    console.error('Error fetching licenses:', error);
    res.status(500).json({ error: 'Failed to fetch licenses' });
  }
});

// Get licenses by business ID
router.get('/business/:businessId', verifyAuth, async (req, res) => {
  try {
    const { businessId } = req.params;

    // Verify business belongs to user
    const business = await prisma.business.findFirst({
      where: { id: businessId, userId: req.userId },
    });

    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    const licenses = await prisma.license.findMany({
      where: { businessId },
      include: {
        _count: {
          select: {
            documents: true,
          },
        },
      },
      orderBy: { expirationDate: 'asc' },
    });

    // Update status for each license
    const updatedLicenses = licenses.map((license: any) => ({
      ...license,
      status: calculateLicenseStatus(license.expirationDate, license.gracePeriodDays),
    }));

    res.json(updatedLicenses);
  } catch (error) {
    console.error('Error fetching business licenses:', error);
    res.status(500).json({ error: 'Failed to fetch business licenses' });
  }
});

// Create new license
router.post('/', verifyAuth, async (req, res) => {
  try {
    const {
      businessId,
      licenseType,
      licenseNumber,
      issuingAuthority,
      issueDate,
      expirationDate,
      renewalUrl,
      gracePeriodDays,
      notes,
    } = req.body;

    // Verify business belongs to user
    const business = await prisma.business.findFirst({
      where: { id: businessId, userId: req.userId },
    });

    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    const license = await prisma.license.create({
      data: {
        businessId,
        licenseType,
        licenseNumber,
        issuingAuthority,
        issueDate: new Date(issueDate),
        expirationDate: new Date(expirationDate),
        renewalUrl,
        gracePeriodDays: gracePeriodDays || 0,
        notes,
        status: calculateLicenseStatus(new Date(expirationDate), gracePeriodDays || 0),
      },
    });

    // Create reminder schedules
    const reminderDays = [90, 60, 30, 14, 7, 1];
    const reminderSchedules = reminderDays.map(daysBefore => ({
      licenseId: license.id,
      daysBeforeExpiration: daysBefore,
      reminderType: 'both',
      status: 'pending',
    }));

    await prisma.reminderSchedule.createMany({
      data: reminderSchedules,
    });

    res.status(201).json(license);
  } catch (error) {
    console.error('Error creating license:', error);
    res.status(500).json({ error: 'Failed to create license' });
  }
});

// Update license
router.put('/:id', verifyAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if license belongs to user's business
    const existingLicense = await prisma.license.findFirst({
      where: {
        id,
        business: {
          userId: req.userId,
        },
      },
    });

    if (!existingLicense) {
      return res.status(404).json({ error: 'License not found' });
    }

    const {
      licenseType,
      licenseNumber,
      issuingAuthority,
      issueDate,
      expirationDate,
      renewalUrl,
      gracePeriodDays,
      notes,
    } = req.body;

    const license = await prisma.license.update({
      where: { id },
      data: {
        licenseType,
        licenseNumber,
        issuingAuthority,
        issueDate: issueDate ? new Date(issueDate) : undefined,
        expirationDate: expirationDate ? new Date(expirationDate) : undefined,
        renewalUrl,
        gracePeriodDays,
        notes,
        status: expirationDate
          ? calculateLicenseStatus(new Date(expirationDate), gracePeriodDays || 0)
          : undefined,
      },
    });

    res.json(license);
  } catch (error) {
    console.error('Error updating license:', error);
    res.status(500).json({ error: 'Failed to update license' });
  }
});

// Delete license
router.delete('/:id', verifyAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if license belongs to user's business
    const existingLicense = await prisma.license.findFirst({
      where: {
        id,
        business: {
          userId: req.userId,
        },
      },
    });

    if (!existingLicense) {
      return res.status(404).json({ error: 'License not found' });
    }

    await prisma.license.delete({
      where: { id },
    });

    res.json({ message: 'License deleted successfully' });
  } catch (error) {
    console.error('Error deleting license:', error);
    res.status(500).json({ error: 'Failed to delete license' });
  }
});

export default router;