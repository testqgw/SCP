// Test script to fetch licenses from API
fetch('http://localhost:3001/api/licenses')
  .then(r => r.json())
  .then(d => {
    console.log('=== Licenses from API ===');
    console.log(JSON.stringify(d, null, 2));
    console.log('\n=== Summary ===');
    console.log('Total licenses:', d.length);
    d.forEach((license, i) => {
      console.log(`License ${i + 1}:`, license.license_type || 'N/A', '-', license.status || 'N/A');
    });
  })
  .catch(err => {
    console.error('Error fetching licenses:', err.message);
  });