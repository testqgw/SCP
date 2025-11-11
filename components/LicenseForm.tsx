interface License {
  id: string;
  businessId: string;
  licenseType: string;
  licenseNumber: string;
  issuingAuthority: string;
  issueDate: string;
  expirationDate: string;
  renewalUrl: string;
  gracePeriodDays: number;
  notes: string;
}

interface LicenseFormProps {
  license?: License | null;
  businessId?: string;
  businesses: any[];
  onSubmit: (data: any) => void;
  onCancel: () => void;
}

export function LicenseForm({ license, businessId, businesses, onSubmit, onCancel }: LicenseFormProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    
    const data = {
      businessId: formData.get('businessId'),
      licenseType: formData.get('licenseType'),
      licenseNumber: formData.get('licenseNumber'),
      issuingAuthority: formData.get('issuingAuthority'),
      issueDate: formData.get('issueDate'),
      expirationDate: formData.get('expirationDate'),
      renewalUrl: formData.get('renewalUrl'),
      gracePeriodDays: parseInt(formData.get('gracePeriodDays') as string) || 0,
      notes: formData.get('notes'),
    };

    onSubmit(data);
  };

  const foodTruckLicenses = [
    'Mobile Food Vendor License',
    'Health Department Permit',
    'Commissary Agreement',
    'Fire Safety Certificate',
    'Business License',
    'Sales Tax Permit',
    'Vehicle/Cart Permit',
    'Special Event Permit',
  ];

  const contractorLicenses = [
    'General Contractor License',
    'HVAC License',
    'Plumbing License',
    'Electrical License',
    'Business License',
    'Liability Insurance Certificate',
    'Workers Comp Insurance',
    'Bonding Certificate',
  ];

  const getLicenseTypes = (businessType: string) => {
    switch (businessType) {
      case 'food_vendor':
        return foodTruckLicenses;
      case 'contractor':
        return contractorLicenses;
      default:
        return ['Business License', 'General License', 'Permit'];
    }
  };

  const selectedBusiness = businesses.find(b => b.id === (license?.businessId || businessId));
  const businessType = selectedBusiness?.businessType || '';
  const licenseTypes = getLicenseTypes(businessType);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="businessId" className="block text-sm font-medium text-gray-700">
            Business *
          </label>
          <select
            name="businessId"
            id="businessId"
            required
            defaultValue={license?.businessId || businessId}
            disabled={!!businessId}
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:bg-gray-100"
          >
            <option value="">Select a business</option>
            {businesses.map((business) => (
              <option key={business.id} value={business.id}>
                {business.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="licenseType" className="block text-sm font-medium text-gray-700">
            License Type *
          </label>
          <select
            name="licenseType"
            id="licenseType"
            required
            defaultValue={license?.licenseType || ''}
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          >
            <option value="">Select license type</option>
            {licenseTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="licenseNumber" className="block text-sm font-medium text-gray-700">
            License Number
          </label>
          <input
            type="text"
            name="licenseNumber"
            id="licenseNumber"
            defaultValue={license?.licenseNumber || ''}
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          />
        </div>

        <div>
          <label htmlFor="issuingAuthority" className="block text-sm font-medium text-gray-700">
            Issuing Authority *
          </label>
          <input
            type="text"
            name="issuingAuthority"
            id="issuingAuthority"
            required
            defaultValue={license?.issuingAuthority || ''}
            placeholder="e.g., NYC Department of Health"
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          />
        </div>

        <div>
          <label htmlFor="issueDate" className="block text-sm font-medium text-gray-700">
            Issue Date *
          </label>
          <input
            type="date"
            name="issueDate"
            id="issueDate"
            required
            defaultValue={license?.issueDate ? license.issueDate.split('T')[0] : ''}
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          />
        </div>

        <div>
          <label htmlFor="expirationDate" className="block text-sm font-medium text-gray-700">
            Expiration Date *
          </label>
          <input
            type="date"
            name="expirationDate"
            id="expirationDate"
            required
            defaultValue={license?.expirationDate ? license.expirationDate.split('T')[0] : ''}
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          />
        </div>

        <div>
          <label htmlFor="renewalUrl" className="block text-sm font-medium text-gray-700">
            Renewal URL
          </label>
          <input
            type="url"
            name="renewalUrl"
            id="renewalUrl"
            defaultValue={license?.renewalUrl || ''}
            placeholder="https://renewal-portal.example.com"
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          />
        </div>

        <div>
          <label htmlFor="gracePeriodDays" className="block text-sm font-medium text-gray-700">
            Grace Period (Days)
          </label>
          <input
            type="number"
            name="gracePeriodDays"
            id="gracePeriodDays"
            min="0"
            defaultValue={license?.gracePeriodDays || 0}
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          />
        </div>
      </div>

      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
          Notes
        </label>
        <textarea
          name="notes"
          id="notes"
          rows={3}
          defaultValue={license?.notes || ''}
          placeholder="Additional notes about this license..."
          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
        />
      </div>

      <div className="flex justify-end space-x-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          {license ? 'Update' : 'Create'} License
        </button>
      </div>
    </form>
  );
}