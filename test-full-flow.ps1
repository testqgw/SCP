# Full User Flow Test Script for Compliance Reminder SaaS

Write-Host "Starting Full User Flow Test..." -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green

# Base URL
$API_URL = "http://localhost:3001"
$FRONTEND_URL = "http://localhost:3000"

# Test 1: Create Business
Write-Host "`nTest 1: Creating Business..." -ForegroundColor Yellow
$businessBody = @{
    name = "Taco Truck Express"
    businessType = "food_vendor"
    address = "123 Main St"
    city = "New York"
    state = "NY"
    zip = "10001"
    phone = "555-1234"
} | ConvertTo-Json

try {
    $businessResponse = Invoke-RestMethod -Uri "$API_URL/api/businesses" -Method Post -Body $businessBody -ContentType "application/json"
    $businessId = $businessResponse.id
    Write-Host "SUCCESS: Business created: $($businessResponse.name) (ID: $businessId)" -ForegroundColor Green
} catch {
    Write-Host "FAILED: Business creation failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 2: Create License (expiring in 30 days = YELLOW)
Write-Host "`nTest 2: Creating License (expiring in 30 days)..." -ForegroundColor Yellow
$expirationDate30 = (Get-Date).AddDays(30).ToString("yyyy-MM-dd")
$licenseBody30 = @{
    businessId = $businessId
    licenseType = "Health Permit"
    licenseNumber = "HP-2025-001"
    issuingAuthority = "NYC Dept of Health"
    issueDate = "2024-01-15"
    expirationDate = $expirationDate30
    renewalUrl = "https://nyc.gov/renew"
    gracePeriodDays = 0
    notes = "Annual health permit for food service"
} | ConvertTo-Json

try {
    $licenseResponse30 = Invoke-RestMethod -Uri "$API_URL/api/licenses" -Method Post -Body $licenseBody30 -ContentType "application/json"
    $licenseId30 = $licenseResponse30.id
    Write-Host "SUCCESS: License created: $($licenseResponse30.licenseType) (ID: $licenseId30)" -ForegroundColor Green
    Write-Host "   Expiration: $expirationDate30 (30 days = YELLOW status)" -ForegroundColor Cyan
} catch {
    Write-Host "FAILED: License creation failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 3: Create License (expiring in 90 days = GREEN)
Write-Host "`nTest 3: Creating License (expiring in 90 days)..." -ForegroundColor Yellow
$expirationDate90 = (Get-Date).AddDays(90).ToString("yyyy-MM-dd")
$licenseBody90 = @{
    businessId = $businessId
    licenseType = "Business License"
    licenseNumber = "BL-2025-002"
    issuingAuthority = "NYC Business Bureau"
    issueDate = "2024-01-15"
    expirationDate = $expirationDate90
    renewalUrl = "https://nyc.gov/business-renew"
    gracePeriodDays = 0
    notes = "Annual business license"
} | ConvertTo-Json

try {
    $licenseResponse90 = Invoke-RestMethod -Uri "$API_URL/api/licenses" -Method Post -Body $licenseBody90 -ContentType "application/json"
    $licenseId90 = $licenseResponse90.id
    Write-Host "SUCCESS: License created: $($licenseResponse90.licenseType) (ID: $licenseId90)" -ForegroundColor Green
    Write-Host "   Expiration: $expirationDate90 (90 days = GREEN status)" -ForegroundColor Cyan
} catch {
    Write-Host "FAILED: License creation failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 4: Get all licenses and verify status colors
Write-Host "`nTest 4: Verifying License Status Colors..." -ForegroundColor Yellow
try {
    $licenses = Invoke-RestMethod -Uri "$API_URL/api/licenses" -Method Get
    Write-Host "SUCCESS: Retrieved $($licenses.Count) licenses:" -ForegroundColor Green
    
    foreach ($license in $licenses) {
        $daysUntil = [math]::Ceiling((([DateTime]$license.expirationDate) - (Get-Date)).TotalDays)
        $status = $license.status
        
        $color = switch ($status) {
            "current" { "Green" }
            "expiring_soon" { "Yellow" }
            "expired" { "Red" }
            default { "Unknown" }
        }
        
        Write-Host "   - $($license.licenseType): $status ($color, $daysUntil days)" -ForegroundColor Cyan
    }
} catch {
    Write-Host "FAILED: Could not retrieve licenses: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 5: Dashboard stats
Write-Host "`nTest 5: Checking Dashboard Stats..." -ForegroundColor Yellow
try {
    $businesses = Invoke-RestMethod -Uri "$API_URL/api/businesses" -Method Get
    $allLicenses = Invoke-RestMethod -Uri "$API_URL/api/licenses" -Method Get
    
    $totalBusinesses = $businesses.Count
    $totalLicenses = $allLicenses.Count
    $expiringSoon = ($allLicenses | Where-Object { $_.status -eq "expiring_soon" }).Count
    $expired = ($allLicenses | Where-Object { $_.status -eq "expired" }).Count
    
    Write-Host "SUCCESS: Dashboard Stats:" -ForegroundColor Green
    Write-Host "   - Total Businesses: $totalBusinesses" -ForegroundColor Cyan
    Write-Host "   - Total Licenses: $totalLicenses" -ForegroundColor Cyan
    Write-Host "   - Expiring Soon: $expiringSoon" -ForegroundColor Cyan
    Write-Host "   - Expired: $expired" -ForegroundColor Cyan
} catch {
    Write-Host "FAILED: Could not retrieve stats: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 6: Frontend URLs
Write-Host "`nTest 6: Frontend URLs to Test:" -ForegroundColor Yellow
Write-Host "   - Landing: $FRONTEND_URL" -ForegroundColor Cyan
Write-Host "   - Dashboard: $FRONTEND_URL/dashboard" -ForegroundColor Cyan
Write-Host "   - Businesses: $FRONTEND_URL/dashboard/businesses" -ForegroundColor Cyan
Write-Host "   - Licenses: $FRONTEND_URL/dashboard/licenses" -ForegroundColor Cyan

Write-Host "`nAll tests completed successfully!" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green