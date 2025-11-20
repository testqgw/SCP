import { SignUp } from "@clerk/nextjs";

export default function Page() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="p-4">
        {/* ✅ FIX: Use forceRedirectUrl for sign-up too */}
        <SignUp 
          path="/sign-up" 
          forceRedirectUrl="/dashboard"
        />
      </div>
    </div>
  );
}