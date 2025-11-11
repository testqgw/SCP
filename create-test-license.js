// Create a test license using fetch
const testLicense = {
  business_id: "1",
  license_type: "Health Permit",
  license_number: "HP-2024-001",
  issuing_authority: "City Health Dept",
  issue_date: "2024-01-01",
  expiration_date: "2026-02-08",
  renewal_url: "https://example.com",
  grace_period_days: 0
};

console.log('Creating test license with data:', JSON.stringify(testLicense, null, 2));

fetch('http://localhost:3001/api/licenses', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(testLicense)
})
.then(r => r.json())
.then(data => {
  console.log('License created successfully:', data);
  // Now fetch all licenses to verify
  return fetch('http://localhost:3001/api/licenses');
})
.then(r => r.json())
.then(licenses => {
  console.log('\n=== All Licenses ===');
  console.log(JSON.stringify(licenses, null, 2));
})
.catch(err => {
  console.error('Error:', err.message);
});