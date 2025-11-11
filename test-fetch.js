// Simple test to fetch licenses from API
fetch('http://localhost:3001/api/licenses')
  .then(r => r.json())
  .then(d => console.log('Licenses from API:', d))
  .catch(err => console.error('Error:', err.message));