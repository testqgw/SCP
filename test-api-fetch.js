// Test script to fetch licenses from API
console.log('Testing API endpoint: http://localhost:3001/api/licenses');

fetch('http://localhost:3001/api/licenses')
  .then(r => {
    console.log('Response status:', r.status);
    return r.json();
  })
  .then(d => {
    console.log('=== Licenses from API ===');
    console.log(JSON.stringify(d, null, 2));
    console.log('\n=== Summary ===');
    console.log('Total licenses:', d.length);
    d.forEach((license, i) => {
      console.log(`License ${i + 1}:`, {
        id: license.id,
        type: license.license_type || 'N/A',
        number: license.license_number || 'N/A',
        authority: license.issuing_authority || 'N/A',
        expires: license.expiration_date || 'N/A',
        status: license.status || 'N/A'
      });
    });
  })
  .catch(err => {
    console.error('Error fetching licenses:', err.message);
    console.error('Make sure the API server is running on port 3001');
  });