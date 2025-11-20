/**
 * Integration Test Script for Compliance Reminder SaaS
 * 
 * This script tests the full data flow:
 * 1. Create a Business
 * 2. Create a License for that Business
 * 3. Create a Document for that License
 * 
 * Run this after starting your dev server:
 * npm run dev:all
 * 
 * Then in another terminal:
 * node test-integration-flow.js
 */

const BASE_URL = 'http://localhost:3000';

async function testFullFlow() {
  console.log('🧪 Starting Integration Test...\n');
  
  try {
    // Step 1: Create a Business
    console.log('Step 1: Creating Business...');
    const businessResponse = await fetch(`${BASE_URL}/api/businesses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: "Joe's Food Truck",
        businessType: "food_vendor",
        address: "123 Main St",
        city: "New York",
        state: "NY",
        zip: "10001",
        phone: "555-0123"
      })
    });
    
    if (!businessResponse.ok) {
      throw new Error(`Business creation failed: ${businessResponse.status}`);
    }
    
    const business = await businessResponse.json();
    console.log('✅ Business created:', business.id);
    console.log('   Name:', business.name);
    console.log('   Type:', business.businessType);
    
    // Step 2: Create a License for the Business
    console.log('\nStep 2: Creating License...');
    const licenseResponse = await fetch(`${BASE_URL}/api/licenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        businessId: business.id,
        licenseType: "Mobile Food Vendor License",
        licenseNumber: "MFV-2024-001",
        issuingAuthority: "NYC Department of Health",
        issueDate: "2024-01-15",
        expirationDate: "2025-01-15",
        renewalUrl: "https://www.nyc.gov/health/renew",
        notes: "Must renew 30 days before expiration"
      })
    });
    
    if (!licenseResponse.ok) {
      throw new Error(`License creation failed: ${licenseResponse.status}`);
    }
    
    const license = await licenseResponse.json();
    console.log('✅ License created:', license.id);
    console.log('   Type:', license.licenseType);
    console.log('   Expires:', license.expirationDate);
    console.log('   Status:', license.status);
    
    // Step 3: Create a Document for the License
    console.log('\nStep 3: Creating Document...');
    const documentResponse = await fetch(`${BASE_URL}/api/documents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        licenseId: license.id,
        fileName: "Health_Permit_Certificate.pdf",
        fileUrl: "https://example.com/documents/health_permit.pdf",
        fileType: "application/pdf"
      })
    });
    
    if (!documentResponse.ok) {
      throw new Error(`Document creation failed: ${documentResponse.status}`);
    }
    
    const document = await documentResponse.json();
    console.log('✅ Document created:', document.id);
    console.log('   File:', document.fileName);
    console.log('   Type:', document.fileType);
    
    // Step 4: Verify Relationships
    console.log('\nStep 4: Verifying relationships...');
    
    // Fetch business with licenses
    const businessLicensesResponse = await fetch(`${BASE_URL}/api/licenses`);
    const allLicenses = await businessLicensesResponse.json();
    const businessLicenses = allLicenses.filter(lic => lic.businessId === business.id);
    
    console.log(`✅ Business has ${businessLicenses.length} license(s)`);
    
    // Fetch license with documents
    const licenseDocsResponse = await fetch(`${BASE_URL}/api/documents`);
    const allDocuments = await licenseDocsResponse.json();
    const licenseDocuments = allDocuments.filter(doc => doc.licenseId === license.id);
    
    console.log(`✅ License has ${licenseDocuments.length} document(s)`);
    
    // Step 5: Test Edit Functionality
    console.log('\nStep 5: Testing edit functionality...');
    const updateResponse = await fetch(`${BASE_URL}/api/licenses/${license.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        licenseType: "Mobile Food Vendor License - UPDATED",
        notes: "Updated notes"
      })
    });
    
    if (!updateResponse.ok) {
      throw new Error(`License update failed: ${updateResponse.status}`);
    }
    
    const updatedLicense = await updateResponse.json();
    console.log('✅ License updated successfully');
    console.log('   New type:', updatedLicense.licenseType);
    console.log('   New notes:', updatedLicense.notes);
    
    // Step 6: Test Delete Functionality
    console.log('\nStep 6: Testing delete functionality...');
    const deleteResponse = await fetch(`${BASE_URL}/api/documents/${document.id}`, {
      method: 'DELETE',
    });
    
    if (!deleteResponse.ok) {
      throw new Error(`Document delete failed: ${deleteResponse.status}`);
    }
    
    console.log('✅ Document deleted successfully');
    
    // Verify deletion
    const verifyDeleteResponse = await fetch(`${BASE_URL}/api/documents`);
    const docsAfterDelete = await verifyDeleteResponse.json();
    const docStillExists = docsAfterDelete.find(doc => doc.id === document.id);
    
    if (docStillExists) {
      throw new Error('Document still exists after deletion');
    }
    
    console.log('✅ Document deletion verified');
    
    console.log('\n🎉 INTEGRATION TEST PASSED!');
    console.log('\n📊 Summary:');
    console.log(`   - Business: ${business.name} (${business.id})`);
    console.log(`   - License: ${license.licenseType} (${license.id})`);
    console.log(`   - Document: ${document.fileName} (created and deleted)`);
    console.log('\n✨ All CRUD operations working correctly!');
    console.log('\n🚀 Ready for Week 2: Reminder System');
    
  } catch (error) {
    console.error('\n❌ INTEGRATION TEST FAILED');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run the test
testFullFlow();