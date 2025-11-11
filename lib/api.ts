const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

class ApiClient {
  private getAuthHeaders() {
    if (typeof window === 'undefined') return {};
    
    // Get token from localStorage (set by Clerk)
    const token = localStorage.getItem('clerk-session-token');
    return {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers = {
      ...this.getAuthHeaders(),
      ...options.headers,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    return response.json();
  }

  // Businesses
  async getBusinesses() {
    return this.request('/api/businesses');
  }

  async createBusiness(data: any) {
    return this.request('/api/businesses', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateBusiness(id: string, data: any) {
    return this.request(`/api/businesses/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteBusiness(id: string) {
    return this.request(`/api/businesses/${id}`, {
      method: 'DELETE',
    });
  }

  // Licenses
  async getLicenses() {
    return this.request('/api/licenses');
  }

  async getBusinessLicenses(businessId: string) {
    return this.request(`/api/licenses/business/${businessId}`);
  }

  async createLicense(data: any) {
    return this.request('/api/licenses', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateLicense(id: string, data: any) {
    return this.request(`/api/licenses/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteLicense(id: string) {
    return this.request(`/api/licenses/${id}`, {
      method: 'DELETE',
    });
  }
}

export const api = new ApiClient();