// Create all 3 test licenses for the color-coded system

const licenses = [
  {
    // GREEN - Current (90+ days)
    business_id: "1",
    license_type: "Health Permit",
    license_number: "HP-2024-001",
    issuing_authority: "City Health Dept",
    issue_date: "2024-01-01",
    expiration_date: "2026-02-08",
    renewal_url: "https://example.com/renew-health",
    grace_period_days: 0
  },
  {
    // YELLOW - Expiring Soon (25 days)
    business_id: "1",
    license_type: "Vendor License",
    license_number: "VL-2024-002",
    issuing_authority: "City Hall",
    issue_date: "2024-01-01",
    expiration_date: "2025-12-05",
    renewal_url: "https://example.com/renew-vendor",
    grace_period_days: 0
  },
  {
    // RED - Expired (5 days ago)
    business_id: "1",
    license_type: "Fire Safety Certificate",
    license_number: "FS-2023-003",
    issuing_authority: "Fire Department",
    issue_date: "2023-01-01",
    expiration_date: "2025-11-05",
    renewal_url: "https://example.com/renew-fire",
    grace_period_days: 0
  }
];

async function createLicenses() {
  console.log('Creating 3 test licenses...\n');
  
  for (let i = 0; i < licenses.length; i++) {
    const license = licenses[i];
    console.log(`Creating License ${i + 1}: ${license.license_type}`);
    
    try {
      const response = await fetch('http://localhost:3001/api/licenses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(license)
      });
      
      const result = await response.json();
      console.log('✅ Created:', result.licenseType, '- Status:', result.status);
      
    } catch (error) {
      console.error('❌ Error creating license:', error.message);
    }
  }
  
  console.log('\n=== Fetching All Licenses ===');
  
  try {
    const response = await fetch('http://localhost:3001/api/licenses');
    const allLicenses = await response.json();
    
    console.log('\nTotal licenses:', allLicenses.length);
    console.log('\n=== Color-Coded Licenses ===');
    
    allLicenses.forEach((license, i) => {
      const daysLeft = Math.ceil(
        (new Date(license.expiration_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
      );
      
      console.log(`\n${i + 1}. ${license.license_type}`);
      console.log(`   Number: ${license.license_number}`);
      console.log(`   Status: ${license.status}`);
      console.log(`   Expires: ${license.expiration_date}`);
      console.log(`   Days: ${daysLeft > 0 ? `${daysLeft} days left` : `${Math.abs(daysLeft)} days ago`}`);
    });
    
  } catch (error) {
    console.error('Error fetching licenses:', error.message);
  }
}

createLicenses();